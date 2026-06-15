/**
 * Toonflow AI供应商 - qwen 所有工作流（本地 ComfyUI）
 * @version 1.0
 *
 * 合并以下工作流:
 *   - Qwen3 TTS（本地 ComfyUI）（TTS 语音合成）
 *   - Qwen Image Edit 多图参考（本地 ComfyUI）（多图参考编辑）
 *
 * 包含各工作流的独立 WORKFLOW_JSON_* 和适配器函数。
 */

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

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "qwen",
  version: "1.0",
  author: "Toonflow",
  name: "qwen 合集（本地 ComfyUI）",
  description: "  - TTS 语音合成: 基于本地 ComfyUI 的 Qwen3 TTS 语音合成工作流。需要 ComfyUI 环境已配置 Qwen3-TTS 自定义节点。\n\n  - 多图参考编辑: 基于本地 ComfyUI 的 Qwen-Image-Edit-2511 多图参考工作流，支持最多 3 张参考图片的 AI 编辑。参考图会自动缩放至指定长边尺寸。需要 ComfyUI 环境已配置 Qwen-Image-Edit 模型及自定义节点（TextEncodeQwenImageEditPlus, FluxKontextMultiReferenceLatentMethod, ResizeImageMaskNode 等）。",
  inputs: [
    {
      key: "baseUrl",
      label: "ComfyUI 地址",
      type: "text",
      required: true,
      placeholder: "http://localhost:8188",
    },
    {
      key: "modelSize",
      label: "模型大小",
      type: "text",
      required: false,
      placeholder: "1.7B",
    },
    { key: "unetGguf", label: "UNet GGUF 模型名", type: "text", required: false, placeholder: "qwen-image-edit-2511-Q6_K.gguf" },
    { key: "clipModel", label: "CLIP 模型名", type: "text", required: false, placeholder: "qwen_2.5_vl_7b_fp8_scaled.safetensors" },
    { key: "vaeModel", label: "VAE 模型名", type: "text", required: false, placeholder: "qwen_image_vae.safetensors" },
    { key: "unetFp8", label: "UNet FP8 模型名", type: "text", required: false, placeholder: "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors" },
    { key: "loraModel", label: "LoRA 模型名", type: "text", required: false, placeholder: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" },
    { key: "resizeLongerSize", label: "参考图缩放长边尺寸", type: "text", required: false, placeholder: "1536" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
    modelSize: "1.7B",
    unetGguf: "qwen-image-edit-2511-Q6_K.gguf",
    clipModel: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    vaeModel: "qwen_image_vae.safetensors",
    unetFp8: "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
    loraModel: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    resizeLongerSize: "1536",
  },
  models: [
    {
      name: "Qwen3 TTS 1.7B",
      modelName: "qwen3-tts-1.7b",
      type: "tts",
      voices: [
        { title: "默认", voice: "" },
        { title: "男生（开心）", voice: "使用男生音调，非常开心的说" },
        { title: "女生（开心）", voice: "使用女生音调，非常开心的说" },
        { title: "男生（平静）", voice: "使用男生音调，平静的说" },
        { title: "女生（平静）", voice: "使用女生音调，平静的说" },
        { title: "男生（严肃）", voice: "使用男生音调，严肃的说" },
        { title: "女生（严肃）", voice: "使用女生音调，严肃的说" },
        { title: "男生（悲伤）", voice: "使用男生音调，悲伤的说" },
        { title: "女生（悲伤）", voice: "使用女生音调，悲伤的说" },
      ],
    },
    {
      name: "Qwen Image Edit 多图参考",
      modelName: "qwen-image-edit-multi",
      type: "image",
      mode: ["multiReference"],
      associationSkills: "Qwen-Image-Edit-2511 多图参考编辑，支持最多3张参考图片进行图像编辑与合成",
    },
  ],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

// TTS 语音合成 - Qwen3 TTS（本地 ComfyUI）
const WORKFLOW_JSON_QWEN3_TTS = {};

// 多图参考编辑 - Qwen Image Edit 多图参考（本地 ComfyUI）
const WORKFLOW_JSON_MULTI = {
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
      "clip": [
        "3",
        0
      ],
      "vae": [
        "4",
        0
      ],
      "image1": [
        "34",
        0
      ],
      "image2": [
        "35",
        0
      ],
      "image3": [
        "36",
        0
      ]
    },
    "class_type": "TextEncodeQwenImageEditPlus",
    "_meta": {
      "title": "文本编码（QwenImageEditPlus）"
    }
  },
  "6": {
    "inputs": {
      "prompt": "",
      "clip": [
        "3",
        0
      ],
      "vae": [
        "4",
        0
      ],
      "image1": [
        "34",
        0
      ],
      "image2": [
        "35",
        0
      ],
      "image3": [
        "36",
        0
      ]
    },
    "class_type": "TextEncodeQwenImageEditPlus",
    "_meta": {
      "title": "文本编码（QwenImageEditPlus）"
    }
  },
  "9": {
    "inputs": {
      "samples": [
        "10",
        0
      ],
      "vae": [
        "4",
        0
      ]
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
      "model": [
        "14",
        0
      ],
      "positive": [
        "15",
        0
      ],
      "negative": [
        "16",
        0
      ],
      "latent_image": [
        "27",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "11": {
    "inputs": {
      "shift": 3,
      "model": [
        "22",
        0
      ]
    },
    "class_type": "ModelSamplingAuraFlow",
    "_meta": {
      "title": "采样算法（AuraFlow）"
    }
  },
  "12": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "9",
        0
      ]
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
      "model": [
        "11",
        0
      ]
    },
    "class_type": "CFGNorm",
    "_meta": {
      "title": "CFG归一化"
    }
  },
  "15": {
    "inputs": {
      "reference_latents_method": "index_timestep_zero",
      "conditioning": [
        "5",
        0
      ]
    },
    "class_type": "FluxKontextMultiReferenceLatentMethod",
    "_meta": {
      "title": "FluxKontext多参考潜在方法"
    }
  },
  "16": {
    "inputs": {
      "reference_latents_method": "index_timestep_zero",
      "conditioning": [
        "6",
        0
      ]
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
      "model": [
        "29",
        0
      ]
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
      "input": [
        "13",
        0
      ]
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
      "input": [
        "23",
        0
      ]
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
      "input": [
        "31",
        0
      ]
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

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("不支持文本生成");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  throw new Error("不支持图片生成");
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  throw new Error("不支持视频生成");
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async () => ({ hasUpdate: false, latestVersion: "1.0", notice: "" });
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
