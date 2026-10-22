<template>
  <div class="trackBar">
    <div class="trackControls">
      <label class="trackField">
        <span class="trackFieldLabel">全片比例</span>
        <el-select :modelValue="ratio" size="small" class="trackSelect" placeholder="未设置" @change="onRatioChange">
          <el-option v-for="item in ratioOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </label>
      <label v-if="hasModelOptions" class="trackField">
        <span class="trackFieldLabel">视频模型</span>
        <el-select
          :modelValue="currentModel"
          size="small"
          class="trackSelect trackSelectWide"
          :placeholder="modelLabel || '未设置'"
          @change="onModelChange"
        >
          <el-option
            v-for="item in modelOptions"
            :key="`${item.value.providerId}/${item.value.modelId}`"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </label>
      <span v-else class="trackField">
        <span class="trackFieldLabel">视频模型</span>
        <span class="trackModelText">{{ modelLabel || "未设置" }}</span>
      </span>
    </div>
    <div v-if="clips.length" class="trackScroll">
      <div class="trackLane">
        <button
          v-for="(clip, index) in clips"
          :key="clip.clipId"
          type="button"
          class="clipBlock"
          :class="{ clipSelected: clip.clipId === selectedId, clipMulti: isMulti(clip) }"
          :aria-pressed="clip.clipId === selectedId"
          :title="clipTitle(clip)"
          @click="selectClip(clip, $event)"
        >
          <span class="clipHead">
            <span class="clipIndex">{{ index + 1 }}</span>
            <span class="clipTitle">{{ clip.title || clip.clipId }}</span>
          </span>
          <span class="clipMeta">
            <span class="clipStatus" :class="statusClass(clip.status)" />
            <span class="clipRange">{{ startOf(clips, index).toFixed(2) }}–{{ (startOf(clips, index) + duration(clip)).toFixed(2) }}秒</span>
          </span>
        </button>
      </div>
    </div>
    <p v-else class="trackEmpty">还没有片段，点击「添加片段」开始。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElOption, ElSelect } from "element-plus";
import type { MtrackClip } from "../mtrackProject";
import { ratioOptions } from "../mtrackProject";

const props = withDefaults(
  defineProps<{
    clips: MtrackClip[];
    selectedId: string;
    multiSelectedIds: string[];
    ratio?: string;
    modelLabel?: string;
    modelOptions?: { label: string; value: { providerId: string; modelId: string } }[];
  }>(),
  { modelOptions: () => [] },
);

const emit = defineEmits<{
  (event: "select", payload: { clipId: string; additive: boolean; range: boolean }): void;
  (event: "updateRatio", value: string): void;
  (event: "updateModel", value: { providerId: string; modelId: string }): void;
}>();

/** 没有可选模型时不渲染下拉，避免空下拉；降级为只读文本展示 modelLabel。 */
const hasModelOptions = computed(() => props.modelOptions.length > 0);

/** 选中项靠可读标签回查，父组件只需给 modelLabel，不用回传值对象引用。 */
const currentModel = computed(() => props.modelOptions.find((item) => item.label === props.modelLabel)?.value);

function onRatioChange(value: unknown) {
  emit("updateRatio", String(value));
}

function onModelChange(value: unknown) {
  emit("updateModel", value as { providerId: string; modelId: string });
}

/** 轨道卡片满宽展示标题（对照 LocalStoryCanvas 的镜卡：150px 起、grid 均分），时长只落在卡片文案里。 */
function clipTitle(clip: MtrackClip): string {
  return `${clip.title || clip.clipId} · ${duration(clip).toFixed(2)}秒`;
}

function duration(clip: MtrackClip): number {
  return Number.isFinite(clip.seconds) && clip.seconds > 0 ? clip.seconds : 0;
}

function startOf(clips: MtrackClip[], index: number): number {
  let total = 0;
  for (let position = 0; position < index; position += 1) total += duration(clips[position]);
  return total;
}

function statusClass(status: MtrackClip["status"]): string {
  return `status${status}`;
}

function isMulti(clip: MtrackClip): boolean {
  return props.multiSelectedIds.includes(clip.clipId);
}

function selectClip(clip: MtrackClip, event: MouseEvent) {
  emit("select", { clipId: clip.clipId, additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
}
</script>

<style scoped>
.trackBar {
  display: flex;
  flex-direction: column;
  min-height: 84px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.trackControls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: 10px;
  font-size: 12px;
}

.trackField {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
}

.trackFieldLabel {
  white-space: nowrap;
}

.trackSelect {
  width: 96px;
}

.trackSelectWide {
  width: 180px;
}

.trackModelText {
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.trackScroll {
  overflow-x: auto;
  scrollbar-width: thin;
}

.trackLane {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  align-items: stretch;
  gap: 6px;
  min-height: 60px;
}

.clipBlock {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2px;
  min-width: 0;
  min-height: 60px;
  padding: 7px 9px 7px 12px;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  font: inherit;
  font-size: 12px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s, background-color 0.14s;
}

.clipBlock:hover {
  border-color: var(--el-color-primary-light-5);
}

.clipSelected {
  border-color: var(--el-color-primary);
  box-shadow: inset 0 0 0 1px var(--el-color-primary);
}

.clipMulti {
  border-color: var(--el-color-warning);
  box-shadow: inset 0 0 0 1px var(--el-color-warning-light-5);
}

.clipBlock .statuspending {
  background: var(--el-text-color-disabled);
}

.clipBlock .statusgenerating {
  background: var(--el-color-primary);
}

.clipBlock .statusgenerated {
  background: var(--el-color-success);
}

.clipBlock .statusaccepted {
  background: var(--el-color-success-dark-2);
}

.clipBlock .statusfailed {
  background: var(--el-color-danger);
}

.clipHead {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.clipIndex {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.clipTitle {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.clipMeta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.clipStatus {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-text-color-disabled);
}

.clipRange {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.trackEmpty {
  margin: 0;
  padding: 14px 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
