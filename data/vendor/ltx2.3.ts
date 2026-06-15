/**
 * Toonflow AI供应商 - ltx2.3 所有工作流（本地 ComfyUI）
 * @version 1.0
 *
 * 合并以下工作流:
 *   - LTX 2.3 FLF2V（本地 ComfyUI）（首尾帧生视频（FLF2V））
 *   - LTX 2.3 I2V（本地 ComfyUI）（图生视频（I2V））
 *   - LTX 2.3 Multi2V（本地 ComfyUI）（多参考图生视频（Multi2V））
 *
 * 包含各工作流的独立 WORKFLOW_JSON_* 和适配器函数。
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "ltx2.3",
  version: "1.0",
  author: "Toonflow",
  name: "ltx2.3 合集（本地 ComfyUI）",
  description: "  - 首尾帧生视频（FLF2V）: 基于本地 ComfyUI 的 LTX 2.3 首尾帧生视频工作流。需要 ComfyUI 环境已配置 LTX 2.3 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。\n\n  - 图生视频（I2V）: 基于本地 ComfyUI 的 LTX 2.3 图生视频工作流。需要 ComfyUI 环境已配置 LTX 2.3 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。\n\n  - 多参考图生视频（Multi2V）: 基于本地 ComfyUI 的 LTX 2.3 多参考图生视频工作流。支持上传 1~6 张参考图，分布在视频时间轴的多个位置进行引导生成。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
  },
  models: [
    {
      name: "LTX 2.3 FLF2V 22B",
      modelName: "ltx2.3-flf2v",
      type: "video",
      mode: ["startEndRequired"],
      audio: "optional",
      durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
      ],
    },
    {
      name: "LTX 2.3 I2V 22B",
      modelName: "ltx2.3-i2v",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
      ],
    },
    {
      name: "LTX 2.3 Multi2V 22B",
      modelName: "ltx2.3-multi2v",
      type: "video",
      mode: [["imageReference:6"]],
      audio: "optional",
      durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
      ],
      associationSkills: "基于 ltx2.3_multi2v.json 工作流，支持最多 6 张引导图的多位置引导视频生成。"
    },
  ],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

// 首尾帧生视频（FLF2V） - LTX 2.3 FLF2V（本地 ComfyUI）
const WORKFLOW_JSON_FLF2V = {
  "1": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "2": {
    "inputs": {
      "steps": 8,
      "max_shift": 2.05,
      "base_shift": 0.95,
      "stretch": true,
      "terminal": 0.1,
      "latent": [
        "24",
        0
      ]
    },
    "class_type": "LTXVScheduler",
    "_meta": {
      "title": "LTXV调度器"
    }
  },
  "4": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "5": {
    "inputs": {
      "sigmas": "0.909375, 0.725, 0.421875, 0.0"
    },
    "class_type": "ManualSigmas",
    "_meta": {
      "title": "自定义Sigmas"
    }
  },
  "8": {
    "inputs": {
      "cfg": 1,
      "model": [
        "197",
        0
      ],
      "positive": [
        "10",
        0
      ],
      "negative": [
        "10",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "9": {
    "inputs": {
      "frames_number": [
        "168",
        1
      ],
      "frame_rate": [
        "92",
        1
      ],
      "batch_size": 1,
      "audio_vae": [
        "175",
        0
      ]
    },
    "class_type": "LTXVEmptyLatentAudio",
    "_meta": {
      "title": "LTXV 空音频潜空间"
    }
  },
  "10": {
    "inputs": {
      "frame_rate": [
        "164",
        0
      ],
      "positive": [
        "16",
        0
      ],
      "negative": [
        "11",
        0
      ]
    },
    "class_type": "LTXVConditioning",
    "_meta": {
      "title": "LTXV条件"
    }
  },
  "11": {
    "inputs": {
      "text": "blurry, out of focus, overexposed, underexposed, low contrast, washed out colors, excessive noise, grainy texture, poor lighting, flickering, motion blur, distorted proportions, unnatural skin tones, deformed facial features, asymmetrical face, missing facial features, extra limbs, disfigured hands, wrong hand count, artifacts around text, unreadable text on shirt or hat, incorrect lettering on cap (\"PNTR\"), incorrect t-shirt slogan (\"JUST DO IT\"), missing microphone, misplaced microphone, inconsistent perspective, camera shake, incorrect depth of field, background too sharp, background clutter, distracting reflections, harsh shadows, inconsistent lighting direction, color banding, cartoonish rendering, 3D CGI look, unrealistic materials, uncanny valley effect, incorrect ethnicity, wrong gender, exaggerated expressions, smiling, laughing, exaggerated sadness, wrong gaze direction, eyes looking at camera, mismatched lip sync, silent or muted audio, distorted voice, robotic voice, echo, background noise, off-sync audio, missing sniff sounds, incorrect dialogue, added dialogue, repetitive speech, jittery movement, awkward pauses, incorrect timing, unnatural transitions, inconsistent framing, tilted camera, missing door or shelves, missing shallow depth of field, flat lighting, inconsistent tone, cinematic oversaturation, stylized filters, or AI artifacts.",
      "clip": [
        "190",
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
      "noise": [
        "15",
        0
      ],
      "guider": [
        "36",
        0
      ],
      "sampler": [
        "1",
        0
      ],
      "sigmas": [
        "2",
        0
      ],
      "latent_image": [
        "24",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "14": {
    "inputs": {
      "noise_seed": 456
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "15": {
    "inputs": {
      "noise_seed": 42
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "16": {
    "inputs": {
      "text": "",
      "clip": [
        "190",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "18": {
    "inputs": {
      "av_latent": [
        "13",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "21": {
    "inputs": {
      "noise": [
        "14",
        0
      ],
      "guider": [
        "8",
        0
      ],
      "sampler": [
        "4",
        0
      ],
      "sigmas": [
        "5",
        0
      ],
      "latent_image": [
        "34",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "24": {
    "inputs": {
      "video_latent": [
        "210",
        0
      ],
      "audio_latent": [
        "9",
        0
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "25": {
    "inputs": {
      "samples": [
        "18",
        0
      ],
      "upscale_model": [
        "182",
        0
      ],
      "vae": [
        "181",
        0
      ]
    },
    "class_type": "LTXVLatentUpsampler",
    "_meta": {
      "title": "spatial"
    }
  },
  "26": {
    "inputs": {
      "upscale_method": "lanczos",
      "scale_by": 0.5,
      "image": [
        "44",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "缩放图像（比例）"
    }
  },
  "28": {
    "inputs": {
      "image": [
        "26",
        0
      ]
    },
    "class_type": "GetImageSize",
    "_meta": {
      "title": "获取图像尺寸"
    }
  },
  "31": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "42",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "32": {
    "inputs": {
      "width": [
        "28",
        0
      ],
      "height": [
        "28",
        1
      ],
      "length": [
        "168",
        1
      ],
      "batch_size": 1
    },
    "class_type": "EmptyLTXVLatentVideo",
    "_meta": {
      "title": "空Latent视频（LTXV）"
    }
  },
  "34": {
    "inputs": {
      "video_latent": [
        "35",
        0
      ],
      "audio_latent": [
        "18",
        1
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "35": {
    "inputs": {
      "strength": 1,
      "bypass": false,
      "vae": [
        "181",
        0
      ],
      "image": [
        "42",
        0
      ],
      "latent": [
        "25",
        0
      ]
    },
    "class_type": "LTXVImgToVideoInplace",
    "_meta": {
      "title": "LTXV图像转视频（原地）"
    }
  },
  "36": {
    "inputs": {
      "cfg": 1,
      "model": [
        "197",
        0
      ],
      "positive": [
        "10",
        0
      ],
      "negative": [
        "10",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "42": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "44",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "43": {
    "inputs": {
      "frame_rate": [
        "164",
        0
      ],
      "loop_count": 0,
      "filename_prefix": "LTX-2",
      "format": "video/h264-mp4",
      "pix_fmt": "yuv420p",
      "crf": 19,
      "save_metadata": true,
      "trim_to_audio": false,
      "pingpong": false,
      "save_output": true,
      "images": [
        "149",
        0
      ],
      "audio": [
        "150",
        0
      ]
    },
    "class_type": "VHS_VideoCombine",
    "_meta": {
      "title": "Video Combine 🎥🅥🅗🅢"
    }
  },
  "44": {
    "inputs": {
      "width": [
        "166",
        0
      ],
      "height": [
        "167",
        0
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "45",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "45": {
    "inputs": {
      "image": "ComfyUI_00109_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "FIRST FRAME"
    }
  },
  "47": {
    "inputs": {
      "image": "ComfyUI_00108_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "LAST FRAME"
    }
  },
  "48": {
    "inputs": {
      "width": [
        "44",
        1
      ],
      "height": [
        "44",
        2
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "47",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "49": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "48",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "50": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "49",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "74": {
    "inputs": {
      "inputcount": 2,
      "direction": "down",
      "match_image_size": true,
      "Update inputs": null,
      "image_1": [
        "84",
        0
      ],
      "image_2": [
        "86",
        0
      ]
    },
    "class_type": "ImageConcatMulti",
    "_meta": {
      "title": "Image Concatenate Multi"
    }
  },
  "82": {
    "inputs": {
      "inputcount": 2,
      "direction": "right",
      "match_image_size": true,
      "Update inputs": null,
      "image_1": [
        "74",
        0
      ],
      "image_2": [
        "87",
        0
      ]
    },
    "class_type": "ImageConcatMulti",
    "_meta": {
      "title": "Image Concatenate Multi"
    }
  },
  "83": {
    "inputs": {
      "frame_rate": [
        "164",
        0
      ],
      "loop_count": 0,
      "filename_prefix": "LTX2/LTX2IV",
      "format": "video/h264-mp4",
      "pix_fmt": "yuv420p",
      "crf": 19,
      "save_metadata": true,
      "trim_to_audio": false,
      "pingpong": false,
      "save_output": false,
      "images": [
        "82",
        0
      ],
      "audio": [
        "150",
        0
      ]
    },
    "class_type": "VHS_VideoCombine",
    "_meta": {
      "title": "Video Combine 🎥🅥🅗🅢"
    }
  },
  "84": {
    "inputs": {
      "upscale_method": "lanczos",
      "scale_by": 0.5,
      "image": [
        "44",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "缩放图像（比例）"
    }
  },
  "86": {
    "inputs": {
      "upscale_method": "lanczos",
      "scale_by": 0.5,
      "image": [
        "48",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "缩放图像（比例）"
    }
  },
  "87": {
    "inputs": {
      "upscale_method": "lanczos",
      "scale_by": 0.5,
      "image": [
        "149",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "缩放图像（比例）"
    }
  },
  "92": {
    "inputs": {
      "expression": "a",
      "a": [
        "164",
        0
      ]
    },
    "class_type": "SimpleCalculatorKJ",
    "_meta": {
      "title": "SimpleCalculatorKJ"
    }
  },
  "146": {
    "inputs": {
      "av_latent": [
        "21",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "149": {
    "inputs": {
      "tile_size": 512,
      "overlap": 64,
      "temporal_size": 4096,
      "temporal_overlap": 8,
      "samples": [
        "146",
        0
      ],
      "vae": [
        "181",
        0
      ]
    },
    "class_type": "VAEDecodeTiled",
    "_meta": {
      "title": "VAE解码（分块）"
    }
  },
  "150": {
    "inputs": {
      "samples": [
        "146",
        1
      ],
      "audio_vae": [
        "175",
        0
      ]
    },
    "class_type": "LTXVAudioVAEDecode",
    "_meta": {
      "title": "LTXV音频VAE解码"
    }
  },
  "164": {
    "inputs": {
      "value": 24
    },
    "class_type": "PrimitiveFloat",
    "_meta": {
      "title": "FPS"
    }
  },
  "166": {
    "inputs": {
      "value": 960
    },
    "class_type": "INTConstant",
    "_meta": {
      "title": "WIDTH"
    }
  },
  "167": {
    "inputs": {
      "value": 544
    },
    "class_type": "INTConstant",
    "_meta": {
      "title": "HEIGHT"
    }
  },
  "168": {
    "inputs": {
      "expression": "1+ 8*(round(a*b)/8)",
      "a": [
        "169",
        0
      ],
      "b": [
        "164",
        0
      ]
    },
    "class_type": "SimpleCalculatorKJ",
    "_meta": {
      "title": "SimpleCalculatorKJ"
    }
  },
  "169": {
    "inputs": {
      "value": 10
    },
    "class_type": "INTConstant",
    "_meta": {
      "title": "LENGTH (in seconds)"
    }
  },
  "175": {
    "inputs": {
      "vae_name": "LTX23_audio_vae_bf16.safetensors",
      "device": "main_device",
      "weight_dtype": "bf16"
    },
    "class_type": "VAELoaderKJ",
    "_meta": {
      "title": "VAELoader KJ"
    }
  },
  "180": {
    "inputs": {
      "vae_name": "LTX23_audio_vae_bf16.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "181": {
    "inputs": {
      "vae_name": "LTX23_video_vae_bf16.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "182": {
    "inputs": {
      "model_name": "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
    },
    "class_type": "LatentUpscaleModelLoader",
    "_meta": {
      "title": "加载Latent放大模型"
    }
  },
  "187": {
    "inputs": {
      "unet_name": "ltx-2.3-22b-distilled-fp8.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "190": {
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
  "197": {
    "inputs": {
      "nag_scale": 11,
      "nag_alpha": 0.25,
      "nag_tau": 2.5,
      "inplace": true,
      "model": [
        "198",
        0
      ],
      "nag_cond_video": [
        "10",
        1
      ],
      "nag_cond_audio": [
        "10",
        1
      ]
    },
    "class_type": "LTX2_NAG",
    "_meta": {
      "title": "LTX2 NAG"
    }
  },
  "198": {
    "inputs": {
      "preview_rate": 8,
      "model": [
        "187",
        0
      ],
      "vae": [
        "180",
        0
      ]
    },
    "class_type": "LTX2SamplingPreviewOverride",
    "_meta": {
      "title": "LTX2 Sampling Preview Override"
    }
  },
  "209": {
    "inputs": {
      "spatial_tiles": 4,
      "spatial_overlap": 1,
      "temporal_tile_length": 16,
      "temporal_overlap": 1,
      "last_frame_fix": false,
      "working_device": "auto",
      "working_dtype": "auto"
    },
    "class_type": "LTXVSpatioTemporalTiledVAEDecode",
    "_meta": {
      "title": "LTXV Spatio Temporal Tiled VAE Decode"
    }
  },
  "210": {
    "inputs": {
      "num_images": "2",
      "num_images.strength_1": 1,
      "num_images.strength_2": 1,
      "num_images.index_1": 0,
      "num_images.index_2": -1,
      "vae": [
        "181",
        0
      ],
      "latent": [
        "32",
        0
      ],
      "num_images.image_1": [
        "31",
        0
      ],
      "num_images.image_2": [
        "50",
        0
      ]
    },
    "class_type": "LTXVImgToVideoInplaceKJ",
    "_meta": {
      "title": "LTXVImgToVideoInplaceKJ"
    }
  }
};

// 图生视频（I2V） - LTX 2.3 I2V（本地 ComfyUI）
const WORKFLOW_JSON_IT2V = {
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

// 多参考图生视频（Multi2V） - LTX 2.3 Multi2V（本地 ComfyUI）
const WORKFLOW_JSON_MULTI2V = {
  "1": {
    "inputs": {
      "sampler_name": "lcm"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "2": {
    "inputs": {
      "steps": 8,
      "max_shift": 2.05,
      "base_shift": 0.95,
      "stretch": true,
      "terminal": 0.1,
      "latent": [
        "24",
        0
      ]
    },
    "class_type": "LTXVScheduler",
    "_meta": {
      "title": "LTXVScheduler (for more steps)"
    }
  },
  "4": {
    "inputs": {
      "sampler_name": "lcm"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "K采样器选择"
    }
  },
  "5": {
    "inputs": {
      "sigmas": "0.909375, 0.725, 0.421875, 0.0"
    },
    "class_type": "ManualSigmas",
    "_meta": {
      "title": "ManualSigmas (LTX-2.0)"
    }
  },
  "8": {
    "inputs": {
      "cfg": 1,
      "model": [
        "197",
        0
      ],
      "positive": [
        "226",
        0
      ],
      "negative": [
        "226",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "9": {
    "inputs": {
      "frames_number": [
        "168",
        1
      ],
      "frame_rate": [
        "92",
        1
      ],
      "batch_size": 1,
      "audio_vae": [
        "244",
        0
      ]
    },
    "class_type": "LTXVEmptyLatentAudio",
    "_meta": {
      "title": "LTXV 空音频潜空间"
    }
  },
  "10": {
    "inputs": {
      "frame_rate": [
        "164",
        0
      ],
      "positive": [
        "221",
        0
      ],
      "negative": [
        "221",
        1
      ]
    },
    "class_type": "LTXVConditioning",
    "_meta": {
      "title": "LTXV条件"
    }
  },
  "11": {
    "inputs": {
      "text": "blurry, out of focus, overexposed, underexposed, low contrast, washed out colors, excessive noise, grainy texture, poor lighting, flickering, motion blur, distorted proportions, unnatural skin tones, deformed facial features, asymmetrical face, missing facial features, extra limbs, disfigured hands, wrong hand count, artifacts around text, unreadable text on shirt or hat, incorrect lettering on cap (“PNTR”), incorrect t-shirt slogan (“JUST DO IT”), missing microphone, misplaced microphone, inconsistent perspective, camera shake, incorrect depth of field, background too sharp, background clutter, distracting reflections, harsh shadows, inconsistent lighting direction, color banding, cartoonish rendering, 3D CGI look, unrealistic materials, uncanny valley effect, incorrect ethnicity, wrong gender, exaggerated expressions, smiling, laughing, exaggerated sadness, wrong gaze direction, eyes looking at camera, mismatched lip sync, silent or muted audio, distorted voice, robotic voice, echo, background noise, off-sync audio, missing sniff sounds, incorrect dialogue, added dialogue, repetitive speech, jittery movement, awkward pauses, incorrect timing, unnatural transitions, inconsistent framing, tilted camera, missing door or shelves, missing shallow depth of field, flat lighting, inconsistent tone, cinematic oversaturation, stylized filters, or AI artifacts.",
      "clip": [
        "246",
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
      "noise": [
        "15",
        0
      ],
      "guider": [
        "36",
        0
      ],
      "sampler": [
        "1",
        0
      ],
      "sigmas": [
        "232",
        0
      ],
      "latent_image": [
        "24",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "14": {
    "inputs": {
      "noise_seed": 42
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "15": {
    "inputs": {
      "noise_seed": 23344455
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "随机噪波"
    }
  },
  "16": {
    "inputs": {
      "text": "",
      "clip": [
        "246",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "18": {
    "inputs": {
      "av_latent": [
        "13",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "21": {
    "inputs": {
      "noise": [
        "14",
        0
      ],
      "guider": [
        "8",
        0
      ],
      "sampler": [
        "4",
        0
      ],
      "sigmas": [
        "230",
        0
      ],
      "latent_image": [
        "34",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "自定义采样器（高级）"
    }
  },
  "24": {
    "inputs": {
      "video_latent": [
        "221",
        2
      ],
      "audio_latent": [
        "9",
        0
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "25": {
    "inputs": {
      "samples": [
        "226",
        2
      ],
      "upscale_model": [
        "240",
        0
      ],
      "vae": [
        "243",
        0
      ]
    },
    "class_type": "LTXVLatentUpsampler",
    "_meta": {
      "title": "spatial"
    }
  },
  "26": {
    "inputs": {
      "upscale_method": "lanczos",
      "scale_by": 0.67,
      "image": [
        "44",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "缩放图像（比例）"
    }
  },
  "28": {
    "inputs": {
      "image": [
        "26",
        0
      ]
    },
    "class_type": "GetImageSize",
    "_meta": {
      "title": "获取图像尺寸"
    }
  },
  "31": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "42",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "32": {
    "inputs": {
      "width": [
        "28",
        0
      ],
      "height": [
        "28",
        1
      ],
      "length": [
        "168",
        1
      ],
      "batch_size": 1
    },
    "class_type": "EmptyLTXVLatentVideo",
    "_meta": {
      "title": "空Latent视频（LTXV）"
    }
  },
  "34": {
    "inputs": {
      "video_latent": [
        "220",
        0
      ],
      "audio_latent": [
        "18",
        1
      ]
    },
    "class_type": "LTXVConcatAVLatent",
    "_meta": {
      "title": "LTXVConcatAVLatent"
    }
  },
  "36": {
    "inputs": {
      "cfg": 1,
      "model": [
        "197",
        0
      ],
      "positive": [
        "10",
        0
      ],
      "negative": [
        "10",
        1
      ]
    },
    "class_type": "CFGGuider",
    "_meta": {
      "title": "CFG引导器"
    }
  },
  "42": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "44",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "43": {
    "inputs": {
      "frame_rate": [
        "164",
        0
      ],
      "loop_count": 0,
      "filename_prefix": "LTX-2",
      "format": "video/h264-mp4",
      "pix_fmt": "yuv420p",
      "crf": 19,
      "save_metadata": true,
      "trim_to_audio": false,
      "pingpong": false,
      "save_output": true,
      "images": [
        "149",
        0
      ],
      "audio": [
        "150",
        0
      ]
    },
    "class_type": "VHS_VideoCombine",
    "_meta": {
      "title": "Video Combine 🎥🕥🗢"
    }
  },
  "44": {
    "inputs": {
      "width": [
        "166",
        0
      ],
      "height": [
        "167",
        0
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "45",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "45": {
    "inputs": {
      "image": "ComfyUI_00110_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "FIRST FRAME"
    }
  },
  "47": {
    "inputs": {
      "image": "ComfyUI_00101_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "LAST FRAME"
    }
  },
  "48": {
    "inputs": {
      "width": [
        "57",
        1
      ],
      "height": [
        "57",
        2
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "47",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "49": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "48",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "50": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "49",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "56": {
    "inputs": {
      "image": "ComfyUI_00107_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "MIDDLE FRAME"
    }
  },
  "57": {
    "inputs": {
      "width": [
        "44",
        1
      ],
      "height": [
        "44",
        2
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "56",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "58": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "57",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "59": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "58",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "62": {
    "inputs": {
      "expression": "ceil(a/3)",
      "a": [
        "168",
        1
      ]
    },
    "class_type": "SimpleCalculatorKJ",
    "_meta": {
      "title": "SimpleCalculatorKJ"
    }
  },
  "92": {
    "inputs": {
      "expression": "a",
      "a": [
        "164",
        0
      ]
    },
    "class_type": "SimpleCalculatorKJ",
    "_meta": {
      "title": "SimpleCalculatorKJ"
    }
  },
  "146": {
    "inputs": {
      "av_latent": [
        "21",
        0
      ]
    },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": {
      "title": "LTXV分离音视频潜空间"
    }
  },
  "149": {
    "inputs": {
      "tile_size": 512,
      "overlap": 64,
      "temporal_size": 4096,
      "temporal_overlap": 8,
      "samples": [
        "146",
        0
      ],
      "vae": [
        "243",
        0
      ]
    },
    "class_type": "VAEDecodeTiled",
    "_meta": {
      "title": "VAE解码（分块）"
    }
  },
  "150": {
    "inputs": {
      "samples": [
        "146",
        1
      ],
      "audio_vae": [
        "244",
        0
      ]
    },
    "class_type": "LTXVAudioVAEDecode",
    "_meta": {
      "title": "LTXV音频VAE解码"
    }
  },
  "164": {
    "inputs": {
      "value": 60
    },
    "class_type": "PrimitiveFloat",
    "_meta": {
      "title": "FPS"
    }
  },
  "166": {
    "inputs": {
      "value": 736
    },
    "class_type": "INTConstant",
    "_meta": {
      "title": "WIDTH"
    }
  },
  "167": {
    "inputs": {
      "value": 992
    },
    "class_type": "INTConstant",
    "_meta": {
      "title": "HEIGHT"
    }
  },
  "168": {
    "inputs": {
      "expression": "1+ 8*(round(a*b)/8)",
      "a": [
        "169",
        0
      ],
      "b": [
        "164",
        0
      ]
    },
    "class_type": "SimpleCalculatorKJ",
    "_meta": {
      "title": "SimpleCalculatorKJ"
    }
  },
  "169": {
    "inputs": {
      "value": 12
    },
    "class_type": "INTConstant",
    "_meta": {
      "title": "LENGTH (in seconds)"
    }
  },
  "197": {
    "inputs": {
      "nag_scale": 11,
      "nag_alpha": 0.25,
      "nag_tau": 2.5,
      "inplace": true,
      "model": [
        "198",
        0
      ],
      "nag_cond_video": [
        "10",
        1
      ],
      "nag_cond_audio": [
        "10",
        1
      ]
    },
    "class_type": "LTX2_NAG",
    "_meta": {
      "title": "LTX2 NAG"
    }
  },
  "198": {
    "inputs": {
      "preview_rate": 8,
      "model": [
        "242",
        0
      ],
      "vae": [
        "245",
        0
      ]
    },
    "class_type": "LTX2SamplingPreviewOverride",
    "_meta": {
      "title": "LTX2 Sampling Preview Override"
    }
  },
  "220": {
    "inputs": {
      "strength": 1,
      "bypass": false,
      "vae": [
        "243",
        0
      ],
      "image": [
        "42",
        0
      ],
      "latent": [
        "25",
        0
      ]
    },
    "class_type": "LTXVImgToVideoInplace",
    "_meta": {
      "title": "LTXV图像转视频（原地）"
    }
  },
  "221": {
    "inputs": {
      "num_guides": "6",
      "num_guides.frame_idx_1": 0,
      "num_guides.strength_1": 1,
      "num_guides.frame_idx_2": 120,
      "num_guides.strength_2": 1,
      "num_guides.frame_idx_3": 240,
      "num_guides.strength_3": 1,
      "num_guides.frame_idx_4": 360,
      "num_guides.strength_4": 1,
      "num_guides.frame_idx_5": 480,
      "num_guides.strength_5": 1,
      "num_guides.frame_idx_6": 600,
      "num_guides.strength_6": 1,
      "positive": [
        "16",
        0
      ],
      "negative": [
        "11",
        0
      ],
      "vae": [
        "243",
        0
      ],
      "latent": [
        "32",
        0
      ],
      "num_guides.image_1": [
        "31",
        0
      ],
      "num_guides.image_2": [
        "59",
        0
      ],
      "num_guides.image_3": [
        "50",
        0
      ],
      "num_guides.image_4": [
        "251",
        0
      ],
      "num_guides.image_5": [
        "265",
        0
      ],
      "num_guides.image_6": [
        "268",
        0
      ]
    },
    "class_type": "LTXVAddGuideMulti",
    "_meta": {
      "title": "LTXVAddGuideMulti"
    }
  },
  "226": {
    "inputs": {
      "positive": [
        "10",
        0
      ],
      "negative": [
        "10",
        1
      ],
      "latent": [
        "18",
        0
      ]
    },
    "class_type": "LTXVCropGuides",
    "_meta": {
      "title": "LTXV裁剪指导"
    }
  },
  "230": {
    "inputs": {
      "sigmas": "0.85, 0.7250, 0.4219, 0.0"
    },
    "class_type": "ManualSigmas",
    "_meta": {
      "title": "自定义Sigmas"
    }
  },
  "232": {
    "inputs": {
      "sigmas": "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    },
    "class_type": "ManualSigmas",
    "_meta": {
      "title": "自定义Sigmas"
    }
  },
  "240": {
    "inputs": {
      "model_name": "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
    },
    "class_type": "LatentUpscaleModelLoader",
    "_meta": {
      "title": "加载Latent放大模型"
    }
  },
  "241": {
    "inputs": {
      "unet_name": "ltx-2.3-22b-distilled-fp8.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "242": {
    "inputs": {
      "lora_name": "ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
      "strength_model": 0.6,
      "model": [
        "241",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoRA加载器（仅模型）"
    }
  },
  "243": {
    "inputs": {
      "vae_name": "LTX23_video_vae_bf16.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "244": {
    "inputs": {
      "vae_name": "LTX23_audio_vae_bf16.safetensors",
      "device": "main_device",
      "weight_dtype": "bf16"
    },
    "class_type": "VAELoaderKJ",
    "_meta": {
      "title": "VAELoader KJ"
    }
  },
  "245": {
    "inputs": {
      "vae_name": "taeltx2_3.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  },
  "246": {
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
  "247": {
    "inputs": {
      "width": [
        "57",
        1
      ],
      "height": [
        "57",
        2
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "248",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "248": {
    "inputs": {
      "image": "ComfyUI_00093_ (1).png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "LAST FRAME"
    }
  },
  "250": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "247",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "251": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "250",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "254": {
    "inputs": {
      "image": "ComfyUI_00108_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "LAST FRAME"
    }
  },
  "255": {
    "inputs": {
      "width": [
        "57",
        1
      ],
      "height": [
        "57",
        2
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "254",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "257": {
    "inputs": {
      "image": "ComfyUI_00103_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "LAST FRAME"
    }
  },
  "258": {
    "inputs": {
      "width": [
        "57",
        1
      ],
      "height": [
        "57",
        2
      ],
      "upscale_method": "lanczos",
      "keep_proportion": "crop",
      "pad_color": "0, 0, 0",
      "crop_position": "center",
      "divisible_by": 32,
      "device": "cpu",
      "image": [
        "257",
        0
      ]
    },
    "class_type": "ImageResizeKJv2",
    "_meta": {
      "title": "Resize Image v2"
    }
  },
  "265": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "267",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "267": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "255",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  },
  "268": {
    "inputs": {
      "img_compression": 33,
      "image": [
        "270",
        0
      ]
    },
    "class_type": "LTXVPreprocess",
    "_meta": {
      "title": "LTXV预处理"
    }
  },
  "270": {
    "inputs": {
      "longer_edge": 1536,
      "images": [
        "258",
        0
      ]
    },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": {
      "title": "缩放图像（长边）"
    }
  }
};

// ============================================================
// 辅助函数
// ============================================================

const generateSeed = () => crypto.randomBytes(4).readUInt32BE();

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("不支持文本生成");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  throw new Error("不支持图片生成");
};

// 视频生成（根据 model.modelName 分派到对应工作流）
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");

  const modelName = model.modelName;

  // ---- FLF2V：首尾帧生视频 ----
  if (modelName === "ltx2.3-flf2v") {
    const imageRefs = (config.referenceList || []).filter((r) => r.type === "image");
    if (imageRefs.length < 2) throw new Error("首尾帧生视频需要提供首帧和尾帧两张图片");

    let firstFrameBase64 = imageRefs[0].base64 || "";
    let lastFrameBase64 = imageRefs[1].base64 || "";
    if (firstFrameBase64.includes(",")) firstFrameBase64 = firstFrameBase64.split(",")[1];
    if (lastFrameBase64.includes(",")) lastFrameBase64 = lastFrameBase64.split(",")[1];

    logger(`[LTX 2.3 FLF2V] 开始生成，首帧 base64 长度: ${firstFrameBase64.length}, 尾帧 base64 长度: ${lastFrameBase64.length}`);

    const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON_FLF2V));

    workflow["45"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: firstFrameBase64, image_output: "Preview", save_prefix: "ComfyUI" }
    };
    workflow["47"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: lastFrameBase64, image_output: "Preview", save_prefix: "ComfyUI" }
    };

    workflow["16"]["inputs"]["text"] = config.prompt;
    workflow["169"]["inputs"]["value"] = config.duration;

    const frameRate = 24;
    workflow["164"]["inputs"]["value"] = frameRate;

    let width = 960, height = 544;
    let longerEdge = 1536;
    if (config.resolution === "480p") {
      width = config.aspectRatio === "16:9" ? 854 : 480;
      height = config.aspectRatio === "16:9" ? 480 : 854;
      longerEdge = 1024;
    } else if (config.resolution === "720p") {
      width = config.aspectRatio === "16:9" ? 1280 : 720;
      height = config.aspectRatio === "16:9" ? 720 : 1280;
      longerEdge = 1280;
    } else if (config.resolution === "1080p") {
      width = config.aspectRatio === "16:9" ? 1920 : 1080;
      height = config.aspectRatio === "16:9" ? 1080 : 1920;
      longerEdge = 1920;
    }
    workflow["166"]["inputs"]["value"] = width;
    workflow["167"]["inputs"]["value"] = height;
    workflow["42"]["inputs"]["longer_edge"] = longerEdge;
    workflow["49"]["inputs"]["longer_edge"] = longerEdge;

    logger(`[LTX 2.3 FLF2V] 分辨率: ${width}x${height}, 时长: ${config.duration}s, 帧率: ${frameRate}`);

    workflow["14"]["inputs"]["noise_seed"] = generateSeed();
    workflow["15"]["inputs"]["noise_seed"] = generateSeed();

    const submitResp = await fetch(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    const submitData = await submitResp.json();
    const promptId = submitData.prompt_id;
    if (!promptId) throw new Error(`提交失败：${JSON.stringify(submitData)}`);
    logger(`[LTX 2.3 FLF2V] 任务已提交，ID: ${promptId}`);

    const result = await pollTask(async () => {
      const historyResp = await fetch(`${baseUrl}/history`);
      const history = await historyResp.json();
      const run = history[promptId];
      if (!run) return { completed: false };
      if (run.status?.exec_info?.error) {
        return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
      }
      const output = run.outputs?.["43"];
      const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
      if (fileInfo) return { completed: true, data: fileInfo };
      return { completed: false };
    }, 3000, 600000);

    if (result.error) throw new Error(`LTX 2.3 FLF2V 生成失败: ${result.error}`);
    if (!result.data) throw new Error("未找到生成的视频");
    const fileInfo = result.data;
    const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
    logger(`[LTX 2.3 FLF2V] 下载视频: ${downloadUrl}`);
    return await urlToBase64(downloadUrl);
  }

  // ---- I2V：图生视频 ----
  if (modelName === "ltx2.3-i2v") {
    let rawBase64 = config.referenceList?.[0]?.base64 || "";
    if (!rawBase64) throw new Error("图生视频需要提供参考图片");
    if (rawBase64.includes(",")) rawBase64 = rawBase64.split(",")[1];

    logger(`[LTX 2.3 I2V] 开始生成，参考图 base64 长度: ${rawBase64.length}`);

    const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON_IT2V));

    workflow["2004"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: rawBase64, image_output: "Preview", save_prefix: "ComfyUI" }
    };

    workflow["2483"]["inputs"]["text"] = config.prompt;

    const frameRate = 24;
    const frameCount = Math.max(config.duration * frameRate + 1, 1);
    workflow["4988"]["inputs"]["value"] = frameCount;
    workflow["4989"]["inputs"]["value"] = frameRate;

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

    workflow["4832"]["inputs"]["noise_seed"] = generateSeed();
    workflow["4967"]["inputs"]["noise_seed"] = generateSeed();

    const submitResp = await fetch(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    const submitData = await submitResp.json();
    const promptId = submitData.prompt_id;
    if (!promptId) throw new Error(`提交失败：${JSON.stringify(submitData)}`);
    logger(`[LTX 2.3 I2V] 任务已提交，ID: ${promptId}`);

    const result = await pollTask(async () => {
      const historyResp = await fetch(`${baseUrl}/history`);
      const history = await historyResp.json();
      const run = history[promptId];
      if (!run) return { completed: false };
      if (run.status?.exec_info?.error) {
        return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
      }
      const output = run.outputs?.["4852"];
      const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
      if (fileInfo) return { completed: true, data: fileInfo };
      return { completed: false };
    }, 3000, 600000);

    if (result.error) throw new Error(`LTX 2.3 I2V 生成失败: ${result.error}`);
    if (!result.data) throw new Error("未找到生成的视频");
    const fileInfo = result.data;
    const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
    logger(`[LTX 2.3 I2V] 下载视频: ${downloadUrl}`);
    return await urlToBase64(downloadUrl);
  }

  // ---- Multi2V：多参考图生视频 ----
  if (modelName === "ltx2.3-multi2v") {
    const imageRefs = (config.referenceList || []).filter((r) => r.type === "image");
    if (imageRefs.length === 0) throw new Error("多参考图生视频需要至少一张参考图片");

    const images = imageRefs.map((r) => {
      let b64 = r.base64 || "";
      if (b64.includes(",")) b64 = b64.split(",")[1];
      return b64;
    });

    logger(`[LTX 2.3 Multi2V] 开始生成，${images.length} 张参考图`);

    const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON_MULTI2V));

    const makeEasyLoad = (b64: string) => ({
      class_type: "easy loadImageBase64",
      inputs: { base64_data: b64, image_output: "Preview", save_prefix: "ComfyUI" }
    });

    const GUIDE_NODE_IDS = ["45", "56", "47", "248", "254", "257"] as const;
    const guideCount = images.length;

    workflow["221"]["inputs"]["num_guides"] = String(guideCount);

    for (let i = 0; i < guideCount; i++) {
      workflow[GUIDE_NODE_IDS[i]] = makeEasyLoad(images[i]);
    }
    for (let i = guideCount; i < 6; i++) {
      delete workflow[GUIDE_NODE_IDS[i]];
      delete workflow["221"]["inputs"][`num_guides.image_${i + 1}`];
    }

    workflow["16"]["inputs"]["text"] = config.prompt;
    workflow["169"]["inputs"]["value"] = config.duration;

    let width = 960, height = 544;
    let longerEdge = 1536;
    if (config.resolution === "480p") {
      width = config.aspectRatio === "16:9" ? 854 : 480;
      height = config.aspectRatio === "16:9" ? 480 : 854;
      longerEdge = 1024;
    } else if (config.resolution === "720p") {
      width = config.aspectRatio === "16:9" ? 1280 : 720;
      height = config.aspectRatio === "16:9" ? 720 : 1280;
      longerEdge = 1280;
    } else if (config.resolution === "1080p") {
      width = config.aspectRatio === "16:9" ? 1920 : 1080;
      height = config.aspectRatio === "16:9" ? 1080 : 1920;
      longerEdge = 1920;
    }
    workflow["166"]["inputs"]["value"] = width;
    workflow["167"]["inputs"]["value"] = height;

    workflow["42"]["inputs"]["longer_edge"] = longerEdge;
    workflow["58"]["inputs"]["longer_edge"] = longerEdge;
    workflow["49"]["inputs"]["longer_edge"] = longerEdge;
    workflow["250"]["inputs"]["longer_edge"] = longerEdge;
    workflow["267"]["inputs"]["longer_edge"] = longerEdge;
    workflow["270"]["inputs"]["longer_edge"] = longerEdge;

    logger(`[LTX 2.3 Multi2V] 分辨率: ${width}x${height}, 时长: ${config.duration}s, 参考图: ${images.length}张`);

    workflow["14"]["inputs"]["noise_seed"] = generateSeed();
    workflow["15"]["inputs"]["noise_seed"] = generateSeed();

    const submitResp = await fetch(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    const submitData = await submitResp.json();
    const promptId = submitData.prompt_id;
    if (!promptId) throw new Error(`提交失败：${JSON.stringify(submitData)}`);
    logger(`[LTX 2.3 Multi2V] 任务已提交，ID: ${promptId}`);

    const result = await pollTask(async () => {
      const historyResp = await fetch(`${baseUrl}/history`);
      const history = await historyResp.json();
      const run = history[promptId];
      if (!run) return { completed: false };
      if (run.status?.exec_info?.error) {
        return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
      }
      const output = run.outputs?.["43"];
      const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
      if (fileInfo) return { completed: true, data: fileInfo };
      return { completed: false };
    }, 3000, 600000);

    if (result.error) throw new Error(`LTX 2.3 Multi2V 生成失败: ${result.error}`);
    if (!result.data) throw new Error("未找到生成的视频");
    const fileInfo = result.data;
    const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
    logger(`[LTX 2.3 Multi2V] 下载视频: ${downloadUrl}`);
    return await urlToBase64(downloadUrl);
  }

  throw new Error(`未知的视频模型: ${modelName}`);
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