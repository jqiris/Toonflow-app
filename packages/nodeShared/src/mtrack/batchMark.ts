import type { ClipAttempt, MtrackClip } from "./mtrackProject";

/**
 * 批次归属判据：`attempts[].error` 写 `batch:<批次号>`（同一批次发起/成功/失败共用，失败为 `batch:<批次号> <原文>`）。
 * `ClipAttempt` 只有 { at, nodeId, status, error? } 四个字段，没有也不要新增 batchId 字段（runbook §十四）。
 */
export function batchMarker(batchId: string): string {
  return `batch:${batchId}`;
}

/** 取某镜头属于该批次的 attempts。必须是「等值或前缀」匹配，禁用 includes，否则 `batch:ab` 会命中 `batch:abc`。 */
export function attemptsOfBatch(clip: MtrackClip, batchId: string): ClipAttempt[] {
  if (!batchId) return [];
  const marker = batchMarker(batchId);
  return clip.attempts.filter((attempt) => Boolean(attempt.error) && (attempt.error === marker || attempt.error!.startsWith(`${marker} `)));
}
