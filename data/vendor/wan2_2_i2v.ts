/**
 * Toonflow AI供应商 - Wan2.2 图生视频（本地 ComfyUI）
 * @version 1.0
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "wan2_2_i2v",
  version: "1.0",
  author: "Toonflow",
  name: "Wan2.2 I2V（本地 ComfyUI）",
  description: "基于本地 ComfyUI 的 Wan2.2 图生视频工作流。需要 ComfyUI 环境已配置 Wan2.2 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: { baseUrl: "http://localhost:8188" },
  models: [{
    name: "Wan2.2 I2V 14B",
    modelName: "wan2.2-i2v",
    type: "video",
    mode: ["singleImage"],
    audio: false,
    durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
    ],
  }],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

const WORKFLOW_JSON = {
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
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");

  // 1. 处理参考图
  let rawBase64 = config.referenceList?.[0]?.base64 || "";
  if (!rawBase64) throw new Error("图生视频需要提供参考图片");
  if (rawBase64.includes(",")) rawBase64 = rawBase64.split(",")[1];

  logger(`[Wan2.2 I2V] 开始生成，参考图 base64 长度: ${rawBase64.length}`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

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
