import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { getMediaProvider, loadMediaProviderSource } from "@/utils/media/provider";

/**
 * 取引擎权威的白模场景代码规范（guide.whitebox_scene_prompt，含 {SHOT} 占位）。
 *
 * ACT: agent 会话自己写 build(THREE) 代码前，先用本路由拿规范——规范由引擎版本决定，
 * 不能写死在提示词里（引擎升级会变）。本路由只读 guide，零模型调用。
 */
const inputSchema = z.strictObject({
  directory: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(128),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body);
  await u.workspace.resolveWorkspace(req, input.directory);
  const info = await getMediaProvider(input.providerId);
  const configurations = u.conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const provider = await loadMediaProviderSource(info.source, { ...configurations?.[input.providerId] });
  if (!provider.whitebox?.available || !provider.whitebox.getPrompt) throw Object.assign(new Error("当前视频供应商不支持白模参考"), { status: 400 });
  const prompt = await provider.whitebox.getPrompt.call(provider);
  res.set("Cache-Control", "no-store").json(success({ prompt }));
});
