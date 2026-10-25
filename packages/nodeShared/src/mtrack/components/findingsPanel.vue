<template>
  <div class="findingsPanel">
    <header class="panelHeader">
      <span v-if="!report" class="panelMeta">未读取到 plan/assetReport.json</span>
      <span v-else-if="!report.findings?.length" class="panelMeta">未发现明显问题</span>
      <span v-else class="panelMeta">错误 {{ report.errors ?? 0 }} · 警告 {{ report.warnings ?? 0 }}</span>
    </header>
    <p v-if="readError" class="panelHint">读取失败：{{ readError }}</p>
    <template v-else-if="report">
      <ul v-if="report.findings?.length" class="findings">
        <li v-for="(finding, index) in report.findings" :key="index" :class="finding.level">
          <span class="findingRule">{{ finding.rule }}</span>
          <span class="findingMessage">{{ finding.message }}</span>
          <span v-if="finding.ref" class="findingRef">{{ finding.ref }}</span>
          <button
            type="button"
            class="findingLocate"
            :disabled="!clipIdOf(finding)"
            :title="clipIdOf(finding) ? '在镜头创作工作台选中该镜头' : '这条发现项对应的是资产卡（没有镜头号），无法定位到镜头'"
            @click="emit('locate', clipIdOf(finding))">
            定位
          </button>
        </li>
      </ul>
      <p v-else class="panelHint">校验报告无发现项。</p>
    </template>
    <p v-else class="panelHint">点工具栏「校验」重新读取 plan/assetReport.json。</p>
  </div>
</template>

<script setup lang="ts">
import type { AssetFinding, AssetReport } from "../mtrackProject";

const props = defineProps<{
  report?: AssetReport;
  readError?: string;
  /** 发现项 → 镜头号：宿主按 finding.ref 在镜头列表里反查；ref 不是镜头号时返回空串（不可定位）。 */
  resolveClipId?: (finding: AssetFinding) => string;
}>();

const emit = defineEmits<{ (event: "locate", clipId: string): void }>();

function clipIdOf(finding: AssetFinding): string {
  return props.resolveClipId?.(finding) ?? "";
}
</script>

<style scoped>
.findingsPanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 2px;
}
.panelHeader {
  display: flex;
  align-items: center;
  gap: 8px;
}
.panelMeta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.panelHint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.findings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.findings li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  line-height: 1.6;
}
.findings li.error .findingRule {
  color: var(--el-color-danger);
}
.findings li.warning .findingRule {
  color: var(--el-color-warning);
}
.findingRule {
  font-weight: 600;
}
.findingMessage {
  color: var(--el-text-color-primary);
}
.findingRef {
  color: var(--el-text-color-secondary);
}
.findingLocate {
  margin-left: auto;
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--el-color-primary);
  font-size: 12px;
  line-height: 1.6;
  cursor: pointer;
}
.findingLocate:disabled {
  color: var(--el-text-color-disabled);
  cursor: not-allowed;
}
</style>
