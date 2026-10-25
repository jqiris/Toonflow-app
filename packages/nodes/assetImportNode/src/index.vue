<template>
  <nodeSkeleton v-bind="nodeProps" topWidth="max-content">
    <div class="importContent">
      <div class="importSummary" :class="{ empty: !data.summary }">{{ data.summary || "粘贴剧本或小说，抽取资产卡与分镜" }}</div>
      <el-button
        class="importButton nodrag nopan"
        :icon="IconFileImport"
        :loading="panel?.running"
        :disabled="panel?.running"
        text
        title="导入资产与分镜"
        aria-label="导入资产与分镜"
        @dblclick.stop
        @click.stop="panel?.open($event)">导入资产与分镜</el-button>
    </div>
    <assetImportPanel ref="panel" :active="node.selected" @summary="onSummary" />
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton } from "element-plus";
import { IconFileImport } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import assetImportPanel from "./components/assetImportPanel.vue";

defineOptions({
  inheritAttrs: false,
  icon: IconFileImport,
  handles: [
    { id: "in", type: "target", dataType: ["STRING", "FILE"], label: "文本来源" },
    { id: "summary", type: "source", dataType: "STRING", label: "导入摘要" },
  ] satisfies NodeHandle[],
});

const { node, nodeProps, outputs } = useNode({
  label: "导入资产与分镜",
  outputs: { summary: { dataType: "STRING", value: "" } },
});
const data = computed(() => node.data as typeof node.data & { summary?: string });
const panel = ref<InstanceType<typeof assetImportPanel>>();

function onSummary(value: string) {
  outputs.value.summary.value = value;
  data.value.summary = value;
}

nodeTools.register({
  name: "importScript",
  description: "从工作区文本文件或直接给出的正文抽取人物/场景/道具资产卡与分镜，可选生成资产图并放进画布，写入 plan/assetIndex.json 与 plan/story.mtrack（任一文件已存在时立刻拒绝，不会先烧模型）。原文里已经写好视频提示词时用 clips 按 clipId 覆盖该镜提示词。抽取加逐张出图是分钟级长任务，一次调用会等到跑完；中途想看跑到第几张用 node:importStatus",
  parameters: z.strictObject({
    path: z.string().optional().describe("工作区内的剧本文本路径，与 text 二选一"),
    text: z.string().optional().describe("直接给出的剧本/小说正文，与 path 二选一"),
    model: z.string().optional().describe("抽取用的文本模型，JSON.stringify([providerId, modelId])；不传用面板当前选择"),
    ratio: z.string().optional().describe("工程画幅，取值 9:16 / 16:9 / 1:1 / 4:3 / 3:4；不传用面板当前选择"),
    style: z.string().optional().describe("全片统一风格词，写入工程 global.style"),
    systemPrompt: z.string().optional().describe("全片统一约束，写入工程 global.systemPrompt"),
    generateImages: z.boolean().optional().describe("是否为资产卡生成资产图并放进画布（需要配置图片模型）"),
    clips: z.array(z.object({
      clipId: z.string().describe("分镜 id，从 S001 起按正文顺序编号（可先看本次抽取结果或 plan/story.mtrack 核对）"),
      prompt: z.string().describe("这一镜的提示词正文，整段覆盖抽取结果（原文写好的六段式照抄进这里）"),
      seconds: z.number().optional().describe("时长秒数，2–15 的整数；不传用抽取结果"),
      referenceIds: z.array(z.string()).optional().describe("这一镜的参考资产 id；不传用抽取结果，只能引用本次资产索引里的图片资产"),
      continuity: z.union([z.boolean(), z.enum(["shot", "context"])]).optional().describe("true 承接上一镜、false 独立起拍，也可直接写 shot/context；不传按引擎口径自动判定（上一镜存在 + ≥10 秒 + 参考 ≤3 才承接）"),
    })).optional().describe("按 clipId 覆盖抽取出来的分镜：原文里已经写好视频提示词时，用它把提示词原样落进工程"),
  }),
  // ACT: 抽取 + 逐张出图是分钟级长任务，默认 120 秒会被截断在半途（nodeTools.ts 的默认超时）。
  timeoutMs: 30 * 60 * 1000,
  async execute(args, context) {
    const target = panel.value;
    if (!target) throw new Error("导入面板尚未就绪，请稍后重试");
    return await target.runImport({ ...args, signal: context.signal });
  },
});

nodeTools.register({
  name: "importStatus",
  description: "查看本节点导入的进度与最近一次结果：running/extracting、phase 与 done/total、摘要、出图失败的卡片清单、没有中断导入的警告清单（参考超上限/参考未出图被移除/承接镜不足 10 秒），取消或失败时报 aborted 与本次已建的资产图节点 id（这些节点留在画布上，要手工删）；本节点没有别的状态入口，跑没跑、跑到第几张都看它",
  parameters: z.strictObject({}),
  async execute() {
    const target = panel.value;
    if (!target) return { running: false, extracting: false, aborted: false, phase: "", done: 0, total: 0, summary: "", error: "导入面板尚未就绪", failed: [], warnings: [], placedNodeIds: [], savedSummary: data.value.summary ?? "" };
    // savedSummary 随画布 JSON 落盘：重开工程也能看出这个节点上一次跑出了什么。
    return { ...target.status(), savedSummary: data.value.summary ?? "" };
  },
});
</script>

<style scoped lang="scss">
.importContent {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;

  .importSummary {
    color: var(--el-text-color-primary);
    font-size: 12px;
    line-height: 18px;
    word-break: break-all;

    &.empty {
      color: var(--el-text-color-secondary);
    }
  }

  .importButton {
    align-self: flex-start;
    height: auto;
    padding: 0;
  }
}
</style>
