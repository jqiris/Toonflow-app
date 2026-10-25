<template>
  <nodeSkeleton v-bind="nodeProps" style="width: 320px">
    <button v-loading="modelLoading" type="button" class="directorContent nopan" :disabled="modelLoading" :title="modelError || undefined" aria-label="打开导演台" @dblclick.stop @click.stop="openEditor">
      <img v-if="preview" class="scenePreview" :src="preview" alt="最后镜头" draggable="false" />
      <div v-else class="emptyPreview">
        <icon-cube3d-sphere :size="38" stroke="1.2" />
      </div>
    </button>
  </nodeSkeleton>
  <sceneEditor v-if="editing" v-model:anchors="anchors" v-model:prompt="prompt" v-model:model="model" v-model:lighting="lighting" v-model:sceneSettings="sceneSettings"
    :scene="scene" :result="selectedPlan" :models="models" :modelsLoading="modelsLoading" :addingMannequin="addingMannequin"
    :plans="plans" :selectedPlanId="data.selectedPlanId ?? ''" :tasks="tasks"
    :exportingVideo="exportingVideo" :exportingImage="exportingImage" :exportProgress="exportProgress"
    @exportVideo="exportVideo" @exportImage="exportImage" @addMannequin="addMannequin"
    @selectPlan="data.selectedPlanId = $event" @loadModels="loadModels" @generate="generate" @editInstruction="setPrompt" @close="editing = false">
    <template #input>
      <referenceItem v-if="refList.length" v-model="refList" @preview="setReferencePreview" @remove="removeReference" />
      <promptInput v-model="promptModel" v-model:text="prompt" :references="referenceMentions" />
    </template>
  </sceneEditor>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { IconCube3dSphere } from "@tabler/icons-vue";
import { ElLoading, ElMessage } from "element-plus";
import { nodeSkeleton, nodeTools, useNode, useNodeFiles, z, type NodeHandle, type NodeData, type NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import promptInput from "@toonflow/node-shared/promptInput";
import referenceItem from "@toonflow/node-shared/referenceItem";
import sceneEditor from "./sceneEditor.vue";
import { capturePreview, sceneSchema, createEmptyScene, createMannequinObject, createStage, disposeStage, getSceneLighting, type LightingSettings, type SceneDocument, type SceneSettings } from "./scene";
import { createDirectorDraft } from "./agentTools";
import { directorPrompt } from "./agentPrompt";
import { anchorSchema, prepareMotion, sampleMotion, type CameraAnchor } from "./motion";
import { directorPlanSchema, prepareSceneAnimation, type DirectorPlan, type DirectorGeneration } from "./sceneAnimation";
import { renderImage, renderVideo } from "./renderMedia";

type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const modelDocumentSchema = z.strictObject({
  version: z.literal(1),
  scene: sceneSchema,
  plans: z.array(directorPlanSchema.safeExtend({ id: z.string().min(1), instruction: z.string().optional() })),
});
type ModelDocument = z.infer<typeof modelDocumentSchema>;
defineOptions({
  inheritAttrs: false,
  icon: IconCube3dSphere,
  handles: [{ id: "in", type: "target", dataType: ["STRING", "IMAGE", "VIDEO"], label: "文本、图片、视频输入" }] satisfies NodeHandle[],
});
const { node, nodeProps, previewReady, ai, files, nodeEvent } = useNode({ label: "3D导演台" });
const vLoading = ElLoading.directive;
const { addNodes, findNode, getNodes, nodeTypes, removeNodes } = useVueFlow();
const mediaFiles = useNodeFiles();
const exportingVideo = ref(false);
const exportingImage = ref("");
const exportProgress = ref(0);
const exportController = new AbortController();
nodeEvent.on("delete", () => { if (exportingVideo.value || exportingImage.value) throw new Error("正在导出，请完成后再删除导演节点"); });
const data = computed(() => node.data as typeof node.data & {
  modelPath?: string;
  modelSnapshot?: ModelDocument;
  lighting?: LightingSettings;
  sceneSettings?: SceneSettings;
  prompt?: string;
  promptModel?: PromptModel;
  model?: string;
  anchors?: CameraAnchor[];
  selectedPlanId?: string;
});
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const promptModel = computed({ get: () => data.value.promptModel ?? [], set: (value: PromptModel) => { data.value.promptModel = value; } });
const anchors = computed({ get: () => data.value.anchors ?? [], set: (value: CameraAnchor[]) => { data.value.anchors = value; } });
const prompt = computed({ get: () => data.value.prompt ?? "", set: (value: string) => { data.value.prompt = value; } });
const model = computed({ get: () => data.value.model ?? "", set: (value: string) => { data.value.model = value; } });
// ACT: 场景和动画只在节点内部持有，画布数据仅保存文件引用，避免拖动时遍历大量关键帧。
const modelDocument = shallowRef<ModelDocument>({ version: 1, scene: createEmptyScene(), plans: [] });
const plans = computed(() => modelDocument.value.plans);
const selectedPlan = computed(() => plans.value.find(plan => plan.id === data.value.selectedPlanId));
const scene = computed(() => modelDocument.value.scene);
const lighting = computed({ get: () => ({ ...getSceneLighting(scene.value), ...data.value.lighting }), set: (value: LightingSettings) => { data.value.lighting = value; } });
const sceneSettings = computed({ get: () => ({ gridVisible: true, skyVisible: true, ...data.value.sceneSettings }), set: (value: SceneSettings) => { data.value.sceneSettings = value; } });
const editing = ref(false);
const tasks = ref<DirectorGeneration[]>([]);
const modelsLoading = ref(false);
const models = ref<NodeAiModel[]>([]);
const selectedModel = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === model.value));
const preview = ref("");
let previewVersion = 0;
const modelLoading = ref(true);
const modelError = ref("");
const addingMannequin = ref(false);
let modelSaving = Promise.resolve();
let disposed = false;
const generationControllers = new Map<string, AbortController>();
const generationResults = new Map<string, { status: "succeeded" | "failed"; error?: string }>();
type ReloadRemoteNode = (type: string) => Promise<void>;
const reloadRemoteNode = inject<ReloadRemoteNode | undefined>("reloadRemoteNode", undefined);
// ACT: 桌面壳会带 desktop=1，导出前先调桥接接口把窗口唤回可见；浏览器页签无法操作窗口，只能依赖用户保持页面可见。
const desktopWindow = new URLSearchParams(window.location.search).get("desktop") === "1";
onBeforeUnmount(() => {
  disposed = true;
  exportController.abort(new Error("导演节点已关闭，导出已停止"));
  generationControllers.forEach(controller => controller.abort(new Error("导演节点已关闭，生成已停止")));
});

function getModelPath() {
  if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
  return `assets/${node.id}/model.json`;
}

async function writeModel(workspaceFiles: ReturnType<typeof files.getWorkspaceFiles>, value: ModelDocument) {
  const path = getModelPath();
  for (const directory of ["assets", `assets/${node.id}`]) {
    await workspaceFiles.mkdir(directory).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "EEXIST") throw error;
    });
  }
  await workspaceFiles.writeJson(path, value);
  return path;
}

async function loadModel() {
  modelLoading.value = true;
  modelError.value = "";
  try {
    const { modelPath, modelSnapshot } = data.value;
    if (!modelPath && !modelSnapshot) return;
    const workspaceFiles = files.getWorkspaceFiles();
    if (modelPath && modelPath !== getModelPath()) throw new Error("导演台模型文件路径无效");
    const value = modelDocumentSchema.parse(modelSnapshot ?? await workspaceFiles.readJson(modelPath!));
    if (disposed) return;
    // 复制、跨画布粘贴时只传递一次快照，写入新节点目录成功后才移除快照。
    if (modelSnapshot) {
      const path = await writeModel(workspaceFiles, value);
      if (disposed) return;
      data.value.modelPath = path;
      delete data.value.modelSnapshot;
    }
    modelDocument.value = value;
    if (!selectedPlan.value) data.value.selectedPlanId = value.plans[0]?.id;
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : "模型文件读取失败";
    if (!disposed) ElMessage.error(`导演台加载失败：${modelError.value}`);
  } finally {
    modelLoading.value = false;
  }
}

let modelReady = loadModel();
async function openEditor() {
  if (modelError.value) modelReady = loadModel();
  await modelReady;
  if (!disposed && !modelError.value) editing.value = true;
}

async function addMannequin() {
  if (modelLoading.value || modelError.value || addingMannequin.value || exportingVideo.value || exportingImage.value || tasks.value.some(task => !task.error)) return;
  addingMannequin.value = true;
  try {
    const workspaceFiles = files.getWorkspaceFiles();
    const saving = modelSaving.then(async () => {
      if (disposed) return;
      const current = scene.value;
      const object = createMannequinObject(crypto.randomUUID());
      const mannequins = current.objectList.filter(item => item.objType === "mannequin");
      object.position.x = mannequins.length ? Math.max(...mannequins.map(item => item.position.x)) + 1 : 0;
      const nextScene: SceneDocument = { ...current, objectList: [...current.objectList, object] };
      if (!current.objectList.length) {
        nextScene.sceneConfig = {
          ...current.sceneConfig,
          camera: { ...current.sceneConfig.camera, position: { x: 3, y: 2.2, z: 4 } },
          controls: { target: { x: 0, y: 0.9, z: 0 } },
        };
      }
      const value: ModelDocument = { ...modelDocument.value, scene: sceneSchema.parse(nextScene) };
      const path = await writeModel(workspaceFiles, value);
      if (disposed) return;
      modelDocument.value = value;
      data.value.modelPath = path;
    });
    modelSaving = saving.catch(() => {});
    await saving;
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "人偶添加失败");
  } finally {
    addingMannequin.value = false;
  }
}

nodeEvent.on("copy", async () => {
  await nodeEvent.emit("save");
  if (modelError.value) throw new Error(`导演台模型未加载，无法复制：${modelError.value}`);
  return { modelPath: undefined, modelSnapshot: modelDocument.value };
});

nodeEvent.on("save", async (reason) => {
  await modelReady;
  let pending: Promise<void>;
  do {
    pending = modelSaving;
    await pending;
  } while (pending !== modelSaving);
  if (reason === "reload" && (exportingVideo.value || exportingImage.value || tasks.value.some(task => !task.error))) {
    throw new Error("导演台正在生成或导出，请完成后再刷新节点");
  }
});

// ACT: 导出目标节点类型未注册时自动启用插件并重新加载，替代原先只提示用户手动启用。
async function ensurePluginNode(type: "imageNode" | "videoNode") {
  const nodeType = `remote-${type}`;
  if (nodeTypes?.value?.[nodeType]) return;
  if (!reloadRemoteNode) throw new Error(`请先启用${type === "imageNode" ? "图片" : "视频"}节点插件`);
  const response = await fetch("/api/nodes/setEnabled", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ name: type, enabled: true }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || `启用${type === "imageNode" ? "图片" : "视频"}节点插件失败（HTTP ${response.status}）`);
  }
  await reloadRemoteNode(nodeType);
}

async function exportToCanvas(kind: "image" | "video", key: string, aspect: number, render: (signal: AbortSignal) => Promise<File>): Promise<{ nodeId: string; path: string } | undefined> {
  if (kind === "video" ? exportingVideo.value : exportingImage.value) return;
  const type = `remote-${kind}Node`;
  await ensurePluginNode(kind === "image" ? "imageNode" : "videoNode");
  // ACT: ensurePluginNode 是异步的，二次检查防止双击或工具并发在等待期间同时通过 busy 检查
  if (kind === "video" ? exportingVideo.value : exportingImage.value) return;
  if (kind === "video") { exportingVideo.value = true; exportProgress.value = 0; }
  else exportingImage.value = key;
  const id = crypto.randomUUID();
  let exportNode: ReturnType<typeof findNode<NodeData & { exportProgress?: number }>>;
  let discarded = false;
  let committed = false;
  let uploadStarted = false;
  let stopWatching = () => {};
  let workspaceFiles: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  function addExportNode(label: string) {
    const width = 240 * aspect + 18;
    const x = node.computedPosition.x + (node.dimensions.width || 320) + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + width && position.x + (other.dimensions.width || 320) > x && position.y < y + 320 && position.y + (other.dimensions.height || 300) > y) {
        y = position.y + (other.dimensions.height || 300) + 24;
      }
    }
    addNodes({ id, type, position: { x, y }, data: { label, outputs: {} } });
    return findNode(id)!;
  }
  try {
    workspaceFiles = files.getWorkspaceFiles();
    if (kind === "video") {
      exportNode = addExportNode(selectedPlan.value?.name ?? "视频");
      // ACT: 导出进度只在当前运行中使用，不能写入画布或复制到另一个节点。
      Object.defineProperty(exportNode.data, "exportProgress", { value: 0, writable: true, configurable: true });
      stopWatching = watch([() => findNode(id), exportProgress], ([current, progress]) => {
        if (current !== exportNode) discarded = true;
        if (!discarded) exportNode!.data.exportProgress = progress;
      }, { flush: "sync" });
    }
    const file = await render(exportController.signal);
    exportController.signal.throwIfAborted();
    if (discarded) return;
    uploadStarted = true;
    const path = await mediaFiles.uploadFile(id, file);
    exportController.signal.throwIfAborted();
    if (discarded) return;
    if (findNode(node.id) !== node || !nodeTypes?.value?.[type]) throw new Error("画布节点已变化，请重新导出");
    exportNode ??= addExportNode(file.name.replace(/\.[^.]+$/, ""));
    // 更新已有输出对象，让已挂载的视频节点及连接它的节点同步收到结果。
    (exportNode.data.outputs ??= {})[kind] = {
      dataType: kind === "image" ? "IMAGE" : "VIDEO", value: { url: path, mimeType: file.type },
    };
    committed = true;
    if (kind === "video") exportProgress.value = 100;
    ElMessage.success(`${kind === "image" ? "图片" : "视频"}已导出到画布`);
    return { nodeId: id, path };
  } catch (error) {
    if (exportNode && findNode(id) === exportNode) removeNodes(id);
    throw error;
  } finally {
    stopWatching();
    if (exportNode) delete exportNode.data.exportProgress;
    if (uploadStarted && !committed) {
      try { await workspaceFiles!.remove(`assets/${id}`, true); }
      catch (cleanupError) {
        const code = (cleanupError as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code;
        if (!disposed && code !== "ENOENT") ElMessage.error("导出中断，临时素材清理失败");
      }
    }
    if (kind === "video") exportingVideo.value = false;
    else exportingImage.value = "";
  }
}

function showExportError(error: unknown) {
  if (!disposed) ElMessage.error(error instanceof Error ? error.message : "导出失败，请重试");
}

async function renderVideoToCanvas(plan: ModelDocument["plans"][number], aspect: number) {
  if (plan.duration > 240) throw new Error(`镜头方案「${plan.name}」时长 ${plan.duration} 秒，超过单次导出 240 秒上限，请拆分为多个方案分段导出`);
  if (desktopWindow) await fetch("/api/desktop/activateWindow", { method: "POST", headers: { "x-toonflow-desktop": "1" } }).catch(() => {});
  const result = await exportToCanvas("video", "video", aspect, signal => renderVideo(scene.value, plan, aspect, signal, value => { exportProgress.value = value; }, lighting.value, sceneSettings.value));
  if (!result) throw new Error("导出未完成，可能有其他导出正在进行，请重试");
  return result;
}

function exportVideo(aspect: number) {
  const plan = selectedPlan.value;
  if (!plan) return;
  return renderVideoToCanvas(plan, aspect).catch(showExportError);
}

function exportImage(anchor: CameraAnchor, aspect: number, time: number) {
  const name = `关键帧${anchors.value.findIndex(item => item.id === anchor.id) + 1}`;
  return exportToCanvas("image", anchor.id, aspect, async signal => {
    const file = await renderImage(scene.value, anchor, aspect, time, signal, selectedPlan.value, lighting.value, sceneSettings.value);
    return new File([file], `${name}.png`, { type: file.type });
  }).then(result => {
    if (!result) throw new Error("导出未完成，可能有其他导出正在进行，请重试");
  }).catch(showExportError);
}

let modelsRequest: Promise<void> | undefined;
function loadModels() {
  // ACT: 共享进行中的请求，nodeTools 与面板可同时等待同一份模型列表。
  modelsRequest ??= loadModelsOnce().finally(() => { modelsRequest = undefined; });
  return modelsRequest;
}

async function loadModelsOnce() {
  modelsLoading.value = true;
  try {
    const available = await ai.getModels();
    if (disposed) return;
    models.value = available;
    const first = models.value[0];
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择。
    if (!model.value) model.value = first ? JSON.stringify([first.providerId, first.modelId]) : "";
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "模型加载失败");
  } finally {
    modelsLoading.value = false;
  }
}

async function renderPreview(scene: SceneDocument, plan: DirectorPlan | undefined, lighting: LightingSettings, settings: SceneSettings) {
  const runtime = await createStage(document.createElement("canvas"), scene, undefined, undefined, lighting, settings);
  let player: ReturnType<typeof prepareSceneAnimation> | undefined;
  try {
    if (plan) {
      player = prepareSceneAnimation(runtime, plan);
      player.setTime(plan.duration);
      sampleMotion(runtime.camera, prepareMotion(plan.cameraFrames), plan.duration);
    }
    return capturePreview(runtime);
  } finally {
    player?.dispose();
    disposeStage(runtime);
  }
}

const planPreviews = new WeakMap<DirectorPlan, { scene: SceneDocument; lighting: LightingSettings; settings: SceneSettings; image: string }>();
watch([scene, selectedPlan, lighting, sceneSettings, modelLoading, previewReady], async ([value, plan, light, settings, loading, ready]) => {
  const version = ++previewVersion;
  preview.value = "";
  if (!ready || loading || modelError.value) return;
  try {
    const cached = plan && planPreviews.get(plan);
    const image = cached?.scene === value && JSON.stringify(cached.lighting) === JSON.stringify(light) && JSON.stringify(cached.settings) === JSON.stringify(settings) ? cached.image : await renderPreview(value, plan, light, settings);
    if (plan) planPreviews.set(plan, { scene: value, lighting: light, settings, image });
    if (!disposed && version === previewVersion) preview.value = image;
  } catch (error) {
    if (!disposed && version === previewVersion) ElMessage.error(error instanceof Error ? error.message : "预览生成失败");
  }
}, { immediate: true });

function setPrompt(value: string) {
  prompt.value = value;
  promptModel.value = value ? value.split("\n").map(text => [{ type: "Write", text }]) : [];
}

// ACT: 生成后台化供 nodeTools 调用，Agent 用 getGenerationStatus 轮询；预检失败一律抛错，界面入口保留静默预检。
async function runGeneration(instruction: string) {
  await modelReady;
  if (modelLoading.value) throw new Error("导演台模型正在加载，请稍候");
  if (modelError.value) throw new Error(`导演台模型未加载：${modelError.value}`);
  if (addingMannequin.value) throw new Error("正在添加人偶，请等待完成");
  const requirement = instruction.trim();
  if (!requirement) throw new Error("请输入生成指令");
  if (!models.value.length) await loadModels();
  const choice = selectedModel.value;
  if (!choice) throw new Error("没有可用的语言模型，请先在模型设置中配置供应商；带参考图时需选择支持工具调用且支持视觉的多模态模型");
  // 首次创建基础模型期间只接收一个请求，后续动画可并行生成。
  if (!scene.value.objectList.length && tasks.value.some(task => !task.error)) throw new Error("首次创建基础场景时只接收一个生成请求，请用 getGenerationStatus 等待完成");
  const baseScene = scene.value;
  const basePlanId = data.value.selectedPlanId ?? "";
  const task = { id: crypto.randomUUID(), instruction: requirement };
  tasks.value = [...tasks.value, task];
  const controller = new AbortController();
  generationControllers.set(task.id, controller);
  const pending = (async () => {
    try {
      const workspaceFiles = files.getWorkspaceFiles();
      if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
      const mediaReferences = refList.value
        .filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE" || item.dataType === "VIDEO"))
        .map(item => item.dataType === "STRING" ? { dataType: item.dataType, value: item.value } : { dataType: item.dataType, value: { ...item.value } });
      const references = anchors.value.map((value, index) => {
        const { camera, controls } = anchorSchema.parse(value);
        return { order: index + 1, camera, controls };
      });
      const basePlan = selectedPlan.value;
      const draft = createDirectorDraft(
        JSON.parse(JSON.stringify(baseScene)),
        basePlan ? directorPlanSchema.parse({ name: basePlan.name, duration: basePlan.duration, tracks: basePlan.tracks, cameraFrames: basePlan.cameraFrames }) : undefined,
        JSON.parse(JSON.stringify(plans.value)),
      );
      const directory = mediaReferences.some(item => item.dataType !== "STRING") ? (await workspaceFiles.list()).directory : undefined;
      if (disposed) return;
      await ai.generate({
        references: mediaReferences,
        providerId: choice.providerId,
        modelId: choice.modelId,
        systemPrompt: directorPrompt,
        prompt: JSON.stringify({ instruction: requirement, references, selectedPlanId: basePlanId, document: draft.summary() }),
        directory,
        tools: draft.tools,
        signal: controller.signal,
      });
      if (disposed) return;
      if (!draft.edited) throw new Error("Agent 未修改方案，原方案未修改，请重试。");
      const result = draft.read();
      const nextScene = draft.sceneChanged ? result.scene : baseScene;
      const plan = { ...result.plan, id: task.id, instruction: requirement };
      // 工具仅编辑草稿；完成后验证实际渲染，成功落盘才替换当前方案。
      const previewLighting = { ...getSceneLighting(nextScene), ...data.value.lighting };
      const previewSettings = sceneSettings.value;
      const image = await renderPreview(nextScene, plan, previewLighting, previewSettings);
      if (disposed) return;
      // 动画请求可以并行生成，同一模型文件顺序保存，写入成功后才替换当前场景。
      const saving = modelSaving.then(async () => {
        if (disposed) return;
        if (scene.value !== baseScene) throw new Error("基础模型已被另一条指令更新，请基于当前模型重试。");
        const objects = new Map(nextScene.objectList.map(object => [object.threeJsonId, object]));
        const previousPlans = draft.sceneChanged
          ? plans.value.map(item => ({ ...item, tracks: item.tracks.filter(track => objects.has(track.objectId) && (!track.joint || objects.get(track.objectId)?.objType === "mannequin")) }))
          : plans.value;
        const value: ModelDocument = { version: 1, scene: nextScene, plans: [...previousPlans, plan] };
        const path = await writeModel(workspaceFiles, value);
        if (disposed) return;
        planPreviews.set(plan, { scene: nextScene, lighting: previewLighting, settings: previewSettings, image });
        modelDocument.value = value;
        data.value.modelPath = path;
        if ((data.value.selectedPlanId ?? "") === basePlanId) data.value.selectedPlanId = plan.id;
      });
      modelSaving = saving.catch(() => {});
      await saving;
      tasks.value = tasks.value.filter(item => item.id !== task.id);
      // ACT: 成功是既成事实（方案已写入文档），无条件覆盖 cancelGeneration 预置的『已取消生成』
      generationResults.set(task.id, { status: "succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败，请重试";
      if (!disposed) tasks.value = tasks.value.map(item => item.id === task.id ? { ...item, error: message } : item);
      if (!generationResults.has(task.id)) generationResults.set(task.id, { status: "failed", error: message });
    } finally {
      generationControllers.delete(task.id);
    }
  })();
  return { taskId: task.id, status: "generating" as const, pending };
}

async function generate() {
  if (modelLoading.value || modelError.value || addingMannequin.value) return;
  const requirement = prompt.value.trim();
  if (!requirement || !selectedModel.value) return;
  try {
    const { pending } = await runGeneration(requirement);
    setPrompt("");
    void pending;
  } catch {
    // 预检失败时保留输入指令，等待用户在导演台内调整后重试。
  }
}

function getToolConfig() {
  const [providerId = "", modelId = ""] = model.value ? (JSON.parse(model.value) as string[]) : [];
  return {
    providerId,
    modelId,
    models: models.value.map(item => ({ providerId: item.providerId, modelId: item.modelId })),
    prompt: prompt.value,
    hasScene: scene.value.objectList.length > 0,
    objectCount: scene.value.objectList.length,
    anchorCount: anchors.value.length,
    plans: plans.value.map(plan => ({ id: plan.id, name: plan.name, duration: plan.duration })),
    selectedPlanId: selectedPlan.value?.id ?? "",
    references: refList.value.map(item => ({ dataType: item.dataType, ready: item.value !== undefined })),
  };
}

// ACT: 手写多任务生成状态（导演台允许多个方案并行生成），返回形状与 useNodeGeneration 的 getGenerationStatus 兼容。
function generationStatus(taskId?: string) {
  if (taskId !== undefined) {
    if (generationControllers.has(taskId)) return { taskId, status: "running" as const };
    const result = generationResults.get(taskId);
    if (!result) return { taskId, status: "idle" as const, message: "未找到该任务记录，节点可能刚被刷新，请用 getState 查看当前方案与待处理任务" };
    return { taskId, status: result.status, error: result.error };
  }
  if (generationControllers.size) return { status: "running" as const, taskIds: [...generationControllers.keys()] };
  const entries = [...generationResults.entries()];
  if (!entries.length) return { status: "idle" as const };
  const failed = entries.reverse().find(([, result]) => result.status === "failed");
  return failed ? { status: "failed" as const, taskId: failed[0], error: failed[1].error } : { status: "succeeded" as const, taskId: entries[0][0] };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此导演台节点的生成模型配置、可选文本模型、提示词草稿、场景对象数、镜头方案与取景锚点数量、引用素材就绪状态；不含密钥",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getToolConfig();
  },
});

nodeTools.register({
  name: "setConfig",
  description: "修改此导演台节点的场景生成模型；providerId 与 modelId 必须同时提供且来自 getConfig 的 models；导演台内部 Agent 需要模型支持工具调用，带图片/视频参考图时必须选支持视觉的多模态模型；不启动生成",
  parameters: z.strictObject({ providerId: z.string().min(1), modelId: z.string().min(1) }),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    const choice = models.value.find(item => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效模型");
    model.value = JSON.stringify([choice.providerId, choice.modelId]);
    signal?.throwIfAborted();
    return getToolConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "替换此导演台节点输入框中的指令草稿，便于用户在画布上确认后手动生成；只修改文本，不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    setPrompt(value);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateScene",
  description: "后台启动此导演台的 3D 场景搭建/修改与镜头动画生成：instruction 用自然语言描述场景、角色、动作与运镜；参考图/视频需先连到本节点 in 句柄并确认 getConfig.references 全部就绪，且模型支持视觉；立即返回 taskId 不等待完成——用 getGenerationStatus 轮询、cancelGeneration 取消；首次建场只接收一个请求，之后建议多轮小步修改；完成后用 getState 查看方案，再用 exportVideo/exportKeyframe 导出",
  parameters: z.strictObject({ instruction: z.string().trim().min(1) }),
  execute({ instruction }, { signal }) {
    signal?.throwIfAborted();
    return runGeneration(instruction).then(({ taskId, status }) => ({ taskId, status }));
  },
});

nodeTools.register({
  name: "getGenerationStatus",
  description: "查询此导演台节点后台生成状态：不带 taskId 返回聚合状态（idle/running/succeeded/failed 与最近错误），带 taskId 查询指定任务；succeeded 表示新镜头方案已写入节点",
  parameters: z.strictObject({ taskId: z.string().min(1).optional() }),
  execute({ taskId }) {
    return generationStatus(taskId);
  },
});

nodeTools.register({
  name: "cancelGeneration",
  description: "取消此导演台节点所有进行中的生成任务；正在生成的方案不会写入节点",
  parameters: z.strictObject({}),
  execute() {
    const cancelled = [...generationControllers.keys()];
    cancelled.forEach(taskId => generationResults.set(taskId, { status: "failed", error: "已取消生成" }));
    generationControllers.forEach(controller => controller.abort(new Error("已取消生成")));
    return { cancelled, status: "idle" as const, cancellationRequested: cancelled.length > 0 };
  },
});

nodeTools.register({
  name: "getState",
  description: "读取导演台状态快照：场景物体（名称/类型/坐标）、取景锚点、镜头方案（id/名称/时长/生成指令）、选中方案、待处理任务与导出状态；修改或导出前先查这里",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    await modelReady;
    signal?.throwIfAborted();
    return {
      loading: modelLoading.value,
      error: modelError.value || undefined,
      objects: scene.value.objectList.map((object, index) => ({ index: index + 1, name: object.name, objType: object.objType, position: object.position })),
      anchors: anchors.value.map((anchor, index) => ({ index: index + 1, id: anchor.id, time: anchor.time })),
      plans: plans.value.map(plan => ({ id: plan.id, name: plan.name, duration: plan.duration, instruction: plan.instruction, tracks: plan.tracks.length, cameraFrames: plan.cameraFrames.length })),
      selectedPlanId: selectedPlan.value?.id ?? "",
      tasks: tasks.value.map(task => ({ id: task.id, instruction: task.instruction })),
      exporting: { video: exportingVideo.value, image: exportingImage.value },
    };
  },
});

nodeTools.register({
  name: "selectPlan",
  description: "选择当前镜头方案（决定节点预览、后续生成的基准和导出的默认方案）；planId 来自 getState 返回的 plans",
  parameters: z.strictObject({ planId: z.string().min(1) }),
  execute({ planId }) {
    const plan = plans.value.find(item => item.id === planId);
    if (!plan) throw new Error(`未找到方案 ${planId}，可用方案见 getState 返回的 plans`);
    data.value.selectedPlanId = plan.id;
    return { selectedPlanId: plan.id, name: plan.name, duration: plan.duration };
  },
});

nodeTools.register({
  name: "exportVideo",
  description: "把镜头方案渲染为 MP4 并导出到画布的视频节点（自动创建视频节点并启用其插件）；planId 缺省用当前选中方案，aspect 为宽/高比例（默认 16/9）；录制耗时约等于方案时长，单次上限 240 秒且受 100MB 体积限制，长片请拆成多个方案分段导出后接剪辑轨；桌面端会自动唤回窗口，浏览器端需保持本页面可见",
  parameters: z.strictObject({
    planId: z.string().min(1).optional(),
    aspect: z.number().min(0.2).max(5).optional(),
  }),
  timeoutMs: 600000,
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    await modelReady;
    if (modelError.value) throw new Error(`导演台模型未加载：${modelError.value}`);
    if (exportingVideo.value || exportingImage.value) throw new Error("导演台正在导出，请等待当前导出完成");
    const plan = args.planId === undefined ? selectedPlan.value : plans.value.find(item => item.id === args.planId);
    if (!plan) throw new Error(args.planId === undefined ? "没有镜头方案，请先 generateScene 并用 getGenerationStatus 确认完成" : `未找到方案 ${args.planId}，可用方案见 getState`);
    data.value.selectedPlanId = plan.id;
    const result = await renderVideoToCanvas(plan, args.aspect ?? 16 / 9);
    return { ...result, plan: { id: plan.id, name: plan.name, duration: plan.duration } };
  },
});

nodeTools.register({
  name: "exportKeyframe",
  description: "按取景锚点渲染 PNG 关键帧并导出到画布的图片节点（自动创建图片节点并启用其插件）；anchorId 或 anchorIndex（从 1 开始，见 getState）二选一，缺省第一个锚点；time 为方案内时间点秒（缺省用锚点 time 或 0）；planId 缺省用当前选中方案；aspect 默认 16/9",
  parameters: z.strictObject({
    anchorId: z.string().min(1).optional(),
    anchorIndex: z.number().int().min(1).max(64).optional(),
    planId: z.string().min(1).optional(),
    time: z.number().min(0).max(300).optional(),
    aspect: z.number().min(0.2).max(5).optional(),
  }),
  timeoutMs: 300000,
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    await modelReady;
    if (modelError.value) throw new Error(`导演台模型未加载：${modelError.value}`);
    if (exportingVideo.value || exportingImage.value) throw new Error("导演台正在导出，请等待当前导出完成");
    const anchor = args.anchorId === undefined ? anchors.value[(args.anchorIndex ?? 1) - 1] : anchors.value.find(item => item.id === args.anchorId);
    if (!anchor) throw new Error("未找到取景锚点，anchorId/anchorIndex 见 getState 返回的 anchors");
    if (args.planId !== undefined) {
      const plan = plans.value.find(item => item.id === args.planId);
      if (!plan) throw new Error(`未找到方案 ${args.planId}，可用方案见 getState`);
      data.value.selectedPlanId = plan.id;
    }
    const aspect = args.aspect ?? 16 / 9;
    const time = args.time ?? anchor.time ?? 0;
    const name = `关键帧${anchors.value.indexOf(anchor) + 1}`;
    const result = await exportToCanvas("image", anchor.id, aspect, async exportSignal => {
      const file = await renderImage(scene.value, anchor, aspect, time, exportSignal, selectedPlan.value, lighting.value, sceneSettings.value);
      return new File([file], `${name}.png`, { type: file.type });
    });
    if (!result) throw new Error("导出未完成，可能有其他导出正在进行，请重试");
    return { ...result, anchor: { id: anchor.id, index: anchors.value.indexOf(anchor) + 1, time } };
  },
});
</script>

<style scoped lang="scss">
.directorContent {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  cursor: pointer;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);
  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }

  .scenePreview {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .emptyPreview {
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-placeholder);
  }

}
</style>
