import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 内存中的九宫格生成进度
const progressStore = new Map<number, { current: number; total: number }>();

// GET 进度查询
router.get("/progress/:storyboardId", (req, res) => {
  const id = parseInt(req.params.storyboardId);
  const p = progressStore.get(id);
  if (!p) return res.json({ done: true });
  res.json(p);
});

// POST 九宫格生成
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

    const storyboard = await u
      .db("o_storyboard")
      .where({ id: storyboardId, projectId, scriptId })
      .first();

    if (!storyboard) return res.status(400).send(error("分镜不存在"));
    if (!storyboard.filePath) return res.status(400).send(error("分镜尚未生成图片"));
    if (!videoPrompt) return res.status(400).send(error("请先填写视频生成提示词"));

    const nextStoryboard = await u
      .db("o_storyboard")
      .where({ projectId, scriptId })
      .where("index", ">", storyboard.index)
      .whereNotNull("filePath")
      .where("filePath", "!=", "")
      .orderBy("index", "asc")
      .first();

    const hasNext = !!nextStoryboard;

    const projectSetting = await u
      .db("o_project")
      .where("id", projectId)
      .select("imageModel", "derivativeImageModel", "imageQuality", "videoRatio")
      .first();

    const imageModel = (projectSetting?.derivativeImageModel || projectSetting?.imageModel) as `${string}:${string}`;
    if (!imageModel) return res.status(400).send(error("项目未配置图片模型"));

    const aspectRatio = (projectSetting?.videoRatio || "16:9") as `${number}:${number}`;
    const size = (projectSetting?.imageQuality || "1K") as "1K" | "2K" | "4K";
    // 九宫格每个格子小，用 2K 生图再下采样到格子尺寸，清晰度比 1K 直出好很多
    const cellSize: "1K" | "2K" | "4K" = size === "4K" ? "4K" : "2K";

    const currentBase64 = await u.oss.getImageBase64(storyboard.filePath!);
    const nextBase64 = hasNext && nextStoryboard.filePath ? await u.oss.getImageBase64(nextStoryboard.filePath) : null;

    const templateAbsPath = path.join(u.getPath("assets"), "nine_grid_template.png");
    const templateBuffer = await fs.readFile(templateAbsPath);

    const videoGenPrompt = videoPrompt || storyboard.prompt || "";
    const nextPrompt = nextStoryboard?.prompt || "";

    // 读取剧本原文（含对话）
    const scriptData = await u.db("o_script").where("id", scriptId).first();
    const scriptContent = scriptData?.content || "";

    // 如果 gridPrompt 为空，先用 AI text 模型生成 9 行提示词
    if (!storyboard.gridPrompt) {
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
      const generatedPrompt = promptLinesRes.text?.trim() || "";
      if (generatedPrompt) {
        // 拆行验证至少有 9 行，不足则用空行补齐
        const lines = generatedPrompt.split("\n").map((l: string) => l.trim()).filter((l: string) => l);
        while (lines.length < 9) lines.push("");
        storyboard.gridPrompt = lines.slice(0, 9).join("\n");
        await u.db("o_storyboard").where("id", storyboardId).update({ gridPrompt: storyboard.gridPrompt });
      }
    }

    // 中间格数量：有下一帧→7格(2-8)，无下一帧→8格(2-9)
    const cellCount = hasNext ? 7 : 8;

    const tempPaths: string[] = [];
    const cellBuffers: Buffer[] = [];

    // 链式递进：每一格的输出作为下一格的参考图
    let prevBase64 = currentBase64;

    try {
      progressStore.set(storyboardId, { current: 0, total: cellCount });

      // 解析 gridPrompt 按行分割，优先使用用户自定义的每格提示词
      const gridPromptLines = (storyboard.gridPrompt || "")
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l);
      // 规则：若正好 cellCount 行→直接映射；若≥cellCount+1行→跳过第1格对应的行
      let gridPromptForCells: string[] = [];
      if (gridPromptLines.length === cellCount) {
        gridPromptForCells = gridPromptLines;
      } else if (gridPromptLines.length >= cellCount + 1) {
        gridPromptForCells = gridPromptLines.slice(1, cellCount + 1);
      }

      for (let i = 0; i < cellCount; i++) {
        const cellIndex = i + 2;
        const step = i + 1;
        const progressPct = Math.round((step / (cellCount + 1)) * 100);

        const cellPrompt = gridPromptForCells[i]
          ? `请根据参考图的风格，生成一张独立的剧情图（单图，不是网格图）。

【画面内容】
${gridPromptForCells[i]}

【要求】
- 这是一张完整的独立单图，画面内容根据以上描述决定
- 角色、场景、光影风格与参考图保持一致
- 画面不得出现网格线、边框、数字、文字`
          : hasNext
            ? `请根据参考图的风格，生成一张独立的剧情过渡图（单图，不是网格图）。

【画面定位】
九宫格第 ${cellIndex} 格 — 过渡图 ${step}/${cellCount}
画面处于从起始场景到结束场景过渡的约 ${progressPct}% 位置

【画面风格参考】
${videoGenPrompt}

${nextPrompt ? `【过渡终点画面描述】\n${nextPrompt}` : ""}

【要求】
- 这是一张完整的独立单图，画面内容根据画面定位决定
- 角色、场景、光影风格与参考图保持一致
- 画面不得出现网格线、边框、数字、文字`
            : `请根据参考图的风格，生成一张独立的剧情推演图（单图，不是网格图）。

【画面定位】
九宫格第 ${cellIndex} 格 — 推演图 ${step}/${cellCount}
画面处于从起始场景向前推演的约 ${progressPct}% 位置
（第${cellCount}步为最终延续画面）

【画面风格参考】
${videoGenPrompt}

【要求】
- 这是一张完整的独立单图，画面内容根据画面定位决定
- 角色、场景、光影风格与参考图保持一致
- 画面不得出现网格线、边框、数字、文字`;

        const imageCls = await u.Ai.Image(imageModel).run(
          { referenceList: [{ type: "image" as const, base64: prevBase64 }], prompt: cellPrompt, size: cellSize, aspectRatio },
          { taskClass: "生成九宫格格子", describe: `九宫格第${cellIndex}格`, relatedObjects: JSON.stringify({ storyboardId }), projectId },
        );

        const tmp = `/${projectId}/nineGrid/temp/${u.uuid()}.jpg`;
        tempPaths.push(tmp);
        await imageCls.save(tmp);

        const buf = await u.oss.getFile(tmp);
        cellBuffers.push(buf);

        // 转换为 base64 作为下一格的参考图
        prevBase64 = `data:image/jpeg;base64,${buf.toString("base64")}`;

        progressStore.set(storyboardId, { current: step, total: cellCount });
      }

      progressStore.delete(storyboardId);

      // ─── sharp 合成九宫格 ───
      const templateMeta = await sharp(templateBuffer).metadata();
      const tplW = templateMeta.width!;
      const tplH = templateMeta.height!;
      const cellW = Math.round(tplW / 3);
      const cellH = Math.round(tplH / 3);

      // Cell 1：当前帧原图
      const currentRaw = Buffer.from(currentBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      const cell1Buf = await sharp(currentRaw).resize(cellW, cellH, { fit: "cover", kernel: sharp.kernel.lanczos3 }).toBuffer();

      // 中间格：resize AI 输出
      const midBufs = await Promise.all(
        cellBuffers.map((buf) => sharp(buf).resize(cellW, cellH, { fit: "cover", kernel: sharp.kernel.lanczos3 }).toBuffer()),
      );

      // Cell 9（有下一帧时）：下一帧原图
      let cell9Buf: Buffer | null = null;
      if (hasNext && nextBase64) {
        const nextRaw = Buffer.from(nextBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
        cell9Buf = await sharp(nextRaw).resize(cellW, cellH, { fit: "cover", kernel: sharp.kernel.lanczos3 }).toBuffer();
      }

      // 网格位置（行,列），跳过(0,0)=cell 1
      const gridPositions: [number, number][] = [
        [0, 1], [0, 2],
        [1, 0], [1, 1], [1, 2],
        [2, 0], [2, 1], [2, 2],
      ];

      const compositeOps: sharp.OverlayOptions[] = [
        { input: templateBuffer, top: 0, left: 0 },
        { input: cell1Buf, top: 0, left: 0 },
      ];

      for (let i = 0; i < midBufs.length; i++) {
        const [row, col] = gridPositions[i];
        compositeOps.push({ input: midBufs[i], top: row * cellH, left: col * cellW });
      }

      if (cell9Buf) {
        compositeOps.push({ input: cell9Buf, top: 2 * cellH, left: 2 * cellW });
      }

      const resultBuffer = await sharp({
        create: { width: tplW, height: tplH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite(compositeOps)
        .jpeg({ quality: 92 })
        .toBuffer();

      const frameNo = (storyboard.index ?? 0) + 1;
const savePath = `/${projectId}/nineGrid/${scriptId}/P${frameNo}.jpg`;
      await u.oss.writeFile(savePath, resultBuffer);

      await u.db("o_storyboard").where("id", storyboardId).update({
        nineGridPath: savePath,
        nineGridEnabled: 1,
      });

      const nineGridUrl = await u.oss.getSmallImageUrl(savePath);
      res.status(200).send(success({ nineGridPath: savePath, nineGridUrl, gridPrompt: storyboard.gridPrompt || "" }));
    } catch (e) {
      progressStore.delete(storyboardId);
      await u.db("o_storyboard").where("id", storyboardId).update({
        nineGridPath: "",
        nineGridEnabled: 0,
      });
      res.status(500).send(error(`九宫格生成失败：${u.error(e).message}`));
    } finally {
      await Promise.all(tempPaths.map((p) => u.oss.deleteFile(p).catch(() => {})));
    }
  },
);
