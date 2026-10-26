import { z, type WorkspaceFiles, type useNodeAi } from "@toonflow/nodes-scaffold/runtime";
import {
  assetIndexPath,
  createClip,
  defaultProjectPath,
  normalizeProject,
  ratioOptions,
  textToPrompt,
  type AssetIndex,
  type AssetIndexCard,
  type MtrackProject,
} from "@toonflow/node-shared/mtrack/mtrackProject";

export type AssetImportAi = ReturnType<typeof useNodeAi>;
export type AssetImportModel = { providerId: string; modelId: string };
export type AssetKind = "character" | "scene" | "prop" | "sound";

export type ExtractedAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  prompt: string;
  negativePrompt?: string;
  ratio?: string;
  textOnly?: boolean;
  /** 基卡引用（衍生卡指向基础卡）：出图时把基卡的本次成图作参考图，并在画布上自动连基卡→本卡的线。 */
  refs?: string[];
};

export type ExtractedShot = {
  title: string;
  seconds: number;
  prompt: string;
  referenceIds: string[];
  mode?: "ref" | "image" | "text";
  continuity?: "shot" | "context";
};

/** node:importScript 的 clips 覆盖：按 clipId 覆盖单个分镜，没列出的分镜保持抽取结果。 */
export type AssetImportClipOverride = {
  clipId: string;
  prompt: string;
  seconds?: number;
  referenceIds?: string[];
  /** true=承接上一镜（context），false=独立起拍（shot）；也允许直接写引擎取值 "shot"/"context"。 */
  continuity?: boolean | "shot" | "context";
};

export type AssetExtraction = {
  style: string;
  systemPrompt: string;
  assets: ExtractedAsset[];
  shots: ExtractedShot[];
};

export type AssetImportSummary = {
  cards: number;
  shots: number;
  images: number;
  /** 出图失败的资产：单张失败不再中断整条导入，这些卡在索引里的 nodeId 仍为 null，人工补一张即可。 */
  failed: { id: string; reason: string }[];
  /** 没有中断导入、但工程已经不满足引擎口径的地方（参考超上限、参考未出图被移除、承接镜时长不足）。 */
  warnings: string[];
  indexPath: string;
  projectPath: string;
};

/** 导入进度：phase=extract/images/write，done/total 只在出图阶段有意义（面板与 node:importStatus 共用）。 */
export type AssetImportProgress = {
  phase: "extract" | "images" | "write";
  done: number;
  total: number;
  assetId?: string;
};

export const kindLabels: Record<AssetKind, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
  sound: "声音",
};

/** 引擎单镜图片参考上限（planValidator.ts 的 MAX_IMAGE_REFERENCES）：超出会让导入出的工程一打开校验就报错。 */
const maxImageReferences = 9;
/** 承接镜（context）的图片参考上限（planValidator V16 的引擎 continue_from 契约）：与独立镜的 9 张更紧。 */
const maxContextReferences = 3;
/** 资产出图链路的基卡参考上限：与 freevideo-image 的参考图上限同口径（providers/src/media/freevideo.ts 的 maxImageReferences = 4）。 */
const maxAssetImageReferences = 4;

/** 声音卡强制只文字：模型显式写 textOnly:false 也不拿它出图（S 类资产只出现在提示词正文里）。 */
export function isTextOnlyAsset(asset: Pick<ExtractedAsset, "kind" | "textOnly">): boolean {
  return asset.kind === "sound" ? true : asset.textOnly ?? false;
}

/** 卡没给画幅时的默认值：与抽取提示词同口径（人物四视图整版/场景空镜 16:9，道具 1:1）。 */
const assetRatioDefaults: Record<AssetKind, string> = { character: "16:9", scene: "16:9", prop: "1:1", sound: "16:9" };

const ratioShape = /^[1-9]\d{0,3}:[1-9]\d{0,3}$/;

/**
 * 卡画幅归一：形状非法（空串/中文）会让该卡单张失败并抛英语 zod 文案，按 kind 回落；
 * 形状合法但不是该 kind 标准档位（人物四视图整版/场景空镜 16:9、道具 1:1）的也归一到标准档并回一句告警——
 * 否则「C 卡 16:9 四视图整版」的版式口径会被 2:3/9:16 静默破坏（抽取提示词与 assetCardTemplate 都用 16:9）。
 */
function pickAssetRatio(ratio: string | undefined, kind: AssetKind): { ratio: string; warning?: string } {
  const standard = assetRatioDefaults[kind];
  const value = ratio?.trim() ?? "";
  if (!ratioShape.test(value)) return { ratio: standard };
  if (value === standard) return { ratio: value };
  return { ratio: standard, warning: `画幅 ${value} 不是${kindLabels[kind]}卡的标准档位 ${standard}，已归一到 ${standard}` };
}

/** 导入档位的秒数区间：抽取提示词要求 2–15 的整数，引擎校验 V12 实际允许 2–60（mtrackProject 对秒数没有约束）。 */
const minClipSeconds = 2;
const maxClipSeconds = 15;
const engineMaxClipSeconds = 60;

/** 秒数清洗：四舍五入到整数秒，并按导入档位收紧。 */
function sanitizeSeconds(value: number): number {
  return Math.min(maxClipSeconds, Math.max(minClipSeconds, Math.round(value)));
}

/** 秒数被改写时的告警：档位收紧与取整都不能静默——V12 只收 2–60 的整数秒，10.5/90 直接落盘会让工程一打开就报错。 */
function secondsWarning(clipId: string, requested: number, applied: number): string | undefined {
  if (requested === applied) return undefined;
  if (!Number.isInteger(requested)) return `${clipId} 的 ${requested} 秒不是整数秒，已四舍五入为 ${applied} 秒`;
  if (requested > maxClipSeconds) return `${clipId} 的 ${requested} 秒超过导入档位上限 ${maxClipSeconds} 秒，已收到 ${applied} 秒（引擎校验允许 2–${engineMaxClipSeconds} 秒，需要更长请导入后在多轨工程里改）`;
  return `${clipId} 的 ${requested} 秒低于导入档位下限 ${minClipSeconds} 秒，已抬到 ${applied} 秒`;
}

/** clips 覆盖的衔接方式：布尔当「是否承接上一镜」。 */
function pickContinuity(value: boolean | "shot" | "context"): "shot" | "context" {
  return typeof value === "boolean" ? (value ? "context" : "shot") : value;
}

/** 抽取结果的衔接默认（与 planValidator V16 同口径）：上一镜存在 + 本镜 ≥10 秒 + 参考 ≤3 → 能承接就承接。 */
function defaultContinuity(index: number, seconds: number, referenceCount: number): "shot" | "context" {
  return index > 0 && seconds >= 10 && referenceCount <= 3 ? "context" : "shot";
}

/** 正文上限：单次抽取塞进一个上下文，超出就让人分段，避免悄悄截断原文。 */
const scriptLimit = 200000;

/** 抽取提示词对齐 packages/skills/assetCard/references/assetCardTemplate.md 的编号与字段口径（自有实现，不 import skills 包）。 */
const extractionSystemPrompt = `你是短剧/漫剧的资产与分镜抽取器。只输出 JSON 对象，不要解释、不要 Markdown 代码块、不要注释。

编号规则（必须遵守，同一编号全局唯一、不复用）：
- C01、C02…：人物角色卡，kind=character，默认画幅 16:9（一张四视图整版：横向等分四栏，① 半身像腰部以上 ② 正面全身 ③ 90° 侧面全身 ④ 背面全身，②③④ 共用全身比例尺、按脚底线对齐）
- SC01、SC02…：场景空镜卡，kind=scene，默认画幅 16:9，画面里不出现人
- P01、P02…：道具卡，kind=prop，默认画幅 1:1，画面里不出现手
- S01、S02…：只记录文字的声音资产，kind=sound 且 textOnly=true（不许写 false，声音卡一律不出图）；原文有台词、独白或旁白时，为每个说话人（含画外旁白）各建一张，prompt 写一句稳定的音色描述（年龄感、音高、清亮/沙哑等质感、气息、语速），此后每镜提示词里同一说话人逐字复用这句；同一角色需要不同年龄或状态的声线时另建后缀卡（如 S01-A）。
状态后缀属身份：C01-A 与 C01 是两张卡，必须各自单独列出。
原文明确出现同一角色状态变化（换装、变身、持续伤势）或同一道具状态变化（新变旧、受损）时，基础态卡与衍生态卡各自单独列出；衍生卡把基卡编号写进 refs 数组（如 "refs":["C01"]，同前缀、基卡必须列在衍生卡之前），prompt 基于基卡只改声明的状态项、其余部分逐字保留，并在散文里写明引用基卡（如「与 C01 同一张脸，换装」）；出图时本节点会以基卡的本次成图作参考图并自动连线。

输出 JSON 结构：
{"style":"全片统一风格词","systemPrompt":"全片统一约束，例如排除项：文字、水印、多余手指",
 "assets":[{"id":"C01","name":"淳于棼（青年）","kind":"character","prompt":"面向文生图的画面描述：年龄、外貌、发型、服装、气质，并写明是四视图整版（① 半身像 ② 正面全身 ③ 90° 侧面 ④ 背面全身）；场景卡写空间结构、材质、光线且强调空镜无人；道具卡写形制、材质、磨损","negativePrompt":"可选","ratio":"16:9","textOnly":false,"refs":[]},{"id":"C01-A","name":"淳于棼（换装）","kind":"character","prompt":"以参考图 1 为同一人物的身份锚点，重绘同一角色的四视图整版：面部结构、发际线与参考图 1 完全一致，仅更换服装为……","refs":["C01"]}],
 "shots":[{"title":"分镜标题","seconds":5,"prompt":"该镜提示词：原文给过就整段原样保留（六个官方段首齐全），原文没给才写一句话画面描述","referenceIds":["C01","SC01"],"mode":"ref","continuity":"shot"}]}

要求：
1. 资产只能来自原文可见信息，不臆造角色、场景或道具。
2. 分镜 prompt 的取法：原文里已经写出这一镜的视频提示词时，整段原样保留——不要改写成一句话、不要删段、不要调换段序；原文没给提示词时，才写一句话画面描述，用中文、面向文生图，写静态画面，不写运镜与音效。资产卡 prompt 一律按上面的字段口径新写。
3. 每个分镜的 referenceIds 只能引用本次 assets 里出现的 id，且只放需要画面参考的资产（角色/场景/道具）；S 类声音卡不要写进 referenceIds，它们只出现在提示词正文里；没有可用资产时留空数组。
4. shots 按原文顺序输出，seconds 取 2–15 的整数；多个分镜用同一张卡时重复引用同一 id。
5. 不要输出 KF 构图卡，只出上面四类资产卡与分镜。
6. 原文里出现的视频提示词段落（段首为 subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music 这些官方段名）就是这一镜 prompt 的正文，必须整段原样落进对应分镜的 prompt 字段，段名、顺序、换行都照抄，不要压缩、不要改写成描述句、不要丢掉任何一段。
7. continuity 能承接就承接：同一段落、同一空间里延续上一镜画面与动作时写 "context"；换场、时间跳转、需要重新构图或独立起拍，以及首镜、不足 10 秒、参考多于 3 个时写 "shot"。引擎对 context 的硬限制是至少 10 秒、参考合计最多 3 个，写错会被校验拦下。`;

/** 抽取结果的契约：模型返回与 Agent 直接传入的结构化结果共用它，不另立口径。 */
export const extractionSchema = z.object({
  style: z.string().default(""),
  systemPrompt: z.string().default(""),
  assets: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().default(""),
    kind: z.enum(["character", "scene", "prop", "sound"]).default("character"),
    prompt: z.string().default(""),
    negativePrompt: z.string().optional(),
    ratio: z.string().optional(),
    textOnly: z.boolean().optional(),
    refs: z.array(z.string().trim().min(1)).default([]).describe("基卡编号：衍生卡指向基础卡（如 C01-A 引用 C01）。出图时以基卡本次成图作参考图（≤4 张）并在画布自动连基卡→本卡的线；后缀卡没声明时回落到同前缀基卡"),
  })).min(1),
  shots: z.array(z.object({
    title: z.string().default(""),
    seconds: z.number().default(5),
    prompt: z.string().default(""),
    referenceIds: z.array(z.string()).default([]),
    mode: z.enum(["ref", "image", "text"]).optional(),
    continuity: z.enum(["shot", "context"]).optional(),
  })).default([]),
});

/** 解析模型返回：剥掉代码块围栏，取第一个完整 JSON 对象；结构不合契约一律抛出，不猜。 */
export function parseExtraction(text: string): AssetExtraction {
  const body = text.replace(/```[a-zA-Z]*/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON，无法抽取资产与分镜");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("模型返回的 JSON 解析失败，请重试或更换文本模型");
  }
  return normalizeExtraction(parsed);
}

/**
 * 契约归一：模型抽取与 Agent 传入的结构化结果走同一条路（校验、去重、秒数夹取、参考过滤），
 * 调用方是谁不影响落盘口径，所以文案不带「模型」字样。
 */
export function normalizeExtraction(parsed: unknown): AssetExtraction {
  const result = extractionSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`资产/分镜结构不符合契约：${issue?.path.join(".") || "根对象"} ${issue?.message || ""}`.trim());
  }
  const ids = new Set<string>();
  for (const asset of result.data.assets) {
    if (ids.has(asset.id)) throw new Error(`重复资产编号 ${asset.id}`);
    ids.add(asset.id);
  }
  // ACT: 基卡引用归一——去重去自引用；没声明 refs 的后缀卡（C01-A）回落到同前缀基卡（与参考接线解析规则 §四同口径）。
  // ACT: 不校验 ref 是否在本次资产里——基卡未勾选（面板按勾选裁剪后才进这里）或写错的编号要留到出图环节点名告警，静默丢掉等于假装关联不存在。
  // 声明顺序不做 backwards-only 硬拦：出图前 orderByRefs 按 refs 依赖重排，基卡列在衍生卡之后也能先出基卡再拿成图作参考。
  const baseOf = (id: string) => {
    const matched = /^(.*\d)-[A-Z]$/.exec(id);
    return matched ? matched[1] : undefined;
  };
  const assets = result.data.assets.map(asset => {
    const declared = [...new Set(asset.refs.filter(ref => ref !== asset.id))];
    const fallback = !declared.length ? baseOf(asset.id) : undefined;
    return { ...asset, textOnly: isTextOnlyAsset(asset), refs: fallback ? [fallback] : declared };
  });
  return {
    style: result.data.style,
    systemPrompt: result.data.systemPrompt,
    assets,
    // 参考只认本次抽到的资产：模型偶尔引用不存在的编号，落盘前就掐掉，避免多轨派工报「参考图未就绪」。
    shots: result.data.shots.map(shot => ({
      ...shot,
      seconds: sanitizeSeconds(shot.seconds),
      referenceIds: [...new Set(shot.referenceIds.filter(id => ids.has(id)))],
    })),
  };
}

/** 缺模型时的报错要说清另一条路怎么走，别把调用方逼回「盲选一个默认模型」。 */
function requireExtractModel(model: AssetImportModel | undefined): AssetImportModel {
  if (model) return model;
  throw new Error("未指定可用的文本模型：设置里添加文本模型后先用 node:importModels 确认编号并传 model；资产卡与分镜已定稿时改传 extraction，本节点不再调用模型");
}

export async function extractAssets(options: {
  ai: AssetImportAi;
  model: AssetImportModel;
  text: string;
  signal?: AbortSignal;
}): Promise<AssetExtraction> {
  const source = options.text.trim();
  if (!source) throw new Error("正文为空，无法抽取资产与分镜");
  if (source.length > scriptLimit) throw new Error(`正文 ${source.length} 字符超过单次抽取上限 ${scriptLimit} 字符，请分段导入`);
  const result = await options.ai.generate({
    providerId: options.model.providerId,
    modelId: options.model.modelId,
    systemPrompt: extractionSystemPrompt,
    prompt: `原文如下：\n\n${source}`,
    signal: options.signal,
  });
  return parseExtraction(result.text);
}

/**
 * 出图顺序按 refs 依赖做轻量拓扑排序（抽取模型有时把衍生卡排在基卡之前，契约要求父卡在前）：
 * 引用在本批里但还没出的排后面；引用不在本批（未勾选/文本卡）视为已满足；出现环时剩余保持原顺序。
 */
function orderByRefs(assets: ExtractedAsset[]): ExtractedAsset[] {
  const queued = [...assets];
  const ordered: ExtractedAsset[] = [];
  const done = new Set<string>();
  const pending = new Set(assets.map(asset => asset.id));
  while (queued.length) {
    const index = queued.findIndex(asset => (asset.refs ?? []).every(ref => ref === asset.id || !pending.has(ref) || done.has(ref)));
    if (index < 0) break;
    const [asset] = queued.splice(index, 1);
    ordered.push(asset);
    done.add(asset.id);
    pending.delete(asset.id);
  }
  return [...ordered, ...queued];
}

/** 出图只走图片模型的媒体通道（与图片生成节点同一条路），落盘到节点的 assets/<nodeId>。 */
export async function generateAssetImages(options: {
  ai: AssetImportAi;
  workspace: WorkspaceFiles;
  assets: ExtractedAsset[];
  model: AssetImportModel;
  directory: string;
  assetDirectory: string;
  createImageNode(item: { path: string; mimeType: string; label: string; refs?: { id: string; nodeId: string }[] }): Promise<string>;
  signal?: AbortSignal;
  onProgress?(event: AssetImportProgress): void;
}): Promise<{ nodeIds: Map<string, string>; failed: { id: string; reason: string }[]; warnings: string[] }> {
  const nodeIds = new Map<string, string>();
  /** 本次已出的成图（path+mimeType），供衍生卡作参考图复用——不重读磁盘，路径就是媒体通道刚返回的。 */
  const produced = new Map<string, { path: string; mimeType: string }>();
  const failed: { id: string; reason: string }[] = [];
  const warnings: string[] = [];
  const ordered = orderByRefs(options.assets);
  await options.workspace.mkdir("assets").catch(ignoreExisting);
  await options.workspace.mkdir(options.assetDirectory).catch(ignoreExisting);
  let done = 0;
  for (const asset of ordered) {
    options.signal?.throwIfAborted();
    // ACT: 画幅归一在被改写时留痕（C/SC 卡必须是 16:9 四视图整版/空镜，P 卡 1:1），不静默换档。
    const picked = pickAssetRatio(asset.ratio, asset.kind);
    if (picked.warning) warnings.push(`${asset.id}：${picked.warning}`);
    // ACT: 基卡关联——refs 声明的基卡若本次已出图，成图作参考图 + 画布连线（衍生卡基于基础卡出图链路的真实实现）；
    // 基卡出图失败/成环时不接线不传参考，按无参考出图并点名，与「宁可漏接、不可误接」同口径。
    const baseRefs: { id: string; nodeId: string; path: string; mimeType: string }[] = [];
    for (const ref of asset.refs ?? []) {
      const producedImage = produced.get(ref);
      const refNodeId = nodeIds.get(ref);
      if (producedImage && refNodeId) {
        baseRefs.push({ id: ref, nodeId: refNodeId, ...producedImage });
      } else {
        warnings.push(`${asset.id} 的基卡 ${ref} 没有可用成图（未勾选、出图失败或依赖成环），本卡按无参考出图`);
      }
    }
    if (baseRefs.length > maxAssetImageReferences) {
      warnings.push(`${asset.id} 的基卡参考 ${baseRefs.length} 张超过图片模型上限 ${maxAssetImageReferences}，只保留前 ${maxAssetImageReferences} 张`);
      baseRefs.length = maxAssetImageReferences;
    }
    // ACT: 单张失败不再中断整条导入——已出的图与已建的节点保留，索引里这张卡的 nodeId 留 null，
    // 失败清单回传（面板文案与 node:importStatus 都能看到），补一张的代价远小于整批重来。
    try {
      const body = asset.prompt.trim();
      if (!body) throw new Error("没有提示词，无法出图");
      const label = `${asset.id} ${asset.name}`.trim();
      const images = await options.ai.generateImage({
        directory: options.directory,
        providerId: options.model.providerId,
        modelId: options.model.modelId,
        // ACT: 引擎任务名按「分类-编号-时间戳」拼，编号从 label 取（freevideo.ts jobLabel 认 C01/SC01/P02/KF1/S001）；不传就退回旧的「生成方式-提示词主题」。
        label,
        // ACT: 媒体通道没有负面提示词字段（mediaGenerationSchema.sharedFields 只有 prompt），负面词只能并进正向提示。
        prompt: asset.negativePrompt?.trim() ? `${body}\n避免出现：${asset.negativePrompt.trim()}` : body,
        outputDirectory: options.assetDirectory,
        ratio: picked.ratio,
        ...(baseRefs.length ? { images: baseRefs.map(ref => ({ path: ref.path, mimeType: ref.mimeType })) } : {}),
      }, options.signal);
      const image = images[0];
      if (!image?.path) throw new Error("出图没有返回文件");
      const nodeId = await options.createImageNode({
        path: image.path,
        mimeType: image.mimeType,
        label,
        refs: baseRefs.map(ref => ({ id: ref.id, nodeId: ref.nodeId })),
      });
      nodeIds.set(asset.id, nodeId);
      produced.set(asset.id, { path: image.path, mimeType: image.mimeType });
    } catch (cause) {
      // 用户主动取消/超时要照常向上抛，只有单张失败被吞成清单。
      if (options.signal?.aborted) throw cause;
      failed.push({ id: asset.id, reason: `资产 ${asset.id} 出图失败：${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      done += 1;
      options.onProgress?.({ phase: "images", done, total: options.assets.length, assetId: asset.id });
    }
  }
  return { nodeIds, failed, warnings };
}

function ignoreExisting(reason: { response?: { data?: { data?: { code?: string } } } }) {
  if (reason.response?.data?.data?.code !== "EEXIST") throw reason;
}

/** 切分/导入都不覆盖用户已编辑的计划文件：默认工程或资产索引任一被占用就直接拒绝。 */
async function requireNewPlanFiles(workspace: WorkspaceFiles) {
  const paths = await workspace.list("plan")
    .then(({ entries }) => entries.map(entry => entry.path))
    // 计划目录还不存在属正常（全新项目）；其余读取失败照常抛出，不把未知状态当成可写。
    .catch((reason: { response?: { data?: { data?: { code?: string } } } }): string[] => {
      if (reason.response?.data?.data?.code === "ENOENT") return [];
      throw reason;
    });
  for (const path of [defaultProjectPath, assetIndexPath]) {
    if (paths.includes(path)) throw new Error(`${path} 已存在，未覆盖`);
  }
}

/** 独占写：目标已存在一律映射成同一条中文提示，绝不覆盖。 */
async function writeExclusive(workspace: WorkspaceFiles, path: string, data: unknown) {
  await workspace.writeJson(path, data, true).catch((reason: { response?: { data?: { data?: { code?: string } } } }) => {
    if (reason.response?.data?.data?.code === "EEXIST") throw new Error(`${path} 已存在，未覆盖`);
    throw reason;
  });
}

export function pickRatio(value: string | undefined): string {
  return ratioOptions.find(option => option === value) ?? ratioOptions[0];
}

type ResolvedClipOverride = {
  prompt: string;
  referenceIds: string[];
  seconds?: number;
  continuity?: boolean | "shot" | "context";
};

/**
 * clips 覆盖的预校验与归一：纯内存就能判的错（分镜 id 不在本次抽取里、没有提示词、引用了不存在或仅文字的资产）
 * 必须在出图前抛——原来只在落盘时判，错误要在烧完全部资产图、建好图片节点与 assets/<nodeId>/ 之后才出现。
 * usable（本次真的出了图的卡）要等出图结束才知道，那一步的引用过滤留在 writePlanFiles 里做。
 */
function resolveClipOverrides(options: {
  shots: ExtractedShot[];
  clipOverrides?: AssetImportClipOverride[];
  visual: Set<string>;
  ratio: string;
}): Map<string, ResolvedClipOverride> {
  const resolved = new Map<string, ResolvedClipOverride>();
  const known = new Set(options.shots.map((_, index) => createClip(index, options.ratio).clipId));
  const unknown: string[] = [];
  for (const override of options.clipOverrides ?? []) {
    if (!known.has(override.clipId)) {
      unknown.push(override.clipId);
      continue;
    }
    if (!override.prompt.trim()) throw new Error(`clips 覆盖的 ${override.clipId} 没有提示词`);
    const referenceIds = [...new Set(override.referenceIds ?? [])];
    for (const id of referenceIds) {
      if (!options.visual.has(id)) throw new Error(`clips 覆盖的 ${override.clipId} 引用了不可用的资产 ${id}（不存在，或该卡是仅文字资产）`);
    }
    resolved.set(override.clipId, {
      prompt: override.prompt.trim(),
      referenceIds,
      seconds: override.seconds,
      continuity: override.continuity,
    });
  }
  if (unknown.length) {
    throw new Error(`clips 覆盖里的 ${[...new Set(unknown)].join("、")} 不在本次抽取的分镜里（分镜 id 从 S001 起按正文顺序编号）`);
  }
  return resolved;
}

/** 落盘 plan/assetIndex.json 与 plan/story.mtrack：先写索引再写工程，工程失败删掉刚写的索引，不留半截现场。 */
export async function writePlanFiles(options: {
  workspace: WorkspaceFiles;
  extraction: AssetExtraction;
  assets: ExtractedAsset[];
  nodeIds: Map<string, string>;
  /** 本次真的尝试出图的资产：只有其中出了图的才配留在 referenceIds 里（失败卡留下会让派工报「参考图未就绪」）。 */
  attemptedImageIds?: Set<string>;
  /** node:importScript 的 clips 覆盖：按 clipId 覆盖单个分镜，未列出的分镜保持抽取结果。 */
  clipOverrides?: AssetImportClipOverride[];
  ratio: string;
  style: string;
  systemPrompt: string;
  projectName?: string;
}): Promise<{ indexPath: string; projectPath: string; warnings: string[] }> {
  await requireNewPlanFiles(options.workspace);
  await options.workspace.mkdir("plan").catch(ignoreExisting);
  const cards: AssetIndexCard[] = options.assets.map(asset => ({
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    textOnly: isTextOnlyAsset(asset),
    nodeId: options.nodeIds.get(asset.id) ?? null,
    ...(asset.refs?.length ? { refs: asset.refs } : {}),
  }));
  // ACT: 文本/声音卡不进 referenceIds——校验器 V13 把 textOnly 卡当「图片参考」判 error，派工也要求该卡在画布上有可用产出；
  // 声音资产的用途写在提示词正文里，等接上音频节点再按音频槽单独下发（本节点不出音频）。
  const visual = new Set(cards.filter(card => card.textOnly !== true).map(card => card.id));
  // 出图失败（或这次压根没出图）的卡也不能留在参考里：planValidator 的 V13 只看卡在不在索引里、不看 nodeId，
  // 于是工程能过校验、派工却当场抛「参考图未就绪」。attemptedImageIds 只在本次真要出图时才传。
  const usable = options.attemptedImageIds ? new Set([...options.attemptedImageIds].filter(id => options.nodeIds.has(id))) : undefined;
  const warnings: string[] = [];
  // ACT: 与 importAssets 开头的预校验同一个归一函数，这里再解析一次得到引用；出图前那次调用只为止损，不传结果过来。
  const overrides = resolveClipOverrides({
    shots: options.extraction.shots,
    clipOverrides: options.clipOverrides,
    visual,
    ratio: options.ratio,
  });
  const clips = options.extraction.shots.map((shot, index) => {
    const clip = createClip(index, options.ratio);
    const override = overrides.get(clip.clipId);
    const requested = override ? override.referenceIds : shot.referenceIds;
    let referenceIds = requested.filter(id => visual.has(id) && (!usable || usable.has(id)));
    // ACT: override 明确写的参考被 usable 滤空时会悄悄变成 []，这里点名告警——否则用户只会看到工程里参考没了。
    if (override && requested.length > 0 && !referenceIds.length) {
      warnings.push(`${clip.clipId} 覆盖的参考 ${requested.join("、")} 本次没有出图，已从参考清单里剔除（补一张图片节点后可在多轨「参考素材」里重新勾选）`);
    }
    if (referenceIds.length > maxImageReferences) {
      warnings.push(`${clip.clipId} 图片参考 ${referenceIds.length} 个超过引擎上限 ${maxImageReferences}，只保留前 ${maxImageReferences} 个`);
      referenceIds = referenceIds.slice(0, maxImageReferences);
    }
    clip.title = shot.title || `分镜 ${index + 1}`;
    // ACT: override 与抽取结果的秒数都清洗：V12 只收 2–60 的整数秒，10.5/90 这类值直接落盘会让工程一打开就报错。
    const requestedSeconds = override?.seconds ?? shot.seconds;
    clip.seconds = sanitizeSeconds(requestedSeconds);
    const secondsNote = secondsWarning(clip.clipId, requestedSeconds, clip.seconds);
    if (secondsNote) warnings.push(secondsNote);
    // ACT: 六段整段落经 textToPrompt 拆分落三段字段（与编辑器写入口径一致）：正文里的
    // overall_soundscape: / non_diegetic_music: 行各归字段，不再整段落塞正文留空两段——
    // 否则每镜落盘都带两条 V11 warning（缺声音段），与「原文六段原样保留」的 readme 口径差。
    clip.prompt = textToPrompt(override ? override.prompt : shot.prompt);
    clip.continuity = override?.continuity === undefined
      ? shot.continuity ?? defaultContinuity(index, clip.seconds, referenceIds.length)
      : pickContinuity(override.continuity);
    // ACT: normalizeProject（mtrackProject.ts:268）把首镜的 continuity 强制回落成 shot，这里先说清楚，避免「写了承接却没生效」。
    if (index === 0 && clip.continuity === "context") {
      warnings.push(`${clip.clipId} 是首镜，承接上一镜（context）会被引擎归一成独立起拍（shot）`);
    }
    // ACT: 承接镜（context）的图片参考引擎硬上限 3 张（V16，continue_from 契约）——模型或 clips 显式写 context
    // 且参考 4–9 张时 defaultContinuity 的 ≤3 不参与判定，落盘前按引擎上限收口截到 3，和「>9 截断」同一口径。
    // 首镜不落此刀：normalizeProject 会把首镜归回 shot，独立镜的 9 张上限已经截过。
    if (index > 0 && clip.continuity === "context" && referenceIds.length > maxContextReferences) {
      warnings.push(`${clip.clipId} 承接上一镜（context）的图片参考 ${referenceIds.length} 个超过引擎上限 ${maxContextReferences}，只保留前 ${maxContextReferences} 个（引擎要求承接镜合计最多 ${maxContextReferences} 张参考；需要更多参考请改为独立起拍）`);
      referenceIds = referenceIds.slice(0, maxContextReferences);
    }
    if (clip.continuity === "context" && clip.seconds < 10) {
      warnings.push(`${clip.clipId} 写的是承接上一镜（context）却只有 ${clip.seconds} 秒，引擎要求至少 10 秒`);
    }
    clip.referenceIds = referenceIds;
    clip.mode = shot.mode ?? (referenceIds.length ? "ref" : "text");
    return clip;
  });
  const index: AssetIndex = { version: "assetIndex-v1", cards };
  // ACT: 不写 global.model —— 该字段是多轨派工用的视频模型，写进本次抽取的文本模型会让派工报「所选模型不存在」。
  const project: MtrackProject = normalizeProject({
    version: 1,
    projectId: `mtrack-${Date.now()}`,
    ...(options.projectName ? { name: options.projectName } : {}),
    updatedAt: new Date().toISOString(),
    global: {
      ratio: options.ratio,
      ...(options.style.trim() ? { style: options.style.trim() } : {}),
      ...(options.systemPrompt.trim() ? { systemPrompt: options.systemPrompt.trim() } : {}),
    },
    clips,
  });
  await writeExclusive(options.workspace, assetIndexPath, index);
  try {
    await writeExclusive(options.workspace, defaultProjectPath, project);
  } catch (error) {
    // 工程写失败时删掉刚建的索引（独占写成功才走到这里，删的是本次产物），不留半截现场堵住重试。
    await options.workspace.remove(assetIndexPath).catch(() => {});
    throw error;
  }
  return { indexPath: assetIndexPath, projectPath: defaultProjectPath, warnings };
}

export type AssetImportInput = {
  ai: AssetImportAi;
  workspace: WorkspaceFiles;
  /** 抽取用文本模型：只有还要调模型抽正文时才需要，已给 extraction 的确定性导入可以完全不传。 */
  model?: AssetImportModel;
  text?: string;
  /** 已抽取（并已按勾选裁剪）的结果：传了就跳过再次调用模型，避免预览与落盘抽到两份不同的内容。 */
  extraction?: AssetExtraction;
  ratio?: string;
  style?: string;
  systemPrompt?: string;
  generateImages?: boolean;
  /** 按 clipId 覆盖抽取出来的分镜（分镜 id 从 S001 起按正文顺序编号），用于导入后仍然保留原文写好的六段式提示词。 */
  clips?: AssetImportClipOverride[];
  assetDirectory: string;
  createImageNode?(item: { path: string; mimeType: string; label: string; refs?: { id: string; nodeId: string }[] }): Promise<string>;
  imageModel?: AssetImportModel;
  signal?: AbortSignal;
  onExtracted?(extraction: AssetExtraction): void;
  /** 进度回调：面板与 node:importStatus 靠它读到「正在出第几张」。 */
  onProgress?(event: AssetImportProgress): void;
};

/** 面板与 node:importScript 共用的一条链路：抽取 → 出图（可选）→ 落 plan 两个文件。 */
export async function importAssets(options: AssetImportInput): Promise<AssetImportSummary> {
  const ratio = pickRatio(options.ratio);
  // ACT: 占用探测提到入口——原来只在 writePlanFiles 里做，重跑会先烧完文本模型与全部出图，最后才收到「已存在，未覆盖」。
  await requireNewPlanFiles(options.workspace);
  options.onProgress?.({ phase: "extract", done: 0, total: 0 });
  // ACT: 契约优先——资产卡与分镜已经定稿成结构化数据时直接传 extraction，本节点只做校验与落盘，一次模型都不调；
  // 只有还要从散文里抽的时候才需要文本模型（会话 Agent 确认过可用的那一个）。
  const extraction = options.extraction ?? await extractAssets({ ai: options.ai, model: requireExtractModel(options.model), text: options.text ?? "", signal: options.signal });
  options.onExtracted?.(extraction);
  const assets = extraction.assets;
  // ACT: clips 覆盖的纯内存校验提前到这里——出图是整个导入最贵的一步，非法覆盖不该等图烧完、图片节点建好才报
  //（落盘时 writePlanFiles 会用同一个归一函数再解析一次引用）。
  resolveClipOverrides({
    shots: extraction.shots,
    clipOverrides: options.clips,
    visual: new Set(assets.filter(asset => !isTextOnlyAsset(asset)).map(asset => asset.id)),
    ratio,
  });
  const nodeIds = new Map<string, string>();
  const warnings: string[] = [];
  let failed: { id: string; reason: string }[] = [];
  let attempted: Set<string> | undefined;
  if (options.generateImages) {
    const drawable = assets.filter(asset => !isTextOnlyAsset(asset));
    if (!drawable.length) throw new Error("本次抽取没有需要出图的资产（全是仅文字资产）");
    if (!options.createImageNode) throw new Error("没有可用的画布，无法放置资产图");
    if (!options.imageModel) throw new Error("没有可用的图片模型，请先在设置中添加图片模型");
    const directory = (await options.workspace.list()).directory;
    attempted = new Set(drawable.map(asset => asset.id));
    const images = await generateAssetImages({
      ai: options.ai,
      workspace: options.workspace,
      assets: drawable,
      model: options.imageModel,
      directory,
      assetDirectory: options.assetDirectory,
      createImageNode: options.createImageNode,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    for (const [id, nodeId] of images.nodeIds) nodeIds.set(id, nodeId);
    failed = images.failed;
    warnings.push(...images.warnings);
    for (const item of failed) warnings.push(`${item.id} 出图失败，已从分镜参考清单里移除：补一张图片节点后可在多轨「参考素材」里重新勾选`);
  }
  // 取消/超时可能正好落在最后一张图出完之后：写盘前再复查一次中止状态，别把已取消的工程落成磁盘状态。
  options.signal?.throwIfAborted();
  options.onProgress?.({ phase: "write", done: 0, total: 0 });
  const { indexPath, projectPath, warnings: planWarnings } = await writePlanFiles({
    workspace: options.workspace,
    extraction,
    assets,
    nodeIds,
    attemptedImageIds: attempted,
    clipOverrides: options.clips,
    ratio,
    style: options.style ?? extraction.style,
    systemPrompt: options.systemPrompt ?? extraction.systemPrompt,
  });
  return {
    cards: assets.length,
    shots: extraction.shots.length,
    images: nodeIds.size,
    failed,
    warnings: [...warnings, ...planWarnings],
    indexPath,
    projectPath,
  };
}
