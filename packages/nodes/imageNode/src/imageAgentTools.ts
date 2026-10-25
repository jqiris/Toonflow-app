import { computed } from "vue";
import type { Ref } from "vue";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { nodeTools, z, useNodeToolsContext } from "@toonflow/nodes-scaffold/runtime";
import { useImageVariationNode } from "./useImageVariationNode";
import { buildPanoramaPrompt, type PanoramaMode } from "./imagePanorama";
import { multiAnglePresets, readMultiAngleSettings, buildMultiAnglePrompt } from "./imageMultiAngle";
import { ensureRemoteNodePlugin } from "@toonflow/node-shared/enableRemoteNodePlugin";
import imagePanorama from "./components/imagePanorama.vue";

export function registerImagePanoramaAgentTools(deps: {
  node: { data: Record<string, unknown> };
  nodeTypes: Readonly<Ref<Record<string, unknown> | undefined>>;
  reloadRemoteNode: ((type: string) => Promise<void>) | undefined;
  panorama: Ref<InstanceType<typeof imagePanorama> | undefined>;
  previewUrl: Readonly<Ref<string>>;
  files: unknown;
  ai?: { getMediaModels(signal?: AbortSignal): Promise<NodeMediaModel[]> };
  source: () => { url: string; mimeType: string } | undefined;
}) {
  const createVariation = useImageVariationNode();
  const getNodeTools = useNodeToolsContext();
  const remoteNodeTypes = computed(() => deps.nodeTypes.value ?? {});
  // ACT: useVueFlow().nodeTypes 类型为 Ref<NodeTypesObject | undefined>，下游 enableRemoteNodePlugin 期望 Record<string, unknown>，此处按空对象收敛。

  nodeTools.register({
    name: "createPanorama",
    description: "根据当前节点图片生成全景图子节点（720°球面或360°柱面），返回子节点 ID 与后续步骤提示；节点没有图片时报错。",
    parameters: z.strictObject({ mode: z.enum(["sphere", "cylinder"]).optional() }),
    timeoutMs: 120000,
    async execute(args, { signal }) {
      signal?.throwIfAborted();
      const mode: PanoramaMode = args.mode ?? "sphere";
      if (!deps.source()) throw new Error("节点没有图片，无法生成全景图");
      const stage = deps.panorama.value;
      if (!stage) throw new Error("全景组件未就绪");
      if (stage.busy) throw new Error("全景处理中，请稍后重试");
      const data = deps.node.data;
      const label = mode === "sphere" ? "720°全景图" : "360°环绕图";
      const result = await createVariation({
        label,
        prompt: buildPanoramaPrompt(mode),
        model: typeof data.model === "string" ? data.model : "",
        size: typeof data.size === "string" ? data.size : "",
        ratio: mode === "sphere" ? "2:1" : "4:1",
      }, signal);
      return { nodeId: result.nodeId, label, mode, hint: "已创建全景图子节点，请用 node:generateImage 启动生成，生成后用 node:capturePanorama 截取角度" };
    },
  });

  nodeTools.register({
    name: "capturePanorama",
    description: "在全景预览中按指定角度截图，自动创建角度图节点并连线；支持球面/柱面模式、偏航角、俯仰角、视场角、张数（1/4/12）和布局；自动启用图片节点插件。",
    parameters: z.strictObject({
      mode: z.enum(["sphere", "cylinder"]).optional(),
      yaw: z.number().min(0).max(360).optional(),
      pitch: z.number().min(-85).max(85).optional(),
      fov: z.number().min(20).max(100).optional(),
      count: z.number().int().refine(v => [1, 4, 12].includes(v)).optional(),
      layout: z.enum(["combined", "separate"]).optional(),
    }),
    timeoutMs: 300000,
    async execute(args, { signal }) {
      signal?.throwIfAborted();
      const mode: PanoramaMode = args.mode ?? "sphere";
      await ensureRemoteNodePlugin({ name: "imageNode", label: "图片", nodeTypes: remoteNodeTypes, reloadRemoteNode: deps.reloadRemoteNode });
      signal?.throwIfAborted();
      const stage = deps.panorama.value;
      if (!stage) throw new Error("全景组件未就绪");
      const result = await stage.agentCapture(mode, {
        yaw: args.yaw,
        pitch: args.pitch,
        fov: args.fov,
        count: args.count as 1 | 4 | 12 | undefined,
        layout: args.layout,
      });
      return { ...result, mode, hint: "已创建角度图节点并连线" };
    },
  });

  nodeTools.register({
    name: "generateMultiAngle",
    description: "根据当前节点图片生成多角度子节点并自动启动生成；支持预设方位角、自定义方位/俯仰/距离/镜头，可选指定图片模型；自动启用图片生成节点插件。",
    parameters: z.strictObject({
      preset: z.enum(multiAnglePresets.map(p => p.id)).optional(),
      azimuth: z.number().min(-180).max(180).optional(),
      elevation: z.number().min(-80).max(80).optional(),
      distance: z.number().min(2).max(10).optional(),
      lens: z.enum(["standard", "wide"]).optional(),
      providerId: z.string().min(1).optional(),
      modelId: z.string().min(1).optional(),
    }).refine(a => (a.providerId === undefined) === (a.modelId === undefined), "providerId 与 modelId 必须同时提供"),
    timeoutMs: 120000,
    async execute(args, { signal }) {
      signal?.throwIfAborted();
      await ensureRemoteNodePlugin({ name: "imageGenerationNode", label: "图片生成", nodeTypes: remoteNodeTypes, reloadRemoteNode: deps.reloadRemoteNode });
      signal?.throwIfAborted();
      const data = deps.node.data;
      const settings = readMultiAngleSettings(data.multiAngle);
      if (args.preset) {
        const preset = multiAnglePresets.find(p => p.id === args.preset);
        if (preset) {
          settings.azimuth = preset.settings.azimuth;
          settings.elevation = preset.settings.elevation;
        }
      }
      if (args.azimuth !== undefined) settings.azimuth = args.azimuth;
      if (args.elevation !== undefined) settings.elevation = args.elevation;
      if (args.distance !== undefined) settings.distance = args.distance;
      if (args.lens !== undefined) settings.lens = args.lens;
      const label = args.preset ? multiAnglePresets.find(p => p.id === args.preset)!.label : "多角度";
      if (deps.ai && args.providerId && args.modelId) {
        const models = await deps.ai.getMediaModels(signal);
        const choice = models.find(m => m.providerId === args.providerId && m.modelId === args.modelId && m.type === "image");
        if (!choice) throw new Error("请选择有效的图片模型");
        settings.model = JSON.stringify([args.providerId, args.modelId]);
      }
      signal?.throwIfAborted();
      const result = await createVariation({
        label,
        prompt: buildMultiAnglePrompt(settings),
        model: settings.model,
        size: settings.size,
        ratio: settings.ratio,
      }, signal);
      await getNodeTools().call({ nodeId: result.nodeId, name: "node:getConfig", args: {} }, signal);
      await getNodeTools().call({ nodeId: result.nodeId, name: "node:generateImage", args: {} }, signal);
      return { nodeId: result.nodeId, status: "generating", hint: "已创建多角度子节点并启动生成，用 node:getGenerationStatus 查询" };
    },
  });
}
