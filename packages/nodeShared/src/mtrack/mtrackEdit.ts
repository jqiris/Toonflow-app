/** 多轨工程编辑内核：对工程做批量纯函数编辑，禁止 import vue / 磁盘 API。 */

import type { MtrackClip, MtrackProject } from "./mtrackProject";
import { ratioOptions, resolutionOptions, nextClipId, createClip, cloneClips } from "./mtrackProject";

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
  if (clip.referenceIds.length > 4) {
    issues.push("图片参考上限 4 个（V8）");
  }
  if (clip.continuity !== "start" && clip.continuity !== "continue" && clip.continuity !== "cut") {
    issues.push(`衔接方式 ${clip.continuity} 需为 start/continue/cut`);
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
