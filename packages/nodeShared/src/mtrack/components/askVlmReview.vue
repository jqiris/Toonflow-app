<template>
  <el-dialog
    v-model="visible"
    class="askVlmDialog"
    title="审片 · 视觉模型问答"
    width="720px"
    appendToBody
    :closeOnClickModal="false"
  >
    <div class="reviewBody">
      <div class="reviewScope">
        <el-radio-group v-model="scope" size="small" aria-label="审片范围">
          <el-radio-button value="clip">当前镜头</el-radio-button>
          <el-radio-button value="film" :disabled="!filmTargets.length">整片</el-radio-button>
        </el-radio-group>
        <span class="scopeMeta">{{ scopeMeta }}</span>
      </div>

      <div class="questionRow">
        <el-select v-model="templateKey" size="small" class="templateSelect" placeholder="常用问题" @change="applyTemplate">
          <el-option v-for="item in questionTemplates" :key="item.key" :label="item.label" :value="item.key" />
        </el-select>
        <el-input v-model="question" type="textarea" :rows="3" :maxlength="8000" placeholder="要问视觉模型的问题（选模板后可继续改写）" />
      </div>

      <div class="actionRow">
        <el-button size="small" type="primary" :loading="loading" :disabled="!canAsk" @click="submit">提问</el-button>
        <span class="actionHint">{{ hintText }}</span>
      </div>

      <el-alert v-if="errorMessage" class="reviewError" :title="errorMessage" type="error" :closable="false" showIcon />

      <ul v-if="answers.length" class="answerList">
        <li v-for="item in answers" :key="item.key" class="answerItem">
          <span class="answerLabel">{{ item.label }}</span>
          <p class="answerText">{{ item.text }}</p>
        </li>
      </ul>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElAlert, ElButton, ElDialog, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from "element-plus";
import type { MtrackClip } from "../mtrackProject";
import { currentClipAttempt, promptToText } from "../mtrackProject";

const props = defineProps<{
  /** 工作区目录：成片按工作区相对路径读（与自动质检同一套取片逻辑）。 */
  directory?: string;
  /** 媒体供应商 id（当前只有 freevideo 引擎带本机视觉模型）。 */
  providerId?: string;
  /** 工程里的镜头列表（整片范围用）。 */
  clips: MtrackClip[];
  /** 当前选中的镜头（单镜范围用）。 */
  clipId: string;
}>();

const visible = defineModel<boolean>({ default: false });

type Scope = "clip" | "film";
type ReviewTarget = { key: string; label: string; path: string; clip: MtrackClip };

const scope = ref<Scope>("clip");
const templateKey = ref("");
const question = ref("");
const loading = ref(false);
const errorMessage = ref("");
const answers = ref<{ key: string; label: string; text: string }[]>([]);

/** 常用问题模板：选一个填进输入框，可以继续改写。 */
const questionTemplates = [
  { key: "consistency", label: "主体与提示词是否一致", text: "画面主体、动作与本镜提示词是否一致？有没有漏掉或多出提示词里没有的元素？" },
  { key: "subtitle", label: "有没有字幕或水印", text: "画面里有没有出现字幕、水印、文字或 logo？" },
  { key: "artifact", label: "有没有画面崩坏", text: "画面有没有明显崩坏：肢体错乱、面部融化、多手多指、大面积伪影？" },
  { key: "character", label: "人物长相是否一致", text: "人物的长相、服装、发型与本镜提示词是否一致？" },
  { key: "camera", label: "运镜方向是否正确", text: "镜头的运动方向与形式是否符合要求（左移 / 右移 / 推近 / 拉远 / 固定）？" },
];

function applyTemplate(key: string) {
  const template = questionTemplates.find(item => item.key === key);
  if (template) question.value = template.text;
}

/** 该镜默认版本的成片路径：默认版本优先，没有默认版本回退最后一次成功尝试。 */
function videoPathOf(clip: MtrackClip | undefined): string {
  if (!clip) return "";
  if (clip.assetPath) return clip.assetPath;
  return currentClipAttempt(clip)?.assetPath ?? "";
}

function targetOf(clip: MtrackClip): ReviewTarget | undefined {
  const path = videoPathOf(clip);
  if (!path) return undefined;
  return { key: clip.clipId, label: `${clip.clipId} · ${clip.title || "未命名"}`, path, clip };
}

const clipTarget = computed<ReviewTarget | undefined>(() => {
  const clip = props.clips.find(item => item.clipId === props.clipId);
  return clip ? targetOf(clip) : undefined;
});

/** 整片范围：每镜取默认版本；引擎一次最多 8 题，这里按工程顺序取前 8 个有成片的镜头。 */
const filmTargets = computed<ReviewTarget[]>(() => {
  const targets: ReviewTarget[] = [];
  for (const clip of props.clips) {
    const target = targetOf(clip);
    if (!target) continue;
    targets.push(target);
    if (targets.length >= 8) break;
  }
  return targets;
});

const targets = computed<ReviewTarget[]>(() => scope.value === "film" ? filmTargets.value : clipTarget.value ? [clipTarget.value] : []);

const scopeMeta = computed(() => {
  if (scope.value === "film") return `审 ${filmTargets.value.length} 个镜头（引擎一次最多 8 题）`;
  return clipTarget.value ? `审 ${clipTarget.value.label}` : "当前镜头还没有成片";
});

const canAsk = computed(() => Boolean(props.directory && props.providerId && question.value.trim() && targets.value.length));

const hintText = computed(() => {
  if (loading.value) return "视觉模型正在排队回答（与视频共用 GPU，可能要等几分钟）";
  if (!props.directory) return "当前没有工作目录";
  if (!props.providerId) return "工程还没有视频模型，先在快捷设置里选择";
  if (!targets.value.length) return scope.value === "film" ? "还没有可审的成片" : "当前镜头还没有成片，先把它生成出来";
  return "提问会把成片一起送给本机视觉模型";
});

/**
 * 单条问题的完整文本（上限 8000，askVlmSchema 硬约束）。
 * ACT: 输入框 maxlength 只限住用户写的部分，拼上的提示词/镜号还会让整条超限被服务端打回「参数错误」，
 * 所以在这里统一截断；截断只影响送模型的措辞，不影响取片。
 */
const questionLimit = 8000;

/** 单镜范围附上本镜提示词（自动质检同一套做法：对照提示词看片）；整片范围只带镜号标题。 */
function buildQuestion(target: ReviewTarget): string {
  const asked = question.value.trim();
  if (scope.value === "film") return clampQuestion(`【${target.label}】${asked}`);
  const prompt = promptToText(target.clip.prompt);
  return clampQuestion([asked, prompt ? `本镜提示词（节选）：\n${prompt.slice(0, 4000)}` : ""].filter(Boolean).join("\n"));
}

function clampQuestion(text: string) {
  return text.slice(0, questionLimit);
}

/** 引擎回的答案形态不固定（字符串或带 text 的对象），统一取出可读文本。 */
function answerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "（引擎没有返回可读内容）";
}

async function submit() {
  const list = targets.value;
  if (!list.length) {
    errorMessage.value = hintText.value;
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  answers.value = [];
  try {
    const response = await fetch("/api/ai/media/askVlm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({
        directory: props.directory,
        providerId: props.providerId,
        questions: list.map(target => ({
          text: buildQuestion(target),
          video: { path: target.path, mimeType: "video/mp4" },
        })),
        label: "手动审片",
      }),
    });
    const payload = await response.json().catch(() => undefined) as { data?: { answers?: unknown[] }; message?: string } | undefined;
    if (!response.ok || !payload?.data) {
      // 服务端把 zod 明细放在 data.issues、message 恒为「参数错误」；只读 message 会让用户看不到到底哪个字段错。
      const detail = payload?.data === undefined ? "" : `：${JSON.stringify(payload.data).slice(0, 300)}`;
      throw new Error(`${payload?.message || `审片请求失败（HTTP ${response.status}）`}${detail}`);
    }
    const raw = payload.data.answers ?? [];
    answers.value = list.map((target, index) => ({ key: target.key, label: target.label, text: answerText(raw[index]) }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

watch(visible, shown => {
  if (shown) errorMessage.value = "";
});
</script>

<style scoped>
.reviewBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.reviewScope {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scopeMeta {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.questionRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.templateSelect {
  flex: none;
  width: 180px;
}

.actionRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.actionHint {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reviewError {
  width: 100%;
}

.answerList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.answerItem {
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.answerLabel {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.answerText {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}
</style>
