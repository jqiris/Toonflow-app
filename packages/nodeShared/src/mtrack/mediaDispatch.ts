/**
 * 多轨直连生成：把一镜的参数、参考与提示词组装成**一份请求**，经服务端媒体生成通道直接下发，
 * 不再为每镜新建画布视频生成节点。
 *
 * 与 LSC（LocalStoryCanvas）的对齐点：LSC 的 `video-timeline.js` 把 timeline[]（frames + prompt + follow_previous）
 * 作为请求体交给本地引擎，参考素材随请求提交；这里用同一条思路，走 Toonflow 已有的
 * `POST /api/ai/media/generate`（`apps/server/src/routes/ai/media/generate.ts`）——
 * 它接收 `images[]`（工作区相对路径），调用 `u.mediaGeneration.generateMedia`，全程不需要画布节点。
 *
 * 画布只提供参考素材的**路径**（资产节点 outputs），不参与生成；提示词里的 `<Picture N>` /
 * `<Video N>` / `<Audio N>` 由创作层按媒质独立书写，编号只表示该类别内的次序，不编码类别之间的配对关系。
 */

import { resolveReferenceSources, type CanvasCall } from "./directDispatch";
import { resolveClipMode, videoQualityValues, type AssetIndexCard, type MtrackClip } from "./mtrackProject";

/** 一镜的组装结果：可以直接作为 /api/ai/media/generate 的请求体。 */
export type ClipGenerationRequest = {
  clipId: string;
  providerId: string;
  modelId: string;
  prompt: string;
  images: { path: string; mimeType: string }[];
  audios: { path: string; mimeType: string }[];
  videos: { path: string; mimeType: string }[];
  /** 首帧（mode=image 且只有一张图时下发）：引擎按首帧起拍，这张图不再重复进 references。 */
  firstFrame?: { path: string; mimeType: string };
  /**
   * 续接上一镜：上一镜成功生成的供应商任务号（`j` + 12 hex）。
   * 由引擎自己加载该任务的原生音视频上下文继续生成，与多参考图**并存**
   * （FreeVideo 只要求此时 first/last 留空，references 照常生效，上限 3 张）。
   */
  continueFrom?: string;
  ratio: string;
  resolution: string;
  duration: number;
  generateAudio: boolean;
  /** 质量档位（light/medium/high/max）；省略走供应商默认 light。 */
  quality?: string;
  /** 二次采样（two_pass）；省略走供应商默认开启。 */
  secondPass?: boolean;
  /** 先出预览（preview）；省略走供应商默认关闭。 */
  preview?: boolean;
  /** 随机种子；省略即不下发，由引擎自定。重 roll 保种子用于跨重试复现。 */
  seed?: number;
  /** 本任务完成后立即释放显存；批次派工只给最后一镜置 true。 */
  releaseGpuAfter?: boolean;
  mode: unknown;
  outputDirectory: string;
  /** 参考位次 → 素材来源，仅用于回执与排错。 */
  referenceMap: { index: number; ref: string; cardId: string; kind: string; path: string; nodeId: string }[];
  /** 本镜承接的是哪一镜（continuity === "context"），供调用方回报。 */
  continuedFrom?: string;
};

/** 参考模式槽位声明：服务端 zod 接受 referenceMode 数组，形如 `imageReference:4`（数量 1–256）。 */
const referenceModeSlots = ["imageReference:4", "videoReference:1", "audioReference:1"];

const imageMime = /\.(png|jpe?g|webp|gif|bmp)$/i;
const audioMime = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;
const videoMime = /\.(mp4|webm|mov|mkv)$/i;

const mimeByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

/**
 * ACT: 旧实现对 jpg/webp 一律报 image/png、wav/flac 一律报 audio/mpeg，供应商按错类型收素材；
 * 改为按扩展名查表，未知扩展名才用调用方兜底。
 */
function mimeOf(path: string, fallback: string) {
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(path)?.[1]?.toLowerCase() ?? "";
  return mimeByExtension[ext] ?? fallback;
}

/**
 * H3 的参考标记是 `<Picture N>` / `<Video N>` / `<Audio N>`，按参考的 dataType **各自编号**，
 * 编号 = referenceIds 里同媒质的过滤位次（referenceIds 的顺序即参考数组顺序）。
 * 只供回执与排错（referenceMap）和越界检查用：同一来源节点重复出现时沿用第一个编号；
 * 提示词里写死的标记不做任何换算。
 */
export function referenceTags(entries: readonly { dataType: string; source: string }[]) {
  const tags = new Map<number, string>();
  const assigned = new Map<string, string>();
  let picture = 0;
  let video = 0;
  let audio = 0;
  entries.forEach((item, index) => {
    const known = assigned.get(item.source);
    if (known) {
      tags.set(index + 1, known);
      return;
    }
    const tag = item.dataType === "IMAGE" ? `<Picture ${++picture}>`
      : item.dataType === "VIDEO" ? `<Video ${++video}>`
        : item.dataType === "AUDIO" ? `<Audio ${++audio}>`
          : undefined;
    if (!tag) return;
    assigned.set(item.source, tag);
    tags.set(index + 1, tag);
  });
  return tags;
}

/** 首帧模式（I2VA）的首行指令：逐字照抄 base-en.txt，首帧必为 `<Picture 1>`。 */
export const firstFrameInstruction = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

/**
 * 派工下发的唯一拼装点：六段提示词拼装 + 首帧首行指令注入。
 * 段名与顺序逐字对齐 ref-en.txt：subject_definitions / summary / retention_analysis /
 * detailed_description / overall_soundscape / non_diegetic_music；空段整段省略（段名也不输出），
 * 段名由这里补，与 mtrackProject.promptToText 合成的段名严格同形。
 * ACT: 无参考时退化——丢掉三个分析段，只留 detailed_description / overall_soundscape /
 * non_diegetic_music（t1 契约的有意偏离：主字段用 detailed_description，不用 integrated_multimodal_description）。
 * 退化判定由调用方传 degraded，与 referenceEntries 同口径（mode=image 摘掉首帧图后无剩余参考也退化）。
 */
export function buildPromptText(clip: MtrackClip, degraded = false, withFirstFrame = false) {
  const prompt = clip.prompt;
  const sections = [
    prompt.subjectDefinitions.trim() && `subject_definitions: ${prompt.subjectDefinitions.trim()}`,
    prompt.summary.trim() && `summary: ${prompt.summary.trim()}`,
    prompt.retentionAnalysis.trim() && `retention_analysis: ${prompt.retentionAnalysis.trim()}`,
    prompt.detailedDescription.trim() && `detailed_description: ${prompt.detailedDescription.trim()}`,
    prompt.overallSoundscape.trim() && `overall_soundscape: ${prompt.overallSoundscape.trim()}`,
    prompt.nonDiegeticMusic.trim() && `non_diegetic_music: ${prompt.nonDiegeticMusic.trim()}`,
  ].filter(Boolean);
  const kept = degraded
    ? sections.filter(section => /^(detailed_description|overall_soundscape|non_diegetic_music):/.test(section))
    : sections;
  const body = kept.join("\n\n");
  if (!body) return "";
  return withFirstFrame ? `${firstFrameInstruction}\n\n${body}` : body;
}

/**
 * 把一镜组装成可直接下发的请求：参考素材从画布资产节点取工作区路径，顺序严格按 `referenceIds`，
 * 提示词里的 `<Picture N>` / `<Video N>` / `<Audio N>` 保持原样下发（各媒质独立编号，不做换算），
 * 只校验越界：各媒质编号不能超过本镜同媒质的参考数。
 * 缺少任一参考的可用产出时报错（与旧派工同一口径：不带着缺失参考上场）。
 */
export async function composeClipRequest(options: {
  call: CanvasCall;
  clip: MtrackClip;
  cards: readonly AssetIndexCard[];
  videoModel: { providerId: string; modelId: string };
  global?: { style?: string; systemPrompt?: string };
  signal: AbortSignal;
  /**
   * 续接钩子：仅在 `continuity === "context"` 且上一镜有成片时调用，
   * 由调用方解析「上一镜那一镜」并给出它的供应商任务号。
   * ACT: 任务号存在 attempts 里（成功那次才有），要靠调用方按分镜号回溯，所以通过钩子注入。
   */
  resolveContinueFrom?: (previous: MtrackClip) => { jobId: string } | undefined;
  /** 上一镜（按分镜顺序的前一条），由调用方按当前工程顺序提供。 */
  previousClip?: MtrackClip;
}): Promise<ClipGenerationRequest> {
  const { call, clip, cards, videoModel, global, signal, resolveContinueFrom, previousClip } = options;
  const resolvedMode = resolveClipMode(clip);
  /*
   * ACT: text 模式是纯文生，参考一律不下发——连「参考图未就绪」都不该拦。
   * 否则用户在纯文本镜上残留勾选了没出图的卡，会被一句「参考图未就绪」顶回来，
   * 与 referencePicker 的 modeHint 声明矛盾（审计 t21-F1）。
   */
  const { picked, missing } = resolvedMode === "text"
    ? { picked: [] as Awaited<ReturnType<typeof resolveReferenceSources>>["picked"], missing: [] as string[] }
    : await resolveReferenceSources({ call, clip, cards, signal });
  if (missing.length) {
    throw new Error(`参考图未就绪：${missing.join("、")} 在画布上没有可用产出（需要已装配资产节点且已出图），请先补齐再生成`);
  }
  const references = resolvedMode === "text" ? [] : clip.referenceIds.map(cardId => {
    const source = picked.find(item => item.cardId === cardId);
    if (!source) throw new Error(`参考 ${cardId} 无法确定画布来源`);
    const card = cards.find(item => item.id === cardId);
    return { cardId, kind: card?.kind ?? "", nodeId: source.nodeId, path: source.path };
  });
  // 数据来源依次：卡片 kind（sound 就是音频），其次产物扩展名是音频/视频/图片。
  const entries = references.map(reference => {
    const dataType = reference.kind === "sound" ? "AUDIO"
      : videoMime.test(reference.path) ? "VIDEO"
        : audioMime.test(reference.path) ? "AUDIO" : "IMAGE";
    return { ...reference, dataType };
  });
  /*
   * 首帧模式（mode=image）：单图且用户选了「首帧」时，这张图作为 `firstFrame` 下发
   * （与 videoGenerationNode:264-265 同口径），不再重复塞进 references——同一张图既 first 又 ref
   * 会被引擎当两份媒体。续接镜强制 ref：引擎续接只允许 references，first/last 必须留空。
   */
  const imageEntries = entries.filter(item => item.dataType === "IMAGE");
  const firstFrameEntry = resolvedMode === "image" && clip.continuity !== "context" && imageEntries.length === 1 ? imageEntries[0] : undefined;
  /*
   * ACT: text 模式是纯文生，参考素材一律不下发——否则选择框里勾着的图会静默变成 ref2va，
   * 与 referencePicker 的 modeHint「text 模式不会发送参考图」矛盾（审计 P2）。提示词里的参考标记也一并失效。
   */
  const referenceEntries = resolvedMode === "text" ? [] : firstFrameEntry ? entries.filter(item => item !== firstFrameEntry) : entries;
  /*
   * ACT: 编号基准必须是 `clip.referenceIds` 的**位次**（就是 entries 的下标），不能是 referenceEntries 的下标：
   * mode=image 且恰一张图时那张图已被摘去作首帧，按摘除后的下标编号会让 `<Picture 1>` 的基准错位，
   * 而校验器 V7 的基准同样是 referenceIds。首帧也占它自己的位次，referenceMap 里照记它。
   */
  const tags = referenceTags(entries.map(item => ({ dataType: item.dataType, source: item.nodeId })));
  const imageList = referenceEntries.filter(item => item.dataType === "IMAGE");
  const audioList = referenceEntries.filter(item => item.dataType === "AUDIO");
  const videoList = referenceEntries.filter(item => item.dataType === "VIDEO");
  // ACT: 首帧镜的图片参考数按 entries 口径（首帧那张图也占自己的 <Picture 1> 位次），其余媒质按下发集合算。
  const pictureLimit = firstFrameEntry ? imageEntries.length : imageList.length;
  const body = buildPromptText(clip, !referenceEntries.length, Boolean(firstFrameEntry));
  /*
   * ACT: 提示词里的标记只有 `<Picture N>` / `<Video N>` / `<Audio N>` 一种合法形态（H3 官方口径），
   * 各媒质独立编号，编号只表示该媒质在参考里的位次——所以越界按媒质分组检查：
   * `<Picture N>` ≤ 本镜图片参考数、`<Video N>` ≤ 视频参考数、`<Audio N>` ≤ 音频参考数。
   * 旧的双花括号 ref 占位符没有换算层可走，一律直接报错。
   */
  const legacyMarker = String.fromCharCode(123, 123) + "\\s*ref\\s*(\\d+)\\s*" + String.fromCharCode(125, 125);
  for (const matched of body.matchAll(new RegExp(legacyMarker, "gi"))) {
    const marker = String.fromCharCode(123, 123) + "ref " + Number(matched[1]) + String.fromCharCode(125, 125);
    throw new Error(`${clip.clipId} 的提示词含旧版双花括号占位符 ${marker}，不是 H3 合法的参考标记：请改用 <Picture N> / <Video N> / <Audio N>（各媒质独立编号）`);
  }
  for (const matched of body.matchAll(/<\s*(Picture|Video|Audio)\s+(\d+)\s*>/gi)) {
    const kind = matched[1].toLowerCase() as "picture" | "video" | "audio";
    const limit = kind === "picture" ? pictureLimit : kind === "video" ? videoList.length : audioList.length;
    if (Number(matched[2]) > limit) {
      throw new Error(`${clip.clipId} 的提示词含 <${matched[1]} ${Number(matched[2])}> 超出范围：本镜该媒质参考共 ${limit} 项，请改正参考标记或补齐参考`);
    }
  }
  // ACT: 提示词为空时服务端 zod 只回 400「参数错误」，编辑器无从解释；在派工前就拦下并说清是哪个字段。
  if (!body.trim()) throw new Error(`${clip.clipId} 的提示词为空（画面正文/环境声/配乐都没填），请先补提示词再生成`);

  /*
   * 续接（continuity === "context"）：与 LSC 多轨编辑器同一语义——由引擎加载上一镜的原生上下文继续生成。
   * 取上一镜的供应商任务号交给 `continue_from`，**不占用媒体槽**，所以多参考图照常下发。
   * 三条硬约束（FreeVideo agent 契约）：
   *   1. 续接时只允许 media.references，first/last 必须留空；
   *   2. 参考图上限 3 张（引擎 guide：at most 3 pictures）；
   *   3. 续接任务是 two-pass，provider 已固定 quality: light（本就是 two-pass）。
   * 上一镜没有可用任务号时直接报错，绝不静默降级成独立起镜——那会让「承接」变成假承接。
   */
  let continueFrom: string | undefined;
  let continuedFrom: string | undefined;
  if (clip.continuity === "context") {
    if (!previousClip) throw new Error(`${clip.clipId} 是首镜，衔接方式不能是「承接上一镜」，请改为独立起拍`);
    const resolved = resolveContinueFrom?.(previousClip);
    if (!resolved?.jobId) {
      throw new Error(`${clip.clipId} 要承接 ${previousClip.clipId}，但上一镜没有可用的生成任务号（可能还没生成成功，或那次尝试未记录任务号）。请先生成 ${previousClip.clipId}，或把本镜改为独立起拍`);
    }
    continueFrom = resolved.jobId;
    continuedFrom = previousClip.clipId;
    // ACT: provider 的续接上限按 references 总数算（图片+视频+音频都在同一个数组里），
    // 这里必须同口径，否则「2 图 + 2 视频」能过本地校验却在 provider 侧被拒。
    if (entries.length > 3) {
      throw new Error(`${clip.clipId} 承接 ${previousClip.clipId} 时最多 3 个参考素材（引擎限制，图片/视频/音频合计），当前 ${entries.length} 个。请减少参考，或把本镜改为独立起拍`);
    }
  }
  /*
   * ACT: 续接槽位以前固定声明 `imageReference:4`，0 参考时会声明 4 图 1 视频 1 音频却什么都不带（审计 P1-4）。
   * 现在按实际下发的媒体组装；一个参考都没有时退回裸串 "text"，声明与内容一致。
   */
  const continueSlots = continueFrom
    ? [
      ...(imageList.length ? [`imageReference:${imageList.length}`] : []),
      ...(videoList.length ? [`videoReference:${videoList.length}`] : []),
      ...(audioList.length ? [`audioReference:${audioList.length}`] : []),
    ]
    : [];
  /*
   * ACT: 质量/二次采样/先出预览是引擎真实支持的请求参数（light=8 首轮 + 3 refine 两遍、medium 同两遍，
   * high/max=20 步单遍；preview 固定 8 步两遍、成片需另发 refine_from），默认值与 freevideo provider 侧一致，
   * 不传即走供应商默认。三条引擎硬约束在这里提前拦下（与提示词/续接同口径，不让用户等批跑到一半才失败）：
   *   1. 质量只认四档；
   *   2. 续接镜必须 preview=false、secondPass=true、质量只能 light/medium（续接任务是 two-pass）；
   *   3. 预览只支持单个 30 秒以内的独立镜头。
   */
  if (!videoQualityValues.includes(clip.quality)) {
    throw new Error(`${clip.clipId} 的质量档位 ${clip.quality} 无效：可选轻量/标准/精细/极致（light/medium/high/max）`);
  }
  if (continueFrom) {
    if (clip.preview) {
      throw new Error(`${clip.clipId} 承接 ${previousClip?.clipId ?? "上一镜"} 时不能开预览（引擎限制：预览只支持单个 30 秒以内的独立镜头），请关闭先出预览`);
    }
    if (!clip.secondPass) {
      throw new Error(`${clip.clipId} 承接 ${previousClip?.clipId ?? "上一镜"} 时必须开启二次采样（引擎限制：续接任务必须是 two-pass），请开启二次采样`);
    }
    if (clip.quality !== "light" && clip.quality !== "medium") {
      throw new Error(`${clip.clipId} 承接 ${previousClip?.clipId ?? "上一镜"} 时只能用轻量/标准质量（引擎限制：续接任务必须是 two-pass），请改为轻量或标准`);
    }
  }
  if (clip.preview && clip.seconds >= 30) {
    throw new Error(`${clip.clipId} 时长 ${clip.seconds} 秒，超出预览上限 30 秒（引擎限制：预览只支持单个 30 秒以内的分块），请关闭先出预览`);
  }
  return {
    clipId: clip.clipId,
    providerId: videoModel.providerId,
    modelId: videoModel.modelId,
    prompt: body,
    images: imageList.map(item => ({ path: item.path, mimeType: mimeOf(item.path, "image/png") })),
    audios: audioList.map(item => ({ path: item.path, mimeType: mimeOf(item.path, "audio/mpeg") })),
    videos: videoList.map(item => ({ path: item.path, mimeType: mimeOf(item.path, "video/mp4") })),
    ...(firstFrameEntry ? { firstFrame: { path: firstFrameEntry.path, mimeType: mimeOf(firstFrameEntry.path, "image/png") } } : {}),
    ...(continueFrom ? { continueFrom } : {}),
    ...(continuedFrom ? { continuedFrom } : {}),
    ratio: clip.ratio,
    resolution: clip.resolution,
    duration: clip.seconds,
    generateAudio: clip.generateAudio,
    quality: clip.quality,
    secondPass: clip.secondPass,
    preview: clip.preview,
    ...(clip.seed !== undefined ? { seed: clip.seed } : {}),
    /*
     * 生成模式按 LSC 的 task_mode 判定（`ref` / `image` / `text`），不再只看参考数量：
     *  - `image`：单图首帧，仅一张图；时长按 startFrameOptional 走；
     *  - `ref`：多模态参考（多图/视频/音频），H3 ref2va；
     *  - `text`：无参考纯文生。
     * ACT: `image` 模式与续接互斥（引擎 first 与 references 互斥，且 LSC 也拒绝
     * 「用另一张首帧重置动作」），所以续接镜强制走 ref。
     */
    /*
     * ACT: 服务端 videoGenerationSchema 只认两种形态——裸枚举串（text/startFrameOptional/…）
     * 或 referenceMode 数组（形如 `imageReference:4`）。早期这里把 "text" / "startFrameOptional"
     * 也包成数组，被 zod 直接 400（"纯文本/首帧"两类镜一点生成就失败），故拆成裸串。
     */
    // ACT: 顺序不能换——首帧图在上面已从 referenceEntries 摘掉，先判长度会让首帧镜落到 "text"（审计 P0-1）。
    // ACT: 续接镜一个参考都没有时槽位数组为空，而 zod 的数组分支要求 .min(1)，退回裸串 "text"。
    mode: continueFrom ? (continueSlots.length ? continueSlots : "text")
      : firstFrameEntry ? "startFrameOptional"
        : resolvedMode === "text" || !referenceEntries.length ? "text"
          : referenceModeSlots,
    outputDirectory: `assets/${clip.clipId}`,
    referenceMap: entries.map((item, index) => ({
      index: index + 1,
      ref: tags.get(index + 1) ?? "",
      cardId: item.cardId,
      kind: item.kind,
      path: item.path,
      nodeId: item.nodeId,
    })),
  };
}
