<template>
  <section v-if="clip" class="clipEditor">
    <div class="editorActions">
      <el-button size="small" @click="emit('duplicate')">复制</el-button>
      <el-button size="small" :disabled="index === 0" @click="emit('move', -1)">前移</el-button>
      <el-button size="small" :disabled="index === clipCount - 1" @click="emit('move', 1)">后移</el-button>
      <el-button
        size="small"
        :type="clip.status === 'accepted' ? 'success' : 'default'"
        :disabled="clip.status !== 'generated' && clip.status !== 'accepted'"
        @click="emit('accept', clip.status !== 'accepted')"
      >
        {{ clip.status === "accepted" ? "取消验收" : "验收" }}
      </el-button>
      <el-button size="small" :disabled="!rewriteEligible" :loading="rewriteBusy" @click="emit('rewrite', rewriteRules)">整理本镜提示词</el-button>
      <el-button size="small" type="danger" text @click="emit('remove')">删除</el-button>
      <details class="bulkDetails">
        <summary class="bulkSummary">批量调整</summary>
        <div class="bulkPanel">
          <h3 class="bulkTitle">批量调整镜头</h3>
          <div class="bulkControls">
            <label class="bulkField">
              统一时长 / 秒
              <el-input-number v-model="bulkSeconds" size="small" :min="2" :max="60" :step="1" :stepStrictly="true" />
            </label>
            <el-button size="small" @click="emit('bulkDuration', bulkSeconds)">应用到全部镜头</el-button>
            <label class="bulkField">
              添加镜头数
              <el-input-number v-model="bulkAddCount" size="small" :min="1" :max="100" :step="1" :stepStrictly="true" />
            </label>
            <el-button size="small" @click="emit('bulkAdd', bulkAddCount)">批量添加</el-button>
          </div>
          <p class="bulkHint">新镜头默认 5 秒；统一时长按工程契约限制在 2–60 秒整数内。</p>
        </div>
      </details>
    </div>
    <div class="fieldRow">
      <label class="field">
        <span class="fieldLabel">标题</span>
        <el-input :modelValue="clip.title" size="small" maxlength="120" @input="onPatch({ title: String($event) })" />
      </label>
      <label class="field fieldNarrow">
        <span class="fieldLabel">时长（秒）</span>
        <el-input-number
          :modelValue="clip.seconds"
          size="small"
          :min="2"
          :max="60"
          :step="1"
          :stepStrictly="true"
          @change="onPatch({ seconds: Number($event) })"
        />
      </label>
    </div>
    <div class="fieldRow">
      <label class="field">
        <span class="fieldLabel">衔接</span>
        <el-select :modelValue="clip.continuity" size="small" @change="onPatch({ continuity: String($event) })">
          <el-option label="start（本段重新起）" value="start" />
          <el-option label="continue（承接上一镜）" value="continue" />
          <el-option label="cut（直接切换）" value="cut" />
        </el-select>
      </label>
      <label class="field">
        <span class="fieldLabel">比例</span>
        <el-select :modelValue="clip.ratio" size="small" @change="onPatch({ ratio: String($event) })">
          <el-option v-for="ratio in ratioOptions" :key="ratio" :label="ratio" :value="ratio" />
        </el-select>
      </label>
      <label class="field">
        <span class="fieldLabel">分辨率</span>
        <el-select :modelValue="clip.resolution" size="small" @change="onPatch({ resolution: String($event) })">
          <el-option v-for="resolution in resolutionOptions" :key="resolution" :label="resolution" :value="resolution" />
        </el-select>
      </label>
      <label class="field fieldInline">
        <span class="fieldLabel">生成声音</span>
        <el-switch :modelValue="clip.generateAudio" @change="onPatch({ generateAudio: Boolean($event) })" />
      </label>
      <span class="fieldMeta">{{ clip.resolution }} · {{ clip.ratio }} · 24fps</span>
    </div>
    <div class="fieldColumn">
      <span class="fieldLabel">参考顺序（序号即 &#123;&#123;ref N&#125;&#125;）</span>
      <details class="refDetails">
        <summary class="refSummary">选择参考图 · {{ clip.referenceIds.length }}</summary>
        <referenceList
          :modelValue="clip.referenceIds"
          :indexCards="indexCards"
          :thumbnails="thumbnails"
          @update:modelValue="onPatch({ referenceIds: $event })"
        />
      </details>
    </div>
    <label class="fieldColumn">
      <span class="fieldLabel">画面 / 动作 / 对白</span>
      <el-input
        type="textarea"
        :rows="5"
        :modelValue="clip.prompt.integratedMultimodalDescription"
        @input="onPatch({ prompt: { ...clip.prompt, integratedMultimodalDescription: String($event) } })"
      />
    </label>
    <div class="fieldRow fieldPair">
      <label class="fieldColumn">
        <span class="fieldLabel">环境声</span>
        <el-input
          type="textarea"
          :rows="2"
          :modelValue="clip.prompt.overallSoundscape"
          @input="onPatch({ prompt: { ...clip.prompt, overallSoundscape: String($event) } })"
        />
      </label>
      <label class="fieldColumn">
        <span class="fieldLabel">配乐</span>
        <el-input
          type="textarea"
          :rows="2"
          :modelValue="clip.prompt.nonDiegeticMusic"
          @input="onPatch({ prompt: { ...clip.prompt, nonDiegeticMusic: String($event) } })"
        />
      </label>
    </div>
    <details class="rulesDetails">
      <summary class="rulesSummary">整理规则 · {{ rewriteRules.trim() ? "已自定义" : "服务端内置" }}</summary>
      <el-input
        v-model="rewriteRules"
        type="textarea"
        :rows="4"
        maxlength="20000"
        placeholder="留空则用服务端内置规则；填写后整段替换内置规则。规则只用于本次整理，不写入工程。"
      />
    </details>
    <section v-if="rewritePending" class="pendingPanel" aria-live="polite">
      <header class="pendingHeader">
        <span class="pendingTitle">整理结果待采用</span>
        <span class="pendingMeta">本次整理规则：{{ rewritePending.basis.rules ? "自定义" : "服务端内置" }}</span>
      </header>
      <div class="pendingBody">
        <div class="pendingColumn">
          <span class="fieldLabel">原文（整理前，只读）</span>
          <p class="pendingOriginal" :title="rewritePending.basis.text">{{ rewritePending.basis.text || "（原文为空）" }}</p>
        </div>
        <div class="pendingColumn">
          <span class="fieldLabel">整理结果（可编辑）</span>
          <el-input
            type="textarea"
            :rows="6"
            :modelValue="rewritePending.text"
            @input="emit('updateRewriteDraft', String($event))"
          />
        </div>
      </div>
      <p v-if="rewriteBasisChanged" class="pendingGuard" role="alert">本镜原文、时长或整理规则已变化，请核对整理结果后重新整理</p>
      <div class="pendingActions">
        <el-button
          size="small"
          type="primary"
          :disabled="rewriteBasisChanged || !rewritePending.text.trim()"
          @click="emit('adoptRewrite', rewritePending.text)"
        >
          采用整理结果
        </el-button>
        <el-button size="small" @click="emit('discardRewrite')">放弃</el-button>
      </div>
    </section>
  </section>
  <p v-else class="editorEmpty">选中一个片段后在这里编辑。</p>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch } from "element-plus";
import type { MtrackClip } from "../mtrackProject";
import { ratioOptions, resolutionOptions, type AssetIndexCard } from "../mtrackProject";
import referenceList from "./referenceList.vue";

const props = defineProps<{
  clip?: MtrackClip;
  index: number;
  clipCount: number;
  indexCards: AssetIndexCard[];
  /** cardId → 缩略图 URL；父组件经画布桥反查后传入，未解析的卡片显示占位。 */
  thumbnails?: Record<string, string>;
  /** 整理按钮忙碌态：请求在飞行中，父组件持有。 */
  rewriteBusy?: boolean;
  /** 整理结果的待采用稿；basis 为发请求那一刻的原文画面描述、时长与整理规则，用于一致性守卫。 */
  rewritePending?: RewritePending;
}>();

const emit = defineEmits<{
  (event: "patch", patch: Partial<MtrackClip>): void;
  (event: "duplicate"): void;
  (event: "move", offset: number): void;
  (event: "remove"): void;
  (event: "accept", accepted: boolean): void;
  (event: "rewrite", rules: string): void;
  (event: "adoptRewrite", text: string): void;
  (event: "discardRewrite"): void;
  (event: "updateRewriteDraft", text: string): void;
  (event: "bulkDuration", seconds: number): void;
  (event: "bulkAdd", count: number): void;
}>();

type RewriteBasis = { text: string; seconds: number; rules: string };
type RewritePending = { clipId: string; text: string; basis: RewriteBasis };

/** 整理规则只活在组件内：本次一次性指定，不落盘、不随工程保存，刷新即回内置规则。 */
const rewriteRules = ref("");
const bulkSeconds = ref(5);
const bulkAddCount = ref(1);

const thumbnails = computed(() => props.thumbnails ?? {});

const rewriteEligible = computed(() => {
  const prompt = props.clip?.prompt;
  return Boolean(prompt && [prompt.integratedMultimodalDescription, prompt.overallSoundscape, prompt.nonDiegeticMusic].some(text => text.trim()));
});

/** 一致性守卫：待采用期间原文画面描述、时长或整理规则任一变化，旧稿就不能再套到新基线上。 */
const rewriteBasisChanged = computed(() => {
  const pending = props.rewritePending;
  const clip = props.clip;
  if (!pending || !clip) return false;
  return pending.basis.text !== clip.prompt.integratedMultimodalDescription
    || pending.basis.seconds !== clip.seconds
    || pending.basis.rules !== rewriteRules.value.trim();
});

function onPatch(patch: Partial<MtrackClip>) {
  emit("patch", patch);
}
</script>

<style scoped>
.clipEditor {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px 16px 16px;
}

.editorActions {
  display: flex;
  position: relative;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.bulkDetails {
  margin: 0;
}

.bulkSummary {
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

.bulkSummary::-webkit-details-marker {
  display: none;
}

/* ACT: 面板从按钮向右展开，包含块是整行动作区，所以 max-width: 100% 会跟着左栏一起收窄，
   窄容器下不会横向溢出。照抄 LSC 的 right:0 会让 480px 面板越过左栏左边界被裁掉。 */
.bulkPanel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: auto;
  z-index: 6;
  width: 480px;
  max-width: 100%;
  padding: 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}

.bulkTitle {
  margin: 0 0 12px;
  font-size: 13px;
}

.bulkControls {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto minmax(120px, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin: 0;
}

.bulkField {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.bulkHint {
  margin: 12px 0 0;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  line-height: 1.6;
}

.fieldMeta {
  align-self: flex-end;
  margin-left: auto;
  padding-bottom: 5px;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.fieldRow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

/* 字段与 LSC 一致：普通字段 flex 均分铺满整行，窄字段固定不拉伸。 */
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 160px;
  min-width: 150px;
}

.fieldNarrow {
  flex: 0 0 160px;
  min-width: 0;
}

.fieldInline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
}

.fieldColumn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* 环境声 / 配乐并排时同样均分铺满，避免挤在行首留大片空白。 */
.fieldPair > .fieldColumn {
  flex: 1 1 240px;
}

.fieldLabel {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

/* 参考顺序默认折叠收纳在一行摘要里，展开才占纵向空间（对齐 LSC 的分布）。 */
.refDetails {
  margin: 0;
}

.refSummary {
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

.refSummary::-webkit-details-marker {
  display: none;
}

.refDetails[open] .refSummary {
  margin-bottom: 8px;
}

/* 整理规则默认折叠：只在需要换口径时展开，展开后整段替换服务端内置规则。 */
.rulesDetails {
  margin: 0;
}

.rulesSummary {
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

.rulesSummary::-webkit-details-marker {
  display: none;
}

.rulesDetails[open] .rulesSummary {
  margin-bottom: 8px;
}

/* 待采用区块：左原文只读、右整理稿可编辑，勾选采用前一个字都不写回画面描述。 */
.pendingPanel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 10px;
  background: var(--el-color-primary-light-9);
}

.pendingHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}

.pendingTitle {
  font-size: 13px;
  font-weight: 600;
}

.pendingMeta {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.pendingBody {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.pendingColumn {
  display: flex;
  flex-direction: column;
  flex: 1 1 240px;
  gap: 4px;
  min-width: 0;
}

/* 原文只读且截断显示：完整内容放 title，长段落不把待采用区块撑满一屏。 */
.pendingOriginal {
  display: -webkit-box;
  max-height: 144px;
  margin: 0;
  padding: 6px 8px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}

.pendingGuard {
  margin: 0;
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.6;
}

.pendingActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.editorEmpty {
  margin: 0;
  padding: 24px 16px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
