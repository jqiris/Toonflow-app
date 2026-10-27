/** 多轨工程编辑内核：对工程做批量纯函数编辑，禁止 import vue / 磁盘 API。 */

import type { MtrackClip, MtrackProject } from "./mtrackProject";
import { ratioOptions, resolutionOptions, videoQualityValues, nextClipId, createClip, cloneClips, normalizeContinuityOrder } from "./mtrackProject";

/**
 * 编辑操作。定位一律用 clipId（after 为锚点片段编号），不用可能漂移的裸索引；
 * move.to 例外，是移动完成后的绝对目标位置（0 基索引），契约要求「绝对位置语义」。
 */
export type EditOp =
  | { type: "add"; clipId?: string; after?: string; patch?: Partial<MtrackClip> }
  | { type: "patch"; clipId: string; patch: Partial<MtrackClip> }
  | { type: "duplicate"; clipId: string }
  | { type: "move"; clipId: string; to?: number; after?: string }
  | { type: "remove"; clipId: string }
  | { type: "setGlobal"; ratio?: string; style?: string; systemPrompt?: string; model?: { providerId?: string; modelId?: string } };

export interface EditResult {
  applied: boolean;
  issues: string[];
}

const clipIdPattern = /^S\d{3}$/;

interface EditDraft {
  clips: MtrackClip[];
  global: MtrackProject["global"];
}

function indexOfClip(clips: MtrackClip[], clipId: string): number {
  return clips.findIndex(clip => clip.clipId === clipId);
}

/** prompt 三字段浅合并，其余字段整值覆盖——对齐编辑器 onPatch。 */
function mergePatch(clip: MtrackClip, patch: Partial<MtrackClip>): MtrackClip {
  return { ...clip, ...patch, prompt: { ...clip.prompt, ...(patch.prompt ?? {}) } };
}

/** 校验单个片段的字段约束，返回问题列表（空即通过）。跨片段的编号唯一性由批量与 validateProject 拦截。 */
export function validateClip(clip: MtrackClip): string[] {
  const issues: string[] = [];
  if (!clipIdPattern.test(clip.clipId)) {
    issues.push(`片段编号 ${clip.clipId} 需符合 ^S\\d{3}$`);
  }
  if (!Number.isInteger(clip.seconds) || clip.seconds < 2 || clip.seconds > 60) {
    issues.push(`时长 ${clip.seconds} 秒需为 2–60 的整数`);
  }
  if (!(ratioOptions as readonly string[]).includes(clip.ratio)) {
    issues.push(`画幅 ${clip.ratio} 不在可选范围内`);
  }
  if (!(resolutionOptions as readonly string[]).includes(clip.resolution)) {
    issues.push(`分辨率 ${clip.resolution} 不在可选范围内`);
  }
  if (new Set(clip.referenceIds).size !== clip.referenceIds.length) {
    issues.push("参考集合含重复项");
  }
  // MiniMax H3 Ref2VA 独立镜头最多支持 9 张参考图
  if (clip.referenceIds.length > 9) {
    issues.push("图片参考上限 9 个（V8，MiniMax H3 独立镜）");
  }
  if (clip.continuity !== "shot" && clip.continuity !== "context") {
    issues.push(`衔接方式 ${clip.continuity} 需为 shot（独立起拍 / 切镜）或 context（承接上一镜）`);
  }
  // ACT: 续接镜的参考图上限是 3 张（引擎 continue_from 契约），比独立镜头的 9 张更紧，
  // 在这里提前拦下，避免等到派工才失败。
  if (clip.continuity === "context" && clip.referenceIds.length > 3) {
    issues.push(`承接上一镜的镜头最多 3 张参考图（引擎限制），当前 ${clip.referenceIds.length} 张；请减少参考或改为独立起拍`);
  }
  // ACT: 续接镜时长下限是 10 秒（引擎原文：Each continued part must be at least 10 seconds），
  // 独立镜头 2 秒即可。这里提前拦下，不让用户等到派工才看到 422。
  if (clip.continuity === "context" && clip.seconds < 10) {
    issues.push(`承接上一镜的镜头最短 10 秒（引擎限制），当前 ${clip.seconds} 秒；请加长本镜或改为独立起拍`);
  }
  // ACT: 质量/二次采样/先出预览是引擎真实支持的请求参数；两条引擎硬约束在这里提前拦下，
  // 不让用户等到派工才看到失败（与上面的续接参考/时长同口径）。
  if (!(videoQualityValues as readonly string[]).includes(clip.quality)) {
    issues.push(`质量 ${clip.quality} 不在可选范围内（轻量/标准/精细/极致）`);
  }
  if (clip.continuity === "context" && clip.quality !== "light" && clip.quality !== "medium") {
    issues.push(`承接上一镜的镜头只能用轻量/标准质量（引擎限制：续接任务是 two-pass），请改为轻量或标准`);
  }
  if (clip.continuity === "context" && !clip.secondPass) {
    issues.push(`承接上一镜的镜头必须开启二次采样（引擎限制），请开启二次采样`);
  }
  if (clip.preview && (clip.continuity === "context" || clip.seconds >= 30)) {
    issues.push(`先出预览只支持单个 30 秒以内、不承接上一镜的镜头（引擎限制），当前${clip.continuity === "context" ? "是承接上一镜" : `时长 ${clip.seconds} 秒`}；请关闭先出预览`);
  }
  return issues;
}

/** 单个操作就地改草稿，返回问题列表（空即成功）；任一非空由上层整批丢弃。 */
function applyOp(draft: EditDraft, op: EditOp): string[] {
  switch (op.type) {
    case "add": {
      let insertAt: number;
      if (op.after !== undefined) {
        const anchor = indexOfClip(draft.clips, op.after);
        if (anchor < 0) return [`插入锚点 ${op.after} 不存在`];
        insertAt = anchor + 1;
      } else {
        insertAt = draft.clips.length;
      }
      const base = createClip(insertAt, draft.global.ratio ?? "9:16");
      if (op.clipId !== undefined) {
        if (!clipIdPattern.test(op.clipId)) return [`片段编号 ${op.clipId} 需符合 ^S\\d{3}$`];
        if (indexOfClip(draft.clips, op.clipId) >= 0) return [`片段编号 ${op.clipId} 已被占用`];
        base.clipId = op.clipId;
      } else {
        base.clipId = nextClipId(draft.clips);
      }
      const clip = op.patch ? mergePatch(base, op.patch) : base;
      // ACT: add 的编号只由 clipId/nextClipId 决定，忽略 patch.clipId，避免入参自相矛盾。上限：不借 patch 改编号，改名请走 patch 操作。
      clip.clipId = base.clipId;
      const issues = validateClip(clip);
      if (issues.length) return issues;
      draft.clips.splice(insertAt, 0, clip);
      return [];
    }
    case "patch": {
      const index = indexOfClip(draft.clips, op.clipId);
      if (index < 0) return [`片段 ${op.clipId} 不存在`];
      const merged = mergePatch(draft.clips[index], op.patch);
      if (merged.clipId !== op.clipId) {
        if (!clipIdPattern.test(merged.clipId)) return [`片段编号 ${merged.clipId} 需符合 ^S\\d{3}$`];
        if (indexOfClip(draft.clips, merged.clipId) >= 0) return [`片段编号 ${merged.clipId} 已被占用`];
      }
      const issues = validateClip(merged);
      if (issues.length) return issues;
      draft.clips[index] = merged;
      return [];
    }
    case "duplicate": {
      const index = indexOfClip(draft.clips, op.clipId);
      if (index < 0) return [`片段 ${op.clipId} 不存在`];
      const copy = cloneClips([draft.clips[index]])[0];
      copy.clipId = nextClipId(draft.clips);
      copy.status = "pending";
      copy.nodeId = null;
      copy.assetPath = null;
      copy.attempts = [];
      draft.clips.splice(index + 1, 0, copy);
      return [];
    }
    case "move": {
      const index = indexOfClip(draft.clips, op.clipId);
      if (index < 0) return [`片段 ${op.clipId} 不存在`];
      const [item] = draft.clips.splice(index, 1);
      if (op.to !== undefined) {
        if (op.to < 0 || op.to > draft.clips.length) return [`移动目标位置 ${op.to} 越界`];
        draft.clips.splice(op.to, 0, item);
      } else if (op.after !== undefined) {
        const anchor = indexOfClip(draft.clips, op.after);
        if (anchor < 0) return [`移动锚点 ${op.after} 不存在`];
        draft.clips.splice(anchor + 1, 0, item);
      } else {
        return ["move 需提供 to 或 after"];
      }
      return [];
    }
    case "remove": {
      const index = indexOfClip(draft.clips, op.clipId);
      if (index < 0) return [`片段 ${op.clipId} 不存在`];
      draft.clips.splice(index, 1);
      return [];
    }
    case "setGlobal": {
      // ACT: 只覆盖传入键，对齐 onGlobalPatch；全片字段不做枚举校验（沿用编辑器的宽松写入）。
      if (op.ratio !== undefined) draft.global.ratio = op.ratio;
      if (op.style !== undefined) draft.global.style = op.style;
      if (op.systemPrompt !== undefined) draft.global.systemPrompt = op.systemPrompt;
      if (op.model !== undefined) draft.global.model = op.model;
      return [];
    }
  }
}

/**
 * 批量应用编辑：整批先在草稿克隆上顺序累加，任一操作失败即丢弃草稿、不落地；
 * 全部成功才把结果写回 project.clips / project.global。编辑不动 updatedAt（保存链负责刷新）。
 */
export function applyClipOperations(project: MtrackProject, ops: EditOp[]): EditResult {
  const draft: EditDraft = { clips: cloneClips(project.clips), global: { ...project.global } };
  for (const op of ops) {
    const issues = applyOp(draft, op);
    if (issues.length) return { applied: false, issues };
  }
  // ACT: 删除首镜 / 把承接镜移到最前之后，新首镜必须回到 shot，否则存下去就是非法工程（与读盘归一同口径）。
  normalizeContinuityOrder(draft.clips);
  project.clips = draft.clips;
  project.global = draft.global;
  return { applied: true, issues: [] };
}

/** 全量校验工程的片段：编号唯一 + 每段字段约束。 */
export function validateProject(project: MtrackProject): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const clip of project.clips) {
    if (seen.has(clip.clipId)) issues.push(`片段编号 ${clip.clipId} 重复`);
    seen.add(clip.clipId);
    for (const issue of validateClip(clip)) issues.push(`${clip.clipId}：${issue}`);
  }
  return issues;
}
