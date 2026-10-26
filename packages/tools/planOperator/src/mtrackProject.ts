/**
 * 多轨工程（plan/story.mtrack）的容错读取口径。
 * 纯函数，不碰磁盘；字段与枚举以 packages/ext/multitrack/src/mtrackProject.ts 为准。
 *
 * 为什么在本包内复制一份而不是 import：多轨编辑器是独立的 ext 包（不在本工具依赖里），
 * 本工具只依赖 zod，不能为读一个类型新增依赖。这里只保留「读要容错」所需的最小归一，
 * 写（mtrackUpdate）不经过本文件的归一，直接在原始 JSON 上 patch，避免丢字段。
 */

/** H3 官方六段提示词（段名与顺序逐字对齐 ref-en.txt，camelCase 落盘），与 packages/nodeShared/src/mtrack/mtrackProject.ts 的 ClipPrompt 同形。 */
export interface MtrackClipPrompt {
  subjectDefinitions: string;
  summary: string;
  retentionAnalysis: string;
  detailedDescription: string;
  overallSoundscape: string;
  nonDiegeticMusic: string;
}

export interface MtrackClipAttempt {
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
  prompt: MtrackClipPrompt;
  referenceIds: string[];
  continuity: string;
  /** 任务模式（可选，缺省由参考数量推断）：与 nodeShared 的 ClipMode 同值。 */
  mode?: "ref" | "image" | "text";
  status: string;
  nodeId: string | null;
  assetPath: string | null;
  attempts: MtrackClipAttempt[];
  notes?: string;
  /** 本镜系统提示词（可选）：非空时派工替换 global.systemPrompt；与 notes（纯备注）无关。 */
  systemPromptOverride?: string;
}

export interface MtrackProject {
  version?: number;
  /** 跨文件对账标识（非显示名，不参与生成）。 */
  projectId?: string;
  /** 项目显示名（additive 可选字段，缺失即留空）。 */
  name?: string;
  updatedAt: string;
  global: { ratio?: string; style?: string; systemPrompt?: string; model?: { providerId?: string; modelId?: string } };
  clips: MtrackClip[];
}

export const clipStatuses = ["pending", "generating", "generated", "accepted", "failed"] as const;
export const clipIdPattern = /^S\d{3}$/;
export const defaultProjectPath = "plan/story.mtrack";
export const defaultAssetCardsPath = "assets/assetCards.md";
export const defaultIndexPath = "plan/assetIndex.json";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readPrompt(value: unknown): MtrackClipPrompt {
  const source = isRecord(value) ? value : {};
  // H3 六段：缺字段一律按空字符串补齐，与 nodeShared/mtrackProject 的 ClipPrompt 口径一致。
  return {
    subjectDefinitions: readString(source.subjectDefinitions),
    summary: readString(source.summary),
    retentionAnalysis: readString(source.retentionAnalysis),
    detailedDescription: readString(source.detailedDescription),
    overallSoundscape: readString(source.overallSoundscape),
    nonDiegeticMusic: readString(source.nonDiegeticMusic),
  };
}

function readAttempts(value: unknown): MtrackClipAttempt[] {
  return Array.isArray(value) ? value.filter(isRecord).map(item => ({
    at: readString(item.at),
    nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
    status: readString(item.status),
    ...(typeof item.error === "string" ? { error: item.error } : {}),
  })) : [];
}

/** 读容错：真实编辑器写出的工程缺字段也能读，缺字段按默认值补齐，未知字段不参与归一。 */
export function normalizeProject(value: unknown): MtrackProject {
  const source = isRecord(value) ? value : {};
  const global = isRecord(source.global) ? source.global : {};
  const model = isRecord(global.model) ? global.model : undefined;
  const clips = Array.isArray(source.clips) ? source.clips : [];
  return {
    version: readNumber(source.version, 1),
    projectId: readString(source.projectId),
    // ACT: name / systemPromptOverride 是 additive 可选字段，白名单透传；缺失不猜、不带键。
    ...(typeof source.name === "string" ? { name: source.name } : {}),
    updatedAt: readString(source.updatedAt, new Date(0).toISOString()),
    global: {
      ...(typeof global.ratio === "string" ? { ratio: global.ratio } : {}),
      ...(typeof global.style === "string" ? { style: global.style } : {}),
      ...(typeof global.systemPrompt === "string" ? { systemPrompt: global.systemPrompt } : {}),
      ...(model ? {
        model: {
          ...(typeof model.providerId === "string" ? { providerId: model.providerId } : {}),
          ...(typeof model.modelId === "string" ? { modelId: model.modelId } : {}),
        },
      } : {}),
    },
    clips: clips.filter(isRecord).map((item, index) => ({
      clipId: readString(item.clipId, `S${String(index + 1).padStart(3, "0")}`),
      title: readString(item.title),
      ...(isRecord(item.sourceRange) ? {
        sourceRange: {
          fromSegment: readNumber(item.sourceRange.fromSegment, 1),
          toSegment: readNumber(item.sourceRange.toSegment, 1),
        },
      } : {}),
      seconds: readNumber(item.seconds, 5),
      ratio: readString(item.ratio, "9:16"),
      resolution: readString(item.resolution, "768P"),
      generateAudio: typeof item.generateAudio === "boolean" ? item.generateAudio : false,
      prompt: readPrompt(item.prompt),
      referenceIds: Array.isArray(item.referenceIds) ? item.referenceIds.filter(ref => typeof ref === "string") : [],
      continuity: index === 0 ? "shot" : (item.continuity === "context" || item.continuity === "continue" ? "context" : "shot"),
      // ACT: mode 是编辑器写出的真实字段，镜像归一曾经漏透传，导致 mtrackRead 读回来没有 mode（审计 F3）；
      // 非法值不猜，直接不带键，由参考数量推断。
      ...(item.mode === "ref" || item.mode === "image" || item.mode === "text" ? { mode: item.mode } : {}),
      status: readString(item.status, "pending"),
      nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
      assetPath: typeof item.assetPath === "string" ? item.assetPath : null,
      attempts: readAttempts(item.attempts),
      ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
      ...(typeof item.systemPromptOverride === "string" ? { systemPromptOverride: item.systemPromptOverride } : {}),
    })),
  };
}

/** `S007` → 7；非 `S\d{3}` 返回 NaN。 */
export function clipNumber(clipId: string): number {
  return clipIdPattern.test(clipId) ? Number(clipId.slice(1)) : Number.NaN;
}

/**
 * 按含端点的 [from, to] 截取：按编号区间过滤，天然保持文件内原始顺序（不做编号重排）。
 * 返回未命中的编号清单，交给调用方决定是提示还是报错。
 */
export function sliceClips(clips: MtrackClip[], from: string, to: string) {
  const start = clipNumber(from);
  const end = clipNumber(to);
  const present = new Set(clips.map(clip => clip.clipId));
  const missing: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const clipId = `S${String(index).padStart(3, "0")}`;
    if (!present.has(clipId)) missing.push(clipId);
  }
  return {
    clips: clips.filter(clip => {
      const number = clipNumber(clip.clipId);
      return Number.isFinite(number) && number >= start && number <= end;
    }),
    missing,
  };
}
