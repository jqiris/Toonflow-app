import { computed, onScopeDispose, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { settings } from "@/stores/settings";
import type xSender from "x-sender";

type VoiceState = "idle" | "starting" | "listening" | "stopping";

const voiceMaxDuration = 120000;
const voiceMinDuration = 200;
const clickSuppressDelay = 400;
// ACT: 静音自动结束用固定阈值与时长，不引入 VAD 库；环境噪声大或语速慢时可调这两个值。
const voiceSilenceDuration = 1500;
const voiceNoSpeechDuration = 4000;
const voiceSpeechLevel = 0.01;

function readAsrConfigured() {
  const raw = settings.value.asr;
  const asr = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return typeof asr.baseUrl === "string" && asr.baseUrl.trim().length > 0;
}

function describeMediaError(error: unknown) {
  if (!(error instanceof Error)) return "无法启动录音";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") return "麦克风权限未获允许，请在浏览器或系统设置中开启";
  if (error.name === "NotFoundError") return "未检测到麦克风设备";
  if (error.name === "NotReadableError") return "麦克风被其他程序占用，请检查设备占用情况";
  return error.message || "无法启动录音";
}

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function transcribeVoice(blob: Blob) {
  const response = await fetch("/api/asr/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-toonflow-workspace": "1" },
    body: blob,
  });
  const payload = await response.json().catch(() => undefined) as { code?: number; message?: string; data?: { text?: unknown } } | undefined;
  if (payload?.code !== 200) throw new Error(payload?.message || "语音识别失败，请稍后重试");
  return typeof payload.data?.text === "string" ? payload.data.text.trim() : "";
}

export default function useVoiceInput(options: {
  getSender: () => xSender | undefined;
  active: () => boolean;
  disabled: () => boolean;
  locked: () => boolean;
  onStart: () => void;
}) {
  const voiceSupported = typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioContext !== "undefined";
  const voiceState = ref<VoiceState>("idle");
  const voiceLevel = ref(0);
  const voiceActive = computed(() => voiceState.value !== "idle");
  const voiceButtonLabel = computed(() => !voiceSupported ? "当前环境无法使用麦克风"
    : !readAsrConfigured() ? "未配置语音识别服务，请在设置中填写"
      : voiceActive.value ? "结束语音输入" : "长按输入框语音输入，也可点击开始");
  let voicePress: { pointerId: number; x: number; y: number; timer: number } | undefined;
  let voiceRun = 0;
  let voiceLimitTimer = 0;
  let suppressClickUntil = 0;
  let voiceChunks: Float32Array[] = [];
  let voiceSampleRate = 16000;
  let voiceStream: MediaStream | undefined;
  let voiceContext: AudioContext | undefined;
  let voiceSource: MediaStreamAudioSourceNode | undefined;
  let voiceProcessor: ScriptProcessorNode | undefined;
  let voiceSilence: GainNode | undefined;
  let voiceInstance: xSender | undefined;
  let voicePosition: ReturnType<xSender["getCurrentNode"]> | undefined;
  let voiceSawSpeech = false;
  let voiceSpeechAt = 0;
  let voiceListenAt = 0;
  let voiceFloor = 0;
  let voiceFrameCount = 0;
  let voicePeakLevel = 0;
  let voiceKeyTimer = 0;

  function clearVoicePress() {
    if (voicePress) window.clearTimeout(voicePress.timer);
    voicePress = undefined;
  }

  function stopVoiceCapture() {
    voiceProcessor?.disconnect();
    voiceSource?.disconnect();
    voiceSilence?.disconnect();
    voiceProcessor = undefined;
    voiceSource = undefined;
    voiceSilence = undefined;
    voiceStream?.getTracks().forEach(track => track.stop());
    voiceStream = undefined;
    const context = voiceContext;
    voiceContext = undefined;
    if (context && context.state !== "closed") void context.close().catch(error => console.warn("关闭录音失败", error));
    window.clearTimeout(voiceLimitTimer);
    voiceLimitTimer = 0;
    voiceLevel.value = 0;
  }

  function captureVoicePosition(instance: xSender) {
    let position = { ...instance.getCurrentNode() };
    const selection = window.getSelection();
    if (selection?.focusNode && instance.chatElement.richText.contains(selection.focusNode)) {
      for (const line of instance.chatEditor.NODES) for (const tag of line.children) {
        if ((tag.type !== "Write" && tag.type !== "Input") || !tag.$el.contains(selection.focusNode)) continue;
        const range = document.createRange();
        range.selectNodeContents(tag.$el);
        range.setEnd(selection.focusNode, selection.focusOffset);
        position = { node: selection.focusNode, instance: tag, offset: range.toString().length };
      }
    }
    return position;
  }

  function armVoiceInput(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || options.locked() || !options.active() || options.getSender()?.chatEditor.isComposition ||
      (event.target instanceof Element && event.target.closest("[data-agent-mention]"))) return;
    clearVoicePress();
    voicePress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: window.setTimeout(() => void startVoiceInput(), 450) };
  }

  function moveVoicePress(event: PointerEvent) {
    if (voicePress?.pointerId === event.pointerId && !voiceActive.value && Math.hypot(event.clientX - voicePress.x, event.clientY - voicePress.y) > 8) clearVoicePress();
  }

  function releaseVoicePress(event: PointerEvent) {
    if (voicePress?.pointerId === event.pointerId) void stopVoiceInput();
  }

  function cancelVoiceInput(event?: Event) {
    if (event instanceof KeyboardEvent && event.key !== "Escape") return;
    if (event?.type === "visibilitychange" && !document.hidden) return;
    // 首次录音会弹出系统麦克风授权，窗口失焦属于正常流程，不能据此取消。
    if (event?.type === "blur" && voiceState.value === "starting") return;
    if (event instanceof KeyboardEvent && voiceActive.value) event.preventDefault();
    window.clearTimeout(voiceKeyTimer);
    clearVoicePress();
    stopVoiceCapture();
    voiceRun++;
    voiceChunks = [];
    voiceInstance = undefined;
    voicePosition = undefined;
    voiceState.value = "idle";
  }

  async function startVoiceInput() {
    const instance = options.getSender();
    if (!instance || options.locked() || !options.active() || instance.chatEditor.isComposition) return;
    if (!voiceSupported) {
      clearVoicePress();
      ElMessage.warning("当前环境无法使用麦克风");
      return;
    }
    if (!readAsrConfigured()) {
      clearVoicePress();
      ElMessage.warning("请先在设置中配置语音识别服务地址");
      return;
    }
    // 不复用 cancelVoiceInput：它会清掉长按的 pointer 状态，导致松开手指无法结束录音。
    stopVoiceCapture();
    const run = ++voiceRun;
    voiceChunks = [];
    voiceSawSpeech = false;
    voiceSpeechAt = 0;
    voiceListenAt = performance.now();
    voiceFloor = 0;
    voiceFrameCount = 0;
    voicePeakLevel = 0;
    voiceInstance = instance;
    voicePosition = captureVoicePosition(instance);
    voiceState.value = "starting";
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (run !== voiceRun) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      let context: AudioContext;
      try {
        context = new AudioContext({ sampleRate: 16000 });
      } catch {
        context = new AudioContext();
      }
      voiceContext = context;
      voiceStream = media;
      voiceSampleRate = context.sampleRate;
      const source = context.createMediaStreamSource(media);
      // ACT: ScriptProcessor 已废弃，但不需要额外的 worklet 模块文件；音频只在本地编码成 WAV 上传。
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silence = context.createGain();
      silence.gain.value = 0;
      voiceSource = source;
      voiceProcessor = processor;
      voiceSilence = silence;
      processor.onaudioprocess = event => {
        if (run !== voiceRun) return;
        const channel = event.inputBuffer.getChannelData(0);
        voiceChunks.push(new Float32Array(channel));
        let sum = 0;
        for (const sample of channel) sum += sample * sample;
        const rms = Math.sqrt(sum / channel.length);
        voicePeakLevel = Math.max(voicePeakLevel, rms);
        // ACT: 判定阈值随底噪自适应（上限 0.05），再加一个很低的绝对下限，保证正常音量一定判成说话。
        const speechLevel = Math.max(voiceSpeechLevel, Math.min(voiceFloor * 4, 0.05));
        const isSpeech = rms > speechLevel || rms > 0.015;
        voiceFrameCount++;
        if (voiceFrameCount <= 4) voiceFloor = voiceFrameCount === 1 ? rms : Math.min(voiceFloor, rms);
        else if (!isSpeech) voiceFloor = voiceFloor * 0.9 + rms * 0.1;
        voiceLevel.value = Math.max(Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.0001)) + 60) / 48)), voiceLevel.value * 0.75);
        const now = performance.now();
        if (isSpeech) {
          voiceSawSpeech = true;
          voiceSpeechAt = now;
        } else if (voiceSawSpeech) {
          // 说过话之后静音一段时间就自动结束，不用用户再点一次。
          if (now - voiceSpeechAt > voiceSilenceDuration) void stopVoiceInput();
        } else if (now - voiceListenAt > voiceNoSpeechDuration) {
          // 一直没判到语音：有明显音量（只是偏小）仍送识别，全程静音才放弃，避免模型把静音幻觉成文字。
          if (voicePeakLevel > voiceSpeechLevel * 0.4) void stopVoiceInput();
          else {
            cancelVoiceInput();
            ElMessage.warning("没有检测到语音，已停止录音");
          }
        }
      };
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
      if (context.state === "suspended") await context.resume();
      if (run !== voiceRun) return;
      voiceState.value = "listening";
      voiceListenAt = performance.now();
      options.onStart();
      voiceLimitTimer = window.setTimeout(() => void stopVoiceInput(), voiceMaxDuration);
    } catch (error) {
      if (run === voiceRun) cancelVoiceInput();
      ElMessage.warning(describeMediaError(error));
    }
  }

  async function stopVoiceInput() {
    if (voiceState.value !== "starting" && voiceState.value !== "listening") return;
    clearVoicePress();
    suppressClickUntil = Date.now() + clickSuppressDelay;
    const instance = voiceInstance;
    const position = voicePosition;
    const chunks = voiceChunks;
    const sampleRate = voiceSampleRate;
    const run = ++voiceRun;
    stopVoiceCapture();
    voiceChunks = [];
    voiceInstance = undefined;
    voicePosition = undefined;
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (length < (sampleRate * voiceMinDuration) / 1000) {
      voiceState.value = "idle";
      if (length) ElMessage.warning("录音时间太短，请说完再结束");
      return;
    }
    voiceState.value = "stopping";
    try {
      const text = await transcribeVoice(encodeWav(chunks, sampleRate));
      if (run !== voiceRun) return;
      if (!text) {
        ElMessage.warning("没有识别到语音内容，请重试");
        return;
      }
      if (!instance || !position || options.getSender() !== instance || !options.active() || options.disabled()) return;
      instance.enable();
      if (instance.chatElement.richText.contains(position.instance.$el)) {
        position.instance.focus(Math.min(position.offset, position.instance.$el.textContent?.length ?? 0));
      } else {
        instance.focus("last");
      }
      await instance.setText(text);
    } catch (error) {
      if (run === voiceRun) ElMessage.warning(error instanceof Error ? error.message : "语音识别失败");
    } finally {
      if (run === voiceRun) voiceState.value = "idle";
    }
  }

  function toggleVoiceInput() {
    if (Date.now() < suppressClickUntil) return;
    if (voiceActive.value) void stopVoiceInput();
    else void startVoiceInput();
  }

  function isVoiceEditorFocused() {
    const instance = options.getSender();
    return !!instance && instance.chatElement.richText.contains(document.activeElement);
  }

  // 按一下开始、再按一下结束：输入框为空时裸空格可用，有内容时只认 Ctrl+Shift+Space，避免长按覆盖已输入的文字。
  function handleVoiceKeydown(event: KeyboardEvent) {
    if (event.key !== " " || event.repeat || event.isComposing) return;
    const instance = options.getSender();
    if (!instance || !instance.chatElement.richText.contains(document.activeElement)) return;
    const combo = event.ctrlKey && event.shiftKey;
    if (!combo && !instance.isEmpty(false)) return;
    if (combo) {
      event.preventDefault();
      if (voiceActive.value) void stopVoiceInput();
      else void startVoiceInput();
      return;
    }
    if (voiceActive.value) {
      event.preventDefault();
      void stopVoiceInput();
      return;
    }
    // 裸空格先照常输入，按住 450 毫秒才切成录音，短按仍是普通空格。
    window.clearTimeout(voiceKeyTimer);
    voiceKeyTimer = window.setTimeout(async () => {
      if (voiceActive.value || !instance.isEmpty(false) || !isVoiceEditorFocused()) return;
      await instance.setText("");
      void startVoiceInput();
    }, 450);
  }

  function handleVoiceKeyup(event: KeyboardEvent) {
    if (event.key !== " ") return;
    // 按下即开始/结束，松开不结束录音；这里只清掉没到 450 毫秒的长按计时。
    window.clearTimeout(voiceKeyTimer);
  }

  watch([options.active, options.disabled], ([active, disabled]) => {
    if (!active || disabled) cancelVoiceInput();
  }, { flush: "sync" });
  window.addEventListener("pointermove", moveVoicePress, true);
  window.addEventListener("pointerup", releaseVoicePress, true);
  window.addEventListener("pointercancel", cancelVoiceInput, true);
  window.addEventListener("blur", cancelVoiceInput);
  window.addEventListener("keydown", cancelVoiceInput);
  window.addEventListener("keydown", handleVoiceKeydown);
  window.addEventListener("keyup", handleVoiceKeyup);
  document.addEventListener("visibilitychange", cancelVoiceInput);
  onScopeDispose(() => {
    cancelVoiceInput();
    window.clearTimeout(voiceKeyTimer);
    window.removeEventListener("pointermove", moveVoicePress, true);
    window.removeEventListener("pointerup", releaseVoicePress, true);
    window.removeEventListener("pointercancel", cancelVoiceInput, true);
    window.removeEventListener("blur", cancelVoiceInput);
    window.removeEventListener("keydown", cancelVoiceInput);
    window.removeEventListener("keydown", handleVoiceKeydown);
    window.removeEventListener("keyup", handleVoiceKeyup);
    document.removeEventListener("visibilitychange", cancelVoiceInput);
  });

  return { voiceSupported, voiceState, voiceActive, voiceButtonLabel, voiceLevel, armVoiceInput, startVoiceInput, stopVoiceInput, toggleVoiceInput, clearVoicePress, cancelVoiceInput };
}
