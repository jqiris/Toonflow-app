/**
 * Toonflow AI供应商模板 - Agnes AI
 * @version 1.0
 *
 * Agnes AI 图像/视频生成 API 适配。
 * 平台地址：https://agnes-ai.com/
 * API地址：https://apihub.agnes-ai.com
 *
 * 支持：
 * - Agnes Image 2.1 Flash：文生图 (Text-to-Image)、图生图 (Image-to-Image)
 * - Agnes Video V2.0：文生视频 (Text-to-Video)、图生视频 (Image-to-Video)、多图生视频、关键帧动画
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  imageBase64?: string[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const crypto: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "agnes",
  version: "1.0",
  author: "Toonflow",
  name: "Agnes AI",
  description:
    "Agnes AI 图像/视频生成平台适配，支持文生图、图生图、文生视频、图生视频等能力。\n\n[前往平台](https://agnes-ai.com/)\n\n在 Agnes AI 平台获取 API Key 后填入下方配置。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "Agnes AI API Key" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "https://apihub.agnes-ai.com" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://apihub.agnes-ai.com",
  },
  models: [
    // 图像模型
    {
      name: "Agnes Image 2.1 Flash",
      modelName: "agnes-image-2.1-flash",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    // 视频模型
    {
      name: "Agnes Video V2.0",
      modelName: "agnes-video-v2.0",
      type: "video",
      mode: ["text", "singleImage", ["imageReference:9"], "startEndRequired", "endFrameOptional", "startFrameOptional"],
      audio: false,
      durationResolutionMap: [{ duration: [5, 10, 15], resolution: ["720p", "1080p"] }],
    },
  ],
};

// ============================================================
// MinIO 配置
// ============================================================

const MINIO_CONFIG = {
  endpoint: "15.tcp.cpolar.top",
  port: 14912,
  accessKey: "jason",
  secretKey: "lanyan18516536416",
  bucket: "aiimage",
  useSSL: false,
};

/** 获取 MinIO 对象的公开访问 URL */
const getMinioPublicUrl = (objectName: string): string => {
  const protocol = MINIO_CONFIG.useSSL ? "https" : "http";
  return `${protocol}://${MINIO_CONFIG.endpoint}:${MINIO_CONFIG.port}/${MINIO_CONFIG.bucket}/${objectName}`;
};

// ============================================================
// AWS S3 Signature V4 签名工具
// ============================================================

/**
 * 生成 AWS S3 Signature V4 签名所需的 Authorization header
 * 用于直接调用 MinIO S3 兼容 REST API
 */
const signS3V4 = (
  method: string,
  path: string,
  headers: Record<string, string>,
  payloadHash: string,
  region: string,
  service: string,
  accessKey: string,
  secretKey: string,
  datetime: string,
  date: string,
): string => {
  // 1. Canonical Request
  const canonicalHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `${k}:${headers[k].trim()}`)
    .join("\n");
  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, "", signedHeaders, payloadHash].join("\n");

  // 2. String to Sign
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = ["AWS4-HMAC-SHA256", datetime, credentialScope, canonicalRequestHash].join("\n");

  // 3. Signing Key
  const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), "aws4_request");

  // 4. Signature
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
};

/**
 * 将 base64 图片上传到 MinIO，返回公开访问 URL
 *
 * 使用 AWS S3 Signature V4 签名直接调用 MinIO PUT Object API
 */
const uploadBase64ToMinio = async (base64Data: string, objectName?: string): Promise<string> => {
  // 解析 base64 数据
  const matches = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  const mimeType = matches ? matches[1] : "image/png";
  const rawBase64 = matches ? matches[2] : base64Data;
  const buffer = Buffer.from(rawBase64, "base64");

  // 生成唯一对象名
  const name = objectName || `agnes-video-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;

  const protocol = MINIO_CONFIG.useSSL ? "https" : "http";
  const host = `${MINIO_CONFIG.endpoint}:${MINIO_CONFIG.port}`;
  const path = `/${MINIO_CONFIG.bucket}/${name}`;

  // S3 V4 签名参数
  const datetime = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const date = datetime.substring(0, 8);
  const region = "us-east-1";
  const service = "s3";
  const payloadHash = crypto.createHash("sha256").update(buffer).digest("hex");

  const headers: Record<string, string> = {
    host,
    "content-type": mimeType,
    "content-length": String(buffer.length),
    "x-amz-acl": "public-read",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": datetime,
  };

  const authorization = signS3V4("PUT", path, headers, payloadHash, region, service, MINIO_CONFIG.accessKey, MINIO_CONFIG.secretKey, datetime, date);
  headers["authorization"] = authorization;

  const url = `${protocol}://${host}${path}`;

  logger(`[uploadBase64ToMinio] 上传图片到 MinIO: ${url}, 大小: ${buffer.length} bytes`);

  const response = await axios.put(url, buffer, {
    headers,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MinIO 上传失败，状态码: ${response.status}, 响应: ${JSON.stringify(response.data)}`);
  }

  const publicUrl = getMinioPublicUrl(name);
  logger(`[uploadBase64ToMinio] 上传成功，公开 URL: ${publicUrl}`);
  return publicUrl;
};

// ============================================================
// 辅助工具
// ============================================================

/**
 * 将 aspectRatio + size 映射为 Agnes Image API 所需的 size 字符串
 * Agnes Image 支持的 size 格式: "宽x高"，如 "1024x768"
 */
const IMAGE_SIZE_MAP: Record<string, Record<string, string>> = {
  "16:9": {
    "1K": "1344x768",
    "2K": "1920x1080",
    "4K": "2560x1440",
  },
  "9:16": {
    "1K": "768x1344",
    "2K": "1080x1920",
    "4K": "1440x2560",
  },
  "1:1": {
    "1K": "768x768",
    "2K": "1024x1024",
    "4K": "1440x1440",
  },
  "4:3": {
    "1K": "1024x768",
    "2K": "1440x1080",
    "4K": "1920x1440",
  },
  "3:4": {
    "1K": "768x1024",
    "2K": "1080x1440",
    "4K": "1440x1920",
  },
};

/**
 * 将 duration (秒) 转换为 num_frames
 * num_frames 必须满足 8n+1 规则且 <= 441
 * frame_rate 默认 24
 * 常用值: 81(3.4s@24fps), 121(5s@24fps), 161(6.7s@24fps), 241(10s@24fps), 441(18.4s@24fps)
 */
const durationToNumFrames = (duration: number): number => {
  const frameRate = 24;
  const exactFrames = duration * frameRate;
  // 找到最接近的满足 8n+1 的值
  const candidates = [81, 121, 161, 241, 441];
  let best = candidates[0];
  let bestDiff = Math.abs(candidates[0] - exactFrames);
  for (const c of candidates) {
    const diff = Math.abs(c - exactFrames);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
};

/**
 * 将 resolution + aspectRatio 映射为 Agnes Video API 所需的 width/height
 */
const VIDEO_RESOLUTION_MAP: Record<string, Record<string, { width: number; height: number }>> = {
  "720p": {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
  },
  "1080p": {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
  },
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("Agnes AI 不支持文本模型");
};

/**
 * 图像生成请求
 *
 * Agnes Image 2.1 Flash API:
 * - Endpoint: POST /v1/images/generations
 * - Text-to-Image: model + prompt + size 必填，return_base64: true 获取 base64
 * - Image-to-Image: 图片放在 extra_body.image 数组中，extra_body.response_format: "b64_json"
 * - 认证: Authorization: Bearer API_KEY
 */
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;

  // 解析 size
  const size = IMAGE_SIZE_MAP[config.aspectRatio]?.[config.size] ?? "1024x768";

  // 过滤掉 null/undefined/空字符串的图片数据，并转为 Data URI 格式
  const validImages = (config.imageBase64 || [])
    .filter((img) => img && typeof img === "string" && img.length > 0)
    .map((img) => (img.startsWith("data:") ? img : `data:image/png;base64,${img}`));
  const hasImage = validImages.length > 0;

  let body: Record<string, any>;

  if (hasImage) {
    // Image-to-Image: 图片放在 extra_body.image 中，response_format 放在 extra_body 中
    body = {
      model: model.modelName,
      prompt: config.prompt,
      size,
      extra_body: {
        image: validImages,
        response_format: "b64_json",
      },
    };
    logger(`[imageRequest] Image-to-Image，模型: ${model.modelName}，参考图数量: ${validImages.length}`);
  } else {
    // Text-to-Image: 使用 return_base64 获取 base64 输出
    body = {
      model: model.modelName,
      prompt: config.prompt,
      size,
      return_base64: true,
    };
    logger(`[imageRequest] Text-to-Image，模型: ${model.modelName}`);
  }

  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }

  const data = await response.json();

  // 优先取 b64_json，其次取 url
  if (data.data && data.data[0]) {
    if (data.data[0].b64_json) {
      return data.data[0].b64_json;
    }
    if (data.data[0].url) {
      return await urlToBase64(data.data[0].url);
    }
  }

  throw new Error("未能从响应中提取图片");
};

/**
 * 视频生成请求
 *
 * Agnes Video V2.0 API:
 * - 创建任务: POST /v1/videos
 * - 查询结果(推荐): GET /agnesapi?video_id=<VIDEO_ID>
 * - 查询结果(兼容): GET /v1/videos/<TASK_ID>
 * - Text-to-Video: model + prompt
 * - Image-to-Video: model + prompt + image (单图URL)
 * - Multi-Image: model + prompt + extra_body.image (多图URL数组)
 * - Keyframe Animation: model + prompt + extra_body.image + extra_body.mode: "keyframes"
 * - num_frames 满足 8n+1 规则，frame_rate 1-60
 * - 异步任务，返回 task_id 和 video_id
 * - 完成后 remixed_from_video_id 包含视频 URL
 *
 * 注意：Agnes Video API 的顶层 image 字段只接受公开 URL。
 * 但 extra_body.image 支持 Data URI Base64（与 Image API 一致）。
 * 
 * 改造：图生视频时，先将 base64 图片上传到 MinIO 对象存储，
 * 获取公开 URL 后再传给 Agnes Video API，避免 base64 过大导致请求失败。
 */

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;

  const numFrames = durationToNumFrames(config.duration);
  const frameRate = 24;

  // 解析分辨率
  const res = VIDEO_RESOLUTION_MAP[config.resolution]?.[config.aspectRatio] ?? { width: 1280, height: 720 };

  // 判断当前模式
  const activeMode = config.mode && config.mode.length > 0 ? config.mode[0] : "text";
  // 过滤掉 null/undefined/空字符串的图片数据，并转为 Data URI 格式
  const validImages = (config.imageBase64 || [])
    .filter((img) => img && typeof img === "string" && img.length > 0)
    .map((img) => (img.startsWith("data:") ? img : `data:image/png;base64,${img}`));
  const hasImage = validImages.length > 0;

  // 将 base64 图片上传到 MinIO，获取公开 URL
  let imageUrls: string[] = [];
  if (hasImage) {
    logger(`[videoRequest] 开始上传 ${validImages.length} 张图片到 MinIO...`);
    imageUrls = await Promise.all(validImages.map((img) => uploadBase64ToMinio(img)));
    logger(`[videoRequest] 图片上传完成，URLs: ${JSON.stringify(imageUrls)}`);
  }

  let body: Record<string, any> = {
    model: model.modelName,
    prompt: config.prompt,
    num_frames: numFrames,
    frame_rate: frameRate,
  };

  if (hasImage) {
    // 使用 extra_body.image 传图片公开 URL（从 MinIO 获取）
    body.extra_body = {
      image: imageUrls,
    };

    // 首尾帧模式使用 keyframes
    if (activeMode === "startEndRequired" || activeMode === "endFrameOptional" || activeMode === "startFrameOptional") {
      body.extra_body.mode = "keyframes";
      logger(`[videoRequest] Keyframe Animation，模型: ${model.modelName}，关键帧数量: ${imageUrls.length}`);
    } else {
      logger(`[videoRequest] Image-to-Video，模型: ${model.modelName}，参考图数量: ${imageUrls.length}`);
    }
  } else {
    // Text-to-Video
    body.height = res.height;
    body.width = res.width;
    logger(`[videoRequest] Text-to-Video，模型: ${model.modelName}`);
  }

  // 提交视频生成任务
  const createResponse = await fetch(`${baseUrl}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`创建视频任务失败，状态码: ${createResponse.status}, 错误信息: ${errorText}`);
  }

  const createData = await createResponse.json();
  const videoId = createData.video_id;
  const taskId = createData.task_id || createData.id;

  logger(`[videoRequest] 视频任务已创建，video_id: ${videoId}, task_id: ${taskId}`);

  // 轮询查询结果
  const pollResult = await pollTask(async () => {
    let queryResponse: Response;
    let queryData: any;

    // 优先使用 video_id 查询（推荐方式）
    if (videoId) {
      queryResponse = await fetch(`${baseUrl}/agnesapi?video_id=${encodeURIComponent(videoId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } else {
      // 兼容方式：使用 task_id 查询
      queryResponse = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }

    if (!queryResponse.ok) {
      // 429 限流：不视为失败，继续轮询
      if (queryResponse.status === 429) {
        logger(`[videoRequest] 查询触发 429 限流，等待下次轮询`);
        return { completed: false };
      }
      const errorText = await queryResponse.text();
      return { completed: true, error: `查询视频任务失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}` };
    }

    queryData = await queryResponse.json();
    const status = queryData?.status;
    const progress = queryData?.progress;

    logger(`[videoRequest] 轮询响应: ${JSON.stringify(queryData).substring(0, 500)}`);

    switch (status) {
      case "completed":
      case "SUCCESS":
      case "success":
      case "succeeded": {
        // 视频URL在 remixed_from_video_id 字段中
        const videoUrl = queryData.remixed_from_video_id || queryData.video_url || queryData.data?.result_url;
        if (videoUrl) {
          logger(`[videoRequest] 视频生成完成，URL: ${videoUrl}`);
          return { completed: true, data: videoUrl };
        }
        return { completed: true, error: "视频已完成但未找到视频URL" };
      }
      case "FAILURE":
      case "failed":
      case "error": {
        const errMsg = typeof queryData.error === "string" ? queryData.error : JSON.stringify(queryData.error);
        logger(`[videoRequest] 视频生成失败: ${errMsg}`);
        return { completed: true, error: errMsg || "视频生成失败" };
      }
      default:
        return { completed: false };
    }
  }, 15000, 600000); // 15秒间隔，10分钟超时（避免触发 Agnes API 429 限流）

  if (pollResult.error) throw new Error(typeof pollResult.error === "string" ? pollResult.error : JSON.stringify(pollResult.error));
  return await urlToBase64(pollResult.data!);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  throw new Error("Agnes AI 不支持语音合成（TTS）");
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "1.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};
