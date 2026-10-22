// ACT: 本地 FreeVideo 引擎（MiniMax-H3）供应商；与 metaso 同模型，差异是走本机 Agent API、无计费。
// 自包含：不 import 任何模块，HTTP 全部用 this.tool.fetch，素材经 POST /media 上传换内部文件路径。
const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "Token",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off", placeholder: "FreeVideo 安装目录中 agent/token 文件的内容" },
    missingMessage: "请连接 FreeVideo：打开 http://127.0.0.1:8188/freevideo/agent 并按说明操作。",
  },
  {
    type: "input",
    field: "baseUrl" as const,
    title: "服务地址",
    value: "http://127.0.0.1:8188/freevideo/agent/v1",
    props: { placeholder: "http://127.0.0.1:8188/freevideo/agent/v1" },
  },
] as const;

const version = "1.1.1";
const agentSuffix = "/freevideo/agent/v1";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FreeVideo 响应格式错误");
  return value as Record<string, unknown>;
}

/** 用户可只填 origin，这里统一补全为 Agent API 基址。 */
function agentBase(raw: string | undefined) {
  const base = (raw ?? "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("请填写服务地址");
  return base.endsWith(agentSuffix) ? base : `${base}${agentSuffix}`;
}

/** 结果下载地址的基址是服务器 origin（url 已含 /freevideo/agent/v1 前缀），不能拼 Agent 基址。 */
function originOf(agent: string) {
  return agent.replace(/\/freevideo\/agent\/v1\/?$/, "");
}

function wait(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function clampSeconds(value: number | undefined) {
  const seconds = Number.isFinite(value as number) ? (value as number) : 5;
  return Math.min(60, Math.max(2, seconds));
}

/** 宿主分辨率档位映射到 FreeVideo 的 megapixels。 */
function megapixels(resolution?: string) {
  const r = (resolution ?? "").toLowerCase();
  if (r.includes("2k")) return 2.0;
  if (r.includes("1080")) return 1.5;
  return 1.0;
}

/** 图像任务的 width/height（256-2048），按比例与 1K/2K 档位推算。 */
function imageDimensions(ratio?: string, size?: string) {
  const base = size === "2K" || size === "4K" ? 2048 : 1024;
  const [rw, rh] = (ratio ?? "1:1").split(":").map(Number);
  if (!rw || !rh) return { width: base, height: base };
  const width = rw >= rh ? base : Math.round((base * rw) / rh);
  const height = rw >= rh ? Math.round((base * rh) / rw) : base;
  return {
    width: Math.min(2048, Math.max(256, width)),
    height: Math.min(2048, Math.max(256, height)),
  };
}

/** 任务名（max 80 字）：命令类别-主题，如「参考生图-空灵超现实唐代庭院」。 */
function jobLabel(request: { prompt?: string; images?: MediaInput[]; videos?: MediaInput[]; audios?: MediaInput[]; firstFrame?: MediaInput; lastFrame?: MediaInput }, mediaType: "video" | "image") {
  const action = mediaType === "video"
    ? (request.firstFrame && request.lastFrame ? "首尾帧视频" : request.firstFrame ? "首帧视频" : request.lastFrame ? "尾帧视频" : request.images?.length || request.videos?.length || request.audios?.length ? "参考视频" : "文生视频")
    : request.images?.length ? "参考生图" : "文生图";
  // 主题：英文按词边界截断（不切词中间），纯中文无空格时按字符截 12 字
  const raw = (request.prompt ?? "").trim().replace(/\s+/g, " ");
  let subject: string;
  if (/\s/.test(raw)) {
    const words = raw.split(" ").filter(Boolean);
    let acc = "";
    for (const w of words.slice(0, 8)) {
      const candidate = acc ? acc + " " + w : w;
      if (candidate.length > 24) break;
      acc = candidate;
    }
    subject = acc || raw.slice(0, 12);
  } else {
    subject = raw.slice(0, 12);
  }
  subject = subject || "未命名";
  return `${action}-${subject}`.slice(0, 80);
}

/** 推导上传文件名扩展名：优先 mimeType 子类型，其次素材名后缀，兜底 bin。 */
function extensionFor(input: MediaInput): string {
  const fromType = input.mimeType?.split("/")[1]?.split(";")[0];
  if (fromType && fromType.length <= 8) return fromType;
  const fromName = typeof input.name === "string" ? input.name.toLowerCase().match(/\.([a-z0-9]{2,8})$/)?.[1] : undefined;
  return fromName ?? "bin";
}

/** 把宿主素材（url/base64/binary）上传到 FreeVideo，返回内部文件路径。 */
async function upload(context: ProviderContext, token: string, agent: string, input: MediaInput, signal: AbortSignal): Promise<string> {
  let bytes: Uint8Array;
  if (input.type === "binary") bytes = input.data;
  else if (input.type === "base64") bytes = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ""), "base64");
  else {
    const response = await context.tool.fetch(input.url, { signal });
    if (!response.ok) throw new Error(`读取素材失败：HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const extension = extensionFor(input);
  const response = await context.tool.fetch(`${agent}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `toonflow_${Date.now().toString(16)}.${extension}`, data_base64: Buffer.from(bytes).toString("base64") }),
    signal,
  });
  if (!response.ok) throw new Error(context.tool.errorMessage?.(await response.json().catch(() => ({}))) || `素材上传失败：HTTP ${response.status}`);
  const result = object(await response.json());
  if (typeof result.file !== "string" || !result.file) throw new Error("素材上传未返回文件路径");
  return result.file;
}

/** 下载结果文件（需带同一 token），返回字节。 */
async function download(context: ProviderContext, token: string, origin: string, url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await context.tool.fetch(url.startsWith("http") ? url : origin + url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new Error(`结果下载失败：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** 提交任务并轮询到终态；失败/取消抛友好错误，interrupted 自动续拍（最多 2 次）。 */
async function runJob(context: ProviderContext, token: string, agent: string, spec: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const submit = await context.tool.fetch(`${agent}/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(spec),
    signal,
  });
  if (!submit.ok) throw new Error(context.tool.errorMessage?.(await submit.json().catch(() => ({}))) || `提交失败：HTTP ${submit.status}`);
  const answer = object(await submit.json());
  const job = object(answer.job ?? answer);
  const jobId = typeof job.id === "string" ? job.id : "";
  if (!jobId) throw new Error("未返回任务ID");
  let resumeTries = 0;
  while (true) {
    const response = await context.tool.fetch(`${agent}/jobs/${jobId}?wait=25`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error(context.tool.errorMessage?.(await response.json().catch(() => ({}))) || `轮询失败：HTTP ${response.status}`);
    const answer = object(await response.json());
    const current = object(answer.job ?? answer);
    const status = String(current.status);
    if (status === "succeeded") return current;
    if (status === "failed" || status === "cancelled") {
      throw new Error(context.tool.errorMessage?.(current) || `生成${status === "cancelled" ? "已取消" : "失败"}`);
    }
    if (status === "interrupted") {
      // ACT: 仅 interrupted 自动续拍，上限 2——failed 多需换提示词/参数、cancelled 是用户意图，都不自动恢复；已成功块保留由引擎侧完成，供应商无需分段记账。
      if (resumeTries >= 2) throw new Error("生成中断，自动续拍两次仍未成功；请检查 FreeVideo 引擎状态后重试本镜头");
      resumeTries++;
      const resume = await context.tool.fetch(`${agent}/jobs/${jobId}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
        signal,
      });
      const resumeAnswer = await resume.json().catch(() => ({}));
      if (!resume.ok) throw new Error(context.tool.errorMessage?.(resumeAnswer) || `续拍失败：HTTP ${resume.status}`);
      object(resumeAnswer);
      continue;
    }
    await wait(signal, Math.max(500, Number(current.poll_after_ms) || 2000));
  }
}

/** 每次调用生成新 ref；不复用——spec 含每次不同的上传文件名，内容哈希幂等会把「同参数再抽一次」误合并回旧任务。需要断线找回时应在请求级持有同一 ref 重发（当前无此需求）。 */
function makeRef(model: string, request: { prompt?: string; duration?: number; images?: MediaInput[]; videos?: MediaInput[]; firstFrame?: MediaInput }) {
  const hint = model;
  const salt = Math.random().toString(36).slice(2, 8);
  return `toonflow-${hint}-${Date.now().toString(36)}-${salt}`.slice(0, 128);
}

export default {
  id: "freevideo",
  label: "FreeVideo（本地）",
  // ACT: 暂无品牌图标，留空回退到模型图标；同时保证前端联合类型可访问 icon 属性。
  icon: "",
  version,
  readme: `## FreeVideo（本地）
本机安装的 FreeVideo 引擎（MiniMax-H3），直接跑在本机 GPU 上，无需 API Key 计费。
- 服务地址默认 \`http://127.0.0.1:8188/freevideo/agent/v1\`，只适用于 FreeVideo 与 Toonflow 同机运行。
- 首次使用请先连接：在浏览器打开 \`http://127.0.0.1:8188/freevideo/agent\` 并按说明操作。
- Token 来自 FreeVideo 安装目录的 \`agent/token\` 文件（Comfy-Desktop 安装下在
\`%LOCALAPPDATA%\\Comfy-Desktop\\ComfyUI-Installs\\comfyui\\ComfyUI\\FreeVideo-engine\\agent\\token\`）。
- 视频：文生 / 首帧 / 首尾帧 / 参考图、视频、音频，原生带同步音轨；2-60 秒，768P / 2K。
- 参考图最多 4 张为 Toonflow 侧限制；引擎单块默认支持到 9 张，30 秒及以上自动分块时实限 3 张（超限由引擎报错）。
- ≥30 秒的片段自动分块时开启 first_frame_reference，减少跨块的取景与人物漂移；单段视频不受影响。
- 提示词按 FreeVideo 约定拼装：有参考图时六段（subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music），无参考时三段，段首写字段名、段间空一行。
- 生成中断（引擎重启、显存波动）时自动尝试续拍，最多 2 次，已生成部分保留；续拍仍失败会明确报错。
- 图像：文生图 / 单参考 / 多参考（最多 4 张），1K / 2K。
- 生成耗时为分钟级（本机 GPU），请耐心等待；取消生成会同时取消本机任务。`,
  rules,
  models: [
    {
      id: "MiniMax-H3",
      label: "MiniMax-H3（本地 FreeVideo）",
      type: "video",
      // ACT: imageReference:4 为 Toonflow 产品限制（V8）；引擎单块默认支持到 9 张参考，≥30s 自动分块时实限 3（422），供应商不预拦（维持裁决）。
      mode: ["text", "startFrameOptional", ["imageReference:4", "videoReference:1", "audioReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60], resolution: ["768P", "2K"] }],
    },
    {
      id: "freevideo-image",
      label: "FreeVideo 图像（本地）",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K"],
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
  ] satisfies ProviderModel[],
  async getPrice() {
    return { price: "免费", tips: "本机 GPU 生成，无计费" };
  },
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const origin = originOf(agent);
    // ACT: 单次图像生成最多等待 10 分钟。
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);

    const images: string[] = [];
    for (const image of request.images ?? []) images.push(await upload(this, token, agent, image, signal));
    if (images.length > 4) throw new Error(`这类模型最多支持4张参考图，当前提交了${images.length}张`);

    const { width, height } = imageDimensions(request.ratio, request.size);
    const job = await runJob(this, token, agent, {
      kind: "image",
      label: jobLabel(request, "image"),
      ref: makeRef('img', request),
      prompt: request.prompt,
      width,
      height,
      ...(images.length ? { images } : {}),
    }, signal);
    const result = object(job.result ?? {});
    const url = result.url ?? result.file;
    if (typeof url !== "string" || !url) throw new Error("未返回生成结果");
    const data = await download(this, token, origin, url, signal);
    return [{ mediaType: "image", type: "binary", data, mimeType: "image/png" }];
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const origin = originOf(agent);
    // ACT: 本机 GPU 生成较慢，单次最多等待 30 分钟。
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);

    const media: Record<string, unknown> = {};
    if (request.firstFrame) media.first = await upload(this, token, agent, request.firstFrame, signal);
    if (request.lastFrame) media.last = await upload(this, token, agent, request.lastFrame, signal);
    const references: string[] = [];
    for (const image of request.images ?? []) references.push(await upload(this, token, agent, image, signal));
    for (const video of request.videos ?? []) references.push(await upload(this, token, agent, video, signal));
    for (const audio of request.audios ?? []) references.push(await upload(this, token, agent, audio, signal));
    if (references.length) media.references = references;

    const seconds = clampSeconds(request.duration);
    // ACT: first_frame_reference 只在 ≥30s 自动分块时减少跨块漂移；单段视频不受影响，
    // 运镜大/需要变化的场景规范建议关闭——保守取「≥30s 才开」，不引入开关面。
    const job = await runJob(this, token, agent, {
      kind: "generate",
      label: jobLabel(request, "video"),
      ref: makeRef('vid', request),
      prompt: request.prompt,
      seconds,
      quality: "light",
      ...(request.ratio ? { aspect: request.ratio } : {}),
      ...(request.resolution ? { megapixels: megapixels(request.resolution) } : {}),
      ...(seconds >= 30 ? { first_frame_reference: true } : {}),
      ...(Object.keys(media).length ? { media } : {}),
    }, signal);
    const result = object(job.result ?? {});
    const video = object(result.video ?? {});
    const url = video.url ?? result.url;
    if (typeof url !== "string" || !url) throw new Error("未返回生成结果");
    const data = await download(this, token, origin, url, signal);
    return [{ mediaType: "video", type: "binary", data, mimeType: "video/mp4" }];
  },
} satisfies ProviderDefinition<typeof rules>;
