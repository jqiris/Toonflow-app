<template>
  <footer class="runFooter">
    <p v-if="error" class="footerError" role="alert">{{ error }}</p>
    <div class="runBar">
      <div class="runHeading">
        <strong class="runTitle"><span class="stepIndex">03</span>生成视频</strong>
        <p class="runHint">{{ rangeText }}</p>
      </div>
      <div class="runActions">
        <el-button size="small" :loading="saving" :disabled="!dirty || busy" @click="emit('save')">保存</el-button>
        <!-- LSC locked 口径：批次在跑或已在镜头间暂停时都不能另起一批，只能继续/重试或结束本批。 -->
        <el-button size="small" type="primary" :disabled="batchRunning || batchPaused || busy" @click="emit('run')">生成视频</el-button>
        <el-button v-if="batchRunning" size="small" :disabled="batchPaused" @click="emit('pause')">本镜结束后暂停</el-button>
        <el-button v-if="batchPaused && !batchRunning" size="small" type="primary" @click="emit('resume')">继续 / 重试</el-button>
        <el-button v-if="batchId" size="small" @click="emit('finish')">结束本批</el-button>
      </div>
    </div>
    <p class="footerStatus" aria-live="polite">{{ statusText }}</p>
  </footer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElButton } from "element-plus";

const props = defineProps<{
  /** 批次起点（1 基镜号）与镜数（-1 = 到最后一镜），与高级设置「生成范围」同一份数字。 */
  start: number;
  count: number;
  clipCount: number;
  error: string;
  dirty: boolean;
  saving: boolean;
  /** dispatching 等启动相位忙碌态：禁用重复发起。 */
  busy: boolean;
  batchRunning: boolean;
  batchPaused: boolean;
  batchId: string;
  /** 批次消息（进度、完成）优先展示；为空时按脏标记回落到保存/就绪文案。 */
  batchMessage: string;
}>();

const emit = defineEmits<{
  (event: "save"): void;
  (event: "run"): void;
  (event: "pause"): void;
  (event: "resume"): void;
  (event: "finish"): void;
}>();

const rangeText = computed(() => {
  const scope = props.count < 0 || props.start + props.count - 1 >= props.clipCount
    ? `从第 ${props.start} 镜头生成至最后`
    : `从第 ${props.start} 镜头开始，生成 ${props.count} 个`;
  return `${props.clipCount ? scope : "工程里还没有镜头"} · 保存不会启动生成`;
});

const statusText = computed(() => {
  if (props.batchMessage) return props.batchMessage;
  if (props.batchRunning) return "生成中…";
  if (props.batchPaused) return "已在镜头间暂停，点「继续 / 重试」接着跑。";
  if (props.saving) return "保存中…";
  if (props.dirty) return "有未保存的修改";
  return "准备就绪，点击生成即可开始。";
});
</script>

<style scoped>
.runFooter {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.footerError {
  margin: 0;
  padding: 6px 10px;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 8px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  font-size: 12px;
}

.runBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.runHeading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.runTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 650;
}

.stepIndex {
  color: var(--el-color-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
}

.runHint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.runActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.footerStatus {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
