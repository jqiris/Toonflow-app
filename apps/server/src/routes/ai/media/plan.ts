import { Router } from "express";
import { z } from "zod";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import { translateMessage, validationOptions } from "@/lib/i18n";
import u from "@/utils";

// 提交前预检（引擎 /plan）：入参与 generate 同形但不建任务、不占队列，返回分块计划与实际几何。
export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
}), async (req, res) => {
  const { directory, ...request } = req.body;
  const parsed = videoGenerationSchema.safeParse(request, validationOptions());
  if (!parsed.success) {
    res.status(400).json(error("参数错误", parsed.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    return;
  }
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  res.set("Cache-Control", "no-store").json(success(await u.mediaGeneration.planMedia(cwd, parsed.data)));
});
