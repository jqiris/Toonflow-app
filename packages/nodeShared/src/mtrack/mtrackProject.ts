/** 多轨工程文件（plan/story.mtrack，JSON 内容）的本地类型与纯函数。 */

export type ClipStatus = "pending" | "generating" | "generated" | "accepted" | "failed";
export type Continuity = "start" | "continue" | "cut";
export const ratioOptions = ["9:16", "16:9", "1:1", "4:3", "3:4"] as const;
export type Ratio = typeof ratioOptions[number];
export const resolutionOptions = ["768P", "2K"] as const;
export type Resolution = typeof resolutionOptions[number];

export interface ClipPrompt {
  integratedMultimodalDescription: string;
  overallSoundscape: string;
  nonDiegeticMusic: string;
}

export interface ClipAttempt {
  at: string;
  nodeId: string | null;
  status: string;
  error?: string;
}

export interface MtrackClip {
  clipId: string;
  title: string;
  sourceRange?: { fromSegment?: number; toSegment?: number };
  seconds: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  prompt: ClipPrompt;
  referenceIds: string[];
  continuity: string;
  status: ClipStatus;
  nodeId: string | null;
  assetPath: string | null;
  attempts: ClipAttempt[];
  notes?: string;
}

export interface MtrackProject {
  version?: number;
  projectId?: string;
  updatedAt: string;
  global: { ratio?: string; style?: string; systemPrompt?: string; model?: { providerId?: string; modelId?: string } };
  clips: MtrackClip[];
}

export interface AssetIndexCard {
  id: string;
  name?: string;
  kind?: string;
  textOnly?: boolean;
  nodeId?: string | null;
}

export interface AssetIndex {
  version?: string;
  cards?: AssetIndexCard[];
}

export interface AssetFinding {
  rule: string;
  level: "error" | "warning";
  message: string;
  ref?: string;
}

export interface AssetReport {
  generatedAt?: string;
  errors?: number;
  warnings?: number;
  findings?: AssetFinding[];
}

/** 编辑器内核的文件能力子集：文档面板扩展传 context.files，画布节点传工作区文件包装。 */
export interface EditorFiles {
  readJson<T>(path: string): Promise<T>;
  /** 第三个参数为 true 时只允许新建，目标已存在则失败；新建工程用它避免覆盖已有文件。 */
  writeJson(path: string, data: unknown, exclusive?: boolean): Promise<void>;
  acquireUrl(path: string, mimeType?: string): { url: Promise<string>; release(): void };
  /** 建单层目录；不提供时视为宿主会自动创建父目录。 */
  mkdir?(path: string): Promise<void>;
}

export const clipStatusLabels: Record<ClipStatus, string> = {
  pending: "待生成",
  generating: "生成中",
  generated: "已生成",
  accepted: "已验收",
  failed: "失败",
};

/** 默认工程路径：自定义 .mtrack 扩展名，宿主按最后一段后缀关联。 */
export const defaultProjectPath = "plan/story.mtrack";
export const assetIndexPath = "plan/assetIndex.json";
export const assetReportPath = "plan/assetReport.json";
/** 轨道条每秒像素宽度。 */
export const pixelsPerSecond = 26;

/** 工程里的时间统一是 ISO 串，展示前一律本地化；无值回落到占位文案，不把原始串摊到界面上。 */
export function localizeTime(value: string, fallback = ""): string {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStatus(value: unknown): ClipStatus {
  return value === "generating" || value === "generated" || value === "accepted" || value === "failed" ? value : "pending";
}

function readPrompt(value: unknown): ClipPrompt {
  const source = isRecord(value) ? value : {};
  return {
    integratedMultimodalDescription: readString(source.integratedMultimodalDescription),
    overallSoundscape: readString(source.overallSoundscape),
    nonDiegeticMusic: readString(source.nonDiegeticMusic),
  };
}

function readAttempts(value: unknown): ClipAttempt[] {
  return Array.isArray(value) ? value.filter(isRecord).map(item => ({
    at: readString(item.at),
    nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
    status: readString(item.status),
    ...(typeof item.error === "string" ? { error: item.error } : {}),
  })) : [];
}

/** 读取的工程仅做容错归一，不在此处重算契约语义；缺字段按默认值补齐以便编辑。 */
export function normalizeProject(value: unknown): MtrackProject {
  const source = isRecord(value) ? value : {};
  const global = isRecord(source.global) ? source.global : {};
  const model = isRecord(global.model) ? global.model : undefined;
  const clips = Array.isArray(source.clips) ? source.clips : [];
  return {
    version: readNumber(source.version, 1),
    projectId: readString(source.projectId),
    // 缺 updatedAt 时留空串而不是 epoch：页头据此显示「尚未保存」，CAS 比较两边都是空串也不会误判冲突。
    updatedAt: readString(source.updatedAt),
    global: {
      ...(typeof global.ratio === "string" ? { ratio: global.ratio } : {}),
      ...(typeof global.style === "string" ? { style: global.style } : {}),
      ...(typeof global.systemPrompt === "string" ? { systemPrompt: global.systemPrompt } : {}),
      ...(model ? { model: { ...(typeof model.providerId === "string" ? { providerId: model.providerId } : {}), ...(typeof model.modelId === "string" ? { modelId: model.modelId } : {}) } } : {}),
    },
    clips: clips.filter(isRecord).map((item, index) => ({
      clipId: readString(item.clipId, `S${String(index + 1).padStart(3, "0")}`),
      title: readString(item.title),
      ...(isRecord(item.sourceRange) ? { sourceRange: { fromSegment: readNumber(item.sourceRange.fromSegment, 1), toSegment: readNumber(item.sourceRange.toSegment, 1) } } : {}),
      seconds: readNumber(item.seconds, 5),
      ratio: readString(item.ratio, "9:16"),
      resolution: readString(item.resolution, "768P"),
      generateAudio: readBoolean(item.generateAudio, false),
      prompt: readPrompt(item.prompt),
      referenceIds: Array.isArray(item.referenceIds) ? item.referenceIds.filter(ref => typeof ref === "string") : [],
      continuity: readString(item.continuity, index === 0 ? "start" : "cut"),
      status: readStatus(item.status),
      nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
      assetPath: typeof item.assetPath === "string" ? item.assetPath : null,
      attempts: readAttempts(item.attempts),
      ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
    })),
  };
}

/** 按 S\d{3}规则分配下一个未占用编号。 */
export function nextClipId(clips: MtrackClip[]): string {
  const used = new Set(clips.map(clip => clip.clipId));
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `S${String(index).padStart(3, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return `S${String(clips.length + 1).padStart(3, "0")}`;
}

export function createClip(index: number, ratio: string): MtrackClip {
  return {
    clipId: `S${String(index + 1).padStart(3, "0")}`,
    title: "",
    seconds: 5,
    ratio,
    resolution: "768P",
    generateAudio: false,
    prompt: { integratedMultimodalDescription: "", overallSoundscape: "", nonDiegeticMusic: "" },
    referenceIds: [],
    continuity: index === 0 ? "start" : "cut",
    status: "pending",
    nodeId: null,
    assetPath: null,
    attempts: [],
  };
}

export function totalSeconds(clips: MtrackClip[]): number {
  return clips.reduce((sum, clip) => sum + (Number.isFinite(clip.seconds) ? clip.seconds : 0), 0);
}

/** 该镜是否已有可用提示词。与 directDispatch.buildPrompt 同口径：三个提示词字段取第一个非空。 */
export function hasPrompt(clip: MtrackClip): boolean {
  const prompt = clip.prompt;
  return Boolean((prompt?.integratedMultimodalDescription || prompt?.overallSoundscape || prompt?.nonDiegeticMusic || "").trim());
}

/** 删除后的撤销栈只保留一份快照，遵循最小实现。 */
export function cloneClips(clips: MtrackClip[]): MtrackClip[] {
  return clips.map(clip => ({ ...clip, prompt: { ...clip.prompt }, referenceIds: [...clip.referenceIds], attempts: [...clip.attempts] }));
}

/** 一次成功生成的节点标识：一个 clip 的 attempts 里同一个 nodeId 可能对应多轮（暂停后续跑沿用同一 batchId），按 nodeId 去重即历史成片版本。 */
export function clipVersionNodes(clip: MtrackClip | undefined): string[] {
  if (!clip?.attempts.length) return [];
  const nodes: string[] = [];
  for (const attempt of clip.attempts) {
    if (attempt.status !== "succeeded" || !attempt.nodeId) continue;
    if (!nodes.includes(attempt.nodeId)) nodes.push(attempt.nodeId);
  }
  return nodes;
}
