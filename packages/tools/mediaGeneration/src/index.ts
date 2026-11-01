import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { askVlmSchema, audioGenerationSchema, imageGenerationSchema, listMediaModelsSchema, planVideoSchema, videoGenerationSchema } from "./runtime";

const configSchema = z.strictObject({
  allowImage: z.boolean().default(true),
  allowVideo: z.boolean().default(true),
  allowAudio: z.boolean().default(true),
});

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools({ media, config }) {
    if (!media) return [];
    const permissions = configSchema.parse(config);
    const generationTools = ([
      { name: "generateImage", mediaType: "image", enabled: permissions.allowImage, label: "生成图片", parameters: imageGenerationSchema, description: "根据提示词和可选的工作区参考图生成图片。" },
      { name: "generateVideo", mediaType: "video", enabled: permissions.allowVideo, label: "生成视频", parameters: videoGenerationSchema, description: "根据提示词和可选的工作区图片、视频、音频、首尾帧生成视频。按模型能力设置生成模式、时长、分辨率和音频；quality 为质量档位（light/medium/high/max，对应轻量/标准/精细/极致），secondPass 为二次采样开关，均可省略（供应商默认 light + 开启二次采样）。续接（continueFrom）或 30 秒以上的长镜必须开启二次采样且 quality 用 light/medium，否则供应商会拒绝（引擎限制）；preview 为快速预览模式，只支持单个 30 秒以内分块，开启后产出即预览片（引擎固定 8 步二次采样，无视质量档位），成片用 refineFrom 传该预览的 jobId 直接精修，不必重烧参数。seed 为随机种子（0 到 9007199254740991）：同种子+同提示词产物逐字节一致（实测），重 roll 保住满意镜头、只改一处参数时复用它。takes 为候选条数（1–8）：一次提交连出 N 条候选、各带 jobId，带 seed 时候选种子逐条 +1 整批可复现——动作戏/多人镜头这类高废片率镜头直接 takes:3 比生成后重派省排队。partPrompts 为长镜逐块描述（条数必须等于 planVideo 的 blocks 数）：每块演自己那段剧情而不是重播整段。" },
      { name: "generateAudio", mediaType: "audio", enabled: permissions.allowAudio, label: "生成音频", parameters: audioGenerationSchema, description: "根据文本或提示词和可选的工作区参考图片和音频生成音频。按模型能力设置音色、语速、音量、语种、采样率和格式。" },
    ] as const).filter(operation => operation.enabled);
    if (!generationTools.length) return [];
    const listTool: ToolDefinition = {
      name: "listMediaModels",
      label: "查询媒体模型",
      description: "查询已允许生成的媒体模型，返回 providerId、modelId、类型、模式及支持的画幅、时长、分辨率或音色。生成前先查询，不能猜测模型 ID。",
      parameters: z.toJSONSchema(listMediaModelsSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        listMediaModelsSchema.parse(params);
        signal?.throwIfAborted();
        const result = (await media.listModels()).filter(model => generationTools.some(operation => operation.mediaType === model.type));
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    };
    const extraTools: ToolDefinition[] = [];
    // 预检与视觉问答是宿主可选能力（本机引擎供应商实现）；没有就不注册，agent 面保持干净。
    if (media.planVideo) extraTools.push({
      name: "planVideo",
      label: "预检视频计划",
      description: "提交前预检一条视频生成请求（不创建任务、不占队列）：返回实际几何（宽高/帧数/秒数）与分块计划 chainPlan.blocks——每块是一次生成分块，partPrompts 要拆几条就看 blocks 数；warnings 含引擎的试验性提示。长镜（≥30 秒）逐块写剧情前必须先跑本工具拿块数。入参与 generateVideo 完全同形。",
      promptSnippet: "30 秒以上的镜头先用 planVideo 拿 blocks 数，再按块拆 partPrompts。",
      parameters: z.toJSONSchema(planVideoSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        const parsed = planVideoSchema.parse(params);
        signal?.throwIfAborted();
        const result = await media.planVideo!(parsed, signal);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    });
    if (media.askVlm) extraTools.push({
      name: "askVlm",
      label: "视觉模型问答",
      description: "问本机视觉模型看图/看视频（引擎自动采样帧），用于生成后自动质检：画面有没有字幕水印、人物服装颜色是否如提示词、镜头运动方向等。questions 1–8 条，每条可带工作区图片 images（≤16）或 video 一个；全任务素材合计 ≤24。format=json 让模型按 JSON 回答便于程序判断。返回 answers 与 questions 一一对应。素材 path 为工作区相对路径。",
      promptSnippet: "镜头生成完成后用 askVlm 自动质检（字幕/颜色/运镜方向），不合格提示重拍而不是直接交给用户验收。",
      parameters: z.toJSONSchema(askVlmSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const parsed = askVlmSchema.parse(params);
        signal?.throwIfAborted();
        const result = await media.askVlm!(parsed, signal);
        return { content: [{ type: "text", text: JSON.stringify(result.answers) }], details: result };
      },
    });
    return [listTool, ...extraTools, ...generationTools.map<ToolDefinition>(operation => ({
      name: operation.name,
      label: operation.label,
      description: `${operation.description}providerId 和 modelId 必须来自 listMediaModels。引用素材的 path 及 outputDirectory 均为工作区相对路径；省略输出目录使用默认媒体目录。等待生成完成后返回已保存的文件路径，不返回 Base64。`,
      promptSnippet: "生成媒体前先查询 listMediaModels，复用实际模型和工作区参考素材。",
      parameters: z.toJSONSchema(operation.parameters, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await media[operation.name](operation.parameters.parse(params), signal);
        const text = result.map(asset => {
          const url = asset.path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
          const preview = asset.mediaType === "image" ? `![生成图片](<${url}>)` : `[${asset.mediaType === "audio" ? "播放生成音频" : "查看生成视频"}](<${url}>)`;
          // ACT: jobId 必须进文本通道——只放 details 时 agent 看不见（同 planOperator 审计 F1），
          // 直生分镜就无法把任务号回写进 attempts，下一镜 continuity="context" 断链。
          return `${preview}\n工作区文件：${asset.path}${asset.jobId ? `\n任务号（jobId，续接/回写用）：${asset.jobId}` : ""}`;
        }).join("\n\n");
        return { content: [{ type: "text", text }], details: result };
      },
    }))];
  },
};

export default plugin;
