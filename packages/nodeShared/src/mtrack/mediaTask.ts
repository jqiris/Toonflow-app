/**
 * 服务端媒体任务的提交与轮询：`POST /api/ai/media/generate` 带 taskId 发起、`tasks/status` 轮询。
 *
 * ACT: 单镜生成本机实测 5 分钟以上，远超 nodeTools 单次 120 秒上限，所以一律
 * 「提交立即返回 + 轮询 + 可取消」三段式：提交拿 taskId，编辑器自己按节奏轮询，
 * 结果写回 `story.mtrack`。整条链路不建画布节点、不依赖画布是否激活。
 */

import type { ClipGenerationRequest } from "./mediaDispatch";

export type MediaTaskResult = { path: string; mimeType: string; mediaType: string; jobId?: string };
export type MediaTaskStatus =
  | { state: "running" }
  | { state: "succeeded"; files: MediaTaskResult[] }
  | { state: "failed"; error: string }
  | { state: "cancelled" }
  // ACT: 服务端已没有这个任务（重启/过期）——不是「生成失败」，调用方应退回 pending 让用户重派。
  | { state: "lost"; error: string };

type ApiResponse<T> = { code?: number; data?: T; message?: string };

const pollDelay = 4000;
// ACT: 单镜最长等 1 小时（H3 长镜头会分块），超时只结束本轮等待，不撤销供应商任务。
const pollLimit = 60 * 60 * 1000;

async function request<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => undefined) as ApiResponse<T> | undefined;
  if (!response.ok || !payload?.data) {
    // ACT: 服务端把 zod 明细放在 data.issues、message 恒为「参数错误」；只读 message 会让用户看不到到底哪个字段错（审计 P2）。
    const detail = payload?.data === undefined ? "" : `：${JSON.stringify(payload.data).slice(0, 500)}`;
    throw new Error(`${payload?.message || `请求失败（HTTP ${response.status}）`}${detail}`);
  }
  return payload.data;
}

/** 提交一个镜头：返回 taskId，生成本身在服务端后台推进。 */
export async function submitClipTask(directory: string, clip: ClipGenerationRequest, taskId: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    await request<{ taskId: string }>("/api/ai/media/generate", {
      directory,
      mediaType: "video",
      taskId,
      providerId: clip.providerId,
      modelId: clip.modelId,
      prompt: clip.prompt,
      // ACT: 引擎任务名用镜头编号拼「分镜-S001-时间戳」，不占用参考图通道。
      label: clip.clipId,
      images: clip.images,
      audios: clip.audios,
      videos: clip.videos,
      // 首帧（mode=image 的单图）必须原样带给服务端，否则引擎只收到 references、首帧语义丢失。
      ...(clip.firstFrame ? { firstFrame: clip.firstFrame } : {}),
      ...(clip.continueFrom ? { continueFrom: clip.continueFrom } : {}),
      ratio: clip.ratio,
      resolution: clip.resolution,
      duration: clip.duration,
      generateAudio: clip.generateAudio,
      mode: clip.mode,
      outputDirectory: clip.outputDirectory,
    }, controller.signal);
  } finally {
    // ACT: 提交结束后注销转发监听：整批共用同一个 AbortSignal，不摘会随镜数累积。
    signal?.removeEventListener("abort", forwardAbort);
  }
  return taskId;
}

/** 读一次任务状态；任务还没结束就没有 data 里的 result。 */
export async function readClipTask(directory: string, taskId: string, signal: AbortSignal): Promise<MediaTaskStatus> {
  const list = await request<{ taskId: string; result?: ApiResponse<MediaTaskResult[]> }[]>("/api/ai/media/tasks/status", {
    directory,
    taskIds: [taskId],
  }, signal);
  const entry = list?.find(item => item.taskId === taskId);
  if (!entry?.result) return { state: "running" };
  const result = entry.result;
  if (result.code === 499) return { state: "cancelled" };
  if (result.code === 404) return { state: "lost", error: result.message || "生成任务不存在或已过期" };
  if (!result.data) return { state: "failed", error: result.message || "生成失败" };
  return { state: "succeeded", files: result.data };
}

/**
 * 请求取消在途任务；返回是否成功。失败必须让调用方知道：
 * 服务端任务可能仍在跑，把镜写回 pending 会让用户重派后双份计费（审计 t25-P1-1）。
 */
export async function cancelClipTasks(directory: string, taskIds: string[], signal?: AbortSignal): Promise<boolean> {
  if (!taskIds.length) return true;
  try {
    await request<unknown>("/api/ai/media/tasks/cancel", { directory, taskIds: [...new Set(taskIds)] }, signal ?? new AbortController().signal);
    return true;
  } catch {
    return false;
  }
}

/** 轮询到终态；aborted 由 signal 抛出，不吞掉。 */
export async function waitClipTask(directory: string, taskId: string, signal: AbortSignal) {
  const startedAt = Date.now();
  while (true) {
    signal.throwIfAborted();
    const status = await readClipTask(directory, taskId, signal);
    if (status.state !== "running") return status;
    if (Date.now() - startedAt > pollLimit) return { state: "failed", error: "等待生成结果超时（1 小时）" } as const;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, pollDelay);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
