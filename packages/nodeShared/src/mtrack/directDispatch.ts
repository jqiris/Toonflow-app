/**
 * 多轨派工的画布只读内核：断点续跑对账与参考来源解析。
 *
 * 旧版「为每镜建画布节点、逐镜 node:generateVideo 直连派工」的链路已整体删除
 * （现行派工走服务端媒体任务通道，见 mediaDispatch.ts / mediaTask.ts），本模块只剩两类活口：
 *   - readClipGeneration：只读某一镜画布节点的当前生成状态，供编辑器断点续跑对账；
 *   - resolveReferenceSources 及其依赖（findCardNodeIds / readNodeDetail / labelMatchesCard /
 *     mediaPathOf / sourceHandleOf）：按 referenceIds 反查画布资产节点的可用产出，
 *     与 node:readReferenceMap 共用，保证「agent 查到的映射」与「派工实际会接的来源」同源。
 * 首镜实测 738.5s 的历史约束仍在：对账与缩略图都是单次查询、不轮询、不改工程。
 */

import type { AssetIndexCard, MtrackClip } from "./mtrackProject";

export type CanvasBridge = {
  id: string;
  tools: unknown[];
  call?(request: { name: string; args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>;
};

export type GenerationStatus = { status: "idle" | "running" | "succeeded" | "failed"; outputs?: Record<string, unknown>; error?: string; cancellationRequested?: boolean };

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
