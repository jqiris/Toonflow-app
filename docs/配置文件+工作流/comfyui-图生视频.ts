/**
 * Toonflow AI供应商模板
 * @version 3.2 (适配 i2v(newnew).json 工作流)
 */

// ============================================================
// 类型定义 (保持不变)
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel { name: string; modelName: string; type: "text"; think: boolean; }
interface ImageModel { name: string; modelName: string; type: "image"; mode: ("text" | "singleImage" | "multiReference")[]; associationSkills?: string; }
interface VideoModel {
  name: string; modelName: string; type: "video"; mode: VideoMode[]; associationSkills?: string;
  audio: "optional" | false | true; durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface TTSModel { name: string; modelName: string; type: "tts"; voices: { title: string; voice: string }[]; }
interface VendorConfig {
  id: string; version: string; name: string; author: string; description?: string; icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>; models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };
interface ImageConfig { prompt: string; referenceList?: Extract<ReferenceList, { type: "image" }>[]; size: "1K" | "2K" | "4K"; aspectRatio: `${number}:${number}`; }
interface VideoConfig { duration: number; resolution: string; aspectRatio: "16:9" | "9:16"; prompt: string; referenceList?: ReferenceList[]; audio?: boolean; mode: VideoMode[]; }
interface PollResult { completed: boolean; data?: string; error?: string; }
interface TTSConfig { text: string; voice: string; speed?: number; volume?: number; }

// ============================================================
// 全局声明 (保持不变)
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
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
  textRequest: (m: TextModel) => any;
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
  id: "comfyui_local_ltx23_v6",
  version: "3.2",
  name: "Local ComfyUI LTX 2.3 (ne)",
  author: "Toonflow",
  description: "## 基于 video_ltx2_3_i2v(ne).json 工作流适配器。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: { baseUrl: "http://localhost:8188" },
  models: [{
    name: "LTX 2.3 (本地工作流 new)",
    modelName: "local-ltx-2.3-new",
    type: "video",
    mode: ["singleImage"],
    audio: false,
    durationResolutionMap: [
      { duration: [3, 6, 8, 10], resolution: ["480p", "720p", "1080p"] } // 新增480p选项
    ],
    associationSkills: "基于 video_ltx2_3_i2v(new).json 工作流运行本地 ComfyUI 节点进行视频生成。"
  }],
};

// ============================================================
// 最新工作流 JSON
// ============================================================
const WORKFLOW_JSON = {
  "75": {
    "inputs": {
      "filename_prefix": "video/LTX_2.3_i2v",
      "format": "mp4",
      "codec": "h264",
      "video": [
        "167:136",
        0
      ]
    },
    "class_type": "SaveVideo",
    "_meta": { "title": "保存视频" }
  },
  "98": {
    "inputs": { "image": "temp.jpg" },
    "class_type": "LoadImage",
    "_meta": { "title": "加载图像" }
  },
  "167:126": { "inputs": { "sampler_name": "euler" }, "class_type": "KSamplerSelect", "_meta": { "title": "K采样器选择" } },
  "167:127": { "inputs": { "steps": 20, "max_shift": 2.05, "base_shift": 0.95, "stretch": true, "terminal": 0.1, "latent": ["167:143", 0] }, "class_type": "LTXVScheduler", "_meta": { "title": "LTXV调度器" } },
  "167:128": { "inputs": { "sampler_name": "gradient_estimation" }, "class_type": "KSamplerSelect", "_meta": { "title": "K采样器选择" } },
  "167:129": { "inputs": { "sigmas": "0.909375, 0.725, 0.421875, 0.0" }, "class_type": "ManualSigmas", "_meta": { "title": "自定义Sigmas" } },
  "167:130": { "inputs": { "positive": ["167:133", 0], "negative": ["167:133", 1], "latent": ["167:137", 0] }, "class_type": "LTXVCropGuides", "_meta": { "title": "LTXV裁剪指导" } },
  "167:131": { "inputs": { "cfg": 1, "model": ["167:155", 0], "positive": ["167:130", 0], "negative": ["167:130", 1] }, "class_type": "CFGGuider", "_meta": { "title": "CFG引导器" } },
  "167:132": { "inputs": { "frames_number": ["167:146", 0], "frame_rate": 25, "batch_size": 1, "audio_vae": ["167:142", 0] }, "class_type": "LTXVEmptyLatentAudio", "_meta": { "title": "LTXV 空音频潜空间" } },
  "167:134": { "inputs": { "noise": ["167:165", 0], "guider": ["167:154", 0], "sampler": ["167:126", 0], "sigmas": ["167:127", 0], "latent_image": ["167:143", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "自定义采样器（高级）" } },
  "167:135": { "inputs": { "noise_seed": 0 }, "class_type": "RandomNoise", "_meta": { "title": "随机噪波" } },
  "167:137": { "inputs": { "av_latent": ["167:134", 0] }, "class_type": "LTXVSeparateAVLatent", "_meta": { "title": "LTXV分离音视频潜空间" } },
  "167:139": { "inputs": { "av_latent": ["167:140", 1] }, "class_type": "LTXVSeparateAVLatent", "_meta": { "title": "LTXV分离音视频潜空间" } },
  "167:140": { "inputs": { "noise": ["167:135", 0], "guider": ["167:131", 0], "sampler": ["167:128", 0], "sigmas": ["167:129", 0], "latent_image": ["167:152", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "自定义采样器（高级）" } },
  "167:141": { "inputs": { "samples": ["167:139", 1], "audio_vae": ["167:142", 0] }, "class_type": "LTXVAudioVAEDecode", "_meta": { "title": "LTXV音频VAE解码" } },
  "167:142": { "inputs": { "ckpt_name": "ltx-2.3-22b-dev-fp8.safetensors" }, "class_type": "LTXVAudioVAELoader", "_meta": { "title": "LTXV音频VAE加载器" } },
  "167:143": { "inputs": { "video_latent": ["167:151", 0], "audio_latent": ["167:132", 0] }, "class_type": "LTXVConcatAVLatent", "_meta": { "title": "LTXVConcatAVLatent" } },
  "167:144": { "inputs": { "samples": ["167:130", 2], "upscale_model": ["167:156", 0], "vae": ["167:162", 2] }, "class_type": "LTXVLatentUpsampler", "_meta": { "title": "spatial" } },
  "167:145": { "inputs": { "upscale_method": "lanczos", "scale_by": 0.5, "image": ["167:157", 0] }, "class_type": "ImageScaleBy", "_meta": { "title": "缩放图像（比例）" } },
  "167:146": { "inputs": { "value": 121 }, "class_type": "PrimitiveInt", "_meta": { "title": "Length" } },
  "167:147": { "inputs": { "image": ["167:145", 0] }, "class_type": "GetImageSize", "_meta": { "title": "获取图像尺寸" } },
  "167:148": { "inputs": { "image": ["167:102", 0] }, "class_type": "GetImageSize", "_meta": { "title": "获取图像尺寸" } },
  "167:149": { "inputs": { "img_compression": 33, "image": ["167:158", 0] }, "class_type": "LTXVPreprocess", "_meta": { "title": "LTXV预处理" } },
  "167:150": { "inputs": { "width": ["167:147", 0], "height": ["167:147", 1], "length": ["167:146", 0], "batch_size": 1 }, "class_type": "EmptyLTXVLatentVideo", "_meta": { "title": "空Latent视频（LTXV）" } },
  "167:151": { "inputs": { "strength": 1, "bypass": false, "vae": ["167:162", 2], "image": ["167:149", 0], "latent": ["167:150", 0] }, "class_type": "LTXVImgToVideoInplace", "_meta": { "title": "LTXV图像转视频（原地）" } },
  "167:152": { "inputs": { "video_latent": ["167:153", 0], "audio_latent": ["167:137", 1] }, "class_type": "LTXVConcatAVLatent", "_meta": { "title": "LTXVConcatAVLatent" } },
  "167:153": { "inputs": { "strength": 1, "bypass": false, "vae": ["167:162", 2], "image": ["167:149", 0], "latent": ["167:144", 0] }, "class_type": "LTXVImgToVideoInplace", "_meta": { "title": "LTXV图像转视频（原地）" } },
  "167:154": { "inputs": { "cfg": 4, "model": ["167:162", 0], "positive": ["167:133", 0], "negative": ["167:133", 1] }, "class_type": "CFGGuider", "_meta": { "title": "CFG引导器" } },
  "167:155": { "inputs": { "lora_name": "ltx-2.3-22b-distilled-lora-384.safetensors", "strength_model": 1, "model": ["167:162", 0] }, "class_type": "LoraLoaderModelOnly", "_meta": { "title": "LoRA加载器（仅模型）" } },
  "167:156": { "inputs": { "model_name": "ltx-2.3-spatial-upscaler-x2-1.0.safetensors" }, "class_type": "LatentUpscaleModelLoader", "_meta": { "title": "加载Latent放大模型" } },
  "167:157": { "inputs": { "width": ["167:148", 0], "height": ["167:148", 1], "batch_size": 1, "color": 0 }, "class_type": "EmptyImage", "_meta": { "title": "空图像" } },
  "167:158": { "inputs": { "longer_edge": 1536, "images": ["167:102", 0] }, "class_type": "ResizeImagesByLongerEdge", "_meta": { "title": "缩放图像（长边）" } },
  "167:162": { "inputs": { "ckpt_name": "ltx-2.3-22b-dev-fp8.safetensors" }, "class_type": "CheckpointLoaderSimple", "_meta": { "title": "Checkpoint加载器（简易）" } },
  "167:165": { "inputs": { "noise_seed": 10 }, "class_type": "RandomNoise", "_meta": { "title": "随机噪波" } },
  "167:102": { "inputs": { "resize_type": "scale dimensions", "resize_type.width": 1280, "resize_type.height": 720, "resize_type.crop": "center", "scale_method": "lanczos", "input": ["98", 0] }, "class_type": "ResizeImageMaskNode", "_meta": { "title": "调整图像/掩码大小" } },
  "167:133": { "inputs": { "frame_rate": 25, "positive": ["167:160", 0], "negative": ["167:159", 0] }, "class_type": "LTXVConditioning", "_meta": { "title": "LTXV条件" } },
  "167:159": { "inputs": { "text": "blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles", "clip": ["167:161", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP文本编码" } },
  "167:160": { "inputs": { "text": ["167:164", 0], "clip": ["167:161", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP文本编码" } },
  "167:138": { "inputs": { "samples": ["167:139", 0], "vae": ["167:162", 2] }, "class_type": "VAEDecode", "_meta": { "title": "VAE解码" } },
  "167:136": { "inputs": { "fps": 24, "images": ["167:138", 0], "audio": ["167:141", 0] }, "class_type": "CreateVideo", "_meta": { "title": "创建视频" } },
  "167:161": { "inputs": { "text_encoder": "gemma_3_12B_it_fpmixed.safetensors", "ckpt_name": "ltx-2.3-22b-dev-fp8.safetensors", "device": "default" }, "class_type": "LTXAVTextEncoderLoader", "_meta": { "title": "LTXV音频文本编码器加载器" } },
  "167:164": { "inputs": { "prompt": "", "max_length": 256, "sampling_mode": "on", "sampling_mode.temperature": 0.7, "sampling_mode.top_k": 64, "sampling_mode.top_p": 0.95, "sampling_mode.min_p": 0.05, "sampling_mode.repetition_penalty": 1.05, "sampling_mode.seed": 0, "sampling_mode.presence_penalty": 0, "thinking": false, "use_default_template": true, "clip": ["167:161", 0], "image": ["167:102", 0] }, "class_type": "TextGenerateLTX2Prompt", "_meta": { "title": "TextGenerateLTX2Prompt" } },
  "167:166": { "inputs": { "preview_markdown": "", "preview_text": "", "previewMode": null, "source": ["167:164", 0] }, "class_type": "PreviewAny", "_meta": { "title": "预览任意" } }
};

// ============================================================
// 稳定版：视频转 Base64（不会卡死）
// ============================================================
const videoToBase64 = async (url: string): Promise<string> => {
  try {
    const resp = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 180000
    });
    const base64 = Buffer.from(resp.data).toString('base64');
    return `data:video/mp4;base64,${base64}`;
  } catch (err: any) {
    logger(`视频转Base64失败: ${err.message}`);
    throw err;
  }
};

// ============================================================
// 适配器函数
// ============================================================
const textRequest = (model: TextModel) => { throw new Error("不支持文本生成"); };
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => { return ""; };

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");
  if (!config.referenceList || config.referenceList.length === 0) throw new Error("缺少参考图片");

  let rawBase64 = config.referenceList[0].base64;
  if (rawBase64.includes(',')) {
    rawBase64 = rawBase64.split(',')[1];
  }
  if (!rawBase64 || rawBase64.trim().length < 100) {
    throw new Error("图片 Base64 数据为空或格式错误，请检查图片是否损坏。");
  }

  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  workflow["98"] = {
    class_type: "easy loadImageBase64",
    inputs: {
      base64_data: rawBase64,
      image_output: "Preview",
      save_prefix: "ComfyUI"
    }
  };

  workflow["167:164"]["inputs"]["prompt"] = config.prompt;

  // ==============================
  // 【核心】完全按你规则：输入几秒就算几秒！
  // 帧数 = 秒数 × 24 + 1
  // ==============================
  const seconds = config.duration;
  const frameCount = seconds * 24 + 1;
  workflow["167:146"]["inputs"]["value"] = frameCount;
  logger(`时长：${seconds}秒 → 帧数：${frameCount}`);

  // ==============================
  // 尺寸：16:9 / 9:16 + 480p / 1080p
  // ==============================
  let width = 1920, height = 1080;
  if (config.resolution === "480p") {
    if (config.aspectRatio === "16:9") { width = 854; height = 480; }
    else { width = 480; height = 854; }
  } else if (config.resolution === "1080p") {
    if (config.aspectRatio === "16:9") { width = 1920; height = 1080; }
    else { width = 1080; height = 1920; }
  }
  workflow["167:102"]["inputs"]["resize_type.width"] = width;
  workflow["167:102"]["inputs"]["resize_type.height"] = height;
  logger(`尺寸：${config.aspectRatio} ${config.resolution} → ${width}x${height}`);

  logger("发送到 ComfyUI...");

  try {
    logger(12);

    // 替换：axios.post → fetch POST
    const submitResp = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: workflow }),
    });

    // fetch 必须手动解析 JSON
    const submitData = await submitResp.json();
    logger(77);

    const promptId = submitData.prompt_id;
    logger(99);

    logger(`任务提交成功：${promptId}`);

    const result = await pollTask(async () => {
      // 替换：axios.get → fetch GET
      const historyResp = await fetch(`${baseUrl}/history`);
      const history = await historyResp.json();

      const run = history[promptId];
      if (!run) return { completed: false };
      if (run.status?.exec_info?.error) return { completed: true, error: run.status.exec_info.error };

      const output = run.outputs["75"];
      if (output?.images?.length > 0) return { completed: true, data: output.images[0] };
      return { completed: false };
    }, 3000, 600000);

    if (result.error) throw new Error(`失败：${result.error}`);
    if (!result.data) throw new Error("未找到视频");

    const fileInfo = result.data;
    const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder)}&type=${fileInfo.type}`;
    return await urlToBase64(downloadUrl);

  } catch (e: any) {
    // fetch 错误结构和 axios 不同，这里做兼容
    logger(e?.response || e);
    logger(`错误：${e.message}`);
    throw new Error("错误");
  }
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => { return ""; };
const checkForUpdates = async () => ({ hasUpdate: false, latestVersion: "3.2", notice: "已修复Base64+适配8倍数时长+480p/9:16分辨率" });
const updateVendor = async () => { return ""; };

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export { };