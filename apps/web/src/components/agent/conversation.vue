<template>
  <div class="agentConversation">
    <messageList
      :messages="messages"
      :directory="directory"
      :active="active"
      :disabled="disabled"
      :locked="locked"
      :busy="busy"
      :remoteRunning="remoteRunning"
      :compacting="compacting"
      :editingId="editingId"
      :deletingId="deletingId"
      :voiceActive="voiceActive"
      @fillPrompt="input?.fillPrompt($event)"
      @copy="copyMessage"
      @edit="input?.editMessage($event)"
      @delete="deleteMessage"
      @cancelEdit="input?.cancelEdit()" />
    <div v-if="compacting" class="compactionStatus" role="status">
      <el-icon class="is-loading" aria-hidden="true"><icon-loader-2 :size="14" /></el-icon>
      <span>正在压缩上下文…</span>
    </div>
    <messageInput
      ref="input"
      v-model:selectedModel="selectedModel"
      v-model:reasoningEffort="reasoningEffort"
      v-model:editingId="editingId"
      v-model:voiceActive="voiceActive"
      v-model:restoringAttachment="restoringAttachment"
      :active="active"
      :disabled="disabled"
      :busy="busy"
      :remoteRunning="remoteRunning"
      :deletingId="deletingId"
      :directory="directory"
      :contextUsage="contextUsage"
      :stats="stats"
      :contextWindow="contextWindow"
      @submit="submitMessage"
      @stop="stopMessage" />
    <el-dialog v-model="questionDialogVisible" :title="currentQuestion?.title || ''" width="520" @update:model-value="handleQuestionDialogUpdate">
      <div>
        <div v-if="currentQuestion?.question" style="margin-bottom:16px; font-size:14px; color:var(--el-text-color-primary); white-space:pre-wrap;">{{ currentQuestion.question }}</div>
        <div v-if="!currentQuestion?.fields?.length" style="margin-bottom:16px;">
          <el-input type="textarea" v-model="questionAnswer" :rows="4" placeholder="请输入回答" />
        </div>
        <el-form-item v-for="field in currentQuestion?.fields || []" :key="field.field" :label="field.title" :prop="field.field" :required="field.required">
          <el-input v-if="field.type === 'input'" v-model="questionForm[field.field]" />
          <el-input v-else-if="field.type === 'inputNumber'" type="number" v-model.number="questionForm[field.field]" />
          <el-switch v-else-if="field.type === 'switch'" v-model="questionForm[field.field]" />
          <el-radio-group v-else-if="field.type === 'radio'" v-model="questionForm[field.field]">
            <el-radio v-for="opt in field.options || []" :key="opt" :label="opt">{{ opt }}</el-radio>
          </el-radio-group>
          <el-select v-else-if="field.type === 'select'" v-model="questionForm[field.field]" placeholder="请选择">
            <el-option v-for="opt in field.options || []" :key="opt" :label="opt" :value="opt" />
          </el-select>
          <el-checkbox-group v-else-if="field.type === 'checkbox'" v-model="questionForm[field.field]">
            <el-checkbox v-for="opt in field.options || []" :key="opt" :label="opt">{{ opt }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </div>
      <template #footer>
        <el-button @click="handleQuestionCancel">取消</el-button>
        <el-button type="primary" @click="handleQuestionSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { locale, translate } from "@toonflow/i18n/vue";
import { computed, inject, onBeforeUnmount, reactive, ref, watch } from "vue";
import axios from "axios";
import { IconLoader2 } from "@tabler/icons-vue";
import { ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElFormItem, ElInput, ElMessage, ElOption, ElRadio, ElRadioGroup, ElSelect, ElSwitch } from "element-plus";
import { getReadableFileExtension, getReadableFileMimeType } from "@toonflow/server/documentFormats";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { writeClipboardText } from "@/lib/clipboard";
import anonymousData from "@/lib/anonymousData";
import { modelChoices } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AgentAttachment, AgentConversation, AgentMessage } from "./types";
import type { AgentEvent } from "@toonflow/server/agent/types";
import { createConversationStream, readAgentEvents } from "./replyStream";
import { mentionPlainText } from "./mentionText";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import messageList from "./conversation/messageList.vue";
import messageInput from "./conversation/messageInput.vue";

const props = defineProps<{ active: boolean; initialSession: AgentConversation | null; sessionFile?: string; disabled: boolean }>();
const emit = defineEmits<{ session: [file: string]; sent: [prompt: string]; event: [event: AgentEvent]; idle: [] }>();
const workspaceStore = useWorkspaceStore();
const directory = workspaceStore.project?.directory;
const createCanvasContext = inject<(() => CanvasContext | undefined) | undefined>("canvas", undefined);
const messages = ref<AgentMessage[]>((props.initialSession?.messages ?? []).map(message => ({ ...message })));
const stream = createConversationStream(messages);
const remoteRunning = ref(props.initialSession?.running ?? false);
const stats = ref(props.initialSession?.stats);
const contextUsage = ref(props.initialSession?.contextUsage);
const busy = ref(false);
const compacting = ref(false);
const deletingId = ref<string>();
const restoringAttachment = ref(false);
const input = ref<InstanceType<typeof messageInput>>();
const currentQuestion = ref<any>(null);
const questionDialogVisible = ref(false);
const questionForm = reactive<Record<string, any>>({});
const questionAnswer = ref("");
let questionResolve: (() => void) | null = null;
const voiceActive = ref(false);
const locked = computed(() => props.disabled || busy.value || deletingId.value !== undefined || restoringAttachment.value || voiceActive.value);
const editingId = ref<string>();
let controller: AbortController | undefined;
const pendingMessage = props.initialSession?.parentFile ? undefined : workspaceStore.pendingAgentMessage;
const selectedModel = ref(pendingMessage?.model ?? (props.initialSession?.providerId && props.initialSession.modelId
  ? JSON.stringify([props.initialSession.providerId, props.initialSession.modelId]) : ""));
const reasoningEffort = ref(pendingMessage?.reasoningEffort ?? props.initialSession?.thinkingLevel ?? "");
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
const contextWindow = computed(() => contextUsage.value?.contextWindow ?? selectedModelChoice.value?.contextWindow ?? 262144);
function applyEvent(event: AgentEvent) {
  switch (event.type) {
    case "subAgent":
    case "subAgentEvent": emit("event", event); break;
    case "report":
      if (event.parentFile !== props.sessionFile) { emit("event", event); break; }
      if (!messages.value.some(message => message.id === event.id)) messages.value.push({
        id: event.id, role: "assistant", content: event.content,
        parts: [{ id: event.id, type: "text", content: event.content }], report: { file: event.file, name: event.name },
      });
      break;
    case "compaction": compacting.value = event.active; break;
    case "session": emit("session", event.file); break;
    case "stats": stats.value = event.stats; contextUsage.value = event.contextUsage; break;
    default: stream.receive(event);
  }
}

function receiveEvent(event: AgentEvent) {
  if (event.type === "done" || event.type === "error") {
    remoteRunning.value = false;
    compacting.value = false;
  } else if (["userMessage", "text", "thinking", "tool"].includes(event.type)) remoteRunning.value = true;
  applyEvent(event);
}

/**
 * 自动消息（多轨批次结束通知）现在能不能发：忙、正在编辑历史消息、输入框没就绪时都不发，
 * 由调用方排队重试——否则 sendMessage 会静默 return，通知就丢了。
 * 未打开项目、未选模型也会让 sendMessage 早退，这里必须先挡住，避免调用方把「没发出去」当成已投递。
 */
function canAcceptAutoMessage() {
  return !locked.value && !!input.value && editingId.value === undefined && !!directory && !!selectedModelChoice.value;
}

defineExpose({ receiveEvent, sendMessage, canAcceptAutoMessage });

function submitMessage() {
  return sendMessage(editingId.value ? messages.value.find(item => item.id === editingId.value) : undefined);
}

async function copyMessage(content: string) {
  try {
    await writeClipboardText(content);
    ElMessage.success("已复制");
  } catch {
    ElMessage.error("复制失败，请重试");
  }
}

async function deleteMessage(item: AgentMessage) {
  if (locked.value || remoteRunning.value || item.streaming || item.report) return;
  deletingId.value = item.id;
  try {
    if (item.entryId || item.replyTo) {
      if (!directory || !props.sessionFile) throw new Error("请重新打开对话后再删除");
      const { data } = await axios.delete<{ code: number; data: AgentConversation; message?: string }>("/api/agent/message", {
        data: {
          directory, sessionFile: props.sessionFile,
          ...(item.replyTo ? { replyTo: item.replyTo } : { entryIds: [item.entryId!] }),
        },
        headers: { "x-toonflow-workspace": "1" },
      });
      if (data.code !== 200) throw new Error(data.message || "删除消息失败");
      stats.value = data.data.stats;
      contextUsage.value = data.data.contextUsage;
    }
    messages.value = messages.value.filter(message => message.id !== item.id &&
      !(item.replyTo && message.role === "assistant" && !message.report && message.replyTo === item.replyTo));
  } catch (error) {
    const message = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message : undefined;
    ElMessage.error(message || (error instanceof Error ? error.message : "删除消息失败"));
  } finally {
    deletingId.value = undefined;
  }
}

function stopMessage() {
  controller?.abort();
}

async function uploadAttachments(attachments: AgentAttachment[], directory: string, signal: AbortSignal) {
  if (!attachments.some(item => item.file)) return;
  const files = useWorkspaceFiles(directory);
  for (const path of ["assets", "assets/chat"]) {
    await files.mkdir(path).catch(error => {
      if (error?.response?.data?.data?.code !== "EEXIST") throw error;
    });
    signal.throwIfAborted();
  }
  for (const attachment of attachments) {
    if (!attachment.file) continue;
    attachment.mimeType = getReadableFileMimeType(attachment.name, attachment.mimeType) ?? attachment.mimeType;
    const readableExtension = getReadableFileExtension(attachment.name, attachment.mimeType);
    const extension = readableExtension ? `.${readableExtension}` : attachment.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0].toLowerCase() ?? "";
    const path = `assets/chat/${crypto.randomUUID()}${extension}`;
    await files.write(path, attachment.file, true, signal);
    attachment.path = path;
    attachment.file = undefined;
    signal.throwIfAborted();
  }
}

async function sendCanvasResult(event: Extract<AgentEvent, { type: "canvasCall" }>, canvasContext: CanvasContext | undefined, signal: AbortSignal) {
  let body: string;
  try {
    if (!canvasContext) throw new Error("当前页面没有激活的画布");
    const result = await canvasContext.call(event, signal);
    body = JSON.stringify({ directory, callId: event.callId, result: result ?? null });
  } catch (error) {
    body = JSON.stringify({ directory, callId: event.callId, error: (error instanceof Error && error.message ? error.message : translate("画布操作失败")).slice(0, 8000) });
  }
  const cancelled = signal.aborted;
  if (cancelled) body = JSON.stringify({ directory, callId: event.callId, error: translate("画布操作已取消") });
  const response = await fetch("/api/agent/canvasResult", {
    method: "POST",
    headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body,
    keepalive: cancelled,
    signal: cancelled ? AbortSignal.timeout(5000) : signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "画布操作结果回传失败");
  }
}

/** 用户输入与自动消息共用的早退校验：返回 false 表示没有、也不会进入发送链路。 */
function canCommitMessage(source?: AgentMessage, text?: string, draftPrompt?: string, draftAttachmentCount = 0) {
  const auto = typeof text === "string";
  const prompt = (source && editingId.value !== source.id ? source.content : auto ? text : (draftPrompt ?? "")).trim();
  if (!source && editingId.value !== undefined) return false;
  if (source && (source.role !== "user" || messages.value.findIndex(item => item.id === source.id) < 0)) return false;
  if (locked.value || !input.value || (!prompt && !draftAttachmentCount)) return false;
  if (!directory) { ElMessage.warning("请先打开项目"); return false; }
  if (!selectedModelChoice.value) { ElMessage.warning("请先选择模型"); return false; }
  return true;
}

/**
 * 发送链路本体；只在 canCommitMessage 通过后调用。调用方与 sendMessage 之间不允许有 await，
 * 校验到置 busy 必须原子完成，排队的自动通知才不会被别的轮次插队。
 */
async function runMessageSend(source?: AgentMessage, text?: string) {
  const instance = input.value;
  const model = selectedModelChoice.value;
  // 早退已由 canCommitMessage 在同步链路里挡住，这里重复一次只为类型收窄，不是业务分支。
  if (!instance || !model || !directory) return;
  const draft = instance.getDraft();
  const editing = source && editingId.value === source.id;
  // text：非用户输入的自动消息（多轨批次结束通知）复用同一条发送链路，才能带流式 UI 与画布上下文。
  // 用 text 时不读草稿：自动消息不能把用户正在输入但没发送的草稿顶替掉，也不该带走草稿的附件与提及。
  const auto = typeof text === "string";
  const prompt = (source && !editing ? source.content : auto ? text : (draft?.prompt ?? "")).trim();
  const attachments = reactive((source && !editing ? source.attachments ?? [] : auto ? [] : draft?.attachments ?? []).map(item => ({ ...item })));
  const mentionedIds = source && !editing ? (source.mentions ?? []).filter(mention => prompt.includes(`{{mention:${mention.id}}}`)).map(mention => mention.id)
    : auto ? [] : draft?.mentionedIds ?? [];
  const references = source && !editing ? source.mentions ?? [] : auto ? [] : draft?.mentions ?? [];
  const mentions = references.filter(mention => mentionedIds.includes(mention.id)).map(mention => ({ ...mention }));
  if (mentionedIds.some(id => !mentions.some(mention => mention.id === id))) { ElMessage.warning("存在无法读取的提及，请删除后重新选择"); return; }
  const resendIndex = source ? messages.value.findIndex(item => item.id === source.id) : -1;
  const resendFrom = source ? source.entryId ?? messages.value.slice(resendIndex + 1).find(item => item.role === "user" && item.entryId)?.entryId : undefined;
  const requestController = new AbortController();
  const canvasContext = createCanvasContext?.();
  controller = requestController;
  busy.value = true;
  compacting.value = false;
  const reply = reactive<AgentMessage>({ id: crypto.randomUUID(), role: "assistant", content: "", parts: [], streaming: true });
  const userMessage = reactive<AgentMessage>({ id: crypto.randomUUID(), role: "user", content: prompt, attachments, mentions });
  let ownsStream = !remoteRunning.value;
  let forwarded = false;
  if (!source) {
    messages.value.push(userMessage);
    if (ownsStream) messages.value.push(reply);
  }
  let accepted = false;
  if (ownsStream) stream.begin(reply);
  const handledCanvasCalls = new Set<string>();
  const pendingQuestions = new Map<string, string>();
  const activeChildFiles = new Set<string>();
  const finishStats = anonymousData.startAgent();
  try {
    if (!source && !auto) await instance.clearDraft();
    requestController.signal.throwIfAborted();
    await uploadAttachments(attachments, directory, requestController.signal);
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ prompt, mentions, attachments: attachments.map(({ name, path, mimeType }) => ({ name, path, mimeType })), directory, providerId: model.providerId, modelId: model.modelId, thinkingLevel: reasoningEffort.value || undefined, sessionFile: props.sessionFile, resendFrom, canvas: canvasContext ? { id: canvasContext.id, tools: canvasContext.tools } : undefined }),
      signal: requestController.signal,
    });
    for await (const event of readAgentEvents(response, requestController.signal)) {
      // 子任务复用发起委派时的画布与取消通道，界面切换不改变工具执行目标。
      let toolEvent: AgentEvent = event;
      let scope = "";
      while (toolEvent.type === "subAgentEvent") {
        if (toolEvent.event.type === "done" || toolEvent.event.type === "error") activeChildFiles.delete(toolEvent.file);
        else activeChildFiles.add(toolEvent.file);
        scope += `${toolEvent.file}/`;
        toolEvent = toolEvent.event;
      }
      if (toolEvent.type === "question") {
        currentQuestion.value = toolEvent;
        questionDialogVisible.value = true;
        await new Promise<void>((resolve) => { questionResolve = resolve; });
        questionDialogVisible.value = false;
        currentQuestion.value = undefined;
        Object.assign(questionForm, {});
        questionAnswer.value = "";
        pendingQuestions.delete(`${scope}${toolEvent.toolCallId}`);
      }
      if (toolEvent.type === "tool" && toolEvent.tool.status !== "running") pendingQuestions.delete(`${scope}${toolEvent.tool.id}`);
      if (toolEvent.type === "canvasCall") {
        if (handledCanvasCalls.has(toolEvent.callId)) throw new Error("收到重复的画布调用");
        handledCanvasCalls.add(toolEvent.callId);
        await sendCanvasResult(toolEvent, canvasContext, requestController.signal);
        continue;
      }
      switch (event.type) {
        case "accepted":
          forwarded = true;
          if (ownsStream) {
            stream.finish();
            messages.value = messages.value.filter(message => message !== reply);
          }
          break;
        case "userMessage":
          if (!ownsStream) {
            messages.value.push(reply);
            stream.begin(reply);
          }
          userMessage.entryId = event.id;
          reply.replyTo = event.id;
          if (source && !accepted) {
            messages.value.splice(resendIndex, messages.value.length - resendIndex, userMessage, reply);
            stats.value = undefined;
            contextUsage.value = undefined;
            await instance.restoreEditingDraft();
          }
          accepted = true;
          ownsStream = true;
          applyEvent(event);
          break;
        case "stats":
          if (source && !accepted) break;
          applyEvent(event);
          break;
        default: applyEvent(event);
      }
    }
    if (source && !accepted) throw new Error("服务端未确认重发，请重新打开对话后重试");
    finishStats("success");
    // ACT: 自动消息（多轨批次结束通知）不参与会话命名——宿主按这个事件给「新对话」命名，
    // 让通知文案当标题会把还没说过话的新会话命名成「（自动通知，非用户输入）…」。
    if (!auto) emit("sent", mentionPlainText(prompt, mentions) || attachments[0]?.name || "新对话");
  } catch (error) {
    finishStats(requestController.signal.aborted ? "cancelled" : "failed");
    const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    const message = requestController.signal.aborted ? "已停止生成" : responseMessage || (error instanceof Error ? error.message : "发送失败，请重试");
    if ((source && !accepted) || !ownsStream) { userMessage.error = message; ElMessage.error(message); }
    else reply.error = message;
    if (ownsStream && props.initialSession?.parentFile && props.sessionFile) {
      emit("event", { type: "subAgentEvent", file: props.sessionFile, event: { type: "error", message } });
    }
  } finally {
    if (currentQuestion.value) {
      void fetch("/api/agent/answer", {
        method: "POST", headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, callId: currentQuestion.value.callId, cancelled: true }), keepalive: true,
      }).catch(() => {});
    }
    questionDialogVisible.value = false;
    currentQuestion.value = undefined;
    questionResolve = null;
    for (const file of activeChildFiles) emit("event", { type: "subAgentEvent", file, event: { type: "error", message: "委派连接已结束，请重新打开子会话查看结果" } });
    // ACT: Bun 的流断开事件可能不触发；主动结束仍在等待的提问，不依赖断开通知。
    for (const callId of pendingQuestions.values()) {
      void fetch("/api/agent/answer", {
        method: "POST", headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, callId, cancelled: true }), keepalive: true,
      }).catch(() => {});
    }
    if (ownsStream && !forwarded) stream.finish();
    compacting.value = false;
    busy.value = false;
    controller = undefined;
  }
}

async function handleQuestionSubmit() {
  const q = currentQuestion.value;
  if (!q) return;
  try {
    const body: Record<string, unknown> = { directory, callId: q.callId };
    if (q.fields?.length) {
      body.values = questionForm;
    } else {
      body.answer = questionAnswer.value;
    }
    const response = await fetch("/api/agent/answer", {
      method: "POST",
      headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      ElMessage.error(error?.message || "答复提交失败");
      return;
    }
    questionDialogVisible.value = false;
    currentQuestion.value = undefined;
    Object.assign(questionForm, {});
    questionAnswer.value = "";
    questionResolve?.();
    questionResolve = null;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "答复提交失败");
  }
}

function handleQuestionCancel() {
  const q = currentQuestion.value;
  if (!q) return;
  void fetch("/api/agent/answer", {
    method: "POST",
    headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ directory, callId: q.callId, cancelled: true }),
    keepalive: true,
  }).catch(() => {});
  questionDialogVisible.value = false;
  currentQuestion.value = undefined;
  Object.assign(questionForm, {});
  questionAnswer.value = "";
  questionResolve?.();
  questionResolve = null;
}

function handleQuestionDialogUpdate(val: boolean) {
  if (!val && questionResolve) {
    const q = currentQuestion.value;
    if (q) {
      void fetch("/api/agent/answer", {
        method: "POST",
        headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, callId: q.callId, cancelled: true }),
        keepalive: true,
      }).catch(() => {});
    }
    questionDialogVisible.value = false;
    currentQuestion.value = undefined;
    Object.assign(questionForm, {});
    questionAnswer.value = "";
    questionResolve?.();
    questionResolve = null;
  }
}
watch(busy, running => { if (!running) emit("idle"); });

/**
 * 同步返回本轮是否提交进入发送链路：早退（忙、校验不过、未选模型等）一律 false 且不发请求，
 * 排队的自动通知据此决定出队还是留队；一旦发出请求（含后续失败），返回 true——失败会在对话里留错误气泡，不再重投。
 * 校验到置 busy 之间没有 await，排队通知不会被用户输入插队。
 */
function sendMessage(source?: AgentMessage, text?: string): boolean {
  const instance = input.value;
  const draft = instance?.getDraft();
  if (!canCommitMessage(source, text, draft?.prompt, draft?.attachments.length)) return false;
  void runMessageSend(source, text);
  return true;
}

watch(() => !props.initialSession?.parentFile && !!workspaceStore.pendingAgentMessage && props.active && !locked.value && !!input.value && !!createCanvasContext?.(), async ready => {
  const message = workspaceStore.pendingAgentMessage;
  const instance = input.value;
  if (!ready || !message || !instance || message.directory !== directory) return;
  workspaceStore.pendingAgentMessage = null;
  await instance.fillPrompt(message.prompt, message.attachments ?? []);
  if (input.value === instance && props.active) void sendMessage();
}, { flush: "post" });

onBeforeUnmount(() => controller?.abort());
</script>

<style lang="scss">
.agentConversation {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;

  .compactionStatus {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    margin: 0 12px 8px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
</style>
