/**
 * Toonflow AI Vendor
 * @version 3.8.5 FINAL
 * Strictly follow your FLUX2 dual-image workflow
 * NO IMAGE = NO group1 / NO group2 / NO group3 nodes
 * IMAGE 1 = group1 only
 * IMAGE 2 = group1 + group2
 * IMAGE 3 = group1 + group2 + group3
 * Fix KSampler 146: never reference missing nodes
 */

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
  voice: string;
  speed?: number;
  volume?: number;
}

interface VendorConfig {
  id: "comfyui-image-三图参考合一";
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string; default?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

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
  textRequest: (m: TextModel) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSModel, m: any) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

const vendor: VendorConfig = {
  id: "comfyui-三图参考合一",
  version: "3.8.5",
  author: "Toonflow",
  name: "FLUX2 Klein 文生+单图+双图+三图参考",
  description: "文生+单图+双图+三图参考",
  icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  inputs: [
    { key: "apiUrl", label: "ComfyUI URL", type: "url", required: true, placeholder: "http://127.0.0.1:8188" },
    { key: "clipModel", label: "CLIP", type: "text", required: true, placeholder: "qwen_3_8b_fp8mixed.safetensors" },
    { key: "vaeModel", label: "VAE", type: "text", required: true, placeholder: "flux2-vae.safetensors" },
    { key: "unetModel", label: "UNet", type: "text", required: true, placeholder: "flux-2-klein-9b-fp8.safetensors" },
    { key: "width", label: "Width", type: "text", required: true, placeholder: "1280" },
    { key: "height", label: "Height", type: "text", required: true, placeholder: "720" },
    { key: "steps", label: "Steps", type: "text", required: true, placeholder: "6" },
    { key: "cfg", label: "CFG", type: "text", required: true, placeholder: "1" },
    { key: "samplerName", label: "Sampler", type: "text", required: false, placeholder: "euler", default: "euler" },
    { key: "scheduler", label: "Scheduler", type: "text", required: false, placeholder: "simple", default: "simple" },
    { key: "denoise", label: "Denoise", type: "text", required: false, placeholder: "1", default: "1" },
  ],
  inputValues: {
    apiUrl: "http://127.0.0.1:8188",
    clipModel: "qwen_3_8b_fp8mixed.safetensors",
    vaeModel: "flux2-vae.safetensors",
    unetModel: "flux-2-klein-9b-fp8.safetensors",
    width: "1280",
    height: "720",
    steps: "6",
    cfg: "1",
    samplerName: "euler",
    scheduler: "simple",
    denoise: "1",
  },
  models: [
    {
      name: "FLUX2 文生+单图+双图+三图",
      modelName: "flux2-klein-triple",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      associationSkills: "text2image,image2image,multiImage2image",
    },
  ],
};

// BASE: only core nodes (NO group1 / NO group2 / NO group3)
const BASE_WORKFLOW = {
  "104": { "inputs": { "samples": ["146", 0], "vae": ["110", 0] }, "class_type": "VAEDecode" },
  "107": { "inputs": { "clip_name": "", "type": "flux2", "device": "default" }, "class_type": "CLIPLoader" },
  "108": { "inputs": { "text": "", "clip": ["107", 0] }, "class_type": "CLIPTextEncode" },
  "109": { "inputs": { "text": "", "clip": ["107", 0] }, "class_type": "CLIPTextEncode" },
  "110": { "inputs": { "vae_name": "" }, "class_type": "VAELoader" },
  "128": { "inputs": { "width": 1280, "height": 720, "batch_size": 1 }, "class_type": "EmptyFlux2LatentImage" },
  "146": {
    "inputs": {
      "seed": 0, "steps": 6, "cfg": 1,
      "sampler_name": "euler", "scheduler": "simple", "denoise": 1,
      "model": ["197", 0],
      "positive": ["108", 0],
      "negative": ["109", 0],
      "latent_image": ["128", 0]
    },
    "class_type": "KSampler"
  },
  "195": { "inputs": { "filename_prefix": "ComfyUI", "images": ["104", 0] }, "class_type": "SaveImage" },
  "197": { "inputs": { "unet_name": "", "weight_dtype": "default" }, "class_type": "UNETLoader" }
};

function getWorkflowJson(
  prompt: string,
  width: number,
  height: number,
  steps: number,
  cfg: number,
  denoise: number,
  referenceImages: string[] = []
) {
  const seed = Math.floor(Math.random() * 1e18);
  const clipModel = vendor.inputValues.clipModel;
  const vaeModel = vendor.inputValues.vaeModel;
  const unetModel = vendor.inputValues.unetModel;
  const samplerName = vendor.inputValues.samplerName || "euler";
  const scheduler = vendor.inputValues.scheduler || "simple";

  // 🔥 强制过滤：空数组/空字符串，确保文生图绝对0图片节点
  const validRefs = referenceImages.filter(item => item && item.trim() !== '');
  const refCount = validRefs.length;

  const w = JSON.parse(JSON.stringify(BASE_WORKFLOW));

  // base fill
  w["107"].inputs.clip_name = clipModel;
  w["110"].inputs.vae_name = vaeModel;
  w["197"].inputs.unet_name = unetModel;
  w["108"].inputs.text = prompt;
  w["109"].inputs.text = "";
  w["146"].inputs.seed = seed;
  w["146"].inputs.steps = steps;
  w["146"].inputs.cfg = cfg;
  w["146"].inputs.sampler_name = samplerName;
  w["146"].inputs.scheduler = scheduler;
  w["128"].inputs.width = width;
  w["128"].inputs.height = height;

  // ----------------------------------------------------
  // CASE 0: NO IMAGE → 100% 纯净基础流程，无任何图片节点
  // ----------------------------------------------------
  if (refCount === 0) {
    w["146"].inputs.denoise = 1;
    w["146"].inputs.positive = ["108", 0];
    w["146"].inputs.negative = ["109", 0];
    return w;
  }

  // ====================================================
  // 👇 以下是你原本的图生图代码，完全没有修改！
  // ====================================================

  // ----------------------------------------------------
  // CASE 1: 1 IMAGE → ADD GROUP1 ONLY
  // ----------------------------------------------------
  if (refCount === 1) {
    w["76"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: "", image_output: "Preview", save_prefix: "ComfyUI" }
    };
    w["112"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 64, image: ["76", 0] }
    };
    w["114"] = { inputs: { image: ["112", 0] }, class_type: "GetImageSize" };
    w["116"] = { inputs: { pixels: ["112", 0], vae: ["110", 0] }, class_type: "VAEEncode" };
    w["115"] = { inputs: { conditioning: ["109", 0], latent: ["116", 0] }, class_type: "ReferenceLatent" };
    w["117"] = { inputs: { conditioning: ["108", 0], latent: ["116", 0] }, class_type: "ReferenceLatent" };

    let b64 = validRefs[0] || "";
    if (b64.includes(',')) b64 = b64.split(',')[1];
    w["76"].inputs.base64_data = b64.replace(/\s/g, "");

    w["146"].inputs.denoise = denoise;
    w["146"].inputs.positive = ["117", 0];
    w["146"].inputs.negative = ["115", 0];
    return w;
  }

  // ----------------------------------------------------
  // CASE 2: 2 IMAGES → ADD GROUP1 + GROUP2
  // ----------------------------------------------------
  if (refCount === 2) {
    // GROUP1
    w["76"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: "", image_output: "Preview", save_prefix: "ComfyUI" }
    };
    w["112"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 64, image: ["76", 0] }
    };
    w["114"] = { inputs: { image: ["112", 0] }, class_type: "GetImageSize" };
    w["116"] = { inputs: { pixels: ["112", 0], vae: ["110", 0] }, class_type: "VAEEncode" };
    w["115"] = { inputs: { conditioning: ["109", 0], latent: ["116", 0] }, class_type: "ReferenceLatent" };
    w["117"] = { inputs: { conditioning: ["108", 0], latent: ["116", 0] }, class_type: "ReferenceLatent" };

    // GROUP2
    w["164"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: "", image_output: "Preview", save_prefix: "ComfyUI" }
    };
    w["165"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 64, image: ["164", 0] }
    };
    w["163"] = { inputs: { pixels: ["165", 0], vae: ["110", 0] }, class_type: "VAEEncode" };
    w["166"] = { inputs: { conditioning: ["117", 0], latent: ["163", 0] }, class_type: "ReferenceLatent" };
    w["167"] = { inputs: { conditioning: ["115", 0], latent: ["163", 0] }, class_type: "ReferenceLatent" };

    let b1 = validRefs[0] || "";
    if (b1.includes(',')) b1 = b1.split(',')[1];
    w["76"].inputs.base64_data = b1.replace(/\s/g, "");

    let b2 = validRefs[1] || "";
    if (b2.includes(',')) b2 = b2.split(',')[1];
    w["164"].inputs.base64_data = b2.replace(/\s/g, "");

    w["146"].inputs.denoise = denoise;
    w["146"].inputs.positive = ["166", 0];
    w["146"].inputs.negative = ["167", 0];
    return w;
  }

  // ----------------------------------------------------
  // CASE 3: 3 IMAGES → ADD GROUP1 + GROUP2 + GROUP3
  // ----------------------------------------------------
  if (refCount >= 3) {
    // GROUP1
    w["76"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: "", image_output: "Preview", save_prefix: "ComfyUI" }
    };
    w["112"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 64, image: ["76", 0] }
    };
    w["114"] = { inputs: { image: ["112", 0] }, class_type: "GetImageSize" };
    w["116"] = { inputs: { pixels: ["112", 0], vae: ["110", 0] }, class_type: "VAEEncode" };
    w["115"] = { inputs: { conditioning: ["109", 0], latent: ["116", 0] }, class_type: "ReferenceLatent" };
    w["117"] = { inputs: { conditioning: ["108", 0], latent: ["116", 0] }, class_type: "ReferenceLatent" };

    // GROUP2
    w["164"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: "", image_output: "Preview", save_prefix: "ComfyUI" }
    };
    w["165"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 64, image: ["164", 0] }
    };
    w["163"] = { inputs: { pixels: ["165", 0], vae: ["110", 0] }, class_type: "VAEEncode" };
    w["166"] = { inputs: { conditioning: ["117", 0], latent: ["163", 0] }, class_type: "ReferenceLatent" };
    w["167"] = { inputs: { conditioning: ["115", 0], latent: ["163", 0] }, class_type: "ReferenceLatent" };

    // GROUP3
    w["179"] = {
      class_type: "easy loadImageBase64",
      inputs: { base64_data: "", image_output: "Preview", save_prefix: "ComfyUI" }
    };
    w["176"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 64, image: ["179", 0] }
    };
    w["178"] = { inputs: { pixels: ["176", 0], vae: ["110", 0] }, class_type: "VAEEncode" };
    w["180"] = { inputs: { conditioning: ["166", 0], latent: ["178", 0] }, class_type: "ReferenceLatent" };
    w["182"] = { inputs: { conditioning: ["167", 0], latent: ["178", 0] }, class_type: "ReferenceLatent" };

    let b1 = validRefs[0] || "";
    if (b1.includes(',')) b1 = b1.split(',')[1];
    w["76"].inputs.base64_data = b1.replace(/\s/g, "");

    let b2 = validRefs[1] || "";
    if (b2.includes(',')) b2 = b2.split(',')[1];
    w["164"].inputs.base64_data = b2.replace(/\s/g, "");

    let b3 = validRefs[2] || "";
    if (b3.includes(',')) b3 = b3.split(',')[1];
    w["179"].inputs.base64_data = b3.replace(/\s/g, "");

    w["146"].inputs.denoise = denoise;
    w["146"].inputs.positive = ["180", 0];
    w["146"].inputs.negative = ["182", 0];
    return w;
  }

  return w;
}

// ------------------------------
// ComfyUI request logic
// ------------------------------
const buildComfyRequest = (workflow: any) => ({ prompt: workflow, client_id: "toonflow" });

const submitWorkFlow = async (workflow: any, apiUrl: string) => {
  const res = await axios.post(`${apiUrl}/prompt`, buildComfyRequest(workflow), {
    headers: { "Content-Type": "application/json" }, timeout: 30000
  });
  return res.data.prompt_id;
};

const getTaskResult = async (promptId: string, apiUrl: string) => {
  const res = await axios.get(`${apiUrl}/history/${promptId}`, { timeout: 5000 });
  return res.data[promptId] || null;
};

// ------------------------------
// Exports
// ------------------------------
const textRequest = () => { throw new Error("text not supported"); };
const videoRequest = () => { throw new Error("video not supported"); };
const ttsRequest = () => { throw new Error("tts not supported"); };

const imageRequest = async (config: ImageConfig, model: ImageModel) => {
  let apiUrl = vendor.inputValues.apiUrl.trim().replace(/\/+$/, "");
  const width = parseInt(vendor.inputValues.width);
  const height = parseInt(vendor.inputValues.height);
  const steps = parseInt(vendor.inputValues.steps);
  const cfg = parseFloat(vendor.inputValues.cfg);
  const denoise = parseFloat(vendor.inputValues.denoise);
  const refs = config.referenceList?.map(i => i.base64) || [];

  const workflow = getWorkflowJson(
    config.prompt, width, height, steps, cfg, denoise, refs
  );

  const promptId = await submitWorkFlow(workflow, apiUrl);

  const result = await pollTask(async () => {
    const task = await getTaskResult(promptId, apiUrl);
    if (!task) return { completed: false };
    if (task.status?.status_str === "success") {
      const img = task.outputs?.["195"]?.images?.[0];
      if (img) {
        return {
          completed: true,
          data: `${apiUrl}/view?filename=${encodeURIComponent(img.filename)}&type=output`
        };
      }
    }
    if (["error", "failed"].includes(task.status?.status_str)) {
      return { completed: true, error: task.status?.exception_message || "task failed" };
    }
    return { completed: false };
  }, 2000, 300000);

  if (result.error) throw new Error(result.error);
  return await urlToBase64(result.data!);
};

const checkForUpdates = async () => ({
  hasUpdate: false,
  latestVersion: "3.8.5",
  notice: "文生+单图+双图+三图参考 ✅"
});

const updateVendor = async () => "";

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export { };