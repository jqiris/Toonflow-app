<template>
  <teleport v-if="targetEl" :to="targetEl">
    <section
      ref="frameRef"
      class="resultsOverlay nopan nozoom nodrag nowheel"
      aria-label="项目与成片"
      :style="frameStyle"
      @wheel.stop
      @dblclick.stop
      @contextmenu.stop>
      <header
        class="overlayHeader"
        tabindex="0"
        aria-label="拖动标题栏移动浮窗，或使用方向键"
        @pointerdown="startMove"
        @pointermove="dragMove"
        @pointerup="dragEnd"
        @pointercancel="dragEnd"
        @keydown="onMoveKeydown">
        <span class="overlayGrip" aria-hidden="true">⁝⁝</span>
        <div class="overlayHeading">
          <h2>项目与成片</h2>
          <p class="overlaySubtitle">{{ projectName || "未命名项目" }}</p>
        </div>
        <span class="overlayCount">{{ completedClips.length }} / {{ clips.length }} 镜头</span>
        <button type="button" class="headerButton" @click.stop="emit('focusEditor')">镜头编辑</button>
        <button type="button" class="headerButton" :aria-expanded="!geo.collapsed" @click.stop="toggleCollapsed">
          {{ geo.collapsed ? "展开" : "收起" }}
        </button>
      </header>

      <div v-show="!geo.collapsed" class="overlayBody">
        <p class="resultPolicy">
          结果保存方式：重新生成默认<b>追加版本</b>（保留历史，不在成片时间线上重复叠加）；
          要让成片改用另一条视频，在版本菜单「设为默认」即<b>替换展示</b>，同样不删除旧文件。
          勾选「用于合并」（＝验收，accepted）的镜头按工程顺序进入合成清单。
        </p>

        <!-- 校验发现：多轨编辑器里不再重复一块，改到这里（点编辑器工具栏「校验」重新读取）。 -->
        <details class="findingsSection" :open="findingsOpen" @toggle="onFindingsToggle">
          <summary class="findingsSummary">校验发现{{ findingsCount ? ` ${findingsCount}` : "" }}</summary>
          <findingsPanel
            :report="report"
            :readError="readError"
            :resolveClipId="resolveFindingClipId"
            @locate="emit('locateFinding', $event)" />
        </details>

        <template v-if="previewClip">
          <video
            v-if="previewUrl"
            ref="videoRef"
            class="resultPreview"
            controls
            playsinline
            preload="metadata"
            :src="previewUrl"
            @play="clearPlayHint"
            @ended="onPreviewEnded"
            @error="onPreviewError" />
          <p v-else class="previewHint">{{ previewError || "该镜头暂无可预览的视频。" }}</p>
          <div class="playbackBar">
            <button type="button" class="headerButton" :disabled="!prevClip" @click="stepPreview(-1)">上一段</button>
            <label class="clipPick">选择预览片段
              <select v-model="pickedClipId" @change="onPickClip">
                <option v-for="(clip, index) in completedClips" :key="clip.clipId" :value="clip.clipId">
                  {{ index + 1 }} · {{ clip.title || "未命名" }}
                </option>
              </select>
            </label>
            <button type="button" class="headerButton" :disabled="!nextClip" @click="stepPreview(1)">下一段</button>
            <label class="autoplayToggle">
              <input type="checkbox" v-model="continuousPlay" />
              顺序连播已完成片段
            </label>
            <a v-if="previewUrl" class="headerButton openLink" :href="previewUrl" target="_blank" rel="noopener">打开视频</a>
            <span class="playbackPosition" role="status">{{ playbackPosition }}</span>
          </div>
          <versionMenu
            class="previewMenu"
            :label="`选择视频版本 · ${previewVersions.length} 个`"
            :versions="previewVersions"
            :stale="states?.[previewClip.clipId]?.stale ?? false"
            @watch="selectPreviewNode"
            @setDefault="version => previewClip && emit('setDefaultVersion', previewClip.clipId, version)"
            @deleteVersion="version => previewClip && emit('deleteVersion', previewClip.clipId, version)"
            @deleteAllVersions="previewClip && emit('deleteAllVersions', previewClip.clipId)" />
        </template>
        <p v-else class="previewHint">完成的视频将在这里预览，按镜头管理版本。</p>

        <div v-if="completedClips.length" class="completedGrid">
          <versionMenu
            v-for="(clip, index) in completedClips"
            :key="clip.clipId"
            :label="completedClipLabel(index, clip)"
            :versions="versionsOf(clip)"
            :stale="states?.[clip.clipId]?.stale ?? false"
            :mergeable="clip.status === 'generated' || clip.status === 'accepted'"
            :accepted="clip.status === 'accepted'"
            :disabled="clip.status === 'generating'"
            @watch="version => requestPreview(clip, version)"
            @setDefault="version => emit('setDefaultVersion', clip.clipId, version)"
            @deleteVersion="version => emit('deleteVersion', clip.clipId, version)"
            @deleteAllVersions="emit('deleteAllVersions', clip.clipId)"
            @toggleAccept="emit('toggleAccept', clip.clipId)" />
        </div>
      </div>

      <div
        v-show="!geo.collapsed"
        class="resizeHandle"
        title="拖拽调整大小"
        aria-label="拖拽或使用方向键调整大小"
        tabindex="0"
        @pointerdown.stop.prevent="startResize"
        @pointermove="dragMove"
        @pointerup="dragEnd"
        @pointercancel="dragEnd"
        @keydown="onResizeKeydown">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M8 12l4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
      </div>
    </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { MtrackClip, ClipState, AssetFinding, AssetReport } from "../mtrackProject";
import { clipStatusLabels, clipVersions } from "../mtrackProject";
import type { ResultsUiGeometry } from "../mtrackProject";
import { defaultResultsUi, normalizeResultsUi, resultsUiShownHeight, resultsUiMinWidth, resultsUiMaxWidth, resultsUiMinHeight, resultsUiMaxHeight } from "../mtrackProject";
import versionMenu from "./versionMenu.vue";
import type { VersionMenuItem } from "./versionMenu.vue";
import findingsPanel from "./findingsPanel.vue";

const props = defineProps<{
  clips: MtrackClip[];
  projectName?: string;
  /** 工作台当前选中镜：变化时大预览跟到该镜（双向联动的工作台→浮窗方向）。 */
  selectedClipId?: string;
  /** 产物路径 → 可播放 url（宿主传 EditorFiles.acquireUrl，同一口径）。 */
  acquireUrl: (path: string, mimeType?: string) => { url: Promise<string>; release(): void };
  /** 旧工程的历史版本只有画布 nodeId（没有产物路径），经画布桥反查；不传时预览这类版本给出说明。 */
  acquireNodeVideo?: (nodeId: string) => Promise<string>;
  /** 初始几何（宿主读 node.data.resultsUi 归一后传入；缺省按锚点缺省摆放）。 */
  geometry?: ResultsUiGeometry;
  /** 浮窗宿主解析：宿主传画布容器 closest 查询；缺省查文档里第一个变换层。 */
  resolveTarget?: () => Element | null;
  /** 每镜状态（clipId → ClipState），含 stale 标记；由编辑器传入。 */
  states?: Record<string, ClipState>;
  /** 校验报告（plan/assetReport.json）：原在多轨编辑器里单开一块，现收进本浮窗。 */
  report?: AssetReport;
  /** 校验报告读取失败的原因，原样展示。 */
  readError?: string;
}>();

const emit = defineEmits<{
  (event: "geometry", ui: ResultsUiGeometry): void;
  (event: "focusEditor"): void;
  (event: "setDefaultVersion", clipId: string, version: string): void;
  (event: "toggleAccept", clipId: string): void;
  /** 大预览换镜（浮窗→工作台方向）；prop 同步触发的换预览不会再发回来，不构成回环。 */
  (event: "previewSelect", clipId: string): void;
  (event: "deleteVersion", clipId: string, version: string): void;
  (event: "deleteAllVersions", clipId: string): void;
  /** 校验发现的「定位」：把工作台选中镜切到该 finding 对应的镜头（浮窗→工作台方向）。 */
  (event: "locateFinding", clipId: string): void;
}>();

const targetEl = shallowRef<Element>();
const frameRef = ref<HTMLElement>();
let targetWarned = false;

const findingsCount = computed(() => props.report?.findings?.length ?? 0);

/** 校验发现 details 的展开状态：宿主点「查看成片」时若有发现项会自动摊开（见 expand）。 */
const findingsOpen = ref(false);

/** finding.ref 可能是片段 clipId，也可能是资产卡 id（V1/V2/V4/V9 那类卡级问题）；只有命中镜头才能定位。 */
function resolveFindingClipId(finding: AssetFinding): string {
  const ref = finding.ref ?? "";
  return props.clips.some(clip => clip.clipId === ref) ? ref : "";
}

function onFindingsToggle(event: Event) {
  findingsOpen.value = (event.target as HTMLDetailsElement).open;
}

/**
 * 宿主「查看成片」在收起态下调用：先展开浮窗（收起态只剩 70px 标题条，setCenter 之后看不到内容），
 * 有发现项时把「校验发现」一并摊开，否则用户还得自己找。
 */
function expand() {
  if (geo.value.collapsed) toggleCollapsed();
  if (findingsCount.value) findingsOpen.value = true;
}

defineExpose({ expand });

/** ACT: 独立编辑器形态下画布可能晚于本组件挂载；每秒重试一次，找到即停，不常驻定时器。 */
let locateTimer: ReturnType<typeof setInterval> | undefined;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** ACT: 模板属性里不写内嵌双引号，统一在这里拼标签，避免 SFC 解析报错。 */
function completedClipLabel(index: number, clip: { title?: string }) {
  return `${String(index + 1).padStart(2, "0")} · ${clip.title || "未命名"}`;
}

function locateTarget() {
  const next = props.resolveTarget?.() ?? document.querySelector(".vue-flow__transformationpane");
  targetEl.value = next ?? undefined;
  if (next && locateTimer) {
    clearInterval(locateTimer);
    locateTimer = undefined;
  }
  if (!next && !targetWarned) {
    targetWarned = true;
    console.warn("[resultsOverlay] 未找到画布变换层（.vue-flow__transformationpane），项目与成片浮窗不渲染；画布打开后自动恢复。");
  }
}

onMounted(() => {
  locateTarget();
  if (!targetEl.value) locateTimer = setInterval(locateTarget, 1000);
});
watch(() => props.resolveTarget, locateTarget);

/** 浮窗真正渲染出来（teleport 目标就绪）后，再确认标题栏没被画布外的固定面板盖住。 */
watch(targetEl, async (el) => {
  if (!el) return;
  await nextTick();
  observeVisibility();
  await ensureHeaderReachable();
});

/**
 * ACT: 浮窗挂载时往往还在视口外（世界坐标离原点很远），此时命中探测拿不到元素、也谈不上被盖住；
 * 等画布缩放/平移到它露头时再探一次，避免「挪进视野立刻又被右侧对话框吃掉」。
 */
let visibilityObserver: IntersectionObserver | undefined;
let reachabilityRunning = false;

function observeVisibility() {
  const frame = frameRef.value;
  if (!frame || visibilityObserver) return;
  visibilityObserver = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) void checkReachableLater();
  });
  visibilityObserver.observe(frame);
}

async function checkReachableLater() {
  if (reachabilityRunning) return;
  reachabilityRunning = true;
  try {
    await ensureHeaderReachable();
  } finally {
    reachabilityRunning = false;
  }
}

/** 几何真源在本地：宿主只在本浮窗生命周期起点给初值，变化经 geometry 事件写回 node.data。 */
const geo = ref<ResultsUiGeometry>(props.geometry
  ? normalizeResultsUi(props.geometry, { x: 0, y: 0, width: 0 })
  : defaultResultsUi({ x: 0, y: 0, width: 0 }));

const frameStyle = computed(() => ({
  left: `${geo.value.x}px`,
  top: `${geo.value.y}px`,
  width: `${geo.value.width}px`,
  height: `${resultsUiShownHeight(geo.value)}px`,
}));

/** 写回前整值归一（宽高夹取），宿主拿到的永远是可落盘的干净几何。 */
function emitGeometry() {
  emit("geometry", normalizeResultsUi(geo.value, { x: geo.value.x, y: geo.value.y, width: 0 }));
}

/** 位移换算：画布缩放后指针像素 ≠ 世界像素，按浮窗自身 rect/offsetWidth 反推缩放系数（同 LSC）。 */
function scaleOf() {
  const frame = frameRef.value;
  if (!frame || !frame.offsetWidth) return 1;
  return frame.getBoundingClientRect().width / frame.offsetWidth || 1;
}

/** 标题栏中心能不能点到自己：画布外的固定面板（右侧 agent 对话框）盖上来时命中会落到别人身上。 */
function headerReachable() {
  const frame = frameRef.value;
  const header = frame?.querySelector<HTMLElement>(".overlayHeader");
  if (!frame || !header) return true;
  const rect = header.getBoundingClientRect();
  const pointX = rect.left + rect.width / 2;
  const pointY = rect.top + rect.height / 2;
  // 标题栏还在视口外时命中探测没有意义（半露头时也不该据此挪窗），等它真正进视野再判。
  if (pointX < 0 || pointY < 0 || pointX > window.innerWidth || pointY > window.innerHeight) return true;
  const hit = document.elementFromPoint(pointX, pointY);
  return !hit || frame.contains(hit);
}

/**
 * ACT: 浮窗在画布世界层，默认摆在节点右侧，正好落在右侧固定对话框下面时标题栏被整块盖住，
 * 用户既拖不动也点不到播放。挂载后做一次命中探测，被盖住就按半窗宽往左挪，直到标题栏能抓；
 * 只做水平挪动并照常落盘，挪不动（退到世界 x=0 仍被盖）就停在 0 不再折腾。
 */
async function ensureHeaderReachable() {
  const frame = frameRef.value;
  if (!frame || headerReachable()) return;
  // ACT: 步长按屏幕像素折回世界坐标——浮窗被缩小到 0.2 倍时，世界步长要放大 5 倍才真的挪开半窗；
  // 旧实现乘了缩放系数，低倍率下步子只有 20 多像素，16 步也挪不出右侧固定面板。
  const scale = scaleOf() || 1;
  const worldStep = Math.max(120, frame.getBoundingClientRect().width / 2) / scale;
  for (let step = 1; step <= 16; step += 1) {
    const nextX = geo.value.x - worldStep;
    if (nextX < 0) break;
    geo.value = { ...geo.value, x: nextX };
    await nextTick();
    if (headerReachable()) {
      emitGeometry();
      return;
    }
  }
  if (geo.value.x > 0) {
    geo.value = { ...geo.value, x: 0 };
    await nextTick();
    emitGeometry();
  }
}

interface DragState {
  kind: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  origin: ResultsUiGeometry;
}

const drag = shallowRef<DragState>();

function beginDrag(kind: DragState["kind"], event: PointerEvent) {
  if (event.button !== 0 || drag.value) return;
  if (kind === "move" && (event.target as HTMLElement).closest("button,input,select,a")) return;
  const handle = event.currentTarget as HTMLElement;
  drag.value = { kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { ...geo.value } };
  handle.setPointerCapture(event.pointerId);
}

function dragMove(event: PointerEvent) {
  const state = drag.value;
  if (!state || event.pointerId !== state.pointerId) return;
  const dx = (event.clientX - state.startX) / scaleOf();
  const dy = (event.clientY - state.startY) / scaleOf();
  if (state.kind === "move") {
    geo.value = { ...geo.value, x: state.origin.x + dx, y: state.origin.y + dy };
  } else {
    // ACT: 拖动中实时夹取，越过上下限时贴边不动；换算后的几何与落盘值始终一致。
    geo.value = { ...geo.value, width: clamp(state.origin.width + dx, resultsUiMinWidth, resultsUiMaxWidth), height: clamp(state.origin.height + dy, resultsUiMinHeight, resultsUiMaxHeight) };
  }
}

function dragEnd(event?: PointerEvent) {
  const state = drag.value;
  if (!state || (event && event.pointerId !== state.pointerId)) return;
  drag.value = undefined;
  emitGeometry();
}

function startMove(event: PointerEvent) {
  beginDrag("move", event);
}

function startResize(event: PointerEvent) {
  beginDrag("resize", event);
}

function nudge(event: KeyboardEvent, kind: "move" | "resize") {
  if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const amount = event.shiftKey ? 50 : 10;
  const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
  const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
  if (kind === "resize") {
    geo.value = {
      ...geo.value,
      width: clamp(geo.value.width + dx, resultsUiMinWidth, resultsUiMaxWidth),
      height: clamp(geo.value.height + dy, resultsUiMinHeight, resultsUiMaxHeight),
    };
  } else {
    geo.value = { ...geo.value, x: geo.value.x + dx, y: geo.value.y + dy };
  }
  emitGeometry();
}

function onMoveKeydown(event: KeyboardEvent) {
  nudge(event, "move");
}

function onResizeKeydown(event: KeyboardEvent) {
  nudge(event, "resize");
}

function toggleCollapsed() {
  geo.value = { ...geo.value, collapsed: !geo.value.collapsed };
  emitGeometry();
}

onBeforeUnmount(() => {
  if (locateTimer) clearInterval(locateTimer);
  visibilityObserver?.disconnect();
  visibilityObserver = undefined;
  drag.value = undefined;
  releasePreview?.();
});

/** 「有结果」= 有默认版本节点或产物路径，与 LSC resultPlaylist 的 row.result?.url 同口径。 */
const completedClips = computed(() => props.clips.filter(clip => Boolean(clip.nodeId || clip.assetPath)));

/** 版本列表：attempts 去重旧→新，当前默认（clip.assetPath）排在最后（同 statusPanel）。 */
function versionsOf(clip: MtrackClip | undefined): VersionMenuItem[] {
  if (!clip) return [];
  const current = clip.assetPath ?? "";
  const watchingClip = clip.clipId === previewClipId.value;
  return clipVersions(clip).map((version, index) => ({
    key: version.key,
    number: index + 1,
    isDefault: version.key === current,
    watching: watchingClip && version.key === previewVersion.value,
  }));
}

const previewClipId = ref("");
const previewVersion = ref("");
const previewClip = computed(() => completedClips.value.find(clip => clip.clipId === previewClipId.value));
const previewVersions = computed(() => versionsOf(previewClip.value));
const previewIndex = computed(() => completedClips.value.findIndex(clip => clip.clipId === previewClipId.value));
const prevClip = computed(() => completedClips.value[previewIndex.value - 1]);
const nextClip = computed(() => completedClips.value[previewIndex.value + 1]);
const pickedClipId = ref("");

/** 连播播放对象：URL 落地后自动播；用户手动暂停不会触发 ended，连播自然中断。 */
const videoRef = ref<HTMLVideoElement>();
/** 顺序连播已完成片段：默认开启（同 LSC），关闭后当前片段播完就停。 */
const continuousPlay = ref(true);
const playHint = ref("");

/** 当前在连播序列中的位置：提示优先，否则显示序号与标题（同 LSC data-result-position）。 */
const playbackPosition = computed(() => {
  if (playHint.value) return playHint.value;
  if (!previewClip.value) return "";
  return `${previewIndex.value + 1} / ${completedClips.value.length} · ${previewClip.value.title || "未命名"}`;
});

function clearPlayHint() {
  playHint.value = "";
}

watch(completedClips, list => {
  if (!list.some(clip => clip.clipId === previewClipId.value)) {
    const first = list[0];
    previewClipId.value = first?.clipId ?? "";
    previewVersion.value = first?.assetPath ?? "";
  }
}, { immediate: true });

watch(previewClipId, value => {
  pickedClipId.value = value;
});

function setPreview(clip: MtrackClip, version: string, fromUser = false) {
  previewClipId.value = clip.clipId;
  previewVersion.value = version || clip.assetPath || "";
  // 双向联动：用户在浮窗里换预览片段 → 工作台选中同一镜。prop 同步方向不走这里，不会成环。
  if (fromUser) emit("previewSelect", clip.clipId);
}

/**
 * 用户主动换片段：记一票播放意图，等 previewUrl 落地后自动播（同 LSC previewResult 的 play 分支）。
 * 工作台→浮窗同步与初始修位走 setPreview 本体，不加票——那是被动跟随，此时自动播会被浏览器拦。
 */
function requestPreview(clip: MtrackClip, version: string) {
  playTicket += 1;
  setPreview(clip, version, true);
}

/** 工作台 → 浮窗：选中镜有成片时大预览跟过去；无成片的镜不打扰当前预览。 */
watch(() => props.selectedClipId, clipId => {
  if (!clipId) return;
  const clip = completedClips.value.find(item => item.clipId === clipId);
  if (clip && clip.clipId !== previewClipId.value) setPreview(clip, clip.assetPath ?? "");
});

function onPickClip() {
  const clip = completedClips.value.find(item => item.clipId === pickedClipId.value);
  if (clip) requestPreview(clip, clip.assetPath ?? "");
}

function stepPreview(delta: number) {
  const target = delta < 0 ? prevClip.value : nextClip.value;
  if (target) requestPreview(target, target.assetPath ?? "");
}

function selectPreviewNode(version: string) {
  if (previewClip.value) requestPreview(previewClip.value, version);
}

/** 连播推进：当前片段播完且开了连播 → 换到下一段并自动播；末段播完就停。 */
function onPreviewEnded() {
  if (!continuousPlay.value) return;
  const target = nextClip.value;
  if (!target) return;
  requestPreview(target, target.assetPath ?? "");
}

const previewUrl = ref("");
const previewError = ref("");
let releasePreview: (() => void) | undefined;
let previewJob = 0;
/** 播放意图票号：换片段与连播推进各 +1，URL 落地后只有最新一票真正去播（对齐 previewJob 的丢过期口径）。 */
let playTicket = 0;

/**
 * 预览取址与 statusPanel 同法：版本条目自带产物路径时直接取文件，旧工程的 nodeId 条目经画布桥反查；
 * 快速换版本会跨 await 重入，用 previewJob 丢弃过期结果。
 */
watch([previewClip, previewVersion], async ([clip, version]) => {
  const job = ++previewJob;
  releasePreview?.();
  releasePreview = undefined;
  previewUrl.value = "";
  previewError.value = "";
  if (!clip) return;
  const entry = clipVersions(clip).find(item => item.key === version);
  let path = entry?.assetPath ?? "";
  if (!entry && clip.assetPath) {
    // 版本被删除后 previewVersion 指向不存在的条目：回落到当前默认版本。
    previewVersion.value = clip.assetPath;
    return;
  }
  if (!path && entry?.nodeId) {
    if (!props.acquireNodeVideo) {
      previewError.value = "当前界面无法读取历史版本产物";
      return;
    }
    try {
      path = await props.acquireNodeVideo(entry.nodeId);
    } catch (reason) {
      if (job === previewJob) previewError.value = reason instanceof Error ? reason.message : String(reason);
      return;
    }
    if (job !== previewJob) return;
    if (!path) {
      previewError.value = "该版本节点上没有视频产物";
      return;
    }
  }
  if (!path) {
    previewError.value = `${clip.clipId}（${clipStatusLabels[clip.status]}）尚无产物文件`;
    return;
  }
  const shared = props.acquireUrl(path, "video/mp4");
  releasePreview = shared.release;
  try {
    const url = await shared.url;
    if (job === previewJob) previewUrl.value = url;
  } catch (reason) {
    if (job === previewJob) previewError.value = reason instanceof Error ? reason.message : String(reason);
  }
}, { immediate: true });

/** URL 落地后按票号自动播；换源/卸载打断产生的 AbortError 属正常结果，不提示。 */
async function playPreview() {
  if (!playTicket) return;
  const video = videoRef.value;
  if (!video) return;
  try {
    await video.play();
    clearPlayHint();
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") return;
    playHint.value = "浏览器暂停了自动播放，点击视频播放键继续。";
  }
}

watch(previewUrl, async (url) => {
  if (!url || !playTicket) return;
  const ticket = playTicket;
  await nextTick();
  if (ticket !== playTicket) return;
  void playPreview();
}, { immediate: true });

function onPreviewError(event: Event) {
  const code = (event.target as HTMLVideoElement | null)?.error?.code;
  previewError.value = code ? `视频加载失败（code ${code}）` : "视频加载失败";
}
</script>

<style scoped>
.resultsOverlay {
  position: absolute;
  z-index: 8;
  /* ACT: 浮窗挂在 .vue-flow__transformationpane 里，该层是 pointer-events: none，
     不显式打开的话整块浮窗收不到鼠标事件——拖不动、按钮点不了、视频控件也点不了。 */
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color, #383c3b);
  border-radius: 12px;
  background: var(--el-bg-color, #1a1d1c);
  color: var(--el-text-color-primary, #e6e6e6);
  box-shadow: 0 18px 48px rgb(0 0 0 / 45%);
  overflow: hidden;
}

.overlayHeader {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 70px;
  padding: 0 16px;
  border-bottom: 1px solid var(--el-border-color-lighter, #2c302f);
  background: var(--el-fill-color-light, #202322);
  cursor: grab;
  outline: none;
}

.overlayHeader:focus-visible {
  box-shadow: inset 0 0 0 2px var(--el-color-primary, #409eff);
}

.overlayGrip {
  color: var(--el-text-color-secondary, #7a8280);
  font-size: 14px;
  letter-spacing: 2px;
  user-select: none;
}

.overlayHeading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.overlayHeading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.overlaySubtitle {
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlayCount {
  margin-left: auto;
  flex: none;
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.headerButton {
  padding: 5px 10px;
  border: 1px solid var(--el-border-color, #383c3b);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.headerButton:hover:not(:disabled) {
  color: var(--el-color-primary, #409eff);
  border-color: var(--el-color-primary, #409eff);
}

.headerButton:disabled {
  opacity: 0.45;
  cursor: default;
}

.openLink {
  text-decoration: none;
}

.overlayBody {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 14px 16px 18px;
  overflow: auto;
}

.resultPolicy {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-fill-color-light, #202322);
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 11px;
  line-height: 1.7;
}

.resultPreview {
  width: 100%;
  border-radius: 8px;
  background: #000;
}

.previewHint {
  margin: 0;
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 12px;
}

.playbackBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.clipPick {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 200px;
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 12px;
}

.clipPick select {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--el-border-color, #383c3b);
  border-radius: 6px;
  background: var(--el-bg-color, #202322);
  color: inherit;
  font-size: 12px;
}

.autoplayToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 12px;
  white-space: nowrap;
}

.playbackPosition {
  margin-left: auto;
  color: var(--el-text-color-secondary, #9aa5a1);
  font-size: 12px;
  text-align: right;
}

.previewMenu :deep(.versionMenu) {
  width: min(420px, 100%);
}

.completedGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  align-items: start;
}

.resizeHandle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--el-text-color-secondary, #7a8280);
  cursor: nwse-resize;
  outline: none;
}

.resizeHandle:hover,
.resizeHandle:focus-visible {
  color: var(--el-color-primary, #409eff);
}

/* 校验发现：折叠区，收在结果策略说明下面。 */
.findingsSection {
  margin-top: 8px;
  padding: 6px 10px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.findingsSummary {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  list-style: none;
}
.findingsSummary::-webkit-details-marker {
  display: none;
}
.findingsSummary::before {
  content: "▸";
  display: inline-block;
  margin-right: 4px;
  transition: transform 0.15s;
}
.findingsSection[open] > .findingsSummary::before {
  transform: rotate(90deg);
}
</style>
