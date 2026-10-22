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
 * 提示词拼装与 assetCard runbook §四 同源：三字段逐字取用，字段名按 FreeVideo 规范写在段首。
 * 字段名 `name: text` 是 H3 认的约定写法（引擎 example 与 promptWriting.md:19），三段顺序固定：
 * integrated_multimodal_description → overall_soundscape → non_diegetic_music，段间空一行。
 * 声明只在确实接了参考图时才写：接不上时 {{ref N}} 不会被节点替换（videoGenerationNode 仅在
 * refList 非空时把 {{ref N}} 换成 <Picture N>），写进去等于把模板字面量当画面描述喂给模型。
 * 正文已自带该声明（上游写入的多轨提示词常有）时不重复追加。
 * 参考顺序句并入第一段末尾而非独立第四段——规范三段结构内没有第四段的归属，独立成段会被模型当成画面描述。
 */
function buildPrompt(clip: MtrackClip, cards: readonly AssetIndexCard[], withReferences: boolean, global?: { style?: string; systemPrompt?: string }) {
  const description = clip.prompt.integratedMultimodalDescription.trim();
  const soundscape = clip.prompt.overallSoundscape.trim();
  const music = clip.prompt.nonDiegeticMusic.trim();
  const references = withReferences && clip.referenceIds.length
    ? clip.referenceIds.map((id, index) => {
      const card = cards.find(item => item.id === id);
      return { tag: `{{ref ${index + 1}}}`, id, name: card?.name || id, kind: card?.kind || "" };
    })
    : [];
  const alreadyDeclared = /本段参考顺序|\{\{\s*ref\s*\d+\s*\}\}/i.test(description);
  let first = description;
  if (references.length && !alreadyDeclared && first) {
    first = `${first}\n本段参考顺序：${references.map((item, index) =>
      `{{ref ${index + 1}}} = ${item.id}（${item.name}${item.kind ? `，用途：${item.kind}` : ""}）`).join("；")}。图片仅作参考，不自动作为精确首帧。`;
  }
  // ACT: 全片风格/系统提示词是工程级约束，拼在描述段开头而不是另起一段，避免破坏 H3 的三段/六段结构。
  const style = global?.style?.trim() ?? "";
  const systemPrompt = global?.systemPrompt?.trim() ?? "";
  const constraint = [style && `全片风格：${style}`, systemPrompt && `全片约束：${systemPrompt}`].filter(Boolean).join("\n");
  if (constraint) first = `${constraint}\n${first}`;
  const tail = [
    soundscape && `overall_soundscape: ${soundscape}`,
    music && `non_diegetic_music: ${music}`,
  ].filter(Boolean);
  // ACT: 有参考时走 ref2va 六段（promptWriting.md:13/:18，runbook §十一 实测 task=ref2va）；
  // subject_definitions / summary / retention_analysis 由 referenceIds 与资产卡确定性生成，不编造内容。
  if (references.length) {
    return [
      `subject_definitions:\n${references.map((item, index) =>
        `<Subject ${index + 1}> 是 ${item.id}（${item.name}${item.kind ? `，用途：${item.kind}` : ""}），来自 ${item.tag}。`).join("\n")}`,
      `summary:\nreference generation：本段参考 ${references.length} 个资产以保持与相邻镜头的身份一致性。`,
      `retention_analysis:\n${references.map((_item, index) =>
        `<Subject ${index + 1}> 的身份、外貌与服装 fully_preserved；本段只描述姿态、动作、镜头与光线，不复述其形貌。`).join("\n")}`,
      first && `detailed_description:\n${first}`,
      ...tail,
    ].filter(Boolean).join("\n\n");
  }
  return [first && `integrated_multimodal_description: ${first}`, ...tail].filter(Boolean).join("\n\n");
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

function sourceHandleOf(node: NodeDetail) {
  const port = (node.ports ?? []).find(item => item.type === "source"
    && (Array.isArray(item.dataType) ? item.dataType : [item.dataType]).some(type => type === "IMAGE" || type === "VIDEO"));
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

/** 画布上按分镜号找已有的视频生成节点，用于 clip.nodeId 悬空时复用而不是再建一个孤儿。 */
async function findClipNodeId(call: CanvasCall, clip: MtrackClip, signal: AbortSignal) {
  const listed = await call({ name: "findCanvasNodes", args: { query: clip.clipId, limit: 50 } }, signal) as { nodes?: { id: string; label?: string; type?: string }[] };
  const matched = (listed?.nodes ?? []).filter(node => (node.type ?? "").includes("videoGenerationNode") && labelMatchesCard(node.label ?? "", clip.clipId));
  return matched[0]?.id;
}

/**
 * 复用镜头上已有的节点；节点已被删除就按分镜号找回同名节点；都没有才新建。
 * ACT: 工程里的 nodeId 可能指向已删除的节点（画布被改写后常见），直接复用会让后续 nodeTools 报「节点不存在」。
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
  if (clip.nodeId && await readNodeDetail(call, clip.nodeId, signal)) return clip.nodeId;
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
 * 解析 referenceIds 对应的画布资产节点。assetIndex.json 的 nodeId 由 planOperator 产出且**从不回填**
 * （buildAssetIndex 写 `card.nodeId ?? null`，resolveReferences 不产出 nodeId），只认它会让参考图被整批
 * 静默跳过、生成退化成纯文生视频（实测 freevideo job 的 spec.media 为空）；这里以画布 label 兜底。
 * 资产节点必须已出图：没出图的参考连线也传不出素材。
 */
async function resolveReferenceSources(options: {
  call: CanvasCall;
  clip: MtrackClip;
  cards: readonly AssetIndexCard[];
  signal: AbortSignal;
}) {
  const { call, clip, cards, signal } = options;
  const picked: { cardId: string; nodeId: string; sourceHandle: string }[] = [];
  const missing: string[] = [];
  for (const id of clip.referenceIds) {
    const card = cards.find(item => item.id === id);
    const candidates = [...new Set([card?.nodeId, ...(await findCardNodeIds(call, id, signal))].filter((value): value is string => !!value))];
    let chosen: { cardId: string; nodeId: string; sourceHandle: string } | undefined;
    for (const nodeId of candidates) {
      const detail = await readNodeDetail(call, nodeId, signal);
      if (!detail) continue;
      const sourceHandle = sourceHandleOf(detail);
      if (!sourceHandle || !imagePathOf(detail)) continue;
      chosen = { cardId: id, nodeId, sourceHandle };
      break;
    }
    if (chosen) picked.push(chosen);
    else missing.push(id);
  }
  return { picked, missing };
}

/**
 * 把 referenceIds 对应的画布节点连到视频节点 in 端口，并按 referenceIds 顺序写 referenceOrder。
 * 只要有参考没接上就整镜报错：部分接线会让 {{ref N}} 编号与声明错位，生成结果对不上参考图还看不出原因。
 */
async function connectReferences(options: {
  bridge: CanvasBridge;
  clip: MtrackClip;
  nodeId: string;
  cards: readonly AssetIndexCard[];
  signal: AbortSignal;
}) {
  const { bridge, clip, nodeId, cards, signal } = options;
  if (!clip.referenceIds.length) return 0;
  const call = requireCall(bridge);
  const { picked, missing } = await resolveReferenceSources({ call, clip, cards, signal });
  if (missing.length) {
    throw new Error(`参考图未就绪：${missing.join("、")} 在画布上没有可用产出（需要已装配资产节点且已出图），请先补齐再生成`);
  }
  await call({
    name: "connectNodes",
    args: {
      connections: picked.map(item => ({ source: item.nodeId, sourceHandle: item.sourceHandle, target: nodeId, targetHandle: "in" })),
    },
  }, signal);
  await callTool(bridge, nodeId, "node:setReferenceOrder", {
    handleId: "in",
    sources: picked.map(item => ({ nodeId: item.nodeId, sourceHandle: item.sourceHandle })),
  }, signal).catch(() => {
    // ACT: 顺序写入失败不阻断生成——参考图仍已连线，只是 {{ref N}} 编号回退到入边顺序。
  });
  return picked.length;
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

/** 轮询到终态；aborted 由 signal 抛出，不吞掉。 */
async function waitForSettled(bridge: CanvasBridge, nodeId: string, signal: AbortSignal) {
  const startedAt = Date.now();
  while (true) {
    signal.throwIfAborted();
    const status = await callTool(bridge, nodeId, "node:getGenerationStatus", {}, signal) as GenerationStatus;
    if (status?.status === "succeeded") return { ok: true as const, assetPath: assetPathOf(status) };
    if (status?.status === "failed") return { ok: false as const, error: status.error || "视频生成失败" };
    if (Date.now() - startedAt > pollLimit) return { ok: false as const, error: "等待生成结果超时（1 小时），请到画布查看该节点状态" };
    await delay(signal, pollDelay);
  }
}

export type ClipHooks = {
  onStart(clip: MtrackClip, nodeId: string): Promise<void> | void;
  onSucceeded(clip: MtrackClip, nodeId: string, assetPath: string): Promise<void> | void;
  onFailed(clip: MtrackClip, nodeId: string, error: string): Promise<void> | void;
  /** 循环因暂停闸门退出时调用一次；批次自然跑完（含最后一镜跑到一半才按暂停）不调用。 */
  onPaused?(): Promise<void> | void;
};

async function dispatchClips(options: {
  bridge: CanvasBridge;
  batchId: string;
  clips: MtrackClip[];
  cards: readonly AssetIndexCard[];
  videoModel?: VideoModel;
  hooks: ClipHooks;
  signal: AbortSignal;
  gate: { paused: boolean };
  global?: { style?: string; systemPrompt?: string };
}) {
  const { bridge, clips, cards, videoModel, global, hooks, signal, gate } = options;
  // ACT: 单条 canvas 调用有 120s 上限，这里只读一次概览；没有节点类型说明插件未启用，直接失败。
  const call = requireCall(bridge);
  const overview = await call({ name: "getCanvas", args: { include: ["nodeTypes"], limit: 100 } }, signal) as {
    availableNodeTypes?: { type: string; label: string }[];
    viewport?: { x: number; y: number; zoom: number };
  };
  const available = overview?.availableNodeTypes ?? [];
  if (!available.length) throw new Error("画布没有可用节点类型，请先启用视频生成节点插件");
  const viewport = overview?.viewport ?? { x: 0, y: 0, zoom: 1 };
  const origin = { x: Math.round(viewport.x + 120), y: Math.round(viewport.y + 120) };
  // ACT: 逐镜串行——本机 GPU 串行更稳，同时跑多镜只会互相抢显存（runbook §六：同一时刻 1–2 个）。
  let stoppedByPause = false;
  for (const [index, clip] of clips.entries()) {
    signal.throwIfAborted();
    // 暂停闸门只在镜头之间检查，绝不打断正在跑的镜头（对齐 LSC：当前镜跑完再停，不产生半截视频）。
    if (gate.paused) {
      stoppedByPause = true;
      break;
    }
    let nodeId = "";
    try {
      nodeId = await ensureNode({ bridge, clip, index, available, origin, signal });
      // 参考接不上时 connectReferences 抛错：不带着缺失参考上场（runbook §一 步 2）。
      const linked = await connectReferences({ bridge, clip, nodeId, cards, signal });
      await configureNode({ bridge, clip, nodeId, videoModel, signal });
      const prompt = buildPrompt(clip, cards, linked > 0, global);
      if (!prompt.trim()) throw new Error("该镜没有提示词，请先补全画面描述");
      await callTool(bridge, nodeId, "node:setPrompt", { prompt }, signal);
      await hooks.onStart(clip, nodeId);
      await callTool(bridge, nodeId, "node:generateVideo", {}, signal);
      const result = await waitForSettled(bridge, nodeId, signal);
      if (result.ok) {
        if (!result.assetPath) throw new Error("节点报告生成成功但没有返回视频路径");
        await hooks.onSucceeded(clip, nodeId, result.assetPath);
      } else {
        await hooks.onFailed(clip, nodeId, result.error);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      await hooks.onFailed(clip, nodeId, messageOf(error));
    }
  }
  // 最后一镜跑到一半才按暂停时 gate.paused 已置位但循环已走完，属正常收尾，不报暂停。
  if (stoppedByPause) await hooks.onPaused?.();
}

/** 发起直连派工：先解析画布与节点类型，拿到即返回句柄，逐镜循环在 run 上后台进行。 */
export async function beginDirectDispatch(options: {
  bridge: CanvasBridge;
  batchId: string;
  clips: MtrackClip[];
  cards: readonly AssetIndexCard[];
  videoModel?: VideoModel;
  global?: { style?: string; systemPrompt?: string };
  hooks: ClipHooks;
  signal?: AbortSignal;
}): Promise<DispatchHandle> {
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
  }
  requireCall(options.bridge);
  const gate = { paused: false };
  const run = dispatchClips({ ...options, signal: controller.signal, gate });
  run.catch(() => {}); // ACT: 调用方只 abort 不 await run 时不产生未处理拒绝；错误仍会经由 await run 抛出。
  return { batchId: options.batchId, run, abort: () => controller.abort(), pause: () => { gate.paused = true; } };
}

/** 取消批次：对在跑的镜头逐个 node:cancelGeneration，再由 hooks 把状态回写 pending。 */
export async function beginDirectCancel(options: {
  bridge: CanvasBridge;
  batchId: string;
  clips: MtrackClip[];
  onCancelled(clip: MtrackClip, nodeId: string): Promise<void> | void;
  signal?: AbortSignal;
}): Promise<DispatchHandle> {
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
  }
  const { bridge, batchId, clips, onCancelled } = options;
  const run = (async () => {
    for (const clip of clips) {
      controller.signal.throwIfAborted();
      if (!clip.nodeId) continue;
      try {
        await callTool(bridge, clip.nodeId, "node:cancelGeneration", {}, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // ACT: 节点已卸载/已结束时取消失败属正常收尾，继续回写其余镜头。
      }
      await onCancelled(clip, clip.nodeId);
    }
  })();
  run.catch(() => {});
  // 取消批次不是可暂停的循环，pause 空实现以满足 DispatchHandle 契约。
  return { batchId, run, abort: () => controller.abort(), pause: () => {} };
}
