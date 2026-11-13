<template>
  <img
    class="eagerImage"
    :src="src"
    :alt="alt"
    :title="title"
    loading="eager"
    decoding="async"
    @load="emit('load', $event)"
    @error="emit('error', $event)"
    @click="openPreview" />
  <el-image-viewer
    v-if="viewerVisible"
    :urlList="[src]"
    :teleported="true"
    @close="viewerVisible = false" />
  <button v-if="viewerVisible" class="eagerImageDownload" type="button" @click="download">
    下载
  </button>
</template>

<script setup lang="ts">
import { ref } from "vue";

// ACT: vue-stream-markdown 的默认 Image 组件在 <img> 上写死 loading="lazy"，虚拟化消息列表里
// Chrome 懒加载干预会推迟 load 事件 → onLoad 不触发 → 转圈（Spin）永不消失。
// 这里用 loading="eager" 渲染并显式转发 load/error（渲染器靠 onLoad 停转圈），点击放大复用 el-image-viewer。
const props = defineProps<{
  src: string;
  alt?: string;
  title?: string;
  referrerPolicy?: string;
  preview?: boolean;
  // 以下属性由库渲染器一并传入，这里声明以消费掉（避免落到 fragment 根节点）。
  controls?: unknown;
  transformHardenUrl?: (url: string) => string;
  nodeProps?: Record<string, unknown>;
  handleDownload?: (url: string) => void;
}>();
const emit = defineEmits<{ load: [event: Event]; error: [event: Event] }>();

const viewerVisible = ref(false);
const openPreview = () => {
  if (props.preview) viewerVisible.value = true;
};

// ACT: 默认 Image 的预览弹窗内有下载控制条；这里补回下载，避免覆盖组件丢功能。
// 有库提供的 handleDownload 用它，否则走浏览器原生下载（blob/http 均可）。
function download() {
  if (props.handleDownload) {
    props.handleDownload(props.src);
    return;
  }
  const link = document.createElement("a");
  link.href = props.src;
  link.download = props.title || "image";
  link.rel = "noopener";
  link.click();
}
</script>

<style scoped lang="scss">
.eagerImage {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  object-fit: contain;
  cursor: pointer;
}

.eagerImageDownload {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  z-index: 2000;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 0.875rem;
  cursor: pointer;
}
</style>
