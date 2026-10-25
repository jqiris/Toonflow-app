import { resolve } from "node:path";
import { readFile, writeAtomic } from "@toonflow/file";
import type { GeneratedMedia, MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { error, errorFromCause, success, type ApiResponse } from "@/lib/responseFormat";
import { generateMedia } from "@/utils/media/generation";

type MediaTask = {
  cwd: string;
  controller: AbortController;
  touchedAt: number;
  settledAt?: number;
  result?: ApiResponse<GeneratedMedia[]>;
};

/*
 * ACT: 结果保留时长从 5 分钟放大到 24 小时，并落盘到数据目录。
 * 原实现只活在内存里：用户关页/合盖超过「完成 +5 分钟」或服务重启后回来，对账读到 404，
 * 镜被退回 pending，而成片其实已在磁盘上（审计 t28-P0-1，会导致重复付费生成）。
 */
const settledTtl = 24 * 60 * 60 * 1000;
const persistPath = `${process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data")}/mediaTasks.json`;

// ACT: 单进程任务表；结束后结果仍留在内存，同时镜像一份到磁盘供重启后对账。
const tasks = new Map<string, MediaTask>();
type SettledTask = { cwd: string; settledAt: number; result: ApiResponse<GeneratedMedia[]> };
const settled = new Map<string, SettledTask>();

function loadSettled() {
  return readFile(persistPath, "utf8")
    .then(text => {
      const parsed = JSON.parse(text) as [string, SettledTask][];
      const now = Date.now();
      for (const [taskId, task] of parsed) {
        if (task?.settledAt && task.settledAt + settledTtl > now) settled.set(taskId, task);
      }
    })
    .catch(() => {
      // 首次启动没有这个文件，或内容坏掉：当作空表，不影响生成。
    });
}
void loadSettled();

function persistSettled() {
  void writeAtomic(persistPath, JSON.stringify([...settled])).catch(() => {
    // ACT: 落盘失败只影响重启后的对账，不影响本次生成；下一次结算会再次尝试。
  });
}

function stop(task: MediaTask, message: string) {
  if (task.result) return;
  task.result = error<GeneratedMedia[]>(message, null, 499);
  task.controller.abort(new Error(message));
}

function cleanup() {
  const now = Date.now();
  for (const [taskId, task] of tasks) {
    if (task.settledAt !== undefined) {
      if (task.settledAt + settledTtl <= now) tasks.delete(taskId);
    // ACT: 原为 120s——单镜实测常超 5 分钟，关标签/合盖/定时器冻结就会把已付费任务停掉（审计 P1-2）。
    // 放宽到 30 分钟后，页面断开仍让供应商跑完；结果在 settledAt 后再留 24 小时（settledTtl），重开页面经 attempts 里的 taskId 可对账找回。
    } else if (task.touchedAt + 1800000 <= now) stop(task, "生成任务因页面长时间未连接而停止");
  }
  // ACT: settled 表原来只进不出：常驻进程内存与 mediaTasks.json 随任务周龄膨胀。过期项同轮删除，删除发生时落盘一次。
  let removed = false;
  for (const [taskId, task] of settled) {
    if (task.settledAt + settledTtl <= now) {
      settled.delete(taskId);
      removed = true;
    }
  }
  if (removed) persistSettled();
}

const cleanupTimer = setInterval(cleanup, 30000);
cleanupTimer.unref();

export function start(cwd: string, taskId: string, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest) {
  cleanup();
  if (tasks.has(taskId) || settled.has(taskId)) throw Object.assign(new Error("生成任务已存在，请勿重复提交"), { status: 409 });
  // ACT: 最多 1000 个任务；取消后仍等待生成 Promise 收尾，避免忽略取消的供应商绕过上限。
  if (tasks.size >= 1000) throw Object.assign(new Error("生成任务过多，请稍后重试"), { status: 429 });
  const task: MediaTask = { cwd, controller: new AbortController(), touchedAt: Date.now() };
  tasks.set(taskId, task);
  void generateMedia(cwd, mediaType, request, task.controller.signal).then(
    files => { task.result ??= success(files); },
    cause => { task.result ??= { ...errorFromCause(cause), data: null }; },
  ).finally(() => {
    task.settledAt = Date.now();
    if (task.result) {
      settled.set(taskId, { cwd, settledAt: task.settledAt, result: task.result });
      persistSettled();
    }
  });
}

export function status(cwd: string, taskIds: string[]) {
  cleanup();
  return taskIds.map(taskId => {
    const task = tasks.get(taskId);
    if (!task) {
      // 服务重启后内存表为空，但结算结果已落盘：照样把成片路径还给编辑器，避免重复付费生成。
      const saved = settled.get(taskId);
      if (saved && saved.cwd === cwd && saved.settledAt + settledTtl > Date.now()) return { taskId, result: saved.result };
      return { taskId, result: error<GeneratedMedia[]>("生成任务不存在或已过期", null, 404) };
    }
    if (task.cwd !== cwd) return { taskId, result: error<GeneratedMedia[]>("生成任务不存在或已过期", null, 404) };
    task.touchedAt = Date.now();
    return { taskId, ...(task.result ? { result: task.result } : {}) };
  });
}

export function cancel(cwd: string, taskIds: string[]) {
  for (const taskId of taskIds) {
    const task = tasks.get(taskId);
    if (task?.cwd === cwd) stop(task, "生成已取消");
  }
}
