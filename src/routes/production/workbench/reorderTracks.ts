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
    trackIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, scriptId, trackIds } = req.body;

    // 对所有 trackIds 校验其确实属于当前 project+script
    const existing = await u.db("o_videoTrack").where({ projectId, scriptId });
    const existingIds = new Set(existing.map((t: any) => t.id));
    for (const id of trackIds) {
      if (!existingIds.has(id)) {
        return res.status(400).json(success(`trackId ${id} 不属于当前项目`));
      }
    }

    // 批量更新 sort 值（按传入顺序赋 0,1,2,...）
    const updates = trackIds.map((id: number, index: number) => ({
      id,
      sort: index,
    }));
    // SQLite 支持 INSERT OR REPLACE 风格的批量更新
    // 使用事务逐条更新
    await u.db.transaction(async (trx: any) => {
      for (const { id, sort } of updates) {
        await trx("o_videoTrack").where("id", id).update({ sort });
      }
    });

    res.status(200).send(success({ message: "轨道排序已更新" }));
  },
);
