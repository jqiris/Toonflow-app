<template>
  <aside class="referencePicker" aria-label="参考素材">
    <h3 class="pickerTitle">参考素材</h3>
    <label class="modeField">
      <span class="fieldLabel">使用方式</span>
      <el-select :modelValue="modeValue" size="small" @change="onModeChange(String($event))">
        <el-option v-for="value in clipModeOptions" :key="value" :label="clipModeLabels[value]" :value="value" />
      </el-select>
    </label>
    <details class="refsDetails" open>
      <summary class="refsSummary">选择参考图 · {{ referenceIds.length }}/4</summary>
      <div v-if="items.length" class="refsGrid">
        <label
          v-for="item in items"
          :key="item.key"
          class="refCard"
          :class="{ picked: item.cardId && pickedSet.has(item.cardId), textOnly: item.textOnly === true, unbound: !item.cardId, stale: item.selectable === false }"
          :title="item.cardId ? (item.selectable === false ? '该素材没有连到本节点：不能新增勾选，取消勾选可清掉旧引用' : undefined) : '连线节点没有对应的资产卡，不能作为参考勾选'"
        >
          <img v-if="thumbnails[item.key]" class="refThumb" :src="thumbnails[item.key]" loading="lazy" alt="" />
          <span v-else class="refThumb refThumbEmpty">无预览</span>
          <input
            v-if="item.cardId"
            type="checkbox"
            class="refCheck"
            :checked="pickedSet.has(item.cardId)"
            :disabled="item.selectable === false && !pickedSet.has(item.cardId)"
            @change="toggle(item.cardId, ($event.target as HTMLInputElement).checked)"
          />
          <span v-else class="refBadge">非资产卡</span>
          <span class="refName">{{ item.cardId && pickedSet.has(item.cardId) ? `图${orderOf(item.cardId) + 1} · ` : "" }}{{ item.name }}</span>
        </label>
      </div>
      <!-- 画布卡片宿主：网格只列 in 端口连进来的来源，一条没连时给出明确的接法指引。 -->
      <p v-else-if="connectionBound" class="pickerHint">把素材卡连到本节点的参考输入端口后，这里会列出可勾选的参考。</p>
      <p v-else class="pickerHint">资产索引还没有卡片：先用九宫格拆图或 planOperator 生成 assetIndex。</p>
      <p v-if="detached.length" class="pickerHint detachedHint" role="alert">
        本镜参考清单里的 {{ detached.join("、") }} 已不在连线上：勾选状态下派工会按清单自动接线；只有该资产没有产出时才会报「参考图未就绪」，取消勾选即可清掉旧引用。
      </p>
    </details>
    <p class="pickerHint">{{ modeHint }}</p>
  </aside>
</template>

<script lang="ts">
/**
 * 网格条目：cardId 为可勾选的资产卡 id（勾选后写进 clip.referenceIds）；
 * cardId 为空串表示这只是一个连到 in 端口、但没对上资产卡的画布节点——展示占位，不可勾选。
 * key 用 cardId（有卡时）或来源节点 id（无卡时），供缩略图 map 与 v-for 使用。
 * selectable=false（画布宿主）：该卡当前没连在本节点上，只为清旧引用而留在网格里——
 * 不能新增勾选，已勾选的仍可取消（否则断线后的 referenceIds 旧值在界面上清不掉）。
 */
export interface ReferencePickerItem {
  key: string;
  cardId: string;
  name: string;
  textOnly?: boolean;
  selectable?: boolean;
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { ElOption, ElSelect } from "element-plus";
import { clipModeLabels, resolveClipMode, type ClipMode } from "../mtrackProject";

const props = defineProps<{
  /** 本镜参考集合（cardId 数组）；顺序即提示词里 {{ref N}} 的 N。 */
  referenceIds: string[];
  /**
   * 网格条目，由宿主按形态解析好再传入（位次语义不变，勾选仍写 cardId）：
   * - 画布卡片宿主：只列本节点 in 端口连线的来源（见 multitrackEditor 的 resolveConnectedItems，两套数据源的理由也写在那边）；
   * - 文档面板宿主：assetIndex.json 的全部资产卡。
   */
  items: ReferencePickerItem[];
  /** cardId（或占位条目的节点 id）→ 缩略图 URL；父组件反查后传入，未解析的条目显示占位。 */
  thumbnails?: Record<string, string>;
  /** 本镜显式 mode（可缺省，缺省按参考数量推断，与 resolveClipMode 同口径）。 */
  mode?: ClipMode;
  /** 画布卡片宿主（有连线语义）：空网格给出接法指引而不是旧的全项目口径文案。 */
  connectionBound?: boolean;
  /** 画布卡片宿主：本镜 referenceIds 里已不在连线上的卡（断线旧引用），非空时给清除指引。 */
  detachedIds?: string[];
}>();

const emit = defineEmits<{
  (event: "update:referenceIds", value: string[]): void;
  (event: "update:mode", value: ClipMode): void;
}>();

const thumbnails = computed(() => props.thumbnails ?? {});
const pickedSet = computed(() => new Set(props.referenceIds));
const detached = computed(() => props.detachedIds ?? []);

function orderOf(cardId: string): number {
  return props.referenceIds.indexOf(cardId);
}

const clipModeOptions: ClipMode[] = ["ref", "image", "text"];

const modeValue = computed(() => resolveClipMode({ mode: props.mode, referenceIds: props.referenceIds }));

function onModeChange(value: string) {
  if (value === "ref" || value === "image" || value === "text") emit("update:mode", value);
}

/** 上限沿用产品口径（独立镜头 4 张——供应商模式声明 imageReference:4，校验器 V8 阈值是 9、拦不到这一段；承接镜 3 张见 V16）：这里只做点满不再加、「非资产卡条目不可勾」与「断线卡不可新增勾选」的网格端拦截。 */
function toggle(cardId: string, checked: boolean) {
  const item = props.items.find(entry => entry.cardId === cardId);
  if (!cardId || !item) return;
  if (!checked) {
    emit("update:referenceIds", props.referenceIds.filter(id => id !== cardId));
    return;
  }
  if (item.selectable === false) return;
  if (pickedSet.value.has(cardId) || props.referenceIds.length >= 4) return;
  emit("update:referenceIds", [...props.referenceIds, cardId]);
}

const modeHint = computed(() => {
  if (modeValue.value === "text") return "当前仅使用文字，不会发送参考图。";
  if (modeValue.value === "image") return "请选择一张图片作为起始画面。";
  return "每个镜头最多选 4 个参考素材，按勾选顺序编号；承接上一镜的镜头最多 3 个（图片/视频/音频合计，引擎限制）。";
});
</script>

<style scoped>
.referencePicker {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  width: clamp(200px, 30%, 300px);
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-light);
}

.pickerTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}

.modeField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fieldLabel {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.refsDetails {
  margin: 0;
}

.refsSummary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  background: var(--el-bg-color);
  font-size: 12px;
  font-weight: 500;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.refsSummary::-webkit-details-marker {
  display: none;
}

.refsDetails[open] .refsSummary {
  margin-bottom: 8px;
}

.refsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}

.refCard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  cursor: pointer;
  transition: border-color 0.14s;
}

.refCard:hover {
  border-color: var(--el-color-primary-light-5);
}

.picked {
  border-color: var(--el-color-primary);
  box-shadow: inset 0 0 0 1px var(--el-color-primary);
}

/* 连到 in 端口但没有对应资产卡的节点：能看见、不能勾，置灰表达「不在参考链里」。 */
.unbound {
  cursor: default;
  opacity: 0.6;
}

.unbound:hover {
  border-color: var(--el-border-color);
}

/* 断线旧引用：置灰 + 虚线边，与连线上的可勾卡一眼分开。 */
.stale {
  border-style: dashed;
  opacity: 0.6;
}

.refCheck {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
}

.refBadge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  font-size: 10px;
}

.refThumb {
  width: 100%;
  height: 64px;
  border-radius: 5px;
  object-fit: contain;
  background: var(--el-fill-color-darker);
}

.refThumbEmpty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-disabled);
  font-size: 11px;
}

.textOnly .refThumb {
  height: 30px;
}

.refName {
  overflow: hidden;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pickerHint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.7;
}

.detachedHint {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
</style>
