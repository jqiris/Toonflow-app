<template>
  <div class="shotTabs" role="tablist" aria-label="镜头页签">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.clip.clipId"
      type="button"
      role="tab"
      class="shotTab"
      :class="[{ tabActive: tab.clip.clipId === selectedId, tabMulti: tab.clip.clipId !== selectedId && multiSet.has(tab.clip.clipId) }, statusClass(tab.clip.status)]"
      :aria-selected="tab.clip.clipId === selectedId"
      :title="`${tab.clip.clipId} · 状态：${clipStatusLabels[tab.clip.status]}`"
      @click="onTabClick(tab.clip.clipId, $event)"
    >
      <b class="tabTitle">{{ index + 1 }}. {{ tab.clip.title || tab.clip.clipId || "未命名" }}</b>
      <small class="tabRange">{{ tab.start.toFixed(2) }}–{{ tab.end.toFixed(2) }}秒</small>
      <small class="tabStatus">{{ clipStatusLabels[tab.clip.status] }}</small>
    </button>
    <p v-if="!clips.length" class="tabsEmpty">还没有镜头，点上方「＋ 添加镜头」开始。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ClipStatus, MtrackClip } from "../mtrackProject";
import { clipStatusLabels } from "../mtrackProject";

const props = defineProps<{
  clips: MtrackClip[];
  selectedId: string;
  multiSelectedIds: string[];
}>();

/** 选段语义与编辑器 onSelect 对齐：单击=单选，Ctrl/⌘=追加或取消，Shift=连选区间。 */
const emit = defineEmits<{
  (event: "select", payload: { clipId: string; additive: boolean; range: boolean }): void;
}>();

const multiSet = computed(() => new Set(props.multiSelectedIds));

/** 起止累计秒：前端推导（契约 §1），start = Σ seconds[0..i-1]，end = start + seconds[i]。 */
const tabs = computed(() => {
  let offset = 0;
  return props.clips.map(clip => {
    const start = offset;
    offset += Number(clip.seconds) || 0;
    return { clip, start, end: offset };
  });
});

function onTabClick(clipId: string, event: MouseEvent) {
  emit("select", { clipId, additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
}

/** 分镜状态 → 状态色类：色值全部由类里映射到 Element Plus 语义变量，模板不写行内色。 */
const statusClassNames: Record<ClipStatus, string> = {
  pending: "statusPending",
  generating: "statusGenerating",
  generated: "statusGenerated",
  accepted: "statusAccepted",
  failed: "statusFailed",
};

function statusClass(status: ClipStatus) {
  return statusClassNames[status];
}
</script>

<style scoped>
.shotTabs {
  display: flex;
  flex: none;
  align-items: stretch;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 8px;
  scrollbar-width: thin;
}

.shotTab {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 128px;
  padding: 6px 10px 6px 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  font-size: 11px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s;
}

/* 状态色条：左侧竖条 + 状态文字取语义色，pending 用中性信息色（灰）。 */
.shotTab::before {
  content: "";
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 4px;
  width: 3px;
  border-radius: 2px;
  background: var(--tabStatusColor, var(--el-color-info));
}

.statusPending {
  --tabStatusColor: var(--el-color-info);
}

.statusGenerating {
  --tabStatusColor: var(--el-color-warning);
}

.statusGenerated {
  --tabStatusColor: var(--el-color-primary);
}

.statusAccepted {
  --tabStatusColor: var(--el-color-success);
}

.statusFailed {
  --tabStatusColor: var(--el-color-danger);
}

.statusPending .tabStatus {
  color: var(--el-text-color-secondary);
}

.statusGenerating .tabStatus {
  color: var(--el-color-warning);
}

.statusGenerated .tabStatus {
  color: var(--el-color-primary);
}

.statusAccepted .tabStatus {
  color: var(--el-color-success);
}

.statusFailed .tabStatus {
  color: var(--el-color-danger);
}

.shotTab:hover {
  border-color: var(--el-color-primary-light-5);
}

/* 状态色只走色条与文字，边框/底色高亮留给选中与多选：优先级 选中态 > 多选态 > 状态色。 */
.tabActive {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: inset 0 0 0 1px var(--el-color-primary);
}

/* Ctrl/Shift 批量多选的高亮：不与当前镜的主色高亮混用。 */
.tabMulti {
  border-color: var(--el-color-primary-light-5);
  box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
}

.tabTitle {
  max-width: 180px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tabRange {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

/* 状态文字的颜色由上面五个状态类给（此处只定字重与数字对齐，避免同特异性下盖掉语义色）。 */
.tabStatus {
  font-variant-numeric: tabular-nums;
}

.tabsEmpty {
  margin: 0;
  padding: 8px 2px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
