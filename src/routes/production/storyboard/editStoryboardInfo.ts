import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { id } from "zod/locales";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
  }),
  async (req, res) => {
    const { id, prompt, videoDesc, nineGridEnabled, gridPrompt } = req.body;
    const updateData: Record<string, any> = { prompt, videoDesc };
    if (nineGridEnabled !== undefined) {
      updateData.nineGridEnabled = nineGridEnabled ? 1 : 0;
    }
    if (gridPrompt !== undefined) {
      updateData.gridPrompt = gridPrompt;
    }
    await u.db("o_storyboard").where({ id }).update(updateData);
    res.status(200).send(success({ message: "更新成功" }));
  },
);
