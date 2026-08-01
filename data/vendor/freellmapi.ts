/**
 * Toonflow AI供应商 - FreeLLM API 统一代理
 * @version 2.0
 *
 * 本地统一 API 代理（freellmapi），一个密钥访问多个模型：
 *   - 对话：POST /v1/chat/completions（OpenAI 兼容）
 *   - 响应：POST /v1/responses
 *   - 消息：POST /v1/messages（Anthropic / Claude 兼容）
 *   - 嵌入：POST /v1/embeddings
 *
 * 适配器使用 OpenAI 兼容协议（/v1/chat/completions）。
 * 模型列表可在设置中心手动添加（模型名以代理侧实际可用模型为准）。
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

interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  imageBase64?: string[];
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
  id: "freellmapi",
  version: "1.0",
  author: "Toonflow",
  name: "FreeLLM API 统一代理",
  description:
    "本地统一 API 代理（freellmapi）：一个密钥访问多个模型，OpenAI 兼容（/v1/chat/completions），同时支持 Responses 与 Anthropic Messages 协议。\n\n在「模型管理」中按代理侧实际可用的模型名手动添加文本模型即可。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "统一 API 密钥", type: "password", required: true, placeholder: "freellmapi-xxx" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：http://127.0.0.1:31415/v1" },
  ],
  inputValues: {
    apiKey: "freellmapi-27159fb453141775a848504c32801476a362903c0264d353",
    baseUrl: "http://127.0.0.1:31415/v1",
  },
  models: [
    { name: "Auto (best available)", modelName: "auto", type: "text", think: false },
    { name: "Fusion (parallel panel)", modelName: "fusion", type: "text", think: false },
    { name: "Kimi K2.6", modelName: "kimi-k2.6", type: "text", think: false },
    { name: "Kimi K2.7 Code", modelName: "kimi-k2.7-code", type: "text", think: false },
    { name: "Gemini 3.5 Flash", modelName: "gemini-3.5-flash", type: "text", think: false },
    { name: "DeepSeek V4 Flash", modelName: "deepseek-v4-flash", type: "text", think: false },
    { name: "DeepSeek R1", modelName: "deepseek-r1", type: "text", think: true },
    { name: "Qwen3.5 397B", modelName: "qwen3.5-397b", type: "text", think: false },
    { name: "Compound", modelName: "compound", type: "text", think: false },
    { name: "GPT-OSS 120B", modelName: "gpt-oss-120b", type: "text", think: false },
    { name: "GLM-4.7", modelName: "glm-4.7", type: "text", think: false },
    { name: "Nemotron 3 Ultra 550B", modelName: "nemotron-3-ultra-550b", type: "text", think: false },
    { name: "Qwen3 30B", modelName: "qwen3-30b", type: "text", think: false },
    { name: "Qwen3 32B", modelName: "qwen3-32b", type: "text", think: false },
    { name: "Llama 4 Maverick", modelName: "llama-4-maverick", type: "text", think: false },
    { name: "DeepSeek R1 Distill Qwen 32B", modelName: "deepseek-r1-distill-qwen-32b", type: "text", think: true },
    { name: "Nemotron 3 Super 120B", modelName: "nemotron-3-120b", type: "text", think: false },
    { name: "Qwen3 14B", modelName: "qwen3-14b", type: "text", think: false },
    { name: "Command A+", modelName: "command-a-2", type: "text", think: false },
    { name: "Llama 4 Scout", modelName: "llama-4-scout", type: "text", think: false },
    { name: "GLM-4.7 Flash", modelName: "glm-4.7-flash", type: "text", think: false },
    { name: "Llama 3.3 70B Instruct", modelName: "llama-3.3-70b-instruct", type: "text", think: false },
    { name: "Nemotron 3 Nano 30B", modelName: "nemotron-3-nano-30b", type: "text", think: false },
    { name: "Qwen3 8B", modelName: "qwen3-8b", type: "text", think: false },
    { name: "Mistral Large 3", modelName: "mistral-large-3", type: "text", think: false },
    { name: "Mistral Medium 3.5", modelName: "mistral-medium-3.5", type: "text", think: false },
    { name: "Mistral Small 4", modelName: "mistral-small-4", type: "text", think: false },
    { name: "Command R", modelName: "command-r", type: "text", think: false },
    { name: "Ministral 3 8B", modelName: "ministral-3-8b", type: "text", think: false },
    { name: "Nemotron 3 Nano 12B VL", modelName: "nemotron-nano-12b-vl", type: "text", think: false },
    { name: "Command R+", modelName: "command-r-2", type: "text", think: false },
    { name: "Command A", modelName: "command-a", type: "text", think: false },
    { name: "GLM-5.2", modelName: "glm-5.2", type: "text", think: true },
    { name: "Cydonia 24B v4.3", modelName: "cydonia-24b-v4.3", type: "text", think: false },
  ],
};

// ============================================================
// 适配器函数
// ============================================================
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl.replace(/\/+$/, "");

  // 通过 OpenAI 兼容协议（/v1/chat/completions）调用统一代理
  // baseUrl 已包含 /v1（如 http://127.0.0.1:31415/v1），无需再拼
  return createOpenAICompatible({
    name: "freellmapi",
    baseURL: baseUrl,
    apiKey,
  }).chatModel(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  return "";
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  return "";
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
