<template>
  <el-popover
    v-model:visible="visible"
    virtualTriggering
    :virtualRef="trigger"
    placement="bottom-start"
    :width="420"
    :persistent="false"
    :showArrow="false"
    :disabled="disabled"
    :popperStyle="{ maxWidth: 'calc(100vw - 24px)', padding: '16px', borderRadius: '12px' }">
    <div class="assetImportPanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @keydown.esc.prevent="close()">
      <div class="panelHeader">
        <strong>导入资产与分镜</strong>
        <span>剧本 → 资产卡 + 分镜 → plan</span>
      </div>

      <el-alert v-if="modelError" :title="modelError" type="error" :closable="false" showIcon />
      <el-alert v-if="imageError" :title="imageError" type="warning" :closable="false" showIcon />
      <el-alert v-if="!modelError && !model && models.length" title="未选择抽取模型：只在需要从正文抽取时才要选；资产卡与分镜已定稿（会话里直接导入）不需要模型" type="info" :closable="false" showIcon />

      <div class="fieldRow">
        <span class="fieldLabel">文本来源</span>
        <el-select
          v-model="sourcePath"
          class="fieldControl"
          filterable
          clearable
          noDataText="工作区根目录没有文件"
          placeholder="选择工作区文本文件"
          aria-label="文本来源文件"
          :loading="listing"
          :disabled="busy"
          @visible-change="opened => opened && loadEntries()">
          <el-option v-for="entry in entries" :key="entry.path" :label="entry.path" :value="entry.path" />
        </el-select>
        <el-button class="refreshButton" text :icon="IconRefresh" :loading="listing" title="刷新文件列表" aria-label="刷新文件列表" @click="loadEntries()" />
      </div>

      <el-input
        v-model="pastedText"
        class="scriptInput"
        type="textarea"
        :rows="4"
        resize="none"
        :disabled="busy"
        placeholder="或直接粘贴剧本/小说/分镜正文（粘贴内容优先于所选文件）"
        aria-label="粘贴正文" />

      <div class="fieldRow">
        <span class="fieldLabel">抽取模型</span>
        <el-select
          v-model="model"
          class="fieldControl"
          noDataText="请先在设置中添加文本模型"
          placeholder="选择文本模型"
          aria-label="抽取模型"
          :loading="loadingModels"
          :disabled="busy || !models.length">
          <el-option v-for="item in models" :key="`${item.providerId}/${item.modelId}`" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
        </el-select>
      </div>

      <div class="fieldRow">
        <span class="fieldLabel">资产图模型</span>
        <el-select
          v-model="imageModel"
          class="fieldControl"
          clearable
          noDataText="请先在设置中添加图片模型"
          placeholder="选择出资产图用的图片模型"
          aria-label="资产图模型"
          :loading="loadingModels"
          :disabled="busy || !imageModels.length">
          <el-option v-for="item in imageModels" :key="`${item.providerId}/${item.modelId}`" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
        </el-select>
      </div>

      <div class="fieldRow">
        <span class="fieldLabel">画幅</span>
        <el-select v-model="ratio" class="fieldControl" aria-label="视频画幅" :disabled="busy">
          <el-option v-for="option in ratioOptions" :key="option" :label="option" :value="option" />
        </el-select>
      </div>

      <el-input v-model="style" class="styleInput" :disabled="busy" placeholder="全片统一风格词（可选）" aria-label="全片统一风格词" />
      <el-input v-model="systemPrompt" class="promptInput" type="textarea" :rows="2" resize="none" :disabled="busy" placeholder="全局约束（可选）：时代设定、统一排除项" aria-label="全局约束" />
      <el-checkbox v-model="generateImages" class="imageCheckbox" :disabled="busy || !imageModels.length">同时生成资产图并放进画布</el-checkbox>

      <div class="panelActions">
        <el-button :loading="extracting" :disabled="!canExtract" @click="extract()">抽取预览</el-button>
        <el-button type="primary" :loading="running" :disabled="busy || !selectedAssets.length" @click="confirmImport()">写入 plan（{{ selectedAssets.length }} 张资产 / {{ extraction?.shots.length ?? 0 }} 个分镜）</el-button>
      </div>

      <el-alert v-if="error" class="panelError" :title="error" type="error" :closable="false" showIcon />
      <div v-if="summary" class="panelSummary" aria-live="polite">{{ summary }}</div>

      <div v-if="extraction" class="previewArea">
        <div class="previewGroup">
          <div class="groupTitle">资产清单（{{ selectedAssets.length }}/{{ extraction.assets.length }}）</div>
          <label v-for="asset in extraction.assets" :key="asset.id" class="previewItem">
            <el-checkbox v-model="checked[asset.id]" :disabled="busy" />
            <span class="itemId">{{ asset.id }}</span>
            <span class="itemName">{{ asset.name || "未命名" }}</span>
            <small>{{ kindLabels[asset.kind] }}{{ asset.textOnly ? " · 仅文字" : "" }}</small>
          </label>
        </div>
        <div class="previewGroup">
          <div class="groupTitle">分镜（{{ extraction.shots.length }}）</div>
          <div v-for="(shot, index) in extraction.shots" :key="`${index}-${shot.title}`" class="previewItem">
            <span class="itemId">{{ index + 1 }}</span>
            <span class="itemName">{{ shot.title || "未命名" }}</span>
            <small>{{ shot.seconds }}s · {{ shot.referenceIds.join(" ") || "无参考" }}</small>
          </div>
        </div>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useNode, useVueFlow, type Node } from "@vue-flow/core";
import { ElAlert, ElButton, ElCheckbox, ElInput, ElMessage, ElOption, ElPopover, ElSelect } from "element-plus";
import { IconRefresh } from "@tabler/icons-vue";
import { useNodeAi, useNodeFiles, type NodeAiModel, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { ratioOptions } from "@toonflow/node-shared/mtrack/mtrackProject";
import { extractAssets, importAssets, kindLabels, normalizeExtraction, pickRatio, type AssetExtraction, type AssetImportClipOverride, type AssetImportModel, type AssetImportProgress, type AssetImportSummary } from "../assetImport";

type ImportRequest = {
  path?: string;
  text?: string;
  extraction?: AssetExtraction;
  ratio?: string;
  style?: string;
  systemPrompt?: string;
  generateImages?: boolean;
  /** 按 clipId 覆盖抽取出来的分镜（原文已写好视频提示词时用它原样落进工程）。 */
  clips?: AssetImportClipOverride[];
  model?: string;
  /** 出资产图用的图片模型；勾选了出图又没传就要显式选，不再默认拿列表第一个。 */
  imageModel?: string;
  signal?: AbortSignal;
};

const props = defineProps<{ active: boolean; disabled?: boolean }>();
const emit = defineEmits<{ summary: [summary: string] }>();
const { node } = useNode();
const { addNodes, addEdges, getSelectedNodes, nodeTypes, onNodeDragStart, onSelectionStart, onMoveStart } = useVueFlow();
const ai = useNodeAi();
const files = useNodeFiles();
const visible = ref(false);
const trigger = ref<HTMLElement>();
const entries = ref<{ name: string; path: string; type: string }[]>([]);
const listing = ref(false);
const loadingModels = ref(false);
const sourcePath = ref("");
const pastedText = ref("");
const models = ref<NodeAiModel[]>([]);
const mediaModels = ref<NodeMediaModel[]>([]);
const imageModels = computed(() => mediaModels.value.filter(item => item.type === "image"));
const model = ref("");
const imageModel = ref("");
const ratio = ref<string>(ratioOptions[0]);
const style = ref("");
const systemPrompt = ref("");
const generateImages = ref(false);
const extraction = ref<AssetExtraction>();
const checked = ref<Record<string, boolean>>({});
const extracting = ref(false);
const running = ref(false);
const error = ref("");
const summary = ref("");
const progress = ref<AssetImportProgress | null>(null);
const lastFailed = ref<{ id: string; reason: string }[]>([]);
const lastWarnings = ref<string[]>([]);
let controller: AbortController | undefined;
let unmounted = false;
let placed = 0;
/** 本次运行已建的资产图节点 id：取消/失败时它们留在画布上，Agent 侧可用画布工具 deleteNodes 清理（单次 ≤64，连带删边）。 */
let placedIds: string[] = [];
let aborted = false;

const busy = computed(() => extracting.value || running.value);
const textReady = computed(() => !!pastedText.value.trim() || !!sourcePath.value);
const modelError = computed(() => models.value.length ? "" : "未配置文本模型：请先在设置里添加文本模型，否则无法抽取资产与分镜");
const imageError = computed(() => imageModels.value.length ? "" : "未配置图片模型：取消勾选「同时生成资产图」仍可只导入资产卡与分镜");
const selectedAssets = computed(() => (extraction.value?.assets ?? []).filter(asset => checked.value[asset.id]));
const canExtract = computed(() => textReady.value && !!model.value && !modelError.value && !busy.value);

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "导入失败";
}

// ACT: 面板始终持有自己的 controller，并把调用方 signal（agent 经 node:importScript 传入）桥接进来：
// 任一侧 abort 都停掉本轮导入，卸载也能中断 agent 触发的运行。桥接监听在 extra 自身 abort 时自动摘除，
// 每次导入最多挂一个；下一次 nextSignal 会先 abort 掉旧 controller。
function nextSignal(extra?: AbortSignal) {
  controller?.abort();
  controller = new AbortController();
  const owned = controller;
  const abort = () => owned.abort();
  if (extra) {
    if (extra.aborted) abort();
    else extra.addEventListener("abort", abort, { once: true });
  }
  return owned.signal;
}

function modelKey(item: { providerId: string; modelId: string }): string {
  return JSON.stringify([item.providerId, item.modelId]);
}

/**
 * 显式选择 + 可用列表校验：没选、或选了一个不在列表里的（设置里删过、密钥没配）都直接抛错并报出可用清单。
 * ACT: 这里刻意不做任何回落。原来 loadModels 会盲取第一个文本模型当默认，碰上排在前面但不可用的供应商，
 * 请求会挂在 SSE 上等外层画布桥 120 秒掐断，表现成「导入节点持续超时」；宁可当场报错也不静默等死。
 */
function pickModel(list: { providerId: string; modelId: string }[], value: string | undefined, purpose: string): AssetImportModel {
  // 清单为空多半是拉取失败或压根没配，不能报成「你没选」——那会把人往错的方向查。
  if (!list.length) throw new Error(`${purpose}清单为空：设置里没有可用模型，或模型列表拉取失败，重试或去设置里添加`);
  const choices = list.map(modelKey).join(" / ");
  const target = parseModel(value ?? "");
  // ACT: 文案同时给面板人工和会话调用看——人工在下拉里选，会话传 JSON 编号；两边都不接受「没选就用第一个」。
  if (!target) throw new Error(`未选择${purpose}：在面板下拉里选一个（会话里调用请传 JSON.stringify([providerId, modelId])），可用清单 ${choices}`);
  if (!list.some(item => modelKey(item) === modelKey(target))) {
    throw new Error(`${purpose} ${target.providerId}/${target.modelId} 不在当前可用列表里（设置里可能已删除或未配好密钥）；可用清单 ${choices}`);
  }
  return target;
}

function parseModel(value: string): AssetImportModel | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return undefined;
    return { providerId: parsed[0], modelId: parsed[1] };
  } catch {
    return undefined;
  }
}

let pendingModels: Promise<void> | undefined;

function loadModels(): Promise<void> {
  // ACT: 并发合流。原来 loadingModels 为真时第二个调用直接 return，runImport 会拿着还没填好的空清单去校验编号，
  // 把本来可用的模型误报成「不在当前可用列表里」；现在所有调用等同一批请求，失败后下次重试。
  pendingModels ??= (async () => {
    loadingModels.value = true;
    try {
      const [textModels, mediaModelList] = await Promise.all([ai.getModels(), ai.getMediaModels()]);
      models.value = textModels;
      mediaModels.value = mediaModelList;
      // ACT: 不做默认选择——列表第一个未必可用，静默选中它等于把失败推迟到超时（画布桥 120 秒会掐掉）。
      // 唯一例外是列表只有一个候选：没有「猜错」的可能，预选掉省一次点击。多候选一律要求显式选。
      // 其余只把已经不在可用列表里的旧选择清掉，避免面板继续拿着一个设置里已删除的编号。
      const imageList = mediaModelList.filter(item => item.type === "image");
      if (!model.value && textModels.length === 1) model.value = modelKey(textModels[0]);
      if (model.value && !textModels.some(item => modelKey(item) === model.value)) model.value = "";
      if (!imageModel.value && imageList.length === 1) imageModel.value = modelKey(imageList[0]);
      if (imageModel.value && !imageList.some(item => modelKey(item) === imageModel.value)) imageModel.value = "";
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) error.value = messageOf(cause);
    } finally {
      loadingModels.value = false;
      pendingModels = undefined;
    }
  })();
  return pendingModels;
}

async function loadEntries() {
  if (listing.value) return;
  listing.value = true;
  try {
    const { entries: listed } = await files.getWorkspaceFiles().list();
    entries.value = listed.filter(entry => entry.type === "file").sort((left, right) => left.path.localeCompare(right.path));
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    listing.value = false;
  }
}

async function readScript(path: string) {
  const text = await files.getWorkspaceFiles().readText(path);
  if (!text.trim()) throw new Error(`${path} 是空文件`);
  return text;
}

async function resolveSource(input: ImportRequest) {
  const pasted = (input.text ?? "").trim();
  if (pasted) return pasted;
  const path = input.path ?? sourcePath.value;
  return path ? await readScript(path) : "";
}

function open(event: MouseEvent) {
  if (props.disabled) return;
  trigger.value = event.currentTarget as HTMLElement;
  visible.value = !visible.value;
  if (visible.value) void loadEntries();
}

function close() {
  visible.value = false;
}

async function extract() {
  if (busy.value) return;
  const target = parseModel(model.value);
  if (!target) {
    error.value = "请选择抽取用的文本模型";
    return;
  }
  extracting.value = true;
  error.value = "";
  summary.value = "";
  try {
    const text = await resolveSource({});
    if (!text.trim()) throw new Error("请先粘贴正文或选择工作区文本文件");
    const result = await extractAssets({ ai, model: target, text, signal: nextSignal() });
    extraction.value = result;
    // 抽取到的全片风格与约束回填到空输入框，让「看到什么就写什么」成立；非空时不动用户已填的内容。
    if (!style.value.trim()) style.value = result.style;
    if (!systemPrompt.value.trim()) systemPrompt.value = result.systemPrompt;
    checked.value = Object.fromEntries(result.assets.map(asset => [asset.id, !asset.textOnly]));
    ElMessage.success(`抽取到 ${result.assets.length} 张资产卡与 ${result.shots.length} 个分镜`);
  } catch (cause) {
    if (!(cause instanceof Error && cause.name === "AbortError")) error.value = messageOf(cause);
  } finally {
    extracting.value = false;
  }
}

async function confirmImport() {
  if (busy.value) return;
  if (!extraction.value) {
    await extract();
    if (!extraction.value || error.value) return;
  }
  const current = extraction.value;
  if (!current) return;
  const assets = current.assets.filter(asset => checked.value[asset.id]);
  if (!assets.length) {
    error.value = "请至少勾选一张资产卡";
    return;
  }
  try {
    await runImport({ extraction: { ...current, assets } });
    visible.value = false;
  } catch (cause) {
    error.value = messageOf(cause);
  }
}

/** node:importScript 入口：与面板同一套链路，只是不依赖面板打开与按钮状态。 */
async function runImport(input: ImportRequest): Promise<AssetImportSummary> {
  if (running.value) throw new Error("导入进行中，请稍后重试");
  if (unmounted) throw new Error("节点已卸载，无法再导入");
  // ACT: running 必须在第一个 await 之前同步置位。原来放在 loadModels/resolveSource 之后，同一轮并行发两个
  // node:importScript 时两边都会通过检查，后一个的 nextSignal() 会把前一个 abort 掉，双方都留下画布节点与 assets/ 产出。
  running.value = true;
  // ACT: agent 触发的运行也要挂在面板自己的 controller 上，否则 onBeforeUnmount 停不掉它，
  // 结束后还会用 addNodes 往已卸载的 flow 写节点。
  const signal = nextSignal(input.signal);
  error.value = "";
  summary.value = "";
  progress.value = null;
  placed = 0;
  placedIds = [];
  aborted = false;
  lastFailed.value = [];
  lastWarnings.value = [];
  try {
    // 契约优先：带了定稿的资产卡与分镜就一条模型都不调，也就没有「先选对文本模型」这个前置条件。
    const given = input.extraction ? normalizeExtraction(input.extraction) : undefined;
    let target: AssetImportModel | undefined;
    let imageTarget: AssetImportModel | undefined;
    const wantImages = input.generateImages ?? generateImages.value;
    // ACT: 每次都重新拉一遍模型清单——用户在设置里改过供应商后拿旧清单校验编号，会把可用模型误判成不可用。
    if (!given || wantImages) await loadModels();
    if (!given) {
      target = pickModel(models.value, input.model ?? model.value, "抽取用文本模型");
      // Agent 显式选的模型回写到面板下拉，人工看得见这次用的是哪一个，也随时能改成自己的。
      model.value = modelKey(target);
    }
    if (wantImages) {
      imageTarget = pickModel(imageModels.value, input.imageModel ?? imageModel.value, "资产图图片模型");
      imageModel.value = modelKey(imageTarget);
    }
    let text: string | undefined;
    if (!given) {
      text = await resolveSource(input);
      if (!text.trim()) throw new Error("请先粘贴正文或选择工作区文本文件");
    }
    const result = await importAssets({
      ai,
      workspace: files.getWorkspaceFiles(),
      model: target,
      text,
      extraction: given,
      clips: input.clips,
      ratio: pickRatio(input.ratio ?? ratio.value),
      style: input.style ?? (style.value.trim() || undefined),
      systemPrompt: input.systemPrompt ?? (systemPrompt.value.trim() || undefined),
      generateImages: wantImages,
      imageModel: imageTarget,
      assetDirectory: `assets/${node.id}`,
      createImageNode: item => Promise.resolve(createImageNode(item)),
      signal,
      onProgress: event => { progress.value = event; },
    });
    lastFailed.value = result.failed;
    lastWarnings.value = result.warnings;
    summary.value = `${result.cards} 张资产 · ${result.shots} 个分镜${result.images ? ` · ${result.images} 张资产图` : ""}${result.failed.length ? ` · ${result.failed.length} 张出图失败` : ""}${result.warnings.length ? ` · ${result.warnings.length} 条提醒` : ""} · ${result.projectPath}`;
    emit("summary", summary.value);
    ElMessage.success(`已写入 ${result.indexPath} 与 ${result.projectPath}`);
    return result;
  } catch (cause) {
    aborted = signal.aborted;
    error.value = messageOf(cause);
    throw cause;
  } finally {
    running.value = false;
    progress.value = null;
  }
}

function createImageNode(item: { path: string; mimeType: string; label: string; refs?: { id: string; nodeId: string }[] }) {
  // ACT: 卸载后画布 flow 已销毁，再 addNodes 会往不存在的实例写节点；这里直接拒绝并让调用方计入失败。
  if (unmounted) throw new Error("节点已卸载，未再创建资产图节点");
  if (!nodeTypes?.value?.["remote-imageNode"]) throw new Error("请先启用图片节点插件，否则资产图无处安放");
  const origin = node.computedPosition;
  const width = node.dimensions?.width || 280;
  // ACT: 资产图按 3 列网格往外排，不做重叠检测；同画布已有节点可能被压住，拖动即可。
  const position = { x: origin.x + width + 120 + (placed % 3) * 320, y: origin.y + Math.floor(placed / 3) * 360 };
  placed += 1;
  const id = crypto.randomUUID();
  const created: Node = {
    id,
    type: "remote-imageNode",
    position,
    data: { label: item.label, outputs: { image: { dataType: "IMAGE", value: { url: item.path, mimeType: item.mimeType } } } },
  };
  addNodes([created]);
  placedIds.push(id);
  // ACT: 衍生卡与基卡自动连线（基卡 image 口 → 本卡 in 口）：画布上直接看见衍生链，后续人工重出衍生图时参考线已就位；
  // 基卡节点若已在别处被删，addEdges 静默落空不影响出图。
  for (const ref of item.refs ?? []) {
    addEdges({ id: crypto.randomUUID(), source: ref.nodeId, sourceHandle: "image", target: id, targetHandle: "in" });
  }
  return id;
}

watch(() => props.active, active => { if (!active) close(); });
watch(() => props.disabled, disabled => { if (disabled) close(); }, { flush: "sync" });
watch(() => getSelectedNodes.value.length, count => { if (count !== 1) close(); });
onNodeDragStart(() => close());
onSelectionStart(() => close());
onMoveStart(() => close());
onMounted(() => { void loadModels(); });
onBeforeUnmount(() => {
  // ACT: 面板自己的 controller 与 agent 传入的 signal 已桥接，卸载必定中断本轮导入（含 agent 触发的运行）。
  unmounted = true;
  controller?.abort(new Error("节点已卸载，导入已停止"));
  controller = undefined;
});

/**
 * node:importModels 读这里：可用清单 + 面板当前选择。Agent 只能从这里给的编号里挑，
 * 挑完用 node:setModel 定下来或直接带进 node:importScript，不再存在「节点自己猜一个模型」。
 */
async function modelChoices() {
  await loadModels();
  return {
    text: models.value.map(item => ({
      value: modelKey(item), label: item.label, providerLabel: item.providerLabel, protocol: item.protocol,
      contextWindow: item.contextWindow, maxOutputTokens: item.maxOutputTokens,
    })),
    image: imageModels.value.map(item => ({ value: modelKey(item), label: item.label, providerLabel: item.providerLabel })),
    current: { model: model.value, imageModel: imageModel.value },
  };
}

/** node:setModel：Agent 调整面板当前的抽取/出图模型；只认清单内编号，人工之后仍能在下拉里改回去。 */
async function setModel(input: { model?: string; imageModel?: string }) {
  await loadModels();
  if (input.model !== undefined) model.value = modelKey(pickModel(models.value, input.model, "抽取用文本模型"));
  if (input.imageModel !== undefined) imageModel.value = modelKey(pickModel(imageModels.value, input.imageModel, "资产图图片模型"));
  return { model: model.value, imageModel: imageModel.value };
}

/** node:importStatus 读的就是这里：跑没跑、跑到第几张、上次结果、失败与提醒清单、取消后的残留节点。 */
function status() {
  return {
    running: running.value,
    extracting: extracting.value,
    aborted,
    phase: progress.value?.phase ?? "",
    done: progress.value?.done ?? 0,
    total: progress.value?.total ?? 0,
    summary: summary.value,
    error: error.value,
    failed: lastFailed.value,
    warnings: lastWarnings.value,
    placedNodeIds: placedIds,
  };
}

defineExpose({ open, close, runImport, extracting, running, status, modelChoices, setModel });
</script>

<style scoped lang="scss">
.assetImportPanel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(560px, calc(100vh - 160px));
  overflow-y: auto;
  color: var(--el-text-color-primary);

  .panelHeader {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;

    span {
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }

  .fieldRow {
    display: flex;
    align-items: center;
    gap: 8px;

    .fieldLabel {
      flex: none;
      width: 60px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .fieldControl {
      flex: 1;
      min-width: 0;
    }

    .refreshButton {
      flex: none;
    }
  }

  .panelActions {
    display: flex;
    gap: 8px;

    .el-button {
      flex: 1;
      margin-left: 0;
    }
  }

  .panelError {
    margin: 0;
  }

  .panelSummary {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .previewArea {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--el-border-color-light);
    padding-top: 10px;

    .previewGroup {
      display: flex;
      flex-direction: column;
      gap: 4px;

      .groupTitle {
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }

      .previewItem {
        display: flex;
        align-items: center;
        gap: 6px;

        .itemId {
          flex: none;
          min-width: 34px;
          color: var(--el-text-color-secondary);
          font-variant-numeric: tabular-nums;
          font-size: 12px;
        }

        .itemName {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: 13px;
        }

        small {
          flex: none;
          color: var(--el-text-color-secondary);
          font-size: 12px;
        }
      }
    }
  }
}
</style>
