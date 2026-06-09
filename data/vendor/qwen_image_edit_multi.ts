/**
 * Toonflow AI供应商 - Qwen Image Edit 多图参考（本地 ComfyUI）
 * @version 1.1
 *
 * 基于 Qwen-Image-Edit-2511 模型，支持最多3张参考图片的 AI 编辑工作流。
 * 需要 ComfyUI 环境已配置 Qwen-Image-Edit 模型及所需插件：
 * - ComfyUI-easy-use（提供 easy loadImageBase64 节点）
 * - Qwen-Image-Edit 自定义节点（TextEncodeQwenImageEditPlus, FluxKontextMultiReferenceLatentMethod 等）
 * - ResizeImageMaskNode 节点（参考图缩放）
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

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
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
  id: "qwen_image_edit_multi",
  version: "1.1",
  author: "Toonflow",
  name: "Qwen Image Edit 多图参考（本地 ComfyUI）",
  description: "基于本地 ComfyUI 的 Qwen-Image-Edit-2511 多图参考工作流，支持最多 3 张参考图片的 AI 编辑。参考图会自动缩放至指定长边尺寸。需要 ComfyUI 环境已配置 Qwen-Image-Edit 模型及自定义节点（TextEncodeQwenImageEditPlus, FluxKontextMultiReferenceLatentMethod, ResizeImageMaskNode 等）。",
  icon: "",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
    { key: "unetGguf", label: "UNet GGUF 模型名", type: "text", required: false, placeholder: "qwen-image-edit-2511-Q6_K.gguf" },
    { key: "clipModel", label: "CLIP 模型名", type: "text", required: false, placeholder: "qwen_2.5_vl_7b_fp8_scaled.safetensors" },
    { key: "vaeModel", label: "VAE 模型名", type: "text", required: false, placeholder: "qwen_image_vae.safetensors" },
    { key: "unetFp8", label: "UNet FP8 模型名", type: "text", required: false, placeholder: "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors" },
    { key: "loraModel", label: "LoRA 模型名", type: "text", required: false, placeholder: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" },
    { key: "resizeLongerSize", label: "参考图缩放长边尺寸", type: "text", required: false, placeholder: "1536" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
    unetGguf: "qwen-image-edit-2511-Q6_K.gguf",
    clipModel: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    vaeModel: "qwen_image_vae.safetensors",
    unetFp8: "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
    loraModel: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    resizeLongerSize: "1536",
  },
  models: [{
    name: "Qwen Image Edit 多图参考",
    modelName: "qwen-image-edit-multi",
    type: "image",
    mode: ["multiReference"],
    associationSkills: "Qwen-Image-Edit-2511 多图参考编辑，支持最多3张参考图片进行图像编辑与合成",
  }],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

const WORKFLOW_JSON = {
  "1": {
    "inputs": {
      "unet_name": "qwen-image-edit-2511-Q6_K.gguf"
    },
    "class_type": "UnetLoaderGGUF",
    "_meta": {
      "title": "Unet Loader (GGUF)"
    }
  },
  "3": {
    "inputs": {
      "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      "type": "qwen_image",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "加载CLIP"
    }
  },
  "4": {
    "inputs": {
      "vae_name": "qwen_image_vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "5": {
    "inputs": {
      "prompt": "",
      "clip": ["3", 0],
      "vae": ["4", 0],
      "image1": ["34", 0],
      "image2": ["35", 0],
      "image3": ["36", 0]
    },
    "class_type": "TextEncodeQwenImageEditPlus",
    "_meta": {
      "title": "文本编码（QwenImageEditPlus）"
    }
  },
  "6": {
    "inputs": {
      "prompt": "",
      "clip": ["3", 0],
      "vae": ["4", 0],
      "image1": ["34", 0],
      "image2": ["35", 0],
      "image3": ["36", 0]
    },
    "class_type": "TextEncodeQwenImageEditPlus",
    "_meta": {
      "title": "文本编码（QwenImageEditPlus）"
    }
  },
  "9": {
    "inputs": {
      "samples": ["10", 0],
      "vae": ["4", 0]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "10": {
    "inputs": {
      "seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": ["14", 0],
      "positive": ["15", 0],
      "negative": ["16", 0],
      "latent_image": ["27", 0]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "11": {
    "inputs": {
      "shift": 3,
      "model": ["22", 0]
    },
    "class_type": "ModelSamplingAuraFlow",
    "_meta": {
      "title": "采样算法（AuraFlow）"
    }
  },
  "12": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["9", 0]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  },
  "13": {
    "inputs": {
      "image": ""
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "14": {
    "inputs": {
      "strength": 1,
      "pre_cfg": false,
      "model": ["11", 0]
    },
    "class_type": "CFGNorm",
    "_meta": {
      "title": "CFG归一化"
    }
  },
  "15": {
    "inputs": {
      "reference_latents_method": "index_timestep_zero",
      "conditioning": ["5", 0]
    },
    "class_type": "FluxKontextMultiReferenceLatentMethod",
    "_meta": {
      "title": "FluxKontext多参考潜在方法"
    }
  },
  "16": {
    "inputs": {
      "reference_latents_method": "index_timestep_zero",
      "conditioning": ["6", 0]
    },
    "class_type": "FluxKontextMultiReferenceLatentMethod",
    "_meta": {
      "title": "FluxKontext多参考潜在方法"
    }
  },
  "22": {
    "inputs": {
      "lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
      "strength_model": 1,
      "model": ["29", 0]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "23": {
    "inputs": {
      "image": ""
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "27": {
    "inputs": {
      "width": 1536,
      "height": 1024,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage",
    "_meta": {
      "title": "空Latent图像"
    }
  },
  "29": {
    "inputs": {
      "unet_name": "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "31": {
    "inputs": {
      "image": ""
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "34": {
    "inputs": {
      "resize_type": "scale longer dimension",
      "resize_type.longer_size": 1536,
      "scale_method": "lanczos",
      "input": ["13", 0]
    },
    "class_type": "ResizeImageMaskNode",
    "_meta": {
      "title": "调整图像/掩码大小"
    }
  },
  "35": {
    "inputs": {
      "resize_type": "scale longer dimension",
      "resize_type.longer_size": 1536,
      "scale_method": "lanczos",
      "input": ["23", 0]
    },
    "class_type": "ResizeImageMaskNode",
    "_meta": {
      "title": "调整图像/掩码大小"
    }
  },
  "36": {
    "inputs": {
      "resize_type": "scale longer dimension",
      "resize_type.longer_size": 1536,
      "scale_method": "lanczos",
      "input": ["31", 0]
    },
    "class_type": "ResizeImageMaskNode",
    "_meta": {
      "title": "调整图像/掩码大小"
    }
  }
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据 size 和 aspectRatio 计算输出分辨率
 */
const getResolution = (size: "1K" | "2K" | "4K", aspectRatio: `${number}:${number}`): { width: number; height: number } => {
  const is16v9 = aspectRatio === "16:9";
  const is9v16 = aspectRatio === "9:16";

  switch (size) {
    case "1K":
      return is16v9 ? { width: 1024, height: 576 } : is9v16 ? { width: 576, height: 1024 } : { width: 1024, height: 1024 };
    case "2K":
      return is16v9 ? { width: 1536, height: 864 } : is9v16 ? { width: 864, height: 1536 } : { width: 1536, height: 1536 };
    case "4K":
      return is16v9 ? { width: 2048, height: 1152 } : is9v16 ? { width: 1152, height: 2048 } : { width: 2048, height: 2048 };
    default:
      return { width: 1536, height: 1024 };
  }
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("不支持文本生成");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少图片生成提示词");

  // 1. 处理参考图（最多3张）
  const refs = config.referenceList?.filter((r) => r.type === "image") || [];

  if (refs.length === 0) {
    throw new Error("Qwen Image Edit 多图参考需要至少1张参考图片");
  }

  logger(`[Qwen Image Edit Multi] 参考图片数量: ${refs.length}`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 3. 替换模型文件配置
  if (vendor.inputValues.unetGguf) {
    workflow["1"]["inputs"]["unet_name"] = vendor.inputValues.unetGguf;
  }
  if (vendor.inputValues.clipModel) {
    workflow["3"]["inputs"]["clip_name"] = vendor.inputValues.clipModel;
  }
  if (vendor.inputValues.vaeModel) {
    workflow["4"]["inputs"]["vae_name"] = vendor.inputValues.vaeModel;
  }
  if (vendor.inputValues.unetFp8) {
    workflow["29"]["inputs"]["unet_name"] = vendor.inputValues.unetFp8;
  }
  if (vendor.inputValues.loraModel) {
    workflow["22"]["inputs"]["lora_name"] = vendor.inputValues.loraModel;
  }

  // 4. 替换 LoadImage 节点为 easy loadImageBase64
  // 图片1（节点 13）— 必须
  let b64_1 = refs[0]?.base64 || "";
  if (b64_1.includes(",")) b64_1 = b64_1.split(",")[1];
  workflow["13"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: b64_1.replace(/\s/g, ""), image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 图片2（节点 23）— 可选
  if (refs.length >= 2) {
    let b64_2 = refs[1].base64 || "";
    if (b64_2.includes(",")) b64_2 = b64_2.split(",")[1];
    workflow["23"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: b64_2.replace(/\s/g, ""), image_output: "Preview", save_prefix: "ComfyUI" }
    };
  } else {
    // 没有第二张图时，复用第一张（工作流需要3个输入）
    workflow["23"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: b64_1.replace(/\s/g, ""), image_output: "Preview", save_prefix: "ComfyUI" }
    };
  }

  // 图片3（节点 31）— 可选
  if (refs.length >= 3) {
    let b64_3 = refs[2].base64 || "";
    if (b64_3.includes(",")) b64_3 = b64_3.split(",")[1];
    workflow["31"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: b64_3.replace(/\s/g, ""), image_output: "Preview", save_prefix: "ComfyUI" }
    };
  } else {
    // 没有第三张图时，复用第一张
    workflow["31"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: b64_1.replace(/\s/g, ""), image_output: "Preview", save_prefix: "ComfyUI" }
    };
  }

  // 5. 注入提示词
  workflow["5"]["inputs"]["prompt"] = config.prompt;
  workflow["6"]["inputs"]["prompt"] = ""; // 负面提示词留空

  // 6. 设置随机种子
  workflow["10"]["inputs"]["seed"] = generateSeed();

  // 7. 设置分辨率
  const { width, height } = getResolution(config.size, config.aspectRatio);
  workflow["27"]["inputs"]["width"] = width;
  workflow["27"]["inputs"]["height"] = height;

  // 8. 设置参考图缩放尺寸
  const resizeLongerSize = parseInt(vendor.inputValues.resizeLongerSize || "1536", 10);
  workflow["34"]["inputs"]["resize_type.longer_size"] = resizeLongerSize;
  workflow["35"]["inputs"]["resize_type.longer_size"] = resizeLongerSize;
  workflow["36"]["inputs"]["resize_type.longer_size"] = resizeLongerSize;

  logger(`[Qwen Image Edit Multi] 分辨率: ${width}x${height}, 参考图缩放长边: ${resizeLongerSize}, 提示词长度: ${config.prompt.length}`);

  // 9. 提交到 ComfyUI API
  const submitResp = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  const submitData = await submitResp.json();
  const promptId = submitData.prompt_id;

  if (!promptId) {
    throw new Error(`提交失败：${JSON.stringify(submitData)}`);
  }

  logger(`[Qwen Image Edit Multi] 任务已提交，ID: ${promptId}`);

  // 10. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 SaveImage（节点 12）的输出
    const output = run.outputs?.["12"];
    const fileInfo = output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 2000, 300000);

  if (result.error) throw new Error(`Qwen Image Edit Multi 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的图片");

  // 11. 下载图片并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[Qwen Image Edit Multi] 下载图片: ${downloadUrl}`);
  return await urlToBase64(downloadUrl);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  throw new Error("不支持视频生成");
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async () => ({ hasUpdate: false, latestVersion: "1.1", notice: "" });
const updateVendor = async () => { return ""; };

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
