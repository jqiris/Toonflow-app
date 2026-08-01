/**
 * Toonflow AI供应商 - Infinite Canvas 工作流合集（本地 ComfyUI）
 * @version 2.0
 *
 * 合并以下工作流:
 *   - Z-Image T2I（本地 ComfyUI）（文生图）
 *   - Z-Image Enhance（本地 ComfyUI）（图生图增强，ControlNet 深度引导）
 *   - FLUX.2 Klein 9B（本地 ComfyUI）（多参考图编辑）
 *   - Qwen Image Edit 2511（本地 ComfyUI）（单参考图编辑/摄像机旋转）
 *   - SeedVR2 高清放大（本地 ComfyUI）（图像放大）
 *   - LTX Director v2（本地 ComfyUI）（文生视频，含音频）
 *
 * 需要本机 ComfyUI 已配置对应模型与自定义节点：
 * Z-Image Turbo、FLUX.2 Klein 9B、Qwen-Image-Edit-2511、SeedVR2、LTX Director 系列节点、
 * ComfyUI-easy-use（easy loadImageBase64）、ComfyUI-Inspire-Pack（Shared Loader）等。
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
  id: "infinite_canvas",
  version: "2.0",
  author: "Toonflow",
  name: "Infinite Canvas 工作流合集（本地 ComfyUI）",
  description:
    "基于本地 ComfyUI 的 Infinite Canvas 工作流合集，涵盖文生图、图生图增强、FLUX.2 Klein 编辑、Qwen Image Edit 2511 编辑、SeedVR2 高清放大与 LTX Director v2 文生视频。\n\n需要在设置中填写本机 ComfyUI 地址，并确保 ComfyUI 已配置对应模型与自定义节点。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
  },
  models: [
    {
      name: "Z-Image Turbo 文生图",
      modelName: "z-image-t2i",
      type: "image",
      mode: ["text"],
      associationSkills: "Z-Image Turbo 文生图，基于 Infinite Canvas 工作流，支持高质量快速生图",
    },
    {
      name: "Z-Image 增强",
      modelName: "z-image-enhance",
      type: "image",
      mode: ["singleImage"],
      associationSkills: "Z-Image 图生图增强，ControlNet 深度引导，在参考图基础上增强细节",
    },
    {
      name: "FLUX.2 Klein 编辑",
      modelName: "flux2-klein",
      type: "image",
      mode: ["multiReference"],
      associationSkills: "FLUX.2 Klein 9B 多参考图编辑，支持最多3张参考图进行图像编辑与合成",
    },
    {
      name: "Qwen Image Edit 2511",
      modelName: "qwen-edit-2511",
      type: "image",
      mode: ["singleImage"],
      associationSkills: "Qwen-Image-Edit-2511 单参考图编辑，支持摄像机旋转等指令式图像编辑",
    },
    {
      name: "SeedVR2 高清放大",
      modelName: "seedvr2-upscale",
      type: "image",
      mode: ["singleImage"],
      associationSkills: "SeedVR2 图像高清放大，无需提示词，直接提升参考图像分辨率与细节",
    },
    {
      name: "LTX Director v2 文生视频",
      modelName: "ltx-director-v2",
      type: "video",
      mode: ["text"],
      audio: true,
      durationResolutionMap: [{ duration: [5, 8, 10, 15], resolution: ["720p", "1080p"] }],
    },
  ],
};

// ============================================================
// 工作流 JSON（从 Infinite-Canvas 导出的 ComfyUI API 格式）
// ============================================================

const WORKFLOW_Z_IMAGE_T2I = {
  "1": {
    "inputs": {
      "unet_name": "z_image_turbo_bf16.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "5": {
    "inputs": {
      "clip_name": "qwen_3_4b.safetensors",
      "type": "lumina2",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "加载CLIP"
    }
  },
  "6": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "7": {
    "inputs": {
      "text": "",
      "clip": [
        "5",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "12": {
    "inputs": {
      "shift": 3,
      "model": [
        "19",
        0
      ]
    },
    "class_type": "ModelSamplingAuraFlow",
    "_meta": {
      "title": "采样算法（AuraFlow）"
    }
  },
  "13": {
    "inputs": {
      "seed": 338061032968195,
      "steps": 18,
      "cfg": 3,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": [
        "12",
        0
      ],
      "positive": [
        "7",
        0
      ],
      "negative": [
        "17",
        0
      ],
      "latent_image": [
        "14",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "14": {
    "inputs": {
      "width": 1360,
      "height": 768,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage",
    "_meta": {
      "title": "空Latent图像"
    }
  },
  "15": {
    "inputs": {
      "samples": [
        "13",
        0
      ],
      "vae": [
        "6",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "17": {
    "inputs": {
      "system_prompt": "superior",
      "user_prompt": "blurry, ugly, bad",
      "clip": [
        "5",
        0
      ]
    },
    "class_type": "CLIPTextEncodeLumina2",
    "_meta": {
      "title": "CLIP文本编码（Lumina2）"
    }
  },
  "18": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "15",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  },
  "19": {
    "inputs": {
      "lora_name": "Z-image-Turbo-3DCG画风_1.1.safetensors",
      "strength_model": 0.6,
      "model": [
        "1",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  }
};

const WORKFLOW_Z_IMAGE_ENHANCE = {
  "15": {
    "inputs": {
      "image": "beauty01.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "23": {
    "inputs": {
      "text": "丰富的细节",
      "clip": [
        "34",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码器"
    }
  },
  "24": {
    "inputs": {
      "conditioning": [
        "23",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "条件零化"
    }
  },
  "27": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "VAE加载器"
    }
  },
  "33": {
    "inputs": {
      "model_name": "z_image_turbo_bf16.safetensors",
      "weight_dtype": "default",
      "key_opt": "",
      "mode": "Auto"
    },
    "class_type": "LoadDiffusionModelShared //Inspire",
    "_meta": {
      "title": "Shared Diffusion Model Loader (Inspire)"
    }
  },
  "34": {
    "inputs": {
      "model_name1": "qwen_3_4b.safetensors",
      "model_name2": "None",
      "model_name3": "None",
      "type": "stable_diffusion",
      "key_opt": "",
      "mode": "Auto",
      "device": "default"
    },
    "class_type": "LoadTextEncoderShared //Inspire",
    "_meta": {
      "title": "Shared Text Encoder Loader (Inspire)"
    }
  },
  "142": {
    "inputs": {
      "pixels": [
        "15",
        0
      ],
      "vae": [
        "27",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "146": {
    "inputs": {
      "seed": 984287406400018,
      "steps": 10,
      "cfg": 0.7,
      "sampler_name": "euler",
      "scheduler": "sgm_uniform",
      "denoise": [
        "202",
        0
      ],
      "model": [
        "166",
        0
      ],
      "positive": [
        "23",
        0
      ],
      "negative": [
        "24",
        0
      ],
      "latent_image": [
        "142",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "147": {
    "inputs": {
      "samples": [
        "146",
        0
      ],
      "vae": [
        "27",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "164": {
    "inputs": {
      "preprocessor": "DepthAnythingV2Preprocessor",
      "resolution": 1024,
      "image": [
        "15",
        0
      ]
    },
    "class_type": "AIO_Preprocessor",
    "_meta": {
      "title": "Aux集成预处理器"
    }
  },
  "165": {
    "inputs": {
      "name": "Z-Image-Turbo-Fun-Controlnet-Union.safetensors"
    },
    "class_type": "ModelPatchLoader",
    "_meta": {
      "title": "加载模型补丁"
    }
  },
  "166": {
    "inputs": {
      "strength": 0.8,
      "model": [
        "33",
        0
      ],
      "model_patch": [
        "165",
        0
      ],
      "vae": [
        "27",
        0
      ],
      "image": [
        "164",
        0
      ]
    },
    "class_type": "QwenImageDiffsynthControlnet",
    "_meta": {
      "title": "QwenImageDiffsynthControlnet"
    }
  },
  "174": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "180",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  },
  "180": {
    "inputs": {
      "samples": [
        "181",
        0
      ],
      "vae": [
        "27",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "181": {
    "inputs": {
      "seed": 869128211737012,
      "steps": 10,
      "cfg": 1,
      "sampler_name": "euler_cfg_pp",
      "scheduler": "simple",
      "denoise": [
        "202",
        0
      ],
      "model": [
        "33",
        0
      ],
      "positive": [
        "23",
        0
      ],
      "negative": [
        "24",
        0
      ],
      "latent_image": [
        "186",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "184": {
    "inputs": {
      "seed": 55602317815336,
      "strength": [
        "202",
        0
      ],
      "image": [
        "15",
        0
      ]
    },
    "class_type": "ImageAddNoise",
    "_meta": {
      "title": "图像添加噪声"
    }
  },
  "186": {
    "inputs": {
      "pixels": [
        "189",
        0
      ],
      "vae": [
        "27",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "189": {
    "inputs": {
      "blend_factor": [
        "202",
        0
      ],
      "blend_mode": "multiply",
      "image1": [
        "191",
        0
      ],
      "image2": [
        "184",
        0
      ]
    },
    "class_type": "ImageBlend",
    "_meta": {
      "title": "图像混合"
    }
  },
  "191": {
    "inputs": {
      "sharpen_radius": 1,
      "sigma": 0.5,
      "alpha": 0.5,
      "image": [
        "147",
        0
      ]
    },
    "class_type": "ImageSharpen",
    "_meta": {
      "title": "图像锐化"
    }
  },
  "193": {
    "inputs": {
      "image": [
        "15",
        0
      ]
    },
    "class_type": "GetImageSizeAndCount",
    "_meta": {
      "title": "获取图像尺寸"
    }
  },
  "201": {
    "inputs": {
      "a": [
        "193",
        1
      ],
      "b": [
        "193",
        2
      ],
      "operation": "add"
    },
    "class_type": "easy mathInt",
    "_meta": {
      "title": "宽度+高度"
    }
  },
  "202": {
    "inputs": {
      "output_type": "float",
      "*": [
        "207",
        0
      ]
    },
    "class_type": "easy convertAnything",
    "_meta": {
      "title": "转换任何"
    }
  },
  "204": {
    "inputs": {
      "value": 0.5
    },
    "class_type": "FloatConstant",
    "_meta": {
      "title": "浮点常量"
    }
  },
  "205": {
    "inputs": {
      "output_type": "float",
      "*": [
        "201",
        0
      ]
    },
    "class_type": "easy convertAnything",
    "_meta": {
      "title": "转为浮点"
    }
  },
  "206": {
    "inputs": {
      "a": [
        "205",
        0
      ],
      "b": [
        "204",
        0
      ],
      "operation": "multiply"
    },
    "class_type": "easy mathFloat",
    "_meta": {
      "title": "×0.5"
    }
  },
  "207": {
    "inputs": {
      "a": [
        "206",
        0
      ],
      "b": 10000,
      "operation": "divide"
    },
    "class_type": "easy mathFloat",
    "_meta": {
      "title": "÷10000"
    }
  }
};

const WORKFLOW_FLUX2_KLEIN = {
  "151": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "152": {
    "inputs": {
      "steps": 4,
      "width": [
        "157",
        1
      ],
      "height": [
        "157",
        1
      ]
    },
    "class_type": "Flux2Scheduler",
    "_meta": {
      "title": "Flux2Scheduler"
    }
  },
  "153": {
    "inputs": {
      "cfg": 1,
      "model": [
        "296",
        0
      ],
      "positive": [
        "307",
        0
      ],
      "negative": [
        "308",
        0
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导"
    }
  },
  "154": {
    "inputs": {
      "noise": [
        "158",
        0
      ],
      "guider": [
        "153",
        0
      ],
      "sampler": [
        "151",
        0
      ],
      "sigmas": [
        "152",
        0
      ],
      "latent_image": [
        "156",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器(高级)"
    }
  },
  "155": {
    "inputs": {
      "samples": [
        "154",
        0
      ],
      "vae": [
        "174",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "156": {
    "inputs": {
      "width": [
        "157",
        0
      ],
      "height": [
        "157",
        1
      ],
      "batch_size": 1
    },
    "class_type": "EmptyFlux2LatentImage",
    "_meta": {
      "title": "Empty Flux 2 Latent"
    }
  },
  "157": {
    "inputs": {
      "image": [
        "291",
        0
      ]
    },
    "class_type": "GetImageSize",
    "_meta": {
      "title": "获取图像尺寸"
    }
  },
  "158": {
    "inputs": {
      "noise_seed": 45426268055567
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "159": {
    "inputs": {
      "conditioning": [
        "168",
        0
      ],
      "latent": [
        "162",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "160": {
    "inputs": {
      "conditioning": [
        "167",
        0
      ],
      "latent": [
        "162",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "162": {
    "inputs": {
      "pixels": [
        "291",
        0
      ],
      "vae": [
        "174",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "164": {
    "inputs": {
      "pixels": [
        "271",
        0
      ],
      "vae": [
        "174",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "165": {
    "inputs": {
      "conditioning": [
        "159",
        0
      ],
      "latent": [
        "164",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "166": {
    "inputs": {
      "conditioning": [
        "160",
        0
      ],
      "latent": [
        "164",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "167": {
    "inputs": {
      "conditioning": [
        "168",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "条件零化"
    }
  },
  "168": {
    "inputs": {
      "text": "改为夜晚",
      "clip": [
        "295",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码器"
    }
  },
  "174": {
    "inputs": {
      "vae_name": "flux2-vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "VAE加载器"
    }
  },
  "178": {
    "inputs": {
      "pixels": [
        "294",
        0
      ],
      "vae": [
        "174",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "179": {
    "inputs": {
      "conditioning": [
        "165",
        0
      ],
      "latent": [
        "178",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "180": {
    "inputs": {
      "conditioning": [
        "166",
        0
      ],
      "latent": [
        "178",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "270": {
    "inputs": {
      "image": "beauty01.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "271": {
    "inputs": {
      "upscale_method": "lanczos",
      "megapixels": 1,
      "resolution_steps": 1,
      "image": [
        "270",
        0
      ]
    },
    "class_type": "ImageScaleToTotalPixels",
    "_meta": {
      "title": "图像按像素缩放"
    }
  },
  "278": {
    "inputs": {
      "image": "chuotanhls-vietnam-9849092_1920.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "291": {
    "inputs": {
      "upscale_method": "lanczos",
      "megapixels": 1,
      "resolution_steps": 1,
      "image": [
        "278",
        0
      ]
    },
    "class_type": "ImageScaleToTotalPixels",
    "_meta": {
      "title": "图像按像素缩放"
    }
  },
  "292": {
    "inputs": {
      "image": "屏幕截图 2026-06-19 013438.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "294": {
    "inputs": {
      "upscale_method": "lanczos",
      "megapixels": 1,
      "resolution_steps": 1,
      "image": [
        "292",
        0
      ]
    },
    "class_type": "ImageScaleToTotalPixels",
    "_meta": {
      "title": "图像按像素缩放"
    }
  },
  "295": {
    "inputs": {
      "model_name1": "qwen_3_8b_fp8mixed.safetensors",
      "model_name2": "None",
      "model_name3": "None",
      "type": "stable_diffusion",
      "key_opt": "",
      "mode": "Auto",
      "device": "default"
    },
    "class_type": "LoadTextEncoderShared //Inspire",
    "_meta": {
      "title": "Shared Text Encoder Loader (Inspire)"
    }
  },
  "296": {
    "inputs": {
      "model_name": "flux-2-klein-9b-fp8.safetensors",
      "weight_dtype": "default",
      "key_opt": "",
      "mode": "Auto"
    },
    "class_type": "LoadDiffusionModelShared //Inspire",
    "_meta": {
      "title": "Shared Diffusion Model Loader (Inspire)"
    }
  },
  "305": {
    "inputs": {
      "switch": [
        "313",
        0
      ],
      "on_false": [
        "160",
        0
      ],
      "on_true": [
        "166",
        0
      ]
    },
    "class_type": "ComfySwitchNode",
    "_meta": {
      "title": "Switch"
    }
  },
  "306": {
    "inputs": {
      "switch": [
        "313",
        0
      ],
      "on_false": [
        "159",
        0
      ],
      "on_true": [
        "165",
        0
      ]
    },
    "class_type": "ComfySwitchNode",
    "_meta": {
      "title": "Switch"
    }
  },
  "307": {
    "inputs": {
      "switch": [
        "314",
        0
      ],
      "on_false": [
        "306",
        0
      ],
      "on_true": [
        "179",
        0
      ]
    },
    "class_type": "ComfySwitchNode",
    "_meta": {
      "title": "Switch"
    }
  },
  "308": {
    "inputs": {
      "switch": [
        "314",
        0
      ],
      "on_false": [
        "305",
        0
      ],
      "on_true": [
        "180",
        0
      ]
    },
    "class_type": "ComfySwitchNode",
    "_meta": {
      "title": "Switch"
    }
  },
  "313": {
    "inputs": {
      "value": false
    },
    "class_type": "PrimitiveBoolean",
    "_meta": {
      "title": "布尔值2"
    }
  },
  "314": {
    "inputs": {
      "value": false
    },
    "class_type": "PrimitiveBoolean",
    "_meta": {
      "title": "布尔值3"
    }
  },
  "315": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "155",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  }
};

const WORKFLOW_QWEN_EDIT_2511 = {
  "1": {
    "inputs": {
      "strength": 1,
      "pre_cfg": false,
      "model": [
        "2",
        0
      ]
    },
    "class_type": "CFGNorm",
    "_meta": {
      "title": "CFG归一化"
    }
  },
  "2": {
    "inputs": {
      "shift": 3,
      "model": [
        "20",
        0
      ]
    },
    "class_type": "ModelSamplingAuraFlow",
    "_meta": {
      "title": "模型采样算法AuraFlow"
    }
  },
  "3": {
    "inputs": {
      "prompt": "",
      "clip": [
        "87",
        0
      ],
      "vae": [
        "22",
        0
      ],
      "image1": [
        "39",
        0
      ]
    },
    "class_type": "TextEncodeQwenImageEditPlus",
    "_meta": {
      "title": "文本编码（QwenImageEditPlus）"
    }
  },
  "10": {
    "inputs": {
      "pixels": [
        "39",
        0
      ],
      "vae": [
        "22",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "11": {
    "inputs": {
      "prompt": "将摄像机向右旋转45度",
      "clip": [
        "87",
        0
      ],
      "vae": [
        "22",
        0
      ],
      "image1": [
        "39",
        0
      ]
    },
    "class_type": "TextEncodeQwenImageEditPlus",
    "_meta": {
      "title": "文本编码（QwenImageEditPlus）"
    }
  },
  "12": {
    "inputs": {
      "samples": [
        "14",
        0
      ],
      "vae": [
        "22",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "14": {
    "inputs": {
      "seed": 714290484451017,
      "steps": 8,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": [
        "1",
        0
      ],
      "positive": [
        "84",
        0
      ],
      "negative": [
        "85",
        0
      ],
      "latent_image": [
        "10",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "20": {
    "inputs": {
      "lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
      "strength_model": 1,
      "model": [
        "76",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器(仅模型)"
    }
  },
  "22": {
    "inputs": {
      "vae_name": "qwen_image_vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "VAE加载器"
    }
  },
  "31": {
    "inputs": {
      "image": "beauty01.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "39": {
    "inputs": {
      "upscale_method": "lanczos",
      "megapixels": 1,
      "resolution_steps": 1,
      "image": [
        "31",
        0
      ]
    },
    "class_type": "ImageScaleToTotalPixels",
    "_meta": {
      "title": "图像按像素缩放"
    }
  },
  "45": {
    "inputs": {
      "images": [
        "12",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "预览图像"
    }
  },
  "76": {
    "inputs": {
      "lora_name": "qwen-image-edit-2511-multiple-angles-lora.safetensors",
      "strength_model": 1,
      "model": [
        "86",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器(仅模型)"
    }
  },
  "84": {
    "inputs": {
      "reference_latents_method": "index_timestep_zero",
      "conditioning": [
        "11",
        0
      ]
    },
    "class_type": "FluxKontextMultiReferenceLatentMethod",
    "_meta": {
      "title": "FluxKontext多参考潜在方法"
    }
  },
  "85": {
    "inputs": {
      "reference_latents_method": "index_timestep_zero",
      "conditioning": [
        "3",
        0
      ]
    },
    "class_type": "FluxKontextMultiReferenceLatentMethod",
    "_meta": {
      "title": "FluxKontext多参考潜在方法"
    }
  },
  "86": {
    "inputs": {
      "unet_name": "qwen_image_edit_2511_fp8_e4m3fn.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNET加载器"
    }
  },
  "87": {
    "inputs": {
      "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      "type": "qwen_image",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "CLIP加载器"
    }
  }
};

const WORKFLOW_SEEDVR2_UPSCALE = {
  "15": {
    "inputs": {
      "image": "chuotanhls-vietnam-9849092_1920.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "169": {
    "inputs": {
      "model": "seedvr2_ema_3b_fp16.safetensors",
      "device": "cuda:0",
      "blocks_to_swap": 32,
      "swap_io_components": true,
      "offload_device": "cpu",
      "cache_model": false,
      "attention_mode": "sdpa"
    },
    "class_type": "SeedVR2LoadDiTModel",
    "_meta": {
      "title": "SeedVR2 (Down)Load DiT Model"
    }
  },
  "170": {
    "inputs": {
      "model": "ema_vae_fp16.safetensors",
      "device": "cuda:0",
      "encode_tiled": true,
      "encode_tile_size": 1024,
      "encode_tile_overlap": 128,
      "decode_tiled": true,
      "decode_tile_size": 1024,
      "decode_tile_overlap": 128,
      "tile_debug": "false",
      "offload_device": "cpu",
      "cache_model": false
    },
    "class_type": "SeedVR2LoadVAEModel",
    "_meta": {
      "title": "SeedVR2 (Down)Load VAE Model"
    }
  },
  "172": {
    "inputs": {
      "seed": 4085455228,
      "resolution": 2048,
      "max_resolution": 4096,
      "batch_size": 5,
      "uniform_batch_size": false,
      "color_correction": "lab",
      "temporal_overlap": 0,
      "prepend_frames": 0,
      "input_noise_scale": 0,
      "latent_noise_scale": 0,
      "offload_device": "cpu",
      "enable_debug": false,
      "image": [
        "15",
        0
      ],
      "dit": [
        "169",
        0
      ],
      "vae": [
        "170",
        0
      ]
    },
    "class_type": "SeedVR2VideoUpscaler",
    "_meta": {
      "title": "SeedVR2 Video Upscaler (v2.5.10)"
    }
  },
  "174": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "172",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  }
};

const WORKFLOW_LTX_DIRECTOR_V2 = {
  "30": {
    "inputs": {
      "filename_prefix": "video/LTX_Director",
      "format": "auto",
      "codec": "auto",
      "video-preview": "",
      "video": [
        "96:17",
        0
      ]
    },
    "class_type": "SaveVideo",
    "_meta": {
      "title": "保存视频"
    }
  },
  "46": {
    "inputs": {
      "start_second": 0,
      "end_second": 5,
      "duration_seconds": 5,
      "start_frame": 0,
      "end_frame": 120,
      "duration_frames": 120,
      "timeline_data": "{\"mainTrackEnabled\":true,\"audioTrackEnabled\":true,\"motionTrackEnabled\":true,\"propHeight\":90,\"globalPropHeight\":60,\"showFilenames\":true,\"overrideAudio\":false,\"inpaint_audio\":true,\"global_prompt\":\"\",\"retake_global_prompt\":\"\",\"retakeMode\":false,\"retakeStart\":24,\"retakeLength\":48,\"retakePrompt\":\"\",\"retakeStrength\":1,\"retakeVideo\":null,\"normalStartFrame\":0,\"normalDurationFrames\":120,\"segments\":[],\"motionSegments\":[],\"audioSegments\":[]}",
      "local_prompts": "",
      "segment_lengths": "",
      "epsilon": 0.001,
      "guide_strength": "",
      "use_custom_audio": true,
      "use_custom_motion": true,
      "inpaint_audio": true,
      "frame_rate": 24,
      "display_mode": "seconds",
      "custom_width": 0,
      "custom_height": 0,
      "resize_method": "maintain aspect ratio",
      "divisible_by": 32,
      "img_compression": 18,
      "override_audio": false,
      "timeline_ui": "",
      "model": [
        "93:80",
        0
      ],
      "clip": [
        "93:84",
        0
      ],
      "audio_vae": [
        "93:4",
        0
      ]
    },
    "class_type": "LTXDirector",
    "_meta": {
      "title": "LTX Director"
    }
  },
  "93:77": {
    "inputs": {
      "unet_name": "ltx-2.3-22b-dev-Q4_K_M.gguf"
    },
    "class_type": "UnetLoaderGGUF",
    "_meta": {
      "title": "UNet Loader GGUF"
    }
  },
  "93:78": {
    "inputs": {
      "vae_name": "taeltx2_3.safetensors",
      "device": "main_device",
      "weight_dtype": "bf16"
    },
    "class_type": "VAELoaderKJ",
    "_meta": {
      "title": "Tiny VAELoader KJ"
    }
  },
  "93:84": {
    "inputs": {
      "clip_name1": "gemma_3_12B_it_fp4_mixed.safetensors",
      "clip_name2": "ltx-2.3_text_projection_bf16.safetensors",
      "type": "ltxv",
      "device": "default"
    },
    "class_type": "DualCLIPLoader",
    "_meta": {
      "title": "双CLIP加载器"
    }
  },
  "93:4": {
    "inputs": {
      "vae_name": "LTX23_audio_vae_bf16.safetensors",
      "device": "main_device",
      "weight_dtype": "bf16"
    },
    "class_type": "VAELoaderKJ",
    "_meta": {
      "title": "Audio VAELoader"
    }
  },
  "93:3": {
    "inputs": {
      "vae_name": "LTX23_video_vae_bf16.safetensors",
      "device": "main_device",
      "weight_dtype": "bf16"
    },
    "class_type": "VAELoaderKJ",
    "_meta": {
      "title": "Video VAELoader"
    }
  },
  "94:29": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "94:28": {
    "inputs": {
      "noise_seed": 35815864365754
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "95:53": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "95:57": {
    "inputs": {
      "model_name": "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
    },
    "class_type": "LatentUpscaleModelLoader",
    "_meta": {
      "title": "加载Latent放大模型"
    }
  },
  "93:79": {
    "inputs": {
      "preview_rate": 24,
      "model": [
        "93:77",
        0
      ],
      "vae": [
        "93:78",
        0
      ]
    },
    "class_type": "LTX2SamplingPreviewOverride",
    "_meta": {
      "title": "LTX2 Sampling Preview Override"
    }
  },
  "93:80": {
    "inputs": {
      "lora_name": "ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
      "strength_model": 0.5,
      "model": [
        "93:79",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "94:11": {
    "inputs": {
      "scheduler": "linear_quadratic",
      "steps": 8,
      "denoise": 1,
      "model": [
        "46",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "基本调度器"
    }
  },
  "95:54": {
    "inputs": {
      "scheduler": "linear_quadratic",
      "steps": 4,
      "denoise": 0.42,
      "model": [
        "46",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "基本调度器"
    }
  },
  "94:26": {
    "inputs": {
      "conditioning": [
        "46",
        1
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "条件零化"
    }
  },
  "94:5": {
    "inputs": {
      "frame_rate": 25,
      "positive": [
        "46",
        1
      ],
      "negative": [
        "94:26",
        0
      ]
    },
    "class_type": "LTXVConditioning",
    "_meta": {
      "title": "LTXV条件"
    }
  },
  "94:8": {
    "inputs": {
      "ic_lora_name": "None",
      "ic_lora_strength": 1,
      "scale_by": 0.5,
      "upscale_method": "bicubic",
      "image_attention_strength": 1,
      "crop": "center",
      "auto_snap_ic_grid": true,
      "use_tiled_encode": false,
      "tile_size": 256,
      "tile_overlap": 64,
      "retake_mode": false,
      "positive": [
        "94:5",
        0
      ],
      "negative": [
        "94:5",
        1
      ],
      "vae": [
        "93:3",
        0
      ],
      "latent": [
        "46",
        2
      ],
      "guide_data": [
        "46",
        4
      ]
    },
    "class_type": "LTXDirectorGuide",
    "_meta": {
      "title": "LTX Director Guide"
    }
  },
  "94:9": {
    "inputs": {
      "cfg": 1,
      "model": [
        "46",
        0
      ],
      "positive": [
        "94:8",
        0
      ],
      "negative": [
        "94:8",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "94:7": {
    "inputs": {
      "video_latent": [
        "94:8",
        2
      ],
      "audio_latent": [
        "46",
        3
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "94:10": {
    "inputs": {
      "noise": [
        "94:28",
        0
      ],
      "guider": [
        "94:9",
        0
      ],
      "sampler": [
        "94:29",
        0
      ],
      "sigmas": [
        "94:11",
        0
      ],
      "latent_image": [
        "94:7",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "94:13": {
    "inputs": {
      "av_latent": [
        "94:10",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "95:55": {
    "inputs": {
      "positive": [
        "94:8",
        0
      ],
      "negative": [
        "94:8",
        1
      ],
      "latent": [
        "94:13",
        0
      ]
    },
    "class_type": "LTXVCropGuides",
    "_meta": {
      "title": "LTXV裁剪指导"
    }
  },
  "95:52": {
    "inputs": {
      "samples": [
        "95:55",
        2
      ],
      "upscale_model": [
        "95:57",
        0
      ],
      "vae": [
        "93:3",
        0
      ]
    },
    "class_type": "LTXVLatentUpsampler",
    "_meta": {
      "title": "LTXV潜空间上采样器"
    }
  },
  "95:58": {
    "inputs": {
      "ic_lora_name": "None",
      "ic_lora_strength": 1,
      "scale_by": 1,
      "upscale_method": "bicubic",
      "image_attention_strength": 1,
      "crop": "center",
      "auto_snap_ic_grid": true,
      "use_tiled_encode": false,
      "tile_size": 256,
      "tile_overlap": 64,
      "retake_mode": false,
      "positive": [
        "95:55",
        0
      ],
      "negative": [
        "95:55",
        1
      ],
      "vae": [
        "93:3",
        0
      ],
      "latent": [
        "95:52",
        0
      ],
      "guide_data": [
        "46",
        4
      ]
    },
    "class_type": "LTXDirectorGuide",
    "_meta": {
      "title": "LTX Director Guide"
    }
  },
  "95:49": {
    "inputs": {
      "cfg": 1,
      "model": [
        "46",
        0
      ],
      "positive": [
        "95:58",
        0
      ],
      "negative": [
        "95:58",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "95:50": {
    "inputs": {
      "video_latent": [
        "95:58",
        2
      ],
      "audio_latent": [
        "94:13",
        1
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "95:47": {
    "inputs": {
      "noise": [
        "94:28",
        0
      ],
      "guider": [
        "95:49",
        0
      ],
      "sampler": [
        "95:53",
        0
      ],
      "sigmas": [
        "95:54",
        0
      ],
      "latent_image": [
        "95:50",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "95:48": {
    "inputs": {
      "av_latent": [
        "95:47",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "95:14": {
    "inputs": {
      "positive": [
        "94:8",
        0
      ],
      "negative": [
        "94:8",
        1
      ],
      "latent": [
        "95:48",
        0
      ]
    },
    "class_type": "LTXVCropGuides",
    "_meta": {
      "title": "LTXV裁剪指导"
    }
  },
  "96:16": {
    "inputs": {
      "samples": [
        "95:48",
        1
      ],
      "audio_vae": [
        "93:4",
        0
      ]
    },
    "class_type": "LTXVAudioVAEDecode",
    "_meta": {
      "title": "LTXV音频VAE解码"
    }
  },
  "96:15": {
    "inputs": {
      "samples": [
        "95:14",
        2
      ],
      "vae": [
        "93:3",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "96:17": {
    "inputs": {
      "fps": 30,
      "bit_depth": 8,
      "images": [
        "96:15",
        0
      ],
      "audio": [
        "96:16",
        0
      ]
    },
    "class_type": "CreateVideo",
    "_meta": {
      "title": "创建视频"
    }
  }
};


// ============================================================
// 辅助工具
// ============================================================

/** 获取 ComfyUI 基础地址 */
const getBaseUrl = (): string => {
  const base = vendor.inputValues.baseUrl || "http://localhost:8188";
  return base.replace(/\/+$/, "");
};

/** 生成随机种子 */
const generateSeed = (): number => Math.floor(Math.random() * 4294967295);

/** 去掉 base64 头（data:xxx;base64,）并去除空白 */
const stripHeader = (b64: string): string => {
  const raw = b64.includes(",") ? b64.split(",")[1] : b64;
  return (raw || "").replace(/\s/g, "");
};

/** 将 LoadImage 节点替换为 easy loadImageBase64 */
const replaceLoadImage = (workflow: any, nodeId: string, base64: string): void => {
  workflow[nodeId] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: stripHeader(base64), image_output: "Preview", save_prefix: "ComfyUI" },
  };
};

/** 为缺省 SaveImage 的工作流追加输出节点 */
const ensureSaveImage = (workflow: any, newNodeId: string, sourceNodeId: string): void => {
  workflow[newNodeId] = {
    class_type: "SaveImage",
    inputs: { filename_prefix: "ComfyUI", images: [sourceNodeId, 0] },
    _meta: { title: "保存图像" },
  };
};

/** 根据 size 和 aspectRatio 计算输出分辨率 */
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
      return { width: 1024, height: 1024 };
  }
};

/** 提交工作流到 ComfyUI 并轮询取回输出文件信息 */
const submitAndPoll = async (
  workflow: any,
  outputNodeId: string,
  opts: { interval?: number; timeout?: number; isVideo?: boolean } = {},
): Promise<{ filename: string; subfolder: string; type: string }> => {
  const baseUrl = getBaseUrl();
  const { interval = 2000, timeout = 300000, isVideo = false } = opts;

  const submitResp = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  const submitData = await submitResp.json();
  const promptId = submitData.prompt_id;
  if (!promptId) {
    throw new Error(`提交失败：${JSON.stringify(submitData).slice(0, 500)}`);
  }
  logger(`[InfiniteCanvas] 任务已提交，ID: ${promptId}`);

  const result = await pollTask(
    async (): Promise<PollResult> => {
      const historyResp = await fetch(`${baseUrl}/history`);
      const history = await historyResp.json();
      const run = history[promptId];
      if (!run) return { completed: false };

      if (run.status?.exec_info?.error) {
        return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
      }

      const output = run.outputs?.[outputNodeId];
      if (!output) return { completed: false };

      let fileInfo;
      if (isVideo) {
        fileInfo = output.video?.[0] || output.gifs?.[0] || output.images?.[0];
      } else {
        fileInfo = output.images?.[0];
      }
      if (fileInfo) return { completed: true, data: fileInfo };
      return { completed: false };
    },
    interval,
    timeout,
  );

  if (result.error) throw new Error(`生成失败：${result.error}`);
  if (!result.data) throw new Error("未获取到输出文件信息");
  return result.data as { filename: string; subfolder: string; type: string };
};

/** 根据输出文件信息下载为 base64 */
const downloadAsBase64 = async (fileInfo: { filename: string; subfolder: string; type: string }): Promise<string> => {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(
    fileInfo.subfolder || "",
  )}&type=${fileInfo.type}`;
  logger(`[InfiniteCanvas] 下载输出: ${url}`);
  return await urlToBase64(url);
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("不支持文本生成");
};

/**
 * Z-Image Turbo 文生图（WORKFLOW_Z_IMAGE_T2I）
 * 来源：C:\aigc\Infinite-Canvas\workflows\z-image-t2i.json
 * 注入：提示词 -> 节点7(CLIPTextEncode).text；种子 -> 节点13(KSampler).seed（随机）；尺寸 -> 节点14(EmptyLatentImage)
 * 输出：节点18(SaveImage)（工作流自带）
 */
const runZImageT2I = async (config: ImageConfig): Promise<string> => {
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_Z_IMAGE_T2I));
  workflow["7"].inputs.text = config.prompt || "";
  workflow["13"].inputs.seed = generateSeed();
  const { width, height } = getResolution(config.size, config.aspectRatio);
  workflow["14"].inputs.width = width;
  workflow["14"].inputs.height = height;
  const fileInfo = await submitAndPoll(workflow, "18", { interval: 2000, timeout: 300000 });
  return await downloadAsBase64(fileInfo);
};

/**
 * Z-Image 增强（WORKFLOW_Z_IMAGE_ENHANCE）
 * 注入：参考图 -> 节点15(LoadImage)；提示词 -> 节点23(CLIPTextEncode).text；种子 -> 节点146/181/184
 */
const runZImageEnhance = async (config: ImageConfig): Promise<string> => {
  const refs = (config.referenceList || []).filter((r) => r.type === "image");
  if (refs.length < 1) throw new Error("Z-Image 增强需要至少1张参考图");
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_Z_IMAGE_ENHANCE));
  replaceLoadImage(workflow, "15", refs[0].base64);
  workflow["23"].inputs.text = config.prompt || "丰富的细节";
  // 三个种子节点（主采样146 / 细节采样181 / 加噪184）各自独立随机
  workflow["146"].inputs.seed = generateSeed();
  workflow["181"].inputs.seed = generateSeed();
  workflow["184"].inputs.seed = generateSeed();
  const fileInfo = await submitAndPoll(workflow, "174", { interval: 2000, timeout: 300000 });
  return await downloadAsBase64(fileInfo);
};

/**
 * FLUX.2 Klein 编辑（WORKFLOW_FLUX2_KLEIN）
 * 注入：参考图 -> 节点270/278/292(LoadImage，不足3张复用第1张)；提示词 -> 节点168(CLIPTextEncode).text；种子 -> 节点158(RandomNoise).noise_seed
 * 布尔开关：节点313/314 控制是否启用第2/3张参考图
 */
const runFlux2Klein = async (config: ImageConfig): Promise<string> => {
  const refs = (config.referenceList || []).filter((r) => r.type === "image");
  if (refs.length < 1) throw new Error("FLUX.2 Klein 编辑需要至少1张参考图");
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_FLUX2_KLEIN));
  replaceLoadImage(workflow, "270", refs[0].base64);
  replaceLoadImage(workflow, "278", refs[1]?.base64 || refs[0].base64);
  replaceLoadImage(workflow, "292", refs[2]?.base64 || refs[0].base64);
  workflow["168"].inputs.text = config.prompt || "改为夜晚";
  workflow["158"].inputs.noise_seed = generateSeed();
  workflow["313"].inputs.value = refs.length >= 2;
  workflow["314"].inputs.value = refs.length >= 3;
  const fileInfo = await submitAndPoll(workflow, "315", { interval: 2000, timeout: 300000 });
  return await downloadAsBase64(fileInfo);
};

/**
 * Qwen Image Edit 2511（WORKFLOW_QWEN_EDIT_2511）
 * 注入：参考图 -> 节点31(LoadImage)；提示词 -> 节点11(TextEncodeQwenImageEditPlus).prompt；种子 -> 节点14(KSampler).seed
 */
const runQwenEdit2511 = async (config: ImageConfig): Promise<string> => {
  const refs = (config.referenceList || []).filter((r) => r.type === "image");
  if (refs.length < 1) throw new Error("Qwen Image Edit 2511 需要至少1张参考图");
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_QWEN_EDIT_2511));
  replaceLoadImage(workflow, "31", refs[0].base64);
  workflow["11"].inputs.prompt = config.prompt || "将摄像机向右旋转45度";
  workflow["14"].inputs.seed = generateSeed();
  // 无 SaveImage，追加输出节点读取 VAEDecode(节点12) 结果
  ensureSaveImage(workflow, "999", "12");
  const fileInfo = await submitAndPoll(workflow, "999", { interval: 2000, timeout: 300000 });
  return await downloadAsBase64(fileInfo);
};

/**
 * SeedVR2 高清放大（WORKFLOW_SEEDVR2_UPSCALE）
 * 注入：参考图 -> 节点15(LoadImage)；种子 -> 节点172(SeedVR2VideoUpscaler).seed
 */
const runSeedVR2Upscale = async (config: ImageConfig): Promise<string> => {
  const refs = (config.referenceList || []).filter((r) => r.type === "image");
  if (refs.length < 1) throw new Error("SeedVR2 高清放大需要至少1张参考图");
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_SEEDVR2_UPSCALE));
  replaceLoadImage(workflow, "15", refs[0].base64);
  workflow["172"].inputs.seed = generateSeed();
  const fileInfo = await submitAndPoll(workflow, "174", { interval: 2000, timeout: 600000 });
  return await downloadAsBase64(fileInfo);
};

/**
 * LTX Director v2 文生视频（WORKFLOW_LTX_DIRECTOR_V2）
 * 注入：提示词 -> 节点46(LTXDirector) global_prompt / timeline_data.global_prompt；时长 -> duration_seconds/duration_frames；
 * 分辨率 -> custom_width/custom_height；种子 -> 节点94:28(RandomNoise).noise_seed
 */
const runLTXDirectorV2 = async (config: VideoConfig): Promise<string> => {
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_LTX_DIRECTOR_V2));
  const node46 = workflow["46"];

  // 解析并更新 timeline_data
  let timeline: any = {};
  try {
    timeline = JSON.parse(node46.inputs.timeline_data || "{}");
  } catch (e) {
    timeline = {};
  }
  timeline.global_prompt = config.prompt || "";

  const frameRate = node46.inputs.frame_rate || 24;
  const durationSeconds = config.duration || 5;
  const durationFrames = Math.round(durationSeconds * frameRate);

  node46.inputs.global_prompt = config.prompt || "";
  node46.inputs.timeline_data = JSON.stringify(timeline);
  node46.inputs.duration_seconds = durationSeconds;
  node46.inputs.duration_frames = durationFrames;
  if (timeline.normalDurationFrames !== undefined) timeline.normalDurationFrames = durationFrames;
  if (timeline.duration_frames !== undefined) timeline.duration_frames = durationFrames;
  node46.inputs.timeline_data = JSON.stringify(timeline);

  // 分辨率
  const is9v16 = config.aspectRatio === "9:16";
  const is1080p = /1080/i.test(config.resolution || "");
  const [w, h] = is9v16 ? [720, 1280] : [1280, 720];
  node46.inputs.custom_width = is1080p ? (is9v16 ? 1080 : 1920) : w;
  node46.inputs.custom_height = is1080p ? (is9v16 ? 1920 : 1080) : h;

  // 音频：use_custom_audio 保持默认（工作流自生成音频）
  workflow["94:28"].inputs.noise_seed = generateSeed();

  // 输出：SaveVideo(节点30)，视频输出通过 CreateVideo(节点96:17) 产生
  const fileInfo = await submitAndPoll(workflow, "30", { interval: 5000, timeout: 1800000, isVideo: true });
  return await downloadAsBase64(fileInfo);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  switch (model.modelName) {
    case "z-image-t2i":
      return await runZImageT2I(config);
    case "z-image-enhance":
      return await runZImageEnhance(config);
    case "flux2-klein":
      return await runFlux2Klein(config);
    case "qwen-edit-2511":
      return await runQwenEdit2511(config);
    case "seedvr2-upscale":
      return await runSeedVR2Upscale(config);
    default:
      throw new Error(`未知的图片模型: ${model.modelName}`);
  }
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  switch (model.modelName) {
    case "ltx-director-v2":
      return await runLTXDirectorV2(config);
    default:
      throw new Error(`未知的视频模型: ${model.modelName}`);
  }
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
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
