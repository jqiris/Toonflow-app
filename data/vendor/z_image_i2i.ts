/**
 * Toonflow AI供应商 - Z-Image 图生图（本地 ComfyUI）
 * @version 1.0
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "z_image_i2i",
  version: "1.0",
  author: "Toonflow",
  name: "Z-Image I2I（本地 ComfyUI）",
  description: "基于本地 ComfyUI 的 Z-Image Turbo 图生图工作流。需要 ComfyUI 环境已配置 Z-Image Turbo 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: { baseUrl: "http://localhost:8188" },
  models: [{
    name: "Z-Image Turbo I2I",
    modelName: "z-image-i2i",
    type: "image",
    mode: ["singleImage"],
    associationSkills: "Z-Image Turbo 图生图，基于输入图片进行风格迁移或修改",
  }],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

const WORKFLOW_JSON = {
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
  "11": {
    "inputs": {
      "lora_name": "z_image_turbo_distill_patch_lora_bf16.safetensors",
      "strength_model": 0.8,
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
      "steps": 9,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": [
        "11",
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
        "20",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
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
      "user_prompt": "blurry ugly bad",
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
      "image": "国王寝宫（病危）.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "20": {
    "inputs": {
      "pixels": [
        "19",
        0
      ],
      "vae": [
        "6",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "21": {
    "inputs": {
      "mask": [
        "24",
        0
      ]
    },
    "class_type": "SetLatentNoiseMask",
    "_meta": {
      "title": "设置Latent噪波遮罩"
    }
  },
  "24": {
    "inputs": {
      "expand": 10,
      "incremental_expandrate": 0,
      "tapered_corners": true,
      "flip_input": false,
      "blur_radius": 15,
      "lerp_alpha": 1,
      "decay_factor": 1,
      "fill_holes": false
    },
    "class_type": "GrowMaskWithBlur",
    "_meta": {
      "title": "Grow Mask With Blur"
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
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少图片生成提示词");

  // 1. 处理参考图
  let rawBase64 = config.referenceList?.[0]?.base64 || "";
  if (!rawBase64) throw new Error("图生图需要提供参考图片");
  if (rawBase64.includes(",")) rawBase64 = rawBase64.split(",")[1];

  logger(`[Z-Image I2I] 开始生成图片，参考图 base64 长度: ${rawBase64.length}`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 3. 替换 LoadImage（节点 19）为 easy loadImageBase64
  workflow["19"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawBase64, image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 4. 注入提示词
  workflow["7"]["inputs"]["text"] = config.prompt;

  logger(`[Z-Image I2I] 提示词长度: ${config.prompt.length}`);

  // 5. 提交到 ComfyUI API
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

  logger(`[Z-Image I2I] 任务已提交，ID: ${promptId}`);

  // 6. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 SaveImage（节点 18）的输出
    const output = run.outputs?.["18"];
    const fileInfo = output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 2000, 300000);

  if (result.error) throw new Error(`Z-Image I2I 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的图片");

  // 7. 下载图片并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[Z-Image I2I] 下载图片: ${downloadUrl}`);
  return await urlToBase64(downloadUrl);
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
