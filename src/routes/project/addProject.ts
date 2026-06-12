import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    projectType: z.string(),
    name: z.string(),
    intro: z.string(),
    type: z.string(),
    artStyle: z.string(),
    directorManual: z.string(),
    videoRatio: z.string(),
    imageModel: z.string(),
    derivativeImageModel: z.string(),
    videoModel: z.string(),
    imageQuality: z.string(),
    mode: z.string(),
    concurrentCount: z.number().int().min(1).optional(),
    nineGridImageModel: z.string().optional(),
  }),
  async (req, res) => {
    const { projectType, name, intro, type, directorManual, artStyle, videoRatio, imageModel, derivativeImageModel, videoModel, imageQuality, mode, concurrentCount, nineGridImageModel } = req.body;

    await u.db("o_project").insert({
      id: Date.now(),
      projectType,
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      userId: 1,
      imageModel,
      derivativeImageModel,
      videoModel,
      createTime: Date.now(),
      imageQuality,
      mode,
      concurrentCount: concurrentCount ?? 1,
      nineGridImageModel: nineGridImageModel || "",
    });

    res.status(200).send(success({ message: "新增项目成功" }));
  },
);
