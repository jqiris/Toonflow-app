/**
 * Toonflow AI供应商 - LTX 2.3 图生视频（本地 ComfyUI）
 * @version 1.0
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "ltx2_3_it2v",
  version: "1.0",
  author: "Toonflow",
  name: "LTX 2.3 I2V（本地 ComfyUI）",
  description: "基于本地 ComfyUI 的 LTX 2.3 图生视频工作流。需要 ComfyUI 环境已配置 LTX 2.3 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: { baseUrl: "http://localhost:8188" },
  models: [{
    name: "LTX 2.3 I2V 22B",
    modelName: "ltx2.3-i2v",
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
  "1241": {
    "inputs": {
      "frame_rate": [
        "4989",
        0
      ],
      "positive": [
        "2483",
        0
      ],
      "negative": [
        "2612",
        0
      ]
    },
    "class_type": "LTXVConditioning",
    "_meta": {
      "title": "LTXV条件"
    }
  },
  "2004": {
    "inputs": {
      "image": "wan2.2_00002.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "2483": {
    "inputs": {
      "text": "",
      "clip": [
        "4982",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Positive Prompt)"
    }
  },
  "2612": {
    "inputs": {
      "text": "pc game, console game, video game, cartoon, childish, ugly",
      "clip": [
        "4982",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Negative Prompt)"
    }
  },
  "3059": {
    "inputs": {
      "width": 864,
      "height": 480,
      "length": [
        "4988",
        0
      ],
      "batch_size": 1
    },
    "class_type": "EmptyLTXVLatentVideo",
    "_meta": {
      "title": "空Latent视频（LTXV）"
    }
  },
  "3159": {
    "inputs": {
      "strength": 0.7,
      "bypass": [
        "4987",
        0
      ],
      "vae": [
        "3940",
        2
      ],
      "image": [
        "3336",
        0
      ],
      "latent": [
        "3059",
        0
      ]
    },
    "class_type": "LTXVImgToVideoConditionOnly",
    "_meta": {
      "title": "🅛🅣🅧 LTXV Img To Video Condition Only"
    }
  },
  "3336": {
    "inputs": {
      "img_compression": 18,
      "image": [
        "4990",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "3940": {
    "inputs": {
      "ckpt_name": "ltx-2.3-22b-dev-fp8.safetensors"
    },
    "class_type": "CheckpointLoaderSimple",
    "_meta": {
      "title": "Checkpoint加载器（简易）"
    }
  },
  "3980": {
    "inputs": {
      "frames_number": [
        "4988",
        0
      ],
      "frame_rate": [
        "5000",
        0
      ],
      "batch_size": 1,
      "audio_vae": [
        "4010",
        0
      ]
    },
    "class_type": "LTXVEmptyLatentAudio",
    "_meta": {
      "title": "LTXV 空音频潜空间"
    }
  },
  "4010": {
    "inputs": {
      "ckpt_name": "ltx-2.3-22b-dev-fp8.safetensors"
    },
    "class_type": "LTXVAudioVAELoader",
    "_meta": {
      "title": "LTXV音频VAE加载器"
    }
  },
  "4528": {
    "inputs": {
      "video_latent": [
        "3159",
        0
      ],
      "audio_latent": [
        "3980",
        0
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "4828": {
    "inputs": {
      "cfg": 1,
      "model": [
        "5003",
        0
      ],
      "positive": [
        "1241",
        0
      ],
      "negative": [
        "1241",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "4829": {
    "inputs": {
      "noise": [
        "4832",
        0
      ],
      "guider": [
        "4828",
        0
      ],
      "sampler": [
        "4831",
        0
      ],
      "sigmas": [
        "4984",
        0
      ],
      "latent_image": [
        "4528",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "4831": {
    "inputs": {
      "sampler_name": "euler_ancestral_cfg_pp"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "4832": {
    "inputs": {
      "noise_seed": 43
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "4845": {
    "inputs": {
      "av_latent": [
        "4829",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "4848": {
    "inputs": {
      "samples": [
        "4973",
        1
      ],
      "audio_vae": [
        "4010",
        0
      ]
    },
    "class_type": "LTXVAudioVAEDecode",
    "_meta": {
      "title": "LTXV音频VAE解码"
    }
  },
  "4849": {
    "inputs": {
      "fps": [
        "4989",
        0
      ],
      "images": [
        "4995",
        0
      ],
      "audio": [
        "4848",
        0
      ]
    },
    "class_type": "CreateVideo",
    "_meta": {
      "title": "创建视频"
    }
  },
  "4852": {
    "inputs": {
      "filename_prefix": "output",
      "format": "auto",
      "codec": "auto",
      "video-preview": "",
      "video": [
        "4849",
        0
      ]
    },
    "class_type": "SaveVideo",
    "_meta": {
      "title": "保存视频"
    }
  },
  "4922": {
    "inputs": {
      "lora_name": "ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
      "strength_model": 0.5,
      "model": [
        "3940",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "4964": {
    "inputs": {
      "cfg": 1,
      "model": [
        "4922",
        0
      ],
      "positive": [
        "1241",
        0
      ],
      "negative": [
        "1241",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "4967": {
    "inputs": {
      "noise_seed": 42
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "4969": {
    "inputs": {
      "video_latent": [
        "4970",
        0
      ],
      "audio_latent": [
        "4845",
        1
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "4970": {
    "inputs": {
      "strength": 1,
      "bypass": [
        "4987",
        0
      ],
      "vae": [
        "3940",
        2
      ],
      "image": [
        "4990",
        0
      ],
      "latent": [
        "4975",
        0
      ]
    },
    "class_type": "LTXVImgToVideoConditionOnly",
    "_meta": {
      "title": "🅛🅣🅧 LTXV Img To Video Condition Only"
    }
  },
  "4971": {
    "inputs": {
      "noise": [
        "4967",
        0
      ],
      "guider": [
        "4964",
        0
      ],
      "sampler": [
        "4976",
        0
      ],
      "sigmas": [
        "4985",
        0
      ],
      "latent_image": [
        "4969",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "4973": {
    "inputs": {
      "av_latent": [
        "4971",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "4974": {
    "inputs": {
      "model_name": "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
    },
    "class_type": "LatentUpscaleModelLoader",
    "_meta": {
      "title": "加载Latent放大模型"
    }
  },
  "4975": {
    "inputs": {
      "samples": [
        "4845",
        0
      ],
      "upscale_model": [
        "4974",
        0
      ],
      "vae": [
        "3940",
        2
      ]
    },
    "class_type": "LTXVLatentUpsampler",
    "_meta": {
      "title": "LTXV潜空间上采样器"
    }
  },
  "4976": {
    "inputs": {
      "sampler_name": "euler_cfg_pp"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "4982": {
    "inputs": {
      "text_encoder": "gemma_3_12B_it_fp4_mixed.safetensors",
      "ckpt_name": "ltx-2.3-22b-dev-fp8.safetensors",
      "device": "default"
    },
    "class_type": "LTXAVTextEncoderLoader",
    "_meta": {
      "title": "LTXV音频文本编码器加载器"
    }
  },
  "4984": {
    "inputs": {
      "sigmas": "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    },
    "class_type": "ManualSigmas",
    "_meta": {
      "title": "自定义Sigmas"
    }
  },
  "4985": {
    "inputs": {
      "sigmas": "0.85, 0.7250, 0.4219, 0.0"
    },
    "class_type": "ManualSigmas",
    "_meta": {
      "title": "自定义Sigmas"
    }
  },
  "4987": {
    "inputs": {
      "value": false
    },
    "class_type": "PrimitiveBoolean",
    "_meta": {
      "title": "bypass_i2v"
    }
  },
  "4988": {
    "inputs": {
      "value": 121
    },
    "class_type": "PrimitiveInt",
    "_meta": {
      "title": "number of frames"
    }
  },
  "4989": {
    "inputs": {
      "value": 24
    },
    "class_type": "PrimitiveFloat",
    "_meta": {
      "title": "fps"
    }
  },
  "4990": {
    "inputs": {
      "resize_type": "scale longer dimension",
      "resize_type.longer_size": 1536,
      "scale_method": "lanczos",
      "input": [
        "2004",
        0
      ]
    },
    "class_type": "ResizeImageMaskNode",
    "_meta": {
      "title": "调整图像/掩码大小"
    }
  },
  "4995": {
    "inputs": {
      "horizontal_tiles": 2,
      "vertical_tiles": 2,
      "overlap": 6,
      "last_frame_fix": false,
      "working_device": "auto",
      "working_dtype": "auto",
      "vae": [
        "3940",
        2
      ],
      "latents": [
        "4973",
        0
      ]
    },
    "class_type": "LTXVTiledVAEDecode",
    "_meta": {
      "title": "🅛🅣🅧 LTXV Tiled VAE Decode"
    }
  },
  "5000": {
    "inputs": {
      "a": [
        "4989",
        0
      ]
    },
    "class_type": "LTXFloatToInt",
    "_meta": {
      "title": "🅛🅣🅧 Float To Int"
    }
  },
  "5003": {
    "inputs": {
      "lora_name": "xianxia.safetensors",
      "strength_model": 1,
      "model": [
        "4922",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
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

  logger(`[LTX 2.3 I2V] 开始生成，参考图 base64 长度: ${rawBase64.length}`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 3. 替换 LoadImage（节点 2004）为 easy loadImageBase64
  workflow["2004"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawBase64, image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 4. 注入提示词（节点 2483）
  workflow["2483"]["inputs"]["text"] = config.prompt;

  // 5. 计算并设置帧数（节点 4988，帧率 24fps）
  const frameRate = 24;
  const frameCount = Math.max(config.duration * frameRate + 1, 1);
  workflow["4988"]["inputs"]["value"] = frameCount;

  // 6. 设置帧率（节点 4989）
  workflow["4989"]["inputs"]["value"] = frameRate;

  // 7. 设置分辨率
  //    节点 4990 (ResizeImageMaskNode) 控制输入图缩放
  //    节点 3059 (EmptyLTXVLatentVideo) 控制 latent 尺寸
  let width = 864, height = 480;
  let longerSize = 1024;
  if (config.resolution === "720p") {
    width = config.aspectRatio === "16:9" ? 1280 : 720;
    height = config.aspectRatio === "16:9" ? 720 : 1280;
    longerSize = 1280;
  } else if (config.resolution === "1080p") {
    width = config.aspectRatio === "16:9" ? 1920 : 1080;
    height = config.aspectRatio === "16:9" ? 1080 : 1920;
    longerSize = 1920;
  } else if (config.resolution === "480p") {
    width = config.aspectRatio === "16:9" ? 854 : 480;
    height = config.aspectRatio === "16:9" ? 480 : 854;
    longerSize = 1024;
  }
  workflow["4990"]["inputs"]["resize_type.longer_size"] = longerSize;
  workflow["3059"]["inputs"]["width"] = width;
  workflow["3059"]["inputs"]["height"] = height;

  logger(`[LTX 2.3 I2V] 分辨率: ${width}x${height}, 帧数: ${frameCount}, 帧率: ${frameRate}`);

  // 8. 设置随机种子
  workflow["4832"]["inputs"]["noise_seed"] = generateSeed();
  workflow["4967"]["inputs"]["noise_seed"] = generateSeed();

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

  logger(`[LTX 2.3 I2V] 任务已提交，ID: ${promptId}`);

  // 10. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 SaveVideo（节点 4852）的输出
    const output = run.outputs?.["4852"];
    const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 3000, 600000);

  if (result.error) throw new Error(`LTX 2.3 I2V 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的视频");

  // 11. 下载视频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[LTX 2.3 I2V] 下载视频: ${downloadUrl}`);
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

export { };
