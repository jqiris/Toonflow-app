<template>
  <el-dialog
    v-model="visible"
    class="batchDialog"
    title="批量生成"
    width="680px"
    appendToBody
    :closeOnClickModal="false"
  >
    <div class="batchBody">
      <p class="batchNote">
        按「起始分镜 + 生成镜数」逐镜串行生成（镜数 -1 = 生成到最后一镜）。生成期间当前镜头跑完才停，暂停不产生半截视频。
      </p>
      <div class="batchRange">
        <span class="rangeField">
          <span class="fieldLabel">起始分镜</span>
          <el-input-number v-model="startIndex" :min="1" :max="clips.length || 1" :step="1" size="small" />
        </span>
        <span class="rangeField">
          <span class="fieldLabel">生成镜数</span>
          <el-input-number v-model="shotCount" :min="-1" :max="clips.length || 1" :step="1" size="small" />
        </span>
        <span class="rangePresets">
          <el-button size="small" text @click="presetAll">全片</el-button>
          <el-button size="small" text @click="presetSelection">当前选段</el-button>
          <el-button size="small" text @click="presetToEnd">从起始镜到最后一镜</el-button>
        </span>
        <span class="rangeCheck">
          <el-checkbox v-model="includeFinished" size="small">包含已生成</el-checkbox>
        </span>
      </div>
      <p class="rangeText">{{ rangeText }}</p>

      <div class="batchActions">
        <el-button v-if="!batchRunning && !batchPaused" size="small" type="primary" :disabled="!clips.length" @click="emit('start', { clips: rangeClips, includeFinished })">开始生成</el-button>
        <el-button v-if="batchRunning" size="small" @click="emit('pause')">本镜结束后暂停</el-button>
        <el-button v-if="!batchRunning && batchPaused" size="small" type="primary" @click="emit('resume', { clips: pendingClips, includeFinished })">继续生成</el-button>
        <el-button v-if="batchId" size="small" text @click="emit('cancel')">整批取消</el-button>
        <span class="batchSpace" />
        <el-button size="small" text @click="emit('reconcile')">刷新状态</el-button>
      </div>

      <div class="batchProgress">
        <el-progress :percentage="percent" :strokeWidth="10" :showText="false" />
        <p class="progressText" aria-live="polite">{{ progressText }}</p>
      </div>

      <el-table :data="rows" size="small" class="batchTable" maxHeight="280">
        <el-table-column prop="index" label="镜号" width="72" />
        <el-table-column prop="title" label="标题" minWidth="130" showOverflowTooltip />
        <el-table-column prop="statusLabel" label="状态" width="90" />
        <el-table-column prop="elapsed" label="耗时" width="86" />
        <el-table-column prop="error" label="错误" minWidth="150" showOverflowTooltip />
        <el-table-column label="操作" width="96">
          <template #default="scope">
            <el-button size="small" text :disabled="batchRunning || batchPaused" @click="emit('retry', { clipId: scope.row.clipId })">重试</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="!rows.length" class="batchEmpty">尚未开始批量生成。</p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElCheckbox, ElDialog, ElInputNumber, ElProgress, ElTable, ElTableColumn } from "element-plus";
import type { MtrackClip } from "../mtrackProject";
import { clipStatusLabels, hasPrompt } from "../mtrackProject";
import { attemptsOfBatch } from "../batchMark";

const props = defineProps<{
  clips: MtrackClip[];
  batchId: string;
  batchClipIds: string[];
  batchPaused: boolean;
  batchRunning: boolean;
  selectedIds: string[];
}>();

const emit = defineEmits<{
  (event: "start", payload: { clips: string[]; includeFinished: boolean }): void;
  (event: "pause"): void;
  (event: "resume", payload: { clips: string[]; includeFinished: boolean }): void;
  (event: "retry", payload: { clipId: string }): void;
  (event: "cancel"): void;
  (event: "reconcile"): void;
}>();

const visible = defineModel<boolean>({ default: false });
const includeFinished = defineModel<boolean>("includeFinished", { default: false });

const startIndex = ref(1);
const shotCount = ref(-1);
/** ACT: watch(batchClipIds) 只在数组引用变时触发，批量打点期间渲染耗时不变；生成期间每秒推进一次时钟即可。 */
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;

watch(() => props.batchRunning, running => {
  clearInterval(tick);
  tick = undefined;
  if (!running) return;
  now.value = Date.now();
  tick = setInterval(() => {
    now.value = Date.now();
  }, 1000);
}, { immediate: true });

// ACT: 组件卸载时批处理可能还在跑，interval 不跟着 props 停，必须显式清掉（否则离开画布后每秒空转一次）。
onBeforeUnmount(() => {
  clearInterval(tick);
  tick = undefined;
});

// 打开面板时用当前选段预填一次；之后面板数字是唯一真源，轨道改选不再覆盖。
watch(visible, shown => {
  if (!shown) return;
  prefill();
});

function prefill() {
  const first = props.selectedIds.length ? props.clips.findIndex(clip => clip.clipId === props.selectedIds[0]) : 0;
  startIndex.value = Math.max(1, first + 1);
  shotCount.value = props.selectedIds.length || -1;
}

function clampRange() {
  const total = props.clips.length;
  startIndex.value = Math.min(Math.max(1, Math.round(startIndex.value || 1)), Math.max(1, total));
  const max = Math.max(1, total - startIndex.value + 1);
  shotCount.value = shotCount.value < 0 ? -1 : Math.min(Math.max(1, Math.round(shotCount.value || 1)), max);
}

watch([startIndex, shotCount], clampRange);

function presetAll() {
  startIndex.value = 1;
  shotCount.value = -1;
}

function presetSelection() {
  prefill();
}

function presetToEnd() {
  shotCount.value = -1;
}

const rangeClips = computed(() => {
  const total = props.clips.length;
  const from = Math.min(Math.max(1, startIndex.value), Math.max(1, total));
  const count = shotCount.value < 0 ? total - from + 1 : Math.max(1, shotCount.value);
  return props.clips.slice(from - 1, Math.min(from - 1 + count, total)).map(clip => clip.clipId);
});

const rangeText = computed(() => {
  const total = props.clips.length;
  if (!total) return "工程里还没有镜头。";
  if (!rangeClips.value.length) return "当前范围没有镜头，请调整起始分镜。";
  const last = props.clips.findIndex(clip => clip.clipId === rangeClips.value[rangeClips.value.length - 1]) + 1;
  // 只校验范围内提示词：无提示词的镜头会被生成内核拒绝（mediaDispatch.composeClipRequest 抛「没有提示词」），提前提示避免跑到一半才发现。
  const noPrompt = rangeClips.value.map(clipId => props.clips.find(clip => clip.clipId === clipId)).filter(clip => clip && !hasPrompt(clip));
  const base = shotCount.value < 0
    ? `本批 ${rangeClips.value.length} 镜：第 ${startIndex.value} 镜 → 最后一镜（第 ${last} 镜）`
    : `本批 ${rangeClips.value.length} 镜：第 ${startIndex.value} 镜起，共 ${shotCount.value} 镜`;
  return noPrompt.length ? `${base} · ${noPrompt.length} 镜缺提示词（${noPrompt.slice(0, 5).map(clip => clip!.clipId).join("、")}${noPrompt.length > 5 ? " 等" : ""}）` : base;
});

/** 逐镜行数据全部从 clips / attempts 派生，不新建状态容器；顺序按工程镜头顺序。 */
const rows = computed(() => {
  const batchIds = new Set(props.batchClipIds);
  return props.clips
    .map((clip, index) => ({ clip, index: index + 1 }))
    .filter((row) => batchIds.has(row.clip.clipId) || attemptsOfBatch(row.clip, props.batchId).length > 0)
    .map((row) => toRow(row.clip, row.index));
});

function toRow(clip: MtrackClip, index: number) {
  const attempts = attemptsOfBatch(clip, props.batchId);
  return {
    clipId: clip.clipId,
    index: String(index).padStart(2, "0"),
    title: clip.title || "未命名",
    statusLabel: clipStatusLabels[clip.status],
    elapsed: elapsedText(attempts),
    error: errorOf(attempts),
  };
}

const totalCount = computed(() => rows.value.length);
const doneCount = computed(() => rows.value.filter(row => {
  const clip = props.clips.find(item => item.clipId === row.clipId);
  return Boolean(clip && (clip.status === "generated" || clip.status === "accepted"));
}).length);
const pendingClips = computed(() => rows.value.filter(row => {
  const clip = props.clips.find(item => item.clipId === row.clipId);
  return Boolean(clip && (clip.status === "pending" || clip.status === "failed"));
}).map(row => row.clipId));
const percent = computed(() => totalCount.value ? Math.round((doneCount.value / totalCount.value) * 100) : 0);

const progressText = computed(() => {
  if (!props.batchId) return "尚未开始批量生成。设好范围后点「开始生成」。";
  if (props.batchPaused) return `已在镜头间暂停，已完成 ${doneCount.value}/${totalCount.value} 镜；点「继续生成」接着跑。`;
  if (!props.batchRunning) return `本批已结束：成功 ${doneCount.value} 镜，共 ${totalCount.value} 镜。`;
  const at = rows.value.findIndex((row) => {
    const clip = props.clips.find(item => item.clipId === row.clipId);
    return clip?.status === "generating";
  });
  return at >= 0
    ? `正在生成第 ${at + 1}/${totalCount.value} 镜 · 已完成 ${doneCount.value} 镜`
    : `正在生成 · 已完成 ${doneCount.value}/${totalCount.value} 镜`;
});

/** 耗时 = attempts 里最后一轮 generating 到它之后第一条终态的配对；还没配对时算到当前时刻。 */
function elapsedText(attempts: { at: string; status: string }[]): string {
  const lastGenIndex = attempts.findLastIndex(attempt => attempt.status === "generating");
  if (lastGenIndex < 0) return "—";
  // 暂停后继续沿用同一 batchId，同一镜会有两轮 generating：只取最后一轮之后的第一条终态。
  const ended = attempts.slice(lastGenIndex + 1).find(attempt => attempt.status !== "generating");
  const started = Date.parse(attempts[lastGenIndex].at);
  const finished = ended ? Date.parse(ended.at) : now.value;
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return "—";
  const seconds = Math.round((finished - started) / 1000);
  return seconds >= 3600 ? `${Math.floor(seconds / 60)}分` : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** onFailed 记的是 `batch:<id> <错误>`，其余三类等值；这里只去掉标记前缀，展示原文。 */
function errorOf(attempts: { status: string; error?: string }[]): string {
  const failed = attempts.findLast(attempt => attempt.status === "failed");
  if (!failed?.error) return "";
  const prefix = `batch:${props.batchId} `;
  return failed.error.startsWith(prefix) ? failed.error.slice(prefix.length) : failed.error;
}
</script>

<style scoped>
.batchBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.batchNote {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.batchRange {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-size: 12px;
}

.rangeField {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.fieldLabel {
  color: var(--el-text-color-regular);
}

.rangePresets {
  display: inline-flex;
  align-items: center;
}

.rangeCheck {
  margin-left: auto;
}

.rangeText {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.batchActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batchSpace {
  flex: 1;
}

.batchProgress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progressText {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.batchTable {
  font-size: 12px;
}

.batchEmpty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
