/**
 * Toonflow AI供应商 - LTX 2.3 多参考图生视频（本地 ComfyUI）
 * @version 1.0
 *
 * 基于 ltx2.3_multi2v.json 工作流，支持最多 6 张参考图的多位置引导视频生成。
 * 需要 ComfyUI 环境已配置 LTX 2.3 模型及 ComfyUI-easy-use 插件（提供 easy loadImageBase64 节点）。
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "ltx2_3_multi2v",
  version: "1.0",
  author: "Toonflow",
  name: "LTX 2.3 Multi2V（本地 ComfyUI）",
  description: "基于本地 ComfyUI 的 LTX 2.3 多参考图生视频工作流。支持上传 1~6 张参考图，分布在视频时间轴的多个位置进行引导生成。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: { baseUrl: "http://localhost:8188" },
  models: [{
    name: "LTX 2.3 Multi2V 22B",
    modelName: "ltx2.3-multi2v",
    type: "video",
    mode: ["imageReference:6"],
    audio: "optional",
    durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["480p", "720p", "1080p"] }
    ],
    associationSkills: "基于 ltx2.3_multi2v.json 工作流，支持最多 6 张引导图的多位置引导视频生成。"
  }],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

const WORKFLOW_JSON = {
  "1": {
    "inputs": { "sampler_name": "lcm" },
    "class_type": "KSamplerSelect",
    "_meta": { "title": "K采样器选择" }
  },
  "2": {
    "inputs": { "steps": 8, "max_shift": 2.05, "base_shift": 0.95, "stretch": true, "terminal": 0.1, "latent": ["24", 0] },
    "class_type": "LTXVScheduler",
    "_meta": { "title": "LTXVScheduler (for more steps)" }
  },
  "4": {
    "inputs": { "sampler_name": "lcm" },
    "class_type": "KSamplerSelect",
    "_meta": { "title": "K采样器选择" }
  },
  "5": {
    "inputs": { "sigmas": "0.909375, 0.725, 0.421875, 0.0" },
    "class_type": "ManualSigmas",
    "_meta": { "title": "ManualSigmas (LTX-2.0)" }
  },
  "8": {
    "inputs": { "cfg": 1, "model": ["197", 0], "positive": ["226", 0], "negative": ["226", 1] },
    "class_type": "CFGGuider",
    "_meta": { "title": "CFG引导器" }
  },
  "9": {
    "inputs": { "frames_number": ["168", 1], "frame_rate": ["92", 1], "batch_size": 1, "audio_vae": ["244", 0] },
    "class_type": "LTXVEmptyLatentAudio",
    "_meta": { "title": "LTXV 空音频潜空间" }
  },
  "10": {
    "inputs": { "frame_rate": ["164", 0], "positive": ["221", 0], "negative": ["221", 1] },
    "class_type": "LTXVConditioning",
    "_meta": { "title": "LTXV条件" }
  },
  "11": {
    "inputs": {
      "text": "blurry, out of focus, overexposed, underexposed, low contrast, washed out colors, excessive noise, grainy texture, poor lighting, flickering, motion blur, distorted proportions, unnatural skin tones, deformed facial features, asymmetrical face, missing facial features, extra limbs, disfigured hands, wrong hand count, artifacts around text, unreadable text on shirt or hat, incorrect lettering on cap (\u201CPNTR\u201D), incorrect t-shirt slogan (\u201CJUST DO IT\u201D), missing microphone, misplaced microphone, inconsistent perspective, camera shake, incorrect depth of field, background too sharp, background clutter, distracting reflections, harsh shadows, inconsistent lighting direction, color banding, cartoonish rendering, 3D CGI look, unrealistic materials, uncanny valley effect, incorrect ethnicity, wrong gender, exaggerated expressions, smiling, laughing, exaggerated sadness, wrong gaze direction, eyes looking at camera, mismatched lip sync, silent or muted audio, distorted voice, robotic voice, echo, background noise, off-sync audio, missing sniff sounds, incorrect dialogue, added dialogue, repetitive speech, jittery movement, awkward pauses, incorrect timing, unnatural transitions, inconsistent framing, tilted camera, missing door or shelves, missing shallow depth of field, flat lighting, inconsistent tone, cinematic oversaturation, stylized filters, or AI artifacts.",
      "clip": ["246", 0]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP文本编码" }
  },
  "13": {
    "inputs": { "noise": ["15", 0], "guider": ["36", 0], "sampler": ["1", 0], "sigmas": ["232", 0], "latent_image": ["24", 0] },
    "class_type": "SamplerCustomAdvanced",
    "_meta": { "title": "自定义采样器（高级）" }
  },
  "14": {
    "inputs": { "noise_seed": 42 },
    "class_type": "RandomNoise",
    "_meta": { "title": "随机噪波" }
  },
  "15": {
    "inputs": { "noise_seed": 23344455 },
    "class_type": "RandomNoise",
    "_meta": { "title": "随机噪波" }
  },
  "16": {
    "inputs": { "text": "", "clip": ["246", 0] },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP文本编码" }
  },
  "18": {
    "inputs": { "av_latent": ["13", 0] },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": { "title": "LTXV分离音视频潜空间" }
  },
  "21": {
    "inputs": { "noise": ["14", 0], "guider": ["8", 0], "sampler": ["4", 0], "sigmas": ["230", 0], "latent_image": ["34", 0] },
    "class_type": "SamplerCustomAdvanced",
    "_meta": { "title": "自定义采样器（高级）" }
  },
  "24": {
    "inputs": { "video_latent": ["221", 2], "audio_latent": ["9", 0] },
    "class_type": "LTXVConcatAVLatent",
    "_meta": { "title": "LTXVConcatAVLatent" }
  },
  "25": {
    "inputs": { "samples": ["226", 2], "upscale_model": ["240", 0], "vae": ["243", 0] },
    "class_type": "LTXVLatentUpsampler",
    "_meta": { "title": "spatial" }
  },
  "26": {
    "inputs": { "upscale_method": "lanczos", "scale_by": 0.67, "image": ["44", 0] },
    "class_type": "ImageScaleBy",
    "_meta": { "title": "缩放图像（比例）" }
  },
  "28": {
    "inputs": { "image": ["26", 0] },
    "class_type": "GetImageSize",
    "_meta": { "title": "获取图像尺寸" }
  },
  "31": {
    "inputs": { "img_compression": 33, "image": ["42", 0] },
    "class_type": "LTXVPreprocess",
    "_meta": { "title": "LTXV预处理" }
  },
  "32": {
    "inputs": { "width": ["28", 0], "height": ["28", 1], "length": ["168", 1], "batch_size": 1 },
    "class_type": "EmptyLTXVLatentVideo",
    "_meta": { "title": "空Latent视频（LTXV）" }
  },
  "34": {
    "inputs": { "video_latent": ["220", 0], "audio_latent": ["18", 1] },
    "class_type": "LTXVConcatAVLatent",
    "_meta": { "title": "LTXVConcatAVLatent" }
  },
  "36": {
    "inputs": { "cfg": 1, "model": ["197", 0], "positive": ["10", 0], "negative": ["10", 1] },
    "class_type": "CFGGuider",
    "_meta": { "title": "CFG引导器" }
  },
  "42": {
    "inputs": { "longer_edge": 1536, "images": ["44", 0] },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": { "title": "缩放图像（长边）" }
  },
  "43": {
    "inputs": {
      "frame_rate": ["164", 0], "loop_count": 0, "filename_prefix": "LTX-2",
      "format": "video/h264-mp4", "pix_fmt": "yuv420p", "crf": 19,
      "save_metadata": true, "trim_to_audio": false, "pingpong": false, "save_output": true,
      "images": ["149", 0], "audio": ["150", 0]
    },
    "class_type": "VHS_VideoCombine",
    "_meta": { "title": "Video Combine \ud83c\udfa5\ud83d\udd65\ud83d\udde2" }
  },
  "44": {
    "inputs": { "width": ["166", 0], "height": ["167", 0], "upscale_method": "lanczos", "keep_proportion": "crop", "pad_color": "0, 0, 0", "crop_position": "center", "divisible_by": 32, "device": "cpu", "image": ["45", 0] },
    "class_type": "ImageResizeKJv2",
    "_meta": { "title": "Resize Image v2" }
  },
  "45": {
    "inputs": { "image": "ComfyUI_00110_.png" },
    "class_type": "LoadImage",
    "_meta": { "title": "FIRST FRAME" }
  },
  "47": {
    "inputs": { "image": "ComfyUI_00101_.png" },
    "class_type": "LoadImage",
    "_meta": { "title": "LAST FRAME" }
  },
  "48": {
    "inputs": { "width": ["57", 1], "height": ["57", 2], "upscale_method": "lanczos", "keep_proportion": "crop", "pad_color": "0, 0, 0", "crop_position": "center", "divisible_by": 32, "device": "cpu", "image": ["47", 0] },
    "class_type": "ImageResizeKJv2",
    "_meta": { "title": "Resize Image v2" }
  },
  "49": {
    "inputs": { "longer_edge": 1536, "images": ["48", 0] },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": { "title": "缩放图像（长边）" }
  },
  "50": {
    "inputs": { "img_compression": 33, "image": ["49", 0] },
    "class_type": "LTXVPreprocess",
    "_meta": { "title": "LTXV预处理" }
  },
  "56": {
    "inputs": { "image": "ComfyUI_00107_.png" },
    "class_type": "LoadImage",
    "_meta": { "title": "MIDDLE FRAME" }
  },
  "57": {
    "inputs": { "width": ["44", 1], "height": ["44", 2], "upscale_method": "lanczos", "keep_proportion": "crop", "pad_color": "0, 0, 0", "crop_position": "center", "divisible_by": 32, "device": "cpu", "image": ["56", 0] },
    "class_type": "ImageResizeKJv2",
    "_meta": { "title": "Resize Image v2" }
  },
  "58": {
    "inputs": { "longer_edge": 1536, "images": ["57", 0] },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": { "title": "缩放图像（长边）" }
  },
  "59": {
    "inputs": { "img_compression": 33, "image": ["58", 0] },
    "class_type": "LTXVPreprocess",
    "_meta": { "title": "LTXV预处理" }
  },
  "62": {
    "inputs": { "expression": "ceil(a/3)", "a": ["168", 1] },
    "class_type": "SimpleCalculatorKJ",
    "_meta": { "title": "SimpleCalculatorKJ" }
  },
  "92": {
    "inputs": { "expression": "a", "a": ["164", 0] },
    "class_type": "SimpleCalculatorKJ",
    "_meta": { "title": "SimpleCalculatorKJ" }
  },
  "146": {
    "inputs": { "av_latent": ["21", 0] },
    "class_type": "LTXVSeparateAVLatent",
    "_meta": { "title": "LTXV分离音视频潜空间" }
  },
  "149": {
    "inputs": { "tile_size": 512, "overlap": 64, "temporal_size": 4096, "temporal_overlap": 8, "samples": ["146", 0], "vae": ["243", 0] },
    "class_type": "VAEDecodeTiled",
    "_meta": { "title": "VAE解码（分块）" }
  },
  "150": {
    "inputs": { "samples": ["146", 1], "audio_vae": ["244", 0] },
    "class_type": "LTXVAudioVAEDecode",
    "_meta": { "title": "LTXV音频VAE解码" }
  },
  "164": {
    "inputs": { "value": 60 },
    "class_type": "PrimitiveFloat",
    "_meta": { "title": "FPS" }
  },
  "166": {
    "inputs": { "value": 736 },
    "class_type": "INTConstant",
    "_meta": { "title": "WIDTH" }
  },
  "167": {
    "inputs": { "value": 992 },
    "class_type": "INTConstant",
    "_meta": { "title": "HEIGHT" }
  },
  "168": {
    "inputs": { "expression": "1+ 8*(round(a*b)/8)", "a": ["169", 0], "b": ["164", 0] },
    "class_type": "SimpleCalculatorKJ",
    "_meta": { "title": "SimpleCalculatorKJ" }
  },
  "169": {
    "inputs": { "value": 12 },
    "class_type": "INTConstant",
    "_meta": { "title": "LENGTH (in seconds)" }
  },
  "197": {
    "inputs": { "nag_scale": 11, "nag_alpha": 0.25, "nag_tau": 2.5, "inplace": true, "model": ["198", 0], "nag_cond_video": ["10", 1], "nag_cond_audio": ["10", 1] },
    "class_type": "LTX2_NAG",
    "_meta": { "title": "LTX2 NAG" }
  },
  "198": {
    "inputs": { "preview_rate": 8, "model": ["242", 0], "vae": ["245", 0] },
    "class_type": "LTX2SamplingPreviewOverride",
    "_meta": { "title": "LTX2 Sampling Preview Override" }
  },
  "220": {
    "inputs": { "strength": 1, "bypass": false, "vae": ["243", 0], "image": ["42", 0], "latent": ["25", 0] },
    "class_type": "LTXVImgToVideoInplace",
    "_meta": { "title": "LTXV图像转视频（原地）" }
  },
  "221": {
    "inputs": {
      "num_guides": "6",
      "num_guides.frame_idx_1": 0, "num_guides.strength_1": 1,
      "num_guides.frame_idx_2": 120, "num_guides.strength_2": 1,
      "num_guides.frame_idx_3": 240, "num_guides.strength_3": 1,
      "num_guides.frame_idx_4": 360, "num_guides.strength_4": 1,
      "num_guides.frame_idx_5": 480, "num_guides.strength_5": 1,
      "num_guides.frame_idx_6": 600, "num_guides.strength_6": 1,
      "positive": ["16", 0], "negative": ["11", 0],
      "vae": ["243", 0], "latent": ["32", 0],
      "num_guides.image_1": ["31", 0],
      "num_guides.image_2": ["59", 0],
      "num_guides.image_3": ["50", 0],
      "num_guides.image_4": ["251", 0],
      "num_guides.image_5": ["265", 0],
      "num_guides.image_6": ["268", 0]
    },
    "class_type": "LTXVAddGuideMulti",
    "_meta": { "title": "LTXVAddGuideMulti" }
  },
  "226": {
    "inputs": { "positive": ["10", 0], "negative": ["10", 1], "latent": ["18", 0] },
    "class_type": "LTXVCropGuides",
    "_meta": { "title": "LTXV裁剪指导" }
  },
  "230": {
    "inputs": { "sigmas": "0.85, 0.7250, 0.4219, 0.0" },
    "class_type": "ManualSigmas",
    "_meta": { "title": "自定义Sigmas" }
  },
  "232": {
    "inputs": { "sigmas": "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" },
    "class_type": "ManualSigmas",
    "_meta": { "title": "自定义Sigmas" }
  },
  "240": {
    "inputs": { "model_name": "ltx-2.3-spatial-upscaler-x2-1.1.safetensors" },
    "class_type": "LatentUpscaleModelLoader",
    "_meta": { "title": "加载Latent放大模型" }
  },
  "241": {
    "inputs": { "unet_name": "ltx-2.3-22b-distilled-fp8.safetensors", "weight_dtype": "default" },
    "class_type": "UNETLoader",
    "_meta": { "title": "UNet加载器" }
  },
  "242": {
    "inputs": { "lora_name": "ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors", "strength_model": 0.6, "model": ["241", 0] },
    "class_type": "LoraLoaderModelOnly",
    "_meta": { "title": "LoRA加载器（仅模型）" }
  },
  "243": {
    "inputs": { "vae_name": "LTX23_video_vae_bf16.safetensors" },
    "class_type": "VAELoader",
    "_meta": { "title": "加载VAE" }
  },
  "244": {
    "inputs": { "vae_name": "LTX23_audio_vae_bf16.safetensors", "device": "main_device", "weight_dtype": "bf16" },
    "class_type": "VAELoaderKJ",
    "_meta": { "title": "VAELoader KJ" }
  },
  "245": {
    "inputs": { "vae_name": "taeltx2_3.safetensors" },
    "class_type": "VAELoader",
    "_meta": { "title": "加载VAE" }
  },
  "246": {
    "inputs": { "clip_name1": "gemma_3_12B_it_fp4_mixed.safetensors", "clip_name2": "ltx-2.3_text_projection_bf16.safetensors", "type": "ltxv", "device": "default" },
    "class_type": "DualCLIPLoader",
    "_meta": { "title": "双CLIP加载器" }
  },
  "247": {
    "inputs": { "width": ["57", 1], "height": ["57", 2], "upscale_method": "lanczos", "keep_proportion": "crop", "pad_color": "0, 0, 0", "crop_position": "center", "divisible_by": 32, "device": "cpu", "image": ["248", 0] },
    "class_type": "ImageResizeKJv2",
    "_meta": { "title": "Resize Image v2" }
  },
  "248": {
    "inputs": { "image": "ComfyUI_00093_ (1).png" },
    "class_type": "LoadImage",
    "_meta": { "title": "LAST FRAME" }
  },
  "250": {
    "inputs": { "longer_edge": 1536, "images": ["247", 0] },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": { "title": "缩放图像（长边）" }
  },
  "251": {
    "inputs": { "img_compression": 33, "image": ["250", 0] },
    "class_type": "LTXVPreprocess",
    "_meta": { "title": "LTXV预处理" }
  },
  "254": {
    "inputs": { "image": "ComfyUI_00108_.png" },
    "class_type": "LoadImage",
    "_meta": { "title": "LAST FRAME" }
  },
  "255": {
    "inputs": { "width": ["57", 1], "height": ["57", 2], "upscale_method": "lanczos", "keep_proportion": "crop", "pad_color": "0, 0, 0", "crop_position": "center", "divisible_by": 32, "device": "cpu", "image": ["254", 0] },
    "class_type": "ImageResizeKJv2",
    "_meta": { "title": "Resize Image v2" }
  },
  "257": {
    "inputs": { "image": "ComfyUI_00103_.png" },
    "class_type": "LoadImage",
    "_meta": { "title": "LAST FRAME" }
  },
  "258": {
    "inputs": { "width": ["57", 1], "height": ["57", 2], "upscale_method": "lanczos", "keep_proportion": "crop", "pad_color": "0, 0, 0", "crop_position": "center", "divisible_by": 32, "device": "cpu", "image": ["257", 0] },
    "class_type": "ImageResizeKJv2",
    "_meta": { "title": "Resize Image v2" }
  },
  "265": {
    "inputs": { "img_compression": 33, "image": ["267", 0] },
    "class_type": "LTXVPreprocess",
    "_meta": { "title": "LTXV预处理" }
  },
  "267": {
    "inputs": { "longer_edge": 1536, "images": ["255", 0] },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": { "title": "缩放图像（长边）" }
  },
  "268": {
    "inputs": { "img_compression": 33, "image": ["270", 0] },
    "class_type": "LTXVPreprocess",
    "_meta": { "title": "LTXV预处理" }
  },
  "270": {
    "inputs": { "longer_edge": 1536, "images": ["258", 0] },
    "class_type": "ResizeImagesByLongerEdge",
    "_meta": { "title": "缩放图像（长边）" }
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

  // 1. 处理参考图 - 支持最多 6 张引导图
  const imageRefs = (config.referenceList || []).filter((r) => r.type === "image");
  if (imageRefs.length === 0) throw new Error("多参考图生视频需要至少一张参考图片");

  const images = imageRefs.map((r) => {
    let b64 = r.base64 || "";
    if (b64.includes(",")) b64 = b64.split(",")[1];
    return b64;
  });

  logger(`[LTX 2.3 Multi2V] 开始生成，${images.length} 张参考图`);

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 3. 替换引导图 LoadImage 节点为 easy loadImageBase64，按实际上传数量设置 num_guides
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
  // 清除未使用的引导图连接（避免 ComfyUI 报缺失节点）
  for (let i = guideCount; i < 6; i++) {
    delete workflow[GUIDE_NODE_IDS[i]];
    delete workflow["221"]["inputs"][`num_guides.image_${i + 1}`];
  }

  // 4. 注入提示词（节点 16）
  workflow["16"]["inputs"]["text"] = config.prompt;

  // 5. 计算并设置视频时长（节点 169）
  workflow["169"]["inputs"]["value"] = config.duration;

  // 6. 设置分辨率
  //    节点 166 (WIDTH), 节点 167 (HEIGHT) → 控制首帧缩放尺寸
  //    所有 ResizeImagesByLongerEdge 节点 → 控制 LTXVPreprocess 输入尺寸
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

  // 设置所有 ResizeImagesByLongerEdge 的 longer_edge
  workflow["42"]["inputs"]["longer_edge"] = longerEdge;
  workflow["58"]["inputs"]["longer_edge"] = longerEdge;
  workflow["49"]["inputs"]["longer_edge"] = longerEdge;
  workflow["250"]["inputs"]["longer_edge"] = longerEdge;
  workflow["267"]["inputs"]["longer_edge"] = longerEdge;
  workflow["270"]["inputs"]["longer_edge"] = longerEdge;

  logger(`[LTX 2.3 Multi2V] 分辨率: ${width}x${height}, 时长: ${config.duration}s, 参考图: ${images.length}张`);

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

  logger(`[LTX 2.3 Multi2V] 任务已提交，ID: ${promptId}`);

  // 9. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) {
      return { completed: true, error: JSON.stringify(run.status.exec_info.error) };
    }

    // 检查 VHS_VideoCombine（节点 43）的输出
    const output = run.outputs?.["43"];
    const fileInfo = output?.video?.[0] || output?.gifs?.[0] || output?.images?.[0];
    if (fileInfo) return { completed: true, data: fileInfo };
    return { completed: false };
  }, 3000, 600000);

  if (result.error) throw new Error(`LTX 2.3 Multi2V 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的视频");

  // 10. 下载视频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "")}&type=${fileInfo.type}`;
  logger(`[LTX 2.3 Multi2V] 下载视频: ${downloadUrl}`);
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
