<template>
  <el-dropdown ref="dropdown" trigger="click" virtualTriggering :virtualRef="trigger" :disabled="disabled || busy || !src" @command="selectAction">
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="generateSphere">生成720°全景图</el-dropdown-item>
        <el-dropdown-item command="generateCylinder">生成360°环绕图</el-dropdown-item>
        <el-dropdown-item command="previewSphere" divided>预览720°全景图</el-dropdown-item>
        <el-dropdown-item command="previewCylinder">预览360°环绕图</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
  <el-dialog
    v-model="visible"
    class="panoramaDialog"
    :title="`预览${mode === 'sphere' ? '720°全景图' : '360°环绕图'}`"
    width="80%"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    :closeOnPressEscape="!busy"
    :showClose="!busy"
    :beforeClose="close"
    :style="{ maxWidth: 'calc(100vw - 32px)' }">
    <template #header>
      <div class="panoramaHeader">
        <icon-panorama-horizontal :size="20" />
        <strong>{{ mode === 'sphere' ? '720°全景图' : '360°环绕图' }}</strong>
        <span>预览与校正</span>
      </div>
    </template>
    <div class="panoramaPanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop @keydown.stop>
      <imagePanoramaPreview v-if="visible" ref="previewStage" :src="src" :mode="mode" :disabled="disabled || saving" @capture="saveCapture" />
    </div>
  </el-dialog>
  <div class="agentStage" v-if="agentVisible" aria-hidden="true">
    <!-- ACT: disabled 只接保存阶段；接 agentSaving 会让预览 busy 恒真，capture() 直接报“未就绪”。 -->
    <imagePanoramaPreview ref="agentStage" :src="src" :mode="agentMode" :disabled="saving" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus";
import { IconPanoramaHorizontal } from "@tabler/icons-vue";
import { useNode } from "@vue-flow/core";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { buildPanoramaPrompt, type PanoramaMode } from "../imagePanorama";
import { usePanoramaCapture } from "../usePanoramaCapture";
import { useImageVariationNode } from "../useImageVariationNode";
import imagePanoramaPreview from "./imagePanoramaPreview.vue";

const props = defineProps<{ src: string; source?: NodeMediaValue; disabled?: boolean }>();
const emit = defineEmits<{ open: [] }>();
const { node } = useNode();
const dropdown = ref<InstanceType<typeof ElDropdown>>();
const trigger = ref<HTMLElement>();
const visible = ref(false);
const mode = ref<PanoramaMode>("sphere");
const creating = ref(false);
const createVariation = useImageVariationNode();
const previewStage = ref<InstanceType<typeof imagePanoramaPreview>>();
const agentVisible = ref(false);
const agentSaving = ref(false);
const agentMode = ref<PanoramaMode>("sphere");
const agentStage = ref<InstanceType<typeof imagePanoramaPreview>>();
const { saving, saveCapture } = usePanoramaCapture(() => props.src);
const busy = computed(() => creating.value || saving.value || agentSaving.value || !!previewStage.value?.capturing);

async function agentCapture(mode: PanoramaMode, opts?: { yaw?: number; pitch?: number; fov?: number; count?: 1 | 4 | 12; layout?: "combined" | "separate" }): Promise<{ nodeIds: string[]; groupId?: string }> {
  if (busy.value) throw new Error("全景处理中，请稍后重试");
  if (!props.src) throw new Error("节点没有图片");
  agentMode.value = mode;
  agentVisible.value = true;
  agentSaving.value = true;
  try {
    await nextTick();
    const stage = agentStage.value;
    if (!stage) throw new Error("截图舞台未就绪");
    const limit = 300;
    for (let i = 0; i < limit && !stage.ready; i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!stage.ready) throw new Error("全景预览加载超时，请重试");
    const payload = await stage.captureWith(opts);
    const result = await saveCapture(payload);
    if (!result) throw new Error("全景截图保存失败");
    return result;
  } finally {
    agentVisible.value = false;
    agentSaving.value = false;
  }
}

defineExpose({ open, busy, visible, agentCapture });

watch(() => props.src, () => { visible.value = false; }, { flush: "sync" });

async function open(event: MouseEvent) {
  if (props.disabled || busy.value || !props.src) return;
  trigger.value = event.currentTarget as HTMLElement;
  await nextTick();
  dropdown.value?.handleOpen();
}

async function selectAction(command: string) {
  if (props.disabled || busy.value || !props.src) return;
  emit("open");
  mode.value = command.endsWith("Sphere") ? "sphere" : "cylinder";
  if (command.startsWith("preview")) {
    visible.value = true;
    return;
  }
  if (!props.source) return;
  creating.value = true;
  try {
    await createVariation({
      label: mode.value === "sphere" ? "720°全景图" : "360°环绕图",
      prompt: buildPanoramaPrompt(mode.value),
      model: typeof node.data.model === "string" ? node.data.model : "",
      size: typeof node.data.size === "string" ? node.data.size : "",
      ratio: mode.value === "sphere" ? "2:1" : "4:1",
    });
  } catch (error) {
    showNodeError(error, "全景节点创建失败");
  } finally {
    creating.value = false;
  }
}

function close(done: () => void) {
  if (!busy.value) done();
}
</script>

<style scoped lang="scss">
:global(.panoramaDialog .el-dialog__header) { padding-bottom: 16px; }
.panoramaHeader {
  display: flex; align-items: center; gap: 8px; min-height: 24px; padding-right: 24px; color: var(--el-text-color-primary);
  strong { font-size: 15px; font-weight: 600; }
  span { margin-left: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
}
.panoramaPanel { height: min(70vh, 760px); min-height: 0; }
.agentStage { position: fixed; left: -20000px; width: 960px; height: 540px; pointer-events: none; }
</style>
