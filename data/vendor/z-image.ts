/**
 * Toonflow AI供应商 - z.image 所有工作流（本地 ComfyUI）
 * @version 1.0
 *
 * 合并以下工作流:
 *   - Z-Image T2I（本地 ComfyUI）（文生图（T2I））
 *
 * 包含各工作流的独立 WORKFLOW_JSON_* 和适配器函数。
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "z_image",
  version: "1.0",
  author: "Toonflow",
  name: "z.image 合集（本地 ComfyUI）",
  description: "  - 文生图（T2I）: 基于本地 ComfyUI 的 Z-Image Turbo 文生图工作流。需要 ComfyUI 环境已配置 Z-Image Turbo 模型。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
  },
  models: [
    {
      name: "Z-Image Turbo T2I",
      modelName: "z-image-t2i",
      type: "image",
      mode: ["text"],
      associationSkills: "Z-Image Turbo 文生图，支持 18 步快速生成",
    },
  ],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

// 文生图（T2I） - Z-Image T2I（本地 ComfyUI）
const WORKFLOW_JSON_T2I = {
  "1": {
    "inputs": {
      "unet_name": "Z-Image_Turbo-diffusion.safetensors",
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
  "11": {
    "inputs": {
      "lora_name": "Z-image-Turbo-3DCG画风_1.1.safetensors",
      "strength_model": 1,
      "model": [
        "1",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "12": {
    "inputs": {
      "shift": 3,
      "model": [
        "11",
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
      "seed": 0,
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
  }
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("不支持文本生成");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  throw new Error("不支持图片生成");
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