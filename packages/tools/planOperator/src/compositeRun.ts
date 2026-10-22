/**
 * M4 合成执行段：把 `planComposite` 产出的清单经宿主 ffmpeg 拼接成片。
 * 工具（src/index.ts 的 composite execute=true）与 server 的 /api/mtrack/composite 共用这一条路径，
 * 避免 concat / ffprobe / 拒绝覆盖三处判定各写一份后漂移。
 *
 * 纪律：
 *  - 输出已存在直接拒，不自动重命名、不覆盖；
 *  - 输出目录必须已存在，本模块不创建目录；
 *  - 先逐段 ffprobe 实测，规格不一致挡在编码之前；
 *  - 宿主能力（ffmpeg）由调用方注入，本模块不探测安装状态、不 import 平台相关实现。
 */

import { executeRemoteFfmpeg } from "@toonflow/ffmpeg/remote";
import type { FfmpegFactory } from "@toonflow/ffmpeg/types";
import type { PlanStore } from "./indexStore";
import { verifySegmentSpecs, type CompositePlan, type ProbeData, type SpecWarning } from "./composite";

/** 合成清单固定落在工作区 plan/composite.json：多轨编辑器与节点都按此路径读取成片信息。 */
export const compositeManifestPath = "plan/composite.json";

/** 合成成片默认输出路径。 */
export const defaultCompositeOutputPath = "plan/composite.mp4";

/**
 * 宿主注入：工作目录 + 取得 ffmpeg 工厂。
 * 工厂延迟到「输出已存在 / 目录不存在」检查通过后再调用，保持这两条业务错误优先于「缺 ffmpeg」。
 */
export interface CompositeHost {
  cwd: string;
  ffmpeg: (signal?: AbortSignal) => Promise<FfmpegFactory>;
}

export interface CompositeConcatResult {
  output: string;
  specWarnings: SpecWarning[];
  details: unknown;
}

/**
 * 执行段：逐段 input 后 concat 到 output。
 * 不自动重命名输出、不创建目录、不覆盖已有文件——这些都在调用前显式拒绝。
 */
export async function concatComposite(
  store: PlanStore,
  plan: CompositePlan,
  output: string,
  host: CompositeHost,
  signal?: AbortSignal,
): Promise<CompositeConcatResult> {
  if (await store.exists(output)) {
    throw new Error(`合成输出已存在：${output}。不自动覆盖，请换一个输出路径或确认后手动删除该文件`);
  }
  // 输出目录必须已存在：不创建目录，避免把输出落到意料之外的位置。
  const outputDir = output.slice(0, Math.max(output.lastIndexOf("/"), output.lastIndexOf("\\")));
  if (outputDir && !(await store.exists(outputDir))) {
    throw new Error(`合成输出目录不存在：${outputDir}。请先创建目录再合成`);
  }
  const ffmpeg = await host.ffmpeg(signal);
  // 先实测再编码：规格不一致时挡住，避免白跑一遍长编码才在 concat 处失败。
  const specWarnings = await verifySegmentSpecs(assetPath => probeMedia(ffmpeg, host.cwd, assetPath, signal), plan.segments);
  let details: unknown;
  let error: Error | undefined;
  let filenames: unknown;
  signal?.throwIfAborted();
  await executeRemoteFfmpeg(ffmpeg, {
    directory: host.cwd,
    requestId: crypto.randomUUID(),
    options: {},
    calls: plan.segments.map(segment => ({ method: "input", args: [segment.assetPath] })),
    operation: { method: "concat", args: [output] },
  }, event => {
    if (event.event === "error") {
      const failure = event.args[0] as { message?: string };
      error = Object.assign(new Error(failure.message ?? "合成失败"), failure);
    } else if (event.event === "result") details = event.args[0];
    else if (event.event === "filenames") filenames = event.args[0];
    else if (event.event === "end") details = { stdout: event.args[0], stderr: event.args[1], ...(filenames ? { filenames } : {}) };
  }, signal ?? new AbortController().signal);
  signal?.throwIfAborted();
  if (error) throw error;
  return { output, specWarnings, details };
}

/**
 * 经宿主 ffmpeg 的 ffprobe 查询单段媒体规格：input 该路径后走 queryMethods 的 ffprobe，
 * 探测结果从 result 事件取。探测失败（文件损坏、不是视频、ffprobe 报错）直接抛，不降级成 warning。
 */
async function probeMedia(ffmpeg: FfmpegFactory, cwd: string, assetPath: string, signal?: AbortSignal): Promise<ProbeData> {
  return await new Promise<ProbeData>((resolve, reject) => {
    void executeRemoteFfmpeg(ffmpeg, {
      directory: cwd,
      requestId: crypto.randomUUID(),
      options: {},
      calls: [{ method: "input", args: [assetPath] }],
      operation: { method: "ffprobe", args: [] },
    }, event => {
      if (event.event === "error") {
        const failure = event.args[0] as { message?: string };
        reject(Object.assign(new Error(`无法探测合成片段规格：${assetPath}（${failure.message ?? "ffprobe 失败"}）`), failure));
      } else if (event.event === "result") {
        resolve((event.args[0] ?? {}) as ProbeData);
      }
    }, signal ?? new AbortController().signal);
  });
}
