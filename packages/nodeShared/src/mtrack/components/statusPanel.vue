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
          <el-option v-for="item in versionOptions" :key="item.node" :label="item.label" :value="item.node" />
        </el-select>
        <span class="panelMeta">共 {{ versionOptions.length }} 版</span>
      </div>
      <div v-if="otherVersions.length" class="versionActions">
        <span class="panelMeta">设为默认</span>
        <el-button
          v-for="item in otherVersions"
          :key="item.node"
          size="small"
          text
          :disabled="defaultLocked"
          :title="item.node"
          @click="emit('setDefaultVersion', item.node)"
        >版本 {{ item.number }}</el-button>
      </div>
      <div v-if="previewUrl" class="preview">
        <video :src="previewUrl" controls playsinline preload="metadata" @error="onPreviewError" />
      </div>
      <p v-else-if="previewError" class="panelHint">预览失败：{{ previewError }}</p>
      <p v-else-if="clip?.assetPath || (activeVersion && activeVersion !== clip?.nodeId)" class="panelHint">正在取预览地址…</p>
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
import type { MtrackClip, AssetReport } from "../mtrackProject";
import { clipStatusLabels, clipVersionNodes, localizeTime } from "../mtrackProject";

const props = defineProps<{
  clip?: MtrackClip;
  report?: AssetReport;
  readError: string;
  acquireUrl: (path: string, mimeType?: string) => { url: Promise<string>; release(): void };
  /** 历史版本的产物路径只能经画布桥按 nodeId 反查（落盘名带随机后缀），由编辑器提供只读实现。 */
  acquireNodeVideo?: (nodeId: string) => Promise<string>;
}>();

const emit = defineEmits<{
  (event: "setDefaultVersion", nodeId: string): void;
}>();

/** 必须用 computed：statusLabel 要跟着选中片段变，静态取值会把标签永远钉在首次选中的那个片段上。 */
const statusLabel = computed(() => props.clip ? clipStatusLabels[props.clip.status] : "未选中");
const versionNodes = computed(() => clipVersionNodes(props.clip));
/**
 * 版本列表对齐 LSC：attempts 序天然旧→新，当前默认（clip.nodeId）排在最后并打「默认」标记。
 * 历史工程里 nodeId 可能不在 attempts 里，补到末尾，保证当前默认始终可选。
 */
const versionOptions = computed(() => {
  const current = props.clip?.nodeId ?? "";
  const nodes = versionNodes.value;
  const list = current && !nodes.includes(current) ? [...nodes, current] : nodes;
  return list.map((node, index) => ({
    node,
    number: index + 1,
    label: `版本 ${index + 1} · ${node.slice(0, 8)}${node === current ? " · 默认" : ""}`,
    isDefault: node === current,
  }));
});
const otherVersions = computed(() => versionOptions.value.filter((item) => !item.isDefault));
/** 生成中不切默认：这条镜的产物还在写，切了会和回写抢同一份工程。 */
const defaultLocked = computed(() => props.clip?.status === "generating");
/** 默认选中「默认版本」（clip.nodeId）：单版本时也把版本号摆在明面上，切片段跟随新片段。 */
const activeVersion = ref(props.clip?.nodeId ?? "");
const previewUrl = ref("");
const previewError = ref("");
let releasePreview: (() => void) | undefined;
let previewJob = 0;

watch(() => props.clip?.clipId, () => {
  activeVersion.value = props.clip?.nodeId ?? "";
});

/** 生成完成后默认会换成新节点：预览跟随到新默认。用户主动选历史版本时 nodeId 不变，不会被覆盖。 */
watch(() => props.clip?.nodeId, (node) => {
  activeVersion.value = node ?? "";
});

/**
 * 选中版本即切换预览：当前版本用工程里的 assetPath，历史版本经画布桥读该节点真实产物路径。
 * 预览切换可能在多个 await 之间重入（快速换版本），用 previewJob 丢弃过期的结果。
 */
watch([activeVersion, () => props.clip?.assetPath], async ([version, assetPath]) => {
  const job = ++previewJob;
  releasePreview?.();
  releasePreview = undefined;
  previewUrl.value = "";
  previewError.value = "";
  const isCurrent = !version || version === props.clip?.nodeId;
  if (isCurrent && !assetPath) return;
  let path = isCurrent ? assetPath as string : "";
  if (!isCurrent) {
    if (!props.acquireNodeVideo) {
      previewError.value = "当前界面无法读取历史版本产物";
      return;
    }
    try {
      path = await props.acquireNodeVideo(version);
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
