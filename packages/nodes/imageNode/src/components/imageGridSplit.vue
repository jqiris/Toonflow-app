<template>
  <el-popover
    v-model:visible="visible"
    virtualTriggering
    :virtualRef="trigger"
    placement="bottom-start"
    :width="340"
    :persistent="false"
    :showArrow="false"
    :disabled="disabled || !src"
    :popperStyle="{ maxWidth: 'calc(100vw - 24px)', padding: '16px', borderRadius: '12px' }">
    <div class="gridSplitPanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @keydown.esc.prevent="visible = false; trigger?.focus()">
      <div class="panelHeader">
        <strong>宫格切分</strong>
        <span>保留原图</span>
      </div>
      <div class="gridPresets" aria-label="常用宫格">
        <button
          v-for="size in [2, 3, 4, 5]"
          :key="size"
          type="button"
          class="presetButton"
          :class="{ active: rows === size && columns === size }"
          :aria-pressed="rows === size && columns === size"
          :disabled="splitting"
          @click="rows = columns = size">
          <span class="presetIcon" :style="{ gridTemplateColumns: `repeat(${size}, 1fr)` }" aria-hidden="true">
            <i v-for="cell in size * size" :key="cell" />
          </span>
          <span>{{ size * size }} 宫格</span>
          <small>{{ size }} × {{ size }}</small>
        </button>
      </div>
      <div class="customGrid">
        <label><span>行数</span><el-input-number v-model="rows" :min="1" :max="10" :precision="0" :disabled="splitting" controlsPosition="right" aria-label="切分行数" /></label>
        <span class="gridMultiply">×</span>
        <label><span>列数</span><el-input-number v-model="columns" :min="1" :max="10" :precision="0" :disabled="splitting" controlsPosition="right" aria-label="切分列数" /></label>
      </div>
      <div v-if="visible" class="previewArea">
        <div class="previewImage">
          <img :src="src" alt="宫格切分预览" @load="readSize" @error="imageSize = { width: 0, height: 0 }" />
          <div v-if="validGrid" class="previewGrid" :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }" aria-hidden="true">
            <span v-for="cell in rows * columns" :key="cell"><small>{{ cell }}</small></span>
          </div>
        </div>
      </div>
      <div class="splitSummary" aria-live="polite">
        <span>{{ validGrid ? `共 ${rows * columns} 张图片` : '请设置有效行列数' }}</span>
        <span>从左到右，逐行切分</span>
      </div>
      <el-button class="splitButton" type="primary" :loading="splitting" :disabled="!canSplit || disabled" @click="splitImage">
        {{ splitting ? `正在切分 ${completed} / ${rows * columns}` : '切分为图片节点' }}
      </el-button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow, type Node } from "@vue-flow/core";
import { ElButton, ElInputNumber, ElMessage, ElPopover } from "element-plus";
import { uploadNodeFile, useNodeFiles, type WorkspaceFiles } from "@toonflow/nodes-scaffold/runtime";
import { assetIndexPath, createClip, defaultProjectPath, ratioOptions, type AssetIndex, type AssetIndexCard, type MtrackClip, type MtrackProject } from "@toonflow/node-shared/mtrack/mtrackProject";
import { showNodeError } from "@toonflow/node-shared/showNodeError";

type SplitGridTile = { nodeId: string; cardId: string; path: string };
type SplitGridResult = { tiles: SplitGridTile[]; projectPath: string; assetIndexPath: string };
/** 待落盘的一格：图片节点 + 该格在节点素材目录里的路径。 */
type SplitTile = { node: Node; path: string };

const props = defineProps<{ src: string; disabled?: boolean; active: boolean }>();
const { node } = useNode();
const { addNodes, findNode, getNodes, getSelectedNodes, nodeTypes, onNodeDragStart, onSelectionStart, onMoveStart } = useVueFlow();
const files = useNodeFiles();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const visible = ref(false);
const trigger = ref<HTMLElement>();
const rows = ref(3);
const columns = ref(3);
const splitting = ref(false);
const completed = ref(0);
const imageSize = ref({ width: 0, height: 0 });
/** ACT: 每轴最多 10 格（100 张），逐张编码上传以控制内存；更大批量需加入分批任务后再放开。 */
function isValidGrid(rowCount: number, columnCount: number) {
  return [rowCount, columnCount].every(value => Number.isInteger(value) && value >= 1 && value <= 10);
}
const validGrid = computed(() => isValidGrid(rows.value, columns.value));
const canSplit = computed(() => validGrid.value && rows.value * columns.value > 1 && imageSize.value.width >= columns.value && imageSize.value.height >= rows.value);
let splitController: AbortController | undefined;
// ACT: 切分面板没有比例设置，工程统一按竖屏 9:16 建（与多轨编辑器新建空白工程一致），分辨率沿用 createClip 的 768P，用户可在编辑器里改。
const splitRatio = ratioOptions[0];

watch(() => props.src, () => {
  splitController?.abort();
  imageSize.value = { width: 0, height: 0 };
}, { flush: "sync" });
watch(() => props.disabled, disabled => {
  if (disabled) { splitController?.abort(); visible.value = false; }
}, { flush: "sync" });
watch(() => props.active, active => { if (!active) visible.value = false; });
watch(() => getSelectedNodes.value.length, count => { if (count !== 1) visible.value = false; });
watch(() => getCanvas?.()?.id, () => { splitController?.abort(); visible.value = false; }, { flush: "sync" });
onNodeDragStart(() => { visible.value = false; });
onSelectionStart(() => { visible.value = false; });
onMoveStart(() => { visible.value = false; });
onBeforeUnmount(() => splitController?.abort());

function open(event: MouseEvent) {
  if (props.disabled || !props.src) return;
  trigger.value = event.currentTarget as HTMLElement;
  visible.value = !visible.value;
}

defineExpose({ open, splitting, splitGrid });

function readSize(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  imageSize.value = { width: image.naturalWidth, height: image.naturalHeight };
}

/** 切分不覆盖用户已编辑的计划文件：默认工程或资产索引任一被占用就直接拒绝，不追加也不合并。 */
async function requireNewPlanFiles(workspace: WorkspaceFiles) {
  const paths = await workspace.list("plan")
    .then(({ entries }) => entries.map(entry => entry.path))
    // 计划目录还不存在属正常（全新项目）；其余读取失败照常抛出，不把未知状态当成可写。
    .catch((reason: { response?: { data?: { data?: { code?: string } } } }): string[] => {
      if (reason.response?.data?.data?.code === "ENOENT") return [];
      throw reason;
    });
  for (const path of [defaultProjectPath, assetIndexPath]) {
    if (paths.includes(path)) throw new Error(`${path} 已存在，未覆盖`);
  }
}

/** 独占写：目标已存在一律映射成同一条中文提示，绝不覆盖。 */
async function writeExclusive(workspace: WorkspaceFiles, path: string, data: unknown) {
  await workspace.writeJson(path, data, true).catch((reason: { response?: { data?: { data?: { code?: string } } } }) => {
    if (reason.response?.data?.data?.code === "EEXIST") throw new Error(`${path} 已存在，未覆盖`);
    throw reason;
  });
}

/** 每格一镜落多轨工程与资产索引：只建工程、不派工，每镜的参考指向该格图片节点。 */
async function writeSplitProject(workspace: WorkspaceFiles, tiles: SplitTile[]): Promise<SplitGridResult> {
  // 工作区写入不建父目录，全新项目里没有 plan/，先补建单层目录；EEXIST（目录已存在）属正常。
  await workspace.mkdir("plan").catch((reason: { response?: { data?: { data?: { code?: string } } } }) => {
    if (reason.response?.data?.data?.code !== "EEXIST") throw reason;
  });
  const clips: MtrackClip[] = [];
  const cards: AssetIndexCard[] = [];
  const results: SplitGridTile[] = [];
  tiles.forEach(({ node: tile, path }, index) => {
    // ACT: 卡片 id 沿用既有 C01 习惯，编号与镜号同序（从左到右、逐行）。
    const cardId = `C${String(index + 1).padStart(2, "0")}`;
    const title = String(tile.data.label || "");
    // 卡片形状按 AssetIndexCard：id/name/textOnly/nodeId；切图不分类别，故不写 kind。
    cards.push({ id: cardId, name: title, textOnly: false, nodeId: tile.id });
    clips.push({ ...createClip(index, splitRatio), title, referenceIds: [cardId] });
    results.push({ nodeId: tile.id, cardId, path });
  });
  const index: AssetIndex = { version: "assetIndex-v1", cards };
  const project: MtrackProject = {
    version: 1,
    projectId: `mtrack-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    global: { ratio: splitRatio },
    clips,
  };
  // 先写索引再写工程：工程里的 referenceIds 只有索引已落盘时才能被 connectReferences 解析。
  await writeExclusive(workspace, assetIndexPath, index);
  try {
    await writeExclusive(workspace, defaultProjectPath, project);
  } catch (error) {
    // ACT: 工程写失败时删掉刚建的索引（独占写成功才走到这里，删的是本次产物），不留半截现场堵住重试。
    await workspace.remove(assetIndexPath).catch(() => {});
    throw error;
  }
  return { tiles: results, projectPath: defaultProjectPath, assetIndexPath };
}

/** 切图主流程：面板按钮与 node:splitGrid 共用，成功返回新增节点与落盘路径，失败一律抛出。 */
async function runSplit(rowCount: number, columnCount: number, src: string, signal?: AbortSignal): Promise<SplitGridResult> {
  splitting.value = true;
  completed.value = 0;
  const controller = splitController = new AbortController();
  // node:splitGrid 的单次调用有 120 秒超时，外部中断要能停掉逐张上传；面板按钮只依赖组件内 controller。
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const source = new Image();
  const canvas = document.createElement("canvas");
  const pendingIds: string[] = [];
  const tiles: SplitTile[] = [];
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let committed = false;
  try {
    controller.signal.throwIfAborted();
    workspace = files.getWorkspaceFiles();
    await requireNewPlanFiles(workspace);
    source.src = src;
    await source.decode();
    controller.signal.throwIfAborted();
    const { naturalWidth: width, naturalHeight: height } = source;
    if (width < columnCount || height < rowCount) throw new Error("图片尺寸小于切分行列数");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片画布");
    for (let row = 0; row < rowCount; row++) {
      for (let column = 0; column < columnCount; column++) {
        controller.signal.throwIfAborted();
        // 使用相邻整数边界，不能整除的尺寸也不会丢失或重复边缘像素。
        const left = Math.floor(column * width / columnCount);
        const top = Math.floor(row * height / rowCount);
        canvas.width = Math.floor((column + 1) * width / columnCount) - left;
        canvas.height = Math.floor((row + 1) * height / rowCount) - top;
        context.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片切分失败")), "image/png"));
        controller.signal.throwIfAborted();
        const id = crypto.randomUUID();
        pendingIds.push(id);
        const path = await uploadNodeFile(workspace, id, new File([blob], "tile.png", { type: "image/png" }));
        controller.signal.throwIfAborted();
        tiles.push({
          path,
          node: {
            id,
            type: "remote-imageNode",
            position: { x: 0, y: 0 },
            data: { label: `${node.data.label || "图片"} · ${row + 1}-${column + 1}`, outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } } },
          },
        });
        completed.value++;
      }
    }
    if (findNode(node.id) !== node || !nodeTypes?.value?.["remote-imageNode"]) throw new Error("画布节点已变化，请重新切分");
    const tileWidth = Math.ceil(width / columnCount) / Math.floor(height / rowCount) * 240 + 18;
    const gridWidth = columnCount * (tileWidth + 40) - 40;
    const gridHeight = rowCount * 320 - 20;
    const x = node.computedPosition.x + node.dimensions.width + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + gridWidth && position.x + other.dimensions.width > x && position.y < y + gridHeight && position.y + other.dimensions.height > y) {
        y = position.y + other.dimensions.height + 40;
      }
    }
    tiles.forEach(({ node: item }, index) => {
      item.position = { x: x + index % columnCount * (tileWidth + 40), y: y + Math.floor(index / columnCount) * 320 };
    });
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      addNodes(tiles.map(({ node: item }) => item));
      committed = true;
    });
    return await writeSplitProject(workspace, tiles);
  } finally {
    signal?.removeEventListener("abort", abort);
    source.removeAttribute("src");
    canvas.width = canvas.height = 0;
    if (!committed && workspace) {
      const results = await Promise.allSettled(pendingIds.map(id => workspace!.remove(`assets/${id}`, true)));
      if (results.some(result => result.status === "rejected" && result.reason?.response?.data?.data?.code !== "ENOENT")) {
        ElMessage.error("切分中断，部分临时图片清理失败");
      }
    }
    splitting.value = false;
    splitController = undefined;
  }
}

/** node:splitGrid 入口：与面板按钮同一套切图与落盘逻辑，只是不依赖面板打开、预览尺寸与按钮状态。 */
async function splitGrid(rowCount: number, columnCount: number, src = props.src, signal?: AbortSignal): Promise<SplitGridResult> {
  if (splitting.value) throw new Error("正在切分，请稍后重试");
  if (!isValidGrid(rowCount, columnCount)) throw new Error("行数与列数需为 1 到 10 的整数");
  if (rowCount * columnCount <= 1) throw new Error("行数 × 列数需大于 1");
  if (!src) throw new Error("节点没有图片，无法切分");
  return runSplit(rowCount, columnCount, src, signal);
}

async function splitImage() {
  if (splitting.value || props.disabled || !canSplit.value) return;
  if (!nodeTypes?.value?.["remote-imageNode"]) return void ElMessage.error("请先启用图片节点插件");
  try {
    const result = await runSplit(rows.value, columns.value, props.src);
    visible.value = false;
    ElMessage.success(`已切分为 ${result.tiles.length} 个图片节点，并创建多轨工程 ${result.projectPath} 与资产索引 ${result.assetIndexPath}`);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) showNodeError(error, "宫格切分失败");
  }
}
</script>

<style scoped lang="scss">
.gridSplitPanel {
  color: var(--el-text-color-primary);

  .panelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;

    span { color: var(--el-text-color-secondary); font-size: 12px; }
  }

  .gridPresets {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;

    .presetButton {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 4px;
      border: 1px solid var(--el-border-color-light);
      border-radius: 8px;
      background: var(--el-fill-color-blank);
      color: var(--el-text-color-regular);
      font: inherit;
      font-size: 13px;
      cursor: pointer;

      &:hover, &.active { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
      &:disabled { cursor: wait; opacity: 0.65; }

      .presetIcon {
        display: grid;
        gap: 2px;
        width: 26px;
        height: 26px;
        margin-bottom: 2px;

        i { border-radius: 1px; background: currentColor; opacity: 0.65; }
      }

      small { font-size: 11px; opacity: 0.7; }
    }
  }

  .customGrid {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin: 14px 0;

    label {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      font-size: 12px;
      color: var(--el-text-color-regular);

      .el-input-number { width: 100%; }
    }

    .gridMultiply { line-height: 32px; color: var(--el-text-color-secondary); }
  }

  .previewArea {
    display: grid;
    place-items: center;
    height: 156px;
    padding: 8px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
    overflow: hidden;

    .previewImage {
      position: relative;
      max-width: 100%;

      img { display: block; max-width: 100%; max-height: 140px; }

      .previewGrid {
        position: absolute;
        inset: 0;
        display: grid;
        overflow: hidden;
        outline: 1px solid rgba(255, 255, 255, 0.8);

        > span {
          min-width: 0;
          min-height: 0;
          overflow: hidden;
          outline: 1px solid rgba(255, 255, 255, 0.8);

          small { display: inline-block; padding: 0 3px; background: rgba(0, 0, 0, 0.45); color: #fff; font-size: 10px; line-height: 14px; }
        }
      }
    }
  }

  .splitSummary {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 10px 0 14px;
    font-size: 12px;

    span:last-child { color: var(--el-text-color-secondary); }
  }

  .splitButton { width: 100%; }
}
</style>
