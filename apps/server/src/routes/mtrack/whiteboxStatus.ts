import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { getMediaProvider, loadMediaProviderSource } from "@/utils/media/provider";

/** 白模渲染进度：waiting/rendering/ready（带 work/seconds/earlyRatio）/failed（带 error 原文，可回喂重生成）。 */
const inputSchema = z.strictObject({
  directory: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(128),
  id: z.string().trim().min(1).max(64),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body);
  await u.workspace.resolveWorkspace(req, input.directory);
  const info = await getMediaProvider(input.providerId);
  const configurations = u.conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const provider = await loadMediaProviderSource(info.source, { ...configurations?.[input.providerId] });
  if (!provider.whitebox?.get) throw Object.assign(new Error("当前视频供应商不支持白模参考"), { status: 400 });
  res.set("Cache-Control", "no-store").json(success(await provider.whitebox.get.call(provider, input.id)));
});
