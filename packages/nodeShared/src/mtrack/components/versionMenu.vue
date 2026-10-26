<template>
  <details class="versionMenu" :class="{ previewing: previewing }">
    <summary class="versionSummary">
      <input
        v-if="mergeable"
        class="mergeChoice"
        type="checkbox"
        :checked="accepted"
        :disabled="disabled"
        :aria-label="`勾选${label}用于合并（验收）`"
        title="勾选此镜头用于合并（即验收）"
        @click.stop
        @change="emit('toggleAccept')" />
      <span class="versionTitle">{{ label }}</span>
      <span v-if="previewing" class="previewingBadge">当前</span>
      <span v-if="stale" class="staleBadge">待更新</span>
      <button
        type="button"
        class="clearAllButton"
        :disabled="disabled || versions.length === 0"
        title="永久删除本镜全部版本"
        @click.stop="emit('deleteAllVersions')">全部删除</button>
      <span class="versionArrow" aria-hidden="true">▾</span>
    </summary>
    <div class="versionList">
      <p v-if="!rows.length" class="versionEmpty">暂无历史版本。</p>
      <div v-for="item in rows" :key="item.key" class="versionRow">
        <button
          type="button"
          class="versionWatch"
          :aria-pressed="item.watching"
          :title="`版本 ${item.number} · ${item.name}`"
          @click.prevent.stop="emit('watch', item.key)">
          <span class="versionMark">{{ item.watching ? "✓" : "" }}</span>
          <span class="versionCaption">
            <strong>版本 {{ item.number }}</strong>
            <small v-if="item.status">{{ item.status }}</small>
          </span>
        </button>
        <button
          type="button"
          class="versionSetDefault"
          :disabled="item.isDefault || disabled"
          :title="item.isDefault ? '已是默认版本' : `设为默认 · ${item.name}`"
          @click.prevent.stop="emit('setDefault', item.key)">默认</button>
        <button
          type="button"
          class="versionDelete"
          :disabled="disabled"
          title="永久删除这个版本"
          @click.prevent.stop="emit('deleteVersion', item.key)">删除</button>
      </div>
    </div>
  </details>
</template>

<script lang="ts">
/** 一个历史版本行：number 旧→新，isDefault = 该镜默认版本（clip.assetPath），watching = 正在大预览里观看。宿主按此形状构造数组传入。 */
export interface VersionMenuItem {
  key: string;
  number: number;
  isDefault: boolean;
  watching: boolean;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  /** summary 标题，如「S003 · 追逐戏」或「选择视频版本 · 4 个」。 */
  label: string;
  versions: VersionMenuItem[];
  /** 有勾选「用于合并」的行（= clip.status 在 generated ⇄ accepted 间切换，由宿主回写）。 */
  mergeable?: boolean;
  accepted?: boolean;
  /** 生成中等操作期间禁用合并勾选与设为默认。 */
  disabled?: boolean;
  /** 本组版本所属镜头已落后于当前设置（对齐 LSC 的 stale）。 */
  stale?: boolean;
  /** 本组所属镜头正是大预览当前锁定的那一段（轨迹上的位置标识，不代表正在出声播放）。 */
  previewing?: boolean;
}>(), { mergeable: false, accepted: false, disabled: false, stale: false, previewing: false });

const emit = defineEmits<{
  (event: "watch", version: string): void;
  (event: "setDefault", version: string): void;
  (event: "toggleAccept"): void;
  (event: "deleteVersion", version: string): void;
  (event: "deleteAllVersions"): void;
}>();

/** 默认版本打「最新」（= clip.assetPath 那版），与正在观看并列成状态串，对齐 LSC 的版本行标记。 */
const rows = computed(() => props.versions.map(item => ({
  ...item,
  name: item.key.split("/").pop() || item.key,
  status: [item.isDefault ? "最新" : "", item.watching ? "正在观看" : ""].filter(Boolean).join(" · "),
})));
</script>

<style scoped>
.versionMenu {
  min-width: 0;
  border: 1px solid var(--el-border-color, #383c3b);
  border-radius: 8px;
  background: var(--el-bg-color, #202322);
}

.versionSummary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  list-style: none;
  font-size: 12px;
}

.versionSummary::-webkit-details-marker {
  display: none;
}

.versionMenu[open] > .versionSummary {
  border-bottom: 1px solid var(--el-border-color, #383c3b);
}

.mergeChoice {
  flex: none;
  margin: 0;
  cursor: pointer;
}

.versionTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.versionArrow {
  flex: none;
  opacity: 0.6;
}

.versionList {
  padding: 4px;
  max-height: 240px;
  overflow: auto;
}

.versionEmpty {
  margin: 0;
  padding: 6px 8px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.versionRow {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 5px;
}

.versionRow:hover {
  background: var(--el-fill-color, #303634);
}

.versionWatch {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px;
  color: inherit;
  cursor: pointer;
}

.versionWatch[aria-pressed="true"] {
  color: var(--el-color-success, #b9e3cf);
}

.versionMark {
  width: 14px;
  flex-shrink: 0;
}

.versionCaption {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
}

.versionCaption strong {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.versionCaption small {
  font-size: 10px;
  line-height: 1.4;
  color: var(--el-text-color-secondary, #a4b9af);
}

.versionWatch[aria-pressed="true"] .versionCaption small {
  color: var(--el-color-success-light-3, #b9e3cf);
}

.versionSetDefault {
  flex: none;
  padding: 5px 8px;
  border: 1px solid var(--el-border-color, #383c3b);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.versionSetDefault:hover:not(:disabled) {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.versionSetDefault:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 当前：左侧主色条 + 组头高亮，对应顶部「当前片段」；与「待更新」并存时各占一枚徽标。 */
.versionMenu.previewing {
  border-color: var(--el-color-primary, #409eff);
  box-shadow: inset 3px 0 0 var(--el-color-primary, #409eff);
}

.previewingBadge {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.staleBadge {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  color: var(--el-color-warning, #e6a23c);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.clearAllButton,
.versionDelete {
  flex: none;
  padding: 5px 8px;
  border: 1px solid var(--el-border-color, #383c3b);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.clearAllButton:hover:not(:disabled),
.versionDelete:hover:not(:disabled) {
  color: var(--el-color-danger, #f56c6c);
  border-color: var(--el-color-danger, #f56c6c);
}

.clearAllButton:disabled,
.versionDelete:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
