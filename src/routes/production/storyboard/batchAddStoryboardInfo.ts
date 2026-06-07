import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    data: z.array(
      z.object({
        prompt: z.string(),
        duration: z.number(),
        track: z.string(),
        state: z.string(),
        src: z.string().nullable(),
        videoDesc: z.string(),
        shouldGenerateImage: z.number(),
        associateAssetsIds: z.array(z.number()),
      }),
    ),
    scriptId: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { data, scriptId, projectId } = req.body;
    if (!data.length) return res.status(400).send({ success: false, message: "数据不能为空" });

    const allAssetIds = [...new Set(data.flatMap((item: any) => item.associateAssetsIds ?? []))] as number[];
    const validAssetIdSet = new Set<number>();
    if (allAssetIds.length > 0) {
      const existingAssets: any[] = await u.db("o_assets").whereIn("id", allAssetIds as readonly (string | number)[]).select("id");
      for (const a of existingAssets) validAssetIdSet.add(a.id);
      if (validAssetIdSet.size < allAssetIds.length) {
        const missing = allAssetIds.filter((id) => !validAssetIdSet.has(id));
        console.warn(`[batchAddStoryboardInfo] 以下资产ID不存在，已过滤: ${missing.join(", ")}`);
      }
    }

    await u.db.transaction(async (trx) => {
      for (const item of data) {
        const [id] = await trx("o_storyboard").insert({
          prompt: item.prompt,
          duration: String(item.duration),
          state: item.state,
          scriptId,
          projectId,
          track: item.track,
          videoDesc: item.videoDesc,
          shouldGenerateImage: item.shouldGenerateImage,
          createTime: Date.now(),
        });
        if (item.associateAssetsIds?.length) {
          const validIds = [...new Set(item.associateAssetsIds as number[])].filter((aid: number) => validAssetIdSet.has(aid));
          if (validIds.length) {
            await trx("o_assets2Storyboard").insert(
              validIds.map((assetId) => ({
                assetId,
                storyboardId: id,
              })),
            );
          }
        }
        item.id = id;
      }
    });

    const lastStoryboard = await u.db("o_storyboard").where("scriptId", scriptId);
    if (!lastStoryboard || !lastStoryboard.length) return res.status(400).send(error("未查到分镜数据"));
    const storyboardGroupByTrack: Record<string, number[]> = {};
    lastStoryboard.forEach((item: any) => {
      if (!storyboardGroupByTrack[item.track]) {
        storyboardGroupByTrack[item.track] = [];
      }
      storyboardGroupByTrack[item.track].push(item.id);
    });

    for (const track in storyboardGroupByTrack) {
      const storyboardIds = storyboardGroupByTrack[track] ?? [];

      // 计算该track下所有分镜的duration总和
      const trackDuration = lastStoryboard
        .filter((item: any) => item.track == track)
        .reduce((sum: number, item: any) => sum + Number(item.duration), 0);

      const existingStoryboard = await u.db("o_storyboard").where({ scriptId, track }).whereNotNull("trackId").first();

      let trackId: number;
      if (existingStoryboard?.trackId) {
        trackId = existingStoryboard.trackId;
        await u.db("o_videoTrack").where("id", trackId).update({ duration: trackDuration });
      } else {
        const newTrackId = Date.now()
        await u.db("o_videoTrack").insert({
          id: newTrackId,
          scriptId,
          projectId,
          duration: trackDuration,
        });
        trackId = newTrackId;
      }

      await u.db("o_storyboard").whereIn("id", storyboardIds).update({ trackId });
    }

    const storyboardData = await Promise.all(
      lastStoryboard.map(async (i) => {
        return {
          associateAssetsIds: await u.db("o_assets2Storyboard").where("storyboardId", i.id).orderBy("rowid").select("assetId").pluck("assetId"),
          src: i.filePath ? await u.oss.getSmallImageUrl(i.filePath) : "",
          id: i.id,
          trackId: i.trackId,
          prompt: i.prompt,
          duration: Number(i.duration),
          state: i.state,
          scriptId: i.scriptId,
          reason: i.reason,
          videoDesc: i.videoDesc
        };
      }),
    );
    return res.status(200).send(success(storyboardData));
  },
);
