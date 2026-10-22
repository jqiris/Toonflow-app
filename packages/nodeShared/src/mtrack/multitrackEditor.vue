<template>
  <div class="mtrackEditor">
    <header class="editorHeader">
      <div class="headingMain">
        <h2 class="editorTitle">多轨编辑器</h2>
        <p class="editorSubtitle">
          <span class="metric">{{ clips.length }} 镜 / {{ totalSeconds(clips).toFixed(0) }} 秒</span>
          <span class="meta">{{ projectMetaText }}</span>
        </p>
      </div>
      <span class="headerActions">
        <el-button size="small" :disabled="!bound" @click="addClip">＋ 添加片段</el-button>
        <el-button size="small" :disabled="!bound" :loading="loadingReport" @click="loadReport">校验{{ findingsCount ? ` ${findingsCount}` : "" }}</el-button>
      </span>
    </header>
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
      <trackBar
        :clips="clips"
        :selectedId="selectedId"
        :multiSelectedIds="multiSelectedIds"
        :ratio="project?.global.ratio ?? ''"
        :modelLabel="modelLabel"
        :modelOptions="modelOptions"
        @select="onSelect"
        @updateRatio="handleRatioChange"
        @updateModel="handleModelChange"
      />
      <dispatchBar
        v-model:includeFinished="includeFinished"
        :clips="selectedClips"
        :busy="dispatching"
        :batchId="activeBatchId"
        :skippedCount="skippedCount"
        :compositeBusy="compositeBusy"
        :hasAccepted="hasAccepted"
        @generate="generateSelection"
        @cancel="cancelBatch"
        @openBatch="batchPanelVisible = true"
        @reconcile="reconcileFromPanel"
        @composite="handleComposite"
      />
      <p v-if="!props.directory" class="editorHint">未绑定工作目录，无法合成成片。</p>
      <p v-else-if="!hasAccepted" class="editorHint">没有已确认的片段，合成成片按钮暂不可用。</p>
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
        @resume="resumeBatch"
        @retry="retryClip"
        @cancel="cancelBatch"
        @reconcile="reconcileFromPanel"
      />
      <div v-if="conflictError" class="conflictBar" role="alert">
        <span>{{ conflictError }}</span>
        <el-button size="small" type="primary" @click="reloadProject">重新加载</el-button>
      </div>
      <div v-else class="editorWorkspace">
        <div class="editorMain">
          <clipEditor
            v-if="selectedClip"
            :key="selectedClip.clipId"
            :clip="selectedClip"
            :index="selectedIndex"
            :clipCount="clips.length"
            :indexCards="indexCards"
            :thumbnails="referenceThumbnails"
            @patch="onPatch"
            @duplicate="duplicateClip"
            @move="moveClip"
            @remove="removeClip"
            @accept="acceptClip"
            @rewrite="rewriteClipPrompt"
            :rewriteBusy="rewriteBusy"
            :rewritePending="pendingRewrite"
            @adoptRewrite="adoptRewrite"
            @discardRewrite="discardRewrite"
            @updateRewriteDraft="updateRewriteDraft"
            @bulkDuration="bulkDuration"
            @bulkAdd="bulkAdd"
          />
          <p v-else class="editorHint">选中一个片段后在这里编辑。</p>
        </div>
        <div class="editorSide">
          <statusPanel
            :clip="selectedClip"
            :report="report"
            :readError="reportReadError"
            :acquireUrl="acquireUrl"
            :acquireNodeVideo="acquireNodeVideo"
          />
        </div>
      </div>
      <details class="sectionResults">
        <summary class="sectionSummary">生成结果</summary>
        <ul v-if="producedClips.length" class="resultList">
          <li v-for="clip in producedClips" :key="clip.clipId" class="resultItem">
            <span class="resultClip">{{ clip.clipId }} · {{ clip.title || "未命名" }}</span>
            <span class="resultStatus">{{ clipStatusLabel(clip.status) }}</span>
            <span class="resultPath">{{ clip.assetPath }}</span>
          </li>
        </ul>
      </details>
      <details class="sectionAdvanced">
        <summary class="sectionSummary">高级设置 · 全片约束</summary>
        <div class="advancedGrid">
          <label class="fieldColumn">
            <span class="fieldLabel">全片风格</span>
            <el-input
              type="textarea"
              :rows="2"
              :modelValue="project?.global.style ?? ''"
              @input="onGlobalPatch({ style: String($event) })"
            />
          </label>
          <label class="fieldColumn">
            <span class="fieldLabel">系统提示词（全片共用，渲染时拼到画面正文开头）</span>
            <el-input
              type="textarea"
              :rows="3"
              :modelValue="project?.global.systemPrompt ?? ''"
              @input="onGlobalPatch({ systemPrompt: String($event) })"
            />
          </label>
        </div>
      </details>
      <footer class="editorFooter">
        <p v-if="loadError" class="footerError" role="alert">{{ loadError }}</p>
        <div class="footerBar">
          <div class="saveState" aria-live="polite">
            <span class="saveText" :class="{ saveDirty: dirty && !saving }">{{ saveText }}</span>
            <span v-if="dirty" class="dirtyStar" aria-label="有未保存的修改">*</span>
          </div>
          <div class="footerActions">
            <el-button v-if="undoStack.length" size="small" text @click="undoRemove">撤销删除</el-button>
            <el-button size="small" :loading="saving" :disabled="!dirty" @click="() => void saveProject()">保存</el-button>
          </div>
        </div>
        <p class="snapshotNotice">生成任务按提交时的快照运行，此处修改只影响下次生成。</p>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { ElButton, ElInput, ElMessage, ElMessageBox } from "element-plus";
import type { AssetIndex, AssetIndexCard, AssetReport, EditorFiles, MtrackClip, MtrackProject } from "./mtrackProject";
import {
  assetIndexPath,
  assetReportPath,
  defaultProjectPath,
  normalizeProject,
  createClip,
  nextClipId,
  clipStatusLabels,
  localizeTime,
  totalSeconds,
  cloneClips,
  ratioOptions,
} from "./mtrackProject";
import { beginDirectCancel, beginDirectDispatch, readClipGeneration, resolveCanvasBridge, findCardNodeIds, imagePathOf, readNodeDetail, type CanvasCall } from "./directDispatch";
import { attemptsOfBatch, batchMarker } from "./batchMark";
import { applyClipOperations } from "./mtrackEdit";
import type { EditOp } from "./mtrackEdit";
import trackBar from "./components/trackBar.vue";
import clipEditor from "./components/clipEditor.vue";
import statusPanel from "./components/statusPanel.vue";
import dispatchBar from "./components/dispatchBar.vue";
import batchPanel from "./components/batchPanel.vue";

const props = defineProps<{
  /** 每次操作时重新取文件能力：文档面板扩展传 context.files，画布节点传工作区文件包装。 */
  getFiles: () => EditorFiles;
  /** 派工所用的工作区目录（画布所属项目目录）。 */
  directory: string;
  /** 绑定的工程文件路径；空字符串表示这个节点还没有绑定工程，不读取任何已有工程。 */
  projectPath?: string;
}>();

const emit = defineEmits<{ dirtyChange: [value: boolean]; bind: [path: string]; compositeDone: [output: string] }>();

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
const indexCards = ref<AssetIndexCard[]>([]);
const report = ref<AssetReport | undefined>();
const reportReadError = ref("");
const loadingReport = ref(false);
const loadError = ref("");
const conflictError = ref("");
const saving = ref(false);
const savedAt = ref("");
const selectedId = ref("");
const multiSelectedIds = ref<string[]>([]);
const undoStack = ref<MtrackClip[][]>([]);
const lastSaved = ref<MtrackProject | null>(null);
const dirtyVersion = ref(0);
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const clips = computed(() => project.value?.clips ?? []);
/** 用内容比较而不是对象身份：保存后 lastSaved 必然是新克隆，身份比较会把 dirty 永远卡在 true。 */
const dirty = computed(() => {
  if (!project.value || !lastSaved.value) return false;
  return JSON.stringify(project.value) !== JSON.stringify(lastSaved.value);
});
const selectedClip = computed(() => clips.value.find(clip => clip.clipId === selectedId.value));
const selectedIndex = computed(() => clips.value.findIndex(clip => clip.clipId === selectedId.value));
const selectedTitle = computed(() => selectedClip.value?.title || selectedClip.value?.clipId || "");
/** ISO 时间串统一本地化展示的入口在 mtrackProject，这里只负责页头与绑定探测两处文案。 */
const projectUpdatedAt = computed(() => project.value?.updatedAt ?? "");
/** 页头副标题的更新时间：本地化时间，工程尚未写过时与 LSC 一致显示「尚未保存」。 */
const projectSavedText = computed(() => localizeTime(projectUpdatedAt.value, "尚未保存"));
/** 页头路径行：未绑定工程时说明状态，不能显示由空路径拼出的「 · 尚未保存」。 */
const projectMetaText = computed(() => bound.value ? `${projectPath.value} · ${projectSavedText.value}` : "未绑定工程");
const findingsCount = computed(() => report.value?.findings?.length ?? 0);
/** 生成结果折叠区的清单：只列真实有产出文件的镜头。 */
const producedClips = computed(() => clips.value.filter(clip => clip.assetPath && clip.status !== "pending" && clip.status !== "failed"));
/** 底栏保存状态，分支顺序与 LSC 一致：保存中 → 已修改 → 已保存 → 未修改（读取错误单独一行展示）。 */
const saveText = computed(() => {
  if (saving.value) return "保存中…";
  if (dirty.value) return `已修改${selectedTitle.value ? ` · 选中 ${selectedTitle.value}` : ""}`;
  if (savedAt.value) return `已保存 · ${new Date(savedAt.value).toLocaleTimeString()}`;
  return "未修改";
});

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

async function reloadProject() {
  await readProject();
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
let loadReportInFlight: Promise<void> | undefined;
async function loadReport() {
  if (loadReportInFlight) return loadReportInFlight;
  const running = runLoadReport();
  loadReportInFlight = running;
  try {
    await running;
  } finally {
    if (loadReportInFlight === running) loadReportInFlight = undefined;
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
  try {
    report.value = await props.getFiles().readJson<AssetReport>(assetReportPath);
  } catch (reason) {
    // 报告缺失（九宫格拆图只写 assetIndex）按「未读取到」处理：不写错误，也不拿空报告假装校验通过。
    report.value = undefined;
    reportReadError.value = isMissingFile(reason) ? "" : reason instanceof Error ? reason.message : String(reason);
  }
  try {
    indexCards.value = normalizeIndex(await props.getFiles().readJson<AssetIndex>(assetIndexPath));
  } catch {
    // 老工程没有 assetIndex.json 属正常；显式清空，避免切换工程后残留上一份的卡片。
    indexCards.value = [];
  }
  // 读取期间换了工程路径：这批结果属于上一个工程，不能覆盖当前工程的卡片与报告。
  if (projectPath.value !== pathAtStart) return;
  loadingReport.value = false;
}

function normalizeIndex(source: AssetIndex): AssetIndexCard[] {
  return Array.isArray(source.cards) ? source.cards : [];
}

/** cardId → 缩略图 URL；取不到的卡片不出现在表里，列表端显示「无预览」占位。 */
const referenceThumbnails = ref<Record<string, string>>({});
let thumbnailJob = 0;
/** 每个卡片持有的 blob URL 释放句柄，切卡片/卸载时统一 release，避免只增不减。 */
let thumbnailReleases = new Map<string, () => void>();

function releaseThumbnails() {
  thumbnailReleases.forEach(release => release());
  thumbnailReleases = new Map();
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
            releases.forEach(release => release());
            return;
          }
          next[card.id] = url;
          break;
        }
      }
    } catch {
      // 画布未打开或节点缺失都只影响这一个缩略图，不打断其余卡片。
    }
    if (version !== thumbnailJob) return;
  }
  if (version !== thumbnailJob) return;
  releaseThumbnails();
  thumbnailReleases = releases;
  referenceThumbnails.value = next;
}

watch(indexCards, () => {
  void resolveReferenceThumbnails();
}, { deep: true });

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

async function runSave(): Promise<void> {
  if (!project.value) return;
  saving.value = true;
  let failed = false;
  try {
    const current = await props.getFiles().readJson<MtrackProject>(projectPath.value);
    const diskUpdatedAt = current?.updatedAt ?? "";
    const memoryUpdatedAt = lastSaved.value?.updatedAt ?? "";
    if (diskUpdatedAt !== memoryUpdatedAt) {
      conflictError.value = "文件已被其他操作修改，请重新加载";
      failed = true;
      return;
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
}

let inFlight: Promise<void> | undefined;

/** 保存入口：并发调用复用同一个在途 Promise，宿主 flushSave 等到写盘结束才返回，不丢保存请求。 */
function saveProject(): Promise<void> {
  if (!inFlight) {
    const task = runSave();
    inFlight = task;
    void task.then(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

/**
 * 选段语义（对齐桥契约 §1）：
 * - 单击 = 单选；
 * - Ctrl/⌘ 单击 = 追加或取消单个片段（离散多选）；
 * - Shift 单击 = 以当前单选为起点选到该片段（连续起止范围）。
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

/** 高级设置里的全片字段：只改 global 对象，保存走原有的整份快照写盘。 */
function onGlobalPatch(patch: Partial<MtrackProject["global"]>) {
  if (!project.value) return;
  project.value.global = { ...project.value.global, ...patch };
}

/** 全片比例：只接受 ratioOptions 里的值，写回 global.ratio，脏标记推进版本号后由既有防抖队列落盘。 */
function handleRatioChange(value: string) {
  if (!project.value || project.value.global.ratio === value) return;
  if (!(ratioOptions as readonly string[]).includes(value)) return;
  onGlobalPatch({ ratio: value });
}

/** 全片视频模型：写回 global.model，派工时作为 node:setConfig 的 providerId/modelId 下发。 */
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

/**
 * 合成成片：先 execute=false 拿段数出清单做二次确认，再 execute=true 真拼。
 * 失败文案一律用服务端原文（含 ffmpeg、规格不一致、V14 顺序断点等定位信息），只在「输出已存在」上补一句处置建议。
 */
async function handleComposite() {
  if (compositeBusy.value) return;
  if (!props.directory) return ElMessage.warning("当前没有工作目录，无法合成");
  compositeBusy.value = true;
  try {
    const preview = await postComposite(false);
    await ElMessageBox.confirm(`将合成 ${preview.segments.length} 段，输出到 ${preview.output}`, "合成成片", {
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
    else ElMessage.error(message);
  } finally {
    compositeBusy.value = false;
  }
}

function clipStatusLabel(status: MtrackClip["status"]): string {
  return clipStatusLabels[status];
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
 * 整理本镜提示词：POST /api/mtrack/rewriteShot，结果只进「待采用」区块，绝不自动覆盖画面描述。
 * 环境声与配乐原样保留（服务端只整理画面描述段，不改这两段）。
 * rules 留空时不传该字段，由服务端回落到内置规则；传了就把本次整理规则一并记进 basis 供一致性守卫比对。
 */
async function rewriteClipPrompt(rules: string) {
  const clip = selectedClip.value;
  if (!clip) return;
  if (!props.directory) return ElMessage.warning("当前没有工作目录，无法整理提示词");
  if (rewriteBusy.value) return;
  const model = firstTextModel();
  if (!model) {
    await loadTextModels(true);
    if (!firstTextModel()) return ElMessage.warning("尚未配置可用的文本模型，请先在设置中启用模型供应商");
  }
  const chosen = firstTextModel()!;
  // 请求发出这一刻的快照：正文、原文画面描述、时长与规则一起定格，之后用户再改就由一致性守卫拦下旧稿。
  const prompt = { ...clip.prompt };
  const trimmedRules = rules.trim();
  const basis: RewriteBasis = { text: prompt.integratedMultimodalDescription, seconds: clip.seconds, rules: trimmedRules };
  rewriteBusy.value = true;
  try {
    const response = await fetch("/api/mtrack/rewriteShot", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({
        directory: props.directory,
        providerId: chosen.providerId,
        modelId: chosen.modelId,
        prompt,
        referenceIds: clip.referenceIds,
        ...(trimmedRules ? { rules: trimmedRules } : {}),
      }),
    });
    const payload = await response.json().catch(() => undefined) as { data?: { text: string; requiresReview?: boolean }; message?: string } | undefined;
    if (!response.ok || !payload?.data) throw new Error(payload?.message || `整理请求失败（HTTP ${response.status}）`);
    const text = payload.data.text.trim();
    if (!text) throw new Error("模型没有返回整理结果，请重试");
    rewritePending.value = { clipId: clip.clipId, text, basis };
    ElMessage.success("已整理，请核对后采用");
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : "整理提示词失败");
  } finally {
    rewriteBusy.value = false;
  }
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

function onPatch(patch: Partial<MtrackClip>) {
  const index = selectedIndex.value;
  if (index < 0) return;
  const current = clips.value[index];
  clips.value[index] = { ...current, ...patch, prompt: { ...current.prompt, ...(patch.prompt ?? {}) } };
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
}

function removeClip() {
  const index = selectedIndex.value;
  if (!project.value || index < 0) return;
  const snapshot = cloneClips(clips.value);
  undoStack.value = [snapshot];
  project.value.clips.splice(index, 1);
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
/** 面板可见性由编辑器持有：关面板不中断生成，重开还能看到同一批。 */
const batchPanelVisible = ref(false);
/** 暂停是「本镜结束后停」的软闸门，与整批取消（abort）分开记账。 */
const batchPaused = ref(false);
let dispatchController: AbortController | undefined;
/** 当前在跑的直连派工句柄：暂停闸门与取消抢占都要用它，批次自然收尾时清空。 */
const batchHandle = shallowRef<{ abort(): void; pause(): void }>();
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
/** 只有待生成/失败的镜头默认参与派工；其余状态需勾选「包含已生成」才纳入。 */
const dispatchableClips = computed(() => selectedClips.value.filter(clip => includeFinished.value || clip.status === "pending" || clip.status === "failed"));
const skippedCount = computed(() => selectedClips.value.length - dispatchableClips.value.length);

/**
 * 派工选段校验：clipIds 缺省用 UI 选段；文案与三条本地校验逐字沿用原 generateSelection。
 * issue 非空即校验失败，调用方决定是提示（UI warning）还是抛出（命令式 API）。
 */
function pickDispatchTargets(clipIds?: string[], finishedOverride?: boolean): { clips: MtrackClip[]; skipped: number; issue: string } {
  const wanted = clipIds && clipIds.length
    ? clips.value.filter(clip => clipIds.includes(clip.clipId))
    : selectedClips.value;
  if (!wanted.length) return { clips: [], skipped: 0, issue: "请先在轨道上选择要生成的分镜" };
  const withFinished = finishedOverride ?? includeFinished.value;
  const targets = wanted.filter(clip => withFinished || clip.status === "pending" || clip.status === "failed");
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
function writeClipRun(clipId: string, patch: Partial<MtrackClip>, attempt?: { nodeId: string; status: string; error?: string }) {
  const clip = project.value?.clips.find(item => item.clipId === clipId);
  if (!clip) return;
  Object.assign(clip, patch);
  if (attempt) {
    clip.attempts.push({
      at: new Date().toISOString(),
      nodeId: attempt.nodeId || null,
      status: attempt.status,
      ...(attempt.error ? { error: attempt.error } : {}),
    });
  }
  // 生成期间 dirty 往往已经是 true，watch(dirty) 不会再触发；直接推进版本号让防抖写盘照常排上。
  dirtyVersion.value += 1;
}

/**
 * 发起直连派工（不等流）：本地校验或画布未就绪时抛错、不返回 batchId。
 * 拿到画布桥即返回 {batchId,skipped}，逐镜生成在后台经画布 nodeTools 推进，
 * 全程不经过对话模型——视频供应商只认画布节点这一条生成路径。
 * batchId 传入时沿用该批次（暂停后继续）：attempts 标记与面板行都靠它对齐。
 */
async function launchDispatch(clipIds?: string[], options?: { includeFinished?: boolean; batchId?: string }): Promise<{ batchId: string; skipped: number }> {
  if (dispatching.value || batchHandle.value) throw new Error("已有派工操作正在进行，请等待结束");
  const picked = pickDispatchTargets(clipIds, options?.includeFinished);
  if (picked.issue) throw new Error(picked.issue);
  dispatching.value = true;
  const controller = new AbortController();
  dispatchController = controller;
  dispatchKind = "generate";
  const batchId = options?.batchId || crypto.randomUUID();
  const marker = batchMarker(batchId);
  const batchClips = picked.clips;
  // 本次 run 是否真的因闸门停下：onPaused 只在这种情况被调用，用它决定收尾时要不要留暂停态。
  let pausedByGate = false;
  // 面板可能在取桥之前就被打开/暂停，先把批次号与镜单落到界面可见状态。
  batchClipIds.value = batchClips.map(clip => clip.clipId);
  activeBatchId.value = batchId;
  try {
    const bridge = await acquireBridge();
    if (!bridge) throw new Error("未取到画布上下文：请先打开画布并等待加载完成，再回到多轨界面发起生成");
    const handle = await beginDirectDispatch({
      bridge,
      batchId,
      clips: picked.clips,
      cards: indexCards.value,
      videoModel: project.value?.global.model,
      global: project.value?.global,
      signal: controller.signal,
      hooks: {
        onStart(clip, nodeId) {
          writeClipRun(clip.clipId, { status: "generating", nodeId }, { nodeId, status: "generating", error: marker });
        },
        onSucceeded(clip, nodeId, assetPath) {
          writeClipRun(clip.clipId, { status: "generated", nodeId, assetPath }, { nodeId, status: "succeeded", error: marker });
        },
        onFailed(clip, nodeId, error) {
          writeClipRun(clip.clipId, { status: "failed", ...(nodeId ? { nodeId } : {}) }, { nodeId, status: "failed", error: `${marker} ${error}` });
        },
        onPaused() {
          pausedByGate = true;
          // 最后一镜跑到一半才按暂停时闸门已置位，但镜单已全部收尾，属正常结束，不报暂停。
          const allDone = batchClips.every(clip => {
            const current = project.value?.clips.find(item => item.clipId === clip.clipId);
            return !current || current.status === "generated" || current.status === "accepted";
          });
          batchPaused.value = !allDone;
        },
      },
    });
    batchHandle.value = handle;
    // 新 run 一律从开闸开始：继承上一批残留的暂停态会让它一启动就撞闸门（onPaused → 剩余镜头一镜不发）。
    // 取桥窗口内不可能出现新的暂停请求（pauseBatch 要 batchHandle 才受理），所以这里直接开闸即可。
    batchPaused.value = false;
    handle.run.catch((reason: unknown) => {
      if (!controller.signal.aborted) ElMessage.error(reason instanceof Error ? reason.message : "生成失败");
      // 生成循环死亡即批次无人推进：清掉残留批次号，避免 UI 显示一个不会执行的批次（在途批次仍可从 attempts 找回）。
      if (activeBatchId.value === batchId) activeBatchId.value = "";
    }).finally(() => {
      // 批次收尾即软闸门失效，但只在「本次 run 确实被闸门停下」时才保留暂停态：
      // 无条件清会抹掉暂停态，继续生成按钮这就不出现了，用户没法接着跑剩下的镜。
      // 自然跑完（allDone）、取消（launchCancel）、新批次启动（catch 分支）三条路径各自复位，不依赖这里。
      if (batchHandle.value === handle) batchHandle.value = undefined;
      // 镜单必须和暂停态一起留下：闸门停下时还没开跑的镜头一条 attempts 都没有，清掉镜单它们就
      // 从面板里消失，「继续生成」会误判「剩余镜头已全部完成」而一镜都不发（暂停态的台账即续跑清单）。
      if (!pausedByGate && activeBatchId.value === batchId) batchClipIds.value = [];
      batchPaused.value = pausedByGate;
      finishDispatchRun(controller);
    });
    return { batchId, skipped: picked.skipped };
  } catch (reason) {
    if (activeBatchId.value === batchId) {
      activeBatchId.value = "";
      batchClipIds.value = [];
    }
    batchPaused.value = false;
    finishDispatchRun(controller);
    // abort 触发的收尾不弹提示（卸载/取消竞态），命令式调用方仍能拿到 silent 标记。
    if (controller.signal.aborted) throw Object.assign(new Error("派工已中止"), { silent: true });
    throw reason;
  }
}

/**
 * 发起批次取消（不等流）：batchId 缺省取消当前活动批次。在途生成直接 abort，
 * 再对批次内状态为 generating 的镜头逐个 node:cancelGeneration，并把它们回写 pending。
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
    const bridge = await acquireBridge();
    if (!bridge) throw new Error("未取到画布上下文：请先打开画布并等待加载完成");
    const marker = batchMarker(target);
    const running = clips.value.filter(clip => clip.status === "generating" && attemptsOfBatch(clip, target).length > 0);
    const handle = await beginDirectCancel({
      bridge,
      batchId: target,
      clips: running,
      signal: controller.signal,
      onCancelled(clip, nodeId) {
        writeClipRun(clip.clipId, { status: "pending" }, { nodeId, status: "cancelled", error: marker });
      },
    });
    handle.run.catch((reason: unknown) => {
      if (!controller.signal.aborted) ElMessage.error(reason instanceof Error ? reason.message : "取消批次失败");
    }).finally(() => finishDispatchRun(controller));
    activeBatchId.value = "";
    // 取消即批次终结：镜单一起清掉，否则「暂停 → 整批取消」后面板还会列着一批已不存在的镜头
    // （暂停态没有在途 run，不会有 finally 替它清）。
    batchClipIds.value = [];
    return { batchId: target };
  } catch (reason) {
    finishDispatchRun(controller);
    if (controller.signal.aborted) throw Object.assign(new Error("取消已中止"), { silent: true });
    throw reason;
  }
}

/**
 * 多轨编辑器可位于文档面板或画布节点弹窗内。画布面板非 active 时 `canvasHost.vue` 的
 * `getCanvasContext()` 不返回上下文；宿主为此提供了 `getAgentCanvasContext`（经
 * `provide("agentCanvas")`）。编辑器组件不随面板切换卸载时，生成循环继续在后台跑。
 * UI 入口：先弹本地校验 warning，再交给 launchDispatch 不等流，loading 跟 dispatching。
 */
async function generateSelection() {
  if (dispatching.value || batchHandle.value) return;
  const picked = pickDispatchTargets();
  if (picked.issue) return ElMessage.warning(picked.issue);
  try {
    const { batchId } = await launchDispatch();
    ElMessage.success(`批次 ${batchId.slice(0, 8)} 已开始生成，进度见轨道与右侧状态`);
  } catch (reason) {
    // 原 generateSelection 对 aborted 静默（卸载/取消竞态不弹错），silent 标记保持同一行为。
    if ((reason as { silent?: boolean })?.silent) return;
    ElMessage.error(reason instanceof Error ? reason.message : "发起生成失败");
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
    ElMessage.error(reason instanceof Error ? reason.message : "取消批次失败");
  }
}

/** 面板「开始生成」：范围由面板数字给出，镜数 -1 已在面板里换成到最后一镜。 */
async function startBatch(payload: { clips: string[]; includeFinished: boolean }) {
  if (!payload.clips.length) return ElMessage.warning("当前范围没有可生成的分镜");
  try {
    const { batchId, skipped } = await launchDispatch(payload.clips, { includeFinished: payload.includeFinished });
    ElMessage.success(`批次 ${batchId.slice(0, 8)} 已开始生成${skipped ? `，跳过 ${skipped} 段` : ""}；面板逐镜显示进度`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    ElMessage.error(reason instanceof Error ? reason.message : "发起生成失败");
  }
}

/**
 * 面板「本镜结束后暂停」：只置闸门，不中断正在跑的镜头（软暂停）；整批取消才走 abort。
 * ACT: 取桥相位（handle 还没建）里点的暂停由 launchDispatch 启动后补一次 handle.pause()。
 */
function pauseBatch() {
  if (!batchHandle.value || !activeBatchId.value) return ElMessage.warning("当前没有正在生成的批次");
  batchPaused.value = true;
  batchHandle.value.pause();
  ElMessage.info("已请求暂停：当前镜头生成结束后不再开始下一镜");
}

/** 面板「继续生成」：沿用同一批次号续跑剩余镜头，attempts 标记与面板行都不变。 */
async function resumeBatch(payload: { clips: string[]; includeFinished: boolean }) {
  if (dispatching.value || batchHandle.value) return ElMessage.warning("已有派工操作正在进行，请等待结束");
  if (!payload.clips.length) {
    batchPaused.value = false;
    return ElMessage.info("批次剩余镜头已全部完成");
  }
  // 先开闸再发起：等 launchDispatch 返回后才清，会把「刚点继续就点暂停」的请求一起抹掉。
  batchPaused.value = false;
  try {
    await launchDispatch(payload.clips, { batchId: activeBatchId.value, includeFinished: payload.includeFinished });
    ElMessage.success(`批次 ${activeBatchId.value.slice(0, 8)} 已继续生成`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    ElMessage.error(reason instanceof Error ? reason.message : "继续生成失败");
  }
}

/** 面板「单镜重试」：只派这一镜，且强制 includeFinished 覆盖已生成/失败的旧结果。 */
async function retryClip(payload: { clipId: string }) {
  if (dispatching.value || batchHandle.value) return ElMessage.warning("生成进行中，请先暂停或取消后重试单镜");
  try {
    const { batchId } = await launchDispatch([payload.clipId], { includeFinished: true });
    ElMessage.success(`已重试 ${payload.clipId}，批次 ${batchId.slice(0, 8)}`);
  } catch (reason) {
    if ((reason as { silent?: boolean })?.silent) return;
    ElMessage.error(reason instanceof Error ? reason.message : "单镜重试失败");
  }
}

/** 面板「刷新状态」：只读画布节点状态，把已结束的生成补写成终态，不改在跑批次。 */
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
  const stuck = clips.value.filter(clip => clip.status === "generating" && Boolean(clip.nodeId) && !inFlight.has(clip.clipId));
  if (!stuck.length) return empty;
  const bridge = await acquireBridge();
  if (!bridge) throwCanvasUnavailable(new Error("未取到画布上下文"));
  let checked = 0;
  let restored = 0;
  let failed = 0;
  for (const clip of stuck) {
    const nodeId = clip.nodeId!;
    const live = project.value.clips.find(item => item.clipId === clip.clipId);
    // 对账期间这一镜又被派工了（状态被改写）就跳过，绝不能覆盖在跑中的状态。
    if (!live || live.status !== "generating") continue;
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
  // 提示统一由调用方（面板按钮 / 打开编辑器）发出，这里只回报计数，避免一次对账弹两条。
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
  if (save) {
    clearTimeout(saveTimer);
    await saveProject();
    // ACT: applyClipOperations 置脏后，watch 的微任务回调会重新 arm 800ms 防抖；写完盘再清一次，避免重复整文件写。
    clearTimeout(saveTimer);
  }
  return { applied: true, issues: [], conflict: false, saved: save, updatedAt: project.value.updatedAt };
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
    if (!videoModelsLoaded) setTimeout(() => void loadVideoModels(true), 1500);
  });
  // 打开编辑器即对账一次：上一次会话中断后停在 generating 的镜头在这里补成终态。
  void reconcileGenerating().catch(() => {});
});

onBeforeUnmount(() => {
  // ACT: 直连生成随节点卸载中断（轮询停止），供应商侧任务留在画布节点上，重开画布可继续看状态。升级路径：宿主级派工注册表，把轮询提升到 workspace 层继续。
  dispatchController?.abort();
  // 卸载时补一次写盘：宿主没来得及调 flushSave 也不能丢掉已改的工程内容。
  clearTimeout(saveTimer);
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
});
</script>

<style scoped>
/* 整列一个滚动流（对齐 LSC）：轨道、派工、编辑主体一起滚，页头吸顶、底栏吸底。 */
.mtrackEditor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 画布卡片态可以窄到 480px，用它做容器查询的锚点，窄时给两栏降级。 */
  container-type: inline-size;
}

.editorHeader {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.headingMain {
  flex: 1;
  min-width: 0;
}

.editorTitle {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.editorSubtitle {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin: 5px 0 0;
  font-size: 12px;
}

.metric {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.meta {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.headerActions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 8px;
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

/* 对齐 LSC nh-workspace：左编辑区 + 右侧状态栏两栏 grid，右栏 230px 起。 */
.editorWorkspace {
  display: grid;
  grid-template-columns: 1.45fr 230px;
  /* 1 0 auto：内容少时撑满剩余高度让底栏贴底，内容多时按内容撑开、由整列滚动。 */
  flex: 1 0 auto;
  min-width: 0;
}

.editorMain {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.editorSide {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* statusPanel 自带 width:320px：双栏后列宽由 grid 决定，这里让它的根节点铺满自己那一列。
   多一层 .editorWorkspace 是为了压过 statusPanel 自身 scoped 样式的权重，不依赖样式注入顺序。 */
.editorWorkspace .editorSide :deep(.statusPanel) {
  width: auto;
  flex: 1;
}

/* 视口窄时回单栏；容器查询兜住画布卡片被拖到 480px 但视口依旧很宽的情况。 */
@media (max-width: 900px) {
  .editorWorkspace {
    grid-template-columns: 1fr;
  }

  .editorWorkspace .editorSide :deep(.statusPanel) {
    border-left: 0;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}

@container (max-width: 560px) {
  .editorWorkspace {
    grid-template-columns: 1fr;
  }

  .editorWorkspace .editorSide :deep(.statusPanel) {
    border-left: 0;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}

.editorHint {
  flex: 1;
  margin: 0;
  padding: 24px 16px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

/* 编辑主体下方的两个整行折叠区，形态对齐 LSC：生成结果是卡片式，高级设置是分隔线式。 */
.sectionResults {
  margin: 2px 16px 12px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-light);
}

.sectionAdvanced {
  margin: 0 16px 4px;
  padding: 12px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.sectionSummary {
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.sectionSummary::-webkit-details-marker {
  display: none;
}

.sectionAdvanced .sectionSummary {
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.resultList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  font-size: 12px;
  list-style: none;
}

.resultItem {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
}

.resultClip {
  flex: none;
}

.resultStatus {
  flex: none;
  color: var(--el-text-color-secondary);
}

.resultPath {
  color: var(--el-text-color-placeholder);
  overflow-wrap: anywhere;
}

.advancedGrid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0 0;
}

.advancedGrid .fieldColumn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.advancedGrid .fieldLabel {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.editorFooter {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  font-size: 12px;
}

.footerError {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 12px;
}

.footerBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.saveState {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.saveText {
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.saveDirty {
  color: var(--el-color-warning);
}

.footerActions {
  display: flex;
  flex: none;
  gap: 8px;
}

.dirtyStar {
  color: var(--el-color-warning);
  font-weight: 700;
}

.snapshotNotice {
  margin: 0;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}
</style>
