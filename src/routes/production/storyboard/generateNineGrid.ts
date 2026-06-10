import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { error, success } from "@/lib/responseFormat";
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

    const currentBase64 = await u.oss.getImageBase64(storyboard.filePath!);
    const nextBase64 = hasNext && nextStoryboard.filePath ? await u.oss.getImageBase64(nextStoryboard.filePath) : null;

    // 使用静态高清 3x3 网格模板（data/assets/nine_grid_template.png）
    const templateAbsPath = path.join(u.getPath("assets"), "nine_grid_template.png");
    const templateBuffer = await fs.readFile(templateAbsPath);
    const templateBase64 = `data:image/png;base64,${templateBuffer.toString("base64")}`;

    const referenceList: { type: "image"; base64: string }[] = [
      { type: "image", base64: templateBase64 },
      { type: "image", base64: currentBase64 },
    ];
    if (nextBase64) referenceList.push({ type: "image", base64: nextBase64 });

    const videoGenPrompt = videoPrompt || storyboard.prompt || "";
    const nextPrompt = nextStoryboard?.prompt || "";

    const cellCount = hasNext ? 7 : 8;
    const prompt = [
      `请生成 ${cellCount} 张剧情过渡图，按照参考图1的 3×3 网格模板排列成一张九宫格图片。`,
      "",
      "【参考图说明】",
      "- 参考图1：3×3 九宫格模板，每格标注了数字 1～9，作为最终输出布局参考",
      "- 参考图2：当前帧的原图（本分镜的实际生成图），该画面应放在第1格",
      hasNext ? "- 参考图3：下一帧的原图（下一个分镜的实际生成图），该画面应放在第9格" : "",
      "",
      "【九宫格内容要求】",
      "- 第1格：当前帧画面（直接使用参考图2）",
      hasNext
        ? "- 第2～8格：一共 7 张过渡图，画面内容从当前帧逐步过渡到下一帧，风格保持一致\n- 第9格：下一帧画面（直接使用参考图3）"
        : `- 第2～9格：一共 8 张过渡图，画面内容从当前帧出发逐步推演，第9格为最终的延续画面`,
      "",
      "【视频生成提示词】",
      videoGenPrompt,
      "",
      "【输出要求】",
      `- 输出一张完整的图片，内容为 ${cellCount} 张剧情图按 3×3 网格排列`,
      "- 每格内是一张完整画面，与参考图的风格和角色一致",
    ]
      .filter(Boolean)
      .join("\n");

    console.log("【九宫格】提示词:", prompt.slice(0, 200) + "...");

    try {
      const imageCls = await u.Ai.Image(imageModel).run(
        { referenceList, prompt, size, aspectRatio },
        {
          taskClass: "生成九宫格",
          describe: "分镜九宫格生成",
          relatedObjects: JSON.stringify({ storyboardId, prompt, hasNext }),
          projectId,
        },
      );

      // AiImage.result 是私有属性，save 将它写到 OSS，再从 OSS 读出 buffer 做 sharp 处理
      const tempPath = `/${projectId}/nineGrid/temp/${u.uuid()}.jpg`;
      await imageCls.save(tempPath);
      const aiBuffer = await u.oss.getFile(tempPath);

      const aiImage = sharp(aiBuffer);
      const meta = await aiImage.metadata();
      if (!meta.width || !meta.height) {
        await u.db("o_storyboard").where("id", storyboardId).update({ nineGridPath: "" });
        await u.oss.deleteFile(tempPath);
        return;
      }

      const aiW = meta.width;
      const aiH = meta.height;
      const cellW = Math.round(aiW / 3);
      const cellH = Math.round(aiH / 3);

      const currentRaw = Buffer.from(currentBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      const currentResized = await sharp(currentRaw).resize(cellW, cellH, { fit: "cover" }).toBuffer();

      let nextResized: Buffer | null = null;
      if (hasNext && nextBase64) {
        const nextRaw = Buffer.from(nextBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
        nextResized = await sharp(nextRaw).resize(cellW, cellH, { fit: "cover" }).toBuffer();
      }

      const compositeOps: sharp.OverlayOptions[] = [
        { input: aiBuffer, top: 0, left: 0 },
        { input: currentResized, top: 0, left: 0 },
      ];
      if (nextResized) {
        compositeOps.push({ input: nextResized, top: cellH * 2, left: cellW * 2 });
      }

      const resultBuffer = await sharp({
        create: { width: aiW, height: aiH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite(compositeOps)
        .jpeg({ quality: 85 })
        .toBuffer();

      const savePath = `/${projectId}/nineGrid/${scriptId}/${u.uuid()}.jpg`;
      await u.oss.writeFile(savePath, resultBuffer);

      await u.oss.deleteFile(tempPath);

      await u.db("o_storyboard").where("id", storyboardId).update({
        nineGridPath: savePath,
        nineGridEnabled: 1,
      });

      const nineGridUrl = await u.oss.getSmallImageUrl(savePath);
      res.status(200).send(success({ nineGridPath: savePath, nineGridUrl }));
    } catch (e) {
      await u.db("o_storyboard").where("id", storyboardId).update({
        nineGridPath: "",
        nineGridEnabled: 0,
      });
      res.status(500).send(error(`九宫格生成失败：${u.error(e).message}`));
    }
  },
);
