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

/** H3 官方六段提示词（段名与顺序逐字对齐 ref-en.txt「Overall Structure」，camelCase 落盘）。 */
export interface ClipPrompt {
  subjectDefinitions: string;
  summary: string;
  retentionAnalysis: string;
  detailedDescription: string;
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

/**
 * 该镜可用于续接的任务号：优先取当前默认版本那条成功记录（承接的来源是成片里那一版），没有本版本
 * 记录时才回退最后一次成功尝试（旧工程只有 nodeId 记录时靠它）。本版本记录在但没留 jobId，说明任务号
 * 未知，直接返回空串让派工报错——不能拿别的版本的任务号顶上，那会静默承接错片子。
 */
export function continuationJobId(clip: MtrackClip | undefined): string {
  if (!clip) return "";
  const key = clip.assetPath || clip.nodeId || "";
  if (key) {
    const own = clip.attempts.findLast(attempt => attempt.status === "succeeded" && (attempt.assetPath || attempt.nodeId || "") === key);
    if (own) return own.jobId ?? "";
  }
  return clip.attempts.findLast(attempt => attempt.status === "succeeded" && attempt.jobId)?.jobId ?? "";
}

/** FreeVideo 质量四档；与 freevideo provider 侧 quality 枚举、videoGenerationNode 同口径。 */
export const videoQualityValues = ["light", "medium", "high", "max"] as const;
export type VideoQuality = (typeof videoQualityValues)[number];
/** 引擎默认档（light = 8 首轮 + 3 refine 两遍生成，首轮半尺寸）。 */
export const defaultVideoQuality: VideoQuality = "light";
export const videoQualityLabels: Record<VideoQuality, string> = {
  light: "轻量",
  medium: "标准",
  high: "精细",
  max: "极致",
};

export interface MtrackClip {
  clipId: string;
  title: string;
  sourceRange?: { fromSegment?: number; toSegment?: number };
  seconds: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  /** 质量档位：light(轻量)/medium(标准)/high(精细)/max(极致)；引擎默认 light。 */
  quality: VideoQuality;
  /** 二次采样（two_pass）：默认开启；续接上一镜的镜头必须开启（引擎限制：续接任务是 two-pass）。 */
  secondPass: boolean;
  /** 先出预览（preview）：快速低清预览片，只支持单个 30 秒以内的独立镜头；开启后产出即预览片，不会自动精修成成片。 */
  preview: boolean;
  /**
   * 随机种子（引擎取值 0 到 2^53-1）；缺省不发给引擎、由引擎每次自定。
   * 重 roll 保种子：同 seed + 同提示词 ≈ 同结果，是跨重试复现的锚点。
   * ACT: 与 quality/secondPass/preview 同口径不进 clipSignature——它是渲染参数不是镜头身份，
   * 纳入会让旧工程升级后全片误判 stale。
   */
  seed?: number;
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
  /** 本镜系统提示词预留位：当前派工链路（composeClipRequest 不消费 global）不把本字段或 global.systemPrompt 注入视频提示词，保留是写入口/留底；与 notes（纯备注，不参与下发）无关。 */
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
  /** 基卡编号（衍生卡指向基础卡）；导入节点出图时以基卡成图作参考图并自动连线，无引用时缺省。 */
  refs?: string[];
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

/** 质量只认四档，其它取值（旧工程/手改文件）回落引擎默认 light。 */
function readQuality(value: unknown): VideoQuality {
  return videoQualityValues.includes(value as VideoQuality) ? (value as VideoQuality) : defaultVideoQuality;
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
    subjectDefinitions: readString(source.subjectDefinitions),
    summary: readString(source.summary),
    retentionAnalysis: readString(source.retentionAnalysis),
    detailedDescription: readString(source.detailedDescription),
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
      quality: readQuality(item.quality),
      secondPass: readBoolean(item.secondPass, true),
      preview: readBoolean(item.preview, false),
      // ACT: seed 是 additive 可选字段：合法整数才带，缺失/坏值即省略——不能落 0，0 是合法种子值，落 0 会把「未设置」错写成「锁定种子 0」。
      ...(typeof item.seed === "number" && Number.isInteger(item.seed) && item.seed >= 0 && item.seed <= Number.MAX_SAFE_INTEGER ? { seed: item.seed } : {}),
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
    quality: defaultVideoQuality,
    secondPass: true,
    preview: false,
    prompt: {
      subjectDefinitions: "",
      summary: "",
      retentionAnalysis: "",
      detailedDescription: "",
      overallSoundscape: "",
      nonDiegeticMusic: "",
    },
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

/**
 * 六段段名（逐字对齐 ref-en.txt「Overall Structure」，顺序固定）。字段里只存段内正文，
 * 段名由 promptToText / mediaDispatch.buildPromptText 在边界处补齐。
 */
const promptHeadings = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"] as const;
type promptField = "subjectDefinitions" | "summary" | "retentionAnalysis" | "detailedDescription" | "overallSoundscape" | "nonDiegeticMusic";
const promptFieldByHeading: Record<string, promptField> = {
  "subject_definitions:": "subjectDefinitions",
  "summary:": "summary",
  "retention_analysis:": "retentionAnalysis",
  "detailed_description:": "detailedDescription",
  "overall_soundscape:": "overallSoundscape",
  "non_diegetic_music:": "nonDiegeticMusic",
};

/** 该镜是否已有可用提示词：六段任一非空即有内容可下发。 */
export function hasPrompt(clip: MtrackClip): boolean {
  return promptValuesOf(clip.prompt).some(value => value.trim());
}

function promptValuesOf(prompt: ClipPrompt): string[] {
  return [prompt.subjectDefinitions, prompt.summary, prompt.retentionAnalysis, prompt.detailedDescription, prompt.overallSoundscape, prompt.nonDiegeticMusic];
}

/**
 * 六段提示词合成编辑器里的单个文本框内容：段名 + 段内正文，段间一个空行。
 * ACT: 空段整段省略（段名也不输出），顺序严格按 ref-en.txt 的六段顺序。
 * 上限：段名必须各占一段（行首），正文中间出现同名行会被视为段边界。
 */
export function promptToText(prompt: ClipPrompt): string {
  const pairs = promptHeadings.map((heading, index) => ({ heading, value: promptValuesOf(prompt)[index] }));
  return pairs
    .map(item => item.value.trim() ? `${item.heading} ${item.value.trim()}` : "")
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 编辑器里的单框文本拆回六段字段：行首段名各起一段，段名不进字段（字段里只写内容）。
 * ACT: 只认行首段名，正文里普通提及段名的句子不会被切开；同一字段重复出现时取最后一段，不静默丢内容；
 * 未识别的段名归入 detailedDescription（H3 主字段）。
 */
export function textToPrompt(text: string): ClipPrompt {
  const sections: Record<promptField, string[]> = {
    subjectDefinitions: [],
    summary: [],
    retentionAnalysis: [],
    detailedDescription: [],
    overallSoundscape: [],
    nonDiegeticMusic: [],
  };
  let field: promptField | "body" = "body";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = promptHeadings.find(item => trimmed.toLowerCase().startsWith(item));
    if (heading) {
      field = promptFieldByHeading[heading];
      const inline = trimmed.slice(heading.length).trim();
      if (inline) sections[field].push(inline);
      continue;
    }
    (field === "body" ? sections.detailedDescription : sections[field]).push(line);
  }
  return {
    subjectDefinitions: sections.subjectDefinitions.join("\n").trim(),
    summary: sections.summary.join("\n").trim(),
    retentionAnalysis: sections.retentionAnalysis.join("\n").trim(),
    detailedDescription: sections.detailedDescription.join("\n").trim(),
    overallSoundscape: sections.overallSoundscape.join("\n").trim(),
    nonDiegeticMusic: sections.nonDiegeticMusic.join("\n").trim(),
  };
}


/** 删除后的撤销栈只保留一份快照，遵循最小实现。 */
export function cloneClips(clips: MtrackClip[]): MtrackClip[] {
  return clips.map(clip => ({ ...clip, prompt: { ...clip.prompt }, referenceIds: [...clip.referenceIds], attempts: [...clip.attempts] }));
}

/** 真源字段：写作者/用户在编辑器里定的镜头内容，合并时以「相对基线谁改过」为准，两边都改则信磁盘。 */
const clipSourceKeys = ["title", "seconds", "ratio", "resolution", "generateAudio", "quality", "secondPass", "preview", "prompt", "referenceIds", "continuity", "mode", "notes", "systemPromptOverride", "sourceRange"] as const;
/** 生成侧字段：派工与对账写出来的运行结果，合并时优先内存（用户正看着的那份）。 */
const clipRunKeys = ["status", "nodeId", "assetPath"] as const;

/** 内容比较：undefined 与 null 视为同一档（旧工程的记录本来就可能缺字段）。 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * attempts 合并与 clips/global 同口径——按「谁相对基线改过」判方向，不做无条件并集：
 * 磁盘相对基线没变 = 内存是真源（用户在界面里清掉旧记录的场景）；内存相对基线没变 = 磁盘是真源——
 * planOperator 的 `mtrackUpdate` 是整数组替换（agent 清空 attempts 后不能被内存里的旧记录复活）。
 * 双方都改过才追加合并：磁盘顺序在前，内存新增的接在后面。
 */
function mergeAttempts(base: ClipAttempt[] | undefined, disk: ClipAttempt[] | undefined, memory: ClipAttempt[] | undefined): ClipAttempt[] {
  const diskList = disk ?? [];
  const memoryList = memory ?? [];
  if (sameJson(diskList, base ?? [])) return memoryList;
  if (sameJson(memoryList, base ?? [])) return diskList;
  const seen = new Set(diskList.map(attempt => JSON.stringify(attempt)));
  return [...diskList, ...memoryList.filter(attempt => !seen.has(JSON.stringify(attempt)))];
}

/** 单镜合并：真源字段磁盘改过就用磁盘的，否则用内存的；生成侧字段内存改过就用内存的，否则用磁盘的。 */
function mergeClip(base: MtrackClip | undefined, disk: MtrackClip, memory: MtrackClip): MtrackClip {
  const merged = { ...memory } as unknown as Record<string, unknown>;
  for (const key of clipSourceKeys) merged[key] = JSON.stringify(disk[key]) === JSON.stringify(base?.[key]) ? memory[key] : disk[key];
  for (const key of clipRunKeys) merged[key] = JSON.stringify(memory[key]) === JSON.stringify(base?.[key]) ? disk[key] : memory[key];
  return { ...(merged as unknown as MtrackClip), attempts: mergeAttempts(base?.attempts, disk.attempts, memory.attempts) };
}

/**
 * 三方合并工程：base = 上次成功保存的快照，disk = 磁盘现状，memory = 当前内存。
 *
 * ACT: 直连派工的回写是整份覆盖保存，而会话 agent 的 `planOperator mtrackUpdate`、同一个工程上的
 * 其他多轨节点都会改这份文件。检测到 updatedAt 变过时，整份覆盖会抹掉对方的改动，整轮拒写又会让
 * 刚生成的成片只活在内存里（关掉编辑器就没了）。所以按「谁相对基线改过谁赢」合并：镜头内容以磁盘
 * 为准（agent 刚写的那份），生成结果与历史版本以内存为准；attempts 与 global 同口径按基线判方向。
 * 上限：按 clipId 对齐，不做同一条镜头的字段级细粒度并发；时间线顺序以磁盘为准，内存新增的镜头附在
 * 末尾，内存里的删除/移动可能被磁盘覆盖。要更强的合并语义应改成服务端单一写者。
 */
export function mergeProjects(base: MtrackProject | null, disk: MtrackProject, memory: MtrackProject): MtrackProject {
  const baseClips = new Map((base?.clips ?? []).map(clip => [clip.clipId, clip]));
  const memoryClips = new Map(memory.clips.map(clip => [clip.clipId, clip]));
  const clips = disk.clips.map(clip => {
    const own = memoryClips.get(clip.clipId);
    if (!own) return clip;
    memoryClips.delete(clip.clipId);
    return mergeClip(baseClips.get(clip.clipId), clip, own);
  });
  for (const clip of memory.clips) if (memoryClips.has(clip.clipId)) clips.push(clip);
  const global = mergeGlobal(base?.global, disk.global, memory.global);
  // 以磁盘为底：磁盘有、内存没有的顶层字段（agent 或更新的契约写入的字段）不丢；其余顶层字段按「内存相对
  // 基线改过就用内存」——项目显示名这类字段用户可能刚改过，不能因为磁盘改的只是别的字段就被回滚。
  const merged = { ...disk, clips, global, updatedAt: memory.updatedAt ?? disk.updatedAt } as unknown as Record<string, unknown>;
  const topKeys = new Set([...Object.keys(disk), ...Object.keys(memory)]) as Set<keyof MtrackProject>;
  for (const key of topKeys) {
    if (key === "clips" || key === "global" || key === "updatedAt") continue;
    if (sameJson(memory[key], base?.[key])) continue;
    if (memory[key] === undefined) delete merged[key];
    else merged[key] = memory[key];
  }
  return merged as unknown as MtrackProject;
}

/** global 按 key 合并：磁盘只改了 style、内存只改了 ratio 时两份都要留（整块二选一会静默丢一份）。 */
function mergeGlobal(
  base: MtrackProject["global"] | undefined,
  disk: MtrackProject["global"],
  memory: MtrackProject["global"],
): MtrackProject["global"] {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(disk), ...Object.keys(memory)]) as Set<keyof MtrackProject["global"]>;
  for (const key of keys) {
    const value = sameJson(memory[key], base?.[key]) ? disk[key] : memory[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged as MtrackProject["global"];
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
 * 与 LSC signatures() 同口径——六段提示词整块进签名，参考身份单列，context 链向前累加。
 * ACT: 质量档位 / 二次采样 / 先出预览三字段故意不进签名——它们只改变渲染档位、不改变镜头身份；
 *  旧工程里已生成镜的 attempts 签名是旧格式（不含这三键），纳入会让它们在升级后全部误判成 stale（待更新），
 *  而这三字段的默认值（light + 二次采样开 + 无预览）与旧行为完全一致，属假阳性。
 *  stale 只驱动「待更新」徽标、不驱动派工（pickDispatchTargets 只看 status），少报（改质量不提示重出）
 *  比误报（整片待更新）代价低。升级路径：若将来要「改了质量就提示重出」，加回这三键并配套一次
 *  旧签名迁移（把无这三键的旧签名按缺省值补齐后再比较）。
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
/**
 * 一条尝试的版本身份：有产物路径就用它，否则旧的画布节点版本退回 nodeId；两者都没有时返回空串
 * = 不是一条可列出的版本。「列出」（succeededVersionEntries）与「删除」（deleteClipVersion）共用
 * 这一个谓词，否则会出现「文件删了条目还在」或删完默认回落到刚删文件的不一致。
 */
function versionKeyOf(attempt: ClipAttempt): string {
  if (attempt.assetPath) return attempt.assetPath;
  return attempt.status === "succeeded" ? attempt.nodeId || "" : "";
}

function succeededVersionEntries(clip: MtrackClip): ClipVersion[] {
  const versions: ClipVersion[] = [];
  for (const attempt of clip.attempts) {
    // ACT: 只要有产物路径就是一条可回溯的成片版本——状态不是 succeeded 也照样列出（关闭界面期间生成
    // 完成、取消但文件已落盘、agent 回写等）。只按状态过滤会让「当前默认」变成本镜唯一一行，切换默认后
    // 新版本就从列表里消失。
    const key = versionKeyOf(attempt);
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
 * ACT: 只动「结果簿记」——status 仅在删光最后一个成功版本时回落（accepted→generated→pending，
 * 人工验收判定优先保留、能留多高留多高）：accepted/generated 且 assetPath=null 的组合会被
 * planValidator V13 判 error 卡死「生成前 validate error 清零」，删版本后不回落就是死锁。
 * failed/generating 不回落：失败状态与本次删的是哪条版本无关；generating 由调用侧挡着删。
 */
export function deleteClipVersion(clip: MtrackClip, key: string): VersionDeletion {
  const target = clipVersions(clip).find(item => item.key === key);
  if (!target) return { clip, paths: [] };
  // 与列表同一谓词（versionKeyOf）：列得出来的版本才删得掉，删掉的条目与要删的文件一一对应，
  // 否则删掉的是「succeeded 的旧记录」、留下的却是「有 assetPath 的同键条目」，文件删了条目还在。
  const attempts = clip.attempts.filter(attempt => versionKeyOf(attempt) !== key);
  const paths = target.assetPath ? [target.assetPath] : [];
  if (key !== (clip.assetPath || clip.nodeId || "")) return { clip: settleDeletedStatus({ ...clip, attempts }), paths };
  const next = succeededVersionEntries({ ...clip, attempts }).at(-1);
  return {
    clip: settleDeletedStatus({ ...clip, attempts, assetPath: next?.assetPath ?? null, nodeId: next?.nodeId ?? null }),
    paths,
  };
}

/** 整镜全部版本删除后的同款状态回落（见 deleteClipVersion 的 ACT 注释）。 */
export function deleteAllClipVersions(clip: MtrackClip): VersionDeletion {
  const paths = clipVersions(clip).map(item => item.assetPath).filter((item): item is string => Boolean(item));
  // 与列表同一谓词：凡是被列成版本的条目（有产物路径、或是 succeeded 且有 nodeId）一律清掉，
  // 只留纯诊断记录（没有产物的失败尝试），否则删完文件列表里还挂着一行空壳。
  const attempts = clip.attempts.filter(attempt => !versionKeyOf(attempt));
  return { clip: settleDeletedStatus({ ...clip, attempts, assetPath: null, nodeId: null }), paths };
}

/** 删掉该镜最后一个成功版本后的状态回落：判据是「既没有产物指针、也没有任何可列出版本」——
 *  V13 对 generated/accepted 要求 assetPath，这个组合删光后必然卡死「生成前 validate error 清零」，
 *  所以一律落到 pending（没有成片就谈不上验收，accepted/generated 同档回落，最小语义）。
 *  仍有剩余版本（含旧画布版次只有 nodeId 的条目）或指针非空时 status 不动。 */
function settleDeletedStatus(clip: MtrackClip): MtrackClip {
  if (clip.assetPath || clip.nodeId || succeededVersionEntries(clip).length) return clip;
  if (clip.status === "accepted" || clip.status === "generated") return { ...clip, status: "pending" };
  return clip;
}
