<template>
  <div class="referenceList">
    <p v-if="!indexCards.length" class="referenceEmpty">资产索引为空，先在对话里装配参考资产。</p>
    <template v-else>
      <div class="referenceCards">
        <div
          v-for="card in indexCards"
          :key="card.id"
          class="referenceCard"
          :class="{ referencePicked: pickedSet.has(card.id), referenceTextOnly: card.textOnly === true }"
          :aria-pressed="pickedSet.has(card.id)"
          @click="toggle(card.id)"
        >
          <button
            v-if="pickedSet.has(card.id)"
            type="button"
            class="referenceRemove"
            title="移除"
            @click.stop="removeById(card.id)"
          >✕</button>
          <span v-if="pickedSet.has(card.id)" class="referenceOrder">{{ orderOf(card.id) + 1 }}</span>
          <img v-if="thumbnails[card.id]" class="referenceThumb" :src="thumbnails[card.id]" loading="lazy" alt="" />          <span v-else class="referenceThumb referenceThumbEmpty">无预览</span>
          <span class="referenceName" :title="card.name || card.id">{{ card.name || card.id }}</span>
          <span v-if="card.kind" class="referenceKind">{{ card.kind }}</span>
        </div>
      </div>
      <p class="referenceTip">顺序即 {{ refPlaceholder }} 编号：点卡片加入，已选卡片上可调序。</p>
      <div v-if="modelValue.length >= 2" class="referenceSequencer">
        <el-button
          v-for="(id, index) in modelValue"
          :key="`seq-${id}-${index}`"
          size="small"
          :disabled="index === 0"
          @click="move(index, -1)"
        >{{ index + 1 }}. {{ id }} ←</el-button>
      </div>
      <span v-if="modelValue.length >= 4" class="referenceLimit">图片参考上限 4 个（V8）</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElButton } from "element-plus";
import type { AssetIndexCard } from "../mtrackProject";

const props = defineProps<{
  modelValue: string[];
  indexCards: AssetIndexCard[];
  /** cardId → 缩略图 URL；父组件经画布桥反查，取不到的卡片显示「无预览」占位。 */
  thumbnails?: Record<string, string>;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: string[]): void;
}>();

const refPlaceholder = "{{ref N}}";

const thumbnails = computed(() => props.thumbnails ?? {});

const pickedSet = computed(() => new Set(props.modelValue));

function orderOf(id: string): number {
  return props.modelValue.indexOf(id);
}

function toggle(id: string) {
  if (!id || !props.indexCards.some(card => card.id === id)) return;
  if (props.modelValue.includes(id)) return; // 已选由 ✕ 移除，避免误触清空
  if (props.modelValue.length >= 4) return;
  emit("update:modelValue", [...props.modelValue, id]);
}

function removeById(id: string) {
  const index = props.modelValue.indexOf(id);
  if (index < 0) return;
  removeAt(index);
}

function removeAt(index: number) {
  const next = [...props.modelValue];
  next.splice(index, 1);
  emit("update:modelValue", next);
}

function move(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= props.modelValue.length) return;
  const next = [...props.modelValue];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  emit("update:modelValue", next);
}
</script>

<style scoped>
.referenceList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.referenceCards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.referenceCard {
  position: relative;
  display: flex;
  flex: 0 0 110px;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  transition: border-color 0.14s;
}

.referenceCard:hover {
  border-color: var(--el-color-primary-light-5);
}

.referencePicked {
  border-color: var(--el-color-primary);
  box-shadow: inset 0 0 0 1px var(--el-color-primary);
}

.referenceRemove {
  position: absolute;
  top: -8px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 50%;
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color);
  font-size: 11px;
  cursor: pointer;
}

.referenceRemove:hover {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.referenceOrder {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: #fff;
  background: var(--el-color-primary);
  font-size: 11px;
}

.referenceThumb {
  width: 100%;
  height: 74px;
  border-radius: 5px;
  object-fit: contain;
  background: var(--el-fill-color-darker);
}

.referenceThumbEmpty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-disabled);
  font-size: 11px;
}

.referenceName {
  overflow: hidden;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.referenceKind {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.referenceTextOnly {
  .referenceThumb {
    height: 34px;
  }
}

.referenceTip {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.referenceSequencer {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.referenceLimit {
  color: var(--el-color-warning);
  font-size: 12px;
}
</style>
