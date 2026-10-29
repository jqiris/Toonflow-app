import { computed, onScopeDispose, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { createBrowserAsr, isBrowserAsrSupported, type BrowserAsrState } from "@toonflow/asr";
import type xSender from "x-sender";

const voiceMaxDuration = 120000;
const clickSuppressDelay = 400;
// ACT: 说完自动结束用固定音量阈值与静音时长，不引入 VAD 库；环境噪声大或语速慢时可调这三个值。
const voiceSilenceDuration = 1500;
const voiceNoSpeechDuration = 4000;
const voiceSpeechLevel = 0.01;

const voiceErrors: Record<string, string> = {
  network: "系统语音识别服务暂时连接不上，请检查网络后重试",
  "not-allowed": "麦克风权限未获允许，请在浏览器或系统设置中开启",
  "service-not-allowed": "当前环境未允许使用系统语音识别服务",
  "audio-capture": "无法使用麦克风，请检查设备连接和占用情况",
  "no-speech": "未检测到语音，请再说一次",
  "language-not-supported": "系统语音识别暂不支持中文",
  aborted: "本次语音识别已中断，请重试",
};

function describeMediaError(error: unknown) {
  if (!(error instanceof Error)) return "无法启动录音";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") return "麦克风权限未获允许，请在浏览器或系统设置中开启";
  if (error.name === "NotFoundError") return "未检测到麦克风设备";
  if (error.name === "NotReadableError") return "麦克风被其他程序占用，请检查设备占用情况";
  return error.message || "无法启动录音";
}

export default function useVoiceInput(options: {
  getSender: () => xSender | undefined;
  active: () => boolean;
  disabled: () => boolean;
  locked: () => boolean;
  onStart: () => void;
}) {
  const voiceSupported = isBrowserAsrSupported();
  const voiceState = ref<BrowserAsrState>("idle");
  const voiceLevel = ref(0);
  const voiceActive = computed(() => voiceState.value !== "idle");
  const voiceButtonLabel = computed(() => !voiceSupported ? "当前环境不支持系统语音识别"
    : voiceActive.value ? "结束语音输入" : "长按输入框语音输入，也可点击开始");
  // 录音结束后点击会紧接着触发一次 pointerup/click，用它避免刚结束又被点开。
  let suppressClickUntil = 0;
  let voicePress: { pointerId: number; x: number; y: number; timer: number } | undefined;
  let voiceAsr: ReturnType<typeof createBrowserAsr> | undefined;
  let finishingVoice: ReturnType<typeof createBrowserAsr> | undefined;
  let voiceFinalText = "";
  let voiceLimitTimer = 0;
  let voiceStopTimer = 0;
  let voiceInstance: xSender | undefined;
  let voicePosition: ReturnType<xSender["getCurrentNode"]> | undefined;
  // 电平与静音判定单独采集麦克风，识别由系统语音服务自己完成。
  let meterStream: MediaStream | undefined;
  let meterContext: AudioContext | undefined;
  let meterSource: MediaStreamAudioSourceNode | undefined;
  let meterProcessor: ScriptProcessorNode | undefined;
  let meterSilence: GainNode | undefined;
  let voiceSawSpeech = false;
  let voiceSpeechAt = 0;
  let voiceListenAt = 0;
  let voiceFloor = 0;
  let voiceFrameCount = 0;
  let voicePeakLevel = 0;
  let voiceKeyTimer = 0;

  function stopVoiceMeter() {
    meterProcessor?.disconnect();
    meterSource?.disconnect();
    meterSilence?.disconnect();
    meterProcessor = undefined;
    meterSource = undefined;
    meterSilence = undefined;
    meterStream?.getTracks().forEach(track => track.stop());
    meterStream = undefined;
    const context = meterContext;
    meterContext = undefined;
    if (context && context.state !== "closed") void context.close().catch(error => console.warn("关闭麦克风音量采集失败", error));
    window.clearTimeout(voiceLimitTimer);
    voiceLimitTimer = 0;
    voiceLevel.value = 0;
  }

  function stopVoiceLimit() {
    window.clearTimeout(voiceLimitTimer);
    voiceLimitTimer = 0;
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

  function startVoiceMeter(asr: ReturnType<typeof createBrowserAsr>) {
    stopVoiceMeter();
    voiceSawSpeech = false;
    voiceSpeechAt = 0;
    voiceListenAt = performance.now();
    voiceFloor = 0;
    voiceFrameCount = 0;
    voicePeakLevel = 0;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") throw new Error("当前环境无法读取麦克风音量");
        const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (voiceAsr !== asr) {
          media.getTracks().forEach(track => track.stop());
          return;
        }
        let context: AudioContext;
        try {
          context = new AudioContext({ sampleRate: 16000 });
        } catch {
          context = new AudioContext();
        }
        meterContext = context;
        meterStream = media;
        const source = context.createMediaStreamSource(media);
        // ACT: ScriptProcessor 已废弃，但不需要额外的 worklet 模块文件；这里只用于读电平和判静音。
        const processor = context.createScriptProcessor(4096, 1, 1);
        const silence = context.createGain();
        silence.gain.value = 0;
        meterSource = source;
        meterProcessor = processor;
        meterSilence = silence;
        processor.onaudioprocess = event => {
          if (voiceAsr !== asr) return;
          const channel = event.inputBuffer.getChannelData(0);
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
            // 说过话之后静音一段时间就自动收尾，不用用户再点一次。
            if (now - voiceSpeechAt > voiceSilenceDuration) stopVoiceInput();
          } else if (now - voiceListenAt > voiceNoSpeechDuration) {
            // 一直没判到语音：有明显音量（只是偏小）仍交给识别判断，全程静音才放弃。
            if (voicePeakLevel > voiceSpeechLevel * 0.4) stopVoiceInput();
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
        if (voiceAsr !== asr) return;
        voiceListenAt = performance.now();
      } catch (error) {
        if (voiceAsr !== asr) return;
        stopVoiceMeter();
        console.warn("无法读取麦克风音量", error);
      }
    })();
  }

  function clearVoicePress() {
    if (voicePress) window.clearTimeout(voicePress.timer);
    voicePress = undefined;
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

  // 长按只负责开始录音：松手或指针被手势取消都不结束录音，结束交给语音按钮、静音判定或 Esc，
  // 否则按住时的轻微移动、拖选文本或系统长按手势都会把正在进行的录音打断。
  function releaseVoicePress(event: PointerEvent) {
    if (voicePress?.pointerId === event.pointerId) clearVoicePress();
  }

  function handlePointerCancel(event: PointerEvent) {
    if (voicePress?.pointerId === event.pointerId) clearVoicePress();
  }

  function cancelVoiceInput(event?: Event) {
    if (event instanceof KeyboardEvent && event.key !== "Escape") return;
    if (event?.type === "visibilitychange" && !document.hidden) return;
    // 首次录音会弹出系统麦克风授权，窗口失焦属于正常流程，不能据此取消。
    if (event?.type === "blur" && voiceState.value === "starting") return;
    if (event instanceof KeyboardEvent && voiceActive.value) event.preventDefault();
    window.clearTimeout(voiceKeyTimer);
    window.clearTimeout(voiceStopTimer);
    voiceStopTimer = 0;
    clearVoicePress();
    stopVoiceMeter();
    const asr = voiceAsr;
    voiceAsr = undefined;
    voiceFinalText = "";
    voiceInstance = undefined;
    voicePosition = undefined;
    voiceState.value = "idle";
    try {
      asr?.destroy();
    } catch (error) {
      console.warn("关闭语音识别失败", error);
    }
  }

  async function startVoiceInput() {
    const instance = options.getSender();
    if (!instance || options.locked() || !options.active() || instance.chatEditor.isComposition) return;
    if (!voiceSupported) {
      clearVoicePress();
      ElMessage.warning("当前环境不支持系统语音识别");
      return;
    }
    // 不复用 cancelVoiceInput：它会清掉长按的 pointer 状态，导致松开手指无法结束录音。
    window.clearTimeout(voiceStopTimer);
    voiceStopTimer = 0;
    stopVoiceMeter();
    try {
      const position = captureVoicePosition(instance);
      const asr = createBrowserAsr({
        lang: "zh-CN",
        continuous: true,
        onStateChange(state) {
          if (voiceAsr !== asr || state === "destroyed") return;
          if (state === "idle") void finishVoiceInput(asr);
          else voiceState.value = state;
        },
        onResult({ finalText }) {
          if (voiceAsr !== asr) return;
          voiceFinalText = finalText;
        },
        onError({ code, message }) {
          if (voiceAsr !== asr) return;
          cancelVoiceInput();
          ElMessage.warning(voiceErrors[code] ?? `语音识别失败：${message}`);
        },
      });
      voiceAsr = asr;
      voiceFinalText = "";
      voiceInstance = instance;
      voicePosition = position;
      voiceState.value = "starting";
      options.onStart();
      asr.start();
      startVoiceMeter(asr);
      voiceLimitTimer = window.setTimeout(() => void stopVoiceInput(), voiceMaxDuration);
    } catch (error) {
      cancelVoiceInput();
      ElMessage.warning(error instanceof Error ? error.message : describeMediaError(error));
    }
  }

  function stopVoiceInput() {
    clearVoicePress();
    if (voiceState.value !== "starting" && voiceState.value !== "listening") return;
    suppressClickUntil = Date.now() + clickSuppressDelay;
    stopVoiceMeter();
    stopVoiceLimit();
    try {
      voiceAsr?.stop();
    } catch (error) {
      cancelVoiceInput();
      ElMessage.warning(error instanceof Error ? error.message : "无法结束语音识别");
      return;
    }
    // 浏览器偶发不回调 onend，这里兜底收尾，避免输入框一直停在录音状态。
    const asr = voiceAsr;
    window.clearTimeout(voiceStopTimer);
    voiceStopTimer = window.setTimeout(() => {
      if (!asr || voiceAsr !== asr) return;
      if (voiceFinalText.trim()) {
        void finishVoiceInput(asr);
        return;
      }
      cancelVoiceInput();
      ElMessage.warning("语音识别没有响应，请重试");
    }, 6000);
  }

  async function finishVoiceInput(asr: ReturnType<typeof createBrowserAsr>) {
    // onend 与停止兜底可能同时到达，同一实例只回填一次。
    if (finishingVoice === asr) return;
    finishingVoice = asr;
    const text = voiceFinalText;
    window.clearTimeout(voiceStopTimer);
    voiceStopTimer = 0;
    stopVoiceMeter();
    stopVoiceLimit();
    clearVoicePress();
    voiceState.value = "stopping";
    try {
      asr.destroy();
      const instance = voiceInstance;
      const position = voicePosition;
      if (!text.trim()) {
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
      ElMessage.warning(error instanceof Error ? error.message : "语音文字回填失败");
    } finally {
      if (finishingVoice === asr) finishingVoice = undefined;
      if (voiceAsr === asr) {
        voiceAsr = undefined;
        voiceFinalText = "";
        voiceInstance = undefined;
        voicePosition = undefined;
        voiceState.value = "idle";
      }
    }
  }

  function toggleVoiceInput() {
    if (Date.now() < suppressClickUntil) return;
    if (voiceActive.value) stopVoiceInput();
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
      toggleVoiceInput();
      return;
    }
    if (voiceActive.value) {
      event.preventDefault();
      stopVoiceInput();
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
  window.addEventListener("pointercancel", handlePointerCancel, true);
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
    window.removeEventListener("pointercancel", handlePointerCancel, true);
    window.removeEventListener("blur", cancelVoiceInput);
    window.removeEventListener("keydown", cancelVoiceInput);
    window.removeEventListener("keydown", handleVoiceKeydown);
    window.removeEventListener("keyup", handleVoiceKeyup);
    document.removeEventListener("visibilitychange", cancelVoiceInput);
  });

  return { voiceSupported, voiceState, voiceActive, voiceButtonLabel, voiceLevel, armVoiceInput, startVoiceInput, stopVoiceInput, toggleVoiceInput, clearVoicePress, cancelVoiceInput };
}
