/**
 * M4 合成导出：从 `plan/story.mtrack` 生成合成清单（`plan/composite.json`），
 * 执行段在同目录 compositeRun.ts，经宿主 ffmpeg 完成 concat。
 *
 * 纪律：
 *  - 只取 `status === "accepted"` 的片段，按工程文件内的原始顺序（即合成顺序）；
 *  - 复用 `validatePlan` 的 V14 判定（合成清单只含 accepted 且连续无空洞），不重写规则；
 *  - 拼接前每段 `assetPath` 必须真实可读（读盘统一走 PlanStore）；
 *  - execute 前逐段 ffprobe 实测规格，落盘文件与工程声明不一致时挡在调用 ffmpeg 之前；
 *  - 本模块只做清单与判定，宿主能力（ffmpeg）由调用方注入。
 */

import { validatePlan } from "./planValidator";
import type { MultitrackClip } from "./planValidator";
import type { PlanStore } from "./indexStore";
import { normalizeProject, type MtrackClip } from "./mtrackProject";

/** 合成源工程默认路径（多轨编辑器默认写 plan/story.mtrack），与 mtrackProject 保持同一常量。 */
export { defaultProjectPath } from "./mtrackProject";
/** 宿主侧实现清单读写的存储接口（路径均为工作区相对），服务器与工具共用同一形状。 */
export type { PlanStore } from "./indexStore";

/** 合成清单里单段的规格快照（R6：规格不一时由上层给出提示） */
export interface CompositeSegment {
  clipId: string;
  ratio: string;
  resolution: string;
  seconds: number;
  assetPath: string;
}

/** 合成清单结构（写入 `plan/composite.json`） */
export interface CompositeManifest {
  version: 1;
  source: string;
  output: string;
  executed: boolean;
  segments: CompositeSegment[];
}

export interface SpecWarning {
  clipId: string;
  message: string;
}

export interface CompositePlan {
  manifest: CompositeManifest;
  segments: CompositeSegment[];
  specWarnings: SpecWarning[];
}

/** ffprobe 原始探测结果：只取与 concat 有关的字段，多出来的字段忽略。 */
export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string | number;
  channels?: number;
}

export interface ProbeData {
  streams?: ProbeStream[];
  format?: { duration?: string | number };
}

/** 探测回调：宿主 ffmpeg 的 ffprobe，由调用方注入（本模块不 import ffmpeg 桥接）。 */
export type SegmentProber = (assetPath: string) => Promise<ProbeData>;

/** concat 前必须同尺寸同帧率，这里只比对工程声明的 ratio/resolution 与时长 */
function checkSpecs(segments: CompositeSegment[]): SpecWarning[] {
  const warnings: SpecWarning[] = [];
  const first = segments[0];
  if (!first || segments.length < 2) return warnings;
  for (const segment of segments.slice(1)) {
    if (segment.ratio !== first.ratio || segment.resolution !== first.resolution) {
      warnings.push({
        clipId: segment.clipId,
        message: `规格与首段 ${first.clipId} 不一致：ratio ${segment.ratio}/${first.ratio}，resolution ${segment.resolution}/${first.resolution}；concat 前须确认两段同尺寸同帧率，否则 ffmpeg 会失败`,
      });
    }
  }
  return warnings;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** "24/1" → 24；"0/0" 与缺值返回 undefined。 */
function parseFps(value: unknown): number | undefined {
  const text = typeof value === "string" ? value : "";
  if (!text.includes("/")) return toNumber(value);
  const [numerator, denominator] = text.split("/").map(Number);
  if (!numerator || !denominator) return undefined;
  return numerator / denominator;
}

/**
 * 单段实测规格签名。concat 滤镜要求所有段同尺寸、同帧率、同像素格式、同音轨参数，
 * 任何一项不同都会让 ffmpeg 直接失败或产出错乱成片，所以在调用前先比对一个紧凑签名。
 */
function probeSignature(data: ProbeData): string | undefined {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find(stream => stream.codec_type === "video");
  if (!video) return undefined;
  const fps = parseFps(video.r_frame_rate) ?? parseFps(video.avg_frame_rate);
  const parts = [`${video.width ?? "?"}x${video.height ?? "?"}`, `${fps ?? "?"}fps`, video.pix_fmt ?? "?"];
  const audio = streams.find(stream => stream.codec_type === "audio");
  parts.push(audio ? `audio ${audio.codec_name ?? "?"} ${audio.sample_rate ?? "?"}Hz ${audio.channels ?? "?"}ch` : "no-audio");
  return parts.join(" ");
}

/** 声明时长与实测时长允许的偏差：MiniMax-H3 按每秒出片，实测会因帧率整除出现零点几秒余量。 */
const durationTolerance = 1;

/**
 * execute=true 前逐段 ffprobe 实测：规格与首段不一致（concat 必失败或成片错乱）直接 throw，
 * 声明 `seconds` 与实测时长差超过容差记 warning（不拦执行，交人工判断）。
 * 探测本身失败（ffprobe 报错、文件不是视频）就是 error——不把「没测成」当成「测过」。
 */
export async function verifySegmentSpecs(probe: SegmentProber, segments: CompositeSegment[]): Promise<SpecWarning[]> {
  const warnings: SpecWarning[] = [];
  const signatures: { clipId: string; signature: string }[] = [];
  for (const segment of segments) {
    const data = await probe(segment.assetPath);
    const signature = probeSignature(data);
    if (!signature) throw new Error(`探测不到视频流：${segment.clipId}（${segment.assetPath}）。文件可能损坏，或不是视频文件`);
    const first = signatures[0];
    if (first && signature !== first.signature) {
      throw new Error(`合成片段规格不一致，concat 会失败或产出错乱成片：${first.clipId} 为 ${first.signature}，${segment.clipId} 为 ${signature}。请先生成同规格片段再合成`);
    }
    signatures.push({ clipId: segment.clipId, signature });
    const duration = toNumber(data.format?.duration);
    if (duration !== undefined && Math.abs(duration - segment.seconds) > durationTolerance) {
      warnings.push({
        clipId: segment.clipId,
        message: `工程声明 seconds=${segment.seconds}，实测时长 ${duration.toFixed(3)}s，相差超过 ${durationTolerance}s；请核对 story.mtrack 的声明与真实产出`,
      });
    }
  }
  return warnings;
}

function toSegment(clip: MtrackClip): CompositeSegment {
  return {
    clipId: clip.clipId,
    ratio: clip.ratio,
    resolution: clip.resolution,
    seconds: clip.seconds,
    assetPath: clip.assetPath ?? "",
  };
}

/**
 * 读工程 → 取 accepted 段 → V14 复核 → assetPath 可读复核。
 * 所有不满足均 throw new Error，不吞错、不降级。
 */
export async function planComposite(store: PlanStore, projectPath: string, output: string): Promise<CompositePlan> {
  if (!(await store.exists(projectPath))) {
    throw new Error(`多轨工程不存在：${projectPath}（先用 mtrackRead 确认路径）`);
  }
  const raw = await store.readText(projectPath);
  let project: { clips?: unknown };
  try {
    project = JSON.parse(raw);
  } catch (error) {
    throw new Error(`多轨工程不是合法 JSON：${projectPath}（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (!project || !Array.isArray(project.clips)) {
    throw new Error(`多轨工程缺少 clips[]：${projectPath}`);
  }
  const { clips } = normalizeProject(project);

  const accepted = clips.filter(clip => clip.status === "accepted");
  if (accepted.length === 0) {
    throw new Error("没有 accepted 片段可合成：请先在多轨编辑器里把要合成的片段验收为 accepted");
  }

  // V14 复核：只含 accepted 镜、按 clipId 排序后连续无空洞。复用校验器同一判定。
  const v14 = validatePlan({ mtrack: { clips: accepted as unknown as MultitrackClip[] } })
    .filter(finding => finding.rule === "V14" && finding.level === "error");
  if (v14.length > 0) {
    const detail = v14.map(finding => finding.message).join("；");
    throw new Error(`合成清单顺序不连续（V14）：${detail}。断点需在多轨文件里补齐或去掉空洞后再合成`);
  }
  const segments = accepted.map(toSegment);

  const unreadable: string[] = [];
  for (const segment of segments) {
    if (!segment.assetPath) {
      unreadable.push(`${segment.clipId}（assetPath 为空）`);
      continue;
    }
    if (!(await store.exists(segment.assetPath))) {
      unreadable.push(`${segment.clipId}（${segment.assetPath}）`);
    }
  }
  if (unreadable.length > 0) {
    throw new Error(`合成片段文件不可读，无法合成：${unreadable.join("、")}。assetPath 必须指向真实可读的产出文件`);
  }

  return {
    manifest: { version: 1, source: projectPath, output, executed: false, segments },
    segments,
    specWarnings: checkSpecs(segments),
  };
}
