/**
 * Toonflow AI供应商 - wan2.2 所有工作流（本地 ComfyUI）
 * @version 1.0
 *
 * 合并以下工作流:
 *   - Wan2.2 首尾帧视频（本地 ComfyUI）（首尾帧生视频（FLF2V））
 *   - Wan2.2 I2V（本地 ComfyUI）（图生视频（I2V））
 *   - Wan2.2 T2V（本地 ComfyUI）（文生视频（T2V））
 *
 * 包含各工作流的独立 WORKFLOW_JSON_* 和适配器函数。
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "wan2.2",
  version: "1.0",
  author: "Toonflow",
  name: "wan2.2 合集（本地 ComfyUI）",
  description: "  - 首尾帧生视频（FLF2V）: 基于本地 ComfyUI 的 Wan2.2 首尾帧生视频工作流。需要 ComfyUI 环境已配置 Wan2.2 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。\n\n  - 图生视频（I2V）: 基于本地 ComfyUI 的 Wan2.2 图生视频工作流。需要 ComfyUI 环境已配置 Wan2.2 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。\n\n  - 文生视频（T2V）: 基于本地 ComfyUI 的 Wan2.2 文生视频工作流。需要 ComfyUI 环境已配置 Wan2.2 模型。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
  },
  models: [
    {
      name: "Wan2.2 FLF2V 14B",
      modelName: "wan2.2-flf2v",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
      { duration: [3, 5, 7, 10], resolution: ["480p", "720p", "1080p"] }
      ],
    },
    {
      name: "Wan2.2 I2V 14B",
      modelName: "wan2.2-i2v",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
      ],
    },
    {
      name: "Wan2.2 T2V 14B",
      modelName: "wan2.2-t2v",
      type: "video",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
      ],
    },
  ],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

// 首尾帧生视频（FLF2V） - Wan2.2 首尾帧视频（本地 ComfyUI）
const WORKFLOW_JSON_FLF2V = {
  "72": {
    "inputs": {
      "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      "type": "wan",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "加载CLIP"
    }
  },
  "73": {
    "inputs": {
      "shift": 5,
      "model": [
        "97",
        0
      ]
    },
    "class_type": "ModelSamplingSD3",
    "_meta": {
      "title": "采样算法（SD3）"
    }
  },
  "74": {
    "inputs": {
      "shift": 5,
      "model": [
        "98",
        0
      ]
    },
    "class_type": "ModelSamplingSD3",
    "_meta": {
      "title": "采样算法（SD3）"
    }
  },
  "76": {
    "inputs": {
      "unet_name": "Wan2_2-I2V-A14B-HIGH_fp8_e4m3fn_scaled_KJ.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "77": {
    "inputs": {
      "unet_name": "Wan2_2-I2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "78": {
    "inputs": {
      "text": "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
      "clip": [
        "72",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Negative Prompt)"
    }
  },
  "79": {
    "inputs": {
      "vae_name": "wan_2.1_vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "80": {
    "inputs": {
      "image": "ComfyUI_00157_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "81": {
    "inputs": {
      "width": 832,
      "height": 480,
      "length": 113,
      "batch_size": 1,
      "positive": [
        "90",
        0
      ],
      "negative": [
        "78",
        0
      ],
      "vae": [
        "79",
        0
      ],
      "start_image": [
        "80",
        0
      ],
      "end_image": [
        "89",
        0
      ]
    },
    "class_type": "WanFirstLastFrameToVideo",
    "_meta": {
      "title": "Wan首尾帧视频"
    }
  },
  "83": {
    "inputs": {
      "filename_prefix": "video/ComfyUI",
      "format": "auto",
      "codec": "auto",
      "video": [
        "86",
        0
      ]
    },
    "class_type": "SaveVideo",
    "_meta": {
      "title": "保存视频"
    }
  },
  "84": {
    "inputs": {
      "add_noise": "enable",
      "noise_seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "start_at_step": 0,
      "end_at_step": 2,
      "return_with_leftover_noise": "enable",
      "model": [
        "73",
        0
      ],
      "positive": [
        "81",
        0
      ],
      "negative": [
        "81",
        1
      ],
      "latent_image": [
        "81",
        2
      ]
    },
    "class_type": "KSamplerAdvanced",
    "_meta": {
      "title": "K采样器（高级）"
    }
  },
  "85": {
    "inputs": {
      "samples": [
        "87",
        0
      ],
      "vae": [
        "79",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "86": {
    "inputs": {
      "fps": 16,
      "images": [
        "85",
        0
      ]
    },
    "class_type": "CreateVideo",
    "_meta": {
      "title": "创建视频"
    }
  },
  "87": {
    "inputs": {
      "add_noise": "disable",
      "noise_seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "start_at_step": 2,
      "end_at_step": 4,
      "return_with_leftover_noise": "disable",
      "model": [
        "74",
        0
      ],
      "positive": [
        "81",
        0
      ],
      "negative": [
        "81",
        1
      ],
      "latent_image": [
        "84",
        0
      ]
    },
    "class_type": "KSamplerAdvanced",
    "_meta": {
      "title": "K采样器（高级）"
    }
  },
  "89": {
    "inputs": {
      "image": "ComfyUI_00158_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "90": {
    "inputs": {
      "text": "",
      "clip": [
        "72",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Positive Prompt)"
    }
  },
  "97": {
    "inputs": {
      "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
      "strength_model": 1,
      "model": [
        "76",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "98": {
    "inputs": {
      "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
      "strength_model": 1,
      "model": [
        "77",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  }
};

// 图生视频（I2V） - Wan2.2 I2V（本地 ComfyUI）
const WORKFLOW_JSON_I2V = {
  "1": {
    "inputs": {
      "unet_name": "Wan2.2-I2V-A14B-HighNoise-Q8_0.gguf"
    },
    "class_type": "UnetLoaderGGUF",
    "_meta": {
      "title": "Unet Loader (GGUF)"
    }
  },
  "2": {
    "inputs": {
      "unet_name": "Wan2.2-I2V-A14B-LowNoise-Q8_0.gguf"
    },
    "class_type": "UnetLoaderGGUF",
    "_meta": {
      "title": "Unet Loader (GGUF)"
    }
  },
  "4": {
    "inputs": {
      "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      "type": "wan",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "加载CLIP"
    }
  },
  "5": {
    "inputs": {
      "vae_name": "wan_2.1_vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "7": {
    "inputs": {
      "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
      "strength_model": 1,
      "model": [
        "35",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "8": {
    "inputs": {
      "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
      "strength_model": 1,
      "model": [
        "36",
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
      "text": "",
      "clip": [
        "4",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "13": {
    "inputs": {
      "text": "",
      "clip": [
        "4",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "14": {
    "inputs": {
      "add_noise": "enable",
      "noise_seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "start_at_step": 0,
      "end_at_step": 2,
      "return_with_leftover_noise": "enable",
      "model": [
        "27",
        0
      ],
      "positive": [
        "29",
        0
      ],
      "negative": [
        "29",
        1
      ],
      "latent_image": [
        "29",
        2
      ]
    },
    "class_type": "KSamplerAdvanced",
    "_meta": {
      "title": "K采样器（高级）"
    }
  },
  "15": {
    "inputs": {
      "add_noise": "disable",
      "noise_seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "start_at_step": 2,
      "end_at_step": 4,
      "return_with_leftover_noise": "disable",
      "model": [
        "28",
        0
      ],
      "positive": [
        "29",
        0
      ],
      "negative": [
        "29",
        1
      ],
      "latent_image": [
        "14",
        0
      ]
    },
    "class_type": "KSamplerAdvanced",
    "_meta": {
      "title": "K采样器（高级）"
    }
  },
  "22": {
    "inputs": {
      "samples": [
        "15",
        0
      ],
      "vae": [
        "5",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "26": {
    "inputs": {
      "frame_rate": 16,
      "loop_count": 0,
      "filename_prefix": "wan2.2",
      "format": "video/h264-mp4",
      "pix_fmt": "yuv420p",
      "crf": 19,
      "save_metadata": true,
      "trim_to_audio": false,
      "pingpong": false,
      "save_output": true,
      "images": [
        "22",
        0
      ],
      "vae": [
        "5",
        0
      ]
    },
    "class_type": "VHS_VideoCombine",
    "_meta": {
      "title": "Video Combine 🎥🅥🅗🅢"
    }
  },
  "27": {
    "inputs": {
      "shift": 5,
      "model": [
        "7",
        0
      ]
    },
    "class_type": "ModelSamplingSD3",
    "_meta": {
      "title": "采样算法（SD3）"
    }
  },
  "28": {
    "inputs": {
      "shift": 5,
      "model": [
        "8",
        0
      ]
    },
    "class_type": "ModelSamplingSD3",
    "_meta": {
      "title": "采样算法（SD3）"
    }
  },
  "29": {
    "inputs": {
      "width": [
        "31",
        1
      ],
      "height": [
        "31",
        2
      ],
      "length": 81,
      "batch_size": 1,
      "positive": [
        "12",
        0
      ],
      "negative": [
        "13",
        0
      ],
      "vae": [
        "5",
        0
      ],
      "start_image": [
        "31",
        0
      ]
    },
    "class_type": "WanImageToVideo",
    "_meta": {
      "title": "图像到视频（Wan）"
    }
  },
  "30": {
    "inputs": {
      "image": "ComfyUI_00155_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "31": {
    "inputs": {
      "width": 832,
      "height": 480,
      "upscale_method": "nearest-exact",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 2,
      "device": "cpu",
      "image": [
        "30",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "34": {
    "inputs": {
      "width": 832,
      "height": 480,
      "length": 129,
      "batch_size": 1
    },
    "class_type": "WanFirstLastFrameToVideo",
    "_meta": {
      "title": "Wan首尾帧视频"
    }
  },
  "35": {
    "inputs": {
      "unet_name": "Wan2_2-I2V-A14B-HIGH_fp8_e4m3fn_scaled_KJ.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "36": {
    "inputs": {
      "unet_name": "Wan2_2-I2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  }
};

// 文生视频（T2V） - Wan2.2 T2V（本地 ComfyUI）
const WORKFLOW_JSON_T2V = {
  "1": {
    "inputs": {
      "unet_name": "Wan2.2-T2V-A14B-HighNoise-Q8_0.gguf"
    },
    "class_type": "UnetLoaderGGUF",
    "_meta": {
      "title": "Unet Loader (GGUF)"
    }
  },
  "2": {
    "inputs": {
      "unet_name": "Wan2.2-T2V-A14B-LowNoise-Q8_0.gguf"
    },
    "class_type": "UnetLoaderGGUF",
    "_meta": {
      "title": "Unet Loader (GGUF)"
    }
  },
  "4": {
    "inputs": {
      "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      "type": "wan",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "加载CLIP"
    }
  },
  "5": {
    "inputs": {
      "vae_name": "wan_2.1_vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "7": {
    "inputs": {
      "lora_name": "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors",
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
  "8": {
    "inputs": {
      "lora_name": "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors",
      "strength_model": 1,
      "model": [
        "30",
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
      "text": "",
      "clip": [
        "4",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "13": {
    "inputs": {
      "text": "",
      "clip": [
        "4",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "14": {
    "inputs": {
      "add_noise": "enable",
      "noise_seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "start_at_step": 0,
      "end_at_step": 2,
      "return_with_leftover_noise": "enable",
      "model": [
        "27",
        0
      ],
      "positive": [
        "12",
        0
      ],
      "negative": [
        "13",
        0
      ],
      "latent_image": [
        "21",
        0
      ]
    },
    "class_type": "KSamplerAdvanced",
    "_meta": {
      "title": "K采样器（高级）"
    }
  },
  "15": {
    "inputs": {
      "add_noise": "disable",
      "noise_seed": 0,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "start_at_step": 2,
      "end_at_step": 4,
      "return_with_leftover_noise": "disable",
      "model": [
        "28",
        0
      ],
      "positive": [
        "12",
        0
      ],
      "negative": [
        "13",
        0
      ],
      "latent_image": [
        "14",
        0
      ]
    },
    "class_type": "KSamplerAdvanced",
    "_meta": {
      "title": "K采样器（高级）"
    }
  },
  "21": {
    "inputs": {
      "width": 832,
      "height": 480,
      "length": 101,
      "batch_size": 1
    },
    "class_type": "EmptyHunyuanLatentVideo",
    "_meta": {
      "title": "空Latent视频（Hunyuan）"
    }
  },
  "22": {
    "inputs": {
      "samples": [
        "15",
        0
      ],
      "vae": [
        "5",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "26": {
    "inputs": {
      "frame_rate": 20,
      "loop_count": 0,
      "filename_prefix": "wan2.2",
      "format": "video/h265-mp4",
      "pix_fmt": "yuv420p10le",
      "crf": 22,
      "save_metadata": true,
      "pingpong": false,
      "save_output": true,
      "images": [
        "22",
        0
      ],
      "vae": [
        "5",
        0
      ]
    },
    "class_type": "VHS_VideoCombine",
    "_meta": {
      "title": "Video Combine 🎥🅥🅗🅢"
    }
  },
  "27": {
    "inputs": {
      "shift": 5,
      "model": [
        "7",
        0
      ]
    },
    "class_type": "ModelSamplingSD3",
    "_meta": {
      "title": "采样算法（SD3）"
    }
  },
  "28": {
    "inputs": {
      "shift": 5,
      "model": [
        "8",
        0
      ]
    },
    "class_type": "ModelSamplingSD3",
    "_meta": {
      "title": "采样算法（SD3）"
    }
  },
  "29": {
    "inputs": {
      "unet_name": "Wan2_2-T2V-A14B_HIGH_fp8_e4m3fn_scaled_KJ.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "30": {
    "inputs": {
      "unet_name": "Wan2_2-T2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
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

// 首尾帧生视频（FLF2V）
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");

  // 1. 处理参考图（首尾帧）
  const refs = config.referenceList || [];
  const firstFrame = refs[0]?.base64 || "";
  const endFrame = refs[1]?.base64 || "";
  if (!firstFrame || !endFrame) {
    throw new Error("首尾帧视频需要提供首帧和尾帧两张参考图片");
  }

  let rawFirstFrame = firstFrame;
  let rawEndFrame = endFrame;
  if (rawFirstFrame.includes(",")) rawFirstFrame = rawFirstFrame.split(",")[1];
  if (rawEndFrame.includes(",")) rawEndFrame = rawEndFrame.split(",")[1];

  logger(`[Wan2.2 FLF2V] 开始生成，首帧 base64 长度: ${rawFirstFrame.length}, 尾帧 base64 长度: ${rawEndFrame.length}`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON_FLF2V));

  // 3. 替换 LoadImage 节点为 easy loadImageBase64
  // 节点 80 = 首帧，节点 89 = 尾帧
  workflow["80"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawFirstFrame, image_output: "Preview", save_prefix: "ComfyUI" }
  };
  workflow["89"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawEndFrame, image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 4. 注入提示词
  workflow["90"]["inputs"]["text"] = config.prompt;

  // 5. 计算并设置帧数（帧率 16fps）
  const frameRate = 16;
  const frameCount = Math.max(config.duration * frameRate + 1, 1);
  workflow["81"]["inputs"]["length"] = frameCount;

  // 6. 设置分辨率
  let width = 832, height = 480;
  if (config.resolution === "720p") {
    width = config.aspectRatio === "16:9" ? 1280 : 720;
    height = config.aspectRatio === "16:9" ? 720 : 1280;
  } else if (config.resolution === "1080p") {
    width = config.aspectRatio === "16:9" ? 1920 : 1080;
    height = config.aspectRatio === "16:9" ? 1080 : 1920;
  }
  workflow["81"]["inputs"]["width"] = width;
  workflow["81"]["inputs"]["height"] = height;

  logger(`[Wan2.2 FLF2V] 分辨率: ${width}x${height}, 帧数: ${frameCount}`);

  // 7. 设置随机种子
  workflow["84"]["inputs"]["noise_seed"] = generateSeed();
  workflow["87"]["inputs"]["noise_seed"] = generateSeed();

  // 8. 提交到 ComfyUI API
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

  logger(`[Wan2.2 FLF2V] 任务已提交，ID: ${promptId}`);

  // 9. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 SaveVideo（节点 83）的输出
    const output = run.outputs?.["83"];
    const fileInfo = output?.video?.[0] || output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 3000, 600000);

  if (result.error) throw new Error(`Wan2.2 FLF2V 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的视频");

  // 10. 下载视频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[Wan2.2 FLF2V] 下载视频: ${downloadUrl}`);
  return await urlToBase64(downloadUrl);
};

// 图生视频（I2V）
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");

  // 1. 处理参考图
  let rawBase64 = config.referenceList?.[0]?.base64 || "";
  if (!rawBase64) throw new Error("图生视频需要提供参考图片");
  if (rawBase64.includes(",")) rawBase64 = rawBase64.split(",")[1];

  logger(`[Wan2.2 I2V] 开始生成，参考图 base64 长度: ${rawBase64.length}`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON_I2V));

  // 3. 替换 LoadImage（节点 30）为 easy loadImageBase64
  workflow["30"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawBase64, image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 4. 注入提示词
  workflow["12"]["inputs"]["text"] = config.prompt;

  // 5. 计算并设置帧数（帧率 16fps）
  const frameRate = 16;
  const frameCount = Math.max(config.duration * frameRate + 1, 1);
  workflow["29"]["inputs"]["length"] = frameCount;

  // 6. 设置分辨率
  let width = 832, height = 480;
  if (config.resolution === "720p") {
    width = config.aspectRatio === "16:9" ? 1280 : 720;
    height = config.aspectRatio === "16:9" ? 720 : 1280;
  } else if (config.resolution === "1080p") {
    width = config.aspectRatio === "16:9" ? 1920 : 1080;
    height = config.aspectRatio === "16:9" ? 1080 : 1920;
  }
  workflow["31"]["inputs"]["width"] = width;
  workflow["31"]["inputs"]["height"] = height;

  logger(`[Wan2.2 I2V] 分辨率: ${width}x${height}, 帧数: ${frameCount}`);

  // 7. 设置随机种子
  workflow["14"]["inputs"]["noise_seed"] = generateSeed();
  workflow["15"]["inputs"]["noise_seed"] = generateSeed();

  // 8. 提交到 ComfyUI API
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

  logger(`[Wan2.2 I2V] 任务已提交，ID: ${promptId}`);

  // 9. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 VHS_VideoCombine（节点 26）的输出
    const output = run.outputs?.["26"];
    const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 3000, 600000);

  if (result.error) throw new Error(`Wan2.2 I2V 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的视频");

  // 10. 下载视频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[Wan2.2 I2V] 下载视频: ${downloadUrl}`);
  return await urlToBase64(downloadUrl);
};

// 文生视频（T2V）
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");

  logger(`[Wan2.2 T2V] 开始生成视频，提示词长度: ${config.prompt.length}`);

  // 1. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON_T2V));

  // 2. 注入提示词（正面）
  workflow["12"]["inputs"]["text"] = config.prompt;

  // 3. 计算并设置帧数（帧率 20fps）
  const frameRate = 20;
  const frameCount = Math.max(config.duration * frameRate + 1, 1);
  workflow["21"]["inputs"]["length"] = frameCount;

  // 4. 设置分辨率
  let width = 832, height = 480;
  if (config.resolution === "720p") {
    width = config.aspectRatio === "16:9" ? 1280 : 720;
    height = config.aspectRatio === "16:9" ? 720 : 1280;
  } else if (config.resolution === "1080p") {
    width = config.aspectRatio === "16:9" ? 1920 : 1080;
    height = config.aspectRatio === "16:9" ? 1080 : 1920;
  }
  workflow["21"]["inputs"]["width"] = width;
  workflow["21"]["inputs"]["height"] = height;

  logger(`[Wan2.2 T2V] 分辨率: ${width}x${height}, 帧数: ${frameCount}`);

  // 5. 设置随机种子
  workflow["14"]["inputs"]["noise_seed"] = generateSeed();
  workflow["15"]["inputs"]["noise_seed"] = generateSeed();

  // 6. 提交到 ComfyUI API
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

  logger(`[Wan2.2 T2V] 任务已提交，ID: ${promptId}`);

  // 7. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 VHS_VideoCombine（节点 26）的输出
    const output = run.outputs?.["26"];
    const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 3000, 600000);

  if (result.error) throw new Error(`Wan2.2 T2V 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的视频");

  // 8. 下载视频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[Wan2.2 T2V] 下载视频: ${downloadUrl}`);
  return await urlToBase64(downloadUrl);
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