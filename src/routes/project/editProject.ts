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
    id: z.number(),
    name: z.string(),
    intro: z.string(),
    type: z.string(),
    artStyle: z.string(),
    directorManual: z.string(),
    videoRatio: z.string(),
    imageModel: z.string(),
    derivativeImageModel: z.string(),
    videoModel: z.string(),
    projectType: z.string(),
    imageQuality: z.string(),
    mode: z.string(),
    concurrentCount: z.number().int().min(1).optional(),
  }),
  async (req, res) => {
    const { id, name, intro, type, artStyle, videoRatio, directorManual, imageModel, derivativeImageModel, videoModel, imageQuality, projectType, mode, concurrentCount } = req.body;

    await u.db("o_project").where("id", id).update({
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      imageModel,
      derivativeImageModel,
      videoModel,
      imageQuality,
      projectType,
      mode,
      concurrentCount,
    });

    res.status(200).send(success({ message: "编辑项目成功" }));
  },
);
