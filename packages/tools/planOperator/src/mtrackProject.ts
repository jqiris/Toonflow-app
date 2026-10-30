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
  /** 供应商任务号（续接链唯一来源）；读侧必须透传，否则 agent 查不到 jobId、回写也带不回。 */
  jobId?: string;
  /** 本次尝试产出的视频路径（历史版本身份）。 */
  assetPath?: string;
  /**
   * 生成时的设置签名（编辑器 clipStates 口径）。读侧**不产出**：它是整镜提示词的摘要、
   * context 镜还链上一镜（单条实测 ~8KB），进 mtrackRead 文本会让一次范围读膨胀 2 倍以上。
   * 保它靠 mtrackUpdate 的 upsert 合并（未传键保留盘上原值），不靠 agent 带回。
   */
  signature?: string;
  index?: number;
  parentJobId?: string;
}

export interface MtrackClip {
  clipId: string;
  title: string;
  sourceRange?: { fromSegment?: number; toSegment?: number };
  seconds: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  /** 质量档位（light/medium/high/max，缺省 light）：编辑器逐镜可设，派工经 composeClipRequest 下发到请求参数 quality。 */
  quality?: string;
  /** 二次采样（缺省 true）：承接上一镜必须开启，否则引擎拒绝。 */
  secondPass?: boolean;
  /** 先出预览（缺省 false）：只支持单个 30 秒以内、不承接上一镜的分块，开启后产出即预览片。 */
  preview?: boolean;
  /** 随机种子（0 到 2^53-1，缺省由引擎自定）：编辑器逐镜可设的重 roll 复现锚点，镜像归一透传。 */
  seed?: number;
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
  /** 本镜系统提示词（可选）：预留写入口，当前派工链路不消费（视频下发不含 global.systemPrompt 与本字段）；与 notes（纯备注）无关。 */
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
/** 质量档位枚举：与 nodeShared mtrackProject 的 videoQualityValues 保持一致（镜像透传只认这四个值）。 */
export const videoQualityValues = ["light", "medium", "high", "max"] as const;
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

function isQuality(value: unknown): value is (typeof videoQualityValues)[number] {
  return typeof value === "string" && (videoQualityValues as readonly string[]).includes(value);
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
  // ACT: 透传 jobId/assetPath/index/parentJobId（nodeShared ClipAttempt 的读侧子集）——
  // 剥掉 jobId 会让 mtrackRead 读回来看不见任务号，agent 既查不到也无法回写，续接链断。
  // signature 刻意**不透传**：它是整镜提示词摘要、context 镜链上一镜（单条实测 ~8KB），
  // 进文本会让一次范围读膨胀 2 倍以上；它的保全由 mtrackUpdate 的 upsert 合并负责（见 mergeAttempts）。
  return Array.isArray(value) ? value.filter(isRecord).map(item => ({
    at: readString(item.at),
    nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
    status: readString(item.status),
    ...(typeof item.error === "string" ? { error: item.error } : {}),
    ...(typeof item.jobId === "string" ? { jobId: item.jobId } : {}),
    ...(typeof item.assetPath === "string" ? { assetPath: item.assetPath } : {}),
    ...(typeof item.index === "number" ? { index: item.index } : {}),
    ...(typeof item.parentJobId === "string" ? { parentJobId: item.parentJobId } : {}),
  })) : [];
}

/**
 * attempts 的 upsert 合并（mtrackUpdate 用，磁盘原始对象口径，不经归一）：
 * 传入记录按 `at` 与盘上未消费记录对齐——命中则 `{...盘上, ...传入}` 合并（盘上有、传入没有的
 * 内部键如 signature 原样保留；传入显式给的键覆盖盘上值），未命中视为新尝试追加到末尾。
 * 盘上未被任何传入记录命中的记录一律保留：**本通道不再支持删除尝试记录**，
 * 删版本是编辑器 clipVersions 的活；agent 整数组回写时最坏是多出一条重复，不会误删续接链。
 * ACT: 旧语义是整数组替换，agent 看不见 signature 就必然丢 signature（stale 判定失效）、
 * 漏传一条 jobId 就断链；合并语义把"带不回的键"从 agent 责任里移除。
 * 上限：同 `at` 的盘上记录只会被消费一次（重复时间戳时第二条按新记录追加）；`at` 为空的传入记录不参与匹配、直接追加。
 */
export function mergeAttempts(diskValue: unknown, incoming: Record<string, unknown>[]): Record<string, unknown>[] {
  const disk = (Array.isArray(diskValue) ? diskValue.filter(isRecord) : []).map(item => ({ ...item }));
  const consumed = new Set<number>();
  for (const patch of incoming) {
    const at = typeof patch.at === "string" ? patch.at : "";
    const index = at ? disk.findIndex((item, position) => !consumed.has(position) && item.at === at) : -1;
    if (index >= 0) {
      consumed.add(index);
      disk[index] = { ...disk[index], ...patch };
    } else {
      disk.push({ ...patch });
    }
  }
  return disk;
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
      // ACT: quality / secondPass / preview 是编辑器逐镜可设的真实请求参数，镜像归一必须透传——
      // 漏透传会让 mtrackRead 读回来没有这三项，agent 误以为当前是默认档，回写时把用户设置覆盖掉
      //（同类坑见上方 mode 的审计 F3）。非法值不猜，直接不带键。
      ...(isQuality(item.quality) ? { quality: item.quality } : {}),
      ...(typeof item.secondPass === "boolean" ? { secondPass: item.secondPass } : {}),
      ...(typeof item.preview === "boolean" ? { preview: item.preview } : {}),
      // ACT: seed 与上面三项同理——编辑器逐镜真实请求参数，镜像归一必须透传，
      // 漏透传会让 mtrackRead 读不回种子、agent 回写时把用户锁定的种子清掉（同类坑见审计 F3）。非法值不带键。
      ...(typeof item.seed === "number" && Number.isInteger(item.seed) && item.seed >= 0 && item.seed <= Number.MAX_SAFE_INTEGER ? { seed: item.seed } : {}),
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
