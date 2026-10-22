<template>
  <multitrackEditor
    ref="editorRef"
    :getFiles="getFiles"
    :directory="directory"
    :projectPath="projectPath"
    @dirtyChange="onDirtyChange" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { ExtContext } from "@toonflow/ext-scaffold/runtime";
import multitrackEditor from "@toonflow/node-shared/mtrack/multitrackEditor";
import type { EditorFiles } from "@toonflow/node-shared/mtrack/mtrackProject";

const props = defineProps<{ context: ExtContext }>();

const editorRef = ref<InstanceType<typeof multitrackEditor>>();

function onDirtyChange(value: boolean) {
  props.context.dirty = value;
}

function getFiles(): EditorFiles {
  const extFiles = props.context.files;
  return {
    readJson: <T,>(path: string) => extFiles.readJson<T>(path),
    writeJson: (path: string, data: unknown, exclusive?: boolean) => extFiles.writeJson(path, data, exclusive),
    mkdir: (path: string) => extFiles.mkdir(path),
    acquireUrl: (path: string, mimeType?: string) => extFiles.acquireUrl(path, mimeType),
  };
}

const directory = computed(() => props.context.resource.directory);

// ACT: 扩展是从文件树打开的具体 .mtrack，编辑器必须绑定这个文件，不能回落到默认工程。
const projectPath = computed(() => props.context.resource.path);

props.context.flushSave = () => editorRef.value?.flushSave() ?? Promise.resolve();
</script>
