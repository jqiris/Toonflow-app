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
          <el-button size="small" :disabled="clip.status === 'generating' || batchRunning || batchPaused" @click="emit('regenerate')">重新生成本镜</el-button>
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
      <label class="field fieldNarrow"><span class="fieldLabel">质量</span><el-select :modelValue="clip.quality" size="small" @change="onQualityChange"><el-option v-for="option in qualityOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></label>
      <label class="field fieldInline"><span class="fieldLabel">二次采样</span><el-switch :modelValue="clip.secondPass" @change="emit('patch', { secondPass: Boolean($event) })" /></label>
      <label class="field fieldInline"><span class="fieldLabel">先出预览</span><el-switch :modelValue="clip.preview" :disabled="previewDisabled" @change="emit('patch', { preview: Boolean($event) })" /></label>
      <label class="field fieldNarrow" title="留空由引擎每次自定种子；填上后同种子+同提示词≈同结果，重 roll 复现用">
        <span class="fieldLabel">随机种子</span>
        <el-input-number :modelValue="clip.seed ?? null" size="small" :min="0" :max="9007199254740991" :step="1" :stepStrictly="true" :value-on-clear="null" controls-position="right" placeholder="自动" @change="onSeedChange" />
      </label>
      <label class="field fieldNarrow" title="一次生成连出 N 条候选（引擎 takes）：各成该镜一个版本，在版本菜单逐条预览挑一条设为默认；带种子时候选种子逐条 +1，整批可复现。动作戏/多人等高废片率镜头建议 3">
        <span class="fieldLabel">候选条数</span>
        <el-input-number :modelValue="clip.takes ?? 1" size="small" :min="1" :max="8" :step="1" :stepStrictly="true" controls-position="right" @change="onTakesChange" />
      </label>
    </div>
    <div class="loraRow">
      <span class="fieldLabel">LoRA</span>
      <span v-if="loraHint" class="loraState loraStateWarn">{{ loraHint }}</span>
      <template v-else>
        <el-select :modelValue="selectedLoraNames" class="loraSelect" multiple size="small" collapse-tags collapse-tags-tooltip placeholder="选择引擎已装 LoRA（可多选）" @change="onLorasChange">
          <el-option v-for="name in loraOptions" :key="name" :label="name" :value="name" :disabled="loraLimitReached && !selectedLoraNames.includes(name)" />
        </el-select>
        <span v-if="loraLimit" class="loraState">单镜最多 {{ loraLimit }} 条（引擎限制）</span>
        <span v-if="loraOverflow" class="loraState loraStateWarn" role="alert">本镜已设 {{ selectedLoraNames.length }} 条，超出上限 {{ loraLimit }} 条（引擎限制），派工前请先减到 {{ loraLimit }} 条以内</span>
        <span v-for="lora in clip.loras ?? []" :key="lora.name" class="loraItem">
          <span class="loraName" :title="lora.name">{{ lora.name }}</span>
          <el-input-number :modelValue="lora.strength ?? 1" class="loraStrength" size="small" :min="loraStrengthMin" :max="loraStrengthMax" :step="0.1" controls-position="right" @change="onLoraStrengthChange(lora.name, $event)" />
          <el-button size="small" text @click="removeLora(lora.name)">移除</el-button>
        </span>
      </template>
    </div>
    <div class="whiteboxRow">
      <span class="fieldLabel">白模参考</span>
      <template v-if="whiteboxJob && whiteboxJob.status !== 'failed'">
        <span class="whiteboxState">{{ whiteboxJob.status === "waiting" ? "排队中" : "渲染中" }}…需要在 FreeVideo 页面打开时进行</span>
      </template>
      <template v-else-if="whiteboxJob">
        <span class="whiteboxState whiteboxStateWarn">渲染失败：{{ whiteboxJob.error || "引擎未给出原因" }}</span>
        <el-button size="small" @click="emit('whitebox', { type: 'clear' })">清除</el-button>
      </template>
      <template v-else-if="clip.whitebox">
        <span class="whiteboxState" :title="clip.whitebox.summary || clip.whitebox.library">{{ clip.whitebox.library }}（{{ clip.whitebox.seconds.toFixed(1) }} 秒）</span>
        <el-button size="small" @click="emit('whitebox', { type: 'clear' })">清除</el-button>
      </template>
      <template v-else>
        <span class="whiteboxState">未使用：白模定构图/机位/走位，不保证长相（长相靠资产卡与提示词，两者可同用）。生成请让 Agent 用 node:whitebox（<code>prompt</code> 取规范 → 它自己写代码 → <code>submit</code> 提交）</span>
      </template>
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
    <p class="continuityHint">质量档位：轻量/标准为两遍生成（开二次采样），精细/极致为 20 步单遍；先出预览出片更快但是低清预览片，满意后在「项目与成片」的版本菜单点「精修」直接细化成成片（不重烧参数）。</p>
    <p v-if="qcInfo?.verdict === 'fail'" class="continuityHint continuityHintWarn" role="alert">自动质检未过：{{ qcInfo.note || "视觉模型判定画面与提示词不符" }}。建议重新生成本镜或调整提示词。</p>
    <p v-else-if="qcInfo?.verdict === 'unknown'" class="continuityHint">自动质检未能判定{{ qcInfo.note ? `（${qcInfo.note}）` : "" }}，请人工看片。</p>
    <p v-if="isContext && (clip.quality !== 'light' && clip.quality !== 'medium')" class="continuityHint continuityHintWarn" role="alert">承接上一镜的镜头只能用轻量/标准质量（引擎限制：续接任务是 two-pass），请改一下。</p>
    <p v-if="isContext && !clip.secondPass" class="continuityHint continuityHintWarn" role="alert">承接上一镜的镜头必须开启二次采样（引擎限制），请开启。</p>
    <p v-if="previewDisabled && clip.preview" class="continuityHint continuityHintWarn" role="alert">先出预览只支持单个 30 秒以内、不承接上一镜的镜头，请关闭。</p>
    <details class="rulesDetails"><summary class="rulesSummary">整理规则 · {{ rewriteRules.trim() ? "已自定义" : "服务端内置" }}</summary><el-input v-model="rewriteRules" type="textarea" :rows="4" maxlength="20000" placeholder="留空则用服务端内置规则；填写后整段替换内置规则。规则只用于本次整理，不写入工程。" /></details>
    <section v-if="rewritePending" class="pendingPanel" aria-live="polite"><header class="pendingHeader"><span class="pendingTitle">整理结果待采用</span><span class="pendingMeta">本次整理规则：{{ rewritePending.basis.rules ? "自定义" : "服务端内置" }}</span></header><div class="pendingBody"><div class="pendingColumn"><span class="fieldLabel">原文（整理前，只读）</span><p class="pendingOriginal" :title="rewritePending.basis.text">{{ rewritePending.basis.text || "（原文为空）" }}</p></div><div class="pendingColumn"><span class="fieldLabel">整理结果（可编辑）</span><el-input type="textarea" :rows="6" :modelValue="rewritePending.text" @input="emit('updateRewriteDraft', String($event))" /></div></div><p v-if="rewriteBasisChanged" class="pendingGuard" role="alert">本镜原文、时长或整理规则已变化，请核对整理结果后重新整理</p><div class="pendingActions"><el-button size="small" type="primary" :disabled="rewriteBasisChanged || !rewritePending.text.trim()" @click="emit('adoptRewrite', rewritePending.text)">采用整理结果</el-button><el-button size="small" @click="emit('discardRewrite')">放弃</el-button></div></section>
  </section>
  <p v-else class="paneEmpty">选中一个镜头后在这里编辑内容。</p>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch } from "element-plus";
import { continuityLabels, continuityOptions, currentClipAttempt, normalizeContinuity, promptToText, ratioOptions, resolutionOptions, videoQualityLabels, videoQualityValues, type ClipPrompt, type MtrackClip, type VideoQuality, type WhiteboxAction, type WhiteboxJob } from "../mtrackProject";
import { firstFrameInstruction } from "../mediaDispatch";

type RewriteBasis = { text: string; seconds: number; rules: string };
type RewritePending = { clipId: string; text: string; basis: RewriteBasis };

const props = defineProps<{ clip?: MtrackClip; index: number; clipCount: number; previousClipId?: string; previousClipJobId?: string; rewriteBusy?: boolean; rewritePending?: RewritePending; canUndo?: boolean; batchRunning?: boolean; batchPaused?: boolean; whiteboxJob?: WhiteboxJob; whiteboxBusy?: boolean; loraOptions?: string[]; loraLimit?: number; loraStrengthLimit?: { min: number; max: number }; loraHint?: string; }>();

const emit = defineEmits<{ (e: "patch", patch: Partial<MtrackClip>): void; (e: "duplicate"): void; (e: "move", offset: number): void; (e: "remove"): void; (e: "accept", accepted: boolean): void; (e: "rewrite", rules: string): void; (e: "regenerate"): void; (e: "adoptRewrite", text: string): void; (e: "discardRewrite"): void; (e: "updateRewriteDraft", text: string): void; (e: "undoRemove"): void; (e: "whitebox", action: WhiteboxAction): void; }>();

const rewriteRules = ref("");
const isContext = computed(() => Boolean(props.clip && props.clip.continuity === "context"));
/** 当前默认版本那条成功尝试的自动质检结论（走 currentClipAttempt，takes 多候选时不会命中错版本）。 */
const qcInfo = computed(() => currentClipAttempt(props.clip)?.qc);
const rewriteEligible = computed(() => { const clip = props.clip; if (!clip) return false; return Object.values(clip.prompt).some(value => value.trim()); });

const rewriteBasisChanged = computed(() => {
  const pending = props.rewritePending; const clip = props.clip;
  if (!pending || !clip) return false;
  return pending.basis.text !== promptToText(clip.prompt) || pending.basis.seconds !== clip.seconds || pending.basis.rules !== rewriteRules.value.trim();
});

function onQualityChange(value: string) { emit("patch", { quality: value as VideoQuality }); }

/** 随机种子：清空发 undefined（onPatch 展开后 JSON 序列化自然丢键），数字即锁定复现。
 *  null 哨兵只属于 agent 的 editProject 路径（zod union 透传后由 mergePatch 删键），UI 不需要。 */
function onSeedChange(value: number | null | undefined) {
  emit("patch", { seed: typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined });
}

/** 候选条数：1 即回到单条（发 undefined 删键，与引擎默认一致）；2–8 一次多出 N-1 条候选版本。 */
function onTakesChange(value: number | null | undefined) {
  const takes = typeof value === "number" && Number.isInteger(value) ? Math.min(8, Math.max(1, value)) : 1;
  emit("patch", { takes: takes > 1 ? takes : undefined });
}

function onContinuityChange(value: string) {
  const continuity = normalizeContinuity(value);
  // ACT: 切成承接上一镜时把与续接互斥的两个开关一并归位，否则留着一个会被编辑内核/派工双双拒掉的组合。
  if (continuity === "context") {
    emit("patch", {
      continuity,
      ...(props.clip?.quality !== "light" && props.clip?.quality !== "medium" ? { quality: "light" } : {}),
      ...(props.clip?.preview ? { preview: false } : {}),
    });
    return;
  }
  emit("patch", { continuity });
}

/** 承接上一镜的镜头只能选轻量/标准质量（引擎限制：续接任务是 two-pass）。
 *  ACT: 读盘可能带出 high/max（承接镜的非法值，写入侧由 validateClip 拦），当前值不在过滤后选项里时补回一条，
 *  避免 el-select 遇到列表外的值显示成空白；上限：这只是 UI 容错，真越界仍由 validateClip 整批拒收。 */
const qualityOptions = computed(() => {
  const current = props.clip?.quality;
  const base: readonly VideoQuality[] = isContext.value ? videoQualityValues.filter(value => value === "light" || value === "medium") : videoQualityValues;
  const list = current && !base.includes(current) ? [...base, current] : base;
  return list.map(value => ({ value, label: videoQualityLabels[value] }));
});

/** LoRA 候选来自父级从引擎能力档案读到的「已装 LoRA 名」，本组件不写死任何名单。
 *  ACT: 已选但不在候选里的名字（换引擎/卸载 LoRA 后的旧值）补进候选，避免 el-select 显示成空白标签。 */
const loraOptions = computed(() => {
  const installed = props.loraOptions ?? [];
  const picked = (props.clip?.loras ?? []).map(lora => lora.name);
  return [...installed, ...picked.filter(name => !installed.includes(name))];
});

const selectedLoraNames = computed(() => (props.clip?.loras ?? []).map(lora => lora.name));

/** 上限与强度区间只认父级下发的引擎 limits；没读到就不约束（不退回写死的 32 / [-4,4]）。 */
const loraLimit = computed(() => props.loraLimit);
const loraLimitReached = computed(() => typeof props.loraLimit === "number" && selectedLoraNames.value.length >= props.loraLimit);
const loraOverflow = computed(() => typeof props.loraLimit === "number" && selectedLoraNames.value.length > props.loraLimit);
const loraStrengthMin = computed(() => props.loraStrengthLimit?.min ?? undefined);
const loraStrengthMax = computed(() => props.loraStrengthLimit?.max ?? undefined);

/** 逐条强度缺省 1（引擎缺省值）：写成显式数字，保证「选了 LoRA 就一定带强度」的请求形状。
 *  ACT: 这里不按上限裁剪——超限是用户看得见的错（行内提示 + 派工前 validateClip 整批拒收），
 *  静默砍掉他刚勾的 LoRA 比拒绝更坏。上限约束放在候选置灰（loraLimitReached）。 */
function loraPatch(loras: { name: string; strength?: number }[]): Partial<MtrackClip> {
  return { loras: loras.length ? loras.map(lora => ({ name: lora.name, strength: lora.strength ?? 1 })) : undefined };
}

/** 多选变化：按候选顺序保留已选名，强度沿用原值，新选中的缺省 1；全清则发 undefined 删键（与 seed/takes 同口径）。 */
function onLorasChange(value: unknown) {
  const picked = Array.isArray(value) ? value.map(item => String(item)) : [];
  const current = props.clip?.loras ?? [];
  emit("patch", loraPatch(picked.map(name => ({ name, strength: current.find(lora => lora.name === name)?.strength }))));
}

function onLoraStrengthChange(name: string, value: number | null | undefined) {
  const current = props.clip?.loras ?? [];
  const strength = typeof value === "number" && Number.isFinite(value) ? value : 1;
  emit("patch", loraPatch(current.map(lora => (lora.name === name ? { name, strength } : lora))));
}

function removeLora(name: string) {
  emit("patch", loraPatch((props.clip?.loras ?? []).filter(lora => lora.name !== name)));
}

/** 先出预览只支持单个 30 秒以内、不承接上一镜的镜头（引擎限制），其余情况置灰。 */
const previewDisabled = computed(() => isContext.value || (props.clip?.seconds ?? 0) >= 30);

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
.whiteboxRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loraRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loraSelect { flex: 0 1 280px; min-width: 200px; }
.loraState { color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
.loraStateWarn { color: var(--el-color-warning-dark-2); }
.loraItem { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border: 1px solid var(--el-border-color-lighter); border-radius: 7px; background: var(--el-bg-color); }
.loraName { max-width: 180px; overflow: hidden; color: var(--el-text-color-regular); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.loraStrength { width: 96px; }
.whiteboxState { color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
.whiteboxStateWarn { color: var(--el-color-warning-dark-2); }
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
