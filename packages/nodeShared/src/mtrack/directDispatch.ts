/**
 * 多轨选段直连派工：编辑器自己经画布 nodeTools 逐镜生成视频，不经对话模型。
 *
 * 与参考实现 LocalStoryCanvas 的 `/projects/{id}/run` 同构——按钮点了就直接排队生成，
 * 不产生 chat/completions 调用。链路固定为：
 *   建节点（缺时）→ node:setConfig → node:setPrompt → node:generateVideo
 *   → 轮询 node:getGenerationStatus → 由编辑器回写工程
 * 首镜实测 738.5s，所以生成一律「立即返回 + 轮询 + 取消」三段式，不在一次调用里等结果。
 */

import type { AssetIndexCard, MtrackClip } from "./mtrackProject";

export type CanvasBridge = {
  id: string;
  tools: unknown[];
  call?(request: { name: string; args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>;
};

export type VideoModel = { providerId?: string; modelId?: string };

export type GenerationStatus = { status: "idle" | "running" | "succeeded" | "failed"; outputs?: Record<string, unknown>; error?: string; cancellationRequested?: boolean };

/** 生成循环的轮询间隔：本机 GPU 分钟级，2 秒一次足够，也不至于打满画布调用。 */
const pollDelay = 2000;
// ACT: 单镜最长等 1 小时（首镜实测 738.5s，长镜头引擎自动分块会更久）。超时只结束本轮等待，不撤销供应商任务。
const pollLimit = 60 * 60 * 1000;
/** 新建节点在画布上的横向间距，避免多镜节点叠在一起。 */
const nodeGap = 480;

export interface DispatchHandle {
  batchId: string;
  run: Promise<void>;
  abort(): void;
  /** 置「本镜结束后停」标志：不中断正在跑的镜头，只在镜头之间退出循环。 */
  pause(): void;
}

/** 宿主未提供 canvas 工厂、画布未激活或结构不符时统一返回 undefined。 */
export function resolveCanvasBridge(read: unknown): CanvasBridge | undefined {
  const value = typeof read === "function" ? (read as () => unknown)() : read;
  if (!value || typeof value !== "object") return undefined;
  const bridge = value as { id?: unknown; tools?: unknown; call?: unknown };
  if (typeof bridge.id !== "string" || !bridge.id || !Array.isArray(bridge.tools)) return undefined;
  return {
    id: bridge.id,
    tools: bridge.tools,
    call: typeof bridge.call === "function" ? (value as CanvasBridge).call!.bind(value) : undefined,
  };
}

function requireCall(bridge: CanvasBridge) {
  if (!bridge.call) throw new Error("当前宿主画布不支持工具调用，请从画布所在界面发起生成");
  return bridge.call;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(signal: AbortSignal, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * 计划里的类型名是插件名（videoGenerationNode），画布注册的可用类型可能带来源前缀
 * （remote-videoGenerationNode，见 apps/web/.../canvasDrop.ts）。精确匹配优先，其次唯一后缀匹配；歧义不猜。
 */
function resolveNodeType(available: readonly { type: string }[], requested: string) {
  if (available.some(item => item.type === requested)) return requested;
  const matches = available.filter(item => item.type.endsWith(`-${requested}`)).map(item => item.type);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * 提示词只做三件事，不代写内容：
 *   1. 全片风格/全片约束拼在正文开头；
 *   2. 正文原样透传——旧工程的 {{ref N}} 占位标记也不改写，编号由 videoGenerationNode 的
 *      referenceTags 按 dataType 在 wire 层换算成 <Picture N> / <Video N> / <Audio N>；
 *   3. 正文漏写官方段首时补字段名，并把 overall_soundscape / non_diegetic_music 两个声音字段
 *      拼成同名的两段尾（字段里只写内容，段名由这里拼）。
 * 官方 ref2va 六段（subject_definitions / summary / retention_analysis / detailed_description）由写作者直接
 * 写进正文。
 * 字段名 `name: text` 是 H3 认的约定写法（引擎 example 与 promptWriting.md:19），段序固定：
 * 画面正文段 → overall_soundscape → non_diegetic_music，段间空一行。
 */
/** 正文已自带官方段首：写作者按六段格式直接书写，不再套标签（ref2va 的画面正文段是 detailed_description）。 */
const officialSection = /^(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description)\s*:/i;

function buildPrompt(clip: MtrackClip, global?: { style?: string; systemPrompt?: string }) {
  // ACT: referenceIds 可能含 sound 卡，位次不等于 Picture 序号（sound 计 <Audio N>，其余计 <Picture N>）。
  // 换算统一交给 videoGenerationNode 的 referenceTags 按 dataType 完成（index.vue:212-224），引擎层不替换。
  const body = clip.prompt.integratedMultimodalDescription.trim();
  // ACT: 全片风格/系统提示词是工程级约束，拼在正文开头而不是另起一段，避免破坏 H3 的六段结构。
  const style = global?.style?.trim() ?? "";
  const systemPrompt = global?.systemPrompt?.trim() ?? "";
  const constraint = [style && `全片风格：${style}`, systemPrompt && `全片约束：${systemPrompt}`].filter(Boolean).join("\n");
  const first = constraint ? `${constraint}\n${body}` : body;
  const head = first && `${officialSection.test(body) ? "" : `${clip.referenceIds.length ? "detailed_description" : "integrated_multimodal_description"}: `}${first}`;
  const soundscape = clip.prompt.overallSoundscape.trim();
  const music = clip.prompt.nonDiegeticMusic.trim();
  const tail = [
    soundscape && `overall_soundscape: ${soundscape}`,
    music && `non_diegetic_music: ${music}`,
  ].filter(Boolean);
  return [head, ...tail].filter(Boolean).join("\n\n");
}

async function callTool(bridge: CanvasBridge, nodeId: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  return await requireCall(bridge)({ name: "nodeTools", args: { nodeId, name, args } }, signal);
}

/** 生成结果里的视频路径：节点 outputs.video.value.url 是工作区相对路径，直接作为 assetPath。 */
function assetPathOf(status: GenerationStatus) {
  const video = (status.outputs?.video as { dataType?: string; value?: { url?: string } } | undefined);
  return video?.value?.url || "";
}

/** 从节点 outputs 里取视频路径：getCanvasNodes 与 getGenerationStatus 两条来源的字段形状一致。 */
function videoPathOf(outputs: Record<string, unknown> | undefined) {
  const video = outputs?.video as { value?: { url?: string } } | undefined;
  return video?.value?.url || "";
}

/**
 * 节点确实不在画布上的判据，三条文案各来自不同层：
 * - 「节点不存在：<id>」画布查询（apps/web/.../canvas/useCanvasTools.ts 的 findNode）；
 * - 「节点未注册函数 …」nodeTools 注册表没有该 nodeId（packages/nodeScaffold/src/nodeTools.ts），
 *   节点被删后函数已随作用域注销，取状态时抛的是这条而不是「节点不存在」；
 * - 「节点函数已卸载或不属于本轮画布」注册过但画布已换。
 * 这三条只说明「这个 nodeId 上取不到工具」，是否真的节点没了由调用方再用 getCanvasNodes 实证。
 */
const missingNodeTexts = ["节点不存在", "节点未注册函数", "节点函数已卸载或不属于本轮画布"];

function isMissingNode(error: unknown) {
  const message = messageOf(error);
  return missingNodeTexts.some(text => message.includes(text));
}

/**
 * 单节点读一次产物：节点还在但本次查询失败时抛错（由对账整轮跳过），
 * 只有节点确实不在画布上才返回 undefined——两者的处置完全不同，不能都当「查不到」。
 */
async function readNodeOutputs(bridge: CanvasBridge, nodeId: string, signal: AbortSignal) {
  try {
    const listed = await requireCall(bridge)({ name: "getCanvasNodes", args: { nodeIds: [nodeId], fields: ["outputs"] } }, signal) as { nodes?: { outputs?: Record<string, unknown> }[] };
    return listed?.nodes?.[0]?.outputs;
  } catch (error) {
    // 节点已删时 getCanvasNodes 报「节点不存在」：那是「节点没了」，不是「这次查不出来」。
    if (isMissingNode(error)) return undefined;
    throw error;
  }
}

/**
 * 只读某一镜当前生成状态，供断点续跑对账使用（不轮询、不改工程、不发起生成）。
 * 四种判定各有明确去向，对账按 outcome 决定写什么，不靠字符串猜：
 *   succeeded → generated（节点报成功且有视频路径）；
 *   failed    → failed（节点自己报失败，或节点已从画布删除）；
 *   pending   → 回退 pending（节点报 idle 且没有产物：真·进程重启后任务丢了，退回可派工状态）；
 *   idle      → 不动（节点正在跑，或本次打开节点后还没跑过生成）。
 *
 * 「查不出来」必须与上面四种分开：取状态 / 读产物这两次调用本身失败（画布正在重挂、工具暂时
 * 不可用等）→ 抛错让对账整轮跳过。把查不出来写成 failed 会误伤一个其实还在跑的镜头。
 */
export async function readClipGeneration(bridge: CanvasBridge, nodeId: string, signal?: AbortSignal): Promise<
  { outcome: "succeeded" | "failed" | "pending" | "idle"; assetPath: string; error: string }
> {
  const useSignal = signal ?? new AbortController().signal;
  let status: GenerationStatus;
  try {
    status = await callTool(bridge, nodeId, "node:getGenerationStatus", {}, useSignal) as GenerationStatus;
  } catch (error) {
    // ACT: 取不到状态有两种——节点已删（nodeScaffold 抛「节点未注册函数 …」，不是「节点不存在」）
    // 与这次查不出来（画布正在重挂、插件没加载）。用 getCanvasNodes 实证节点还在不在：
    // 不在才判 failed，还在就照旧抛错让对账整轮跳过，绝不把在跑的镜头误标失败。
    const detail = await readNodeDetail(requireCall(bridge), nodeId, useSignal);
    if (detail) throw error;
    return { outcome: "failed", assetPath: "", error: "画布上的视频节点已不存在，该镜需要重新生成" };
  }
  if (status?.status === "succeeded") return { outcome: "succeeded", assetPath: assetPathOf(status), error: "" };
  if (status?.status === "failed") return { outcome: "failed", assetPath: "", error: status.error || "视频生成失败" };
  // running：节点正在跑，等下一轮对账，不动状态。
  if (status?.status === "running") return { outcome: "idle", assetPath: "", error: "" };
  // ACT: idle 只说明「本次打开节点后没跑过生成」，本身不能反推任务失联（刚 onStart 还没 generateVideo
  // 的镜头也是 idle）。所以再看一眼节点产物：真·进程重启后节点上的任务没了但产物可能还在——
  // 有产物就补成 generated，一点产物都没有才回退 pending 让用户能重新派工（绝不能标 failed）。
  const outputs = await readNodeOutputs(bridge, nodeId, useSignal);
  const assetPath = videoPathOf(outputs);
  if (assetPath) return { outcome: "succeeded", assetPath, error: "" };
  if (!outputs) return { outcome: "failed", assetPath: "", error: "画布上的视频节点已不存在，该镜需要重新生成" };
  return { outcome: "pending", assetPath: "", error: "重启后未在节点上找到生成产物，已退回待生成" };
}

export type SourcePort = { id?: string; type?: string; dataType?: string | string[] };
export type NodeDetail = { id: string; label?: string; type?: string; ports?: SourcePort[]; outputs?: Record<string, unknown> };

/** 卡片 id 与画布 label 的边界匹配：`C01-A` 不能命中 `C01-B …`，`C01` 也不能命中 `C01-A …`。 */
export function labelMatchesCard(label: string, cardId: string) {
  if (!label.startsWith(cardId)) return false;
  const next = label[cardId.length];
  return next === undefined || !/[A-Za-z0-9-]/.test(next);
}

export function imagePathOf(node: NodeDetail) {
  const image = node.outputs?.image as { value?: { url?: string } } | undefined;
  return image?.value?.url || "";
}

/**
 * 资产卡 kind → 参考产出端口的数据类型：`sound` 卡走音频，其余（character/scene/prop/keyframe 与缺省）走图片。
 * 口径与 planValidator 的 V8 计数一致（只有 `kind === "sound"` 算音频参考，其余算图片参考）。
 */
export function referenceMediaTypes(kind: string | undefined) {
  return kind === "sound" ? ["AUDIO"] : ["IMAGE"];
}

/**
 * 资产节点的参考产出路径：sound 卡取音频产出，其余与原来一致取图片产出。
 * ACT: 旧实现非声音卡也走 `imagePathOf`，声音卡因此在画布上永远被判「未就绪」——参考被整批跳过、
 * 派工直接报「参考图未就绪」；参考类型本来就由卡片 kind 决定，这里只补 sound 一支，不改其余口径。
 * 上限：只读节点 outputs，不校验文件是否真实存在。
 */
export function mediaPathOf(node: NodeDetail, kind?: string) {
  if (kind === "sound") {
    const audio = node.outputs?.audio as { value?: { url?: string } } | undefined;
    return audio?.value?.url || "";
  }
  return imagePathOf(node);
}

/** 资产节点提供参考产出的输出端口：按卡片 kind 找对应类型的第一个 source 端口。 */
export function sourceHandleOf(node: NodeDetail, kind?: string) {
  const types: string[] = referenceMediaTypes(kind);
  const port = (node.ports ?? []).find(item => item.type === "source"
    && (Array.isArray(item.dataType) ? item.dataType : [item.dataType]).some(type => types.includes(type ?? "")));
  return port?.id;
}

export type CanvasCall = (request: { name: string; args: Record<string, unknown> }, signal?: AbortSignal) => Promise<unknown>;

/**
 * 单节点详情；节点已被删除时 getCanvasNodes 会整批报错，这里降级成 undefined。
 * 只吞「节点不存在」：其余失败（画布正在重挂等）照旧抛出，让调用方区分「节点没了」与「这次查不出来」。
 */
export async function readNodeDetail(call: CanvasCall, nodeId: string, signal: AbortSignal) {
  try {
    const listed = await call({ name: "getCanvasNodes", args: { nodeIds: [nodeId], fields: ["outputs", "ports"] } }, signal) as { nodes?: NodeDetail[] };
    return listed?.nodes?.[0];
  } catch (error) {
    if (!isMissingNode(error)) throw error;
    return undefined;
  }
}

/** 画布上按卡片 id 找资产节点：label 以卡片 id 开头且带边界。 */
export async function findCardNodeIds(call: CanvasCall, cardId: string, signal: AbortSignal) {
  const listed = await call({ name: "findCanvasNodes", args: { query: cardId, limit: 50 } }, signal) as { nodes?: { id: string; label?: string }[] };
  return (listed?.nodes ?? []).filter(node => labelMatchesCard(node.label ?? "", cardId)).map(node => node.id);
}

/**
 * 画布上按分镜号找已有的视频生成节点，用于 clip.nodeId 悬空时复用而不是再建一个孤儿。
 * 只复用还没出过视频的节点：同 label 的节点可能已经有好几个（每次重新生成追加一个版本），
 * 已产出视频的是旧版本，复用会把旧视频覆盖掉。
 */
async function findClipNodeId(call: CanvasCall, clip: MtrackClip, signal: AbortSignal) {
  const listed = await call({ name: "findCanvasNodes", args: { query: clip.clipId, limit: 50 } }, signal) as { nodes?: { id: string; label?: string; type?: string }[] };
  const matched = (listed?.nodes ?? []).filter(node => (node.type ?? "").includes("videoGenerationNode") && labelMatchesCard(node.label ?? "", clip.clipId));
  for (const node of matched) {
    const detail = await readNodeDetail(call, node.id, signal);
    if (detail && !videoPathOf(detail.outputs)) return node.id;
  }
  return undefined;
}

/**
 * 复用镜头上已有的节点；节点已被删除就按分镜号找回同名节点；都没有才新建。
 * ACT: 工程里的 nodeId 可能指向已删除的节点（画布被改写后常见），直接复用会让后续 nodeTools 报「节点不存在」。
 * LSC 对齐：重新生成是追加新版本而不是覆盖旧结果——节点已产出视频时不再复用，旧节点保留旧视频的
 * 画布引用（attempts 历史里的 nodeId 仍能反查旧视频）。没出过视频的节点（pending/failed 的镜）照旧复用，
 * 不为从未产出的镜头堆节点。
 */
async function ensureNode(options: {
  bridge: CanvasBridge;
  clip: MtrackClip;
  index: number;
  available: readonly { type: string }[];
  origin: { x: number; y: number };
  signal: AbortSignal;
}) {
  const { bridge, clip, index, available, origin, signal } = options;
  const call = requireCall(bridge);
  if (clip.nodeId) {
    const detail = await readNodeDetail(call, clip.nodeId, signal);
    if (detail && !videoPathOf(detail.outputs)) return clip.nodeId;
  }
  const reused = await findClipNodeId(call, clip, signal);
  if (reused) return reused;
  const type = resolveNodeType(available, "videoGenerationNode");
  if (!type) throw new Error("画布没有视频生成节点类型，请先启用视频生成节点插件");
  const result = await call({
    name: "addNode",
    args: {
      type,
      position: { x: origin.x + index * nodeGap, y: origin.y },
      label: `${clip.clipId} ${clip.title || "分镜"}`.slice(0, 200),
    },
  }, signal) as { node?: { id?: string } };
  const nodeId = result?.node?.id;
  if (!nodeId) throw new Error(`新建视频生成节点未返回节点 ID：${clip.clipId}`);
  return nodeId;
}

/**
 * 解析 referenceIds 对应的画布资产节点。assetIndex.json 的 nodeId 由 planOperator 产出，resolve 阶段不产出 nodeId
 * （buildAssetIndex 写 `card.nodeId ?? null`，resolveReferences 不回填；真正回填发生在 imageGridSplit），只认它会让
 * 参考图被整批静默跳过、生成退化成纯文生视频（实测 freevideo job 的 spec.media 为空）；这里以画布 label 兜底。
 * 资产节点必须已出对应产出：没出图的参考连线也传不出素材；声音卡按 `kind: "sound"` 取音频产出。
 * ACT: 与 node:readReferenceMap（multitrackNode）共用本函数，保证「派工实际怎么接」与「agent 查到的映射」同源。
 */
export async function resolveReferenceSources(options: {
  call: CanvasCall;
  clip: Pick<MtrackClip, "referenceIds">;
  cards: readonly AssetIndexCard[];
  signal: AbortSignal;
}) {
  const { call, clip, cards, signal } = options;
  const picked: { cardId: string; nodeId: string; sourceHandle: string; path: string }[] = [];
  const missing: string[] = [];
  for (const id of clip.referenceIds) {
    const card = cards.find(item => item.id === id);
    const candidates = [...new Set([card?.nodeId, ...(await findCardNodeIds(call, id, signal))].filter((value): value is string => !!value))];
    let chosen: { cardId: string; nodeId: string; sourceHandle: string; path: string } | undefined;
    for (const nodeId of candidates) {
      const detail = await readNodeDetail(call, nodeId, signal);
      if (!detail) continue;
      const sourceHandle = sourceHandleOf(detail, card?.kind);
      const path = mediaPathOf(detail, card?.kind);
      if (!sourceHandle || !path) continue;
      chosen = { cardId: id, nodeId, sourceHandle, path };
      break;
    }
    if (chosen) picked.push(chosen);
    else missing.push(id);
  }
  return { picked, missing };
}

/**
 * 多轨节点自己 `in` 端口上的入边：用户在卡片上手动接的资产。
 * 返回按「该端口 referenceOrder」排好序的来源，未显式排序时按入边顺序——
 * 与画布 mention 的 {{ref N}} 同源，所以这里的顺序就是用户看到的位次。
 */
async function readMultitrackSources(call: CanvasCall, multitrackNodeId: string, signal: AbortSignal) {
  const listed = await call({ name: "getCanvasEdges", args: { nodeIds: [multitrackNodeId], direction: "incoming", limit: 200 } }, signal) as {
    edges?: { source: string; sourceHandle?: string | null; targetHandle?: string | null }[];
  };
  const incoming = (listed?.edges ?? [])
    .filter(edge => (edge.targetHandle ?? "in") === "in")
    .map(edge => ({ nodeId: edge.source, sourceHandle: edge.sourceHandle ?? "" }));
  if (!incoming.length) return [];
  let order: { nodeId: string; sourceHandle: string }[] = [];
  try {
    const result = await call({ name: "nodeTools", args: { nodeId: multitrackNodeId, name: "node:getReferenceOrder", args: { handleId: "in" } } }, signal) as {
      references?: { nodeId: string; sourceHandle: string }[];
    };
    order = result?.references ?? [];
  } catch {
    // 多轨节点没有引用函数时按入边顺序，与 referenceOrderOf 的回退一致。
  }
  if (!order.length) return incoming;
  const rank = new Map(order.map((item, index) => [`${item.nodeId}:${item.sourceHandle}`, index]));
  return [...incoming].sort((left, right) => (rank.get(`${left.nodeId}:${left.sourceHandle}`) ?? order.length) - (rank.get(`${right.nodeId}:${right.sourceHandle}`) ?? order.length));
}

/**
 * 把 referenceIds 对应的画布节点连到视频节点 in 端口，并按 referenceIds 顺序写 referenceOrder。
 * 只要有参考没接上就整镜报错：部分接线会让 {{ref N}} 编号与 referenceIds 顺序错位，生成结果对不上参考图还看不出原因。
 *
 * ACT: 优先用多轨节点 `in` 端口上用户已接的连线——那张卡片看着就是「把参考资产接到这镜」的入口，
 * 手接的边若被派工无视，用户会以为接好了。判定口径：多轨端口上的来源能按卡片 id/label 对上某张参考卡时即视为「用户已指定」，
 * 按多轨端口的 referenceOrder 取位次；对不上的参考仍回落到「按 assetIndex/画布 label 自动找节点」。
 */
async function connectReferences(options: {
  bridge: CanvasBridge;
  clip: MtrackClip;
  nodeId: string;
  cards: readonly AssetIndexCard[];
  multitrackNodeId?: string;
  signal: AbortSignal;
}) {
  const { bridge, clip, nodeId, cards, multitrackNodeId, signal } = options;
  if (!clip.referenceIds.length) return 0;
  const call = requireCall(bridge);
  const manual = multitrackNodeId ? await readMultitrackSources(call, multitrackNodeId, signal) : [];
  const { picked, missing } = await resolveReferenceSources({ call, clip, cards, signal });
  if (missing.length) {
    throw new Error(`参考图未就绪：${missing.join("、")} 在画布上没有可用产出（需要已装配资产节点且已出图），请先补齐再生成`);
  }
  // 手动接线优先：按参考位次逐条找「这条参考卡是否已在多轨端口上」，命中就改用那条边。
  const manualByCard = new Map<string, { nodeId: string; sourceHandle: string }>();
  if (manual.length) {
    const details = new Map<string, NodeDetail>();
    for (const source of manual) {
      const detail = await readNodeDetail(call, source.nodeId, signal);
      if (!detail) continue;
      details.set(`${source.nodeId}:${source.sourceHandle}`, detail);
    }
    for (const card of clip.referenceIds) {
      const matched = manual.find(source => {
        const detail = details.get(`${source.nodeId}:${source.sourceHandle}`);
        const label = detail?.label ?? "";
        return labelMatchesCard(label, card) || cards.find(item => item.id === card)?.nodeId === source.nodeId;
      });
      if (matched) manualByCard.set(card, matched);
    }
  }
  const ordered = clip.referenceIds.map(cardId => {
    const source = manualByCard.get(cardId);
    if (source) return { cardId, ...source };
    return picked.find(item => item.cardId === cardId);
  }).filter((item): item is { cardId: string; nodeId: string; sourceHandle: string } => Boolean(item));
  if (ordered.length !== clip.referenceIds.length) {
    throw new Error(`参考图未就绪：${clip.referenceIds.filter(card => !ordered.some(item => item.cardId === card)).join("、")} 无法确定画布来源`);
  }
  await call({
    name: "connectNodes",
    args: {
      connections: ordered.map(item => ({ source: item.nodeId, sourceHandle: item.sourceHandle, target: nodeId, targetHandle: "in" })),
    },
  }, signal);
  // referenceOrder 按 referenceIds 顺序写：手动接线的顺序才是用户想要的位次，不能被入边顺序覆盖。
  await callTool(bridge, nodeId, "node:setReferenceOrder", {
    handleId: "in",
    sources: ordered.map(item => ({ nodeId: item.nodeId, sourceHandle: item.sourceHandle })),
  }, signal).catch(() => {
    // ACT: 顺序写入失败不阻断生成——参考图仍已连线，只是 {{ref N}} 编号回退到入边顺序。
  });
  return ordered.length;
}

/** 配好一镜的模型与参数。工程没绑视频模型时只下发时长/分辨率/比例/声音，模型沿用节点当前值。 */
async function configureNode(options: {
  bridge: CanvasBridge;
  clip: MtrackClip;
  nodeId: string;
  videoModel?: VideoModel;
  signal: AbortSignal;
}) {
  const { bridge, clip, nodeId, videoModel, signal } = options;
  const args: Record<string, unknown> = {
    duration: clip.seconds,
    resolution: clip.resolution,
    ratio: clip.ratio,
    generateAudio: clip.generateAudio,
  };
  if (videoModel?.providerId && videoModel.modelId) {
    args.providerId = videoModel.providerId;
    args.modelId = videoModel.modelId;
  }
  await callTool(bridge, nodeId, "node:setConfig", args, signal);
}

