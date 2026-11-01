import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@form-create/element-ui";
import type { FfmpegFactory } from "@toonflow/ffmpeg/types";
import type { Stats } from "@toonflow/file";
import { z } from "zod";

export type { ToolDefinition } from "@earendil-works/pi-coding-agent";
export type { FfmpegFactory, FfmpegCommand, FfprobeData } from "@toonflow/ffmpeg/types";

export const asrRequestSchema = z.strictObject({
  path: z.string().min(1).max(4096).refine(path => !/^(?:[\\/]|[a-z][a-z\d+.-]*:)/i.test(path)
    && !path.replaceAll("\\", "/").split("/").includes(".."), "音频路径必须位于工作区内"),
  lang: z.string().min(1).max(100).optional(),
});

export const toolNameSchema = z.string().max(96).regex(/^[a-z][a-zA-Z0-9]*$/);
export const toolMetadataSchema = z.object({
  name: toolNameSchema,
  version: z.string().trim().min(1).max(100).default(""),
  displayName: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  prompt: z.string().max(20000).default(""),
  readme: z.string().max(200000).default(""),
  components: z.array(z.string().max(96).regex(/^[a-z][a-zA-Z0-9_]*$/)).max(100)
    .refine(names => new Set(names).size === names.length, "工具组件名称不能重复").default([]),
  author: z.string().max(100),
  github: z.string().refine(value => !value || (URL.canParse(value) && new URL(value).origin === "https://github.com" && !new URL(value).username && !new URL(value).password)),
  configRules: z.array(z.record(z.string(), z.json())).max(100),
});

export interface ToolMetadata {
  name: string;
  version?: string;
  displayName: string;
  description: string;
  prompt?: string;
  readme?: string;
  components?: string[];
  author: string;
  github: string;
  configRules: Rule[];
}

export interface NodeToolInfo {
  nodeId: string;
  name: `node:${string}`;
  nodeLabel?: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NodeToolCall {
  nodeId: string;
  name: `node:${string}`;
  args: Record<string, unknown>;
}

export interface NodeToolsContext {
  readonly tools: NodeToolInfo[];
  readonly version: number;
  list(nodeIds: string[], names?: string[]): IterableIterator<NodeToolInfo>;
  call(request: NodeToolCall, signal?: AbortSignal): Promise<unknown>;
}

export interface CanvasToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface CanvasInfo {
  id: string;
  tools: NodeToolInfo[];
}

export interface CanvasContext extends CanvasInfo {
  getNodeLabel?(nodeId: string): string | undefined;
  call(request: CanvasToolCall, signal?: AbortSignal): Promise<unknown>;
}

export interface MediaModel {
  supportsPrice?: boolean;
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  type: "image" | "video" | "audio";
  mode?: unknown;
  imageSizes?: string[];
  imageRatios?: string[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  audio?: boolean | "optional";
  voices?: { title: string; voice: string }[];
}

export interface MediaReference {
  path: string;
  mimeType: string;
}

export interface MediaGenerationRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  /** 引擎侧任务名的可读标签（资产/镜头代号，如 `C01`、`S001`）；只用内容、不需要任务名的供应商可忽略。 */
  label?: string;
  outputDirectory?: string;
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  firstFrame?: MediaReference;
  lastFrame?: MediaReference;
  /**
   * 续接上一镜：传供应商侧任务号（FreeVideo 形如 `j` + 12 位十六进制），
   * 由引擎加载该任务的原生音视频上下文继续生成。
   * 续接时只允许 references 类媒体，firstFrame/lastFrame 必须留空。
   */
  continueFrom?: string;
  ratio?: string;
  size?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  /** 生成质量档位（如 FreeVideo 的 light/medium/high/max）；供应商按模型能力校验，未传时走供应商默认。 */
  quality?: string;
  /** 是否开启二次采样（引擎的二次细化采样）；未传时走供应商默认。 */
  secondPass?: boolean;
  /** 是否开启快速预览模式（引擎只跑预览片，成片需另发 refine 任务）；未传时走供应商默认。 */
  preview?: boolean;
  /** 随机种子；未传时由供应商/引擎决定。重 roll 保种子是跨重试一致性的复现锚点。 */
  seed?: number;
  /** 本任务完成后立即释放显存/内存中的视频模型；只对批次最后一个任务置 true。 */
  releaseGpuAfter?: boolean;
  /** 一次提交连出 N 条候选（引擎 takes 1–8）；结果按条返回，各带自己的 jobId。 */
  takes?: number;
  /** 预览转正片：传预览任务 jobId，引擎从预览直接精修；设置后其余生成参数忽略（引擎互斥约束）。 */
  refineFrom?: string;
  /** 长镜分块的逐块描述（条数=POST /plan 的 blocks 数，≤5）；省略由引擎自动切分提示词。 */
  partPrompts?: string[];
  /** 白模参考（3D blocking）：library 为引擎作品号，earlySteps 为它只引导采样的前 K 步（1–32）。 */
  whitebox?: { library: string; earlySteps: number };
  voice?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  format?: string;
  sampleRate?: number;
  mode?: "singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text"
    | (`${"image" | "video" | "audio"}Reference:${number}`)[];
}

export interface GeneratedMedia {
  path: string;
  mimeType: string;
  mediaType: "image" | "video" | "audio";
  /**
   * 供应商任务号（FreeVideo 形如 `j` + 12 hex）。多轨续接要用它作
   * `continue_from.from_job` 精确接上一镜；不参与落盘，只随结果回传。
   */
  jobId?: string;
}

export interface MediaContext {
  listModels(): Promise<MediaModel[]>;
  generateImage(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  generateVideo(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  generateAudio(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  /**
   * 提交前预检（可选能力，本机引擎供应商实现）：返回该请求的分块计划与实际几何。
   * chainPlan.blocks 数 = partPrompts 应拆的条数。供应商不支持时抛错。
   */
  planVideo?(request: MediaGenerationRequest, signal?: AbortSignal): Promise<{
    geometry: { width: number; height: number; seconds: number; frames: number; fps: number };
    chainPlan: { seconds: number; single: boolean; blocks: { seconds: number; frames: number }[] };
    warnings: string[];
  }>;
  /**
   * 本机视觉模型问答（可选能力）：对图片/视频（自动采样帧）提问，answers 与 questions 一一对应。
   * 素材引用工作区相对路径（与生成请求的 MediaReference 同口径）。供应商不支持时抛错。
   */
  askVlm?(input: {
    providerId: string;
    modelId?: string;
    questions: (string | { text: string; images?: MediaReference[]; video?: MediaReference })[];
    system?: string;
    format?: "text" | "json";
    label?: string;
  }, signal?: AbortSignal): Promise<{ answers: unknown[] }>;
}

export interface QuestionField {
  field: string;
  title: string;
  type: "input" | "textarea" | "radio" | "checkbox" | "select" | "inputNumber" | "switch";
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface QuestionRequest {
  title: string;
  question: string;
  options?: string[];
  fields?: QuestionField[];
}

export interface QuestionAnswer {
  answer: string;
  values?: Record<string, string | number | boolean | string[]>;
  skipped?: boolean;
}

export type ToolCall = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "success" | "error" | "interrupted";
  result?: string;
  question?: QuestionRequest & { callId: string };
};

export interface QuestionContext {
  ask(toolCallId: string, request: QuestionRequest, signal?: AbortSignal): Promise<QuestionAnswer>;
}

export type SkillScope = "workspace" | "global";
export type SkillLocation = { name: string; scope?: SkillScope; path?: string };
export type SkillDocument = { name: string; scope: SkillScope; path: string; content: string };

export interface SkillContext {
  list(scope?: SkillScope): { name: string; description: string; scope: SkillScope; filePath: string; disableModelInvocation: boolean }[];
  read(request: SkillLocation, signal?: AbortSignal): Promise<SkillDocument>;
  create(request: SkillLocation & { content: string }, signal?: AbortSignal): Promise<Omit<SkillDocument, "content">>;
  update(request: SkillLocation & { content: string }, signal?: AbortSignal): Promise<Omit<SkillDocument, "content">>;
}

export interface ToolFiles {
  readFile(path: string, readOnly?: boolean): Promise<Buffer>;
  access(path: string, readOnly?: boolean): Promise<void>;
  stat(path: string, readOnly?: boolean): Promise<Stats>;
  readdir(path: string, readOnly?: boolean): Promise<string[]>;
  detectImageMimeType(path: string, readOnly?: boolean): Promise<string | null>;
  writeFile(path: string, content: string | Uint8Array, exclusive?: boolean): Promise<void>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  rename(path: string, target: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  copyFile(path: string, target: string, exclusive?: boolean): Promise<void>;
  importImage(url: string): Promise<{ path: string; mimeType: string }>;
}

export interface ToolContext {
  asr: {
    transcribe(path: string, options?: { lang?: string; signal?: AbortSignal }): Promise<string>;
  };
  assets?: { execute: ToolDefinition["execute"] };
  browser?: {
    execute(sessionId: string, args: Record<string, unknown>, config: Record<string, unknown>, signal?: AbortSignal,
      onUpdate?: Parameters<ToolDefinition["execute"]>[3]): ReturnType<ToolDefinition["execute"]>;
  };
  ffmpeg(signal?: AbortSignal): Promise<FfmpegFactory>;
  media?: MediaContext;
  canvas?: CanvasContext;
  question?: QuestionContext;
  skills?: SkillContext;
  /**
   * 当前 agent 会话正在使用的文本模型（宿主读会话文件解析，跨进程一致）。
   * agent 触发的文本模型调用（白模场景代码、3D 导演台生成等）默认用它，
   * 不要再自己去挑「设置里第一个模型」——那可能与用户当前选择不符或撞限流。
   * 独立进程/无会话上下文（如 MCP 直连、UI 面板按钮）时为 undefined，调用方回落到自身默认。
   */
  sessionModel?: { providerId: string; modelId: string };
  cwd: string;
  config: Record<string, unknown>;
  files: ToolFiles;
  resolvePath(path: string, readOnly?: boolean): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  sdk: Pick<typeof import("@earendil-works/pi-coding-agent"),
    "defineTool" | "createReadToolDefinition" | "createWriteToolDefinition" |
    "createEditToolDefinition" | "createLsToolDefinition" | "detectSupportedImageMimeTypeFromFile">;
}

export interface ToolPlugin {
  validateConfig(config: Record<string, unknown>): Record<string, unknown>;
  createTools(context: ToolContext): ToolDefinition[] | Promise<ToolDefinition[]>;
}
