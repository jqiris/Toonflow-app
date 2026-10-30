import { t, translateMessage } from "@/lib/i18n";
import { mkdir, readFile, realpath, stat, unlink } from "@toonflow/file";
import { join, relative } from "node:path";
import { mediaProviders, type Provider } from "@toonflow/providers";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaReference } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getMediaProvider, listMediaProviders, loadMediaProviderSource } from "@/utils/media/provider";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { beginGeneration, getProviderPrice } from "@/utils/media/billing";
import { detectMimeType, readPriceReference } from "@/utils/media/priceReference";

const maxMediaSize = 100 * 1024 * 1024;
const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a", "audio/opus": "opus", "audio/pcm": "pcm",
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageOptions(value: unknown, pattern: RegExp) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 64 && item === item.trim() && pattern.test(item)))] : undefined;
}

export async function listMediaModels(): Promise<MediaModel[]> {
  const installedProviders = await listMediaProviders();
  return installedProviders.flatMap(provider => provider.models.flatMap(model => {
    if (model.type !== "image" && model.type !== "video" && model.type !== "audio") return [];
    const builtIn = (mediaProviders as readonly Provider[]).find(item => item.id === provider.id)?.models.find(item => item.id === model.id);
    return [{
      providerId: provider.id, providerLabel: provider.label, modelId: model.id, label: model.label, type: model.type,
      supportsPrice: "supportsPrice" in provider && provider.supportsPrice === true,
      mode: model.mode, durationResolutionMap: model.durationResolutionMap, audio: model.audio,
      ...(model.type === "audio" ? { voices: model.voices } : {}),
      ...(model.type === "image" ? {
        imageSizes: imageOptions(Array.isArray(model.imageSizes) ? model.imageSizes : builtIn?.imageSizes, /^[^\u0000-\u001f\u007f]+$/),
        imageRatios: imageOptions(Array.isArray(model.imageRatios) ? model.imageRatios : builtIn?.imageRatios, /^[1-9]\d{0,3}:[1-9]\d{0,3}$/),
      } : {}),
    } as MediaModel];
  }));
}

export async function readReference(cwd: string, reference: MediaReference, mediaType: string, signal?: AbortSignal): Promise<Extract<MediaInput, { type: "base64" }>> {
  signal?.throwIfAborted();
  const { path } = await resolveWorkspacePath(cwd, reference.path);
  const info = await stat(path);
  if (!info.isFile() || info.size > maxMediaSize) invalid("参考媒体须为不超过 100 MB 的文件");
  const bytes = await readFile(path, { signal });
  if (!bytes.length || bytes.length > maxMediaSize) invalid("参考媒体为空或超过 100 MB");
  const mimeType = detectMimeType(bytes, reference.mimeType);
  if (!mimeType.startsWith(`${mediaType}/`)) invalid(t`参考媒体类型须为 ${mediaType}`);
  return { type: "base64", data: bytes.toString("base64"), mimeType, name: reference.path };
}

async function downloadAsset(url: string, signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(t`下载生成结果失败（HTTP ${response.status}）`);
  if (Number(response.headers.get("content-length")) > maxMediaSize) {
    await response.body?.cancel();
    invalid("生成文件不能超过 100 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) invalid("生成结果为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMediaSize) invalid("生成文件不能超过 100 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get("content-type") ?? "" };
}

async function assetBytes(asset: MediaAsset, mediaType: "image" | "video" | "audio", signal?: AbortSignal) {
  if (!asset || asset.mediaType !== mediaType) invalid("供应商返回的媒体类型不正确");
  let bytes: Uint8Array;
  let mimeType = asset.mimeType ?? "";
  if (asset.type === "url") {
    const result = await downloadAsset(asset.url, signal);
    bytes = result.bytes;
    const responseMimeType = result.mimeType.split(";")[0].trim().toLowerCase();
    mimeType = responseMimeType && responseMimeType !== "application/octet-stream" ? result.mimeType : mimeType;
  } else if (asset.type === "base64") {
    const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(asset.data);
    const content = (data?.[2] ?? asset.data).replace(/\s/g, "");
    if (content.length > Math.ceil(maxMediaSize / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) invalid("生成结果的 base64 内容无效或超过 100 MB");
    bytes = Buffer.from(content, "base64");
    mimeType = data?.[1] ?? mimeType;
  } else if (asset.type === "binary" && ArrayBuffer.isView(asset.data) && asset.data.BYTES_PER_ELEMENT === 1) {
    bytes = asset.data;
  } else { return invalid("供应商返回了无效的媒体结果"); }
  if (!bytes.byteLength || bytes.byteLength > maxMediaSize) invalid("生成文件为空或超过 100 MB");
  mimeType = detectMimeType(bytes, mimeType);
  if (!mimeType.startsWith(`${mediaType}/`) || !mediaExtensions[mimeType]) invalid("生成结果不是支持的图片、视频或音频格式");
  return { bytes, mimeType };
}

/** 节点输出目录用的是 uuid，形如标准 36 位（含 4 个短横线）时它不是代号目录。 */
const uuidNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 引擎任务名（供应商侧再拼成「参考视频-S011-时间戳」）里的代号：优先请求自带的 label，
 * 请求没带代号时从输出目录取（`assets/S011` → S011）——老客户端不带 label 也能出代号，
 * 否则任务名会退化成提示词首段那种没法辨识的文字。
 */
function labelWithCode(label: string | undefined, outputDirectory: string | undefined) {
  const codePattern = "(?:KF|SC|C|P|S)";
  const trimmed = (label ?? "").trim();
  // ACT: label 侧与目录侧同口径限 1-3 位数字（与供应商侧 jobCode 一致）——位数不限会把 `镜头 S0111`
  // 判成「已带代号」原样下发，但供应商按 1-3 位配不出，成了两不管；超位数的现在走目录提取，提不到就退回无代号口径。
  if (trimmed && new RegExp(`(?:^|[^A-Za-z0-9])${codePattern}\\d{1,3}(?![0-9])`, "i").test(trimmed)) return trimmed;
  // ACT: 代号必须落在目录段开头且后接非字母数字（`assets/S011`、`assets\S011`），并排除 uuid 目录——
  // 旧写法匹配路径里任意位置，把节点输出目录 assets/<uuid> 里以 c 开头接数字的片段也当代号（实测误拼率 2.98%）。
  // ACT: 已知上限：以代号前缀字母开头的短目录名（如 assets/s3）会被误判成代号 S3；升级方向是只认工作区约定目录（assets/、shots/）下的名字。
  let code: string | undefined;
  for (const segment of (outputDirectory ?? "").split(/[\\/]/)) {
    const name = segment.trim();
    if (!name || uuidNamePattern.test(name)) continue;
    code = new RegExp(`^(${codePattern}\\d{1,3})(?![A-Za-z0-9])`, "i").exec(name)?.[1];
    if (code) break;
  }
  if (!code) return trimmed || undefined;
  return trimmed ? `${trimmed} ${code.toUpperCase()}` : code.toUpperCase();
}

async function prepareRequest<T>(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest,
  read: (cwd: string, reference: MediaReference, type: string, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const label = labelWithCode(request.label, request.outputDirectory);
  const references = async (items: MediaReference[] | undefined, type: string) => {
    if (!items?.length) return items ? [] : undefined;
    if (!directory) invalid("参考媒体需要工作目录");
    // ACT: 单次请求顺序处理引用，避免数十个参考媒体同时启动探测进程。
    const result: T[] = [];
    for (const item of items) result.push(await read(directory, item, type, signal));
    return result;
  };
  const images = await references(request.images, "image");
  if (mediaType === "audio") return {
    type: "audio" as const, model: request.modelId, text: request.prompt, images, audios: await references(request.audios, "audio"),
    voice: request.voice, speed: request.speed, volume: request.volume, pitch: request.pitch, language: request.language, format: request.format, sampleRate: request.sampleRate,
  };
  if (mediaType === "image") return {
    type: "image" as const, model: request.modelId, prompt: request.prompt, images, ratio: request.ratio, size: request.size,
    ...(label ? { label } : {}),
  };
  return {
    type: "video" as const, model: request.modelId, prompt: request.prompt, images,
    videos: await references(request.videos, "video"), audios: await references(request.audios, "audio"),
    firstFrame: (await references(request.firstFrame ? [request.firstFrame] : undefined, "image"))?.[0],
    lastFrame: (await references(request.lastFrame ? [request.lastFrame] : undefined, "image"))?.[0],
    ...(request.continueFrom ? { continueFrom: request.continueFrom } : {}),
    ...(label ? { label } : {}),
    ratio: request.ratio, resolution: request.resolution, duration: request.duration, generateAudio: request.generateAudio, mode: request.mode,
    quality: request.quality, secondPass: request.secondPass,
    preview: request.preview,
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    ...(request.releaseGpuAfter !== undefined ? { releaseGpuAfter: request.releaseGpuAfter } : {}),
  };
}

async function configuredProvider(request: MediaGenerationRequest, mediaType: "image" | "video" | "audio", signal?: AbortSignal, directory?: string, onJobStart?: (jobId: string, cancel: () => Promise<void>) => void) {
  const info = await getMediaProvider(request.providerId);
  if (!info.models.some(model => model.id === request.modelId && model.type === mediaType)) invalid("所选媒体模型不存在或类型不匹配，请重新选择");
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  return loadMediaProviderSource(info.source, record(configurations[info.id]), signal, undefined, directory, onJobStart);
}

async function preparePriceRequest(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(5000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try { return await prepareRequest(directory, mediaType, request, readPriceReference, combined); }
  catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new Error("读取参考媒体信息超时，请稍后重试");
    throw error;
  }
}

export async function getMediaPrice(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const provider = await configuredProvider(request, mediaType, signal, directory);
  if (!provider.getPrice) return null;
  const prepared = await preparePriceRequest(directory, mediaType, request, signal);
  signal?.throwIfAborted();
  return getProviderPrice(provider, prepared);
}

/**
 * 空闲时释放供应商驻留显存/内存的视频模型（本机 GPU 供应商能力，如 FreeVideo）。
 * 返回 { supported, released, reason? }：供应商没有该能力时 supported=false；
 * released=false 是正常状态（reason=nothing_held 本无驻留 / 引擎正忙），调用方不重试。
 */
export async function releaseProviderGpu(providerId: string): Promise<{ supported: boolean; released: boolean; reason?: string }> {
  const info = await getMediaProvider(providerId);
  if (!info.models.some(model => model.type === "video")) return { supported: false, released: false };
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  const provider = await loadMediaProviderSource(info.source, record(configurations[info.id]));
  if (typeof provider.releaseGpu !== "function") return { supported: false, released: false };
  const result = await provider.releaseGpu.call(provider);
  return { supported: true, ...result };
}

export async function generateMedia(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  request: MediaGenerationRequest,
  signal?: AbortSignal,
  /** 供应商任务号确定后的回调（jobId + 引擎取消闭包）；异步任务通道用它实现显式取消直达引擎。 */
  onJobStart?: (jobId: string, cancel: () => Promise<void>) => void,
): Promise<GeneratedMedia[]> {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) invalid("请输入生成提示词");
  const directory = await realpath(cwd);
  const outputDirectory = request.outputDirectory ?? "assets/generated";
  await resolveWorkspacePath(directory, outputDirectory, true);
  const provider = await configuredProvider(request, mediaType, signal, directory, onJobStart);
  const generate = mediaType === "image" ? provider.generateImage : mediaType === "video" ? provider.generateVideo : provider.generateAudio;
  if (typeof generate !== "function") invalid(t`此供应商不支持${translateMessage({ image: "图片", video: "视频", audio: "音频" }[mediaType])}生成`);
  const rules = Array.isArray(provider.rules) ? provider.rules : [];
  const apiKeyRule = rules.find(rule => rule.field === "apiKey");
  if (apiKeyRule && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) {
    invalid(typeof apiKeyRule.missingMessage === "string" && apiKeyRule.missingMessage.trim() ? apiKeyRule.missingMessage : "请先在媒体模型设置中配置供应商 API Key");
  }
  const prepared = await prepareRequest(directory, mediaType, request, readReference, signal);
  signal?.throwIfAborted();
  const finish = beginGeneration(provider);
  const written: string[] = [];
  const result: GeneratedMedia[] = [];
  try {
    signal?.throwIfAborted();
    const { type, ...parameters } = prepared;
    const assets = type === "audio" ? await provider.generateAudio!(parameters as AudioRequest)
      : type === "image" ? await provider.generateImage!(parameters as ImageRequest) : await provider.generateVideo!(parameters as VideoRequest);
    if (!Array.isArray(assets) || !assets.length) invalid("供应商未返回生成结果");
    for (const asset of assets) {
      signal?.throwIfAborted();
      const { bytes, mimeType } = await assetBytes(asset, mediaType, signal);
      signal?.throwIfAborted();
      const output = await resolveWorkspacePath(directory, outputDirectory, true);
      const release = lockWorkspaceFiles([output.path]);
      try {
        await mkdir(output.path, { recursive: true });
        const file = join(outputDirectory, `${mediaType}${crypto.randomUUID()}.${mediaExtensions[mimeType]}`);
        const { path } = await resolveWorkspacePath(directory, file);
        signal?.throwIfAborted();
        await writeWorkspaceFile(path, bytes, true);
        written.push(path);
        // ACT: jobId 随产物回传——多轨续接要用它作 continue_from.from_job 引用上一镜，
        // 丢了它续接就无法精确接到「那一镜」，只能退化成独立起镜（等于假承接）。
        result.push({ path: relative(directory, path).replace(/\\/g, "/"), mimeType, mediaType, ...(asset.jobId ? { jobId: asset.jobId } : {}) });
      } finally { release(); }
    }
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // ACT: 只回滚本次创建的文件，保留目录中已有的节点资源。
    await Promise.all(written.map(path => unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; })));
    throw err;
  } finally { finish(); }
}
