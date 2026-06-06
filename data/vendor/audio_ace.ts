/**
 * Toonflow AI供应商 - AceStep 1.5 XL Turbo 音乐生成（本地 ComfyUI）
 * @version 1.0
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "audio_ace",
  version: "1.0",
  author: "Toonflow",
  name: "AceStep 1.5 XL Turbo（本地 ComfyUI）",
  description:
    "基于本地 ComfyUI 的 AceStep 1.5 XL Turbo 音乐/音频生成工作流。需要 ComfyUI 环境已配置 AceStep 模型及对应节点。",
  inputs: [
    {
      key: "baseUrl",
      label: "ComfyUI 地址",
      type: "text",
      required: true,
      placeholder: "http://localhost:8188",
    },
    {
      key: "defaultBpm",
      label: "默认 BPM",
      type: "text",
      required: false,
      placeholder: "95",
    },
    {
      key: "defaultKey",
      label: "默认调性",
      type: "text",
      required: false,
      placeholder: "E minor",
    },
    {
      key: "defaultDuration",
      label: "默认时长（秒）",
      type: "text",
      required: false,
      placeholder: "30",
    },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
    defaultBpm: "95",
    defaultKey: "E minor",
    defaultDuration: "30",
  },
  models: [
    {
      name: "AceStep 1.5 XL Turbo",
      modelName: "acestep-1.5-turbo",
      type: "tts",
      voices: [{ title: "默认", voice: "" }],
    },
  ],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

const WORKFLOW_JSON = {
  "3": {
    inputs: {
      seed: ["109", 0],
      steps: 8,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1,
      model: ["78", 0],
      positive: ["94", 0],
      negative: ["47", 0],
      latent_image: ["98", 0],
    },
    class_type: "KSampler",
    _meta: {
      title: "K采样器",
    },
  },
  "18": {
    inputs: {
      samples: ["3", 0],
      vae: ["106", 0],
    },
    class_type: "VAEDecodeAudio",
    _meta: {
      title: "VAE解码（音频）",
    },
  },
  "47": {
    inputs: {
      conditioning: ["94", 0],
    },
    class_type: "ConditioningZeroOut",
    _meta: {
      title: "条件零化",
    },
  },
  "78": {
    inputs: {
      shift: 3,
      model: ["104", 0],
    },
    class_type: "ModelSamplingAuraFlow",
    _meta: {
      title: "采样算法（AuraFlow）",
    },
  },
  "94": {
    inputs: {
      tags: "",
      lyrics: "",
      seed: ["109", 0],
      bpm: 95,
      duration: 120,
      timesignature: "4",
      language: "en",
      keyscale: "E minor",
      generate_audio_codes: true,
      cfg_scale: 2,
      temperature: 0.85,
      top_p: 0.9,
      top_k: 0,
      min_p: 0,
      clip: ["105", 0],
    },
    class_type: "TextEncodeAceStepAudio1.5",
    _meta: {
      title: "TextEncodeAceStepAudio1.5",
    },
  },
  "98": {
    inputs: {
      seconds: 120,
      batch_size: 1,
    },
    class_type: "EmptyAceStep1.5LatentAudio",
    _meta: {
      title: "Empty Ace Step 1.5 Latent Audio",
    },
  },
  "104": {
    inputs: {
      unet_name: "acestep_v1.5_xl_turbo_bf16.safetensors",
      weight_dtype: "default",
    },
    class_type: "UNETLoader",
    _meta: {
      title: "UNet加载器",
    },
  },
  "105": {
    inputs: {
      clip_name1: "qwen_0.6b_ace15.safetensors",
      clip_name2: "qwen_4b_ace15.safetensors",
      type: "ace",
      device: "default",
    },
    class_type: "DualCLIPLoader",
    _meta: {
      title: "双CLIP加载器",
    },
  },
  "106": {
    inputs: {
      vae_name: "ace_1.5_vae.safetensors",
    },
    class_type: "VAELoader",
    _meta: {
      title: "加载VAE",
    },
  },
  "107": {
    inputs: {
      filename_prefix: "audio/ACE_Step1.5_xl_turbo",
      quality: "V0",
      audioUI: "",
      audio: ["18", 0],
    },
    class_type: "SaveAudioMP3",
    _meta: {
      title: "保存音频 (MP3)",
    },
  },
  "109": {
    inputs: {
      value: 0,
    },
    class_type: "PrimitiveInt",
    _meta: {
      title: "Int (Seed)",
    },
  },
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (
  model: TextModel,
  think: boolean,
  thinkLevel: 0 | 1 | 2 | 3,
) => {
  throw new Error("不支持文本生成");
};

const imageRequest = async (
  config: ImageConfig,
  model: ImageModel,
): Promise<string> => {
  throw new Error("不支持图片生成");
};

const videoRequest = async (
  config: VideoConfig,
  model: VideoModel,
): Promise<string> => {
  throw new Error("不支持视频生成");
};

const ttsRequest = async (
  config: TTSConfig,
  model: TTSModel,
): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.text) throw new Error("缺少音频生成描述（tags）");

  logger(`[AceStep Audio] 开始生成音频，描述长度: ${config.text.length}`);

  // 1. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 2. 注入音乐参数
  //    config.text 作为 tags（音乐风格描述）
  workflow["94"]["inputs"]["tags"] = config.text;

  // 3. 生成随机种子，每次生成获得不同音乐
  const seed = Math.floor(Math.random() * 2147483647);
  workflow["109"]["inputs"]["value"] = seed;
  workflow["94"]["inputs"]["seed"] = ["109", 0];
  workflow["3"]["inputs"]["seed"] = ["109", 0];

  // 4. 设置 BPM（从 inputValues 或默认值）
  const bpm = parseInt(vendor.inputValues.defaultBpm || "95", 10);
  workflow["94"]["inputs"]["bpm"] = isNaN(bpm) ? 95 : bpm;

  // 5. 设置调性
  workflow["94"]["inputs"]["keyscale"] =
    vendor.inputValues.defaultKey || "E minor";

  // 6. 设置时长（从 defaultDuration 输入获取默认值，支持 config.speechRate 作为按次覆盖）
  const defaultDuration = parseInt(
    vendor.inputValues.defaultDuration || "30",
    10,
  );
  const duration = Math.max(
    15,
    Math.min(
      300,
      config.speechRate > 0
        ? Math.round(config.speechRate)
        : isNaN(defaultDuration)
          ? 30
          : defaultDuration,
    ),
  );
  workflow["94"]["inputs"]["duration"] = duration;
  workflow["98"]["inputs"]["seconds"] = duration;

  logger(
    `[AceStep Audio] BPM: ${bpm}, 调性: ${workflow["94"]["inputs"]["keyscale"]}, 时长: ${duration}s`,
  );

  // 7. 提交到 ComfyUI API
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

  logger(`[AceStep Audio] 任务已提交，ID: ${promptId}`);

  // 8. 轮询结果
  const result = await pollTask(
    async () => {
      const historyResp = await fetch(`${baseUrl}/history`);
      const history = await historyResp.json();
      const run = history[promptId];
      if (!run) return { completed: false };
      if (run.status?.exec_info?.error) {
        return {
          completed: true,
          error: JSON.stringify(run.status.exec_info.error),
        };
      }

      // 检查 SaveAudioMP3（节点 107）的输出
      const output = run.outputs?.["107"];
      const fileInfo = output?.audio?.[0] || output?.images?.[0];
      if (fileInfo) return { completed: true, data: fileInfo };
      return { completed: false };
    },
    3000,
    600000,
  );

  if (result.error) throw new Error(`AceStep Audio 生成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的音频");

  // 9. 下载音频并转为 Base64
  //    SaveAudioMP3 的 filename_prefix 为 "audio/ACE_Step1.5_xl_turbo"，输出通常在 audio 子目录
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "audio")}&type=${fileInfo.type}`;
  logger(`[AceStep Audio] 下载音频: ${downloadUrl}`);
  return await urlToBase64(downloadUrl);
};

const checkForUpdates = async () => ({
  hasUpdate: false,
  latestVersion: "1.0",
  notice: "",
});
const updateVendor = async () => {
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
