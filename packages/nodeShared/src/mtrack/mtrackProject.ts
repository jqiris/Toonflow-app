/** 多轨工程文件（plan/story.mtrack，JSON 内容）的本地类型与纯函数。 */

export type ClipStatus = "pending" | "generating" | "generated" | "accepted" | "failed";
/**
 * 镜头衔接方式，与 LSC 多轨编辑器（ComfyUI Easy-Media `continuity_mode`）完全一致：
 * - `context`：承接上一镜的原生上下文继续生成（上一镜必成片且任务号可用），参考图仍照常生效；
 * - `shot`：独立起拍 / 有意切镜，不读取上一镜上下文。
 * 首镜强制 `shot`（没有上一镜可接）。
 */
export type Continuity = "shot" | "context";
export const continuityOptions = ["shot", "context"] as const;
export const continuityLabels: Record<Continuity, string> = {
  shot: "独立起拍 / 切镜",
  context: "承接上一镜",
};
/** 旧工程兼容：`continue` 等同于 `context`，`start`/`cut` 等同于 `shot`。 */
export function normalizeContinuity(value: unknown): Continuity {
  return value === "context" || value === "continue" ? "context" : "shot";
}

/**
 * 首镜必须独立起拍：删掉首镜、或把承接镜移到最前之后，新首镜的 `continuity` 要回落成 `shot`，
 * 否则落盘工程是非法的（生成侧按「没有上一镜可接」报错）。与 normalizeProject 的读盘归一同口径。
 */
export function normalizeContinuityOrder<T extends Pick<MtrackClip, "continuity">>(clips: T[]) {
  clips.forEach((clip, index) => {
    if (index === 0 && clip.continuity !== "shot") clip.continuity = "shot";
  });
  return clips;
}
export const ratioOptions = ["9:16", "16:9", "1:1", "4:3", "3:4"] as const;
export type Ratio = typeof ratioOptions[number];
export const resolutionOptions = ["768P", "2K"] as const;
export type Resolution = typeof resolutionOptions[number];

/**
 * 任务模式，与 LSC `task_mode` 取值完全一致（`default`/`ref`/`edit`/`l2v` 里我们只开放前两种常用形态）。
 * ACT: 用 `ref` 而不是 `reference`，是为了与引擎/ComfyUI 契约同名，避免跨层翻译。
 */
export type ClipMode = "ref" | "image" | "text";
export const clipModeLabels: Record<ClipMode, string> = {
  ref: "参考（可多图）",
  image: "首帧（仅一张图）",
  text: "纯文本",
};
/** 缺省按参考数量判定：无参考 → text，单图且声明首帧 → image，其余 → ref。 */
export function resolveClipMode(clip: Pick<MtrackClip, "mode" | "referenceIds">): ClipMode {
  if (clip.mode === "text" || clip.mode === "image" || clip.mode === "ref") return clip.mode;
  if (!clip.referenceIds.length) return "text";
  return "ref";
}

export interface ClipPrompt {
  integratedMultimodalDescription: string;
  overallSoundscape: string;
  nonDiegeticMusic: string;
}

export interface ClipAttempt {
  at: string;
  /** 本次生成尝试的画布节点号。服务端媒体任务通道不建画布节点，为空。 */
  nodeId: string | null;
  status: string;
  error?: string;
  /**
   * 供应商任务号（FreeVideo 形如 `j` + 12 hex）。续接镜头靠它引用上一镜：
   * 只有成功生成的那次尝试才有值，缺失时该镜不能被下一镜 `context` 续接。
   */
  jobId?: string;
  /** 本次尝试产出的视频相对路径；历史版本的身份就是它（见 clipVersions）。 */
  assetPath?: string;
  /** 生成时的设置签名（clipStates 口径）；旧工程的记录没有该字段，视为未记录。 */
  signature?: string;
  /** 生成时的时间线位置；旧工程的记录没有该字段，视为未记录。 */
  index?: number;
  /** 承接镜的续接来源：生成时上一镜的 continuationJobId，独立镜为空串。 */
  parentJobId?: string;
}

/** 一次成功生成的历史版本。服务端通道不建画布节点，key 就是产物路径。 */
export interface ClipVersion {
  /** 版本身份：产物路径优先，旧工程的 attempt 只有 nodeId 时回退用它。 */
  key: string;
  nodeId: string | null;
  assetPath: string | null;
}

/** 该镜可用于续接的任务号：取最后一次成功尝试的记录，没有则空串。 */
export function continuationJobId(clip: MtrackClip | undefined): string {
  if (!clip) return "";
  return clip.attempts.findLast(attempt => attempt.status === "succeeded" && attempt.jobId)?.jobId ?? "";
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
  /** `shot` | `context`；旧工程的 start/continue/cut 由 normalizeContinuity 归一。 */
  continuity: Continuity;
  /** 任务模式，缺省按参考数量推断（见 resolveClipMode）。 */
  mode?: ClipMode;
  status: ClipStatus;
  nodeId: string | null;
  assetPath: string | null;
  attempts: ClipAttempt[];
  notes?: string;
  /** 本镜系统提示词：非空时派工替换 global.systemPrompt，留空沿用全片；与 notes（纯备注，不参与下发）无关。 */
  systemPromptOverride?: string;
}

export interface MtrackProject {
  version?: number;
  /** 跨文件对账标识（编辑器/建工程处写 mtrack-<时间戳>），不是显示名，不参与生成。 */
  projectId?: string;
  /** 项目显示名（工作台与「项目与成片」浮窗头部）；additive 可选字段，缺失即留空，不从 projectId 猜测。 */
  name?: string;
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
  /** 删文件；宿主不提供时视为不支持，版本删除只清记录。 */
  remove?(path: string): Promise<void>;
  /** 写二进制（首帧截图等）；宿主不提供时视为不支持该操作。 */
  write?(path: string, content: Blob | ArrayBuffer, exclusive?: boolean): Promise<void>;
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

/** 时间码统一 mm:ss:ff（24fps），与 LSC 工具栏、标尺同格式；时长不足一秒也保留帧位。 */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.round(safe * 24);
  const totalSecondsPart = Math.floor(totalFrames / 24);
  return `${String(Math.floor(totalSecondsPart / 60)).padStart(2, "0")}:${String(totalSecondsPart % 60).padStart(2, "0")}:${String(totalFrames % 24).padStart(2, "0")}`;
}

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
    ...(typeof item.jobId === "string" ? { jobId: item.jobId } : {}),
    ...(typeof item.assetPath === "string" ? { assetPath: item.assetPath } : {}),
    ...(typeof item.signature === "string" ? { signature: item.signature } : {}),
    ...(typeof item.index === "number" ? { index: item.index } : {}),
    ...(typeof item.parentJobId === "string" ? { parentJobId: item.parentJobId } : {}),
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
    // ACT: name 是 additive 可选显示名，白名单透传；缺失即不带——不从 projectId 猜测（projectId 非 mtrack-时间戳形态时同样保持空）。
    ...(typeof source.name === "string" ? { name: source.name } : {}),
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
      // ACT: 首镜永远 shot（没有上一镜可接），其余缺省 shot；旧工程的 continue 归一为 context。
      continuity: index === 0 ? "shot" : normalizeContinuity(item.continuity),
      ...(item.mode === "ref" || item.mode === "image" || item.mode === "text" ? { mode: item.mode } : {}),
      status: readStatus(item.status),
      nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
      assetPath: typeof item.assetPath === "string" ? item.assetPath : null,
      attempts: readAttempts(item.attempts),
      ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
      ...(typeof item.systemPromptOverride === "string" ? { systemPromptOverride: item.systemPromptOverride } : {}),
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
    // 与 LSC 一致：新建镜头一律先独立起拍（首镜必须 shot），用户按需改成 context 承接上一镜。
    continuity: "shot",
    mode: "ref",
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

/** 声音两段在正文里的段名（由 buildPrompt 在 wire 层拼接，这里只用于编辑框的合成/拆分）。 */
const soundscapeHeading = "overall_soundscape:";
const musicHeading = "non_diegetic_music:";

/**
 * 三段提示词合成编辑器里的单个文本框内容：正文 + 两个声音段（带段名）。
 * ACT: 编辑器只给一个框，框内按官方六段写全文——声音段的段名由这里补，
 * 与 buildPrompt 下发时拼的段名严格同形，避免编辑器写一套、下发拼另一套。
 * 上限：段名必须各占一段（行首），正文中间出现同名行会被视为段边界。
 */
export function promptToText(prompt: ClipPrompt): string {
  return [
    prompt.integratedMultimodalDescription.trim(),
    prompt.overallSoundscape.trim() && `${soundscapeHeading} ${prompt.overallSoundscape.trim()}`,
    prompt.nonDiegeticMusic.trim() && `${musicHeading} ${prompt.nonDiegeticMusic.trim()}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * 编辑器里的单框文本拆回三段字段：行首的 `overall_soundscape:` / `non_diegetic_music:` 各起一段，
 * 其余全部归 integratedMultimodalDescription。段名不进字段（字段里只写内容）。
 * ACT: 只认行首段名，正文里普通提及段名的句子不会被切开；同一段重复出现时取最后一段，不静默丢内容。
 */
export function textToPrompt(text: string): ClipPrompt {
  const body: string[] = [];
  let soundscape = "";
  let music = "";
  let field: "body" | "soundscape" | "music" = "body";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.toLowerCase();
    if (heading.startsWith(soundscapeHeading)) {
      field = "soundscape";
      soundscape = trimmed.slice(soundscapeHeading.length).trim();
      continue;
    }
    if (heading.startsWith(musicHeading)) {
      field = "music";
      music = trimmed.slice(musicHeading.length).trim();
      continue;
    }
    if (field === "soundscape") soundscape = `${soundscape}\n${line}`.trim();
    else if (field === "music") music = `${music}\n${line}`.trim();
    else body.push(line);
  }
  return {
    integratedMultimodalDescription: body.join("\n").trim(),
    overallSoundscape: soundscape,
    nonDiegeticMusic: music,
  };
}


/** 删除后的撤销栈只保留一份快照，遵循最小实现。 */
export function cloneClips(clips: MtrackClip[]): MtrackClip[] {
  return clips.map(clip => ({ ...clip, prompt: { ...clip.prompt }, referenceIds: [...clip.referenceIds], attempts: [...clip.attempts] }));
}

/**
 * 项目与成片浮窗（画布世界层浮窗）的几何：持久化在多轨节点 `data.resultsUi` 上，
 * 与 cardWidth/cardHeight 同一套「写进节点 data、随画布自动保存」的落盘方式
 * （packages/nodes/multitrackNode/src/index.vue:112-124、:155-157）。不进 .mtrack 工程文件。
 */
export interface ResultsUiGeometry {
  /** 浮窗左上角 X，画布世界坐标（flow 坐标，不是视口像素）。 */
  x: number;
  /** 浮窗左上角 Y，画布世界坐标。 */
  y: number;
  /** 展开宽度；collapsed 时仅作还原用，显示高度走 resultsUiShownHeight。 */
  width: number;
  /** 展开高度，持久化上下限 [540, 2200]。 */
  height: number;
  /** 收起态：只显示 70px 标题条。 */
  collapsed: boolean;
}

/** 节点锚点（世界坐标）：浮窗缺省几何贴着节点右缘外侧摆放。 */
export interface ResultsUiAnchor {
  x: number;
  y: number;
  width: number;
}

/** 缺省浮窗位于节点右缘外 64px、与节点顶边平齐。 */
export const resultsUiDefaultOffsetX = 64;
export const resultsUiDefaultWidth = 900;
export const resultsUiDefaultHeight = 750;
export const resultsUiMinWidth = 540;
export const resultsUiMaxWidth = 2400;
export const resultsUiMinHeight = 540;
export const resultsUiMaxHeight = 2200;
/** 收起态高度（标题条），不参与宽高夹取。 */
export const resultsUiCollapsedHeight = 70;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 首次打开浮窗（或旧节点 data 没有 resultsUi）时的缺省几何。 */
export function defaultResultsUi(anchor: ResultsUiAnchor): ResultsUiGeometry {
  const anchorX = Number.isFinite(anchor.x) ? anchor.x : 0;
  const anchorY = Number.isFinite(anchor.y) ? anchor.y : 0;
  const anchorWidth = Number.isFinite(anchor.width) ? anchor.width : 0;
  return {
    x: anchorX + anchorWidth + resultsUiDefaultOffsetX,
    y: anchorY,
    width: resultsUiDefaultWidth,
    height: resultsUiDefaultHeight,
    collapsed: false,
  };
}

/**
 * 读 `node.data.resultsUi` 的容错归一：非法/缺失回落缺省几何，宽高一律夹取到上下限。
 * 折叠只改显示高度，height 保留展开尺寸以便还原——与 normalizeProject 同口径，只做兜底不做语义。
 */
export function normalizeResultsUi(value: unknown, anchor: ResultsUiAnchor): ResultsUiGeometry {
  const fallback = defaultResultsUi(anchor);
  const source = isRecord(value) ? value : {};
  return {
    x: readNumber(source.x, fallback.x),
    y: readNumber(source.y, fallback.y),
    width: clampNumber(readNumber(source.width, fallback.width), resultsUiMinWidth, resultsUiMaxWidth),
    height: clampNumber(readNumber(source.height, fallback.height), resultsUiMinHeight, resultsUiMaxHeight),
    collapsed: readBoolean(source.collapsed, false),
  };
}

/** 浮窗实际渲染高度：收起态固定 70，展开态用持久化 height。 */
export function resultsUiShownHeight(ui: ResultsUiGeometry): number {
  return ui.collapsed ? resultsUiCollapsedHeight : ui.height;
}

/** 键序稳定的 JSON 串：签名只要求确定性可比，不引哈希依赖。 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.keys(item).sort().reduce((out: Record<string, unknown>, key) => {
        out[key] = item[key];
        return out;
      }, {});
    }
    return item;
  });
}

/** 项目级生成设置的摘要（对齐 LSC signatures 的 config 部分）。 */
function globalSignature(global: MtrackProject["global"]): string {
  return stableJson({
    ratio: global.ratio,
    style: global.style,
    systemPrompt: global.systemPrompt,
    model: global.model,
  });
}

/**
 * 单镜生成设置签名：项目级设置 + 本镜字段 + 参考集合，承接镜再链上一镜签名。
 * 与 LSC signatures() 同口径——镜头全量进签名，参考身份单列，context 链向前累加。
 */
function clipSignature(globalSig: string, clip: MtrackClip, previous: string): string {
  return stableJson({
    global: globalSig,
    clip: {
      clipId: clip.clipId,
      title: clip.title,
      seconds: clip.seconds,
      ratio: clip.ratio,
      resolution: clip.resolution,
      generateAudio: clip.generateAudio,
      prompt: clip.prompt,
      continuity: clip.continuity,
      mode: clip.mode,
      systemPromptOverride: clip.systemPromptOverride,
    },
    references: clip.referenceIds,
    previous: clip.continuity === "context" ? previous : "",
  });
}

/**
 * 历史成片版本列表。服务端媒体任务通道不建画布节点（attempts 的 nodeId 恒为空），
 * 版本身份因此取产物路径——对齐 LSC 的 resultVersions（按 file.url 去重）。
 * 落盘名带随机后缀，路径天然唯一；attempts 序旧→新，当前默认（clip.assetPath）排在最后。
 * 旧工程的 attempt 只有 nodeId 时回退用它作键，预览走画布桥反查节点产物。
 */
function succeededVersionEntries(clip: MtrackClip): ClipVersion[] {
  const versions: ClipVersion[] = [];
  for (const attempt of clip.attempts) {
    if (attempt.status !== "succeeded") continue;
    const key = attempt.assetPath || attempt.nodeId || "";
    if (!key || versions.some(item => item.key === key)) continue;
    versions.push({ key, nodeId: attempt.nodeId, assetPath: attempt.assetPath || null });
  }
  return versions;
}

export function clipVersions(clip: MtrackClip | undefined): ClipVersion[] {
  if (!clip?.attempts?.length) return [];
  const versions = succeededVersionEntries(clip);
  const current = clip.assetPath;
  if (current && !versions.some(item => item.key === current)) {
    versions.push({ key: current, nodeId: clip.nodeId, assetPath: current });
  }
  return versions;
}

export interface ClipState {
  /** 该镜当前设置下的签名。 */
  signature: string;
  /** 最近一次成功生成时落盘的签名；空串 = 没有成功记录或旧工程未记录。 */
  recordSignature: string;
  /** 成功生成时的时间线位置；null = 没有可比的记录。 */
  recordIndex: number | null;
  /** 成功生成时的续接来源任务号。 */
  recordParentJobId: string;
  /** 历史成片是否落后于当前设置（对齐 LSC 的 stale）。 */
  stale: boolean;
}

/**
 * 全部镜头的状态，一次遍历（对齐 LSC 的 signatures() + public()）。stale 三条件：
 * 1) 签名不符——项目级设置 / 本镜设置 / 参考集合 / 上一镜签名任一变化；
 * 2) 位置变动——时间线里移动过；
 * 3) 续接来源变了——承接镜落盘时的上一镜任务号已不是上一镜当前的任务号（上一镜被重生成）。
 * 没有成片时 stale 恒 false：没有视频就谈不上「过时」。旧工程的记录没有 signature 字段，
 * 无法判断是否过时，同样视为不 stale——一旦重新生成一次，签名落盘后本判定才真正生效。
 * ACT: 签名只覆盖参考集合的增删改序，不覆盖参考素材本身换图——卡片换内容不算 stale。
 */
export function clipStates(project: MtrackProject): Record<string, ClipState> {
  const states: Record<string, ClipState> = {};
  const globalSig = globalSignature(project.global);
  let previous = "";
  for (let index = 0; index < project.clips.length; index += 1) {
    const clip = project.clips[index];
    const signature = clipSignature(globalSig, clip, previous);
    const attempt = clip.attempts.findLast(item => item.status === "succeeded");
    const parentJobId = index > 0 ? continuationJobId(project.clips[index - 1]) : "";
    let stale = false;
    if (clip.assetPath && attempt?.signature) {
      stale = attempt.signature !== signature ||
        attempt.index !== index ||
        (clip.continuity === "context" && (attempt.parentJobId ?? "") !== parentJobId);
    }
    states[clip.clipId] = {
      signature,
      recordSignature: attempt?.signature ?? "",
      recordIndex: attempt?.index ?? null,
      recordParentJobId: attempt?.parentJobId ?? "",
      stale,
    };
    previous = signature;
  }
  return states;
}

export interface VersionDeletion {
  /** 删除后的镜头副本：attempts 已移除对应成功记录，默认指针必要时回落。 */
  clip: MtrackClip;
  /** 需要删除的产物路径（工作区相对路径），由调用方执行删文件。 */
  paths: string[];
}

/**
 * 删除一个成片版本：从 attempts 移除该条成功记录，产物路径交调用方删文件。
 * 删的是当前默认版本时，默认回落到时间线上更新的版本；没有剩余版本则清空默认指针。
 * 不动 clip.status——生成状态与版本簿记是两回事，对齐 LSC「只改结果簿记」。
 */
export function deleteClipVersion(clip: MtrackClip, key: string): VersionDeletion {
  const target = clipVersions(clip).find(item => item.key === key);
  if (!target) return { clip, paths: [] };
  const attempts = clip.attempts.filter(
    attempt => !(attempt.status === "succeeded" && (attempt.assetPath || attempt.nodeId || "") === key),
  );
  const paths = target.assetPath ? [target.assetPath] : [];
  if (key !== (clip.assetPath || clip.nodeId || "")) return { clip: { ...clip, attempts }, paths };
  const next = succeededVersionEntries({ ...clip, attempts }).at(-1);
  return {
    clip: { ...clip, attempts, assetPath: next?.assetPath ?? null, nodeId: next?.nodeId ?? null },
    paths,
  };
}

/** 删除整镜的全部成片版本：清空成功记录与默认指针，产物路径交调用方删文件。 */
export function deleteAllClipVersions(clip: MtrackClip): VersionDeletion {
  const paths = clipVersions(clip).map(item => item.assetPath).filter((item): item is string => Boolean(item));
  const attempts = clip.attempts.filter(attempt => attempt.status !== "succeeded");
  return { clip: { ...clip, attempts, assetPath: null, nodeId: null }, paths };
}
