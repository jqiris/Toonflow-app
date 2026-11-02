import { Router } from "express";
import { z } from "zod";
import { musicSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import { translateMessage, validationOptions } from "@/lib/i18n";
import u from "@/utils";

// 引擎配乐（kind=music）：对已保存的编辑工程作曲并铺到音轨 a2 第 0 帧，产物长度=时间线长度。
export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
}), async (req, res) => {
  const { directory, ...input } = req.body;
  const parsed = musicSchema.safeParse(input, validationOptions());
  if (!parsed.success) {
    res.status(400).json(error("参数错误", parsed.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    return;
  }
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  res.set("Cache-Control", "no-store").json(success(await u.mediaGeneration.musicMedia(cwd, parsed.data)));
});
