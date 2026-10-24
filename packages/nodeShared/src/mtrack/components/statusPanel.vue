<template>
  <div class="statusPanel">
    <section class="panelBlock">
      <header class="panelHeader">
        <span class="panelTitle">生成状态</span>
        <span class="panelMeta">状态：{{ statusLabel }} · 节点：{{ clip?.nodeId || "—" }}</span>
      </header>
      <div v-if="clip" class="versionRow">
        <span class="panelMeta">视频版本</span>
        <el-select v-model="activeVersion" size="small" class="versionSelect" placeholder="选择视频版本">
          <el-option v-for="item in versionOptions" :key="item.key" :label="item.label" :value="item.key" />
        </el-select>
        <span class="panelMeta">共 {{ versionOptions.length }} 版</span>
      </div>
      <button
        v-if="stale && clip?.assetPath"
        type="button"
        class="staleWarning"
        title="点击重新生成，追加一个新版本"
        @click="onStaleWarningClick">
        当前成片已落后于最新设置，建议重新生成
      </button>
      <div v-if="versionOptions.length" class="versionActions">
        <el-button
          size="small"
          text
          :disabled="!activeVersion || clip?.status === 'generating'"
          @click="emit('deleteVersion', activeVersion)">删除当前版本</el-button>
        <el-button
          size="small"
          text
          :disabled="versionOptions.length === 0 || clip?.status === 'generating'"
          @click="emit('deleteAllVersions')">删除全部版本</el-button>
      </div>
      <div v-if="otherVersions.length" class="versionActions">
        <span class="panelMeta">设为默认</span>
        <el-button
          v-for="item in otherVersions"
          :key="item.key"
          size="small"
          text
          :disabled="defaultLocked"
          :title="item.key"
          @click="emit('setDefaultVersion', item.key)"
        >版本 {{ item.number }}</el-button>
      </div>
      <div v-if="previewUrl" class="preview">
        <video :src="previewUrl" controls playsinline preload="metadata" @error="onPreviewError" />
      </div>
      <p v-else-if="previewError" class="panelHint">预览失败：{{ previewError }}</p>
      <p v-else-if="clip?.assetPath || (activeVersion && activeVersion !== clip?.assetPath)" class="panelHint">正在取预览地址…</p>
      <p v-else class="panelHint">尚未生成视频（无结果文件）。</p>
      <ul v-if="clip?.attempts.length" class="attempts">
        <li v-for="(attempt, index) in clip.attempts" :key="index">
          {{ localizeTime(attempt.at, "-") }} · {{ attempt.status }}{{ attempt.error ? ` · ${attempt.error}` : "" }}
        </li>
      </ul>
    </section>
    <section class="panelBlock">
      <header class="panelHeader">
        <span class="panelTitle">校验发现</span>
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
          </li>
        </ul>
        <p v-else class="panelHint">校验报告无发现项。</p>
      </template>
    </section>
    <section class="panelBlock">
      <p class="panelHint">选段生成由本编辑器经画布 nodeTools 直接驱动：逐镜建节点、配模型、写提示词并生成，全程不经过对话模型；状态与产物直接回写工程文件。生成期间不提供节流与算力控制。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElMessage, ElOption, ElSelect } from "element-plus";
import type { MtrackClip, AssetReport } from "../mtrackProject";
import { clipStatusLabels, clipVersions, localizeTime } from "../mtrackProject";

const props = defineProps<{
  clip?: MtrackClip;
  report?: AssetReport;
  readError: string;
  acquireUrl: (path: string, mimeType?: string) => { url: Promise<string>; release(): void };
  /** 旧工程的历史版本只有画布 nodeId（没有产物路径），经画布桥按 nodeId 反查节点产物；由编辑器提供只读实现。 */
  acquireNodeVideo?: (nodeId: string) => Promise<string>;
  stale?: boolean;
}>();

const emit = defineEmits<{
  (event: "setDefaultVersion", version: string): void;
  (event: "deleteVersion", version: string): void;
  (event: "deleteAllVersions"): void;
}>();

/** 必须用 computed：statusLabel 要跟着选中片段变，静态取值会把标签永远钉在首次选中的那个片段上。 */
const statusLabel = computed(() => props.clip ? clipStatusLabels[props.clip.status] : "未选中");
/** 版本列表对齐 LSC：attempts 序天然旧→新，当前默认（clip.assetPath）排在最后并打「默认」标记。 */
const versions = computed(() => clipVersions(props.clip));
const versionOptions = computed(() => {
  const current = props.clip?.assetPath ?? "";
  return versions.value.map((version, index) => {
    const name = version.key.split("/").pop() || version.key;
    return {
      key: version.key,
      number: index + 1,
      label: `版本 ${index + 1} · ${name}${version.key === current ? " · 默认" : ""}`,
      isDefault: version.key === current,
    };
  });
});
const otherVersions = computed(() => versionOptions.value.filter((item) => !item.isDefault));
/** 生成中不切默认：这条镜的产物还在写，切了会和回写抢同一份工程。 */
const defaultLocked = computed(() => props.clip?.status === "generating");
/** 默认选中「默认版本」（clip.assetPath）：单版本时也把版本号摆在明面上，切片段跟随新片段。 */
const activeVersion = ref(props.clip?.assetPath ?? "");
const previewUrl = ref("");
const previewError = ref("");
let releasePreview: (() => void) | undefined;
let previewJob = 0;

watch(() => props.clip?.clipId, () => {
  activeVersion.value = props.clip?.assetPath ?? "";
});

/** 生成完成后默认会换成新产物：预览跟随到新默认。用户主动选历史版本时 assetPath 不变，不会被覆盖。 */
watch(() => props.clip?.assetPath, (path) => {
  activeVersion.value = path ?? "";
});

/**
 * 选中版本即切换预览：版本条目自带产物路径时直接取文件；旧工程只有 nodeId 的条目经画布桥反查节点产物。
 * 预览切换可能在多个 await 之间重入（快速换版本），用 previewJob 丢弃过期的结果。
 */
watch(activeVersion, async (version) => {
  const job = ++previewJob;
  releasePreview?.();
  releasePreview = undefined;
  previewUrl.value = "";
  previewError.value = "";
  const entry = versions.value.find(item => item.key === version);
  if (!entry) return;
  let path = entry.assetPath ?? "";
  if (!path && entry.nodeId) {
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
  } else if (!path) {
    previewError.value = "该版本没有视频产物";
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

onBeforeUnmount(() => {
  releasePreview?.();
  releasePreview = undefined;
});

function onPreviewError(event: Event) {
  const target = event.target as HTMLVideoElement | null;
  const code = target?.error?.code;
  previewError.value = code ? `视频加载失败（code ${code}）` : "视频加载失败";
}

function onStaleWarningClick() {
  ElMessage.warning("重新生成会追加一个新版本，旧版本保留");
}
</script>

<style scoped>
.statusPanel {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 10px;
  width: 320px;
  padding: 12px;
  border-left: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.versionRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.versionSelect {
  flex: 1;
  min-width: 0;
}

.versionActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.versionActions :deep(.el-button) {
  margin-left: 0;
  padding: 0 6px;
}

.staleWarning {
  margin: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  color: var(--el-color-warning, #e6a23c);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.staleWarning:hover {
  text-decoration: underline;
}

.panelBlock {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
}

.panelHeader {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.panelTitle {
  font-size: 12px;
  font-weight: 600;
}

.panelMeta {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.panelHint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.7;
}

.preview video {
  width: 100%;
  border-radius: 6px;
  background: #000;
  display: block;
}

.attempts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  list-style: none;
}

.attempts li {
  overflow-wrap: anywhere;
}

.findings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  font-size: 11px;
  list-style: none;
}

.findings li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 5px 7px;
  border-radius: 6px;
}

.findings .error {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.findings .warning {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.findingRule {
  flex: none;
  font-weight: 600;
}

.findingMessage {
  flex: 1;
  min-width: 0;
}

.findingRef {
  flex: none;
  opacity: 0.75;
}
</style>
