<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="downloadName"
    :style="cardStyle"
    @fullscreen="openFullscreen">
    <div class="mtrackCardContent">
      <!-- ACT: 卡片头部是画布上的拖拽手柄；编辑器宿主整块 nodrag，正文没有可拖区会让节点看起来无法移动。 -->
      <div class="cardHeader">
        <span class="cardTitle">镜头创作工作台</span>
        <el-button class="nodrag nopan" size="small" text :icon="IconMaximize" title="全屏编辑" aria-label="全屏编辑" @pointerdown.stop @click.stop="openFullscreen">全屏编辑</el-button>
      </div>
      <div class="h3Hint" title="视频生成仅支持 MiniMax-H3">仅支持 MiniMax-H3</div>
      <div v-if="refList.length || agentCreated" class="assetRow nodrag nopan nowheel">
        <el-tag v-if="agentCreated" class="agentTag" size="small" type="info">agent 添加</el-tag>
        <referenceItem v-model="refList" @preview="setReferencePreview" @remove="removeReference" />
      </div>
      <div v-if="previewUrl" class="outputRow">
        <div class="outputHeader nodrag nopan">
          <span class="outputLabel">成片</span>
          <el-button size="small" text :icon="IconRefresh" :loading="loadingOutput" title="重新读取合成结果" aria-label="重新读取合成结果" @click.stop="refreshOutput">刷新</el-button>
        </div>
        <videoPlayer :src="previewUrl" label="多轨成片" />
      </div>
      <!-- ACT: 编辑器始终单实例，全屏时靠 teleport 挪进遮罩层而不是重建，未保存状态不丢；宿主必须 v-show，v-if 会连 teleport 锚点一起卸载。 -->
      <div v-show="!editing" class="mtrackEditorHost nodrag nopan nowheel" :style="editorHostStyle">
        <teleport :to="overlayHost" :disabled="!editing">
          <multitrackEditor ref="editorRef" :getFiles="getFiles" :directory="directory" :projectPath="projectPath" :nodeId="id" :resultsUi="resultsUi" @dirtyChange="onEditorDirty" @bind="onBindProject" @compositeDone="onCompositeDone" @resultsUiChange="onResultsUiChange" />
        </teleport>
      </div>
      <p v-if="editing" class="editorAwayHint">编辑器已全屏打开，点击遮罩层的「收起」返回。</p>
    </div>
    <!-- ACT: 画布缩放的唯一入口。多轨节点正文整块 nodrag，只留右下角这一处拖拽手柄改卡片尺寸，
         尺寸写进 node.data 参与画布自动保存，刷新后保留。 -->
    <div
      ref="resizeHandle"
      class="resizeHandle nodrag nopan nowheel"
      title="拖拽调整尺寸"
      aria-label="拖拽调整尺寸"
      @pointerdown.stop.prevent="startResize"
      @pointermove.stop="moveResize"
      @pointerup.stop="finishResize"
      @pointercancel="finishResize"
      @lostpointercapture="finishResize"></div>
  </nodeSkeleton>
  <teleport to="body">
    <div v-show="editing" class="mtrackOverlay" :style="{ zIndex: overlayZ }">
      <header class="overlayHeader">
        <span class="overlayTitle">{{ node.data.label }}<el-tag v-if="agentCreated" size="small" type="info">agent 添加</el-tag></span>
        <el-button size="small" :icon="IconMinimize" @click="closeFullscreen">收起</el-button>
      </header>
      <div ref="overlayHost" class="mtrackEditorHost fullscreenHost"></div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElTag, useZIndex } from "element-plus";
import { useVueFlow } from "@vue-flow/core";
import { IconMovie, IconMaximize, IconMinimize, IconRefresh } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import multitrackEditor from "@toonflow/node-shared/mtrack/multitrackEditor";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import referenceItem from "@toonflow/node-shared/referenceItem";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { resolveCanvasBridge, resolveReferenceSources, type CanvasCall } from "@toonflow/node-shared/mtrack/directDispatch";
import videoPlayer from "@toonflow/node-video/videoPlayer";
import { assetIndexPath, normalizeResultsUi } from "@toonflow/node-shared/mtrack/mtrackProject";
import type { AssetIndex, AssetIndexCard, EditorFiles, ResultsUiGeometry } from "@toonflow/node-shared/mtrack/mtrackProject";

defineOptions({
  inheritAttrs: false,
  icon: IconMovie,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO", "STRING"], label: "参考资产（图 / 视频 / 音频 / 文本）" },
    { id: "video", type: "source", dataType: "VIDEO", label: "成片输出" },
  ] satisfies NodeHandle[],
});

const { id, node, nodeProps, files, nodeEvent, outputs } = useNode({ label: "多轨编辑器" });
const { refList, setReferencePreview, removeReference } = useNodeReferences();

const editing = ref(false);
const overlayHost = ref<HTMLDivElement>();
const resizeHandle = ref<HTMLDivElement>();
const editorRef = ref<InstanceType<typeof multitrackEditor>>();
const editorDirty = ref(false);
const loadingOutput = ref(false);
/** 全屏遮罩的层级向 element-plus 层级管理器申请，保证遮罩之后弹出的 ElMessage、下拉浮层永远在其上。 */
const overlayZ = ref(2000);
const { nextZIndex } = useZIndex();

/** agent 经画布 addNode 添加的节点带 agentCreated 标记；菜单、拖拽与复制产生的节点不带。 */
const agentCreated = computed(() => (node.data as { agentCreated?: boolean }).agentCreated === true);

const readDirectory = inject<() => string>("workspaceDirectory", () => "");

const directory = computed(() => {
  try {
    return readDirectory();
  } catch {
    return "";
  }
});

const compositeManifestPath = "plan/composite.json";

/** 画布卡片尺寸：拖拽后写进 node.data 参与画布自动保存，刷新后按原尺寸还原；没拉过时沿用原来的自适应宽度。 */
const savedWidth = computed(() => {
  const value = Number((node.data as { cardWidth?: number }).cardWidth);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const savedHeight = computed(() => {
  const value = Number((node.data as { cardHeight?: number }).cardHeight);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const cardStyle = computed(() => (savedWidth.value ? { width: `${savedWidth.value}px` } : { width: "clamp(640px, 44vw, 960px)" }));
/** 编辑器宿主跟着卡片高度走：卡片被拉高时编辑区一起变高，而不是留一片空白。
    扣掉标题栏、卡片内边距与卡片头部这层固定高度（约 200px），下限 240px 保证 36px 工具栏 + 时间线一轮 + 底栏还放得下。 */
const editorHostStyle = computed(() => ({ height: `${Math.max(240, (savedHeight.value || 700) - 200)}px` }));

const flow = useVueFlow();
const resize = shallowRef<{
  element: HTMLElement;
  pointerId: number;
  point: { x: number; y: number };
  width: number;
  height: number;
}>();

function startResize(event: PointerEvent) {
  if (event.button !== 0 || resize.value || editing.value) return;
  const element = event.currentTarget as HTMLElement;
  resize.value = {
    element,
    pointerId: event.pointerId,
    point: flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
    width: savedWidth.value || element.closest(".nodeSkeleton")?.clientWidth || 640,
    height: savedHeight.value || element.closest(".nodeSkeleton")?.clientHeight || 700,
  };
  element.setPointerCapture(event.pointerId);
}

function moveResize(event: PointerEvent) {
  const state = resize.value;
  if (!state || event.pointerId !== state.pointerId) return;
  const point = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  // ACT: 只做右下角单向拉大，最小 480×420 保证编辑器三段式在这个尺寸下仍然可用；不设上限，由画布缩放兜底。
  const width = Math.max(480, Math.round(state.width + point.x - state.point.x));
  const height = Math.max(420, Math.round(state.height + point.y - state.point.y));
  const data = node.data as { cardWidth?: number; cardHeight?: number };
  data.cardWidth = width;
  data.cardHeight = height;
}

function finishResize(event?: PointerEvent) {
  const state = resize.value;
  if (!state || (event && event.pointerId !== state.pointerId)) return;
  resize.value = undefined;
  if (state.element.hasPointerCapture(state.pointerId)) state.element.releasePointerCapture(state.pointerId);
}

onBeforeUnmount(() => finishResize());

/** 节点绑定的工程路径；空串表示这个节点还没绑定，菜单新建的节点不会读到工作区已有的 story.mtrack。 */
const projectPath = computed(() => {
  const value = (node.data as { projectPath?: unknown }).projectPath;
  return typeof value === "string" ? value : "";
});

function onBindProject(path: string) {
  (node.data as { projectPath?: string }).projectPath = path;
}

/**
 * 「项目与成片」浮窗几何：写进 node.data.resultsUi，与 cardWidth/cardHeight 同一套画布自动保存链路，
 * 刷新/重开画布后浮窗位置不丢。读侧统一经 normalizeResultsUi 兜底（旧节点没有该字段时按 t1 缺省几何）。
 * 浮窗与节点在画布世界层同坐标系（teleport 到 transformationpane），不随节点拖动移动是有意的：
 * 几何只记录用户拖浮窗自身的结果；锚点缺省摆放只在首次打开（data 无 resultsUi）时用一次。
 */
const resultsUi = computed(() => normalizeResultsUi((node.data as { resultsUi?: unknown }).resultsUi, {
  x: node.computedPosition?.x ?? 0,
  y: node.computedPosition?.y ?? 0,
  width: node.dimensions?.width || 640,
}));

function onResultsUiChange(ui: ResultsUiGeometry) {
  (node.data as { resultsUi?: ResultsUiGeometry }).resultsUi = ui;
}

const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const previewUrl = files.useFileUrl(outputFile, error => showNodeError(error, "成片读取失败"));
const downloadName = computed(() => outputFile.value?.url.split(/[\\/]/).at(-1));

/** 画布节点的工作区文件包装成编辑器内核的文件能力子集；acquireUrl 缺失时只在预览阶段报错。 */
function getFiles(): EditorFiles {
  const workspaceFiles = files.getWorkspaceFiles();
  return {
    readJson: <T,>(path: string) => workspaceFiles.readJson<T>(path),
    writeJson: (path: string, data: unknown, exclusive?: boolean) => workspaceFiles.writeJson(path, data, exclusive),
    mkdir: (path: string) => workspaceFiles.mkdir(path),
    remove: (path: string) => workspaceFiles.remove(path),
    write: (path: string, content: Blob | ArrayBuffer, exclusive?: boolean) => workspaceFiles.write(path, content, exclusive),
    acquireUrl: (path: string, mimeType?: string) => {
      const acquire = workspaceFiles.acquireUrl;
      if (!acquire) throw new Error("当前宿主不支持预览媒体文件");
      return acquire(path, mimeType ?? "application/octet-stream");
    },
  };
}

/**
 * 读取合成清单：executed 为真时把成片挂到 video 输出端口，否则清空输出。
 * ACT: 输出 url 未变时必须保留原对象引用——useFileUrl 按 outputFile 的标识重跑，
 * 每次换新对象都会让预览重新 acquire/release 一次 blob，画布被标脏后 save 钩子又回到这里，
 * 形成「读清单 → 换对象 → 标脏 → 保存 → 再读」的自激循环（实测 66 次写盘/秒）。
 * ACT: onMounted、closeFullscreen 与画布 save 钩子可能并发触发，未合成时每次都要读一次
 * composite.json 并吃一个 404；只合并并发调用，不做缓存，保证成片落盘后立刻能被读到。
 */
let refreshOutputInFlight: Promise<void> | undefined;
async function refreshOutput() {
  if (refreshOutputInFlight) return refreshOutputInFlight;
  const running = runRefreshOutput();
  refreshOutputInFlight = running;
  try {
    await running;
  } finally {
    if (refreshOutputInFlight === running) refreshOutputInFlight = undefined;
  }
}

async function runRefreshOutput() {
  loadingOutput.value = true;
  try {
    const manifest = await files.getWorkspaceFiles().readJson<{ executed?: boolean; output?: string }>(compositeManifestPath);
    const url = manifest?.executed && manifest.output ? manifest.output : "";
    const current = outputs.value.video;
    if (url && current?.dataType === "VIDEO" && current.value.url === url) return;
    outputs.value.video = url
      ? { dataType: "VIDEO", value: { url, mimeType: "video/mp4" } }
      : undefined;
  } catch (reason) {
    // ACT: 只有「清单确实不存在」(404) 才清空成片输出。瞬时失败（网络/权限/宿主未就绪）也清空的话，
    // 下一次 save 钩子刷新成功又会写回 url → 标脏 → 再保存，形成清空/恢复的抖动循环（历史上出现过 66 次写盘/秒）。
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/404|不存在|not found/i.test(message)) outputs.value.video = undefined;
    else console.warn("[multitrackNode] 读取合成清单失败，保留原成片输出：", message);
  } finally {
    loadingOutput.value = false;
  }
}

/** 成片回画布的节点 label：建卡与复用查找共用它，保证 @select 成片节点以 label 含「成片」可再认。 */
const compositeNodeLabel = "成片";

const readAgentCanvas = inject<(() => unknown) | undefined>("agentCanvas", undefined);
const readCanvasContext = inject<(() => unknown) | undefined>("canvas", undefined);

function readBridge(): ReturnType<typeof resolveCanvasBridge> {
  return resolveCanvasBridge(readAgentCanvas) ?? resolveCanvasBridge(readCanvasContext);
}

/**
 * 可用节点类型里解析视频节点 type：画布注册名可能带来源前缀（remote-videoNode）。
 * ACT: 与 packages/tools/canvas/src/assembly.ts 的 resolveNodeType（未导出）同构（directDispatch 的同名旧实现已随死代码删除）；
 * 只查这一种类型且本包不能改 tools 包，故就地写这份 5 行等价。
 */
function resolveVideoNodeType(available: readonly { type: string }[]) {
  if (available.some(item => item.type === "videoNode")) return "videoNode";
  const matches = available.filter(item => item.type.endsWith("-videoNode")).map(item => item.type);
  return matches.length === 1 ? matches[0] : undefined;
}

async function attachCompositeToCanvas(output: string) {
  const call = readBridge()?.call;
  if (!call) return;
  try {
    const overview = await call({ name: "getCanvas", args: { include: ["nodeTypes"], limit: 100 } }) as { availableNodeTypes?: { type: string }[] };
    const videoNodeType = resolveVideoNodeType(overview?.availableNodeTypes ?? []);
    if (!videoNodeType) throw new Error("画布没有视频节点类型，请先启用视频节点插件");
    const listed = await call({ name: "findCanvasNodes", args: { query: compositeNodeLabel, limit: 50 } }) as { nodes?: { id: string; type?: string; label?: string }[] };
    const existing = (listed?.nodes ?? []).find(item => item.id && item.type === videoNodeType && (item.label ?? "").includes(compositeNodeLabel));
    let nodeId = existing?.id ?? "";
    if (!nodeId) {
      const origin = node.computedPosition;
      const x = origin.x + (node.dimensions.width || 640) + 80;
      let y = origin.y;
      for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
        const otherWidth = other.dimensions?.width || 360;
        const otherHeight = other.dimensions?.height || 300;
        if (other.computedPosition.x < x + 360 && other.computedPosition.x + otherWidth > x && other.computedPosition.y < y + 360 && other.computedPosition.y + otherHeight > y) {
          y = other.computedPosition.y + otherHeight + 40;
        }
      }
      const added = await call({ name: "addNode", args: { type: videoNodeType, position: { x, y }, label: `${node.data.label || "多轨编辑器"} · ${compositeNodeLabel}`.slice(0, 200) } }) as { node?: { id?: string } };
      nodeId = added?.node?.id ?? "";
      if (!nodeId) throw new Error("新建视频节点未返回节点 ID");
    }
    await call({ name: "nodeTools", args: { nodeId, name: "node:setVideo", args: { path: output, mimeType: "video/mp4" } } });
  } catch (error) {
    showNodeError(error, "成片挂回画布失败");
  }
}

async function onCompositeDone(output: string) {
  await refreshOutput();
  await attachCompositeToCanvas(output);
}

function openFullscreen() {
  overlayZ.value = nextZIndex();
  editing.value = true;
}

async function closeFullscreen() {
  editing.value = false;
  await nextTick();
  if (!editorDirty.value) void editorRef.value?.reload();
  void refreshOutput();
}

function onEditorDirty(value: boolean) {
  editorDirty.value = value;
}

/** 画布保存/刷新前把编辑器的未落盘修改写回工程文件，并重新读取合成成片。 */
nodeEvent.on("save", async () => {
  if (editorDirty.value) await editorRef.value?.flushSave();
  await refreshOutput();
});

/** 复制/创建副本产生的节点算人工添加，不带 agent 标记。 */
nodeEvent.on("copy", () => ({ agentCreated: false }));

/** ============ agent 命令式操作入口：14 个公开节点函数，全部薄代理编辑器内核 API ============ */

function requireEditor() {
  const editor = editorRef.value;
  if (!editor) throw new Error("多轨编辑器尚未挂载，请稍后重试");
  return editor;
}

/** 分镜号定位键：与 planOperator 一致，形如 S001。 */
const clipIdSchema = z.string().regex(/^S\d{3}$/);

/** patch 载荷形状：对齐 mtrackEdit 的 Partial<MtrackClip>；业务取值约束（seconds 2–60、ratio/resolution 枚举、referenceIds≤9 且 context 镜 ≤3、continuity）由编辑内核 validateClip 整批拦截并回 issues。 */
const clipPatchSchema = z.strictObject({
  clipId: clipIdSchema.optional(),
  title: z.string().optional(),
  sourceRange: z.strictObject({ fromSegment: z.number().int().optional(), toSegment: z.number().int().optional() }).optional(),
  seconds: z.number().int().optional(),
  ratio: z.string().optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
  prompt: z.strictObject({
    subjectDefinitions: z.string(),
    summary: z.string(),
    retentionAnalysis: z.string(),
    detailedDescription: z.string(),
    overallSoundscape: z.string(),
    nonDiegeticMusic: z.string(),
  }).optional(),
  referenceIds: z.array(z.string()).optional(),
  continuity: z.enum(["shot", "context"]).optional(),
  // ACT: 写入路径不收 accepted——验收是用户在多轨界面点「验收」的人工判定（packages/nodeShared/src/mtrack/multitrackEditor.vue 的 acceptClip），
  // agent 经 node:editProject 只能把镜头改到 pending/generating/generated/failed，不能自己把未验收的镜头标成 accepted 去凑合成条件。
  // 读盘路径不受影响：磁盘上已有的 accepted 仍由 mtrackProject 的 normalizeProject/readStatus 原样接受。
  status: z.enum(["pending", "generating", "generated", "failed"]).optional(),
  nodeId: z.string().nullable().optional(),
  assetPath: z.string().nullable().optional(),
  // ACT: 与 planOperator 的 updateAttemptSchema（packages/tools/planOperator/src/index.ts:98-110）同口径用 looseObject：
  // attempts 实际携带 jobId / assetPath / signature / index / parentJobId（mtrackProject.ts 的 ClipAttempt 扩展字段），
  // strictObject 会把它们整批拒收、z.object 会静默剥掉——agent 从 readClips 原样回写时两种都断，
  // 剥掉 jobId 尤其致命：续接链会断在「上一镜没有可用的生成任务号」。上限：未知键不拒，marker 仍可被手改（同 V13 已知上限）。
  attempts: z.array(z.looseObject({ at: z.string(), nodeId: z.string().nullable(), status: z.string(), error: z.string().optional() })).optional(),
  notes: z.string().optional(),
});

/** 六种编辑操作：与 packages/nodeShared/src/mtrack/mtrackEdit.ts 的 EditOp 逐一对应。 */
const editOpSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("add"), clipId: clipIdSchema.optional(), after: clipIdSchema.optional(), patch: clipPatchSchema.optional() }),
  z.strictObject({ type: z.literal("patch"), clipId: clipIdSchema, patch: clipPatchSchema }),
  z.strictObject({ type: z.literal("duplicate"), clipId: clipIdSchema }),
  z.strictObject({ type: z.literal("move"), clipId: clipIdSchema, to: z.number().int().min(0).optional(), after: clipIdSchema.optional() }),
  z.strictObject({ type: z.literal("remove"), clipId: clipIdSchema }),
  z.strictObject({
    type: z.literal("setGlobal"),
    ratio: z.string().optional(),
    style: z.string().optional(),
    systemPrompt: z.string().optional(),
    model: z.strictObject({ providerId: z.string().optional(), modelId: z.string().optional() }).optional(),
  }),
]);

nodeTools.register({
  name: "getStatus",
  description: "读取此多轨节点的绑定与运行状态：bound、projectPath、clipCount、totalSeconds、statusCounts、dirty、saving、dispatching、activeBatchId、batchClipIds、findingsCount、conflictError、loadError。入口探针：先调它确认节点已绑定工程、有没有在跑批次；activeBatchId 为空不代表无批次在跑，按 runbook 从 planOperator mtrackRead 的 attempts 找回",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return requireEditor().status();
  },
});

nodeTools.register({
  name: "bindProject",
  description: "绑定多轨工程：mode=open 必填 path（工作区相对路径、限 .mtrack、禁 ..）；mode=new 缺省顺延 plan/story[-N].mtrack、给了 path 则在该路径新建，均以 exclusive 写入、绝不覆盖已有工程；同路径重复绑定幂等；已绑其他路径报错「已绑定 {path}，如需切换请新建节点或重新加载」。返回绑定后的工程状态",
  parameters: z.strictObject({
    mode: z.enum(["open", "new"]),
    path: z.string().refine(
      value => !value.includes("..") && !value.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(value) && value.endsWith(".mtrack"),
      "path 需为工作区相对路径、以 .mtrack 结尾且不含 ..",
    ).optional(),
  }).refine(args => args.mode === "new" || Boolean(args.path), "mode=open 时必须提供 path"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    await requireEditor().bind(args.mode, args.path);
    signal?.throwIfAborted();
    return requireEditor().status();
  },
});

nodeTools.register({
  name: "readClips",
  description: "读取此节点的分镜片段：from/to 为分镜号（含端点），可省 = 全量。读前已磁盘对账，返回 { clips, updatedAt, missing, conflict }；updatedAt 即后续 planOperator mtrackUpdate 与保存链的 CAS 基线；conflict=true 表示磁盘已被其他操作改过且本节点有未保存修改，此时返回的是内存版本，需先 saveProject 或 reloadProject(discard) 再继续",
  parameters: z.strictObject({ from: clipIdSchema.optional(), to: clipIdSchema.optional() }),
  execute({ from, to }, { signal }) {
    signal?.throwIfAborted();
    return requireEditor().readRange(from, to);
  },
});

nodeTools.register({
  name: "readReferenceMap",
  description: "一次读全四段映射链，不用自己拿 readClips + assetIndex + getReferenceOrder 三处缝合。按镜返回 { clipId, clipNodeId, items, unconnectedCardIds, missingCardIds, orphanSources }：items 逐位给出该镜 referenceIds 的期望位次（expectedIndex/expectedRef）与画布上视频节点实际生效的位次（actualIndex/actualRef，未派工时不返回）、解析到的资产卡（cardId/kind）、画布节点（nodeId/sourceHandle）以及该节点到视频节点 in 端口是否已连线（connected）。missingCardIds = referenceIds 里有、但画布上根本没有可用产出的卡片 id（真断点，派工会报「参考图未就绪」）；unconnectedCardIds = 已派工镜头里卡有产出但没连上视频节点的卡片 id（断线）；未派工的镜头（clipNodeId 为 null）连线尚未建立属正常，只报 missingCardIds、不算 unconnected。orphanSources = 视频节点 in 端口上连了、但 referenceIds 里没有的来源。来源解析与派工共用同一个 resolveReferenceSources，查到的就是派工真会接的。from/to 为分镜号（含端点），可省 = 全量",
  parameters: z.strictObject({ from: clipIdSchema.optional(), to: clipIdSchema.optional() }),
  async execute({ from, to }, { signal }) {
    signal?.throwIfAborted();
    const range = await requireEditor().readRange(from, to);
    signal?.throwIfAborted();
    const call = readBridge()?.call as CanvasCall | undefined;
    if (!call) throw new Error("未取到画布上下文：请先打开画布并等待加载完成，再查询参考映射");
    const cardList = await readIndexCards();
    // ACT: 同一张卡会被多镜共用（SC01 几乎每镜都有），逐镜重查画布会退化成 O(镜数×参考数) 次调用。
    // 这里按卡片 id 记忆一次解析结果，整次查询内复用。上限：只记忆本次调用，不跨调用缓存（画布随时可能改名/删节点）。
    // ACT: 存 Promise 而不是结果——同一镜里两次引用同一张卡（或并发镜）若都先未命中再 await，会重复查两遍画布；
    // 记忆在途 Promise 才能真做到每卡一次调用。上限：只在本次工具调用内记忆，不跨调用缓存。
    const resolvedByCard = new Map<string, Promise<{ nodeId: string; sourceHandle: string } | undefined>>();
    const resolveCard = (cardId: string) => {
      if (!resolvedByCard.has(cardId)) {
        resolvedByCard.set(cardId, resolveReferenceSources({ call, clip: { referenceIds: [cardId] }, cards: cardList, signal: signal ?? new AbortController().signal })
          .then(single => {
            const picked = single.picked[0];
            return picked ? { nodeId: picked.nodeId, sourceHandle: picked.sourceHandle } : undefined;
          }));
      }
      return resolvedByCard.get(cardId)!;
    };
    const clips: {
      clipId: string;
      clipNodeId: string | null;
      items: {
        expectedIndex: number; expectedRef: string; cardId: string; kind: string;
        nodeId: string | null; sourceHandle: string | null; connected: boolean;
        actualIndex?: number; actualRef?: string;
      }[];
      unconnectedCardIds: string[];
      missingCardIds: string[];
      orphanSources: { nodeId: string; sourceHandle: string }[];
    }[] = [];
    // ACT: 单次 nodeTools 调用已有 120 秒上限，画布查询额外受 64 KiB 限制；这里只按镜逐条读入边与参考顺序，
    // 不做整图扫描。上限：每镜 2 次画布调用，超大工程建议配合 from/to 分段查。
    for (const clip of range.clips) {
      signal?.throwIfAborted();
      const resolved = await Promise.all(clip.referenceIds.map(async cardId => ({ cardId, picked: await resolveCard(cardId) })));
      const clipNodeId = clip.nodeId;
      // 画布实况只在镜已派工（有视频节点）时才有意义；未派工时位次就是 referenceIds 顺序本身。
      const incoming = clipNodeId ? await readIncomingSources(call, clipNodeId, signal) : [];
      const actualOrder = clipNodeId ? await readActualOrder(call, clipNodeId, signal) : undefined;
      // H3 六段参考标记按媒质独立编号：<Picture N> 只在 picture 桶（非 sound 卡）内计数，<Audio N> 只在 sound 卡内计数；
      // <Video N> 当前 CardKind 无 video 类型，与 picture 同桶（与 planValidator V7/V8 口径一致）。
      const expectedMedia = clip.referenceIds.map(cardId => {
        const kind = cardList.find(item => item.id === cardId)?.kind;
        return kind === "sound" ? "audio" : "picture";
      });
      const mediaRef = (media: "audio" | "picture", ordinal: number) => `<${media === "audio" ? "Audio" : "Picture"} ${ordinal}>`;
      const items = clip.referenceIds.map((cardId, index) => {
        const card = cardList.find(item => item.id === cardId);
        const picked = resolved.find(item => item.cardId === cardId)?.picked;
        const actualIndex = picked && actualOrder ? actualOrder.findIndex(item => item.nodeId === picked.nodeId && item.sourceHandle === picked.sourceHandle) : -1;
        const media = expectedMedia[index];
        const mediaOrdinal = expectedMedia.slice(0, index + 1).filter(kind => kind === media).length;
        return {
          expectedIndex: index + 1,
          expectedRef: mediaRef(media, mediaOrdinal),
          cardId,
          kind: card?.kind ?? "",
          nodeId: picked?.nodeId ?? null,
          sourceHandle: picked?.sourceHandle ?? null,
          connected: Boolean(picked) && incoming.some(item => item.nodeId === picked!.nodeId && item.sourceHandle === picked!.sourceHandle),
          ...(actualIndex >= 0 ? {
            actualIndex: actualIndex + 1,
            actualRef: mediaRef(expectedMedia[actualIndex], expectedMedia.slice(0, actualIndex + 1).filter(kind => kind === expectedMedia[actualIndex]).length),
          } : {}),
        };
      });
      const pickedKeys = new Set(resolved.flatMap(item => item.picked ? [`${item.picked.nodeId}:${item.picked.sourceHandle}`] : []));
      const missingCardIds = clip.referenceIds.filter(cardId => !resolved.find(item => item.cardId === cardId)?.picked);
      clips.push({
        clipId: clip.clipId,
        clipNodeId: clipNodeId ?? null,
        items,
        // ACT: 未派工的镜头还没有视频节点，连线自然为空——那是「待生成」不是「断线」，
        // 只把真断点（画布无可用产出）报进 missingCardIds，避免 200 镜全量查询时满屏假 gap。
        unconnectedCardIds: clipNodeId ? clip.referenceIds.filter(cardId => {
          const picked = resolved.find(item => item.cardId === cardId)?.picked;
          return Boolean(picked) && !incoming.some(item => item.nodeId === picked!.nodeId && item.sourceHandle === picked!.sourceHandle);
        }) : [],
        missingCardIds,
        orphanSources: incoming.filter(item => !pickedKeys.has(`${item.nodeId}:${item.sourceHandle}`)),
      });
    }
    return { updatedAt: range.updatedAt, conflict: range.conflict, clips };
  },
});

/** 资产卡索引：与编辑器同一份 plan/assetIndex.json。
 *  ACT: 缺文件按空索引处理（老工程没有索引是正常态）；但文件在而读取/解析失败是损坏，
 *  静默吞成空清单会让 node:readReferenceMap 把「索引坏了」报成「画布上没有这张卡」（满屏假 missingCardIds）。
 *  损坏时原样抛错——工具调用报错就是 agent 侧的可发现状态提示，与编辑器把错误并入 readError 展示同口径。 */
async function readIndexCards(): Promise<AssetIndexCard[]> {
  try {
    const index = await files.getWorkspaceFiles().readJson<AssetIndex>(assetIndexPath);
    return Array.isArray(index?.cards) ? index.cards : [];
  } catch (reason) {
    const code = (reason as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code;
    if (code === "ENOENT") return [];
    throw reason;
  }
}

/** 已派工镜头视频节点 in 端口的入边来源；节点已从画布删除时按「没有连线」处理。 */
async function readIncomingSources(call: CanvasCall, nodeId: string, signal?: AbortSignal) {
  try {
    const listed = await call({ name: "getCanvasEdges", args: { nodeIds: [nodeId], direction: "incoming", limit: 200 } }, signal) as {
      edges?: { source: string; sourceHandle?: string | null; targetHandle?: string | null }[];
    };
    return (listed?.edges ?? [])
      .filter(edge => (edge.targetHandle ?? "in") === "in")
      .map(edge => ({ nodeId: edge.source, sourceHandle: edge.sourceHandle ?? "" }));
  } catch {
    return [];
  }
}

/**
 * 视频节点上生效的参考顺序（<Picture N>/<Video N>/<Audio N> 各自媒质编号的真源）；节点没有引用函数（已删除/非视频节点）时返回 undefined。
 * ACT: 与 planValidator V15 的对账口径差别说清：V15 收的 snapshot.referenceOrder 载荷约定为
 * `assets/<卡号>/...` 路径形态（normalizeSourceId 靠正则从路径里提卡号），本函数返回的
 * { nodeId, sourceHandle } 画布节点 id 形态不适用该正则，直接喂给 V15 会逐条误报不一致。
 * 组 snapshot 时用来源节点的产出路径（outputs.image.value.url），不要拿这里的 nodeId 充当。
 */
async function readActualOrder(call: CanvasCall, nodeId: string, signal?: AbortSignal) {
  try {
    const result = await call({ name: "nodeTools", args: { nodeId, name: "node:getReferenceOrder", args: { handleId: "in" } } }, signal) as {
      references?: { nodeId: string; sourceHandle: string }[];
    };
    return result?.references;
  } catch {
    return undefined;
  }
}

nodeTools.register({
  name: "editProject",
  description: "批量编辑工程（编辑器等价能力，内核 mtrackEdit.applyClipOperations）：operations 1–100 条，六种 op——add{clipId?,after?,patch?} / patch{clipId,patch} / duplicate{clipId} / move{clipId,to|after} / remove{clipId} / setGlobal{ratio?,style?,systemPrompt?,model?}。整批原子：任一 op 校验失败整批拒收，问题在 issues 返回、不抛错。真源字段可写，但生成前仍必须跑 planOperator validate 且 error 清零，本工具不代跑完整契约校验。save=true（默认）成功后立即落盘，不等防抖。patch.status 只接受 pending/generating/generated/failed；accepted 由用户在界面验收产生，agent 不能代写",
  parameters: z.strictObject({
    operations: z.array(editOpSchema).min(1).max(100),
    save: z.boolean().default(true),
  }),
  execute({ operations, save }, { signal }) {
    signal?.throwIfAborted();
    return requireEditor().applyOperations(operations, save);
  },
});

nodeTools.register({
  name: "saveProject",
  description: "强制落盘当前工程（编辑器 flushSave），与 800ms 防抖自动保存共用同一条 CAS 保存链；返回 { saved: <写盘后的 updatedAt> }。磁盘被其他操作改过时报冲突而不是覆盖",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    const editor = requireEditor();
    await editor.flushSave();
    signal?.throwIfAborted();
    // ACT: 编辑器保存链（runSave）失败不抛错、只在状态里落 conflictError/loadError（且 loadError 粘滞不清），
    // 故以 flushSave 后 dirty 是否仍为真判定落盘成败，并把已记录的错误原文透传；写盘 await 期间用户新输入会误报一次，重试无害。
    const state = editor.status();
    if (state.dirty) throw new Error(state.conflictError || state.loadError || "保存未生效，请通过 node:getStatus 查看冲突/错误后重试");
    const { updatedAt } = await editor.readRange();
    return { saved: updatedAt };
  },
});

nodeTools.register({
  name: "reloadProject",
  description: "从磁盘重新加载工程并返回新状态；有未保存修改且未传 discard=true 时报错不重载",
  parameters: z.strictObject({ discard: z.boolean().default(false) }),
  async execute({ discard }, { signal }) {
    signal?.throwIfAborted();
    const editor = requireEditor();
    // ACT: 用编辑器自身的 status().dirty 而不是宿主镜像 ref，重载守卫与编辑器内状态单一来源。
    if (editor.status().dirty && !discard) throw new Error("编辑器有未保存修改，传 discard=true 才会丢弃并重载");
    await editor.reload();
    signal?.throwIfAborted();
    return editor.status();
  },
});

nodeTools.register({
  name: "dispatchGenerate",
  description: "把选段交给编辑器经画布 nodeTools 逐镜生成（UI「生成选中段」等价物，不经过对话模型）：clipIds（1–200 个分镜号）或 from+to 二选一（from 必填，to 缺省到最后一个分镜）；includeFinished=false 默认只派 pending/failed 的镜头。立即返回 { batchId, skipped } 不等待生成。与逐镜 SOP 二选一：本会话正在按 SOP 逐镜生成时绝不要再调它，否则同一批镜头双重执行、双份算力。进度看 node:getStatus.batchClipIds / planOperator mtrackRead，停手用 node:cancelBatch",
  parameters: z.strictObject({
    clipIds: z.array(clipIdSchema).min(1).max(200).optional(),
    from: clipIdSchema.optional(),
    to: clipIdSchema.optional(),
    includeFinished: z.boolean().default(false),
  })
    .refine(args => args.clipIds !== undefined || args.from !== undefined, "需提供 clipIds 或 from（可配 to）圈定派工范围")
    .refine(args => args.clipIds === undefined || (args.from === undefined && args.to === undefined), "clipIds 与 from/to 二选一"),
  async execute(args, { signal }) {
    // ACT: nodeTools.call 对单次调用强制 120 秒超时（packages/nodeScaffold/src/nodeTools.ts 的 AbortSignal.timeout(120000)），
    // 生成单镜实测 12+ 分钟，故只发起不待流；进度看 node:getStatus.batchClipIds / planOperator mtrackRead，停用=node:cancelBatch。
    // 本地循环挂节点生命周期：删节点即中断轮询，供应商侧任务留在画布节点上，重开画布可继续看状态。升级路径=宿主级派工注册表。
    signal?.throwIfAborted();
    const editor = requireEditor();
    const clipIds = args.clipIds ?? (await editor.readRange(args.from, args.to)).clips.map(clip => clip.clipId);
    signal?.throwIfAborted();
    return editor.launchDispatch(clipIds, { includeFinished: args.includeFinished, origin: "agent" });
  },
});

nodeTools.register({
  name: "cancelBatch",
  description: "请求取消批次（UI「取消批次」等价物）：batchId 缺省取当前 activeBatchId。abort 本地轮询并对批次内活动任务发一次 POST /api/ai/media/tasks/cancel 批量取消，成功后把在跑镜头回写 pending、attempts 追加 cancelled；取消失败保留 generating 与任务号并报错误（写 pending 会让用户以为已停），可稍后再次取消。立即返回 { cancellationRequested: true, batchId } 不等待；取消成功不等于供应商退费或撤销任务",
  parameters: z.strictObject({ batchId: z.string().min(1).optional() }),
  async execute(args, { signal }) {
    // ACT: 取消同受 nodeTools.call 单次 120 秒超时契约约束，故与派工一样只发起不待流；cancellationRequested 仅表示停止请求已发出。
    signal?.throwIfAborted();
    const launched = await requireEditor().launchCancel(args.batchId);
    return { cancellationRequested: true, batchId: launched.batchId };
  },
});

nodeTools.register({
  name: "pauseBatch",
  description: "请求暂停当前生成批次（UI「本镜结束后暂停」等价物）：这是软闸门——正在跑的镜头不中断，等本镜生成结束后不再开始下一镜；不 abort、不取消供应商任务，整批中止用 node:cancelBatch。没有在跑的批次时闸门不置位，返回的 batchPaused 仍为 false。返回编辑器 status 快照（batchPaused 为闸门状态，batchClipIds 为待续镜头，续跑交 node:resumeBatch）",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    const editor = requireEditor();
    editor.pauseBatch();
    return editor.status();
  },
});

nodeTools.register({
  name: "resumeBatch",
  description: "继续已暂停的批次（UI「继续生成」等价物）：沿用同一 batchId 续跑 clips 里列出的镜头，attempts 标记与批次行都不变。clips 传 node:getStatus 里 batchClipIds 中尚未完成的镜头（1–200 个）；includeFinished=false 默认只跑 pending/failed，要连已生成/已确认的镜头一起重跑才传 true。被拒时直接抛错并带原因（已有派工在跑、clips 已全部完成），不返回状态快照；受理成功返回编辑器 status 快照",
  parameters: z.strictObject({
    clips: z.array(clipIdSchema).min(1).max(200),
    includeFinished: z.boolean().default(false),
  }),
  async execute({ clips, includeFinished }, { signal }) {
    signal?.throwIfAborted();
    const editor = requireEditor();
    await editor.resumeBatch({ clips, includeFinished });
    signal?.throwIfAborted();
    return editor.status();
  },
});

nodeTools.register({
  name: "retryClip",
  description: "重试单个镜头（UI「单镜重试/重新生成本镜」等价物）：只派 clipId 这一镜，生成成功后作为新版本追加——旧版本视频保留，attempts 里的 succeeded 记录按产物文件路径去重即版本列表，新视频自动成为该镜默认；不连带同批其他镜头。生成进行中（dispatching 或 batchRunning 为真）时直接抛错并带原因，需先 node:pauseBatch 等当前镜结束或 node:cancelBatch；受理成功返回编辑器 status 快照",
  parameters: z.strictObject({ clipId: clipIdSchema }),
  async execute({ clipId }, { signal }) {
    signal?.throwIfAborted();
    const editor = requireEditor();
    await editor.retryClip({ clipId });
    signal?.throwIfAborted();
    return editor.status();
  },
});

nodeTools.register({
  name: "rewritePrompt",
  description: "整理单镜提示词（UI「整理提示词」等价物）：只调文本模型，不改工程、不写编辑器的待采用区块，返回 { text, requiresReview }。clipId 缺省取当前选中镜；rules 覆盖内置整理规则（≤20000 字）。整理稿按 H3 官方六段（subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music）输出；结果需用户确认后由 agent 自行用 node:editProject 写回本镜 prompt 六段（H3 官方段名与顺序）；生成中整理会返回服务端 409 原文，错误原样抛出、不重试",
  parameters: z.strictObject({ clipId: clipIdSchema.optional(), rules: z.string().max(20000).optional() }),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    const result = await requireEditor().rewritePrompt(args);
    signal?.throwIfAborted();
    return result;
  },
});

nodeTools.register({
  name: "refreshOutput",
  description: "重新读取 plan/composite.json 合成清单：executed 为真时把成片挂到节点 video 输出端口并在卡片播放，否则清空输出；返回 { hasOutput, url? }。planOperator composite execute=true 之后调它刷新成片展示",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await refreshOutput();
    signal?.throwIfAborted();
    const video = outputs.value.video;
    return video?.dataType === "VIDEO" ? { hasOutput: true, url: video.value.url } : { hasOutput: false };
  },
});

onMounted(refreshOutput);
</script>

<style lang="scss" scoped>
.mtrackCardContent {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .cardHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }

  .cardTitle {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
  }

  .assetRow {
    display: flex;
    align-items: flex-start;
    gap: 6px;

    .agentTag {
      flex-shrink: 0;
    }
  }

  .outputRow {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .outputHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .outputLabel {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  .editorAwayHint {
    margin: 0;
    padding: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    border-radius: 4px;
    text-align: center;
  }
}

.mtrackEditorHost {
  height: 500px;
  min-height: 0;
}

/* ACT: 右下角的画布缩放手柄。默认透明，鼠标进入卡片时显现，不干扰正常阅读。
   手柄渲染在 el-card 的插槽里，但绝对定位的包含块是 .nodeSkeleton（position: relative），
   所以右/下各内缩 2px 贴在卡片内角，避免半截露在卡片边框外。 */
.resizeHandle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: var(--el-color-primary);
  opacity: 0;
  cursor: nwse-resize;
  transition: opacity 0.15s;

}

/* ACT: 手柄在 nodeSkeleton 内部，作用域样式选不到祖先，只能整条选择器走 :global。
   写成 `:global(.nodeSkeleton:hover) &` 会被编译成不带后代的 `.nodeSkeleton:hover`，
   手柄永远只有悬停自身才显形，等于藏起来，所以这里直接写完整选择器。 */
:global(.nodeSkeleton:hover .resizeHandle),
.resizeHandle:hover {
  opacity: 1;
}

.mtrackOverlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow: hidden;
  background: var(--el-bg-color);

  .overlayHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .overlayTitle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  /* ACT: 宿主默认 min-height:auto，内容超过一屏时不肯收缩，编辑器会整块溢出遮罩层且内容滚不到。
     补 min-height:0 后高度由可用空间决定，滚动交回编辑器内部的 .workbenchScroll。 */
  .fullscreenHost {
    flex: 1;
    height: auto;
    min-height: 0;
  }
}
</style>
