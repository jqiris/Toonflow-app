<template>
  <div ref="editorRoot" class="mtrackEditor">
    <div v-if="!bound" class="bindBar">
      <p class="bindHint">这个节点还没有绑定工程文件。绑定后才有镜头可编辑；同一工作区的多个节点可以共用同一份工程，也可以各自新建。</p>
      <div class="bindActions">
        <template v-if="probe.exists">
          <span class="bindMeta">{{ defaultProjectPath }} · {{ probe.clips }} 镜 · 更新于 {{ localizeTime(probe.updatedAt) }}</span>
          <el-button size="small" type="primary" :loading="binding" @click="openExisting">打开现有工程</el-button>
        </template>
        <el-button size="small" :type="probe.exists ? 'default' : 'primary'" :loading="binding" @click="createProject">新建空白工程</el-button>
      </div>
    </div>
    <template v-else>
      <div v-if="conflictError" class="conflictBar" role="alert">
        <span>{{ conflictError }}</span>
        <el-button size="small" type="primary" @click="reloadProject">重新加载</el-button>
      </div>
      <template v-else>
        <div class="workbenchScroll">
          <!-- ① 头部：LSC native-h3-scene.js:1330 的 nh-editor-heading（预览与项目管理移交「项目与成片」浮窗）。 -->
          <header class="editorHeading">
            <div class="headingText">
              <h2>镜头创作</h2>
              <p class="editorSubtitle">{{ clips.length }} 个镜头 · 约 {{ totalSecondsText }} 秒 · 预览与项目管理已独立</p>
              <p class="editorMeta">{{ projectMetaText }}</p>
            </div>
          </header>
          <!-- ② 快捷设置行：LSC :1332 的 nh-quick-settings（画幅下拉 + 模型下拉 + 分辨率显示；复用既有 global.ratio / global.model 处理，不新建全片区）。 -->
          <div class="quickSettings">
            <label class="quickField">
              <span class="fieldLabel">画幅</span>
              <el-select :modelValue="project?.global.ratio ?? ''" size="small" placeholder="未设置" @change="handleRatioChange(String($event))">
                <el-option v-for="item in ratioOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </label>
            <label class="quickField">
              <span class="fieldLabel">视频模型</span>
              <el-select
                v-if="modelOptions.length"
                :modelValue="currentModelValue"
                size="small"
                :placeholder="modelLabel || '未设置'"
                @change="onModelSelect"
              >
                <el-option v-for="item in modelOptions" :key="`${item.value.providerId}/${item.value.modelId}`" :label="item.label" :value="item.value" />
              </el-select>
              <span v-else class="quickModelText">{{ modelLabel || "未设置" }}</span>
            </label>
            <span class="quickMeta">{{ dimensionsText }}</span>
          </div>
          <!-- ③ 01 选择镜头：LSC :1333 的 nh-section-heading（批量调整 details + ＋添加镜头）与 nh-tabs 页签条。 -->
          <div class="sectionHeading">
            <h3 class="sectionTitle"><span class="stepIndex">01</span>选择镜头</h3>
            <div class="shotManagement">
              <details class="bulkDetails">
                <summary class="bulkSummary">批量调整</summary>
                <div class="bulkPanel">
                  <h3 class="bulkTitle">批量调整镜头</h3>
                  <div class="bulkControls">
                    <label class="bulkField">
                      统一时长 / 秒
                      <el-input-number v-model="bulkSeconds" size="small" :min="2" :max="60" :step="1" :stepStrictly="true" />
                    </label>
                    <el-button size="small" @click="bulkDuration(bulkSeconds)">应用到全部镜头</el-button>
                    <label class="bulkField">
                      添加镜头数
                      <el-input-number v-model="bulkAddCount" size="small" :min="1" :max="100" :step="1" :stepStrictly="true" />
                    </label>
                    <el-button size="small" @click="bulkAdd(bulkAddCount)">批量添加</el-button>
                    <el-button size="small" @click="acceptAllGenerated">一键验收</el-button>
                  </div>
                  <p class="bulkHint">新镜头默认 5 秒；统一时长按工程契约限制在 2–60 秒整数内。页签上 Ctrl/⌘ 或 Shift 多选保留给批量调整入口，并作为逐镜面板的预填范围。一键验收只翻已有成片、状态为「已生成」的镜头，生成中与失败镜跳过。</p>
                </div>
              </details>
              <el-button size="small" @click="addClip">＋ 添加镜头</el-button>
            </div>
          </div>
          <shotTabs
            :clips="clips"
            :selectedId="selectedId"
            :multiSelectedIds="multiSelectedIds"
            @select="onSelect"
          />
          <!-- ④ 02 镜头内容：LSC :1334-1338 的 nh-workspace（左镜头编辑主区 + 右参考素材 aside）。 -->
          <div class="workspace">
            <shotEditorPane
              v-if="selectedClip"
              :key="selectedClip.clipId"
              :clip="selectedClip"
              :index="selectedIndex"
              :clipCount="clips.length"
              :previousClipId="previousClipId"
              :previousClipJobId="previousClipJobId"
              :rewriteBusy="rewriteBusy"
              :rewritePending="pendingRewrite"
              :canUndo="undoStack.length > 0"
              @patch="onPatch"
              @duplicate="duplicateClip"
              @move="moveClip"
              @remove="removeClip"
              @accept="acceptClip"
              @rewrite="rewriteClipPrompt"
              @regenerate="regenerateClip"
              @adoptRewrite="adoptRewrite"
              @discardRewrite="discardRewrite"
              @updateRewriteDraft="updateRewriteDraft"
              @undoRemove="undoRemove"
            />
            <referencePicker
              v-if="selectedClip"
              :referenceIds="selectedClip.referenceIds"
              :mode="selectedClip.mode"
              :items="pickerItems"
              :thumbnails="referenceThumbnails"
              :connectionBound="Boolean(nodeId)"
              :detachedIds="detachedReferenceIds"
              @update:referenceIds="onPatch({ referenceIds: $event })"
              @update:mode="onPatch({ mode: $event })"
            />
            <p v-else class="workspaceEmpty">在上方页签条点选一个镜头开始编辑。</p>
          </div>
          <!-- 生成结果与校验发现都在「项目与成片」浮窗里看（编辑器里不再重复一块：LSC :1340 的 details 同位区块已收掉）。 -->
          <!-- ⑤ 高级设置：LSC :1342-1348（项目设置 + 公共约束与系统提示词 + 生成范围；采样/LoRA 不暴露——agent API 无此参数）。 -->
          <details ref="advancedDetails" class="sectionAdvanced" @toggle="onAdvancedToggle">
            <summary class="sectionSummary">高级设置 · 项目、约束与生成范围</summary>
            <div class="advancedBody">
              <div class="advancedSection">
                <h3 class="advancedTitle">项目设置</h3>
                <label class="field">
                  <span class="fieldLabel">项目名称</span>
                  <!-- 项目显示名走协议字段 project.name（additive 可选）；projectId 保留给跨文件对账标识，界面不读不写。 -->
                  <el-input size="small" maxlength="80" :modelValue="project?.name ?? ''" @input="onProjectNameInput(String($event))" />
                </label>
              </div>
              <details class="nestedDetails">
                <summary class="nestedSummary">公共约束与系统提示词</summary>
                <div class="advancedSection">
                  <label class="fieldColumn">
                    <span class="fieldLabel">全片风格（渲染时拼到画面正文开头）</span>
                    <el-input type="textarea" :rows="2" :modelValue="project?.global.style ?? ''" @input="onGlobalPatch({ style: String($event) })" />
                  </label>
                  <label class="fieldColumn">
                    <span class="fieldLabel">系统提示词（全片共用）</span>
                    <el-input type="textarea" :rows="3" :modelValue="project?.global.systemPrompt ?? ''" @input="onGlobalPatch({ systemPrompt: String($event) })" />
                  </label>
                  <label class="fieldColumn">
                    <span class="fieldLabel">本镜头的系统提示词（留空沿用全片）</span>
                    <!-- 本镜覆盖走协议字段 clip.systemPromptOverride，派工时经 effectiveGlobal 覆盖 global.systemPrompt 后由 buildPromptText 前拼，空值自然回落到全片。
                         notes 是纯备注字段，不参与提示词下发（agent 有 notes 写入口，当提示词读会有注入隐患）。 -->
                    <el-input type="textarea" :rows="2" :modelValue="selectedClip?.systemPromptOverride ?? ''" :disabled="!selectedClip" @input="onPatch({ systemPromptOverride: String($event) })" />
                  </label>
                </div>
              </details>
              <div class="advancedSection">
                <h3 class="advancedTitle">生成范围</h3>
                <div class="rangeGrid">
                  <label class="field">
                    <span class="fieldLabel">从第几个镜头开始</span>
                    <el-input-number v-model="rangeStart" size="small" :min="1" :max="clips.length || 1" :step="1" />
                  </label>
                  <label class="field">
                    <span class="fieldLabel">生成镜头数（-1 表示到最后）</span>
                    <el-input-number v-model="rangeCount" size="small" :min="-1" :max="clips.length || 1" :step="1" />
                  </label>
                </div>
                <div class="rangeRow">
                  <el-checkbox v-model="includeFinished" size="small">包含已生成</el-checkbox>
                  <el-checkbox v-model="autoMerge" size="small">完成后自动合并</el-checkbox>
                  <!-- ACT: 「带上前面已完成镜头」不引入新状态（契约 §3.2）：合成清单本就是 accepted 镜按工程顺序拼接，勾上验收即带上。 -->
                  <el-checkbox :modelValue="true" size="small" disabled title="合成按工程顺序包含全部已验收镜头（V14 连续性复核），断点会明确报错">合并时带上前面已完成镜头</el-checkbox>
                  <el-button size="small" text @click="batchPanelVisible = true">逐镜面板…</el-button>
                  <el-button size="small" text :loading="loadingReport" @click="loadReport">校验{{ findingsCount ? ` ${findingsCount}` : "" }}</el-button>
                  <el-button size="small" text @click="reconcileFromPanel">刷新状态</el-button>
                  <el-button size="small" text :disabled="!hasAccepted || compositeBusy" :loading="compositeBusy" @click="handleComposite">合成成片</el-button>
                  <!-- 查看成片 = 把画布视口移到「项目与成片」浮窗（LSC 的独立预览窗口位；我们是画布世界层浮窗，跳转即打开）。 -->
                  <el-button v-if="nodeId" size="small" text @click="focusResults">查看成片</el-button>
                </div>
                <p class="rangeText">{{ rangeText }}</p>
                <!-- ACT: 折叠标记原先是隐藏的，面板底部没有任何收起入口；补一颗按钮，收起后回到 01/02 区。 -->
                <div class="advancedActions">
                  <el-button size="small" text @click="collapseAdvanced">收起</el-button>
                </div>
              </div>
            </div>
          </details>
        </div>
        <!-- ⑥ 03 生成视频 footer：LSC :1351 的 nh-run-footer（错误行 + 范围提示 + 按钮组 + 状态行）。 -->
        <runFooter
          :start="rangeStart"
          :count="rangeCount"
          :clipCount="clips.length"
          :error="footerError"
          :dirty="dirty"
          :saving="saving"
          :busy="dispatching"
          :batchRunning="batchRunning"
          :batchPaused="batchPaused"
          :batchId="activeBatchId"
          :batchMessage="batchMessage"
          @save="() => void saveProject()"
          @run="generateFromRange"
          @pause="pauseBatch"
          @resume="footerResume"
          @finish="cancelBatch"
        />
      </template>
    </template>
    <batchPanel
      v-model="batchPanelVisible"
      v-model:includeFinished="includeFinished"
      :clips="clips"
      :batchId="activeBatchId"
      :batchClipIds="batchClipIds"
      :batchPaused="batchPaused"
      :batchRunning="batchRunning"
      :selectedIds="selectedIds"
      @start="startBatch"
      @pause="pauseBatch"
      @resume="panelResume"
      @retry="panelRetry"
      @cancel="cancelBatch"
      @reconcile="reconcileFromPanel"
    />
    <!-- 项目与成片浮窗：只在画布卡片宿主（传了 nodeId）挂载；组件内部 teleport 到画布世界层，
         文档面板宿主没有变换层，留在这里只会每秒探测告警，故整块不渲染。 -->
    <resultsOverlay
      ref="resultsOverlayRef"
      v-if="nodeId"
      :clips="clips"
      :projectName="project?.name"
      :selectedClipId="selectedId"
      :acquireUrl="acquireUrl"
      :acquireNodeVideo="acquireNodeVideo"
      :geometry="resultsGeometry"
      :resolveTarget="resolveResultsTarget"
      :states="states"
      :report="report"
      :readError="reportReadError"
      @geometry="onResultsGeometry"
      @focusEditor="focusEditorNode"
      @previewSelect="selectClipFromOverlay"
      @setDefaultVersion="setClipDefaultVersion"
      @toggleAccept="toggleClipAccept"
      @deleteVersion="deleteVersionInClip"
      @deleteAllVersions="deleteAllVersionsInClip"
      @locateFinding="locateFinding"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { ElButton, ElCheckbox, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect } from "element-plus";
import { useVueFlow } from "@vue-flow/core";
import type { AssetIndex, AssetIndexCard, AssetReport, ClipState, EditorFiles, MtrackClip, MtrackProject, ResultsUiGeometry } from "./mtrackProject";
import {
  assetIndexPath,
  assetReportPath,
  defaultProjectPath,
  normalizeProject,
  normalizeResultsUi,
  continuationJobId,
  createClip,
  nextClipId,
  localizeTime,
  totalSeconds,
  cloneClips,
  mergeProjects,
  normalizeContinuityOrder,
  clipVersions,
  clipStates,
  deleteClipVersion,
  deleteAllClipVersions,
  ratioOptions,
  hasPrompt,
} from "./mtrackProject";
import { readClipGeneration, resolveCanvasBridge, findCardNodeIds, imagePathOf, labelMatchesCard, readNodeDetail, type CanvasCall } from "./directDispatch";
import { composeClipRequest } from "./mediaDispatch";
import { cancelClipTasks, readClipTask, submitClipTask, waitClipTask, type MediaTaskStatus } from "./mediaTask";
import { attemptsOfBatch, batchMarker } from "./batchMark";
import { applyClipOperations } from "./mtrackEdit";
import type { EditOp } from "./mtrackEdit";
import shotTabs from "./components/shotTabs.vue";
import shotEditorPane from "./components/shotEditorPane.vue";
import referencePicker from "./components/referencePicker.vue";
import type { ReferencePickerItem } from "./components/referencePicker.vue";
import runFooter from "./components/runFooter.vue";
import batchPanel from "./components/batchPanel.vue";
import resultsOverlay from "./components/resultsOverlay.vue";

const props = defineProps<{
  /** 每次操作时重新取文件能力：文档面板扩展传 context.files，画布节点传工作区文件包装。 */
  getFiles: () => EditorFiles;
  /** 派工所用的工作区目录（画布所属项目目录）。 */
  directory: string;
  /** 绑定的工程文件路径；空字符串表示这个节点还没有绑定工程，不读取任何已有工程。 */
  projectPath?: string;
  /** 卡片形态的多轨节点自己的 nodeId；派工时优先复用它 in 端口上用户手接的参考连线。独立编辑器不传。 */
  nodeId?: string;
  /** 「项目与成片」浮窗初始几何（宿主把 node.data.resultsUi 归一后传入；缺省时浮窗按锚点缺省摆放）。 */
  resultsUi?: ResultsUiGeometry;
}>();

const emit = defineEmits<{ dirtyChange: [value: boolean]; bind: [path: string]; compositeDone: [output: string]; resultsUiChange: [ui: ResultsUiGeometry] }>();

/** 画布实例：只有卡片宿主（传了 nodeId）才取——独立编辑器没有 VueFlow，取了也是空实例还会告警。 */
let flow: ReturnType<typeof useVueFlow> | undefined;
if (props.nodeId) {
  try {
    flow = useVueFlow();
  } catch {
    flow = undefined;
  }
}

/** 编辑器根 DOM：teleport 目标解析的锚点（节点卡片子树内 closest 到画布变换层）。 */
const editorRoot = ref<HTMLElement>();

/** 高级设置折叠区：展开后把面板顶端对齐到工作台视口，收起入口留在面板底部。 */
const advancedDetails = ref<HTMLDetailsElement>();

function onAdvancedToggle(event: Event) {
  const details = event.currentTarget as HTMLDetailsElement | null;
  const container = details?.parentElement;
  if (!details?.open || !container) return;
  container.scrollTop += details.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
}

function collapseAdvanced() {
  if (advancedDetails.value) advancedDetails.value.open = false;
}

/** 浮窗锚点：本节点（nodeId）的世界位置与宽度；取不到节点时回落到原点。 */
function resolveResultsAnchor() {
  const node = props.nodeId ? flow?.findNode(props.nodeId) : undefined;
  if (!node) return { x: 0, y: 0, width: 0 };
  return { x: node.computedPosition?.x ?? 0, y: node.computedPosition?.y ?? 0, width: node.dimensions?.width || 0 };
}

/** 变换层解析：编辑器挂在节点卡片子树里，closest 找到所属画布的变换层；全屏 teleport 到 body 时回落到全局首查。 */
function resolveResultsTarget(): Element | null {
  return editorRoot.value?.closest(".vue-flow")?.querySelector(".vue-flow__transformationpane")
    ?? document.querySelector(".vue-flow__transformationpane");
}

/** 宿主传入的几何优先；没有时按 t1 约定用节点锚点算缺省（节点右缘外 64px、顶边平齐，1360×1480）。 */
const resultsGeometry = computed(() => props.resultsUi ?? normalizeResultsUi(undefined, resolveResultsAnchor()));

function onResultsGeometry(ui: ResultsUiGeometry) {
  emit("resultsUiChange", ui);
}

/**
 * ACT: 工程路径由宿主决定。文档面板扩展传打开的文件路径；画布节点把自己的绑定写进 node.data，
 * 所以菜单新建的节点不会一打开就继承工作区里已有的工程。两者都不传时才回落到默认工程。
 */
const projectPath = ref(props.projectPath ?? defaultProjectPath);
const bound = computed(() => Boolean(projectPath.value));
watch(() => props.projectPath, value => {
  const next = value ?? defaultProjectPath;
  if (next === projectPath.value) return;
  projectPath.value = next;
  void readProject();
  void loadReport();
});

/** 未绑定工程时探测默认路径：有工程就让用户选「打开现有工程」，没有就直接新建空白工程。 */
const probe = ref<{ exists: boolean; clips: number; updatedAt: string }>({ exists: false, clips: 0, updatedAt: "" });
const binding = ref(false);

async function probeDefaultProject() {
  if (bound.value) return;
  try {
    const raw = await props.getFiles().readJson<MtrackProject>(defaultProjectPath);
    const found = normalizeProject(raw);
    probe.value = { exists: true, clips: found.clips.length, updatedAt: found.updatedAt };
  } catch {
    probe.value = { exists: false, clips: 0, updatedAt: "" };
  }
}

/** 打开工作区里已有的默认工程：只记录绑定，不复制工程内容，多个节点共用一份文件。 */
async function openExisting() {
  binding.value = true;
  try {
    bindProject(defaultProjectPath);
    // ACT: onMounted 时还没绑定，loadReport 会直接清空；绑定后必须重读一次，否则参考顺序里没有可选资产。
    await readProject();
    await loadReport();
  } finally {
    binding.value = false;
  }
}

/**
 * ACT: 工作区写入只写文件、不建父目录，全新项目里没有 plan/，直接写 plan/story.mtrack 会 ENOENT。
 * 这里先补建单层目录；EEXIST（目录已存在）是正常情况，其余错误照常抛出。
 */
async function ensureParentDirectory(path: string) {
  const files = props.getFiles();
  if (!files.mkdir) return;
  const at = path.lastIndexOf("/");
  if (at <= 0) return;
  await files.mkdir(path.slice(0, at)).catch((reason: unknown) => {
    const code = (reason as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code;
    if (code !== "EEXIST") throw reason;
  });
}

/** 新建空白工程的核心：exclusive 写 + 绑定 + 清上一次绑定的残留；UI 按钮与命令式 bind("new") 共用。 */
async function createBlankProject(path: string) {
  const blank: MtrackProject = {
    version: 1,
    projectId: `mtrack-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    global: { ratio: "9:16" },
    clips: [],
  };
  await ensureParentDirectory(path);
  // ACT: 用 exclusive 写：路径探测与写入之间有竞态窗口，独占创建能保证顺手点两次也不会覆盖已有工程。
  await props.getFiles().writeJson(path, blank, true);
  bindProject(path);
  project.value = normalizeProject(blank);
  lastSaved.value = cloneProject(project.value);
  selectedId.value = "";
  multiSelectedIds.value = [];
  // 新建工程后上一份工程的待采用稿已无对应镜头，清掉避免采用时写到新工程的同名编号上。
  rewritePending.value = null;
  // 新建的空白工程没有资产索引，清掉上一次绑定留下的报告与候选，避免参考顺序里出现别的工程的资产。
  report.value = undefined;
  reportReadError.value = "";
  indexCards.value = [];
}

/** 新建空白工程：默认路径已被占用时顺延 plan/story-2.mtrack，绝不覆盖已有工程。 */
async function createProject() {
  binding.value = true;
  try {
    await createBlankProject(await reserveProjectPath());
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : "新建工程失败");
  } finally {
    binding.value = false;
  }
}

function bindProject(path: string) {
  projectPath.value = path;
  loadError.value = "";
  runError.value = "";
  probe.value = { exists: false, clips: 0, updatedAt: "" };
  emit("bind", path);
}

/** 只把「文件不存在」当成可新建；读取出别的错（权限、损坏的 JSON）就直接抛出，避免把已有工程当空文件覆盖。 */
async function pathIsFree(path: string): Promise<boolean> {
  try {
    await props.getFiles().readJson<MtrackProject>(path);
    return false;
  } catch (reason) {
    const status = (reason as { response?: { status?: number } })?.response?.status;
    if (status === 404) return true;
    throw reason;
  }
}

/** 从 plan/story.mtrack 起找第一个不存在的路径，避免新建时覆盖工作区已有工程。 */
async function reserveProjectPath(): Promise<string> {
  for (let index = 1; index <= 50; index += 1) {
    const candidate = index === 1 ? defaultProjectPath : defaultProjectPath.replace(/\.mtrack$/, `-${index}.mtrack`);
    if (await pathIsFree(candidate)) return candidate;
  }
  throw new Error("工作区里的多轨工程过多，请先清理 plan/ 目录");
}
const project = ref<MtrackProject | null>(null);
/** 「项目与成片」浮窗句柄：只用到它 expose 的 expand()（查看成片时先把收起态摊开）。 */
const resultsOverlayRef = ref<{ expand: () => void } | null>(null);
const indexCards = ref<AssetIndexCard[]>([]);
const report = ref<AssetReport | undefined>();
const reportReadError = ref("");
const loadingReport = ref(false);
const loadError = ref("");
/** 生成链路的最近一次失败原文（发起/取消/后台轮询）；与文件读取错误分开，footer 错误行合并展示。 */
const runError = ref("");
const conflictError = ref("");
const saving = ref(false);
const savedAt = ref("");
const selectedId = ref("");
const multiSelectedIds = ref<string[]>([]);
const undoStack = ref<MtrackClip[][]>([]);
const lastSaved = ref<MtrackProject | null>(null);
const dirtyVersion = ref(0);
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** 画布桥未就绪时的模型清单补拉句柄：卸载时一并清掉，避免回调已卸载组件。 */
let modelRetryTimer: ReturnType<typeof setTimeout> | undefined;

const clips = computed(() => project.value?.clips ?? []);
/** 用内容比较而不是对象身份：保存后 lastSaved 必然是新克隆，身份比较会把 dirty 永远卡在 true。 */
const dirty = computed(() => {
  if (!project.value || !lastSaved.value) return false;
  return JSON.stringify(project.value) !== JSON.stringify(lastSaved.value);
});
const selectedClip = computed(() => clips.value.find(clip => clip.clipId === selectedId.value));
const selectedIndex = computed(() => clips.value.findIndex(clip => clip.clipId === selectedId.value));

/** 每镜的设置签名状态（对齐 LSC signatures/context_ok）：工作台与浮窗共用这一份，避免各自遍历。 */
const states = computed<Record<string, ClipState>>(() => (project.value ? clipStates(project.value) : {}));
/** 上一镜（按分镜顺序）与它可用于续接的任务号：给「承接上一镜」的引导文案用。 */
const previousClip = computed(() => (selectedIndex.value > 0 ? clips.value[selectedIndex.value - 1] : undefined));
const previousClipId = computed(() => previousClip.value?.clipId ?? "");
const previousClipJobId = computed(() => continuationJobId(previousClip.value));

/** ISO 时间串统一本地化展示的入口在 mtrackProject，这里只负责头部与绑定探测两处文案。 */
const projectUpdatedAt = computed(() => project.value?.updatedAt ?? "");
/** 头部的更新时间：本地化时间，工程尚未写过时与 LSC 一致显示「尚未保存」。 */
const projectSavedText = computed(() => localizeTime(projectUpdatedAt.value, "尚未保存"));
/** 头部路径行：未绑定工程时说明状态，不能显示由空路径拼出的「 · 尚未保存」。 */
const projectMetaText = computed(() => bound.value ? `${projectPath.value} · ${projectSavedText.value}` : "未绑定工程");
const totalSecondsText = computed(() => totalSeconds(clips.value).toFixed(1));
const findingsCount = computed(() => report.value?.findings?.length ?? 0);

/**
 * 快捷设置行的分辨率显示「W × H · 24fps」：ACT: 显示估算——长边按 megapixels(resolution)×1e6 与画幅比例换算
 * （与 freevideo 实际下发口径同源：aspect=ratio + megapixels=1.0/2.0，freevideo.ts:61-67、:306-308），
 * 仅供预览参考，引擎侧按这两个参数自行取整。
 */
const dimensionsText = computed(() => {
  const ratio = selectedClip.value?.ratio || project.value?.global.ratio || "9:16";
  const resolution = selectedClip.value?.resolution || "768P";
  const [a, b] = ratio.split(":").map(Number);
  if (!a || !b) return `${ratio} · 24fps`;
  const megapixels = resolution.toUpperCase().includes("2K") ? 2 : 1;
  const scale = Math.sqrt((megapixels * 1_000_000) / (a * b));
  return `${Math.round(a * scale)} × ${Math.round(b * scale)} · 24fps`;
});

/** 批量调整（01 区）：本地数字，动作落到既有 bulkDuration/bulkAdd。 */
const bulkSeconds = ref(5);
const bulkAddCount = ref(1);

/**
 * 选段语义（对齐桥契约 §1，页签条与时间线同规则）：
 * - 单击 = 单选；
 * - Ctrl/⌘ 单击 = 追加或取消单个镜头（离散多选，保留给批量调整入口）；
 * - Shift 单击 = 以当前单选为起点选到该镜头（连续起止范围）。
 * 选段范围最终表示为按轨道顺序的有序 clipId 列表，而不是只记起止号。
 */
function onSelect(payload: { clipId: string; additive: boolean; range: boolean }) {
  if (payload.range) {
    const anchor = clips.value.findIndex(clip => clip.clipId === selectedId.value);
    const target = clips.value.findIndex(clip => clip.clipId === payload.clipId);
    if (anchor >= 0 && target >= 0) {
      const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
      multiSelectedIds.value = clips.value.slice(from, to + 1).map(clip => clip.clipId);
      return;
    }
  }
  if (payload.additive) {
    multiSelectedIds.value = multiSelectedIds.value.includes(payload.clipId)
      ? multiSelectedIds.value.filter(id => id !== payload.clipId)
      : [...multiSelectedIds.value, payload.clipId];
    return;
  }
  selectedId.value = payload.clipId;
  multiSelectedIds.value = [];
}

function addClip() {
  if (!project.value) return;
  const clip = createClip(clips.value.length, project.value.global?.ratio ?? "9:16");
  clip.clipId = nextClipId(clips.value);
  project.value.clips.push(clip);
  selectedId.value = clip.clipId;
  multiSelectedIds.value = [];
}

/** 批量调整：把统一时长套到全部镜头，按工程契约夹在 2–60 秒整数内。 */
function bulkDuration(seconds: number) {
  if (!project.value) return;
  const value = Math.min(60, Math.max(2, Math.round(seconds)));
  project.value.clips.forEach(clip => {
    clip.seconds = value;
  });
}

/** 批量添加：复用 addClip 的编号与选中逻辑，循环创建。 */
function bulkAdd(count: number) {
  if (!project.value) return;
  const total = Math.min(100, Math.max(1, Math.round(count)));
  for (let added = 0; added < total; added += 1) addClip();
}

/**
 * 生成范围（LSC v.start / v.count，与 batchPanel 同一语义：镜数 -1 = 到最后一镜）。
 * 数字是唯一真源：页签改选不回写范围，范围也不被面板覆盖（面板按钮读同一组数字之外的自己的本地态，互不干扰）。
 */
const rangeStart = ref(1);
const rangeCount = ref(-1);
/** 「完成后自动合并」：纯 UI 会话态，不持久化进工程（契约 §3.2）。 */
const autoMerge = ref(false);

function clampRange() {
  const total = clips.value.length;
  rangeStart.value = Math.min(Math.max(1, Math.round(rangeStart.value || 1)), Math.max(1, total));
  const max = Math.max(1, total - rangeStart.value + 1);
  rangeCount.value = rangeCount.value < 0 ? -1 : Math.min(Math.max(1, Math.round(rangeCount.value || 1)), max);
}

watch([rangeStart, rangeCount, () => clips.value.length], clampRange);

/** 范围 → clipId 清单：换算逐字对齐 batchPanel.vue:143-148。 */
const rangeClips = computed(() => {
  const total = clips.value.length;
  const from = Math.min(Math.max(1, rangeStart.value), Math.max(1, total));
  const count = rangeCount.value < 0 ? total - from + 1 : Math.max(1, rangeCount.value);
  return clips.value.slice(from - 1, Math.min(from - 1 + count, total)).map(clip => clip.clipId);
});

const rangeText = computed(() => {
  const total = clips.value.length;
  if (!total) return "工程里还没有镜头。";
  if (!rangeClips.value.length) return "当前范围没有镜头，请调整起始镜头。";
  const last = clips.value.findIndex(clip => clip.clipId === rangeClips.value[rangeClips.value.length - 1]) + 1;
  // 只校验范围内提示词：无提示词的镜头会被生成内核拒绝（composeClipRequest 抛「没有提示词」），提前提示避免跑到一半才发现。
  const noPrompt = rangeClips.value.map(clipId => clips.value.find(clip => clip.clipId === clipId)).filter(clip => clip && !hasPrompt(clip));
  const base = rangeCount.value < 0
    ? `本批 ${rangeClips.value.length} 镜：第 ${rangeStart.value} 镜 → 最后一镜（第 ${last} 镜）`
    : `本批 ${rangeClips.value.length} 镜：第 ${rangeStart.value} 镜起，共 ${rangeCount.value} 镜`;
  return noPrompt.length ? `${base} · ${noPrompt.length} 镜缺提示词（${noPrompt.slice(0, 5).map(clip => clip!.clipId).join("、")}${noPrompt.length > 5 ? " 等" : ""}）` : base;
});

/** 高级设置里的全片字段：只改 global 对象，保存走原有的整份快照写盘。 */
function onGlobalPatch(patch: Partial<MtrackProject["global"]>) {
  if (!project.value) return;
  project.value.global = { ...project.value.global, ...patch };
}

/** 项目名称：写协议字段 project.name（additive 可选）；projectId 是对账标识，界面不再借用。 */
function onProjectNameInput(value: string) {
  if (!project.value) return;
  project.value.name = value;
}

/** 全片比例：只接受 ratioOptions 里的值，写回 global.ratio，脏标记推进版本号后由既有防抖队列落盘。 */
function handleRatioChange(value: string) {
  if (!project.value || project.value.global.ratio === value) return;
  if (!(ratioOptions as readonly string[]).includes(value)) return;
  /*
   * ACT: 只写 global.ratio 时已存在的镜仍带旧 clip.ratio，改画幅后旧镜会按旧比例生成（审计 t25-P1-2）。
   * 未产出（pending/failed）的镜跟着换成新比例；已生成/已验收的镜不动，避免与已有成片冲突。
   */
  for (const clip of clips.value) {
    if (clip.status !== "pending" && clip.status !== "failed") continue;
    if (clip.ratio === value) continue;
    writeClipRun(clip.clipId, { ratio: value });
  }
  onGlobalPatch({ ratio: value });
}

/** 全片视频模型：写回 global.model，派工时作为媒体请求的 providerId/modelId 下发。 */
function handleModelChange(value: { providerId: string; modelId: string }) {
  if (!project.value || !value.providerId || !value.modelId) return;
  const current = project.value.global.model;
  if (current?.providerId === value.providerId && current?.modelId === value.modelId) return;
  onGlobalPatch({ model: { providerId: value.providerId, modelId: value.modelId } });
}

type VideoModelOption = { providerId: string; modelId: string; label?: string };

/** 模型清单只能问画布里的视频节点；取不到就是空数组，选择器只显示工程里已存的 global.model。 */
const videoModels = ref<VideoModelOption[]>([]);
let videoModelsLoaded = false;

const modelOptions = computed(() => videoModels.value.map(item => ({
  label: item.label || item.modelId,
  value: { providerId: item.providerId, modelId: item.modelId },
})));

const modelLabel = computed(() => {
  const model = project.value?.global.model;
  if (!model?.providerId || !model.modelId) return "";
  return modelOptions.value.find(option => option.value.providerId === model.providerId && option.value.modelId === model.modelId)?.label
    ?? `${model.providerId} / ${model.modelId}`;
});

const currentModelValue = computed(() => {
  const model = project.value?.global.model;
  if (!model?.providerId || !model.modelId) return undefined;
  return modelOptions.value.find(option => option.value.providerId === model.providerId && option.value.modelId === model.modelId)?.value;
});

/** 下拉的 change 载荷是 unknown，这里收口成 handleModelChange 的入参类型。 */
function onModelSelect(value: unknown) {
  handleModelChange(value as { providerId: string; modelId: string });
}

/**
 * ACT: 没有画布桥（文档面板、画布未激活）时静默返回，不报错也不弹提示——
 * 多轨编辑器常在没有画布的宿主里打开，缺清单只该让选择器降级成只读。
 */
async function loadVideoModels(force = false) {
  if (videoModelsLoaded && !force) return;
  const call = readBridge()?.call;
  if (!call) return;
  try {
    const listed = await call({ name: "findCanvasNodes", args: { limit: 50 } }) as { nodes?: { id?: string; type?: string }[] };
    const nodeId = (listed?.nodes ?? []).find(node => node.id && (node.type ?? "").includes("videoGenerationNode"))?.id;
    if (!nodeId) return;
    const config = await call({ name: "nodeTools", args: { nodeId, name: "node:getConfig", args: {} } }) as { models?: VideoModelOption[] };
    videoModels.value = (config?.models ?? []).filter(item => Boolean(item?.providerId && item?.modelId));
    videoModelsLoaded = true;
  } catch {
    // 画布正在重挂/节点工具暂不可用：保留已有清单，本轮不覆盖。
  }
}

async function readProject() {
  loadError.value = "";
  conflictError.value = "";
  // 重新读盘（重载/切换工程）后旧待采用稿的基线不再可信，直接清空，避免采用时把稿套到新内容上。
  rewritePending.value = null;
  if (!bound.value) {
    project.value = null;
    lastSaved.value = null;
    return;
  }
  try {
    const raw = await props.getFiles().readJson<MtrackProject>(projectPath.value);
    project.value = normalizeProject(raw);
    lastSaved.value = cloneProject(project.value);
    if (!clips.value.some(clip => clip.clipId === selectedId.value)) selectedId.value = clips.value[0]?.clipId ?? "";
    multiSelectedIds.value = [];
  } catch (reason) {
    project.value = null;
    lastSaved.value = null;
    loadError.value = reason instanceof Error ? reason.message : String(reason);
  }
}

function cloneProject(source: MtrackProject): MtrackProject {
  return { ...source, global: { ...source.global }, clips: cloneClips(source.clips) };
}

/**
 * 两个工程除 updatedAt 外内容是否一致（用于判定「这次冲突有没有需要落盘的真实改动」）。
 * updatedAt 是写盘动作本身的产物，不参与比较，否则每次写盘都会被判成一次新改动。
 * ACT: 递归按 key 排序后再序列化，不用裸 JSON.stringify——mergeProjects 以内存对象为底，
 * 键顺序可能沿用内存而非磁盘，裸比较会把「内容相同、键序不同」误判成有改动，乒乓于是切不断。
 */
function sameProjectContent(left: MtrackProject, right: MtrackProject): boolean {
  return stableJson({ ...left, updatedAt: "" }) === stableJson({ ...right, updatedAt: "" });
}

/** 键顺序无关的 JSON 序列化：对象按键名排序，数组保持原序（数组顺序是有语义的）。 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  // 非普通对象（Date/Map 等）交给 JSON.stringify 走原生语义，避免被当成空对象而误判为「无改动」。
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return JSON.stringify(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function reloadProject() {
  await readProject();
  // ACT: 重载不只重读工程，资产索引与报告一起重读——用户在编辑器外改/删 plan/assetIndex.json 后点「重新加载」，
  // 只 readProject 会让参考网格一直挂着旧卡（历史旧账）。
  await loadReport();
}

/** 工作区文件不存在时服务端回 ENOENT：缺失和读取失败要分开，缺失不该被当成读取出错。 */
function isMissingFile(reason: unknown) {
  const error = reason as { response?: { data?: { data?: { code?: string } } } } | undefined;
  return error?.response?.data?.data?.code === "ENOENT";
}

/**
 * ACT: loadReport 可能被并发触发（宿主 projectPath prop 变化与 openExisting/bindCommand 各自调用），
 * 同一时刻的重复读取结果相同、后到的还会覆盖先到的。这里只合并并发调用，不做缓存——
 * 缓存会让用户手动改过 assetIndex.json 后读回旧数据。
 */
let loadReportInFlight: { path: string; running: Promise<void> } | undefined;
async function loadReport() {
  // ACT: 合并只对同一工程生效——切工程时若沿用上一工程的 in-flight，新工程会永远等不到自己的读数。
  if (loadReportInFlight?.path === projectPath.value) return loadReportInFlight.running;
  const path = projectPath.value;
  const running = runLoadReport();
  loadReportInFlight = { path, running };
  try {
    await running;
  } finally {
    if (loadReportInFlight?.running === running) loadReportInFlight = undefined;
  }
}

async function runLoadReport() {
  // ACT: 进函数就置位，让并发调用在这里合并；绑定的路径在 await 之后复查，换过工程就丢弃这批结果。
  const pathAtStart = projectPath.value;
  loadingReport.value = true;
  reportReadError.value = "";
  if (!bound.value) {
    report.value = undefined;
    indexCards.value = [];
    loadingReport.value = false;
    return;
  }
  // 报告与索引各读各的：报告只是校验结果快照，索引才是参考绑定的唯一来源，缺一个不该拖垮另一个。
  // ACT: 结果先落在局部变量，确认路径没变再写状态——否则读完时用户已切到别的工程，旧数据会盖掉新工程的卡片。
  let nextReport: AssetReport | undefined;
  let nextReportError = "";
  try {
    nextReport = await props.getFiles().readJson<AssetReport>(assetReportPath);
  } catch (reason) {
    // 报告缺失（九宫格拆图只写 assetIndex）按「未读取到」处理：不写错误，也不拿空报告假装校验通过。
    nextReportError = isMissingFile(reason) ? "" : reason instanceof Error ? reason.message : String(reason);
  }
  let nextCards: AssetIndexCard[] = [];
  try {
    nextCards = normalizeIndex(await props.getFiles().readJson<AssetIndex>(assetIndexPath));
  } catch (reason) {
    // 老工程没有 assetIndex.json 属正常：按空清单处理并显式清空，避免切换工程后残留上一份的卡片。
    // ACT: 文件在但读/解析失败是损坏，不能静默当空清单——参考网格会摆出一副「没有资产」的样子，
    // 用户看不出是没索引还是索引坏了。错误并入浮窗既有的 readError 通道（与报告读取失败同一条展示）。
    nextCards = [];
    if (!isMissingFile(reason)) {
      const message = reason instanceof Error ? reason.message : String(reason);
      nextReportError = nextReportError ? `${nextReportError}；资产索引：${message}` : `资产索引读取失败：${message}`;
    }
  }
  // 读取期间换了工程路径：这批结果属于上一个工程，不能覆盖当前工程的卡片与报告。
  if (projectPath.value !== pathAtStart) return;
  report.value = nextReport;
  reportReadError.value = nextReportError;
  indexCards.value = nextCards;
  loadingReport.value = false;
}

function normalizeIndex(source: AssetIndex): AssetIndexCard[] {
  return Array.isArray(source.cards) ? source.cards : [];
}

/** cardId → 缩略图 URL；取不到的卡片不出现在表里，网格端显示「无预览」占位。 */
const referenceThumbnails = ref<Record<string, string>>({});
let thumbnailJob = 0;
/** 每个卡片持有的 blob URL 释放句柄，切卡片/卸载时统一 release，避免只增不减。 */
let thumbnailReleases = new Map<string, () => void>();

function releaseThumbnails() {
  thumbnailReleases.forEach(release => release());
  thumbnailReleases = new Map();
}

/** 这一批采集被新版本顶掉时，已拿到的 blob URL 也要释放，否则句柄只增不减。 */
function abandonThumbnails(releases: Map<string, () => void>) {
  releases.forEach(release => release());
  releases.clear();
}

/**
 * 经画布桥反查资产节点的已出图产物作缩略图。九宫格拆图会把真实图片节点 id 写进卡片；
 * 读数与 directDispatch.resolveReferenceSources 对齐，按「card.nodeId + cardId 的 label 前缀」
 * 并集去重找候选（图片节点 label 是「图片 · 行-列」，本来就不以 cardId 开头），任一命中即可。
 * 查询只读，逐卡 getCanvasNodes(outputs)，静默失败。
 * ACT: 产物 url 是工作区相对路径，必须经 acquireUrl 转成 blob 才能给 <img :src>（同 statusPanel 的预览通道）；
 * 直接塞相对路径会变成 /assets/... 打站点根，必然 404。
 */
async function resolveReferenceThumbnails() {
  const version = ++thumbnailJob;
  const bridge = readBridge();
  if (!bridge) return;
  const call = ((request, signal) => bridge.call?.(request, signal) ?? Promise.reject(new Error("画布桥不可用"))) as CanvasCall;
  const next: Record<string, string> = {};
  const releases = new Map<string, () => void>();
  for (const card of indexCards.value) {
    if (!card.id || card.textOnly === true) continue;
    try {
      const cardNodeIds = card.nodeId ? [card.nodeId] : [];
      const nodeIds = [...new Set([...cardNodeIds, ...(await findCardNodeIds(call, card.id, AbortSignal.timeout(5000)))])];
      for (const nodeId of nodeIds) {
        const detail = await readNodeDetail(call, nodeId, AbortSignal.timeout(5000));
        const path = detail ? imagePathOf(detail) : "";
        if (path) {
          const shared = acquireUrl(path, "image/png");
          releases.set(card.id, shared.release);
          const url = await shared.url;
          if (version !== thumbnailJob) {
            abandonThumbnails(releases);
            return;
          }
          next[card.id] = url;
          break;
        }
      }
    } catch {
      // 画布未打开或节点缺失都只影响这一个缩略图，不打断其余卡片。
    }
    if (version !== thumbnailJob) {
      abandonThumbnails(releases);
      return;
    }
  }
  if (version !== thumbnailJob) {
    abandonThumbnails(releases);
    return;
  }
  releaseThumbnails();
  thumbnailReleases = releases;
  referenceThumbnails.value = next;
}

watch(indexCards, () => {
  void resolveReferenceThumbnails();
}, { deep: true });

/**
 * in 端口连线来源（reactive）：与 node:getReferenceOrder（useNodeReferences.referenceOrderOf）
 * 同一份数据源、同一排序口径——按节点 data.referenceOrder.in
 * 的键序排，未显式排序时按入边顺序；复用这套而非再走桥查询，是为了网格随连线增删实时刷新。
 * ACT: referenceKey 编码与 useNodeReferences.referenceKeyOf 同形（JSON 键对 encodeURIComponent），
 * 该函数在对方模块私有，跨模块共享超出本任务范围，两处改动需同步。
 */
const connectedSources = computed(() => {
  if (!flow || !props.nodeId) return [];
  const target = flow.findNode(props.nodeId);
  const order = new Map(((target?.data as { referenceOrder?: Record<string, string[]> } | undefined)?.referenceOrder?.in ?? [])
    .map((key, index) => [key, index]));
  const rank = (nodeId: string, sourceHandle: string) => order.get(encodeURIComponent(JSON.stringify([nodeId, sourceHandle]))) ?? order.size;
  return flow.getEdges.value
    .filter(edge => edge.target === props.nodeId && (edge.targetHandle ?? "in") === "in")
    .map(edge => ({ nodeId: edge.source, sourceHandle: edge.sourceHandle ?? "", rank: rank(edge.source, edge.sourceHandle ?? "") }))
    .sort((left, right) => left.rank - right.rank)
    .map(source => ({ nodeId: source.nodeId, sourceHandle: source.sourceHandle }));
});

/** 连线上游节点 → 资产卡：先认 card.nodeId 精确回写，再按画布 label 前缀边界匹配（与 directDispatch 的匹配口径同源）。 */
function matchCardForNode(nodeId: string, label: string): AssetIndexCard | undefined {
  return indexCards.value.find(card => card.nodeId === nodeId)
    ?? indexCards.value.find(card => card.id && labelMatchesCard(label, card.id));
}

/**
 * 参考网格条目。**两套数据源是有意的**：
 * - 画布卡片宿主（nodeId + 取到 flow）：只列本节点 in 端口连进来的来源（要求 1/2——「画布全部素材」是用户报的 bug），
 *   顺序即连线位次；连进来但对不上资产卡的节点以「非资产卡」占位展示、不可勾选（referenceIds 的语义是 cardId，
 *   没有卡就无可写值，派工对账也会报「参考未就绪」）。
 * - 文档面板宿主（无 nodeId、没有画布连线语义）：保留 assetIndex.json 全量资产卡的现有行为——
 *   该形态打开时通常画布根本没挂，全量列表是它唯一的候选来源，改版前语义不变（要求 3）。
 */
const pickerItems = computed<ReferencePickerItem[]>(() => {
  if (!flow || !props.nodeId) {
    return indexCards.value
      .filter(card => card.id)
      .map(card => ({ key: card.id, cardId: card.id, name: card.name || card.id, textOnly: card.textOnly === true }));
  }
  const items: ReferencePickerItem[] = [];
  const usedCards = new Set<string>();
  for (const source of connectedSources.value) {
    const node = flow.findNode(source.nodeId);
    const label = typeof node?.data?.label === "string" ? node.data.label : "";
    const card = matchCardForNode(source.nodeId, label);
    if (card) {
      // 同一张卡被两条入边连进来时只列一次：重复入边不该拿占位条目充数（会显示成「非资产卡」）。
      if (usedCards.has(card.id)) continue;
      usedCards.add(card.id);
      items.push({ key: card.id, cardId: card.id, name: card.name || card.id, textOnly: card.textOnly === true });
      continue;
    }
    // 对不上卡：索引缺失或节点名不是卡号，占位展示来源节点本身（不可勾选）。
    items.push({ key: source.nodeId, cardId: "", name: label || source.nodeId });
  }
  // 断线旧引用（referenceIds 里有、连线却没有了）不进网格：参考图只从连线上打勾，
  // 先摆出用户没连过的卡是错的。这些 id 由 detachedReferenceIds 交给 picker 的提示条点名 + 一键清除。
  return items;
});

/**
 * 断线旧引用清单：连线上的可勾选卡之外、本镜 referenceIds 里剩的卡，供 picker 的清除指引提示条。
 * ACT: 只要有任一连线来源对不上资产卡（索引缺失、节点名不是卡号），缺口就可能是「连线还在、卡没认出来」，
 * 此时一律返回空、不给清除入口——宁可少提示，也不能把仍有连线的引用当断线删掉（清除不进撤销栈）。
 */
const detachedReferenceIds = computed(() => {
  if (!flow || !props.nodeId) return [];
  const connected = new Set<string>();
  for (const source of connectedSources.value) {
    const node = flow.findNode(source.nodeId);
    const label = typeof node?.data?.label === "string" ? node.data.label : "";
    const card = matchCardForNode(source.nodeId, label);
    if (!card) return [];
    connected.add(card.id);
  }
  return (selectedClip.value?.referenceIds ?? []).filter(id => !connected.has(id));
});

function acquireUrl(path: string, mimeType?: string) {
  return props.getFiles().acquireUrl(path, mimeType);
}

/**
 * 历史版本预览的产物路径：落盘名是 `video<uuid>.mp4`，不能按 nodeId 拼路径，
 * 只能经画布桥读该节点 outputs.video.value.url（与 resolveReferenceThumbnails 同一条只读路径）。
 */
async function acquireNodeVideo(nodeId: string) {
  const call = readBridge()?.call;
  if (!call) throw new Error("画布未打开，读不到历史版本产物");
  const detail = await readNodeDetail(call, nodeId, AbortSignal.timeout(5000));
  if (!detail) throw new Error("该版本节点已从画布删除");
  const video = detail.outputs?.video as { value?: { url?: string } } | undefined;
  const url = video?.value?.url || "";
  if (!url) throw new Error("该版本节点上没有视频产物");
  return url;
}

/**
 * 切换默认版本：版本键就是产物路径（服务端媒体任务通道不建画布节点），写回 clip.assetPath 即生效——
 * 合成成片按 accepted 镜的 assetPath 取文件。旧工程的 attempt 只有 nodeId 时经画布桥反查节点产物。
 * 不追加 attempts：切换不是一次生成尝试。
 */
async function setDefaultVersion(version: string) {
  // onPatch 按当前选中项写回：await 期间换了镜头就不能再落，否则会把 nodeId/assetPath 写到另一条镜上。
  const clip = selectedClip.value;
  if (!clip) return;
  const entry = clipVersions(clip).find(item => item.key === version);
  const nodeId = entry?.nodeId ?? null;
  let path = entry?.assetPath ?? "";
  if (!path && nodeId) {
    try {
      path = await acquireNodeVideo(nodeId);
    } catch (reason) {
      return ElMessage.error(reason instanceof Error ? reason.message : "读取画布节点失败");
    }
  }
  if (!path) return ElMessage.error("该版本没有视频产物");
  if (selectedClip.value?.clipId !== clip.clipId) return ElMessage.warning("选中的镜头已变化，请重新切换默认版本");
  // ACT: 当前默认如果只是一枚指针、没进 attempts（旧版路径或对账补写的成片会这样），切走之后它就从
  // 版本列表里消失了。切换前先补一条成功尝试，历史版本只增不减。旧版路径的成片只有节点编号、没有
  // 产物路径，也要补：clipVersions 会按 nodeId 兜底补出当前版本，漏记的话同一枚版本只会换一副面孔。
  const currentKey = clip.assetPath || clip.nodeId || "";
  if (currentKey && !clip.attempts.some(attempt => attempt.status === "succeeded" && (attempt.assetPath || attempt.nodeId || "") === currentKey)) {
    writeClipRun(clip.clipId, { assetPath: clip.assetPath }, {
      nodeId: clip.nodeId ?? "",
      status: "succeeded",
      jobId: clip.attempts.findLast(attempt => attempt.status === "succeeded" && attempt.jobId)?.jobId ?? "",
    });
  }
  onPatch({ nodeId, assetPath: path });
  ElMessage.success(`已切换默认版本：${path.split("/").pop() || version}`);
}

/** 返回是否真写盘成功：冲突/读写异常都落成 false，调用方（editProject 等）据此回报 saved。 */
async function runSave(): Promise<boolean> {
  if (!project.value) return false;
  saving.value = true;
  let failed = false;
  try {
    const current = await props.getFiles().readJson<MtrackProject>(projectPath.value);
    const diskUpdatedAt = current?.updatedAt ?? "";
    const memoryUpdatedAt = lastSaved.value?.updatedAt ?? "";
    if (diskUpdatedAt !== memoryUpdatedAt) {
      // ACT: 对方（会话 agent 的 planOperator 回写，或同一工程上的另一个多轨节点）改过盘时不再整轮拒写：
      // 先三方合并再落盘，否则生成结果只活在内存里，一切换默认版本/重新加载就丢。
      const disk = current ? normalizeProject(current) : null;
      if (!disk) {
        conflictError.value = "文件已被其他操作修改，请重新加载";
        failed = true;
        return false;
      }
      project.value = mergeProjects(lastSaved.value, disk, project.value);
      conflictError.value = "";
      // ACT: 合并结果与磁盘内容等价 = 这次「冲突」只是对面刚写完、我这边没有独有改动。
      // 此时不能再写盘：否则 updatedAt 又变一次，对面下一轮同样判定冲突，两个实例会无限乒乓写盘
      // （画布节点 + 文档面板同时打开同一工程时每 ~0.4s 一次，且每轮各弹一条合并提示）。
      // 只把基线对齐到磁盘，本轮到此为止。
      if (sameProjectContent(project.value, disk)) {
        project.value.updatedAt = disk.updatedAt;
        lastSaved.value = cloneProject(project.value);
        return true;
      }
      lastSaved.value = cloneProject(project.value);
      ElMessage.warning("工程已被其他操作修改，已合并保存：生成结果与历史版本保留，镜头内容以磁盘改动为准");
    }
    project.value.updatedAt = new Date().toISOString();
    // 先克隆快照再写盘：写盘 await 期间落进 project 的新改动不会进文件，靠收尾的 dirty 复查补排一轮保存。
    const snapshot = cloneProject(project.value);
    await props.getFiles().writeJson(projectPath.value, snapshot);
    lastSaved.value = snapshot;
    savedAt.value = new Date().toISOString();
  } catch (reason) {
    failed = true;
    loadError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    saving.value = false;
    if (!failed && dirty.value) dirtyVersion.value += 1;
  }
  return !failed;
}

let inFlight: Promise<boolean> | undefined;

/** 保存入口：并发调用复用同一个在途 Promise，宿主 flushSave 等到写盘结束才返回，不丢保存请求。 */
function saveProject(): Promise<boolean> {
  if (!inFlight) {
    const task = runSave();
    inFlight = task;
    void task.then(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

type CompositeSegment = { clipId: string };
type CompositeResult = { manifestPath: string; source: string; output: string; executed: boolean; segments: CompositeSegment[]; specWarnings: string[]; result?: unknown };

const compositeBusy = ref(false);
const hasAccepted = computed(() => clips.value.some(clip => clip.status === "accepted"));

/** 合成请求：服务端 strict 校验，只发这四个字段；错误响应体里的 message 是可直接展示的原文。 */
async function postComposite(execute: boolean): Promise<CompositeResult> {
  const response = await fetch("/api/mtrack/composite", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ directory: props.directory, sourcePath: projectPath.value, execute }),
  });
  const payload = await response.json().catch(() => undefined) as { data?: CompositeResult; message?: string } | undefined;
  if (!response.ok || !payload?.data) throw new Error(payload?.message || `合成请求失败（HTTP ${response.status}）`);
  return payload.data;
}

/** 二次确认文案：段数与输出位置，再点名本次不会进成片的镜头，让「尾部未验收就静默少段」变得可核实。 */
function compositeConfirmText(preview: CompositeResult) {
  const included = new Set(preview.segments.map(segment => segment.clipId));
  const excluded = clips.value.filter(clip => !included.has(clip.clipId)).map(clip => clip.clipId);
  const parts = [`将合成 ${preview.segments.length} 段，输出到 ${preview.output}`];
  if (excluded.length > 0) {
    // ACT: 只列前 8 个 id，几十镜未验收时确认框不至于被塞满。
    const shown = excluded.slice(0, 8).join("、");
    const rest = excluded.length > 8 ? ` 等 ${excluded.length} 镜` : "";
    parts.push(`工程共 ${clips.value.length} 镜，未验收/未生成的 ${shown}${rest} 不会出现在成片里（成片只含已验收镜头，顺序按工程）`);
  }
  return parts.join("；");
}

/**
 * 合成成片：先把内存工程落盘，再 execute=false 拿段数出清单做二次确认，最后 execute=true 真拼。
 * 失败文案一律用服务端原文（含 ffmpeg、规格不一致、V14 顺序断点等定位信息），只在「输出已存在」「assetPath 为空」上补处置建议。
 * 「完成后自动合并」勾选后，批次成功收尾时走的也是这同一条两步流程（契约 §3.2，不另造合并状态）。
 */
async function handleComposite() {
  if (compositeBusy.value) return;
  if (!props.directory) return ElMessage.warning("当前没有工作目录，无法合成");
  compositeBusy.value = true;
  try {
    // ACT: 合成读的是磁盘上的 story.mtrack，而验收/改镜走 800ms 防抖写盘（见 dirtyVersion 监听）：
    // 不先 flush，「刚点验收就合成」会按旧盘报「没有 accepted 片段」或按旧段数弹确认。没有未存改动就不写盘。
    if (dirty.value && !(await saveProject())) return ElMessage.error("工程未保存成功，合成已取消");
    const preview = await postComposite(false);
    await ElMessageBox.confirm(compositeConfirmText(preview), "合成成片", {
      confirmButtonText: "开始合成",
      cancelButtonText: "取消",
      type: "warning",
    });
    const done = await postComposite(true);
    ElMessage.success(`已合成 ${done.segments.length} 段：${done.output}`);
    emit("compositeDone", done.output);
  } catch (reason) {
    // ElMessageBox 的取消/关闭不是失败，不弹错误提示。
    if (reason === "cancel" || reason === "close") return;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes("已存在")) ElMessage.warning(`${message}——请先删除成片或改用其他输出路径`);
    else if (message.includes("assetPath 为空")) ElMessage.error(`${message}——已验收镜头没有产物路径时，用「项目与成片」浮窗里该镜头的「设为默认」把画布节点上的产物回填后重试`);
    else ElMessage.error(message);
  } finally {
    compositeBusy.value = false;
  }
}

type TextModelOption = { providerId: string; modelId: string; label: string };

/** 文本模型清单来自设置里的供应商；取不到就留空，选择器降级为不可用并给出提示。 */
const textModels = ref<TextModelOption[]>([]);
let textModelsLoaded = false;
const rewriteBusy = ref(false);

/** 待采用的整理稿：clipId 定位到具体镜头，basis 是发请求那一刻的原文画面描述、时长与整理规则。 */
type RewriteBasis = { text: string; seconds: number; rules: string };
type PendingRewrite = { clipId: string; text: string; basis: RewriteBasis };
const rewritePending = ref<PendingRewrite | null>(null);
/** 待采用区块只跟随当前选中的镜头：切走再切回来仍是同一份整理稿，采用对象永远是发起整理的那一镜。 */
const pendingRewrite = computed(() => {
  const pending = rewritePending.value;
  return pending && pending.clipId === selectedId.value ? pending : undefined;
});

async function loadTextModels(force = false) {
  if (textModelsLoaded && !force) return;
  try {
    const response = await fetch("/api/ai/models");
    const payload = await response.json().catch(() => undefined) as { data?: { providerId: string; modelId: string; label: string }[] } | undefined;
    textModels.value = (payload?.data ?? []).map(item => ({ providerId: item.providerId, modelId: item.modelId, label: item.label || item.modelId }));
    textModelsLoaded = true;
  } catch {
    // 读不到模型清单：保持空数组，按钮仍可用时在请求里由服务端报具体错误。
  }
}

/** 取第一个可用的文本模型：与派工时 resolveAgentModel 的回退顺序一致（第一个有模型的供应商）。 */
function firstTextModel(): TextModelOption | undefined {
  return textModels.value[0];
}

/**
 * 整理请求：POST /api/mtrack/rewriteShot 的公共请求体，UI 与命令式 rewritePrompt 共用。
 * 失败原样抛出服务端文案（生成中的 409、模型未配置、模型报错），不包装成通用失败提示。
 */
async function requestRewrite(clip: MtrackClip, rules: string): Promise<{ text: string; requiresReview: boolean }> {
  const model = firstTextModel();
  if (!model) throw new Error("尚未配置可用的文本模型，请先在设置中启用模型供应商");
  const trimmedRules = rules.trim();
  const response = await fetch("/api/mtrack/rewriteShot", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({
      directory: props.directory,
      providerId: model.providerId,
      modelId: model.modelId,
      prompt: { ...clip.prompt },
      referenceIds: clip.referenceIds,
      ...(trimmedRules ? { rules: trimmedRules } : {}),
    }),
  });
  const payload = await response.json().catch(() => undefined) as { data?: { text: string; requiresReview?: boolean }; message?: string } | undefined;
  if (!response.ok || !payload?.data) throw new Error(payload?.message || `整理请求失败（HTTP ${response.status}）`);
  const text = payload.data.text.trim();
  if (!text) throw new Error("模型没有返回整理结果，请重试");
  return { text, requiresReview: payload.data.requiresReview !== false };
}

/**
 * 整理本镜提示词：结果只进「待采用」区块，绝不自动覆盖画面描述。
 * 环境声与配乐原样保留（服务端只整理画面描述段，不改这两段）。
 * rules 留空时不传该字段，由服务端回落到内置规则；传了就把本次整理规则一并记进 basis 供一致性守卫比对。
 */
async function rewriteClipPrompt(rules: string) {
  const clip = selectedClip.value;
  if (!clip) return;
  if (!props.directory) return ElMessage.warning("当前没有工作目录，无法整理提示词");
  if (rewriteBusy.value) return;
  if (!firstTextModel()) {
    await loadTextModels(true);
    if (!firstTextModel()) return ElMessage.warning("尚未配置可用的文本模型，请先在设置中启用模型供应商");
  }
  // 请求发出这一刻的快照：正文、原文画面描述、时长与规则一起定格，之后用户再改就由一致性守卫拦下旧稿。
  const prompt = { ...clip.prompt };
  const trimmedRules = rules.trim();
  const basis: RewriteBasis = { text: prompt.integratedMultimodalDescription, seconds: clip.seconds, rules: trimmedRules };
  rewriteBusy.value = true;
  try {
    const { text } = await requestRewrite(clip, rules);
    rewritePending.value = { clipId: clip.clipId, text, basis };
    ElMessage.success("已整理，请核对后采用");
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : "整理提示词失败");
  } finally {
    rewriteBusy.value = false;
  }
}

/**
 * 命令式整理：与 UI 共用同一条请求，但只返回整理稿，不写待采用区块、不改工程，采用与否交给调用方。
 * clipId 缺省取当前选中镜；错误原样抛出（含服务端「正在生成」的 409 与模型未配置文案）。
 */
async function rewritePrompt(args: { clipId?: string; rules?: string }): Promise<{ text: string; requiresReview: boolean }> {
  if (!props.directory) throw new Error("当前没有工作目录，无法整理提示词");
  const clip = args.clipId ? clips.value.find(item => item.clipId === args.clipId) : selectedClip.value;
  if (!clip) throw new Error(args.clipId ? `未找到分镜 ${args.clipId}` : "当前没有选中的分镜，请先选中一镜或传入 clipId");
  if (!firstTextModel()) await loadTextModels(true);
  return requestRewrite(clip, args.rules ?? "");
}

/** 采用整理结果：只写回发起整理的那一镜（不看当前选中），写完清掉待采用稿。 */
function adoptRewrite(text: string) {
  const pending = rewritePending.value;
  if (!pending) return;
  const value = text.trim();
  if (!value) return ElMessage.warning("整理结果为空，无法采用");
  const index = clips.value.findIndex(clip => clip.clipId === pending.clipId);
  rewritePending.value = null;
  if (index < 0) return ElMessage.warning("这一镜已不存在，整理结果已丢弃");
  const clip = clips.value[index];
  // ACT: 整理稿只覆盖画面正文段，环境声与配乐原样保留（展开 ...clip.prompt 再盖一个字段）。
  // 单框编辑时三段同框，若这里整组覆盖，采用一次就会把用户写好的两个声音段抹掉。
  clips.value[index] = { ...clip, prompt: { ...clip.prompt, integratedMultimodalDescription: value } };
  ElMessage.success("已采用整理结果");
}

/** 放弃整理结果：只清空待采用区块，原文一字不动。 */
function discardRewrite() {
  rewritePending.value = null;
}

/** 待采用稿可编辑：改的是整理稿本身，不参与一致性守卫（守卫只比原文、时长与规则）。 */
function updateRewriteDraft(text: string) {
  if (!rewritePending.value) return;
  rewritePending.value = { ...rewritePending.value, text };
}

/**
 * 参考位次变了（取消勾选或改序）就把正文里的 `{{ref N}}` 按新位次重排；
 * 被取消的那张图对应的引用整段移除并清理残留标点，避免派工时编号指到别的素材
 * （与 LSC remapPromptReferences 同义）。越界编号原样保留，交给派工前的校验提示。
 */
function remapPromptReferences(prompt: MtrackClip["prompt"], previous: string[], next: string[]) {
  const rewrite = (text: string) => (text ? text
    .replace(/\{\{\s*ref\s*(\d+)\s*\}\}/gi, (mention, n: string) => {
      const cardId = previous[Number(n) - 1];
      if (!cardId) return mention;
      const index = next.indexOf(cardId);
      return index === -1 ? "" : `{{ref ${index + 1}}}`;
    })
    .replace(/[ 	]{2,}/g, " ")
    .replace(/[ 	]+([，。；、！？）】])/g, "$1")
    .replace(/([（【])[ 	]+/g, "$1")
    .replace(/[ 	]+$/gm, "") : text);
  prompt.integratedMultimodalDescription = rewrite(prompt.integratedMultimodalDescription);
  prompt.overallSoundscape = rewrite(prompt.overallSoundscape);
  prompt.nonDiegeticMusic = rewrite(prompt.nonDiegeticMusic);
}

function onPatch(patch: Partial<MtrackClip>) {
  const index = selectedIndex.value;
  if (index < 0) return;
  const current = clips.value[index];
  const prompt = { ...current.prompt, ...(patch.prompt ?? {}) };
  if (patch.referenceIds && patch.referenceIds.join("|") !== current.referenceIds.join("|")) {
    remapPromptReferences(prompt, current.referenceIds, patch.referenceIds);
  }
  clips.value[index] = { ...current, ...patch, prompt };
  selectedId.value = clips.value[index].clipId;
}

function duplicateClip() {
  const index = selectedIndex.value;
  if (index < 0) return;
  const copy = cloneClips([clips.value[index]])[0];
  copy.clipId = nextClipId(clips.value);
  copy.status = "pending";
  copy.nodeId = null;
  copy.assetPath = null;
  copy.attempts = [];
  project.value?.clips.splice(index + 1, 0, copy);
  selectedId.value = copy.clipId;
}

function moveClip(offset: number) {
  const index = selectedIndex.value;
  const target = index + offset;
  if (!project.value || index < 0 || target < 0 || target >= clips.value.length) return;
  const list = project.value.clips;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  selectedId.value = item.clipId;
  // 与改序同口径的收口：被挪到首位的镜头没有可承接的前镜，衔接归一为 shot；
  // 反向同理——首镜被挪走时新首镜也可能是承接态（同 normalizeProject 的首镜约束）。
  normalizeContinuityOrder(project.value.clips);
}

function removeClip() {
  const index = selectedIndex.value;
  if (!project.value || index < 0) return;
  const snapshot = cloneClips(clips.value);
  undoStack.value = [snapshot];
  project.value.clips.splice(index, 1);
  // ACT: 删掉首镜后新首镜没有可承接的前镜，衔接归一为 shot（与 normalizeProject / moveClip 同口径，
  // 否则编辑后的工程落盘就是「首镜承接」的非法态）。
  normalizeContinuityOrder(project.value.clips);
  // 删掉的正是待采用稿所属镜头：清空，避免撤销后编号被新镜头复用、旧稿套到新镜头的内容上。
  if (rewritePending.value?.clipId === snapshot[index].clipId) rewritePending.value = null;
  multiSelectedIds.value = multiSelectedIds.value.filter(id => id !== snapshot[index].clipId);
  selectedId.value = clips.value[Math.min(index, clips.value.length - 1)]?.clipId ?? "";
}

function acceptClip(accepted: boolean) {
  const clip = selectedClip.value;
  if (!clip) return;
  if (accepted && clip.status !== "generated") return;
  if (!accepted && clip.status !== "accepted") return;
  onPatch({ status: accepted ? "accepted" : "generated" });
}

/** 浮窗「用于合并」勾选：按 clipId 直接改 status（generated ⇄ accepted），不依赖工作台当前选中。 */
function toggleClipAccept(clipId: string) {
  const index = clips.value.findIndex(clip => clip.clipId === clipId);
  if (index < 0) return;
  const clip = clips.value[index];
  if (clip.status === "generated") clips.value[index] = { ...clip, status: "accepted" };
  else if (clip.status === "accepted") clips.value[index] = { ...clip, status: "generated" };
}

/** 一键验收：把全部「已生成且有成片」的镜头整批翻成 accepted，与浮窗勾选同一条写盘链；生成中与无成片跳过。 */
async function acceptAllGenerated() {
  const targets = clips.value.filter(clip => clip.status === "generated" && clip.assetPath);
  if (!targets.length) {
    ElMessage.warning("没有可验收的镜头：只验收已生成且有成片的镜头");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `把 ${targets.length} 个已生成且有成片的镜头整批验收（accepted）？验收后即可用于合并；画面质量不再逐条确认。`,
      "一键验收",
      { confirmButtonText: "全部验收", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }
  // ACT: 确认框打开期间派工可能写回 clips——按 clipId 重新定位并复查条件，避免把状态翻到已被替换的对象上。
  let done = 0;
  for (const target of targets) {
    const index = clips.value.findIndex(clip => clip.clipId === target.clipId);
    if (index < 0) continue;
    const clip = clips.value[index];
    if (clip.status !== "generated" || !clip.assetPath) continue;
    clips.value[index] = { ...clip, status: "accepted" };
    done += 1;
  }
  ElMessage.success(done ? `已验收 ${done} 个镜头` : "镜头状态已变化，本次没有验收任何镜头");
}

/** 删版本文件：宿主不提供删除能力时只清记录、不报文件失败；缺失文件不算失败。 */
async function deleteVersionFiles(paths: string[]): Promise<number> {
  const remove = props.getFiles().remove;
  if (!remove) return paths.length;
  let failed = 0;
  for (const path of paths) {
    try {
      await remove(path);
    } catch (reason) {
      if (!/404|not found|ENOENT|不存在/i.test(reason instanceof Error ? reason.message : String(reason))) failed += 1;
    }
  }
  return failed;
}

/** 删单个历史版本：记录与文件一起清掉，当前默认回落到剩余版本里最新的一条（对齐 LSC：单版本无确认）。 */
async function deleteVersionInClip(clipId: string, version: string) {
  const index = clips.value.findIndex(clip => clip.clipId === clipId);
  if (index < 0) return;
  const clip = clips.value[index];
  if (clip.status === "generating") return ElMessage.warning("该镜头正在生成，请等生成结束再删除版本");
  const removed = deleteClipVersion(clip, version);
  const failed = await deleteVersionFiles(removed.paths);
  if (clips.value[index]?.clipId !== clip.clipId) return;
  clips.value[index] = removed.clip;
  dirtyVersion.value += 1;
  const name = version.split("/").pop() || version;
  ElMessage.success(failed
    ? `已删除版本 ${name}，有 ${failed} 个文件删除失败`
    : `已删除版本 ${name}${removed.clip.assetPath ? "，默认已回落到剩余版本" : "，该镜头已无成片"}`);
}

/** 删整镜全部版本：整镜是不可撤销动作，走确认弹窗；脚本与其他镜头不受影响。 */
async function deleteAllVersionsInClip(clipId: string) {
  const index = clips.value.findIndex(clip => clip.clipId === clipId);
  if (index < 0) return;
  const clip = clips.value[index];
  if (clip.status === "generating") return ElMessage.warning("该镜头正在生成，请等生成结束再删除版本");
  const total = clipVersions(clip).length;
  if (!total) return;
  try {
    await ElMessageBox.confirm(
      `将永久删除 ${total} 个视频版本，不可撤销。镜头脚本与其他镜头保留；依赖被删版本的续接镜头需要重新生成。`,
      `永久删除「${clip.title || clip.clipId}」的全部版本？`,
      { type: "warning", confirmButtonText: "永久删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  const removed = deleteAllClipVersions(clip);
  const failed = await deleteVersionFiles(removed.paths);
  if (clips.value[index]?.clipId !== clip.clipId) return;
  clips.value[index] = removed.clip;
  dirtyVersion.value += 1;
  ElMessage.success(failed ? `已删除 ${total} 个版本，有 ${failed} 个文件删除失败` : `已删除 ${total} 个视频版本`);
}

/** 浮窗「设为默认」：先把选中镜切到目标镜，再走既有 setDefaultVersion（await 后的选中复查正好因此成立）。 */
async function setClipDefaultVersion(clipId: string, version: string) {
  if (selectedId.value !== clipId) selectedId.value = clipId;
  await setDefaultVersion(version);
}

/** 浮窗大预览换镜 → 工作台选中同一镜（与 selectedClipId → 浮窗的 watch 构成双向联动，同值写入不成环）。 */
function selectClipFromOverlay(clipId: string) {
  if (clips.value.some(clip => clip.clipId === clipId)) selectedId.value = clipId;
}

/** 「镜头编辑」：视口移回本节点并缩到可读档，工作台随之回到用户眼前（浮窗按钮触发）。 */
function focusEditorNode() {
  const node = props.nodeId ? flow?.findNode(props.nodeId) : undefined;
  if (!node || !flow) return;
  const width = node.dimensions?.width || 640;
  const height = node.dimensions?.height || 700;
  void flow.setCenter(node.computedPosition.x + width / 2, node.computedPosition.y + height / 2, { zoom: 0.9, duration: 240 });
}

/** 高级设置「查看成片」：视口移到浮窗中心（几何来自最新 resultsGeometry，含宿主回写值）。
 *  浮窗收起时只剩 70px 标题条，先让它展开再居中，否则用户跳过去看到的是一条边。 */
function focusResults() {
  if (!flow) return;
  resultsOverlayRef.value?.expand();
  const ui = resultsGeometry.value;
  void flow.setCenter(ui.x + ui.width / 2, ui.y + ui.height / 2, { zoom: 0.6, duration: 240 });
}

/** 浮窗「校验发现」的「定位」：选中该 finding.ref 命中的镜头，工作台与浮窗大预览一起跟过去。 */
function locateFinding(clipId: string) {
  if (clips.value.some(clip => clip.clipId === clipId)) selectedId.value = clipId;
}

function undoRemove() {
  const snapshot = undoStack.value.pop();
  if (!project.value || !snapshot) return;
  project.value.clips = snapshot;
  selectedId.value = snapshot[Math.min(snapshot.length - 1, selectedIndex.value >= 0 ? selectedIndex.value : snapshot.length - 1)]?.clipId ?? "";
}

/**
 * 画布上下文来源（按优先级）：
 * 1. 宿主 `provide("agentCanvas")`——专为文档面板内的多轨派工准备，不要求画布面板 active；
 * 2. 宿主 `provide("canvas")`——对话输入框用的工厂，画布面板 active 时才返回值。
 * 两条都拿不到时提示，不另起绕过画布的生成路径。
 */
const readAgentCanvas = inject<(() => unknown) | undefined>("agentCanvas", undefined);
const readCanvasContext = inject<(() => unknown) | undefined>("canvas", undefined);

function readBridge(): ReturnType<typeof resolveCanvasBridge> {
  return resolveCanvasBridge(readAgentCanvas) ?? resolveCanvasBridge(readCanvasContext);
}

/** 画布实例可能仍在加载，短轮询最多约 2 秒等它就绪。 */
async function acquireBridge(): Promise<ReturnType<typeof resolveCanvasBridge>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bridge = readBridge();
    if (bridge) return bridge;
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return undefined;
}

const includeFinished = ref(false);
const dispatching = ref(false);
const activeBatchId = ref("");
/** 逐镜面板可见性由编辑器持有：关面板不中断生成，重开还能看到同一批。 */
const batchPanelVisible = ref(false);
/** 暂停是「本镜结束后停」的软闸门，与整批取消（abort）分开记账。 */
const batchPaused = ref(false);
let dispatchController: AbortController | undefined;
/** 当前在跑的直连派工句柄：暂停闸门与取消抢占都要用它，批次自然收尾时清空。 */
const batchHandle = shallowRef<{ abort(): void; pause(): void; run?: Promise<void> }>();
/** 在跑批次的服务端任务号：取消时对它们发 tasks/cancel，不依赖画布节点。 */
const activeTaskIds = ref<string[]>([]);
// 本地在途循环的种类：生成或取消。取消当前活动批次时据此判断可否抢占生成循环。
let dispatchKind: "generate" | "cancel" | "" = "";

const selectedIds = computed(() => {
  const ids = multiSelectedIds.value.length ? multiSelectedIds.value : selectedId.value ? [selectedId.value] : [];
  return clips.value.filter(clip => ids.includes(clip.clipId)).map(clip => clip.clipId);
});
const selectedClips = computed(() => clips.value.filter(clip => selectedIds.value.includes(clip.clipId)));
/**
 * 当前批次的镜头清单：面板逐镜进度、暂停后的待续清单、状态快照都从这里取。
 * 台账用批内序号而非 attempts 标记——暂停发生在某镜开始前时它还没有任何尝试记录，只按 attempts 过滤会漏镜。
 */
const batchClipIds = ref<string[]>([]);
/** 批次是否在跑：dispatching 只覆盖「取画布桥 + 建节点」的启动相位，生成循环在 run 上后台推进。 */
const batchRunning = computed(() => Boolean(batchHandle.value));

/** footer 状态行的批次消息：与逐镜面板 progressText 同源（batchClipIds + clips 状态推导），footer 再按优先级包装。 */
const batchMessage = computed(() => {
  if (!activeBatchId.value || !batchClipIds.value.length) return "";
  const total = batchClipIds.value.length;
  const batchClips = batchClipIds.value.map(clipId => clips.value.find(clip => clip.clipId === clipId)).filter(Boolean) as MtrackClip[];
  const done = batchClips.filter(clip => clip.status === "generated" || clip.status === "accepted").length;
  if (batchPaused.value) return `已在镜头间暂停，已完成 ${done}/${total} 镜；点「继续 / 重试」接着跑。`;
  if (batchRunning.value) {
    const at = batchClips.findIndex(clip => clip.status === "generating");
    return at >= 0 ? `正在生成第 ${at + 1}/${total} 镜 · 已完成 ${done} 镜` : `正在生成 · 已完成 ${done}/${total} 镜`;
  }
  const failed = batchClips.filter(clip => clip.status === "failed").length;
  return `本批已结束：成功 ${done} 镜${failed ? `，失败 ${failed} 镜` : ""}，共 ${total} 镜。`;
});

/** footer 错误行：文件读取错误与最近一次生成链路失败合并展示（LSC v.error 位）。 */
const footerError = computed(() => loadError.value || runError.value);

/**
 * 派工选段校验：clipIds 缺省用 UI 选段；文案与三条本地校验逐字沿用原 generateSelection。
 * issue 非空即校验失败，调用方决定是提示（UI warning）还是抛出（命令式 API）。
 */
function pickDispatchTargets(clipIds?: string[], finishedOverride?: boolean): { clips: MtrackClip[]; skipped: number; issue: string } {
  const wanted = clipIds && clipIds.length
    ? clips.value.filter(clip => clipIds.includes(clip.clipId))
    : selectedClips.value;
  if (!wanted.length) return { clips: [], skipped: 0, issue: "请先选择要生成的分镜" };
  const withFinished = finishedOverride ?? includeFinished.value;
  // ACT: generating 的镜永远不进目标——否则勾「包含已生成」会把在跑的镜再派一次（双份计费，审计 P1-1）。
  const targets = wanted.filter(clip => clip.status !== "generating" && (withFinished || clip.status === "pending" || clip.status === "failed"));
  if (!targets.length) return { clips: [], skipped: wanted.length, issue: "选段内没有可生成的分镜，可勾选「包含已生成」后再试" };
  if (!props.directory) return { clips: [], skipped: 0, issue: "当前没有工作目录，无法发起生成" };
  return { clips: targets, skipped: wanted.length - targets.length, issue: "" };
}

/** 派工/取消收尾：只有仍是本操作的控制器才复位，避免迟到的 finally 踩掉后发起的操作。 */
function finishDispatchRun(controller: AbortController) {
  if (dispatchController !== controller) return;
  dispatching.value = false;
  dispatchController = undefined;
  dispatchKind = "";
}

/**
 * 把一次生成尝试写回镜头：状态、节点号、产物路径和 attempts 记录一起落盘，
 * 使「生成中」在界面、状态快照和 agent 的 mtrackRead 里都可见。
 */
function writeClipRun(clipId: string, patch: Partial<MtrackClip>, attempt?: { nodeId: string; status: string; error?: string; jobId?: string }) {
  const current = project.value;
  const clip = current?.clips.find(item => item.clipId === clipId);
  if (!current || !clip) return;
  Object.assign(clip, patch);
  if (attempt) {
    // 成功尝试把产物路径一起记下：历史版本的身份就是它（服务端通道不建画布节点，nodeId 恒为空）。
    const succeededPath = attempt.status === "succeeded" ? patch.assetPath : undefined;
    // 成功尝试同时记下设置签名与时间线位置：clipStates 靠这两个值判定这条成片是否已落后于当前设置。
    const clipIndex = current.clips.findIndex(item => item.clipId === clipId);
    const parentJobId = continuationJobId(clipIndex > 0 ? current.clips[clipIndex - 1] : undefined);
    clip.attempts.push({
      at: new Date().toISOString(),
      nodeId: attempt.nodeId || null,
      status: attempt.status,
      ...(attempt.error ? { error: attempt.error } : {}),
      // ACT: jobId 必须随成功尝试一起落盘——下一镜要「承接本镜」时全靠它做 continue_from.from_job。
      ...(attempt.jobId ? { jobId: attempt.jobId } : {}),
      ...(succeededPath ? { assetPath: succeededPath } : {}),
      ...(attempt.status === "succeeded"
        ? { signature: clipStates(current)[clipId]?.signature ?? "", index: clipIndex, parentJobId }
        : {}),
    });
  }
  // 生成期间 dirty 往往已经是 true，watch(dirty) 不会再触发；直接推进版本号让防抖写盘照常排上。
  dirtyVersion.value += 1;
}

/**
 * 本镜的系统提示词覆盖位（高级设置 · 公共约束）：clip.systemPromptOverride 有值时替换全片 systemPrompt 下发，
 * 留空沿用全片。notes 一律不参与下发（纯备注字段）。
 * schema 与 composeClipRequest 签名都不动，只在调用方换算有效 global。
 */
function effectiveGlobal(clip: MtrackClip): MtrackProject["global"] | undefined {
  const global = project.value?.global;
  const override = clip.systemPromptOverride?.trim();
  if (!global || !override) return global;
  return { ...global, systemPrompt: override };
}

/**
 * 发起直连派工（不等流）：本地校验或画布未就绪时抛错、不返回 batchId。
 * 拿到画布桥后**逐镜组装一份请求**交给服务端媒体通道（`/api/ai/media/generate` + taskId 异步任务），
 * 不再为每镜新建画布视频生成节点——对齐 LSC 的「时间线 = 请求体」模型：
 * 参数、参考素材与提示词在这一步一次性提交，画布只提供参考素材路径。
 * batchId 传入时沿用该批次（暂停后继续）：attempts 标记与面板行都靠它对齐。
 */
async function launchDispatch(clipIds?: string[], options?: { includeFinished?: boolean; batchId?: string; origin?: "ui" | "agent"; kind?: "clip" | "batch" }): Promise<{ batchId: string; skipped: number }> {
  if (dispatching.value || batchHandle.value) throw new Error("已有派工操作正在进行，请等待结束");
  const picked = pickDispatchTargets(clipIds, options?.includeFinished);
  if (picked.issue) throw new Error(picked.issue);
  const videoModel = project.value?.global.model;
  if (!videoModel?.providerId || !videoModel.modelId) throw new Error("工程没有指定视频模型，请在快捷设置里选择后再发起生成");
  if (!props.directory) throw new Error("当前没有工作目录，无法发起生成");
  runError.value = "";
  dispatching.value = true;
  const controller = new AbortController();
  dispatchController = controller;
  dispatchKind = "generate";
  const batchId = options?.batchId || crypto.randomUUID();
  const marker = batchMarker(batchId);
  const batchClips = picked.clips;
  let pausedByGate = false;
  batchClipIds.value = batchClips.map(clip => clip.clipId);
  activeBatchId.value = batchId;
  try {
    const bridge = await acquireBridge();
    if (!bridge?.call) throw new Error("未取到画布上下文：请先打开画布并等待加载完成，再回到多轨界面发起生成");
    const call = bridge.call;
    const directory = props.directory;
    const gate = { paused: false };
    const run = (async () => {
      for (const clip of batchClips) {
        controller.signal.throwIfAborted();
        if (gate.paused) { pausedByGate = true; return; }
        const taskId = crypto.randomUUID();
        try {
          const request = await composeClipRequest({
            call,
            clip,
            cards: indexCards.value,
            videoModel: { providerId: videoModel.providerId!, modelId: videoModel.modelId! },
            global: effectiveGlobal(clip),
            signal: controller.signal,
            // 续接对齐 LSC 多轨编辑器：按分镜顺序取**上一镜**，用它的供应商任务号走 continue_from，
            // 由引擎加载原生上下文继续生成；本镜的多参考图照常下发（上限 3 张）。
            previousClip: (() => {
              const index = clips.value.findIndex(item => item.clipId === clip.clipId);
              return index > 0 ? clips.value[index - 1] : undefined;
            })(),
            // 任务号只存在于「成功」的那次尝试里；拿不到就让 composeClipRequest 报错，不静默降级。
            resolveContinueFrom: previous => ({
              jobId: previous.attempts.findLast(attempt => attempt.status === "succeeded" && attempt.jobId)?.jobId ?? "",
            }),
          });
          writeClipRun(clip.clipId, { status: "generating", nodeId: null }, { nodeId: "", status: "generating", error: `${marker} task:${taskId}` });
          // ACT: 先登记再提交——提交途中点取消才能取消到这个任务，否则服务端会白跑到超时（审计 P2-2）。
          activeTaskIds.value = [...activeTaskIds.value, taskId];
          try {
            await submitClipTask(directory, request, taskId, controller.signal);
          } catch (error) {
            activeTaskIds.value = activeTaskIds.value.filter(id => id !== taskId);
            throw error;
          }
          const result = await waitClipTask(directory, taskId, controller.signal);
          activeTaskIds.value = activeTaskIds.value.filter(id => id !== taskId);
          if (result.state === "succeeded") {
            const file = result.files[0];
            if (!file?.path) throw new Error("服务端报告生成成功但没有返回文件路径");
            // jobId 一定要存进 attempts：它是下一镜「承接本镜」时 continue_from.from_job 的唯一来源。
            writeClipRun(clip.clipId, { status: "generated", nodeId: null, assetPath: file.path },
              { nodeId: "", status: "succeeded", error: `${marker} task:${taskId}`, ...(file.jobId ? { jobId: file.jobId } : {}) });
          } else if (result.state === "cancelled" || result.state === "lost") {
            // ACT: 任务在服务端已不存在（重启/过期）时也退回 pending，不能落 failed——用户没做错任何事（审计 P2-1）。
            writeClipRun(clip.clipId, { status: "pending" }, { nodeId: "", status: "cancelled", error: `${marker} task:${taskId}${result.state === "lost" ? " 任务已丢失，已退回待生成" : ""}` });
          } else {
            writeClipRun(clip.clipId, { status: "failed" }, { nodeId: "", status: "failed", error: `${marker} ${result.error}` });
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          writeClipRun(clip.clipId, { status: "failed" }, { nodeId: "", status: "failed", error: `${marker} ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    })();
    const handle = { abort: () => controller.abort(), pause: () => { gate.paused = true; }, run };
    batchHandle.value = handle;
    batchPaused.value = false;
    run.catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "生成失败";
        runError.value = message;
        ElMessage.error(message);
      }
      if (activeBatchId.value === batchId) activeBatchId.value = "";
    }).finally(() => {
      if (batchHandle.value === handle) batchHandle.value = undefined;
      if (!pausedByGate && activeBatchId.value === batchId) batchClipIds.value = [];
      batchPaused.value = pausedByGate;
      finishDispatchRun(controller);
      // 「完成后自动合并」：批次全部镜头成功收尾（非暂停、非中止）、勾了自动合并且有已验收镜头时，
      // 走与「合成成片」按钮完全相同的两步流程（清单确认 + 真拼），不另造第二套合并逻辑。
      const allDone = batchClips.every(clip => {
        const live = clips.value.find(item => item.clipId === clip.clipId);
        return Boolean(live && (live.status === "generated" || live.status === "accepted"));
      });
      if (!pausedByGate && !controller.signal.aborted && allDone && autoMerge.value && hasAccepted.value) void handleComposite();
      // ACT: 批次结束主动通知会话 agent——派工跑在页面里，结束时服务端不产生任何事件，agent 只能盲轮询 node:getStatus。
      // 通知只能由 Web 端发起：服务端自起轮次拿不到客户端注入的 canvas.tools，发不出 node:* / planOperator 工具。
      // 上限：仅在 agent 面板已打开会话时送达（面板未初始化时不打扰，用户可在下次对话里读到工程内的 attempts 记录）；
      // 取消或暂停结束的批次不通知，避免把「用户叫停」说成「生成完成」。
      // ACT: kind 区分「整批派工」与「单镜重试/重新生成本镜」——后者也生成新 batchId 并各自通知，
      // 消费方要按 kind 决定文案，不能只看 total（整批只有一镜时 total 同样是 1）。
      if (!controller.signal.aborted && !pausedByGate) {
        const settled = batchClips.reduce((acc, clip) => {
          const live = clips.value.find(item => item.clipId === clip.clipId);
          const status = live?.status ?? "pending";
          if (status === "generated" || status === "accepted") acc.done += 1;
          else if (status === "failed") acc.failed += 1;
          else acc.pending += 1;
          return acc;
        }, { done: 0, failed: 0, pending: 0 });
        // ACT: 消费端文案优先用节点 label（同工作区多个多轨节点时 projectPath 相同、nodeId 不可读，
        // 只有 label 能把「哪个节点跑完了」说清）；独立编辑器宿主没有 flow/nodeId，取不到就不带该键，
        // 消费端回落 projectPath/nodeId。kind 恒为 batch|clip（launchDispatch 入参决定，单镜重试/重新生成本镜发 clip）。
        const nodeLabel = props.nodeId ? (flow?.findNode(props.nodeId)?.data as { label?: string } | undefined)?.label ?? "" : "";
        window.dispatchEvent(new CustomEvent("toonflow:mtrack-batch-done", {
          detail: { nodeId: props.nodeId ?? "", ...(nodeLabel ? { nodeLabel } : {}), projectPath: props.projectPath ?? "", batchId, origin: options?.origin ?? "ui", kind: options?.kind ?? "batch", total: batchClips.length, ...settled },
        }));
      }
    });
    return { batchId, skipped: picked.skipped };
  } catch (reason) {
    if (activeBatchId.value === batchId) {
      activeBatchId.value = "";
      batchClipIds.value = [];
    }
    batchPaused.value = false;
    finishDispatchRun(controller);
    if (controller.signal.aborted) throw Object.assign(new Error("派工已中止"), { silent: true });
    throw reason;
  }
}

/**
 * 发起批次取消（不等流）：batchId 缺省取消当前活动批次。
 * ACT: 新通道的生成在服务端任务里跑，取消要**两件事一起做**——abort 本地轮询（立刻停手），
 * 并对在跑任务发 `tasks/cancel`（让服务端也停）。旧实现靠对画布节点 node:cancelGeneration，
 * 那条路径已经没有节点可用了。
 */
async function launchCancel(batchId?: string): Promise<{ batchId: string }> {
  const target = batchId ?? activeBatchId.value;
  if (!target) throw new Error("当前没有进行中的派工批次");
  if (dispatching.value && !(dispatchKind === "generate" && target === activeBatchId.value)) throw new Error("已有派工操作正在进行，请等待结束");
  if (!props.directory) throw new Error("当前没有工作目录，无法取消");
  const controller = new AbortController();
  if (dispatching.value) {
    // ACT: 抢占必须同步完成——abort 的旧循环 finally 经控制器身份守卫自然跳过复位，不能让它看到 dispatching=false 的空窗。
    dispatchController?.abort();
    dispatchController = controller;
  } else {
    dispatching.value = true;
    dispatchController = controller;
  }
  dispatchKind = "cancel";
  try {
    const marker = batchMarker(target);
    const running = clips.value.filter(clip => clip.status === "generating" && attemptsOfBatch(clip, target).length > 0);
    const taskIds = activeTaskIds.value;
    const cancelled = await cancelClipTasks(props.directory, taskIds, controller.signal);
    if (!cancelled) {
      // ACT: 取消失败时保留任务号与 generating 状态，只报错——写 pending 会让用户以为已停（审计 t25-P1-1）。
      runError.value = "取消请求失败：服务端任务可能仍在生成，请稍后再次取消";
      finishDispatchRun(controller);
      return { batchId: target };
    }
    for (const clip of running) {
      writeClipRun(clip.clipId, { status: "pending" }, { nodeId: clip.nodeId ?? "", status: "cancelled", error: marker });
    }
    activeTaskIds.value = [];
    activeBatchId.value = "";
    // 取消即批次终结：镜单一起清掉，否则「暂停 → 整批取消」后面板还会列着一批已不存在的镜头
    // （暂停态没有在途 run，不会有 finally 替它清）。
    batchClipIds.value = [];
    finishDispatchRun(controller);
    return { batchId: target };
  } catch (reason) {
    finishDispatchRun(controller);
    if (controller.signal.aborted) throw Object.assign(new Error("取消已中止"), { silent: true });
    throw reason;
  }
}

/** UI 入口：批次存在即允许请求取消（在途派工流由 launchCancel 抢占），并发/校验错误弹文按 launch* 抛错展示。 */
async function cancelBatch() {
  if (!activeBatchId.value) return;
  if (!props.directory) return ElMessage.warning("当前没有工作目录，无法取消");
  try {
    const { batchId } = await launchCancel();
    batchPaused.value = false;
    ElMessage.success(`批次 ${batchId.slice(0, 8)} 已请求取消`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    const message = reason instanceof Error ? reason.message : "取消批次失败";
    runError.value = message;
    ElMessage.error(message);
  }
}

/** 「生成视频」与逐镜面板「开始生成」共用：范围数字是唯一真源，镜数 -1 已在 rangeClips 换算到最后一镜。 */
async function startBatch(payload: { clips: string[]; includeFinished: boolean }) {
  if (!payload.clips.length) return ElMessage.warning("当前范围没有可生成的分镜");
  try {
    const { batchId, skipped } = await launchDispatch(payload.clips, { includeFinished: payload.includeFinished });
    ElMessage.success(`批次 ${batchId.slice(0, 8)} 已开始生成${skipped ? `，跳过 ${skipped} 段` : ""}；逐镜进度见页签状态与「逐镜面板」`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    const message = reason instanceof Error ? reason.message : "发起生成失败";
    runError.value = message;
    ElMessage.error(message);
  }
}

/** footer「生成视频」：把「生成范围」的两个数字换算成镜单后走 startBatch 同一条链。 */
function generateFromRange() {
  if (dispatching.value || batchHandle.value) return;
  if (!clips.value.length) return ElMessage.warning("工程里还没有镜头，请先添加镜头");
  void startBatch({ clips: rangeClips.value, includeFinished: includeFinished.value });
}

/**
 * 「本镜结束后暂停」：只置闸门，不中断正在跑的镜头（软暂停）；整批取消才走 abort。
 * ACT: 取桥相位（handle 还没建）里点的暂停由 launchDispatch 启动后补一次 handle.pause()。
 */
function pauseBatch() {
  if (!batchHandle.value || !activeBatchId.value) return ElMessage.warning("当前没有正在生成的批次");
  batchPaused.value = true;
  batchHandle.value.pause();
  ElMessage.info("已请求暂停：当前镜头生成结束后不再开始下一镜");
}

/**
 * 「继续 / 重试」：沿用同一批次号续跑剩余镜头，attempts 标记与面板行都不变。
 * ACT: 被拒一律抛错（而不是只弹提示后返回 status 快照）——node:resumeBatch 代理本函数，
 * 抛错才能让 agent 区分「已受理 / 被拒 / 失败」并拿到原因；界面侧的提示由 panelResume 兜。
 * ACT: origin 由调用方声明——除面板外只有 node 工具调本函数，故默认 "agent"；panelResume 显式传 "ui"，
 * 否则 agent/index.vue 会把用户在界面上点的「继续生成」写成「由你发起的派工」。
 */
async function resumeBatch(payload: { clips: string[]; includeFinished: boolean }, origin: "ui" | "agent" = "agent"): Promise<{ batchId: string }> {
  if (dispatching.value || batchHandle.value) throw new Error("已有派工操作正在进行，请等待结束");
  if (!payload.clips.length) {
    batchPaused.value = false;
    throw new Error("批次剩余镜头已全部完成，没有需要续跑的镜头");
  }
  // 先开闸再发起：等 launchDispatch 返回后才清，会把「刚点继续就点暂停」的请求一起抹掉。
  batchPaused.value = false;
  const { batchId } = await launchDispatch(payload.clips, { batchId: activeBatchId.value, includeFinished: payload.includeFinished, origin });
  return { batchId };
}

/** footer「继续 / 重试」的界面入口：批次台账里 pending/failed 的镜全部续跑（同 batchPanel 的 pendingClips 判据）。 */
function footerResume() {
  const pending = batchClipIds.value
    .map(clipId => clips.value.find(clip => clip.clipId === clipId))
    .filter(clip => clip && (clip.status === "pending" || clip.status === "failed"))
    .map(clip => clip!.clipId);
  void panelResume({ clips: pending, includeFinished: includeFinished.value });
}

/** 「单镜重试/重新生成本镜」：只派这一镜，强制 includeFinished；已生成的镜生成新版本追加（旧视频保留），failed 的镜照常重跑。被拒同样抛错。
 *  ACT: origin 语义同 resumeBatch；kind 固定 "clip"，通知消费方据此区分「单镜生成」与「整批派工」。 */
async function retryClip(payload: { clipId: string }, origin: "ui" | "agent" = "agent"): Promise<{ batchId: string }> {
  if (dispatching.value || batchHandle.value) throw new Error("生成进行中，请先暂停或取消后重试单镜");
  return await launchDispatch([payload.clipId], { includeFinished: true, origin, kind: "clip" });
}

/** 「继续生成」的界面入口：把 resumeBatch 的抛错翻成提示，行为与抛错前一致。 */
async function panelResume(payload: { clips: string[]; includeFinished: boolean }) {
  try {
    const { batchId } = await resumeBatch(payload, "ui");
    ElMessage.success(`批次 ${batchId.slice(0, 8)} 已继续生成`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    const message = reason instanceof Error ? reason.message : "继续生成失败";
    runError.value = message;
    if (message.includes("没有需要续跑的镜头")) ElMessage.info(message);
    else ElMessage.error(message);
  }
}

/** 「单镜重试」的界面入口：同上。 */
async function panelRetry(payload: { clipId: string }) {
  try {
    const { batchId } = await retryClip(payload, "ui");
    ElMessage.success(`已重试 ${payload.clipId}，批次 ${batchId.slice(0, 8)}`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    const message = reason instanceof Error ? reason.message : "单镜重试失败";
    runError.value = message;
    ElMessage.error(message);
  }
}

/** UI 入口：重新生成本镜。LSC 对齐——已生成/已验收的镜也直接重跑，强制 includeFinished；
 *  每次重跑生成新版本（旧版本保留，历史版本列表可切回），新视频完成后成为该镜默认。 */
async function regenerateClip() {
  if (dispatching.value || batchHandle.value) return;
  const clip = selectedClip.value;
  if (!clip) return;
  const picked = pickDispatchTargets([clip.clipId], true);
  if (picked.issue) return ElMessage.warning(picked.issue);
  try {
    const { batchId } = await launchDispatch([clip.clipId], { includeFinished: true, kind: "clip" });
    ElMessage.success(`批次 ${batchId.slice(0, 8)} 已开始重新生成，新版本完成后自动成为默认视频`);
  } catch (reason) {
    // 与发起生成完全一致：aborted（卸载/取消竞态）静默，其余弹错并进 footer 错误行。
    if ((reason as { silent?: boolean })?.silent) return;
    const message = reason instanceof Error ? reason.message : "发起生成失败";
    runError.value = message;
    ElMessage.error(message);
  }
}

/** 「刷新状态」：只读画布节点状态，把已结束的生成补写成终态，不改在跑批次。 */
async function reconcileFromPanel() {
  try {
    const result = await reconcileGenerating();
    if (result.checked) ElMessage.success(`已对账 ${result.checked} 镜：恢复 ${result.restored}${result.failed ? `，失败 ${result.failed}` : ""}`);
    else ElMessage.info("没有需要恢复的镜头");
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : "状态对账失败");
  }
}

/**
 * 打不开的判据：取不到画布桥、或节点/工具查询报错。对账本身失败不代表镜头停在哪，
 * 所以整轮跳过、不改任何镜头状态——把「查不出来」写成 failed 会误伤其实还在跑的生成。
 */
function throwCanvasUnavailable(reason: unknown): never {
  throw new Error("画布暂不可用，未能对账，请稍后重试", { cause: reason });
}

/** 一次媒体任务尝试的找回凭据：taskId + 写 attempts 时的前缀，尽量不丢上下文。 */
function mediaTaskAttempt(clip: MtrackClip) {
  const attempt = clip.attempts.findLast(item => item.status === "generating");
  const found = / task:([0-9a-f-]{36})$/i.exec(attempt?.error ?? "");
  if (!found) return undefined;
  return { taskId: found[1], prefix: (attempt?.error ?? "").slice(0, found.index) };
}

/** 恢复监听中断的媒体任务：服务端还活着，等它结束后按主循环同一口径落工程。 */
function resumeMediaWatch(clipId: string, recovery: { taskId: string; prefix: string }, signal: AbortSignal) {
  void waitClipTask(props.directory, recovery.taskId, signal)
    .then(result => applyMediaTaskResult(clipId, recovery, result))
    .catch(() => {
      // 等待期间页面关闭/卸载属正常中断，不改工程状态；下次对账会重新接回。
    });
}

/** 把媒体任务终态写回工程。与主循环成功/失败/取消三条写回分支保持同一口径。 */
function applyMediaTaskResult(clipId: string, recovery: { taskId: string; prefix: string }, result: MediaTaskStatus) {
  if (result.state === "succeeded") {
    const file = result.files[0];
    if (!file?.path) {
      writeClipRun(clipId, { status: "failed" }, { nodeId: "", status: "failed", error: `${recovery.prefix} 服务端报告成功但没有返回文件路径` });
      return;
    }
    writeClipRun(clipId, { status: "generated", nodeId: null, assetPath: file.path },
      { nodeId: "", status: "succeeded", error: `${recovery.prefix} task:${recovery.taskId}`, ...(file.jobId ? { jobId: file.jobId } : {}) });
    return;
  }
  if (result.state === "cancelled" || result.state === "lost") {
    writeClipRun(clipId, { status: "pending" }, { nodeId: "", status: "cancelled", error: `${recovery.prefix} task:${recovery.taskId}${result.state === "lost" ? " 任务已丢失，已退回待生成" : ""}` });
    return;
  }
  const message = result.state === "failed" ? result.error : "等待生成结果超时（1 小时）";
  writeClipRun(clipId, { status: "failed" }, { nodeId: "", status: "failed", error: `${recovery.prefix} ${message}` });
}

/** 对账用的独立取消信号：编辑器卸载时一并中断，避免恢复监听悬挂。 */
let reconcileController: AbortController | undefined;
function checkedCancelledSignal() {
  if (!reconcileController || reconcileController.signal.aborted) reconcileController = new AbortController();
  return reconcileController.signal;
}

/**
 * 断点续跑对账：生成循环中断或编辑器重挂后，循环没了，但画布节点还在内存里跑着供应商任务。
 * 对每个停在 generating 且不属于本实例在跑批次的镜头只读一次节点状态，按终态补写工程，
 * 避免 status=generating 永久卡住（工程里就没法再派这一镜了）。
 *
 * 三种镜头都能落定，不再有「永久卡生成中」：节点已结束 → 补成终态；节点报 idle 且产物还在
 * → 补成 generated；节点报 idle 且没有任何产物（真·进程重启后节点上的任务没了）→ 退回 pending
 * 让用户能重新派工。只有「这一次查不出来」才整轮跳过，绝不误标 failed——详见 readClipGeneration。
 */
async function reconcileGenerating(): Promise<{ checked: number; restored: number; failed: number }> {
  const empty = { checked: 0, restored: 0, failed: 0 };
  if (dispatching.value || batchHandle.value || !project.value) return empty;
  const inFlight = new Set(batchClipIds.value);
  // ACT: 媒体任务通道的镜头写的是 nodeId=null（生成在服务端任务里，不建画布节点）。这类镜头重开后
  // 同样卡在 generating，但画布上没节点可查——只能按「重启后任务已追不回」退回 pending，否则永久卡生成。
  const stuck = clips.value.filter(clip => clip.status === "generating" && !inFlight.has(clip.clipId));
  if (!stuck.length) return empty;
  const bridge = await acquireBridge();
  if (!bridge) throwCanvasUnavailable(new Error("未取到画布上下文"));
  let checked = 0;
  let restored = 0;
  let failed = 0;
  for (const clip of stuck) {
    const live = project.value.clips.find(item => item.clipId === clip.clipId);
    // 对账期间这一镜又被派工了（状态被改写）就跳过，绝不能覆盖在跑中的状态。
    if (!live || live.status !== "generating") continue;
    if (!clip.nodeId) {
      /*
       * 媒体任务通道：服务端任务与 taskId 都在，只是刷新后客户端丢了轮询循环。
       * taskId 记在这一次 generating 尝试的 error 里（`<marker> task:<uuid>`），据此接回：
       * 任务还在跑 → 恢复监听；已出结果 → 补写 generated；任务已过期/服务端重启 → 退回待生成。
       * ACT: 服务端任务在页面断连 30 分钟后才会被终止，结算结果落盘并保留 24 小时
       * （apps/server/src/utils/media/tasks.ts），所以正常情况能拿回成片；只有真的追不回来才落 pending，
       * 不能永久卡 generating。
       */
      const recovery = mediaTaskAttempt(clip);
      if (!recovery) {
        writeClipRun(clip.clipId, { status: "pending" }, { nodeId: "", status: "pending", error: "重启后回退（媒体任务通道）" });
        continue;
      }
      let taskStatus: Awaited<ReturnType<typeof readClipTask>> | undefined;
      try {
        taskStatus = await readClipTask(props.directory, recovery.taskId, new AbortController().signal);
      } catch {
        // 查不出来（任务已过期/服务端重启）：退回待生成，让用户能重新派这一镜。
        writeClipRun(clip.clipId, { status: "pending" }, { nodeId: "", status: "pending", error: `${recovery.prefix} 重启后任务已过期，已退回待生成` });
        continue;
      }
      checked += 1;
      if (taskStatus.state === "running") {
        // 任务仍在服务端跑：接回轮询，结束后按主循环同一口径补写工程。
        resumeMediaWatch(clip.clipId, recovery, checkedCancelledSignal());
        continue;
      }
      applyMediaTaskResult(clip.clipId, recovery, taskStatus);
      if (taskStatus.state === "succeeded") restored += 1;
      else if (taskStatus.state === "failed") failed += 1;
      continue;
    }
    const nodeId = clip.nodeId;
    let found: Awaited<ReturnType<typeof readClipGeneration>>;
    try {
      found = await readClipGeneration(bridge, nodeId);
    } catch (reason) {
      // 这一次查询失败只说明现在读不出来，后面几镜同样读不出来：整轮停手，本轮一处都不写。
      throwCanvasUnavailable(reason);
    }
    checked += 1;
    if (found.outcome === "idle") continue;
    if (found.outcome === "pending") {
      // 真·进程重启：节点上的任务没了，退回待生成让用户能重新派这一镜（不写 failed，避免误报失败）。
      writeClipRun(clip.clipId, { status: "pending" }, { nodeId, status: "pending", error: "重启后回退" });
      continue;
    }
    if (found.outcome === "succeeded" && found.assetPath) {
      writeClipRun(clip.clipId, { status: "generated", nodeId, assetPath: found.assetPath }, { nodeId, status: "succeeded", error: "对账恢复" });
      restored += 1;
      continue;
    }
    const reason = found.outcome === "succeeded" ? "节点报告生成成功但没有返回视频路径" : found.error;
    writeClipRun(clip.clipId, { status: "failed", nodeId }, { nodeId, status: "failed", error: reason });
    failed += 1;
  }
  // 提示统一由调用方（刷新状态按钮 / 打开编辑器）发出，这里只回报计数，避免一次对账弹两条。
  return { checked, restored, failed };
}

/**
 * 磁盘对账：读盘比 updatedAt。相等 no-op；不等且内存干净时自动重载并尽量保留选中；
 * 内存已脏时返回 {conflict:true} 并复用冲突条提示，不改内存（交由用户决定重新加载或先保存）。
 */
async function syncFromDisk(): Promise<{ reloaded: boolean; conflict: boolean }> {
  if (!bound.value) throw new Error("节点还没有绑定工程文件");
  if (!project.value) throw new Error("工程尚未加载完成，请先重新加载");
  const raw = await props.getFiles().readJson<MtrackProject>(projectPath.value);
  const disk = normalizeProject(raw);
  if (disk.updatedAt === project.value.updatedAt) return { reloaded: false, conflict: false };
  if (dirty.value) {
    conflictError.value = "文件已被其他操作修改，请重新加载";
    return { reloaded: false, conflict: true };
  }
  const keepId = selectedId.value;
  const keepMulti = [...multiSelectedIds.value];
  project.value = disk;
  lastSaved.value = cloneProject(disk);
  loadError.value = "";
  conflictError.value = "";
  selectedId.value = disk.clips.some(clip => clip.clipId === keepId) ? keepId : disk.clips[0]?.clipId ?? "";
  multiSelectedIds.value = keepMulti.filter(id => disk.clips.some(clip => clip.clipId === id));
  return { reloaded: true, conflict: false };
}

/**
 * 分镜号数值（S007→7），非 ^S\d{3}$ 返回 NaN，与 planOperator 的 clipNumber 同规则。
 * ACT: planOperator 的 clipNumber/sliceClips 在工具包私有副本里（packages/tools/planOperator/src/mtrackProject.ts），
 * 跨包共享它们超出本任务范围；此处三行内联，升级路径是下沉到 nodeShared/mtrackProject.ts 供两边复用。
 */
function clipNumber(clipId: string): number {
  return /^S\d{3}$/.test(clipId) ? Number(clipId.slice(1)) : Number.NaN;
}

/**
 * 范围读（含端点）：先对账磁盘再取内存。from 缺省 S001，to 缺省（给了 from 时等于 from，否则末镜）。
 * missing 为区间内未命中的编号清单（对齐 mtrackRead，不整体报错）。
 * conflict=true 表示磁盘已被其他操作改过且内存有未保存修改，返回的是内存版本（评审观察 b 的显式化）。
 */
async function readRange(from?: string, to?: string): Promise<{ updatedAt: string; clips: MtrackClip[]; missing: string[]; conflict: boolean }> {
  const sync = await syncFromDisk();
  if (!project.value) throw new Error("readRange 失败：工程未加载");
  const list = clips.value;
  const start = from ?? "S001";
  const end = to ?? (from ? from : list[list.length - 1]?.clipId ?? "S001");
  const startNumber = clipNumber(start);
  const endNumber = clipNumber(end);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) {
    throw new Error(`readRange 失败：分镜号需形如 S001（收到 ${!Number.isFinite(startNumber) ? start : end}）`);
  }
  if (startNumber > endNumber) {
    throw new Error(`readRange 失败：起始分镜号 ${start} 不得晚于结束分镜号 ${end}`);
  }
  const present = new Set(list.map(clip => clip.clipId));
  const missing: string[] = [];
  for (let index = startNumber; index <= endNumber; index += 1) {
    const clipId = `S${String(index).padStart(3, "0")}`;
    if (!present.has(clipId)) missing.push(clipId);
  }
  return {
    updatedAt: project.value.updatedAt,
    conflict: sync.conflict,
    clips: list.filter(clip => {
      const number = clipNumber(clip.clipId);
      return Number.isFinite(number) && number >= startNumber && number <= endNumber;
    }),
    missing,
  };
}

/**
 * 命令式批量编辑：先磁盘对账，再把 ops 交给 mtrackEdit 内核；issues 整批拒收（内存不变）。
 * 成功且 save=true 时立即写盘，不等 800ms 防抖。conflict 时不落 edits，交调用方处理。
 */
async function applyOperations(ops: EditOp[], save = true): Promise<{ applied: boolean; issues: string[]; conflict: boolean; saved: boolean; updatedAt: string }> {
  const sync = await syncFromDisk();
  if (sync.conflict) return { applied: false, issues: ["磁盘与内存不一致：文件已被其他操作修改，请先重新加载或保存"], conflict: true, saved: false, updatedAt: project.value?.updatedAt ?? "" };
  if (!project.value) throw new Error("applyOperations 失败：工程未加载");
  const result = applyClipOperations(project.value, ops);
  if (!result.applied) return { applied: false, issues: result.issues, conflict: false, saved: false, updatedAt: project.value.updatedAt };
  let saved = false;
  let issues: string[] = [];
  if (save) {
    clearTimeout(saveTimer);
    saved = await saveProject();
    // ACT: applyClipOperations 置脏后，watch 的微任务回调会重新 arm 800ms 防抖；写完盘再清一次，避免重复整文件写。
    clearTimeout(saveTimer);
    // runSave 失败不抛错（冲突/IO 异常都记进状态），这里必须把失败回报给调用方，否则 agent 会以为已落盘。
    if (!saved) issues = [conflictError.value || loadError.value || "保存未生效，请查看状态后重试"];
  }
  return { applied: true, issues, conflict: Boolean(issues.length && conflictError.value), saved, updatedAt: project.value.updatedAt };
}

/** 命令式绑定：open 绑已有（缺省默认工程路径）；new 新建空白（给了 path 用该路径，缺省沿用顺延探测）。 */
async function bindCommand(mode: "open" | "new", path?: string): Promise<{ bound: true; projectPath: string }> {
  if (bound.value && path && path !== projectPath.value) {
    throw new Error(`已绑定 ${projectPath.value}，如需切换请新建节点或重新加载`);
  }
  if (mode === "open") {
    // 已绑定且未给 path：视为对当前路径的幂等 open，绝不回落默认路径造成无感切换。
    const target = path ?? (bound.value ? projectPath.value : defaultProjectPath);
    if (target === projectPath.value) return { bound: true, projectPath: target };
    bindProject(target);
    await readProject();
    await loadReport();
    if (loadError.value) throw new Error(loadError.value);
    return { bound: true, projectPath: target };
  }
  if (bound.value) {
    // ACT: 已绑定时 new 不另起第二份文件、也不覆盖现有绑定，幂等返回当前路径；换工程请走 open 或新建节点。
    return { bound: true, projectPath: projectPath.value };
  }
  if (path) {
    await createBlankProject(path);
    return { bound: true, projectPath: path };
  }
  const target = await reserveProjectPath();
  await createBlankProject(target);
  return { bound: true, projectPath: target };
}

/** 状态快照：节点函数与宿主 UI 的只读面板。batchClipIds = 当前批次台账（暂停时保留，供面板续跑）。 */
function statusSnapshot() {
  return {
    bound: bound.value,
    projectPath: projectPath.value,
    clipCount: clips.value.length,
    totalSeconds: totalSeconds(clips.value),
    statusCounts: clips.value.reduce<Record<string, number>>((counts, clip) => {
      counts[clip.status] = (counts[clip.status] ?? 0) + 1;
      return counts;
    }, {}),
    dirty: dirty.value,
    saving: saving.value,
    dispatching: dispatching.value,
    activeBatchId: activeBatchId.value,
    batchClipIds: [...batchClipIds.value],
    batchRunning: batchRunning.value,
    batchPaused: batchPaused.value,
    findingsCount: findingsCount.value,
    conflictError: conflictError.value,
    loadError: loadError.value,
  };
}

onMounted(async () => {
  await probeDefaultProject();
  await readProject();
  await loadReport();
  // 文本模型清单与画布无关，进界面即可拉；失败时按钮点击会再拉一次并提示。
  void loadTextModels();
  // 模型清单要等画布桥就绪：挂载瞬间可能还没建好，1.5 秒后补一次；仍取不到就保持空清单（选择器降级）。
  void loadVideoModels().then(() => {
    if (videoModelsLoaded) return;
    // ACT: 记句柄，节点在 1.5 秒内被删/切走时不再回调已卸载的编辑器。
    modelRetryTimer = setTimeout(() => void loadVideoModels(true), 1500);
  });
  // 打开编辑器即对账一次：上一次会话中断后停在 generating 的镜头在这里补成终态。
  void reconcileGenerating().catch(() => {});
});

onBeforeUnmount(() => {
  reconcileController?.abort();
  // ACT: 直连生成随节点卸载中断（轮询停止），供应商侧任务留在服务端任务上，重开画布可继续看状态。升级路径：宿主级派工注册表，把轮询提升到 workspace 层继续。
  dispatchController?.abort();
  // 卸载时补一次写盘：宿主没来得及调 flushSave 也不能丢掉已改的工程内容。
  clearTimeout(saveTimer);
  clearTimeout(modelRetryTimer);
  if (dirty.value) void saveProject();
  // 参考缩略图的 blob URL 随编辑器卸载一起释放。
  releaseThumbnails();
});

watch(dirty, value => {
  emit("dirtyChange", value);
  if (!value) return;
  dirtyVersion.value += 1;
});

/** 字段失焦即保存：每次改动触发一轮 800ms 防抖写回盘，避免逐键写文件。 */
watch(dirtyVersion, () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveProject(), 800);
});

defineExpose({
  flushSave: saveProject,
  reload: reloadProject,
  status: statusSnapshot,
  bind: bindCommand,
  readRange,
  applyOperations,
  syncFromDisk,
  launchDispatch,
  launchCancel,
  pauseBatch,
  resumeBatch,
  retryClip,
  rewritePrompt,
  setDefaultVersion,
  acquireNodeVideo,
  clips,
  indexCards,
  referenceThumbnails,
  acquireUrl,
  report,
  reportReadError,
});
</script>

<style scoped>
/* ACT: 多轨编辑器自己的语义 token，全部从 --el-* 派生，所以跟随设置里的主题与主色自动变化。
   对齐 LSC native-h3-scene 的镜头创作工作台层次（surface / soft / line / muted 四层），
   但不照抄它的硬编码深色色值——LSC 是独立深色应用，我们住在画布卡片里，必须跟宿主主题走。 */
.mtrackEditor {
  --mtSurface: var(--el-bg-color);
  --mtSoft: var(--el-fill-color-light);
  --mtSofter: var(--el-fill-color-lighter);
  --mtLine: var(--el-border-color-lighter);
  --mtLineStrong: var(--el-border-color);
  --mtMuted: var(--el-text-color-secondary);
  --mtAccent: var(--el-color-primary);
  --mtAccentSoft: var(--el-color-primary-light-9);
  --mtRadius: 12px;
  --mtRadiusSmall: 8px;

  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: contain;
  /* 画布卡片态可以窄到 480px，用它做容器查询的锚点，窄时给双栏降级。 */
  container-type: inline-size;
  color: var(--el-text-color-primary);
  background: var(--mtSurface);
}

.conflictBar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  font-size: 12px;
}

.bindBar {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px;
}

.bindHint {
  max-width: 520px;
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.bindActions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bindMeta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

/* 工作台主体：头部、快捷设置、01、02、高级设置随内容纵向滚动；footer 固定底部。 */
.workbenchScroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 10px 14px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.editorHeading {
  display: flex;
  flex: none;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.headingText {
  min-width: 0;
}

.editorHeading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.editorSubtitle {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--mtMuted);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.editorMeta {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--mtMuted);
  font-size: 11px;
  opacity: 0.8;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.quickSettings {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--mtLine);
  border-radius: var(--mtRadiusSmall);
  background: var(--mtSoft);
}

.quickField {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 150px;
}

.quickModelText {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.quickMeta {
  margin-left: auto;
  padding-bottom: 4px;
  color: var(--mtMuted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.fieldLabel {
  color: var(--mtMuted);
  font-size: 11px;
}

.sectionHeading {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sectionTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.stepIndex {
  color: var(--mtAccent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
}

.shotManagement {
  display: flex;
  position: relative;
  align-items: center;
  gap: 6px;
}

.bulkDetails {
  margin: 0;
}

.bulkSummary {
  padding: 4px 10px;
  border: 1px solid var(--mtLineStrong);
  border-radius: 7px;
  color: var(--el-text-color-primary);
  background: var(--mtSurface);
  font-size: 12px;
  font-weight: 500;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.bulkSummary::-webkit-details-marker {
  display: none;
}

/* ACT: 面板从按钮向右展开，包含块是这一行操作区，所以 max-width: 100% 会跟着收窄，
   窄容器下不会横向溢出（沿用原 clipEditor 批量区的取舍）。 */
.bulkPanel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 6;
  width: 480px;
  max-width: 100%;
  padding: 16px;
  border: 1px solid var(--mtLineStrong);
  border-radius: var(--mtRadius);
  background: var(--mtSurface);
  box-shadow: var(--el-box-shadow-light);
}

.bulkTitle {
  margin: 0 0 12px;
  font-size: 13px;
}

.bulkControls {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto minmax(120px, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin: 0;
}

.bulkField {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  color: var(--mtMuted);
  font-size: 12px;
  line-height: 1.5;
}

.bulkHint {
  margin: 12px 0 0;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  line-height: 1.6;
}

/* 02 双栏：镜头编辑主区吸收宽度，参考素材 aside 固定比例（LSC nh-workspace）。 */
.workspace {
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
}

.workspaceEmpty {
  margin: 0;
  padding: 24px 16px;
  color: var(--mtMuted);
  font-size: 12px;
}

.sectionAdvanced {
  flex: none;
  padding: 6px 10px 10px;
  border: 1px solid var(--mtLine);
  border-radius: var(--mtRadiusSmall);
}

.sectionSummary {
  color: var(--mtMuted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}

/* ACT: 折叠标记被隐藏后没有任何替代物，展开态看不出能收起；这里补一个会转的三角提示。 */
.sectionSummary::before,
.nestedSummary::before {
  content: "▸";
  display: inline-block;
  margin-right: 4px;
  transition: transform 0.15s;
}

details[open] > .sectionSummary::before,
details[open] > .nestedSummary::before {
  transform: rotate(90deg);
}

.sectionSummary::-webkit-details-marker {
  display: none;
}

.advancedBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
}

.advancedSection {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.advancedTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}

.nestedDetails {
  padding: 6px 8px 8px;
  border: 1px dashed var(--mtLine);
  border-radius: var(--mtRadiusSmall);
}

.nestedSummary {
  color: var(--mtMuted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.nestedSummary::-webkit-details-marker {
  display: none;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.fieldColumn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.rangeGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 220px));
  gap: 10px;
}

.rangeRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.rangeText {
  margin: 0;
  color: var(--mtMuted);
  font-size: 11px;
  line-height: 1.6;
}

.advancedActions {
  display: flex;
  justify-content: flex-end;
}

/* 容器窄于 560px（画布卡片被拖窄）时 02 双栏改成上下两段。 */
@container (max-width: 560px) {
  .workspace {
    flex-direction: column;
  }

  .referencePicker {
    width: auto;
  }
}
</style>
