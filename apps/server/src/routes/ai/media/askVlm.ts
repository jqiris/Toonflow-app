import { Router } from "express";
import { z } from "zod";
import { askVlmSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import { translateMessage, validationOptions } from "@/lib/i18n";
import u from "@/utils";

// 本机视觉模型问答（引擎 kind=vlm）：对图片/视频提问做生成后自动质检；素材为工作区相对路径。
export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
}), async (req, res) => {
  const { directory, ...input } = req.body;
  const parsed = askVlmSchema.safeParse(input, validationOptions());
  if (!parsed.success) {
    res.status(400).json(error("参数错误", parsed.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    return;
  }
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  res.set("Cache-Control", "no-store").json(success(await u.mediaGeneration.askVlmMedia(cwd, parsed.data)));
});
