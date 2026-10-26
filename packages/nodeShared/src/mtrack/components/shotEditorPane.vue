<template>
  <section v-if="clip" class="shotEditorPane">
    <div class="sectionHeading">
      <h3 class="sectionTitle"><span class="stepIndex">02</span>镜头内容</h3>
      <details class="toolsDetails">
        <summary class="toolsSummary">镜头操作</summary>
        <div class="toolsPanel">
          <el-button size="small" @click="emit('duplicate')">复制</el-button>
          <el-button size="small" :disabled="index === 0" @click="emit('move', -1)">前移</el-button>
          <el-button size="small" :disabled="index === clipCount - 1" @click="emit('move', 1)">后移</el-button>
          <el-button size="small" type="danger" :disabled="clipCount <= 1" @click="emit('remove')">删除</el-button>
          <el-button v-if="canUndo" size="small" text @click="emit('undoRemove')">撤销删除</el-button>
          <el-button size="small" :type="clip.status === 'accepted' ? 'success' : 'default'" :disabled="clip.status !== 'generated' && clip.status !== 'accepted'" @click="emit('accept', clip.status !== 'accepted')">{{ clip.status === "accepted" ? "取消验收" : "验收" }}</el-button>
          <el-button size="small" :disabled="clip.status === 'generating'" @click="emit('regenerate')">重新生成本镜</el-button>
          <el-button size="small" :disabled="!rewriteEligible" :loading="rewriteBusy" @click="emit('rewrite', rewriteRules)">整理本镜提示词</el-button>
        </div>
      </details>
    </div>
    <div class="shotFields">
      <label class="field"><span class="fieldLabel">镜头名称</span><el-input :modelValue="clip.title" size="small" maxlength="120" @input="emit('patch', { title: String($event) })" /></label>
      <label class="field fieldNarrow"><span class="fieldLabel">时长 / 秒</span><el-input-number :modelValue="clip.seconds" size="small" :min="2" :max="60" :step="1" :stepStrictly="true" @change="emit('patch', { seconds: Number($event) })" /></label>
      <label class="field fieldNarrow"><span class="fieldLabel">画幅</span><el-select :modelValue="clip.ratio" size="small" @change="emit('patch', { ratio: String($event) })"><el-option v-for="ratio in ratioOptions" :key="ratio" :label="ratio" :value="ratio" /></el-select></label>
      <label class="field fieldNarrow"><span class="fieldLabel">分辨率</span><el-select :modelValue="clip.resolution" size="small" @change="emit('patch', { resolution: String($event) })"><el-option v-for="resolution in resolutionOptions" :key="resolution" :label="resolution" :value="resolution" /></el-select></label>
      <label class="field fieldInline"><span class="fieldLabel">生成声音</span><el-switch :modelValue="clip.generateAudio" @change="emit('patch', { generateAudio: Boolean($event) })" /></label>
    </div>
    <div class="promptSections">
      <template v-for="section in sections" :key="section.key"><label class="sectionField"><span class="sectionLabel">{{ section.label }}</span><el-input :modelValue="draft[section.key]" type="textarea" :rows="section.rows" resize="vertical" :placeholder="section.placeholder" @input="onSectionInput(section.key, String($event))" /></label></template>
    </div>
    <label v-if="index > 0" class="continuityField"><span class="fieldLabel">镜头衔接</span><el-select :modelValue="clip.continuity" size="small" @change="onContinuityChange(String($event))"><el-option v-for="value in continuityOptions" :key="value" :label="continuityLabels[value]" :value="value" /></el-select></label>
    <p v-if="index === 0" class="continuityHint">首镜必须独立起拍：没有上一镜可承接。</p>
    <p v-else-if="isContext" class="continuityHint continuityHintActive">本镜承接 <strong>{{ previousClipId }}</strong>：由引擎加载该镜的原生音视频上下文继续生成，成片时长不变。<strong>时长至少 10 秒</strong>、参考素材<strong>最多 3 个</strong>（图片/视频/音频合计，引擎限制）；{{ previousClipJobId ? `上一镜任务号 ${previousClipJobId}` : `${previousClipId} 还没有可用的生成任务号，需要先生成它` }}。</p>
    <p v-else class="continuityHint">独立起拍 / 有意切镜：不读取上一镜的上下文，参考素材最多 4 个。</p>
    <p v-if="isContext && clip.referenceIds.length > 3" class="continuityHint continuityHintWarn" role="alert">本镜已选 {{ clip.referenceIds.length }} 个参考素材，超出续接上限 3 个（图片/视频/音频合计）；请减少参考，或把衔接方式改为独立起拍。</p>
    <p v-if="isContext && clip.seconds < 10" class="continuityHint continuityHintWarn" role="alert">本镜时长 {{ clip.seconds }} 秒，短于续接下限 10 秒；请加长本镜，或把衔接方式改为独立起拍。</p>
    <details class="rulesDetails"><summary class="rulesSummary">整理规则 · {{ rewriteRules.trim() ? "已自定义" : "服务端内置" }}</summary><el-input v-model="rewriteRules" type="textarea" :rows="4" maxlength="20000" placeholder="留空则用服务端内置规则；填写后整段替换内置规则。规则只用于本次整理，不写入工程。" /></details>
    <section v-if="rewritePending" class="pendingPanel" aria-live="polite"><header class="pendingHeader"><span class="pendingTitle">整理结果待采用</span><span class="pendingMeta">本次整理规则：{{ rewritePending.basis.rules ? "自定义" : "服务端内置" }}</span></header><div class="pendingBody"><div class="pendingColumn"><span class="fieldLabel">原文（整理前，只读）</span><p class="pendingOriginal" :title="rewritePending.basis.text">{{ rewritePending.basis.text || "（原文为空）" }}</p></div><div class="pendingColumn"><span class="fieldLabel">整理结果（可编辑）</span><el-input type="textarea" :rows="6" :modelValue="rewritePending.text" @input="emit('updateRewriteDraft', String($event))" /></div></div><p v-if="rewriteBasisChanged" class="pendingGuard" role="alert">本镜原文、时长或整理规则已变化，请核对整理结果后重新整理</p><div class="pendingActions"><el-button size="small" type="primary" :disabled="rewriteBasisChanged || !rewritePending.text.trim()" @click="emit('adoptRewrite', rewritePending.text)">采用整理结果</el-button><el-button size="small" @click="emit('discardRewrite')">放弃</el-button></div></section>
  </section>
  <p v-else class="paneEmpty">选中一个镜头后在这里编辑内容。</p>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch } from "element-plus";
import { continuityLabels, continuityOptions, normalizeContinuity, promptToText, ratioOptions, resolutionOptions, type ClipPrompt, type MtrackClip } from "../mtrackProject";
import { firstFrameInstruction } from "../mediaDispatch";

type RewriteBasis = { text: string; seconds: number; rules: string };
type RewritePending = { clipId: string; text: string; basis: RewriteBasis };

const props = defineProps<{ clip?: MtrackClip; index: number; clipCount: number; previousClipId?: string; previousClipJobId?: string; rewriteBusy?: boolean; rewritePending?: RewritePending; canUndo?: boolean; }>();

const emit = defineEmits<{ (e: "patch", patch: Partial<MtrackClip>): void; (e: "duplicate"): void; (e: "move", offset: number): void; (e: "remove"): void; (e: "accept", accepted: boolean): void; (e: "rewrite", rules: string): void; (e: "regenerate"): void; (e: "adoptRewrite", text: string): void; (e: "discardRewrite"): void; (e: "updateRewriteDraft", text: string): void; (e: "undoRemove"): void; }>();

const rewriteRules = ref("");
const isContext = computed(() => Boolean(props.clip && props.clip.continuity === "context"));
const rewriteEligible = computed(() => { const clip = props.clip; if (!clip) return false; return Object.values(clip.prompt).some(value => value.trim()); });

const rewriteBasisChanged = computed(() => {
  const pending = props.rewritePending; const clip = props.clip;
  if (!pending || !clip) return false;
  return pending.basis.text !== promptToText(clip.prompt) || pending.basis.seconds !== clip.seconds || pending.basis.rules !== rewriteRules.value.trim();
});

function onContinuityChange(value: string) { emit("patch", { continuity: normalizeContinuity(value) }); }

const fullSections: { key: keyof ClipPrompt; label: string; rows: number; placeholder: string }[] = [
  { key: "subjectDefinitions", label: "subject_definitions:", rows: 4, placeholder: "逐项定义 <Subject N> / <Picture N> / <Video N> / <Audio N> 的参考来源与特征。" },
  { key: "summary", label: "summary:", rows: 3, placeholder: "[reference generation] 用一段话总结任务类型、目标视频与主要参考关系。" },
  { key: "retentionAnalysis", label: "retention_analysis:", rows: 4, placeholder: "逐个参考标签写保留关系，如 <Subject 1> (appears in [Shot 1]): fully_preserved - ..." },
  { key: "detailedDescription", label: "detailed_description:", rows: 14, placeholder: "按 [Shot 1] / [Shot 2] At MM:SS.mmm 顺序写画面、动作、镜头运动、声音与对白，在恰当位置插入 <Picture N> / <Video N> / <Audio N>。" },
  { key: "overallSoundscape", label: "overall_soundscape:", rows: 3, placeholder: "概述贯穿全片的环境声、物理动作声与非人声。" },
  { key: "nonDiegeticMusic", label: "non_diegetic_music:", rows: 3, placeholder: "描述只有观众能听到的背景音乐。" },
];

const draft = ref<ClipPrompt>({ subjectDefinitions: "", summary: "", retentionAnalysis: "", detailedDescription: "", overallSoundscape: "", nonDiegeticMusic: "" });
let editingClipId = "";

function isDegradeMode(): boolean { const clip = props.clip; return !clip || clip.referenceIds.length === 0; }
function isFirstFrameMode(): boolean { const clip = props.clip; return Boolean(clip && clip.mode === "image" && clip.referenceIds.length === 1); }

const sections = computed(() => isDegradeMode() ? fullSections.filter(item => item.key === "detailedDescription" || item.key === "overallSoundscape" || item.key === "nonDiegeticMusic") : fullSections);

function prependFirstFrame(body: string): string { if (!isFirstFrameMode()) return body; if (body.startsWith(firstFrameInstruction)) return body; return body === "" ? firstFrameInstruction + "\n\n" : firstFrameInstruction + "\n\n" + body; }
function stripFirstFrame(body: string): string { if (!isFirstFrameMode()) return body; return body.startsWith(firstFrameInstruction) ? body.slice(firstFrameInstruction.length).replace(/^\r?\n/, "") : body; }

watch(() => props.clip && { clipId: props.clip.clipId, prompt: props.clip.prompt }, state => {
  if (!state) { editingClipId = ""; draft.value = { subjectDefinitions: "", summary: "", retentionAnalysis: "", detailedDescription: "", overallSoundscape: "", nonDiegeticMusic: "" }; return; }
  if (state.clipId !== editingClipId) {
    editingClipId = state.clipId;
    draft.value = { subjectDefinitions: state.prompt.subjectDefinitions, summary: state.prompt.summary, retentionAnalysis: state.prompt.retentionAnalysis, detailedDescription: prependFirstFrame(stripFirstFrame(state.prompt.detailedDescription)), overallSoundscape: state.prompt.overallSoundscape, nonDiegeticMusic: state.prompt.nonDiegeticMusic };
    return;
  }
  if (stripFirstFrame(state.prompt.detailedDescription) !== draft.value.detailedDescription) {
    draft.value.detailedDescription = prependFirstFrame(stripFirstFrame(state.prompt.detailedDescription));
  }
}, { immediate: true, deep: true });

function onSectionInput(key: keyof ClipPrompt, value: string) {
  draft.value[key] = value;
  const clip = props.clip;
  if (!clip) return;
  const outgoing: ClipPrompt = { ...clip.prompt };
  if (key === "detailedDescription" && isFirstFrameMode()) outgoing.detailedDescription = prependFirstFrame(value);
  else outgoing[key] = value;
  const current = clip.prompt; let same = true;
  for (const k of Object.keys(outgoing) as (keyof ClipPrompt)[]) { if (outgoing[k] === current[k]) continue; same = false; break; }
  if (same) return;
  emit("patch", { prompt: outgoing });
}
</script>

<style scoped>
.shotEditorPane { display: flex; flex: 1 1 auto; flex-direction: column; gap: 10px; min-width: 0; }
.sectionHeading { display: flex; position: relative; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.sectionTitle { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 650; }
.stepIndex { color: var(--el-color-primary); font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: 0.08em; }
.toolsDetails { margin: 0; }
.toolsSummary { padding: 4px 10px; border: 1px solid var(--el-border-color); border-radius: 7px; background: var(--el-bg-color); font-size: 12px; font-weight: 500; list-style: none; cursor: pointer; user-select: none; }
.toolsSummary::-webkit-details-marker { display: none; }
.toolsPanel { position: absolute; z-index: 6; display: flex; flex-wrap: wrap; gap: 6px; max-width: 480px; padding: 10px 12px; border: 1px solid var(--el-border-color); border-radius: 10px; background: var(--el-bg-color); box-shadow: var(--el-box-shadow-light); }
.shotFields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 160px; min-width: 150px; }
.fieldNarrow { flex: 0 0 120px; min-width: 0; }
.fieldInline { flex-direction: row; align-items: center; gap: 8px; flex: 0 0 auto; min-width: 0; }
.fieldLabel { color: var(--el-text-color-secondary); font-size: 12px; }
.promptSections { display: flex; flex-direction: column; gap: 10px; }
.sectionField { display: flex; flex-direction: column; gap: 4px; }
.sectionLabel { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 600; font-family: "Cascadia Mono", Consolas, monospace; letter-spacing: 0.02em; }
.continuityField { display: flex; align-items: center; gap: 8px; width: 240px; }
.continuityHint { margin: -2px 0 2px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.continuityHintActive { padding: 8px 10px; border: 1px solid var(--el-color-primary-light-7); border-radius: 8px; color: var(--el-text-color-regular); background: var(--el-color-primary-light-9); }
.continuityHintWarn { padding: 8px 10px; border: 1px solid var(--el-color-warning-light-5); border-radius: 8px; color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); }
.rulesDetails { margin: 0; }
.rulesSummary { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--el-border-color); border-radius: 7px; background: var(--el-bg-color); font-size: 12px; font-weight: 500; list-style: none; cursor: pointer; user-select: none; }
.rulesSummary::-webkit-details-marker { display: none; }
.rulesDetails[open] .rulesSummary { margin-bottom: 8px; }
.pendingPanel { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--el-color-primary-light-7); border-radius: 10px; background: var(--el-color-primary-light-9); }
.pendingHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.pendingTitle { font-size: 13px; font-weight: 600; }
.pendingMeta { color: var(--el-text-color-secondary); font-size: 11px; }
.pendingBody { display: flex; flex-wrap: wrap; gap: 12px; }
.pendingColumn { display: flex; flex-direction: column; flex: 1 1 240px; gap: 4px; min-width: 0; }
.pendingOriginal { display: -webkit-box; max-height: 144px; margin: 0; padding: 6px 8px; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 6; }
.pendingGuard { margin: 0; color: var(--el-color-warning); font-size: 12px; line-height: 1.6; }
.pendingActions { display: flex; flex-wrap: wrap; gap: 8px; }
.paneEmpty { margin: 0; padding: 24px 16px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
