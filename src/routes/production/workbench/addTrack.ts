import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    duration: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, duration } = req.body;
    const data = await u.db("o_project").where("id", projectId).first();
    const video = data?.videoModel?.split(":");
    const vemdor = await u.vendor.getModelList(video?.[0]!);
    const trackId = Date.now()
    const maxSortRow = await u.db("o_videoTrack").where({ projectId, scriptId }).max("sort as maxSort").first();
    const nextSort = (maxSortRow?.maxSort ?? -1) + 1;
    await u.db("o_videoTrack").insert({
      id: trackId,
      projectId,
      scriptId,
      duration,
      sort: nextSort,
    });
    res.status(200).send(success(trackId));
  },
);
