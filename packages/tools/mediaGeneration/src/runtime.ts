import { z } from "zod";

export type { MediaModel, MediaReference, MediaGenerationRequest, GeneratedMedia, MediaContext } from "@toonflow/tools-scaffold/runtime";

const relativePath = z.string().min(1).max(2048).refine(
  path => !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."),
  "路径必须是工作区内的相对路径，不能包含空路径段或 ..",
);
const imageReference = z.strictObject({ path: relativePath, mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i) });
const videoReference = z.strictObject({ path: relativePath, mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/i) });
const audioReference = z.strictObject({ path: relativePath, mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/i) });
const sharedFields = {
  providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/),
  modelId: z.string().trim().min(1).max(256),
  prompt: z.string().trim().min(1).max(100000),
  // ACT: label 只是引擎侧任务名，长名字不该让整次生成失败（节点显示名与抽取模型给的名字都没有长度约束），
  // 这里截到 80 字；供应商侧还会按「类型-代号-时间戳」重拼并保留时间戳。
  label: z.string().trim().min(1).transform(value => value.slice(0, 80)).optional(),
  outputDirectory: relativePath.optional(),
  images: z.array(imageReference).max(64).optional(),
  ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/).optional(),
};
const referenceMode = z.templateLiteral([z.enum(["image", "video", "audio"]), "Reference:", z.number()])
  .refine(value => /Reference:(?:[1-9]\d?|1\d{2}|2[0-4]\d|25[0-6])$/.test(value), "参考数量必须在 1 到 256 之间");

export const listMediaModelsSchema = z.strictObject({});
export const imageGenerationSchema = z.strictObject({
  ...sharedFields,
  size: z.string().trim().min(1).max(64).optional(),
});
export const videoGenerationSchema = z.strictObject({
  ...sharedFields,
  videos: z.array(videoReference).max(64).optional(),
  audios: z.array(audioReference).max(64).optional(),
  firstFrame: imageReference.optional(),
  lastFrame: imageReference.optional(),
  /**
   * 续接上一镜：传供应商侧任务号（FreeVideo 形如 `j` + 12 位十六进制），
   * 由引擎加载该任务的原生音视频上下文继续生成。
   * 续接时**只允许 references 类媒体**，firstFrame/lastFrame 必须留空；
   * 参考图上限通常为 3 张，由供应商按自身契约校验。
   */
  continueFrom: z.string().trim().min(1).max(64).optional(),
  resolution: z.string().trim().min(1).max(64).optional(),
  duration: z.number().finite().positive().max(3600).optional(),
  generateAudio: z.boolean().optional(),
  /**
   * 生成质量档位（FreeVideo 引擎：light/medium 为 8 步二次采样，high/max 为 20 步单次采样）；
   * 未传时供应商按自身默认值处理。
   */
  quality: z.enum(["light", "medium", "high", "max"]).optional(),
  /** 是否开启二次采样（引擎的二次细化采样）；未传时供应商按自身默认值处理。 */
  secondPass: z.boolean().optional(),
  /**
   * 是否开启快速预览模式（引擎固定跑 8 步二次采样，无视 quality/secondPass 档位；产出为预览片，
   * 成片需另发 refine 任务）；未传时供应商按自身默认值处理。
   */
  preview: z.boolean().optional(),
  /** 随机种子（引擎取值 0 到 2^53-1）；未传时由供应商/引擎决定。重 roll 保种子用于跨重试复现。 */
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** 本任务完成后立即释放显存/内存中的视频模型；只对批次最后一个任务置 true。 */
  releaseGpuAfter: z.boolean().optional(),
  /** 一次提交连出 N 条候选（引擎 takes，1–8）：结果按条返回、各带 jobId；带 seed 时候选种子逐条 +1，整批可复现。 */
  takes: z.number().int().min(1).max(8).optional(),
  /** 预览转正片：传预览任务的 jobId（j+12hex），引擎从预览直接精修成片；设置后 prompt/时长/媒体等参数一律忽略（引擎互斥约束）。 */
  refineFrom: z.string().regex(/^j[0-9a-f]{12}$/).optional(),
  /** 长镜分块的逐块描述（1–5 条，条数必须等于 POST /plan 返回的 chain_plan.blocks 数）：每块演自己那段剧情。 */
  partPrompts: z.array(z.string().trim().min(1).max(20000)).min(1).max(5).optional(),
  mode: z.union([
    z.enum(["singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text"]),
    z.array(referenceMode).min(1).max(3),
  ]).optional(),
}).refine(args => !args.continueFrom || (!args.firstFrame && !args.lastFrame),
  "续接镜头只允许参考媒体：continueFrom 与 firstFrame / lastFrame 不能同时使用（引擎限制）");
export const audioGenerationSchema = z.strictObject({
  providerId: sharedFields.providerId,
  modelId: sharedFields.modelId,
  prompt: sharedFields.prompt,
  outputDirectory: sharedFields.outputDirectory,
  images: sharedFields.images,
  audios: z.array(audioReference).max(64).optional(),
  voice: z.string().trim().min(1).max(256).optional(),
  speed: z.number().finite().positive().optional(),
  volume: z.number().finite().optional(),
  pitch: z.number().finite().optional(),
  language: z.string().trim().min(1).max(64).optional(),
  format: z.string().trim().min(1).max(64).optional(),
  sampleRate: z.number().int().positive().optional(),
});

/** 提交前预检（引擎 /plan）：入参与 generateVideo 同形（复用 videoGenerationSchema），返回分块计划与实际几何。 */
export const planVideoSchema = videoGenerationSchema;

/** 本机视觉模型问答（引擎 kind=vlm）：questions 1–8 条，每条可带工作区图片（≤16）或视频（自动采样帧）；全任务素材合计 ≤24。 */
export const askVlmSchema = z.strictObject({
  providerId: sharedFields.providerId,
  modelId: z.string().trim().min(1).max(256).optional(),
  questions: z.array(z.union([
    z.string().trim().min(1).max(8000),
    z.strictObject({
      text: z.string().trim().min(1).max(8000),
      images: z.array(imageReference).max(16).optional(),
      video: videoReference.optional(),
    }),
  ])).min(1).max(8),
  system: z.string().trim().min(1).max(4000).optional(),
  format: z.enum(["text", "json"]).optional(),
  label: z.string().trim().min(1).max(120).optional(),
});
