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
import { extractionSchema } from "./assetImport";
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
  description: "把资产卡与分镜写进 plan/assetIndex.json 与 plan/story.mtrack（任一文件已存在时立刻拒绝，不会先烧模型），可选逐张生成资产图并放进画布。两条入口，按调用方手上有什么选：① 定稿直读——资产卡与分镜已经是结构化数据（会话里已抽好/已写好，或从 assets/assetCards.md 整理出来的）就整批传 extraction，本节点一次模型都不调、纯确定性校验落盘，不需要 model；② 抽正文——只有散文/剧本要抽时才传 path 或 text 加 model。中途想看跑到第几张用 node:importStatus。只有走②才需要文本模型，也才可能长时间等模型：会话 Agent 的单次调用受画布桥与宿主各 120 秒硬顶（节点里的 timeoutMs 只对面板按钮生效），要抽整篇长文请先在会话里分批处理好再走①",
  parameters: z.strictObject({
    extraction: extractionSchema.optional().describe("定稿直读：已抽取好的资产卡与分镜整批完整定稿（资产稿与分镜稿都定稿了再整批传）。代码只硬拦编号重复/结构不合/clips 覆盖的非法引用；正文 shots 引用不存在的卡会被静默掐掉，分镜缺段不报错——半套稿会静默落成工程且重跑被独占写拦下，请调用前自查完整性。传了就不再调文本模型。字段名以本参数给的 schema 为准，契约外的多余字段会被忽略而不是报错；assets 至少一张；shots 仅「先导纯资产、之后用 editProject add 补分镜」的确认场景可为空"),
    path: z.string().optional().describe("工作区内的剧本文本路径，与 text 二选一；只在没有 extraction、需要节点抽取正文时用"),
    text: z.string().optional().describe("直接给出的剧本/小说正文，与 path 二选一；只在没有 extraction、需要节点抽取正文时用"),
    model: z.string().optional().describe("抽取用文本模型，JSON.stringify([providerId, modelId])，编号必须来自 node:importModels 的 text 清单；需要抽正文时必填（不传不再静默用面板默认，选了不可用的模型会一路挂到超时），传了 extraction 则不需要"),
    imageModel: z.string().optional().describe("出资产图用的图片模型，JSON.stringify([providerId, modelId])，编号来自 node:importModels 的 image 清单；generateImages 为真时必填，同样不回落到列表第一个"),
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
  // 注意这个放宽只对面板直调生效：会话 Agent 走的画布桥与宿主各自硬顶 120 秒
  //（apps/server/src/agent/bridge/canvas.ts 与 apps/web 的 useCanvasTools），Agent 侧长任务请分批或先看 node:importStatus。
  timeoutMs: 30 * 60 * 1000,
  async execute(args, context) {
    const target = panel.value;
    if (!target) throw new Error("导入面板尚未就绪，请稍后重试");
    return await target.runImport({ ...args, signal: context.signal });
  },
});

nodeTools.register({
  name: "importModels",
  description: "列出本节点能用的文本模型与图片模型，以及面板当前选中项：要调模型抽取或出资产图，编号只能从这里取（node:importScript 只认这份清单里的编号，清单外的直接报错不回落到第一个）；定稿直读传 extraction 时不需要任何模型",
  parameters: z.strictObject({}),
  async execute() {
    const target = panel.value;
    if (!target) throw new Error("导入面板尚未就绪，请稍后重试");
    return await target.modelChoices();
  },
});

nodeTools.register({
  name: "setModel",
  description: "调整本节点面板当前的抽取用文本模型与出资产图用的图片模型，编号取自 node:importModels；改完面板下拉同步显示，人工仍可自己改回来。只想跑一次而不改当前选择时，直接在 node:importScript 里带 model / imageModel",
  parameters: z.strictObject({
    model: z.string().optional().describe("抽取用文本模型，JSON.stringify([providerId, modelId])"),
    imageModel: z.string().optional().describe("资产图图片模型，JSON.stringify([providerId, modelId])"),
  }),
  async execute(args) {
    const target = panel.value;
    if (!target) throw new Error("导入面板尚未就绪，请稍后重试");
    if (args.model === undefined && args.imageModel === undefined) throw new Error("至少要指定 model 或 imageModel");
    return await target.setModel(args);
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
