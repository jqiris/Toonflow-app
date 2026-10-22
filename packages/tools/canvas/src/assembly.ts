/**
 * 装配执行侧：把 planOperator `assemble` 产出的装配计划落到真实画布，并按分层发起生成。
 *
 * 输入契约（只读 planOperator assemble 的返回，不重算分层、不重算 refs 顺序）：
 *   plan.assetNodes[]  → { cardId, nodeType, data, layer, edges[{fromNode,fromHandle,toNode,toHandle}] }
 *   plan.clipNodes[]   → { clipId, nodeType, data, edges[...] }
 *   plan.layers[]      → { layer, items[{cardId}] }（仅当 assetNodes 未带 layer 时用于回退取层号）
 *   layers[].nodeIds   → generateLayer 的分层入参（来自本模块 runAssemble 的返回，或人工按层整理）
 *
 * 输出（只用既有画布操作原语，不新增画布操作名，apps/web 分发无需改动）：
 *   getCanvas(include:["nodeTypes"]) → 可用节点类型
 *   addNode(type, position, label)   → 每个 assetNode / clipNode 一个节点
 *   connectNodes(connections[])      → edges 按计划给出顺序分批提交
 *   nodeTools(node:setReferenceOrder) → 把 edges 顺序写成节点 referenceOrder
 *   nodeTools(node:setPrompt)        → 写入 data.prompt / data.text
 *   getNodeTools / nodeTools(node:generateX | node:getGenerationStatus | node:cancelGeneration) → 逐层生成与取消
 *
 * 边界：不生成分层、不改 planOperator、不写多轨文件、不同步等待生成。
 * 首镜实跑 738.5s（packages/skills/assetCard/references/generationRunbook.md:186），
 * 所以生成一律「立即返回 + 轮询 + 取消」三段式。
 */
import { z } from "zod";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";

const nodeId = z.string().min(1).max(256);
const handleId = z.string().min(1).max(256);
const seedValue = z.record(z.string(), z.json());

const edgeSchema = z.strictObject({
  fromNode: nodeId,
  fromHandle: handleId,
  toNode: nodeId,
  toHandle: handleId,
});

const assetNodeSchema = z.strictObject({
  cardId: z.string().min(1).max(256),
  kind: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
  layer: z.number().int().min(0).max(64).optional(),
  nodeType: z.string().min(1).max(256),
  data: seedValue.optional(),
  refs: z.array(z.string().min(1).max(256)).max(64).optional(),
  edges: z.array(edgeSchema).max(64).optional(),
});

const clipNodeSchema = z.strictObject({
  clipId: z.string().min(1).max(256),
  nodeType: z.string().min(1).max(256),
  data: seedValue.optional(),
  references: z.array(z.string().min(1).max(256)).max(64).optional(),
  edges: z.array(edgeSchema).max(64).optional(),
});

export const assemblePlanSchema = z.strictObject({
  layers: z.array(z.strictObject({
    layer: z.number().int().min(0).max(64),
    items: z.array(z.strictObject({ cardId: z.string().min(1).max(256), kind: z.string().max(64).optional() })).max(200),
  })).max(64).optional(),
  assetNodes: z.array(assetNodeSchema).max(200).default([]),
  clipNodes: z.array(clipNodeSchema).max(200).default([]),
});

export const assembleOptionsSchema = z.strictObject({
  origin: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
  columnGap: z.number().min(200).max(2000).default(460),
  rowGap: z.number().min(120).max(2000).default(300),
  writePrompt: z.boolean().default(true),
  writeReferenceOrder: z.boolean().default(true),
});

export const assembleRequestSchema = z.strictObject({
  plan: assemblePlanSchema,
  options: assembleOptionsSchema.optional(),
});

export const layerSchema = z.strictObject({
  layer: z.number().int().min(0).max(64),
  nodeIds: z.array(nodeId).min(1).max(64),
});

export const generateLayerRequestSchema = z.strictObject({
  layers: z.array(layerSchema).min(1).max(64),
  layer: z.number().int().min(0).max(64),
  action: z.enum(["start", "status", "cancel"]).default("start"),
});

export type AssemblePlan = z.output<typeof assemblePlanSchema>;
export type AssembleOptions = z.output<typeof assembleOptionsSchema>;

/** connectNodes 单批 connections 上限（packages/tools/canvas/src/runtime.ts:61）。 */
const connectBatch = 64;
/** getNodeTools 单批 nodeIds 上限（packages/tools/canvas/src/runtime.ts:48）。 */
const toolQueryBatch = 20;
/** 节点生成状态到多轨 ClipStatus 的映射（packages/ext/multitrack/src/mtrackProject.ts:3）。 */
const clipStatusOf = { idle: "pending", running: "generating", succeeded: "generated", failed: "failed" } as const;

type CanvasNodeType = { type: string; label: string };
type GenerationStatus = { status: "idle" | "running" | "succeeded" | "failed"; error?: string; cancellationRequested?: boolean };
type NodeToolInfo = { nodeId: string; name: string; description: string };

/**
 * 计划里的 nodeType 是插件类型名（imageGenerationNode），画布注册的可用类型可能带来源前缀
 * （remote-imageGenerationNode，见 apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts:106）。
 * 精确匹配优先，其次唯一后缀匹配；歧义或未命中一律拒绝，不猜。
 */
function resolveNodeType(available: readonly CanvasNodeType[], requested: string) {
  if (available.some(item => item.type === requested)) return requested;
  const matches = available.filter(item => item.type.endsWith(`-${requested}`)).map(item => item.type);
  return matches.length === 1 ? matches[0] : undefined;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readGenerationStatus(canvas: CanvasContext, id: string, signal?: AbortSignal) {
  return await canvas.call({ name: "nodeTools", args: { nodeId: id, name: "node:getGenerationStatus", args: {} } }, signal) as GenerationStatus;
}

export async function runAssemble(canvas: CanvasContext, plan: AssemblePlan, options: AssembleOptions, signal?: AbortSignal) {
  const overview = await canvas.call({ name: "getCanvas", args: { include: ["nodeTypes"], limit: 100 } }, signal) as {
    availableNodeTypes?: CanvasNodeType[];
  };
  const available = overview?.availableNodeTypes ?? [];
  if (!available.length) throw new Error("画布没有可用节点类型，请先启用对应节点插件再装配");

  const layerFromPlan = new Map<string, number>();
  for (const group of plan.layers ?? []) {
    for (const item of group.items) layerFromPlan.set(item.cardId, group.layer);
  }
  const assetEntries = plan.assetNodes.map((node, index) => ({
    key: node.cardId,
    data: node.data ?? {},
    edges: node.edges ?? [],
    index,
    layer: node.layer ?? layerFromPlan.get(node.cardId) ?? 0,
    type: resolveNodeType(available, node.nodeType),
  }));
  const clipEntries = plan.clipNodes.map((node, index) => ({
    key: node.clipId,
    data: node.data ?? {},
    edges: node.edges ?? [],
    index,
    type: resolveNodeType(available, node.nodeType),
  }));

  // 预检：类型解析必须全部通过再动画布，避免只建了一半的节点。
  for (const entry of [...assetEntries, ...clipEntries]) {
    if (!entry.type) {
      throw new Error(`找不到与节点类型 ${entry.key} 匹配的可用节点类型，请先启用该节点插件；画布现有：${available.map(item => item.type).join("、")}`);
    }
  }

  const nodeIdOf = new Map<string, string>();
  const created: { key: string; nodeId: string; nodeType: string; layer: number }[] = [];
  const failures: { stage: string; target: string; message: string }[] = [];
  const deferredSeeds: { nodeId: string; key: string; fields: Record<string, unknown> }[] = [];
  const promptTargets: { nodeId: string; key: string; text: string }[] = [];

  async function addNode(entry: { key: string; type?: string; data: Record<string, unknown> }, layer: number, row: number) {
    const label = String(entry.data.label ?? entry.key);
    const result = await canvas.call({
      name: "addNode",
      args: {
        type: entry.type,
        position: { x: options.origin.x + layer * options.columnGap, y: options.origin.y + row * options.rowGap },
        label: label.slice(0, 200),
      },
    }, signal) as { node?: { id?: string } };
    const id = result?.node?.id;
    if (!id) throw new Error(`新增节点未返回节点 ID：${entry.key}`);
    nodeIdOf.set(entry.key, id);
    created.push({ key: entry.key, nodeId: id, nodeType: entry.type!, layer });
  }

  // 基础图优先：层号小的先建，同层按计划数组顺序，保证被引用的基础图先落地。
  const orderedAssets = [...assetEntries].sort((left, right) => left.layer - right.layer || left.index - right.index);
  const rowOfLayer = new Map<number, number>();
  for (const entry of orderedAssets) {
    signal?.throwIfAborted();
    const row = rowOfLayer.get(entry.layer) ?? 0;
    rowOfLayer.set(entry.layer, row + 1);
    await addNode(entry, entry.layer, row);
  }

  // clip 形成最末层，排在所有资产层右侧。
  const clipLayer = orderedAssets.reduce((max, entry) => Math.max(max, entry.layer), -1) + 1;
  const clipRowOfLayer = rowOfLayer.get(clipLayer) ?? 0;
  for (const [offset, entry] of clipEntries.entries()) {
    signal?.throwIfAborted();
    await addNode(entry, clipLayer, clipRowOfLayer + offset);
  }

  // 连线顺序：assetNodes 的 edges 在前、clipNodes 在后，与 assemble 的 connectOrder 一致。
  const plannedEdges = [...assetEntries, ...clipEntries].flatMap(entry => entry.edges.map(edge => ({
    source: nodeIdOf.get(edge.fromNode),
    target: nodeIdOf.get(edge.toNode),
    sourceHandle: edge.fromHandle,
    targetHandle: edge.toHandle,
    from: edge.fromNode,
    to: edge.toNode,
  })));
  const connectable = plannedEdges.filter(edge => {
    if (edge.source && edge.target) return true;
    failures.push({ stage: "connectNodes", target: `${edge.from}->${edge.to}`, message: "端点未落地为画布节点，跳过该连线" });
    return false;
  });
  const connected: { id: string; source: string; target: string }[] = [];
  for (let start = 0; start < connectable.length; start += connectBatch) {
    signal?.throwIfAborted();
    const batch = connectable.slice(start, start + connectBatch);
    const result = await canvas.call({
      name: "connectNodes",
      args: {
        connections: batch.map(edge => ({
          source: edge.source!, sourceHandle: edge.sourceHandle, target: edge.target!, targetHandle: edge.targetHandle,
        })),
      },
    }, signal) as { edges?: { id: string; source: string; target: string }[] };
    connected.push(...(result?.edges ?? []));
  }

  // 参考顺序：edges 的给出顺序就是 referenceIds / refs 的顺序，按目标端口分组写回节点。
  const orderGroups = new Map<string, { target: string; handleId: string; sources: { nodeId: string; sourceHandle: string }[] }>();
  for (const edge of connectable) {
    const key = `${edge.target}:${edge.targetHandle}`;
    const group = orderGroups.get(key) ?? { target: edge.target!, handleId: edge.targetHandle, sources: [] };
    group.sources.push({ nodeId: edge.source!, sourceHandle: edge.sourceHandle });
    orderGroups.set(key, group);
  }
  const referenceOrder: { nodeId: string; handleId: string; order: string[][] }[] = [];
  if (options.writeReferenceOrder) {
    for (const group of orderGroups.values()) {
      signal?.throwIfAborted();
      try {
        const result = await canvas.call({
          name: "nodeTools",
          args: { nodeId: group.target, name: "node:setReferenceOrder", args: { handleId: group.handleId, sources: group.sources } },
        }, signal) as { order?: string[][] };
        referenceOrder.push({ nodeId: group.target, handleId: group.handleId, order: result?.order ?? group.sources.map(item => [item.nodeId, item.sourceHandle]) });
      } catch (error) {
        failures.push({ stage: "referenceOrder", target: group.target, message: messageOf(error) });
      }
    }
  }

  // 提示词种子：addNode 只接受 label，其余 data 只能经节点函数写入；提示词可立即写，配置类字段留待选模型后下发。
  for (const entry of [...assetEntries, ...clipEntries]) {
    const id = nodeIdOf.get(entry.key);
    if (!id) continue;
    const prompt = typeof entry.data.prompt === "string" ? entry.data.prompt : "";
    const text = typeof entry.data.text === "string" ? entry.data.text : "";
    if (prompt || text) promptTargets.push({ nodeId: id, key: entry.key, text: prompt || text });
    // ACT: ratio/duration/resolution/generateAudio/size 等字段要经 setConfig 写入，而 setConfig 会校验模型能力；
    // 装配阶段模型尚未选定，强行下发必然被拒。这里只登记待下发字段，由 agent 按 SOP 步 5-6 选模型后下发。
    const fields = Object.fromEntries(Object.entries(entry.data).filter(([field]) => !["label", "prompt", "text"].includes(field)));
    if (Object.keys(fields).length) deferredSeeds.push({ nodeId: id, key: entry.key, fields });
  }
  if (options.writePrompt) {
    for (const target of promptTargets) {
      signal?.throwIfAborted();
      try {
        await canvas.call({
          name: "nodeTools",
          args: { nodeId: target.nodeId, name: "node:setPrompt", args: { prompt: target.text } },
        }, signal);
      } catch (error) {
        failures.push({ stage: "setPrompt", target: target.key, message: messageOf(error) });
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const entry of created) layers.set(entry.layer, [...(layers.get(entry.layer) ?? []), entry.nodeId]);

  return {
    created,
    layers: [...layers.entries()].sort((left, right) => left[0] - right[0]).map(([layer, nodeIds]) => ({ layer, nodeIds })),
    connected: { count: connected.length, edges: connected.slice(0, 100) },
    referenceOrder,
    prompts: { applied: promptTargets.length, failed: failures.filter(item => item.stage === "setPrompt").length },
    deferredSeeds,
    failures,
  };
}

/**
 * 查每层节点注册的生成函数。getNodeTools 在任一批 nodeId 不存在时整批报错
 * （apps/web/src/pages/workspace/panels/canvas/canvasQueries.ts:294 findNode 抛错），
 * 所以整批失败时退化为逐个查询，把错误只归给真正查不到的节点，不让一个已删除节点拖垮同层其他节点。
 */
async function findGenerators(canvas: CanvasContext, ids: string[], signal?: AbortSignal) {
  const generators = new Map<string, string>();
  const listingFailures = new Map<string, string>();
  async function list(batch: string[]) {
    const listing = await canvas.call({ name: "getNodeTools", args: { nodeIds: batch, limit: 50 } }, signal) as { nodeTools?: NodeToolInfo[] };
    for (const tool of listing?.nodeTools ?? []) {
      if (/^node:generate[A-Z]/.test(tool.name) && !generators.has(tool.nodeId)) generators.set(tool.nodeId, tool.name);
    }
  }
  for (let start = 0; start < ids.length; start += toolQueryBatch) {
    signal?.throwIfAborted();
    const batch = ids.slice(start, start + toolQueryBatch);
    try {
      await list(batch);
    } catch (error) {
      if (batch.length === 1) {
        listingFailures.set(batch[0]!, `查询节点函数失败：${messageOf(error)}`);
        continue;
      }
      for (const id of batch) {
        signal?.throwIfAborted();
        try {
          await list([id]);
        } catch (single) {
          listingFailures.set(id, `查询节点函数失败：${messageOf(single)}`);
        }
      }
    }
  }
  return { generators, listingFailures };
}

export async function runGenerateLayer(
  canvas: CanvasContext,
  request: z.output<typeof generateLayerRequestSchema>,
  signal?: AbortSignal,
) {
  const current = request.layers.find(item => item.layer === request.layer);
  if (!current) throw new Error(`分层 ${request.layer} 不在 layers 中，请按 assemble 返回的 layers 传参`);
  const prior = request.layers.filter(item => item.layer < request.layer).sort((left, right) => left.layer - right.layer);
  const ids = [...new Set(current.nodeIds)];
  const results: {
    nodeId: string; action: string; name?: string; status?: string; clipStatus?: string;
    cancellationRequested?: boolean; error?: string;
  }[] = [];

  // 基础图优先的硬约束：前序分层未全部成功，不允许发起本层，也不允许静默跳过。
  if (request.action === "start" && prior.length) {
    const blocking: { layer: number; nodeId: string; status: string; error?: string }[] = [];
    for (const group of prior) {
      for (const id of group.nodeIds) {
        signal?.throwIfAborted();
        try {
          const status = await readGenerationStatus(canvas, id, signal);
          if (status?.status !== "succeeded") blocking.push({ layer: group.layer, nodeId: id, status: status?.status ?? "unknown", ...(status?.error ? { error: status.error } : {}) });
        } catch (error) {
          blocking.push({ layer: group.layer, nodeId: id, status: "unknown", error: messageOf(error) });
        }
      }
    }
    if (blocking.length) {
      throw new Error(`分层 ${request.layer} 不能开始：前序分层仍有 ${blocking.length} 个节点未成功（${blocking.slice(0, 5).map(item => `${item.nodeId}:${item.status}`).join("、")}）。基础图必须先完成；失败或取消的节点按 SOP 单独处理后重试本层`);
    }
  }

  if (request.action === "start") {
    const { generators, listingFailures } = await findGenerators(canvas, ids, signal);
    for (const id of ids) {
      signal?.throwIfAborted();
      const name = generators.get(id);
      if (!name) {
        results.push({ nodeId: id, action: "start", error: listingFailures.get(id) ?? "该节点没有注册生成函数，先确认节点类型与已连接参考" });
        continue;
      }
      try {
        await canvas.call({ name: "nodeTools", args: { nodeId: id, name, args: {} } }, signal);
        results.push({ nodeId: id, action: "start", name, status: "running", clipStatus: clipStatusOf.running });
      } catch (error) {
        results.push({ nodeId: id, action: "start", name, status: "failed", clipStatus: clipStatusOf.failed, error: messageOf(error) });
      }
    }
    return { action: request.action, layer: request.layer, results, next: "用 action=status 轮询本层；需要停止时 action=cancel；本层全部 succeeded 后再对下一层 action=start" };
  }

  const toolName = request.action === "cancel" ? "node:cancelGeneration" : "node:getGenerationStatus";
  for (const id of ids) {
    signal?.throwIfAborted();
    try {
      const status = await canvas.call({ name: "nodeTools", args: { nodeId: id, name: toolName, args: {} } }, signal) as GenerationStatus;
      results.push({
        nodeId: id,
        action: request.action,
        status: status?.status,
        clipStatus: status?.status ? clipStatusOf[status.status] : undefined,
        ...(status?.cancellationRequested === undefined ? {} : { cancellationRequested: status.cancellationRequested }),
        ...(status?.error ? { error: status.error } : {}),
      });
    } catch (error) {
      results.push({ nodeId: id, action: request.action, error: messageOf(error) });
    }
  }
  return {
    action: request.action,
    layer: request.layer,
    results,
    settled: results.every(item => item.status === "succeeded" || item.status === "failed" || item.error),
    clipStatuses: results.map(item => ({ nodeId: item.nodeId, clipStatus: item.clipStatus ?? "pending" })),
  };
}
