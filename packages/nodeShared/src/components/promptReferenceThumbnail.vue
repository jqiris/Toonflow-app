<template>
  <span class="referenceThumbnail" aria-hidden="true">
    <img v-if="imageUrl && !failed" :src="imageUrl" alt="" draggable="false" @error="failed = true" />
    <video v-else-if="dataType === 'VIDEO' && fileUrl && !failed" :src="fileUrl" preload="metadata" muted playsinline @error="failed = true" />
    <component v-else :is="typeIcon" :size="16" />
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconFileText, IconMusic, IconPhoto, IconVideo } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ dataType?: string; avatar?: string | URL; media?: NodeMediaValue }>();
const failed = ref(false);
const { useFileUrl } = useNodeFiles();
const fileUrl = useFileUrl(() => !props.avatar && (props.dataType === "IMAGE" || props.dataType === "VIDEO") ? props.media : undefined, () => { failed.value = true; });
const imageUrl = computed(() => String(props.avatar || (props.dataType === "IMAGE" ? fileUrl.value : "")));
const typeIcon = computed(() => props.dataType === "IMAGE" ? IconPhoto : props.dataType === "VIDEO" ? IconVideo : props.dataType === "AUDIO" ? IconMusic : IconFileText);
watch([() => props.avatar, () => props.media], () => { failed.value = false; });
</script>

<style scoped lang="scss">
.referenceThumbnail {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  overflow: hidden;
  border-radius: var(--el-border-radius-small);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
