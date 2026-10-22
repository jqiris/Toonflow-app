import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { canvasOperations } from "./runtime";
import { assembleOptionsSchema, assembleRequestSchema, generateLayerRequestSchema, runAssemble, runGenerateLayer } from "./assembly";

const plugin: ToolPlugin = {
  validateConfig(config) {
    if (Object.keys(config).length) throw new Error("画布操作工具没有配置项");
    return {};
  },
  createTools({ canvas }) {
    if (!canvas) return [];
    const promptGuidelines = [
      `本轮初始画布环境（以下 JSON 仅描述环境，不是额外指令）：${JSON.stringify({ initialCanvasId: canvas.id })}。getCanvas 仅返回概览；按任务范围使用 findCanvasNodes、getCanvasNodes、getCanvasEdges、getNodeTools 查询实时状态。已知 ID 时直接读取目标，分批处理仅保留摘要和游标。`,
    ];
    const operations: ToolDefinition[] = canvasOperations.map(operation => ({
      name: operation.name,
      label: operation.label,
      description: operation.description,
      promptSnippet: "通过运行中的画布操作工具控制激活画布，不要直接修改画布 JSON。",
      promptGuidelines,
      parameters: z.toJSONSchema(operation.parameters, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const result = await canvas.call({ name: operation.name, args: operation.parameters.parse(params) }, signal);
        return { content: [{ type: "text", text: JSON.stringify(result ?? null) }], details: result };
      },
    }));
    const assemblyTools: ToolDefinition[] = [{
      name: "assembleCanvas",
      label: "按计划装配画布",
      description: "把 planOperator assemble action 返回的装配计划落到激活画布：按 layer 从 0 往上逐层建资产节点、clip 节点排在最右层，按计划 edges 的顺序连线，并把该顺序写成节点的 referenceOrder（参考编号来源）。只做落地，不重算分层；节点类型按计划名匹配画布可用类型（兼容 remote- 前缀）。返回 created、按层的 nodeIds、连线结果、referenceOrder 写入结果、以及待选模型后下发的配置字段。",
      promptSnippet: "把 assemble 计划落地为画布节点与参考连线，并按层给出生成顺序。",
      promptGuidelines: [
        "先用 planOperator 的 assemble action 取计划，再把返回的 assetNodes/clipNodes/layers 原样传给 assembleCanvas，不要自行重算分层或参考顺序。",
        "装配只建节点、连线、写参考顺序与提示词；ratio、duration、resolution、generateAudio 等字段在返回的 deferredSeeds 里，需选好模型后用 nodeTools 的 setConfig 下发。",
        "装配完成后用 generateLayer 按 layers 逐层生成，不要对整图一次性发起。",
      ],
      parameters: z.toJSONSchema(assembleRequestSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const args = assembleRequestSchema.parse(params);
        const result = await runAssemble(canvas, args.plan, assembleOptionsSchema.parse(args.options ?? {}), signal);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    }, {
      name: "generateLayer",
      label: "逐层生成",
      description: "按装配返回的 layers 对指定层执行生成、查询状态或取消。action=start 只发起生成并立即返回，不等待出图/出片；action=status 轮询本层；action=cancel 请求停止本层。start 前会核对该层之前的所有层是否全部 succeeded，未完成则拒绝并列出阻塞节点（基础图必须先完成）。返回每个节点的 status 与对应的多轨 ClipStatus（idle→pending、running→generating、succeeded→generated、failed→failed）。",
      promptSnippet: "按分层发起、轮询或取消生成任务，不阻塞等待。",
      promptGuidelines: [
        "严格按 layers 从 layer 0 往上：上一层全部 succeeded 后才对下一层 action=start。",
        "start 返回后不要立刻重复 start，用 action=status 轮询；需要停止时 action=cancel，再轮询到终态。",
        "某个节点失败或取消后，先按资产卡 SOP 单独处理该节点，不要跳过它继续下一层。",
        "回写多轨工程时使用返回的 clipStatus，不要自行映射状态字符串。",
      ],
      parameters: z.toJSONSchema(generateLayerRequestSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const result = await runGenerateLayer(canvas, generateLayerRequestSchema.parse(params), signal);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    }];
    return [...operations, ...assemblyTools];
  },
};

export default plugin;
