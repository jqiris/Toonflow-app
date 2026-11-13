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

const version = "1.4.0";
const agentSuffix = "/freevideo/agent/v1";
/** 图像任务参考图上限：引擎 kind=image 的 images 数组 maxItems=4（超限返回 too_many_images）。视频单块仍是 9，见 models 段。 */
const maxImageReferences = 4;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FreeVideo 响应格式错误");
  return value as Record<string, unknown>;
}

/** GET /projects/{id} 返回 {project:{...}, sources}，工程本体在 project 字段（顶层 revision/tracks 为 undefined）。
 * 这里统一取工程本体，原始响应仍可访问 sources 等并列字段。 */
function projectOf(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.project;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return body;
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
  // ACT: 引擎要求 seconds 为整数（宿主 duration 可能是小数档位），取整后再夹取。
  return Math.round(Math.min(60, Math.max(2, seconds)));
}

/** 宿主分辨率档位映射到 FreeVideo 的 megapixels。 */
function megapixels(resolution?: string) {
  const r = (resolution ?? "").toLowerCase();
  if (r.includes("2k")) return 2.0;
  if (r.includes("1080")) return 1.5;
  return 1.0;
}

/** 图像任务的 width/height（256-2048），按比例与 1K/2K 档位推算；引擎要求 32 的倍数，向下取整对齐（2:3 的 683/1365 不对齐会 422）。 */
function imageDimensions(ratio?: string, size?: string) {
  const base = size === "2K" || size === "4K" ? 2048 : 1024;
  const [rw, rh] = (ratio ?? "1:1").split(":").map(Number);
  if (!rw || !rh) return { width: base, height: base };
  const align32 = (value: number) => Math.max(256, Math.floor(value / 32) * 32);
  const width = rw >= rh ? base : align32((base * rw) / rh);
  const height = rw >= rh ? align32((base * rh) / rw) : base;
  return {
    width: Math.min(2048, Math.max(256, width)),
    height: Math.min(2048, Math.max(256, height)),
  };
}

/** 引擎 kind=image 认的图片模型名（0.5.3 schema 枚举）：本供应商的模型 id 与引擎同名，直接透传；
 *  历史 id freevideo-image 不在表内，照旧不发 model，由引擎用它自己选定的已装模型。 */
const imageModels: Record<string, string> = { "qwen-image-2.1-turbo": "qwen-image-2.1-turbo", "minimax-h3-image": "minimax-h3-image" };
// ACT: 引擎 aspect 只有这五档（2:3 不在内，只能走 width/height），且 aspect 与 width/height 互斥（schema if-then 硬约束）。
const imageAspects = ["1:1", "16:9", "9:16", "4:3", "3:4"];
/** H3 Image 的画质档位→像素预算（引擎文档：standard 约 4 MP、high 约 16 MP，仅 Qwen 之外的 H3 生效）。 */
const imageTierPixels: Record<string, number> = { standard: 4, high: 16 };
/** 省略 quality 时的档位：MiniMax-H3 图像是成片资产模型，默认取最高档；要草稿由调用方显式传 standard。 */
const imageDefaultTier = "high";
/** 省略 size 时按模型声明的第一档走——否则 imageDimensions 会掉到 1024 底档，
 *  而 Qwen 是唯一按 size 取像素的默认模型（画布节点同样取声明档，见 07assetsImages.md 的映射表）。 */
const imageDefaultSize: Record<string, string> = { "qwen-image-2.1-turbo": "2K" };
const imageMaxSide = 4096; // 引擎 limits.width / limits.height = [256, 4096, 32]

/** 画质档位由调用方决定（画布节点 quality、MCP generateImage 的 quality）；只有非法值才报错，不在这里写死策略。 */
function imageTier(value: string | undefined) {
  const tier = (value ?? "").trim().toLowerCase() || imageDefaultTier;
  if (!imageTierPixels[tier]) throw new Error(`MiniMax-H3 图像的画质档位只支持 ${Object.keys(imageTierPixels).join("、")}（省略按 ${imageDefaultTier}）`);
  return tier;
}

/** 比例不在引擎 aspect 档内（角色四视图 2:3 等）：按档位像素预算推边长，受每边 4096 上限回缩，32 下对齐。 */
function tierImageDimensions(ratio: string, tier: string) {
  const [rw, rh] = ratio.split(":").map(Number);
  if (!rw || !rh) return { width: imageMaxSide, height: imageMaxSide };
  const budget = imageTierPixels[tier] * 1000 * 1000;
  // ACT: 两个约束取小的那个——像素预算与最长边 4096；只夹一条边会把比例拉歪。
  const scale = Math.min(Math.sqrt(budget / (rw * rh)), imageMaxSide / Math.max(rw, rh));
  const align = (value: number) => Math.max(256, Math.floor(value / 32) * 32);
  return { width: align(rw * scale), height: align(rh * scale) };
}

/** 代号前缀→资产/镜头类型：任务名以它开头，如「角色-C01-20261024-2355」。 */
// ACT: 已知冲突——assetCard 契约里 S = 声音卡，这里 S 映射为分镜（镜头编号 S011）。
// 声音卡是 textOnly 资产，不出图不进本供应商，现状不会触发歧义；若以后让声音卡走图像生成，必须先重命名其中一个口径。
const jobKinds: Record<string, string> = { C: "角色", SC: "场景", P: "道具", KF: "关键帧", S: "分镜" };

/** 本地时间戳（YYYYMMDD-HHmm）：同一资产的多次生成靠它区分。 */
function jobStamp(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** 从标签里取规范代号（C01 / SC01 / P02 / KF1 / S001），取不到返回空串。 */
function jobCode(label: string) {
  const matched = /(?:^|[^A-Za-z0-9])(KF|SC|C|P|S)(\d{1,3})(?![0-9])/i.exec(label);
  return matched ? `${matched[1].toUpperCase()}${matched[2]}` : "";
}

/**
 * 任务名（max 80 字）：前缀-代号-时间戳。资产图是「角色-C01-20261024-2355」，
 * 视频是「参考视频-S011-20261025-0156」（视频没有资产类型，用生成方式当前缀）。
 * ACT: 代号由调用方放在 request.label 里（资产节点名、镜头编号）；取不到代号就退回旧的
 * 「生成方式-提示词主题」口径（主题取提示词首段，取不到主题才用请求 label），两者都带时间戳。
 * 截断只截主体、时间戳必须留下——上游节点名与抽取模型给的名字都没有长度约束。
 */
function jobLabel(request: { label?: string; prompt?: string; images?: MediaInput[]; videos?: MediaInput[]; audios?: MediaInput[]; firstFrame?: MediaInput; lastFrame?: MediaInput }, mediaType: "video" | "image") {
  const action = mediaType === "video"
    ? (request.firstFrame && request.lastFrame ? "首尾帧视频" : request.firstFrame ? "首帧视频" : request.lastFrame ? "尾帧视频" : request.images?.length || request.videos?.length || request.audios?.length ? "参考视频" : "文生视频")
    : request.images?.length ? "参考生图" : "文生图";
  const label = (request.label ?? "").trim();
  const code = jobCode(label);
  // 前缀口径：视频用生成方式（参考视频-S011-时间戳），资产图用资产类型（角色-C01-时间戳）；
  // 两种都保留时间戳，同一资产的多次生成在引擎列表里不会同名。
  if (code) return jobName(`${mediaType === "video" ? action : jobKinds[code.replace(/\d+$/, "")] ?? action}-${code}`);
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
  // ACT: 原 :128 先把 subject 兜成「未命名」，:129 的 `subject || label` 恒取 subject，label 回退分支是死代码。
  // 按注释意图修正口径：提示词主题取不到才用请求 label，两者都没有才写「未命名」。
  return jobName(`${action}-${subject || label || "未命名"}`);
}

/** 拼「主体-时间戳」并按 80 字上限截断主体：时间戳始终保留，否则长名字会把区分度最高的那段切掉。 */
function jobName(head: string) {
  const stamp = jobStamp();
  return `${head.slice(0, Math.max(0, 79 - stamp.length))}-${stamp}`;
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
  if (!response.ok) throw await engineFailure(response, "素材上传失败");
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

/**
 * 等待 /imports 上传的素材转码完成（state==="ready"）。
 * ACT: 刚 POST /imports 时素材还在 preparing/转码中，`comfy_editor.sources()` 对未 ready 的
 * import 源抛 FileNotFoundError → 引擎返回 source_missing。因此必须在 insert 前等 ready；
 * 直接 insert 得到的 409 source_missing 就是没等就插。
 */
async function waitImportReady(context: ProviderContext, token: string, agent: string, importId: string, signal: AbortSignal, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await context.tool.fetch(`${agent}/imports`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw await engineFailure(response, "读取导入素材失败");
    const answer = object(await response.json());
    const items = Array.isArray(answer.items) ? answer.items : [];
    const found = items.find(item => String(object(item).id) === importId);
    if (found) {
      const state = String(object(found).state);
      if (state === "ready") return;
      if (state === "failed") {
        const reason = object(found).reason;
        throw new Error(`成片导入失败：${typeof reason === "string" && reason ? reason : "素材转码失败，请换一个文件重试"}`);
      }
    }
    if (Date.now() > deadline) throw new Error(`成片导入超时（${Math.round(timeoutMs / 1000)} 秒未转码完成）：请重试`);
    await wait(signal, 1000);
  }
}

/**
 * 引擎错误码 → 中文可操作文案。
 * ACT: 引擎的 error.message 是英文（"This needs the FreeVideo page open in a browser."），
 * 真正能指导用户的是 error.next（也是英文）与 error.code。中文产品里不能把英文原样抛给用户，
 * 所以按 code 映射一句「现在该做什么」；未收录的 code 才回落引擎原文。
 */
const engineMessages: Record<string, string> = {
  page_required: "白模预览要在 FreeVideo 页面里渲染：请打开 FreeVideo 页面并保持前台（切到后台标签页也会停），然后重试",
  page_session_required: "这个操作只能由用户在 FreeVideo 页面上发起：请在页面里操作",
  forbidden: "这个操作只有用户本人能做：请让用户在 FreeVideo 页面上完成",
  not_ready: "FreeVideo 还没装好：打开 设置 → 安装 / 修复，完成后重试",
  unauthorized: "Token 无效或已过期：从 FreeVideo 安装目录的 agent/token 重新读取后填入设置",
  no_token: "读不到本机 Token：先启动 FreeVideo，再从 agent/token 读取",
  vlm_unavailable: "本地视觉模型没装：打开 设置 → 安装 / 修复 装上提示词模型后重试",
  model_missing: "缺少必需的本地模型：打开 设置 → 安装 / 修复 安装后重试",
  busy: "引擎正忙：稍等片刻再重试",
  insufficient_memory: "显存不够跑这个规格：先释放显存，或降低分辨率 / 时长后重试",
  out_of_memory: "显存爆了：先释放显存或关掉其他占用 GPU 的程序，再续拍或重提",
  ram_space: "系统内存不够：关掉其他吃内存的程序后重试",
  chain_too_long: "单个连续镜头最多 8 段：请缩短时长，或另起一镜（不要 continue_from）",
  chain_short_parts: "有短于 10 秒的续接段时最多 4 段：把每段做到 10 秒以上、减少段数，或打开 first_frame_reference",
  continuation_unavailable: "当前引擎不支持续接：单段请控制在 15 秒以内",
  not_resumable: "只有失败 / 中断 / 取消的任务能续拍",
  cancelled: "任务已取消：需要继续请用续拍",
  interrupted: "任务中断（已完成的分段保留）：可以续拍接着跑",
  generation_failed: "生成失败（已完成的分段保留）：可以续拍重试未完成的部分",
  timeout: "引擎超时：先读一次任务状态，再决定续拍还是重提",
  lost: "引擎那边找不到这个任务的结果了：请重新提交",
  no_video: "源任务还没有成片：等它 succeeded 后再引用",
  not_found: "找不到这个任务 / 影片 / 素材：先列表确认 ID",
  conflict: "操作与当前状态冲突：先读一次当前状态再重试",
  dependency_failed: "依赖的任务没成功：先处理依赖任务再重提",
  invalid_request: "请求字段不合法：按引擎返回的 details 逐项修正后重发",
  invalid_media: "素材不可读：换一张可读的图片 / 视频 / 音频再传",
  too_large: "文件超过引擎上限：压缩后再传",
  storage_unavailable: "引擎存不下文件：检查磁盘空间后重试",
  disk_full: "磁盘满了：清理磁盘后重试",
  lan_unavailable: "局域网设置要在 FreeVideo 启动器里完成安装",
  local_only: "这个接口只允许本机访问",
  origin_forbidden: "来源不匹配：请从 FreeVideo 自己的页面发起",
  idempotency_conflict: "同一个幂等键已经用于不同内容：改了内容请换新的 ref",
  internal_error: "引擎内部错误：把返回里的 request_id 报给开发者",
  session_full: "这个会话的事件数到上限了：新开一个会话继续",
  redirect_forbidden: "带凭证的请求不能跨域跳转：检查 baseUrl 是否指向本机 FreeVideo",
  method_not_allowed: "这个接口不支持该 HTTP 方法：检查调用方式（多半是版本不匹配）",
  unreachable: "连不上 FreeVideo 服务：确认引擎已启动、端口正确",
  invalid_json: "请求体不是合法 JSON：检查请求组装",
  invalid_edit: "图片编辑参数或文档不合法：核对裁剪 / 图层参数后重发",
  invalid_screenplay: "剧本里有不合法的字段：按引擎返回的 details 逐项修正",
  unsupported_media_type: "Content-Type 不对：只接受 application/json 或受支持的媒体上传",
  vlm_failed: "本地视觉模型请求失败：检查模型是否装好，稍后重试",
  context_length: "问题和图片超出了本地模型的上下文上限：减少图片或缩短提问",
  invalid_output: "后端产物不可用：检查 ComfyUI 输出后重试",
  vlm_invalid_json: "本地模型返回的不是合法 JSON：重试一次，或改用 format=text",
  image_size: "图片超过本地模型 50 兆像素上限：先缩小再传",
  unsupported_media: "本地视觉模型不支持这种素材：换成图片（或受支持的格式）",
  source_missing: "引用的已完成分段已经不在了：请重新提交整镜",
  invalid_range: "下载的 Range 越界：按文件实际大小重新请求",
  chain_unavailable: "连续生成后端不可用：改用独立镜头，或检查 ComfyUI 的续接支持",
  chain_missing: "找不到保存的续接记录：请重新提交",
  join_failed: "分段合成失败（已完成的分段保留）：可以续拍或改用独立镜头",
  chain_rejected: "连续生成后端拒绝了这次请求：缩短时长或改用独立镜头",
  invalid_wait: "wait 必须是有限的非负秒数：检查轮询参数",
  invalid_resume: "续拍只接受空对象或可选的 ref：检查请求体",
  invalid_library_id: "作品号不合法：day / run 必须指向一个已保存的影片",
  invalid_capabilities_query: "能力查询参数不合法：检查 size 等查询字段",
  unsupported_comfyui: "这个 ComfyUI 版本没有受支持的生成端点：升级 ComfyUI 或 FreeVideo",
  music_failed: "配乐生成失败：换个描述词，或检查音轨 a2 是否被占用",
  audio_full: "音轨 a2 已有配乐：先移除旧配乐（引擎要求 a2 必须为空），再重新生成",
  project_changed: "工程在别处被改动了：重新读取工程拿最新 revision 后重试",
};

/**
 * 把引擎的非 2xx 响应转成一个带中文文案和原 HTTP 状态码的 Error。
 * ACT: 状态码必须原样带出去——宿主 errorFromCause 用 error.status 决定 HTTP 码，
 * 丢了就会把引擎的 409（可重试的 page_required / busy）显示成 500 服务器故障。
 */
async function engineFailure(response: Response, fallback: string): Promise<Error> {
  const answer = object(await response.json().catch(() => ({})));
  const raw = object(answer.error);
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  const known = code ? engineMessages[code] : undefined;
  const zh = typeof raw.error_zh === "string" ? raw.error_zh.trim() : "";
  const detail = typeof raw.message === "string" ? raw.message.trim() : "";
  const requestId = typeof raw.request_id === "string" ? raw.request_id.trim() : "";
  // 优先级：本文件码表（中文且可操作）→ 引擎给的具体中文原因（"没有完成" 这种无信息量的不算）
  // → 引擎英文原文附 code → 兜底。未收录的 code 保留原文便于排查。
  let message = known ?? "";
  if (!message && zh && zh !== "没有完成") message = zh;
  if (!message) message = detail ? (code ? `${detail}（${code}）` : detail) : `${fallback}：HTTP ${response.status}`;
  const suffix = code === "internal_error" && requestId ? `（request_id: ${requestId}）` : "";
  return Object.assign(new Error(message + suffix), { status: response.status, engineCode: code });
}

/**
 * 失败 / 取消的任务行 → 中文文案。
 * ACT: 任务行不是 HTTP 响应（没有 status），它的错误在 job.error 上，所以单独走一次映射，不能复用 engineFailure。
 * 优先级：引擎自带的 error_zh（errors.reasons() 按失败行/错误码给出的具体中文原因，比通用码表更准）
 * → 本文件的 engineMessages 码表 → 引擎英文原文 → 兜底。
 */
function engineJobMessage(job: Record<string, unknown>, fallback: string): string {
  const raw = object(job.error);
  const zh = typeof raw.error_zh === "string" ? raw.error_zh.trim() : "";
  // ACT: 引擎在无具体原因时给的是「没有完成」，信息量为零，不如走码表或兜底。
  if (zh && zh !== "没有完成") return zh;
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  const known = code ? engineMessages[code] : undefined;
  if (known) return known;
  const detail = typeof raw.message === "string" ? raw.message.trim() : "";
  return detail || fallback;
}

/**
 * 提交前比对「LoRA 名字是否已装」。
 * ACT: 引擎只在 POST /jobs 才校验名字（实测 /plan 对清单外名字返回 200，提交才 422 且是英文），
 * 派工链路里写错一个名字要等真正占上 GPU 才被拒——所以这里本地先查一次，报中文可操作错误。
 * 根状态带 60 秒缓存（批次派工逐镜共用，不每镜重复拉）；拉失败（引擎离线/超时）就跳过比对
 * 交给引擎兜底——不能因为查不到清单把正常派工堵死。
 */
let installedLorasEntry: { at: number; names: string[] } | undefined;
const installedLorasTtl = 60_000;

async function assertInstalledLoras(context: ProviderContext, token: string, agent: string, names: string[]) {
  if (!names.length) return;
  let installed: string[];
  if (installedLorasEntry && Date.now() - installedLorasEntry.at < installedLorasTtl) {
    installed = installedLorasEntry.names;
  } else {
    try {
      const response = await (context.queryFetch ?? context.tool.fetch)(agent, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return;
      const answer = object(await response.json());
      if (!Array.isArray(answer.loras)) return;
      installed = answer.loras.map(String);
      installedLorasEntry = { at: Date.now(), names: installed };
    } catch {
      return;
    }
  }
  const missing = [...new Set(names)].filter(name => !installed.includes(name));
  if (missing.length) throw new Error(`LoRA「${missing.join("、")}」不在引擎已装清单内（清单可查 /api/ai/media/engineProfile 的 profile.loras），请改用已安装的名称或删除该项后重试`);
}

/**
 * 提交任务并轮询到终态；失败/取消抛友好错误，interrupted 自动续拍（最多 2 次）。
 * ACT: 成功时把引擎任务号（`j` + 12 hex）附在结果上返回——多轨续接要用
 * `continue_from: { from_job }` 精确引用上一镜任务，而这是唯一能拿到它的地方。
 * ACT: 任务号一确定就经 onJobStart 向宿主登记取消闭包——宿主显式取消要真停引擎任务，
 * 光掐本地信号只会让本机 GPU 白跑到自然结束。闭包走 queryFetch（原始 fetch）：
 * 调用时本次生成的 signal 往往已中止，tool.fetch 会被宿主直接拒发。
 * ACT: takes>1 时引擎一次提交展开成多条任务（响应 jobs 数组，每条 take 独立 jobId、
 * seed 逐条 +1）；这里逐条轮询，返回全部成功条——部分失败不拖垮整批，全失败才抛错。
 */
async function runJobs(context: ProviderContext, token: string, agent: string, spec: Record<string, unknown>, signal: AbortSignal): Promise<{ job: Record<string, unknown>; jobId: string }[]> {
  const submit = await context.tool.fetch(`${agent}/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(spec),
    signal,
  });
  if (!submit.ok) throw await engineFailure(submit, "提交失败");
  const answer = object(await submit.json());
  const rows = Array.isArray(answer.jobs) ? answer.jobs : [object(answer.job ?? answer)];
  const jobIds = rows.map(row => typeof object(row).id === "string" ? String(object(row).id) : "");
  if (!jobIds.length || jobIds.some(id => !id)) throw new Error("未返回任务ID");
  jobIds.forEach(jobId => context.onJobStart?.(jobId, async () => {
    const fetchImpl = context.queryFetch ?? context.tool.fetch;
    try {
      await fetchImpl(`${agent}/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      });
      // 已终态任务的取消返回 4xx 属正常竞态，不抛出。
    } catch { /* 尽力而为：闭包失败不影响本地任务收尾。 */ }
  }));
  const succeeded: { job: Record<string, unknown>; jobId: string }[] = [];
  const failures: string[] = [];
  for (const jobId of jobIds) {
    let resumeTries = 0;
    for (;;) {
      const response = await context.tool.fetch(`${agent}/jobs/${jobId}?wait=25`, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!response.ok) throw await engineFailure(response, "轮询失败");
      const answer = object(await response.json());
      const current = object(answer.job ?? answer);
      const status = String(current.status);
      if (status === "succeeded") { succeeded.push({ job: current, jobId }); break; }
      if (status === "failed" || status === "cancelled") {
        const message = engineJobMessage(current, `生成${status === "cancelled" ? "已取消" : "失败"}`);
        // 单条候选失败只记账；整批全失败才抛错（takes 的意义就是留成功条给用户挑）。
        if (jobIds.length === 1) throw new Error(message);
        failures.push(`第 ${jobIds.indexOf(jobId) + 1} 条：${message}`);
        break;
      }
      if (status === "interrupted") {
        // ACT: 仅 interrupted 自动续拍，上限 2——failed 多需换提示词/参数、cancelled 是用户意图，都不自动恢复；已成功块保留由引擎侧完成，供应商无需分段记账。
        if (resumeTries >= 2) {
          if (jobIds.length === 1) throw new Error("生成中断，自动续拍两次仍未成功；请检查 FreeVideo 引擎状态后重试本镜头");
          failures.push(`第 ${jobIds.indexOf(jobId) + 1} 条：生成中断，自动续拍两次仍未成功`);
          break;
        }
        resumeTries++;
        const resume = await context.tool.fetch(`${agent}/jobs/${jobId}/resume`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: "{}",
          signal,
        });
        if (!resume.ok) throw await engineFailure(resume, "续拍失败");
        continue;
      }
      await wait(signal, Math.max(500, Number(current.poll_after_ms) || 2000));
    }
  }
  if (!succeeded.length) throw new Error(failures.join("；") || "生成失败");
  return succeeded;
}

/** 兼容旧调用名：单任务路径。 */
async function runJob(context: ProviderContext, token: string, agent: string, spec: Record<string, unknown>, signal: AbortSignal): Promise<{ job: Record<string, unknown>; jobId: string }> {
  const [first] = await runJobs(context, token, agent, spec, signal);
  return first!;
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
- 视频参考图单块最多 9 张（引擎能力，供应商侧不预拦）；≥30 秒自动分块与续接镜实限 3 张，超限由引擎报错。图像任务参考图引擎硬上限 4 张（超限 422 too_many_images，供应商同值拦截）。
- ≥30 秒的片段自动分块时开启 first_frame_reference，减少跨块的取景与人物漂移；单段视频不受影响。
- 提示词按 FreeVideo 约定拼装：有参考图时六段（subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music），无参考时三段；前四段的段首标签由写作者写，两个声音段的段名由多轨引擎补。
- 生成中断（引擎重启、显存波动）时自动尝试续拍，最多 2 次，已生成部分保留；续拍仍失败会明确报错。
- 支持随机种子（seed）：同种子 + 同提示词 ≈ 同结果，重 roll 时保住不漂移的镜头；留空由引擎自定。
- 显存管理：批次最后一个任务出片后自动释放显存；空闲时也可主动释放（引擎正在生成时不释放）。
- 取消生成会同时取消本机任务（引擎侧真停，不再白跑 GPU）；页面断开不会取消，本机任务照常跑完保留产物。
- 图像：文生图 / 单参考 / 多参考（最多 4 张），支持 seed 复现同图。默认模型 Qwen Image 2.1（按 size 出像素，2K 为成片档）；要大画幅定稿选 MiniMax-H3 图像并用 quality 选档（high≈16 MP 成片、standard≈4 MP 草稿，省略按 high，此时 size 不参与换算）；FreeVideo 图像是老口径（不发模型名，由引擎选已装模型，1K / 2K）。
- 生成耗时为分钟级（本机 GPU），请耐心等待。`,
  rules,
  models: [
    {
      id: "MiniMax-H3",
      label: "MiniMax-H3（本地 FreeVideo）",
      type: "video",
      // ACT: models 段受 provider.ts 字面量校验限制，数字只能写死；9 = 引擎单块参考图能力，视频镜供应商侧不预拦（维持裁决），上限改动直接改这里的字面量。
      // ACT: ≥30s 自动分块时引擎实限 3（超限由引擎 422 报错）；承接镜合计 ≤3 由 V16 + 派工组装 + generateVideo 续接拦截兜底。
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:1", "audioReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60], resolution: ["768P", "2K"] }],
    },
    {
      // ACT: qwen-image-2.1-turbo 与引擎 kind=image 的 model 枚举同名（见 generateImage 的 imageModels 透传），
      // 排在图片区第一位作为默认图片模型；引擎侧 Qwen 不吃 tier，像素走 width/height（size 档位）。
      id: "qwen-image-2.1-turbo",
      label: "Qwen Image 2.1 图像（本地 FreeVideo）",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      // ACT: 只留 2K 一档是给画布下拉框占位——imageGenerationNode 会把未设置的档位预选为数值最小档（:193），
      // 列 1K 等于给默认值挂个误导标签；不传 size 的调用（assetImport 非角色卡等）由 imageDefaultSize 补成 2K，
      // 想出快档显式传 size:"1K"（服务端不校验档位表，供应商照算）。
      imageSizes: ["2K"],
      // ACT: 2:3 是角色四视图整版（2×2 竖版）的标准档位，实测引擎接受 width/height 直给。
      // 引擎侧上限是每边 4096（旧记录里的 2048 来自 0.4.x 引擎，已过时），本模型按 size 档位推到 2048 封顶。
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3"],
    },
    {
      // ACT: 高像素档：约 4 MP（standard）/ 16 MP（high），像素由 quality 决定、size 不参与换算。
      // 与 qwen-image-2.1-turbo 同为引擎 kind=image 的 model 枚举名；freevideo-image 不发 model，保留兼容历史配置。
      id: "minimax-h3-image",
      label: "MiniMax-H3 图像（本地 FreeVideo）",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      // ACT: 本模型的像素由 quality 档位决定（standard≈4 MP、high≈16 MP，省略按 high），size 不参与换算；
      // 这里只留 2K 一档是给画布下拉框占位——imageGenerationNode 会把未设置的档位预选为数值最小档（:193），
      // 列 1K 等于给默认值挂个误导标签。要快档请显式传 quality:"standard"。
      imageSizes: ["2K"],
      // ACT: 2:3 是角色四视图整版（2×2 竖版）的标准档位，实测引擎接受 width/height 直给；它不在引擎 aspect 五档内，
      // 由 tierImageDimensions 按档位像素预算推边长。引擎侧上限是每边 4096（旧记录里的 2048 来自 0.4.x 引擎，已过时）。
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3"],
    },
    {
      id: "freevideo-image",
      label: "FreeVideo 图像（本地）",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K"],
      // ACT: 2:3 是角色四视图整版（2×2 竖版）的标准档位，实测引擎接受 width/height 直给；它不在引擎 kind=image 的 aspect 五档内。
      // 本模型不发 model/tier（沿用引擎自选的已装模型，1K 为快档）；引擎侧上限是每边 4096（旧记录里的 2048 来自 0.4.x 引擎，已过时）。
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3"],
    },
  ] satisfies ProviderModel[],
  async getPrice() {
    return { price: "免费", tips: "本机 GPU 生成，无计费" };
  },
  // 空闲时主动归还显存：宿主在生成间隙要跑自己的模型（如审片）前调用。
  // released=false 是正常状态：reason=nothing_held 表示本无驻留、busy_video 类表示引擎正在生成，调用方不重试。
  async releaseGpu(): Promise<{ released: boolean; reason?: string }> {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const fetchImpl = this.queryFetch ?? this.tool.fetch;
    const response = await fetchImpl(`${agent}/gpu/release`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw await engineFailure(response, "释放显存失败");
    const result = object(await response.json());
    return { released: result.released === true, ...(typeof result.reason === "string" ? { reason: result.reason } : {}) };
  },
  // 读取引擎能力档案：根状态端点是 ${agent} 本身（/freevideo/agent/v1）；带尾斜杠或 /status 都返回 404。
  // loras / lora_trigger_words / limits / quality 四个字段原样透传，不做字段映射（消费方按需读取）。
  async engineProfile(): Promise<EngineProfile> {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const fetchImpl = this.queryFetch ?? this.tool.fetch;
    const response = await fetchImpl(agent, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw await engineFailure(response, "读取引擎能力档案失败");
    const answer = object(await response.json());
    // lora_trigger_words 的值按引擎契约是字符串；非字符串值以字符串化兜底，不做字段级映射。
    const triggerWords = Object.fromEntries(Object.entries(object(answer.lora_trigger_words ?? {})).map(([name, words]) => [name, typeof words === "string" ? words : String(words)]));
    return {
      loras: Array.isArray(answer.loras) ? answer.loras.map(String) : [],
      loraTriggerWords: triggerWords,
      limits: object(answer.limits ?? {}),
      quality: object(answer.quality ?? {}),
    };
  },
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const origin = originOf(agent);
    // ACT: 单次图像生成最多等待 10 分钟。
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);

    // LoRA 参数校验与引擎映射
    const loras = request.loras ?? [];
    if (loras.length > 8) throw new Error(`本镜头 LoRA 最多 8 个（引擎限制），当前 ${loras.length} 个`);
    if (loras.length) await assertInstalledLoras(this, token, agent, loras.map(lora => lora.name));
    for (const lora of loras) {
      if (!lora.name || typeof lora.name !== "string" || lora.name.length < 1 || lora.name.length > 512) throw new Error(`LoRA 名称不合法：须为 1–512 个字符`);
      const strength = lora.strength ?? 1;
      if (typeof strength !== "number" || !isFinite(strength) || strength < -2 || strength > 2) throw new Error(`LoRA「${lora.name}」强度越界：仅支持 -2 到 2（引擎限制），当前 ${strength}`);
    }

    // ACT: 拦截放在上传前，避免报错后已上传文件成为引擎侧孤儿；上限改动只动 maxImageReferences 一处。
    const submittedImages = request.images ?? [];
    if (submittedImages.length > maxImageReferences) throw new Error(`这类模型最多支持${maxImageReferences}张参考图，当前提交了${submittedImages.length}张`);
    const images: string[] = [];
    for (const image of submittedImages) images.push(await upload(this, token, agent, image, signal));

    // ACT: 画质档位不写死在供应商里——调用方（画布图片节点、MCP generateImage）传 quality 就照它走，
    // 省略才用 imageDefaultTier；比例在引擎 aspect 五档内只发 aspect（像素交给引擎按档位取），
    // 2:3 这类不在档内的用 tierImageDimensions 按档位预算推边长。size 对 H3 图像不生效（像素由档位决定）。
    // ACT: tier 只对 MiniMax-H3 图像有意义（引擎文档 "Not used by Qwen"）；默认的 Qwen 与老口径 freevideo-image
    // 都按 size 推 width/height，传了 quality 也不发 tier，档位引导见 packages/skills/filmProduction/references/07assetsImages.md。
    // Qwen 省略 size 时补声明档 2K（见 imageDefaultSize），否则 assetImport 非角色卡那类不传 size 的调用会掉到 1024 底档。
    const engineModel = imageModels[request.model];
    const tier = engineModel === "minimax-h3-image" ? imageTier(request.quality) : "";
    const useAspect = !!tier && !!request.ratio && imageAspects.includes(request.ratio);
    const dimensions = tier ? tierImageDimensions(request.ratio ?? "1:1", tier) : imageDimensions(request.ratio, request.size ?? imageDefaultSize[request.model ?? ""]);
    const { job } = await runJob(this, token, agent, {
      kind: "image",
      label: jobLabel(request, "image"),
      ref: makeRef('img', request),
      prompt: request.prompt,
      ...(useAspect ? { aspect: request.ratio } : dimensions),
      ...(engineModel ? { model: engineModel } : {}),
      ...(tier ? { tier } : {}),
      ...(typeof request.seed === "number" ? { seed: request.seed } : {}),
      ...(images.length ? { images } : {}),
      ...(loras.length ? { loras: loras.map(l => ({ name: l.name, strength: l.strength ?? 1, enabled: true })) } : {}),
    }, signal);
    const result = object(job.result ?? {});
    const url = result.url ?? result.file;
    if (typeof url !== "string" || !url) throw new Error("未返回生成结果");
    const data = await download(this, token, origin, url, signal);
    // ACT: 引擎按档位回不同容器——high 档实测回 .jpg（4736×3552），旧档回 .png；mimeType 跟着结果文件后缀走，
    // 否则 apps/server/src/utils/media/generation.ts 的 mime→扩展名映射会把 JPEG 字节存成 .png，
    // 下游 mediaDispatch.mimeOf 再按扩展名读回成 image/png，供应商就拿错类型收素材。
    const mimeType = /\.jpe?g$/i.test(String(result.file ?? "")) ? "image/jpeg" : "image/png";
    return [{ mediaType: "image", type: "binary", data, mimeType }];
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const origin = originOf(agent);
    // ACT: takes 条候选在引擎侧串行排队，超时按条数放大（30 分钟/条，封顶 150 分钟）。
    const takes = request.takes === undefined ? 1 : Math.round(request.takes);
    if (takes < 1 || takes > 8) throw new Error(`候选条数仅支持 1–8（引擎限制），当前 ${request.takes}`);
    const signal = AbortSignal.any([AbortSignal.timeout(Math.min(150, 30 * takes) * 60_000), ...(this.signal ? [this.signal] : [])]);

    // LoRA 参数校验与引擎映射（generate 任务：上限 32 条，strength ∈ [-4, 4]）。
    const loras = request.loras ?? [];
    if (loras.length > 32) throw new Error(`本镜头 LoRA 最多 32 个（引擎限制），当前 ${loras.length} 个`);
    for (const lora of loras) {
      if (!lora.name || typeof lora.name !== "string" || lora.name.length < 1 || lora.name.length > 512) throw new Error(`LoRA 名称不合法：须为 1–512 个字符`);
      const strength = lora.strength ?? 1;
      if (typeof strength !== "number" || !isFinite(strength) || strength < -4 || strength > 4) throw new Error(`LoRA「${lora.name}」强度越界：仅支持 -4 到 4（引擎限制），当前 ${strength}`);
    }
    // ACT: 引擎只在 POST /jobs 才校验「名字是否已装」（实测 /plan 返回 200，提交才 422 且是英文），
    // 所以清单比对必须在提交前本地做一次，否则 agent 写错一个名字要等真正开跑才看到英文报错。
    // 读不到名单（引擎离线/超时）就跳过这项——不能因为查不到档案把正常派工堵死，交给引擎兜底。
    if (loras.length) await assertInstalledLoras(this, token, agent, loras.map(lora => lora.name));

    // ACT: refine_from 与 prompt/seconds/media/quality 等全部生成参数互斥（引擎 schema 硬约束：
    // if refine_from then 其余字段一律 False），请求里带了 refineFrom 就走精修早退分支——
    // 不上传媒体、不拼提示词，只发 kind/refine_from/label/ref；预览片的参数由引擎从源任务继承。
    if (request.refineFrom) {
      if (!/^j[0-9a-f]{12}$/.test(request.refineFrom)) throw new Error(`预览任务号格式不对（应为 j+12 位十六进制）：${request.refineFrom.slice(0, 20)}`);
      const { job, jobId } = await runJob(this, token, agent, {
        kind: "generate",
        label: jobLabel(request, "video"),
        ref: makeRef('vid', request),
        refine_from: request.refineFrom,
        ...(request.releaseGpuAfter ? { release_gpu_after: true } : {}),
      }, signal);
      const result = object(job.result ?? {});
      const video = object(result.video ?? {});
      const url = video.url ?? result.url;
      if (typeof url !== "string" || !url) throw new Error("未返回生成结果");
      const data = await download(this, token, origin, url, signal);
      return [{ mediaType: "video", type: "binary", data, mimeType: "video/mp4", jobId }];
    }

    // ACT: 续接（continue_from）时引擎只允许 media.references，first/last 必须为空
    // （freevideo_engine/agent/schema.py 的 "only references when continue_from is supplied"）。
    // 参考图与续接是官方设计好的并存组合：references 每个续接段都看得到，用来保持同一批人。
    const continuing = Boolean(request.continueFrom);
    const media: Record<string, unknown> = {};
    if (!continuing) {
      if (request.firstFrame) media.first = await upload(this, token, agent, request.firstFrame, signal);
      if (request.lastFrame) media.last = await upload(this, token, agent, request.lastFrame, signal);
    }
    const references: (string | Record<string, unknown>)[] = [];
    for (const image of request.images ?? []) references.push(await upload(this, token, agent, image, signal));
    for (const video of request.videos ?? []) references.push(await upload(this, token, agent, video, signal));
    for (const audio of request.audios ?? []) references.push(await upload(this, token, agent, audio, signal));
    // ACT: 白模参考放**末位且不写标签**——引擎按类型在数组中的顺序编号 <Video N>，
    // 白模是 library 视频，放首位会把卡图参考的 Video 编号整体顶歪（实测混用通过的形状就是末位无标签）。
    // earlySteps 由派工侧按质量档换算（light/medium 首轮 8 步、high/max 单遍 16/20 步，≈ early_ratio × 首轮步数）。
    if (request.whitebox) {
      if (!/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}$/.test(request.whitebox.library)) throw new Error(`白模作品号格式不对（应为 日期/32位十六进制）：${request.whitebox.library.slice(0, 60)}`);
      references.push({ library: request.whitebox.library, early_steps: Math.max(1, Math.min(32, Math.round(request.whitebox.earlySteps))) });
    }
    if (references.length) media.references = references;
    // ACT: 续接时参考图上限是 3 张（引擎 guide："media.references with at most 3 pictures"），
    // 超限由引擎整任务拒绝，这里提前拦下并给出可执行的处置建议。白模占一个槽位，计入总数。
    if (continuing && references.length > 3) {
      throw new Error(`续接镜头最多 3 个参考素材（引擎限制，含白模），当前 ${references.length} 个；请减少参考或把该镜改为独立镜头`);
    }

    const seconds = clampSeconds(request.duration);
    // ACT: quality / secondPass 默认沿用原固定值（quality 曾写死 "light"），宿主显式传入才覆盖。
    // 引擎口径（agent guide）：light = 8 首轮步 + 3 refine 步二次采样，medium 同构但首轮更大更细节，
    // high/max = 20 步单次采样——two_pass 只在 8 首轮步时生效，选 high/max 时二次采样开关不改变引擎行为。
    // ACT: two_pass 是采样开关，必须嵌套在 sampling 对象里（sampling: { two_pass, base_steps?, refine_steps? }），
    // 不能发在 spec 顶层——引擎顶层 additionalProperties: false，顶层 two_pass 会被拒为
    // "<unknown> must be absent (unknown field); received True"（Pydantic v2 报错）。
    // 早期探针成功是因为 runProbe.py 只发 quality: "light"、从不发 two_pass，靠引擎默认补两遍；
    // videoJob.json 里顶层 two_pass 是引擎输出回显时展开的，不代表输入层。
    // 引擎 guide：sampling.two_pass=false 且不带 base_steps 时跑 20 步单遍；two_pass=true 固定 8 首轮步。
    // 质量档位 light/medium/high/max 由引擎据 quality 决定步数，这里不发 base_steps/refine_steps。
    const quality = request.quality ?? "light";
    const secondPass = request.secondPass ?? true;
    if (!["light", "medium", "high", "max"].includes(quality)) {
      throw new Error(`生成质量仅支持 light/medium/high/max（轻量/标准/精细/极致），当前「${quality}」`);
    }
    // ACT: 续接（continue_from）或 ≥30s 自动分块都要求二次采样文本生成，否则引擎整任务拒绝；
    // 提前拦下给出可执行的处置建议，与上面参考图上限拦截同风格。
    if ((seconds >= 30 || continuing) && !secondPass && quality !== "light" && quality !== "medium") {
      throw new Error("续接镜头或 30 秒以上的分块必须开启二次采样（引擎限制）；请开启二次采样，或把质量改为轻量/标准");
    }
    // ACT: preview 是引擎的快速预览模式（固定 8 步二次采样，无视 quality/secondPass 档位），
    // 用于先看效果，成片需另发 refine_from 任务——所以本节点开启 preview 时产出就是预览片。
    // 引擎 guide：多块或续接必须二次采样「且 no preview」，故预览只对单个 <30s 分块开放。
    const preview = request.preview ?? false;
    if (preview && (continuing || seconds >= 30)) {
      throw new Error("预览模式只支持单个 30 秒以内的分块（引擎限制）；续接镜头或 30 秒以上长镜请关闭预览后重试");
    }
    // ACT: first_frame_reference 只在 ≥30s 自动分块时减少跨块漂移；单段视频不受影响，
    // 运镜大/需要变化的场景规范建议关闭——保守取「≥30s 才开」，不引入开关面。
    // 续接任务由引擎自己维护上下文，不需要这个降级锚点。
    // ACT: part_prompts 条数必须等于引擎 chain_plan.blocks 数（≤5），条数不对引擎整任务拒收；
    // 派工侧先用 planVideo 拿块数再拆分，这里只做形状兜底（非空数组、每条非空）。
    const partPrompts = (request.partPrompts ?? []).map(item => item.trim()).filter(Boolean);
    if (partPrompts.length && (partPrompts.length > 5 || partPrompts.length !== (request.partPrompts?.length ?? 0))) {
      throw new Error(`逐块描述需为 1–5 条且与 POST /plan 的 blocks 数一致（引擎限制），当前有效 ${partPrompts.length} 条 / 传入 ${request.partPrompts?.length ?? 0} 条`);
    }
    const jobs = await runJobs(this, token, agent, {
      kind: "generate",
      label: jobLabel(request, "video"),
      ref: makeRef('vid', request),
      prompt: request.prompt,
      seconds,
      quality,
      sampling: { two_pass: preview ? true : secondPass },
      preview,
      ...(request.ratio ? { aspect: request.ratio } : {}),
      ...(request.resolution ? { megapixels: megapixels(request.resolution) } : {}),
      ...(seconds >= 30 && !continuing ? { first_frame_reference: true } : {}),
      ...(request.continueFrom ? { continue_from: { from_job: request.continueFrom } } : {}),
      ...(Object.keys(media).length ? { media } : {}),
      // ACT: seed 未传即不发（引擎按 null 自定种子）；传了就是重 roll 复现锚点（范围 0..2^53-1，宿主 zod 已拦）。
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      // 批次最后一个任务置 true 立即还显存；中间任务置 true 会让下一镜反复重载模型，由派工侧把关。
      ...(request.releaseGpuAfter ? { release_gpu_after: true } : {}),
      // takes 条候选：引擎逐条展开，带 seed 时候选种子 seed、seed+1…（整批可复现）。
      ...(takes > 1 ? { takes } : {}),
      ...(partPrompts.length ? { part_prompts: partPrompts } : {}),
      // LoRA：空数组不发该键（引擎默认 []），非空时逐条写 {name, strength} 对象形式。
      ...(loras.length ? { loras: loras.map(l => ({ name: l.name, strength: l.strength ?? 1 })) } : {}),
    }, signal);
    const assets: MediaAsset[] = [];
    for (const { job, jobId } of jobs) {
      const result = object(job.result ?? {});
      const video = object(result.video ?? {});
      const url = video.url ?? result.url;
      if (typeof url !== "string" || !url) continue;
      const data = await download(this, token, origin, url, signal);
      assets.push({ mediaType: "video", type: "binary", data, mimeType: "video/mp4", jobId });
    }
    if (!assets.length) throw new Error("未返回生成结果");
    return assets;
  },
  // 提交前预检：POST /plan 的 body 就是裸 generate spec（与 /jobs 同形状，无 kind 包装差异），
  // 返回 geometry / chain_plan / warnings。校验失败引擎按 422 逐字段报错，经 engineFailure 转成中文。
  async planVideo(request: VideoRequest) {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    const spec: Record<string, unknown> = {
      kind: "generate",
      prompt: request.prompt,
      seconds: clampSeconds(request.duration),
      quality: request.quality ?? "light",
      sampling: { two_pass: request.secondPass ?? true },
      ...(request.ratio ? { aspect: request.ratio } : {}),
      ...(request.resolution ? { megapixels: megapixels(request.resolution) } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    };
    const response = await this.tool.fetch(`${agent}/plan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(spec),
      // ACT: 有宿主信号时也要叠加 30s 上限——预检是同步接口，引擎重启/卡死时不能让 HTTP 路由无限挂。
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await engineFailure(response, "预检失败");
    const answer = object(await response.json());
    const chain = object(answer.chain_plan ?? {});
    const geo = object(answer.geometry ?? {});
    return {
      geometry: { width: Number(geo.width) || 0, height: Number(geo.height) || 0, seconds: Number(geo.seconds) || 0, frames: Number(geo.frames) || 0, fps: Number(geo.fps) || 24 },
      chainPlan: { seconds: Number(chain.seconds) || 0, single: chain.single === true, blocks: Array.isArray(chain.blocks) ? chain.blocks.map(block => ({ seconds: Number(object(block).seconds) || 0, frames: Number(object(block).frames) || 0 })) : [] },
      warnings: Array.isArray(answer.warnings) ? answer.warnings.map(String) : [],
    };
  },
  // 本机视觉模型问答（kind=vlm，走 /jobs 排队，与视频共 GPU 但引擎自动错峰）。
  // 素材经 upload() 换内部路径后随题下发；answers 与 questions 一一对应。
  // 引擎限制：单题 ≤16 图、全任务（图 + 视频采样帧）≤24；一次 ≤8 题。
  async askVlm(input: { questions: (string | { text: string; images?: MediaInput[]; video?: MediaInput })[]; system?: string; format?: "text" | "json"; label?: string }) {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    if (!input.questions.length) throw new Error("至少提一个问题");
    if (input.questions.length > 8) throw new Error(`一次最多 8 个问题（引擎限制），当前 ${input.questions.length} 个`);
    const agent = agentBase(this.config.baseUrl);
    // ACT: vlm 走 /jobs 排队，与视频共 GPU——引擎忙时排队时间不可控，10 分钟封顶（宿主信号存在时叠加）。
    // 原 5 分钟会在「前面有长视频在跑」时把正常排队的问答误判为失败。
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(10 * 60_000)]) : AbortSignal.timeout(10 * 60_000);
    const questions = [];
    let mediaCount = 0;
    for (const question of input.questions) {
      if (typeof question === "string") { questions.push(question); continue; }
      const images: string[] = [];
      for (const image of question.images ?? []) images.push(await upload(this, token, agent, image, signal));
      const video = question.video ? await upload(this, token, agent, question.video, signal) : undefined;
      mediaCount += images.length + (video ? 1 : 0);
      questions.push({ text: question.text, ...(images.length ? { images } : {}), ...(video ? { video } : {}) });
    }
    if (mediaCount > 24) throw new Error(`一次问答最多 24 个素材（引擎限制：图片 + 视频采样帧合计），当前 ${mediaCount} 个`);
    const { job } = await runJob(this, token, agent, {
      kind: "vlm",
      label: (input.label ?? "Toonflow 审片").slice(0, 120),
      ref: `toonflow-vlm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 128),
      questions,
      ...(input.format ? { format: input.format } : {}),
      ...(input.system ? { system: input.system } : {}),
    }, signal);
    const result = object(job.result ?? {});
    return { answers: Array.isArray(result.answers) ? result.answers : [] };
  },
  // 白模（3D blocking）：场景代码在用户打开的 FreeVideo 页面里渲染成参考视频，
  // ready 后 work 是作品库 id，生成时以 {library, early_steps} 放 references 末位引导构图与运镜。
  whitebox: {
    available: true,
    async getPrompt() {
      const token = this.config.apiKey?.trim();
      if (!token) throw new Error("请填写 Token");
      const agent = agentBase(this.config.baseUrl);
      const response = await this.tool.fetch(`${agent}/guide`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw await engineFailure(response, "读取白模规范失败");
      const guide = object(await response.json());
      const prompt = typeof guide.whitebox_scene_prompt === "string" ? guide.whitebox_scene_prompt : "";
      if (!prompt) throw new Error("当前引擎版本没有提供白模场景规范（whitebox_scene_prompt）");
      return prompt;
    },
    async create(code: string, summary: string) {
      const token = this.config.apiKey?.trim();
      if (!token) throw new Error("请填写 Token");
      if (!code.trim()) throw new Error("白模场景代码为空");
      if (code.length > 65536) throw new Error(`白模场景代码超过 65536 字符上限（当前 ${code.length}）；请减少物体数`);
      const agent = agentBase(this.config.baseUrl);
      const response = await this.tool.fetch(`${agent}/whitebox`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code, summary: summary.slice(0, 500) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw await engineFailure(response, "白模提交失败");
      const answer = object(await response.json());
      return { id: String(answer.id ?? ""), status: String(answer.status ?? "waiting") };
    },
    async get(id: string) {
      const token = this.config.apiKey?.trim();
      if (!token) throw new Error("请填写 Token");
      const agent = agentBase(this.config.baseUrl);
      const response = await this.tool.fetch(`${agent}/whitebox/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw await engineFailure(response, "白模状态读取失败");
      const answer = object(await response.json());
      return {
        id: String(answer.id ?? id),
        status: String(answer.status ?? "waiting"),
        ...(typeof answer.work === "string" ? { work: answer.work } : {}),
        ...(typeof answer.seconds === "number" ? { seconds: answer.seconds } : {}),
        ...(typeof answer.early_steps === "number" ? { earlySteps: answer.early_steps } : {}),
        ...(typeof answer.early_ratio === "number" ? { earlyRatio: answer.early_ratio } : {}),
        ...(answer.error ? { error: typeof answer.error === "string" ? answer.error : JSON.stringify(answer.error) } : {}),
      };
    },
  },
  // 引擎配乐（kind=music）：按时间线长度作曲并铺到音轨 a2 第 0 帧，产物长度=时间线长度。
  // 客户端只发 {revision, caption, seed?, quiet?}（kind/editor_project 由路由注入）；首次使用会下载 20GB 音乐模型。
  // 成功返回下载好的音频（aac/48k/2ch）与产物元信息；取音经 GET /projects/{id} 的 a2 clip.source
  // {kind:'generated', id:'freevideo-music/<file>.mp4'} → sources['generated:...'].audio url → Bearer 下载。
  async music(request: MusicRequest) {
    const token = this.config.apiKey?.trim();
    if (!token) throw new Error("请填写 Token");
    const agent = agentBase(this.config.baseUrl);
    if (!/^e-[0-9a-f]{32}$/.test(request.editorProjectId)) throw new Error(`编辑工程号格式不对（应为 e- 加 32 位十六进制）：${request.editorProjectId.slice(0, 40)}`);
    const caption = request.caption.trim();
    if (!caption) throw new Error("配乐描述（caption）不能为空");
    if (caption.length > 512) throw new Error(`配乐描述最长 512 字符（引擎限制），当前 ${caption.length} 个`);
    // 引擎只接受英文描述（music.py 直接传给作曲服务），明显非英文提前拦下给出可执行报错。
    if (!/^[\x20-\x7E]*$/.test(caption)) throw new Error("配乐描述请用英文（引擎作曲服务只接受 ASCII）：例如 'Epic orchestral, dramatic, with piano and strings'");
    if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 2 ** 32 - 1)) {
      throw new Error(`配乐种子需为 0..4294967295 的整数（引擎限制），当前「${request.seed}」`);
    }
    // 先读工程：拿最新 revision、看 a2 轨是否已有音乐（有则先 remove，否则引擎 audio_full 拒）。
    const projectResponse = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!projectResponse.ok) throw await engineFailure(projectResponse, "读取编辑工程失败");
    const projectResponseBody = object(await projectResponse.json());
    const project = projectOf(projectResponseBody);
    let revision = typeof project.revision === "number" ? project.revision : request.revision;
    const tracks = Array.isArray(project.tracks) ? project.tracks : [];
    const a2 = object(tracks.find(track => object(track).id === "a2") ?? {});
    const a2Clips = Array.isArray(a2.clips) ? a2.clips : [];
    const a2Ids = a2Clips.map(clip => object(clip).id).filter((id): id is string => typeof id === "string");
    // 成片时长对齐（可选）：把成片导入 v1 轨第 0 帧，让时间线长度=成片长度。
    // 只有 provider 在 VM 内能调 /imports + /operations，故放在这里；sourceVideo 由 server 层转 base64。
    if (request.sourceVideo) {
      // /imports 接受 JSON {name, data_base64} 或 multipart file；这里走 JSON（直接 base64，无需先 POST /media）。
      if (request.sourceVideo.type !== "base64") throw new Error("成片需以 base64 传入（由服务端读取工作区文件后提供）");
      const bytes = Buffer.from(request.sourceVideo.data.replace(/^data:[^;]+;base64,/, ""), "base64");
      const importResponse = await this.tool.fetch(`${agent}/imports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `toonflow_score_${Date.now().toString(16)}.${extensionFor(request.sourceVideo)}`,
          data_base64: Buffer.from(bytes).toString("base64"),
        }),
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
      if (!importResponse.ok) throw await engineFailure(importResponse, "成片导入失败");
      const importResult = object(await importResponse.json());
      const imported = object(importResult.import ?? importResult);
      const importId = typeof imported.id === "string" ? imported.id : "";
      if (!importId) throw new Error("成片导入未返回素材 id：请重试");
      // 等导入转码 ready 再 insert（否则引擎 409 source_missing：未 ready 的 import 源被当成缺失分段）。
      await waitImportReady(this, token, agent, importId, this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000));
      // 重读工程（revision 可能已变），v1 轨已有视频 clip 先 remove，再把成片插到第 0 帧。
      const freshResponse = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      if (!freshResponse.ok) throw await engineFailure(freshResponse, "读取编辑工程失败");
      const fresh = projectOf(object(await freshResponse.json()));
      let freshRevision = typeof fresh.revision === "number" ? fresh.revision : revision;
      const freshTracks = Array.isArray(fresh.tracks) ? fresh.tracks : [];
      const v1 = object(freshTracks.find(track => object(track).id === "v1") ?? {});
      const v1Ids = (Array.isArray(v1.clips) ? v1.clips : [])
        .map(clip => object(clip).id).filter((id): id is string => typeof id === "string");
      const alignOps: Record<string, unknown>[] = [];
      if (v1Ids.length) alignOps.push({ op: "remove", clip_ids: v1Ids });
      alignOps.push({ op: "insert", source: `import:${importId}`, at: 0 });
      const alignResponse = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}/operations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision: freshRevision, operations: alignOps }),
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      if (!alignResponse.ok) throw await engineFailure(alignResponse, "成片时长对齐失败");
      const aligned = object(await alignResponse.json());
      const alignedProject = object(aligned.project ?? {});
      if (typeof alignedProject.revision === "number") revision = alignedProject.revision;
      else {
        // 防御分支：/operations 正常响应总带 project.revision（上面的真分支直接采用），
        // 但若引擎返回结构异常（project 缺失/无 revision），这里再读一次工程兜底拿最新 revision，
        // 避免后续作曲任务用过期 revision 撞 409 project_changed。
        // ACT: Response.json() 会消费 body 流，**只能调用一次**——同一 Response 上第二次 json()
        // 抛 `TypeError: body is unusable`（bodyUsed=true）。早期版本条件里和这里各调一次 again.json()，
        // 该防御分支一触发就抛这个假错误；现改为单次 json() + typeof 类型守卫，避免重复消费。
        const again = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        });
        if (!again.ok) throw await engineFailure(again, "读取编辑工程失败");
        const againProject = projectOf(object(await again.json()));
        if (typeof againProject.revision === "number") revision = againProject.revision;
      }
    }
    // a2 轨已有音乐时先 remove（引擎 lay_music 在 a2 已有 clip 时返回 audio_full），
    // 契约要求 {revision, operations:[...]}（schema.py project_schema('operations') 强制 ('revision','operations')）。
    if (a2Ids.length) {
      const removeResponse = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}/operations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision, operations: [{ op: "remove", clip_ids: a2Ids }] }),
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      if (!removeResponse.ok) throw await engineFailure(removeResponse, "移除旧配乐失败");
      // 移除后 revision 已变，重新读一次（operations 返回新 revision，但保守起见再读工程）。
      const again = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      if (!again.ok) throw await engineFailure(again, "读取编辑工程失败");
      const projectAgain = projectOf(object(await again.json()));
      revision = typeof projectAgain.revision === "number" ? projectAgain.revision : revision;
    }
    // 提交作曲任务（与 /jobs 同构：返回 {job, jobs:[...]}，取第一个）。
    const musicSpec: Record<string, unknown> = { revision, caption };
    if (request.seed !== undefined) musicSpec.seed = request.seed;
    if (request.quiet?.length) musicSpec.quiet = request.quiet.map(span => ({ start: span.start, frames: span.frames }));
    const { job, jobId } = await runJob(this, token, agent, {
      kind: "music",
      editor_project: request.editorProjectId,
      ...musicSpec,
    }, this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000));
    // 音乐首次使用要下 20GB 模型，跑完可能长达几十分钟；状态机同 generate（waiting→queued→running→succeeded/failed）。
    if (String(job.status) !== "succeeded") throw new Error(engineJobMessage(job, "配乐生成未完成"));
    // 成功后重新读工程，从 a2 轨找生成的音乐 clip，经 sources 拿下载地址。
    const musicProject = await this.tool.fetch(`${agent}/projects/${encodeURIComponent(request.editorProjectId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!musicProject.ok) throw await engineFailure(musicProject, "读取编辑工程失败");
    const finalProjectBody = object(await musicProject.json());
    const finalProject = projectOf(finalProjectBody);
    const finalTracks = Array.isArray(finalProject.tracks) ? finalProject.tracks : [];
    const finalA2 = object(finalTracks.find(track => object(track).id === "a2") ?? {});
    const finalClips = Array.isArray(finalA2.clips) ? finalA2.clips : [];
    // 取音路径：music job 的 result.source 是权威 source key（GET /projects 的 sources 映射可能为 null，
    // 但下载端点 /editor/sources/content 直接按 key 取文件，无需 sources 映射）。先取 result.source，
    // 再兜底到 a2 轨扫描（原实现先扫 a2，sourceKey 空即抛错，导致 result.source 分支不可达）。
    const result = object(job.result ?? {});
    const resultSource = typeof result.source === "string" ? result.source : "";
    let sourceKey = "";
    let jobSource = "";
    if (resultSource.startsWith("generated:")) {
      jobSource = resultSource.slice("generated:".length);
      sourceKey = resultSource;
    } else {
      for (const clip of finalClips) {
        const clipObj = object(clip);
        const source = object(clipObj.source ?? {});
        if (source.kind === "generated" && typeof source.id === "string" && source.id.startsWith("freevideo-music/")) {
          jobSource = source.id;
          sourceKey = `generated:${source.id}`;
          break;
        }
      }
    }
    if (!sourceKey) throw new Error("配乐完成但音轨 a2 没找到生成的音乐片段：请重新读取工程确认");
    let url = "";
    if (resultSource) {
      url = `${originOf(this.config.baseUrl)}/freevideo/agent/v1/editor/sources/content?key=${encodeURIComponent(resultSource)}&file=preview`;
    }
    if (!url) {
      const sources = object(finalProjectBody.sources ?? {});
      const entry = object(sources[sourceKey] ?? {});
      const audio = object(entry.audio ?? {});
      url = typeof audio.url === "string" ? audio.url : "";
    }
    if (!url) throw new Error("配乐完成但没有返回音频下载地址：请重新读取工程确认");
    const data = await download(this, token, originOf(this.config.baseUrl), url, this.signal ?? AbortSignal.timeout(60_000));
    return {
      mediaType: "audio",
      type: "binary",
      data,
      mimeType: "audio/mp4",
      jobId,
      frames: Number(result.frames) || 0,
      seed: Number(result.seed) || 0,
      source: jobSource,
    };
  },
} satisfies ProviderDefinition<typeof rules>;
