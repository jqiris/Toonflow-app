import { Router } from "express";
import { z } from "zod";
import { audioGenerationSchema, imageGenerationSchema, videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import { translateMessage, validationOptions } from "@/lib/i18n";
import u from "@/utils";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096).optional(), mediaType: z.enum(["image", "video", "audio"]),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { directory, mediaType, ...request } = req.body;
  // ACT: videoGenerationSchema 带续接约束的顶层 refine，zod 4 下覆盖已有键必须用 safeExtend——extend 会抛「Cannot overwrite keys on object schemas containing refinements」。
  const schema = (mediaType === "image" ? imageGenerationSchema : mediaType === "video" ? videoGenerationSchema : audioGenerationSchema).safeExtend({ prompt: z.string().trim().max(100000) });
  const parsed = schema.safeParse(request, validationOptions());
  if (!parsed.success) {
    res.status(400).json(error("参数错误", parsed.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    return;
  }
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    const cwd = directory ? await u.workspace.resolveWorkspace(req, directory) : undefined;
    const price = await u.mediaGeneration.getMediaPrice(cwd, mediaType, parsed.data, controller.signal);
    if (!res.destroyed) res.set("Cache-Control", "no-store").json(success(price));
  } catch (err) {
    if (!controller.signal.aborted) throw err;
    // ACT: aborted 吞错后若不落响应，非断开类 abort 源（如未来加超时）会让连接悬挂；客户端断开时 destroyed 已为真，跳过。
    if (!res.writableEnded && !res.destroyed) res.end();
  } finally {
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
  }
});
