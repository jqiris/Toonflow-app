import u from "@/utils";
import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

type AsrSettings = { baseUrl?: unknown; apiKey?: unknown; model?: unknown };

function readAsrSettings() {
  const value = (u.conf.get("settings", {}) as { asr?: AsrSettings }).asr;
  const baseUrl = typeof value?.baseUrl === "string" ? value.baseUrl.trim().replace(/\/+$/, "") : "";
  if (!baseUrl) throw Object.assign(new Error("请先在设置中配置语音识别服务地址"), { status: 400 });
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error("语音识别服务地址无效"), { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw Object.assign(new Error("语音识别服务地址必须以 http 或 https 开头"), { status: 400 });
  return {
    endpoint: baseUrl.endsWith("/v1") ? `${baseUrl}/audio/transcriptions` : `${baseUrl}/v1/audio/transcriptions`,
    apiKey: typeof value?.apiKey === "string" ? value.apiKey.trim() : "",
    model: typeof value?.model === "string" && value.model.trim() ? value.model.trim() : "whisper-1",
  };
}

export default router.post("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw Object.assign(new Error("请发送录音内容"), { status: 400 });
  const { endpoint, apiKey, model } = readAsrSettings();
  const form = new FormData();
  form.set("file", new Blob([req.body], { type: "audio/wav" }), "speech.wav");
  form.set("model", model);
  form.set("language", "zh");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw Object.assign(new Error(`连接语音识别服务失败：${error instanceof Error ? error.message : "未知错误"}`), { status: 502 });
  }
  const payload = await response.json().catch(() => null) as { text?: unknown; error?: { message?: unknown }; detail?: unknown } | null;
  if (!response.ok) {
    // FastAPI 风格的校验错误把说明放在 detail 数组里。
    const detail = Array.isArray(payload?.detail) ? (payload.detail[0] as { msg?: unknown } | undefined)?.msg : payload?.detail;
    const message = typeof payload?.error?.message === "string" ? payload.error.message
      : typeof detail === "string" ? detail : `语音识别服务返回 ${response.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  res.json(success({ text: typeof payload?.text === "string" ? payload.text.trim() : "" }));
});
