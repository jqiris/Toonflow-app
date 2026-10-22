<template>
  <div class="dispatchBar">
    <span class="dispatchRange">{{ rangeText }}</span>
    <span v-if="skippedCount" class="dispatchHint">跳过 {{ skippedCount }} 段（已生成/生成中）</span>
    <span class="dispatchOverride">
      <el-checkbox v-model="includeFinished" size="small">包含已生成</el-checkbox>
    </span>
    <span class="dispatchActions">
      <el-button size="small" :disabled="!clips.length" @click="emit('openBatch')">批量生成…</el-button>
      <el-button size="small" type="primary" :loading="busy" :disabled="!clips.length" @click="emit('generate')">生成选中段</el-button>
      <!-- 合成成片：确认与请求都由 multitrackEditor 负责，这里只报事件。 -->
      <el-button size="small" type="success" :loading="compositeBusy" :disabled="compositeBusy || !hasAccepted" @click="emit('composite')">合成成片</el-button>
      <!-- ACT: 取消不受 busy 限制——生成在途十几分钟正是唯一需要停手的窗口，点击后由 launchCancel 抢占本地循环并逐个 node:cancelGeneration。 -->
      <el-button v-if="batchId" size="small" text @click="emit('cancel')">取消批次</el-button>
      <!-- 断点续跑对账：只读画布节点状态把已结束的生成补成终态，不改在跑批次。 -->
      <el-button size="small" text :disabled="!clips.length" @click="emit('reconcile')">刷新状态</el-button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElButton, ElCheckbox } from "element-plus";
import type { MtrackClip } from "../mtrackProject";

const props = withDefaults(
  defineProps<{
    clips: MtrackClip[];
    busy: boolean;
    batchId: string;
    skippedCount: number;
    compositeBusy?: boolean;
    hasAccepted?: boolean;
  }>(),
  { compositeBusy: false, hasAccepted: false },
);

const emit = defineEmits<{
  (event: "generate"): void;
  (event: "cancel"): void;
  (event: "openBatch"): void;
  (event: "reconcile"): void;
  (event: "composite"): void;
}>();

const includeFinished = defineModel<boolean>("includeFinished", { default: false });

/** 选段文案与 LSC 一致：显示镜头标题而不是 clipId，多段时给首尾与前 5 个标题。 */
const rangeText = computed(() => {
  const rows = props.clips;
  if (!rows.length) return "未选段：点选轨道片段；Ctrl/⌘ 单击追加多选，Shift 单击选连续起止范围";
  const titleOf = (clip: MtrackClip) => clip.title || clip.clipId;
  if (rows.length === 1) return `已选 1 段 · ${titleOf(rows[0])}`;
  const names = rows.slice(0, 5).map(titleOf).join("、");
  return `已选 ${rows.length} 段 · ${titleOf(rows[0])}–${titleOf(rows[rows.length - 1])}（${names}${rows.length > 5 ? "、…" : ""}）`;
});
</script>

<style scoped>
.dispatchBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 9px 16px 11px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
}

.dispatchRange {
  color: var(--el-text-color-regular);
}

.dispatchHint {
  color: var(--el-color-warning);
}

.dispatchOverride {
  color: var(--el-text-color-secondary);
}

.dispatchActions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
</style>
