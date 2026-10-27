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
