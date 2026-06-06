/**
 * Toonflow AI供应商 - Qwen3 TTS 语音合成（本地 ComfyUI）
 * @version 1.0
 */

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "qwen3_tts",
  version: "1.0",
  author: "Toonflow",
  name: "Qwen3 TTS（本地 ComfyUI）",
  description:
    "基于本地 ComfyUI 的 Qwen3 TTS 语音合成工作流。需要 ComfyUI 环境已配置 Qwen3-TTS 自定义节点。",
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
  ],
  inputValues: { baseUrl: "http://localhost:8188", modelSize: "1.7B" },
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
  ],
};

// ============================================================
// 工作流 JSON（从 ComfyUI 导出的 API 格式）
// ============================================================

const WORKFLOW_JSON = {
  "1": {
    inputs: {
      text: "",
      instruct: "",
      model_choice: "1.7B",
      device: "auto",
      precision: "bf16",
      language: "Auto",
      seed: 578804842370408,
      max_new_tokens: 2048,
      top_p: 0.8,
      top_k: 20,
      temperature: 1,
      repetition_penalty: 1.05,
      attention: "auto",
      unload_model_after_generate: false,
    },
    class_type: "FB_Qwen3TTSVoiceDesign",
    _meta: {
      title: "🎨 Qwen3-TTS VoiceDesign",
    },
  },
  "2": {
    inputs: {
      filename_prefix: "audio/ComfyUI",
      audioUI: "",
      audio: ["1", 0],
    },
    class_type: "SaveAudio",
    _meta: {
      title: "保存音频",
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
  if (!config.text) throw new Error("缺少语音合成文本");

  logger(`[Qwen3 TTS] 开始语音合成，文本长度: ${config.text.length}`);

  // 1. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 2. 注入文本
  workflow["1"]["inputs"]["text"] = config.text;

  // 3. 注入语音指令（从 voice 配置映射）
  const voiceInstruct = config.voice || "";
  workflow["1"]["inputs"]["instruct"] = voiceInstruct;

  // 4. 设置模型大小
  const modelSize = vendor.inputValues.modelSize || "1.7B";
  workflow["1"]["inputs"]["model_choice"] = modelSize;

  // 5. 生成随机种子，每次合成获得不同效果
  workflow["1"]["inputs"]["seed"] = Math.floor(Math.random() * 2147483647);

  logger(
    `[Qwen3 TTS] 语音指令: "${voiceInstruct || "默认"}", 模型: ${modelSize}`,
  );

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

  logger(`[Qwen3 TTS] 任务已提交，ID: ${promptId}`);

  // 7. 轮询结果
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

      // 检查 SaveAudio（节点 2）的输出
      const output = run.outputs?.["2"];
      const fileInfo = output?.audio?.[0] || output?.images?.[0];
      if (fileInfo) return { completed: true, data: fileInfo };
      return { completed: false };
    },
    2000,
    300000,
  );

  if (result.error) throw new Error(`Qwen3 TTS 合成失败: ${result.error}`);
  if (!result.data) throw new Error("未找到生成的音频");

  // 8. 下载音频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "audio")}&type=${fileInfo.type}`;
  logger(`[Qwen3 TTS] 下载音频: ${downloadUrl}`);
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
