import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    storyboardId: z.number(),
    projectId: z.number(),
    scriptId: z.number(),
    videoPrompt: z.string().optional(),
  }),
  async (req, res) => {
    const { storyboardId, projectId, scriptId, videoPrompt } = req.body;

    const storyboard = await u.db("o_storyboard").where("id", storyboardId).first();
    if (!storyboard) return res.status(400).json(success("分镜不存在"));

    // 读取剧本原文（含对话）
    const scriptData = await u.db("o_script").where("id", scriptId).first();
    const scriptContent = scriptData?.content || "";

    // 查找下一帧（index > 当前，且有 filePath 的最近一个分镜）
    const nextStoryboard = await u
      .db("o_storyboard")
      .where("scriptId", scriptId)
      .where("projectId", projectId)
      .where("index", ">", storyboard.index ?? -1)
      .whereNotNull("filePath")
      .where("filePath", "!=", "")
      .orderBy("index", "asc")
      .first();
    const hasNext = !!nextStoryboard;

    const videoGenPrompt = videoPrompt || storyboard.prompt || "";
    const nextPrompt = nextStoryboard?.prompt || "";

    const promptLinesRes = await u.Ai.Text("universalAi").invoke({
      messages: [
        {
          role: "user",
          content: `你是一个专业的动画分镜提示词生成助手。根据下面的视频生成提示词和剧本对话，生成 9 行提示词，每行对应九宫格中一个格子的画面内容。

视频生成提示词：
${videoGenPrompt}

${scriptContent ? `剧本原文（含对话）：\n${scriptContent}\n` : ""}
${hasNext ? `下一帧画面描述：\n${nextPrompt}` : "注意：没有下一帧画面，请从起始场景向前推演"}

输出要求：
- 第1行 = 第1格的画面（起始场景，保持与当前帧一致）
- 第2-8行 = 中间过渡格的画面（逐格递进变化，从起始逐步过渡到结束）
- ${hasNext ? "第9行 = 第9格的画面（结束场景，对应下一帧）" : "第9行 = 第9格的画面（最终延续画面）"}
- 每行一个提示词，内容需要包含该格的角色动作、表情、对话氛围、镜头视角
- 必须结合剧本对话来设计每格的角色表现和场景情绪，让画面有叙事感
- 总共输出 9 行，不要序号、不要空行、不要额外说明`,
        },
      ],
    });

    const rawText = promptLinesRes.text?.trim() || "";
    const lines = rawText.split("\n").map((l: string) => l.trim()).filter((l: string) => l);
    while (lines.length < 9) lines.push("");
    const gridPrompt = lines.slice(0, 9).join("\n");

    // 保存到 DB
    await u.db("o_storyboard").where("id", storyboardId).update({ gridPrompt });

    res.status(200).send(success({ gridPrompt }));
  },
);
