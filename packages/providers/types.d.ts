/// <reference types="bun" />

interface MediaLora { name: string; strength?: number }

interface EngineProfile {
  loras: string[];
  loraTriggerWords: Record<string, string>;
  limits: Record<string, unknown>;
  quality: Record<string, unknown>;
}

type ModelType = "text" | "image" | "video" | "audio";

type ImageMode = "text" | "singleImage" | "multiReference";
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`${"video" | "image" | "audio"}Reference:${number}`)[];

interface ProviderModel {
  id: string;
  label: string;
  type: ModelType;
  think?: boolean;
  mode?: (ImageMode | VideoMode)[];
  associationSkills?: string;
  audio?: "optional" | boolean;
  imageSizes?: string[];
  imageRatios?: string[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  voices?: { title: string; voice: string }[];
}

interface ProviderFormRule {
  field: string;
  value: unknown;
  /** 配置值为空时宿主优先使用的报错文案；目前仅 apiKey 字段生效。 */
  missingMessage?: string;
}

type ProviderConfig<TRules extends readonly ProviderFormRule[]> = {
  [TRule in TRules[number] as TRule["field"]]: TRule["value"];
};

interface ProviderContext<TConfig = Record<string, unknown>> {
  config: TConfig;
  signal?: AbortSignal;
  /** 宿主直接注入工具，供应商无需 import；FFmpeg 为按需安装的插件能力。 */
  tool: ProviderTools;
  /**
   * 供应商任务号确定后的宿主回调：jobId 是引擎侧任务号，cancel 是供应商构造的取消闭包
   * （带自己的鉴权与地址知识，宿主不碰引擎协议）。宿主用它实现「显式取消直达引擎」，
   * 断线清理路径不调用 cancel——本地引擎任务继续跑完不丢产物是既有审计决策。
   */
  onJobStart?: (jobId: string, cancel: () => Promise<void>) => void;
  /**
   * 不绑定本次生成信号的原始 fetch（宿主注入）：任务被 abort 之后仍要发出的收尾请求
   * （如引擎取消闭包）用它，`tool.fetch` 在信号中止后会被宿主直接拒。
   */
  queryFetch?: typeof globalThis.fetch;
}

interface MediaRequest {
  model: string;
  /** 引擎侧任务名的可读标签（FreeVideo 显示在生成列表里）：调用方带资产/镜头代号，如 `C01`、`S001`。 */
  label?: string;
  /** 仅放供应商专属参数；公共字段的映射与支持范围由供应商校验。 */
  other?: Record<string, unknown>;
}

/** 抽象层的媒体来源；供应商负责转换为平台需要的 URL、文件或字节。 */
type MediaInput =
  | { type: "url"; url: string; mimeType?: string; name?: string }
  | { type: "base64"; data: string; mimeType: string; name?: string }
  | { type: "binary"; data: Uint8Array; mimeType: string; name?: string };

/**
 * 生成产物。`jobId` 是供应商侧任务号（如 FreeVideo 的 `j` + 12 hex），
 * 供续接生成用 `continue_from` 精确引用这一镜——不参与落盘，只用于回写与续接。
 */
type MediaAsset = MediaInput & { mediaType: "image" | "video" | "audio"; jobId?: string };

type MediaImageInfo = { width: number; height: number; format: string };
type MediaImageResizeOptions = { width?: number; height?: number; format?: "jpeg" | "png" | "webp"; quality?: number };

interface AudioConvertOptions {
  format: "wav" | "mp3";
  /** 裁剪起点，单位秒，含边界；缺省为 0。 */
  startSeconds?: number;
  /** 裁剪终点，单位秒，不含边界；缺省为音频末尾。 */
  endSeconds?: number;
  /** 目标采样率；缺省保持原采样率。 */
  sampleRate?: number;
  /** mp3 比特率，单位 kbps；缺省 128，仅 format 为 mp3 时生效。 */
  bitrateKbps?: number;
}

/** 缺少可用 FFmpeg 时抛出；由宿主前端询问下载安装，供应商应继续向上抛出。 */
interface FfmpegRequiredError extends Error {
  name: "FfmpegRequiredError";
  code: "FFMPEG_REQUIRED";
  status: 424;
}

interface ProviderTools {
  fetch: typeof globalThis.fetch;
  /** 提取供应商错误正文中的可读原因，并隐藏配置中的密钥和 URL 查询参数。 */
  errorMessage(value: unknown): string;
  hash: typeof Bun.hash;
  image: typeof Bun.Image;
  /** 公共图片基础处理工具；供应商可在 processMedia 中按自身模型能力使用。 */
  media: {
    inspectImage(input: MediaInput): Promise<MediaImageInfo>;
    resizeImage(input: MediaInput, options: MediaImageResizeOptions): Promise<MediaInput>;
  };
  /**
   * 音频裁剪转码；仅接受 WAV 格式的内存字节并返回处理后的内存字节，不支持文件路径、URL 或其他压缩格式输入。
   */
  audio: {
    convert(input: Uint8Array, options: AudioConvertOptions): Promise<{ data: Uint8Array; mimeType: string }>;
  };
  /**
   * 获取绑定当前工作区的原生 @renmu/fluent-ffmpeg 工厂，沿用链式调用、事件、流和 ffprobe 回调。
   * 仅显式文件路径经过工作区边界检查；原始参数、滤镜及清单中的间接 I/O 不是沙箱。
   * 宿主始终注入此入口，调用时检查 FFmpeg/FFprobe；没有工作目录的调试上下文不能使用。
   * 缺失时抛出 FfmpegRequiredError，并通知在线前端询问下载；不会后台自动安装。
   * 安装后由用户重新发起操作，供应商不要捕获此错误后自动重试完整生成请求。
   * 输出覆盖行为沿用原生库；调用方负责文件命名、处理 end/error 及通过 command.kill 取消运行。
   * @throws {FfmpegRequiredError} 未安装或当前设置未找到可用的 FFmpeg。
   * @example const ffmpeg = await this.tool.ffmpeg(); const command = ffmpeg("assets/input.mp4").videoCodec("libx264");
   */
  ffmpeg(): Promise<import("@toonflow/ffmpeg/types").FfmpegFactory>;
}

interface ImageRequest extends MediaRequest {
  prompt: string;
  /** 参考图。 */
  images?: MediaInput[];
  mask?: MediaInput;
  /** 生成数量。 */
  n?: number;
  /** 画面宽高比，如 16:9。 */
  ratio?: string;
  /** 输出尺寸，如 1K、2K、4K 或 1024x1024；具体格式由供应商转换。 */
  size?: string;
  /** 画质档位，如 low、medium、high，由供应商映射。 */
  quality?: string;
  /** 输出编码格式，如 png、jpeg、webp。 */
  outputFormat?: string;
  /** 随机种子；未传时由供应商/引擎决定。同种子 + 同提示词 ≈ 同结果，重 roll 保住满意的图。 */
  seed?: number;
  /** LoRA：引擎上限 8 条，strength ∈ [-2, 2]，缺省 1。 */
  loras?: MediaLora[];
}

interface VideoRequest extends MediaRequest {
  prompt: string;
  /** 当前生成模式；参考模式数组声明各类参考媒体数量上限。 */
  mode?: VideoMode;
  /** 参考图；首尾帧通过 firstFrame、lastFrame 单独传入。 */
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  /**
   * 续接上一镜：传入供应商侧任务号，由引擎加载该任务的原生上下文继续生成。
   * 续接时**只允许 references 类媒体**（firstFrame/lastFrame 必须留空），
   * 且参考图上限通常是 3 张——供应商按自身契约校验并给出可执行报错。
   */
  continueFrom?: string;
  /** 输出时长，单位秒；支持范围由供应商按模型校验。 */
  duration?: number;
  /** 画面宽高比，如 16:9。 */
  ratio?: string;
  /** 分辨率档位，如 720p、1080p。 */
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  /** 生成质量档位（FreeVideo 引擎取值 light/medium/high/max）；未传时供应商按自身默认处理。 */
  quality?: string;
  /** 是否开启二次采样（引擎的二次细化采样）；未传时供应商按自身默认处理。 */
  secondPass?: boolean;
  /** 是否开启快速预览模式（引擎只跑预览片，成片需另发 refine 任务）；未传时供应商按自身默认处理。 */
  preview?: boolean;
  /**
   * 随机种子；未传时由供应商/引擎决定。重 roll 保种子（同 seed 同提示词≈同结果）
   * 是跨重试一致性的唯一复现锚点；取值范围由供应商按引擎校验。
   */
  seed?: number;
  /** 本任务完成后立即释放显存/内存中的视频模型；只对批次最后一个任务置 true——中间任务置 true 会让后续任务反复重载模型。 */
  releaseGpuAfter?: boolean;
  /**
   * 一次提交连出 N 条候选（引擎 takes，1–8）：给了 seed 时候选种子为 seed、seed+1…（引擎逐条 +1），
   * 整批可复现。返回多个 MediaAsset（每条候选一个，各带自己的 jobId）；部分候选失败时只返回成功条。
   */
  takes?: number;
  /**
   * 预览转正片：传预览任务的 jobId，引擎从该预览直接精修成片。
   * 设置后 prompt/时长/媒体等生成参数一律忽略（引擎契约：refine_from 与它们互斥），只产出成片一条。
   */
  refineFrom?: string;
  /**
   * 长镜分块时逐块描述（顺序与引擎 chain_plan.blocks 一一对应，条数必须相等，≤5）：
   * 每块演自己那段剧情，而不是重播整段。省略则引擎自动切分提示词。仅对会分块的长镜有意义（先 planVideo 拿块数）。
   */
  partPrompts?: string[];
  /**
   * 白模参考（3D blocking 视频）：library 是引擎作品库 id（`YYYY-MM-DD/32hex`，白模 ready 的 work），
   * earlySteps 是它只引导采样的前 K 步（≈ early_ratio × 首轮步数，派工侧按质量档换算）。
   * 组装进 media.references **末位**、不占 `<Video N>` 编号；占续接 ≤3 的一个槽位。
   */
  whitebox?: { library: string; earlySteps: number };
  /** LoRA：引擎上限 32 条，strength ∈ [-4, 4]，缺省 1。 */
  loras?: MediaLora[];
}

/** 基础音频生成参数；text、prompt 至少提供一项，非空校验与模型能力检查由供应商负责。 */
type AudioRequest = MediaRequest & {
  /** 待朗读的文本，用于文本转语音。 */
  text?: string;
  /** 音频创作或语音风格提示词，可与待朗读的 text 分开传入。 */
  prompt?: string;
  /** 参考音频，可附带该段音频的准确转写文本；上传或复刻流程由供应商处理。 */
  audios?: (MediaInput & { text?: string })[];
  /** 音频创作参考图；数量以及能否与参考音频同传，由供应商按模型校验。 */
  images?: MediaInput[];
  /** 系统或已复刻的音色标识，由供应商映射到平台的音色参数。 */
  voice?: string;
  /** 语速倍率，1 为正常语速；供应商负责转换平台的语速刻度。 */
  speed?: number;
  /** 音量增益，单位 dB，0 为原始音量；供应商负责转换平台的音量刻度。 */
  volume?: number;
  /** 抽象层以半音表示音调偏移，0 为原音调；供应商负责映射平台刻度并校验支持范围。 */
  pitch?: number;
  /** 情绪，如 happy、sad、angry；由供应商映射并校验模型及音色是否支持。 */
  emotion?: string;
  /** 合成语言或方言，如 zh-CN、en、yue；由供应商映射，缺省沿用模型默认行为。 */
  language?: string;
  /** 是否规范化数字等文本的读法；支持语种与处理规则由供应商按模型校验。 */
  normalizeText?: boolean;
  /** 输出编码格式，如 mp3、wav、pcm、flac、opus；由供应商映射平台的格式名称。 */
  format?: string;
  /** 输出采样率，单位 Hz。 */
  sampleRate?: number;
  /** 输出编码码率，单位 kbps；仅适用于支持配置码率的格式，由供应商转换平台单位。 */
  bitrateKbps?: number;
} & ({ text: string } | { prompt: string });

/**
 * 三种生成函数统一返回最终媒体数组，不能返回任务 ID 或原始平台响应。
 * ACT: 本层只约定完整结果；供应商内部处理轮询/流读取，失败时抛出异常。
 */
type GenerateMedia<TRequest, TConfig = Record<string, unknown>> = (
  this: ProviderContext<TConfig>,
  request: TRequest,
) => Promise<MediaAsset[]>;

interface ProviderUpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  notice: string;
}

interface ProviderDefinition<TRules extends readonly ProviderFormRule[] = readonly ProviderFormRule[]> {
  id: string;
  label: string;
  /** 供应商品牌图标，支持图片 URL 或 data:image/...;base64,...。 */
  icon?: string;
  /** 适配文件版本，独立于模型版本；新增供应商应填写，缺省仅兼容旧文件。 */
  version?: string;
  apiUrl?: string;
  /**
   * 媒体模型列表 GET 地址，使用配置的 apiKey 作为 Bearer 凭据，返回 { data: 模型数组 }。
   * 模型须含 id，type 可由 URL 的 type 参数或同名已有模型补全。
   * 可选 modelInfo 对象提供模型能力（如 mode、audio、durationResolutionMap、imageSizes、imageRatios），获取时合并至模型顶层。
   * 提供此字段后可手动获取；TF-Router 手动获取图片、视频、音频，并在有 key 的程序启动时自动更新。
   */
  modelsUrl?: string;
  protocol?: "openai-completions" | "openai-responses" | "anthropic-messages";
  /** 厂商说明的 Markdown 内容。 */
  readme?: string;
  rules: TRules;
  models: ProviderModel[];
  /** 检查供应商适配文件是否有更新。 */
  checkForUpdates?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<ProviderUpdateInfo>;
  /** 获取更新文件的完整源码；写入与应用由宿主负责。 */
  updateVendor?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<string>;
  /**
   * 只读估价，不创建生成任务或扣费。request.type 区分图片、视频和音频。
   * 参考素材只传元信息，不传文件内容或地址；其余参数与对应生成请求一致。
   * 返回 { price, tips }，由供应商自由提供价格展示文本与提示；null 表示当前参数无法估价，节点保留占位。
   */
  getPrice?: (this: ProviderContext<ProviderConfig<TRules>>, request: ProviderPriceRequest) => Promise<ProviderPrice | null>;
  /** 查询当前配置账户的余额；计价单位由供应商返回。 */
  getBalance?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<ProviderBalance>;
  /** 未实现的方法保持缺省，调用方据此判断能力是否可用。 */
  generateImage?: GenerateMedia<ImageRequest, ProviderConfig<TRules>>;
  generateVideo?: GenerateMedia<VideoRequest, ProviderConfig<TRules>>;
  generateAudio?: GenerateMedia<AudioRequest, ProviderConfig<TRules>>;
  /** 可选的供应商媒体预处理；未实现时保持原请求。 */
  processMedia?: (this: ProviderContext<ProviderConfig<TRules>>, request: ImageRequest | VideoRequest | AudioRequest) => Promise<ImageRequest | VideoRequest | AudioRequest>;
  /**
   * 释放引擎驻留在显存/内存中的视频模型（本机 GPU 供应商能力）；
   * released=false 属正常状态（引擎空闲无驻留、或正在生成），reason 说明原因（如 nothing_held）。
   */
  releaseGpu?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<{ released: boolean; reason?: string }>;
  /**
   * 提交前预检（本机引擎供应商能力）：返回该请求在本机的分块计划与实际几何。
   * chainPlan.blocks 给出每块秒数/帧数（partPrompts 的条数必须等于 blocks.length）；
   * 校验失败时抛错并带引擎原文。
   */
  planVideo?: (this: ProviderContext<ProviderConfig<TRules>>, request: VideoRequest) => Promise<{
    geometry: { width: number; height: number; seconds: number; frames: number; fps: number };
    chainPlan: { seconds: number; single: boolean; blocks: { seconds: number; frames: number }[] };
    warnings: string[];
  }>;
  /**
   * 本机视觉模型问答（引擎 kind=vlm，走 /jobs 排队、与视频共 GPU 但引擎自动错峰）：
   * 对图片/视频（引擎自动采样帧）提问，answers 与 questions 一一对应。
   * 素材用宿主 MediaInput，由供应商上传换成引擎内部路径；单题最多 16 图、全任务图+视频帧 ≤24（引擎限制）。
   */
  askVlm?: (this: ProviderContext<ProviderConfig<TRules>>, input: {
    questions: (string | { text: string; images?: MediaInput[]; video?: MediaInput })[];
    system?: string;
    format?: "text" | "json";
    label?: string;
  }) => Promise<{ answers: unknown[] }>;
  /**
   * 白模（3D blocking）能力（本机引擎供应商）：
   * - `getWhiteboxPrompt()` 取引擎权威的场景代码生成规范（guide.whitebox_scene_prompt，含 {SHOT} 占位）；
   * - `createWhitebox(code, summary)` 提交一段 `build(THREE)` 场景代码，返回待渲染的任务号；
   * - `getWhitebox(id)` 读进度：waiting/rendering/ready（带 work 作品号、seconds、earlyRatio、earlySteps）/failed（带 error）。
   * 白模渲染在用户打开的 FreeVideo 页面里跑，页面没开 createWhitebox 抛 page_required。
   */
  whitebox?: {
    available: boolean;
    getPrompt(this: ProviderContext<ProviderConfig<TRules>>): Promise<string>;
    create(this: ProviderContext<ProviderConfig<TRules>>, code: string, summary: string): Promise<{ id: string; status: string }>;
    get(this: ProviderContext<ProviderConfig<TRules>>, id: string): Promise<{ id: string; status: string; work?: string; seconds?: number; earlySteps?: number; earlyRatio?: number; error?: string }>;
  };
  /** 读取引擎能力档案（已装 LoRA / triggerWords / limits / quality）。 */
  engineProfile?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<EngineProfile>;
  /**
   * 引擎配乐（kind=music，走 /projects/{id}/music 作曲并铺到音轨 a2 第 0 帧，产物长度=时间线长度）：
   * 取最新 revision 提交；a2 已有音乐时先 remove 旧轨（audio_full 引擎会拒）。
   * 成功返回下载好的音频（aac/48k/2ch）与产物元信息（jobId、frames、seed、source）。
   */
  music?: (this: ProviderContext<ProviderConfig<TRules>>, request: MusicRequest) => Promise<{
    mediaType: "audio";
    type: "binary";
    data: Uint8Array;
    mimeType: string;
    jobId: string;
    frames: number;
    seed: number;
    source: string;
  }>;
}

/** 引擎配乐请求：caption 英文 ≤512（流派/乐器/速度/情绪/随影片变化，无演唱），其余可选。 */
interface MusicRequest {
  /** 引擎编辑工程 id（`e-` + 32 位十六进制，GET /projects/{id} 可查）。 */
  editorProjectId: string;
  /** 工程 revision（必须先读最新，否则 409 project_changed）。 */
  revision: number;
  /** 作曲描述：英文、≤512，必填。 */
  caption: string;
  /** 随机种子（0..2^32-1）；同 seed + 同 caption = 同曲。 */
  seed?: number;
  /** 人声帧区间（这些帧配乐更低沉，让位给对白），最多 500 段。 */
  quiet?: { start: number; frames: number }[];
  /**
   * 成片视频（可选）：把成片按 /imports 导入并插入 v1 轨第 0 帧，让配乐工程时间线长度等于成片长度。
   * 仅在配乐工程时间线还没有与成片等长时使用；引擎要求时间线 10–600s（240–14400 帧 @24fps）。
   */
  sourceVideo?: MediaInput;
}

/** 仅用于展示，不参与余额计算；没有额外提示时 tips 返回空字符串。 */
interface ProviderPrice {
  price: string;
  tips: string;
}

/** 估价专用素材元信息；不包含 base64、二进制、URL 或本地路径。未知字段省略，不能视作 0。 */
interface ProviderPriceReference {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  /** 参考视频或音频的时长，单位秒；不是输出时长。 */
  duration?: number;
  frameRate?: number;
}

/** 按实际参考素材的类别、数量和元信息计价；mode 仅描述生成模式，不能代替实际参考内容。 */
type ProviderPriceRequest =
  | ({ type: "image"; images?: ProviderPriceReference[]; mask?: ProviderPriceReference } & Omit<ImageRequest, "images" | "mask">)
  | ({ type: "video"; images?: ProviderPriceReference[]; videos?: ProviderPriceReference[]; audios?: ProviderPriceReference[]; firstFrame?: ProviderPriceReference; lastFrame?: ProviderPriceReference } & Omit<VideoRequest, "images" | "videos" | "audios" | "firstFrame" | "lastFrame">)
  | ({ type: "audio"; images?: ProviderPriceReference[]; audios?: (ProviderPriceReference & { text?: string })[] } & Omit<AudioRequest, "images" | "audios">);

interface ProviderBalance {
  balance: number;
  unit: string;
  /** null 表示密钥额度无限制；缺省表示供应商不提供独立密钥额度。 */
  keyBalance?: number | null;
  totalConsumption?: number;
  totalRecharge?: number;
}
