import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/**
 * 共享的衍生资产图片生成逻辑。
 * 创建 image 占位记录后立即返回，实际 AI 生成在后台异步执行。
 * 路由 handler 和 Agent tool 均可调用。
 */
export async function batchGenerateDerivativeAssets(
  assetIds: number[],
  projectId: number,
  scriptId: number,
  concurrentCount?: number,
): Promise<void> {
  const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "derivativeImageModel", "imageQuality", "artStyle", "concurrentCount").first();
  if (!projectSettingData) throw new Error(`项目不存在: ${projectId}`);

  const assetsDataArr = await u.db("o_assets").whereIn("id", assetIds).select("id", "describe", "name", "type", "assetsId");
  if (assetsDataArr.length === 0) throw new Error(`未找到资产，IDs: ${JSON.stringify(assetIds)}`);

  const parentIds = assetsDataArr.map((item: any) => item.assetsId).filter((id: any) => id != null);
  const parentAssetsData = parentIds.length > 0
    ? await u.db("o_assets")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .whereIn("o_assets.id", parentIds)
        .select("o_assets.id", "o_image.filePath", "o_assets.describe")
    : [];
  assetsDataArr.forEach((i: any) => {
    const parent = parentAssetsData.find((item: any) => item.id === i.assetsId);
    if (parent) i.parentDescribe = parent.describe;
  });
  const imageUrlRecord: Record<number, string> = {};
  parentAssetsData.forEach((item: any) => {
    if (item.filePath) imageUrlRecord[item.id] = item.filePath;
  });

  const rolePrompt = u.getArtPrompt(projectSettingData.artStyle!, "art_skills", "art_character_derivative");
  const toolPrompt = u.getArtPrompt(projectSettingData.artStyle!, "art_skills", "art_prop_derivative");
  const scenePrompt = u.getArtPrompt(projectSettingData.artStyle!, "art_skills", "art_scene_derivative");
  const promptRecord: Record<string, { prompt: string }> = {
    role: { prompt: rolePrompt },
    tool: { prompt: toolPrompt },
    scene: { prompt: scenePrompt },
  };

  const imageIdMap: Record<number, number> = {};
  for (const item of assetsDataArr) {
    const [imageId] = await u.db("o_image").insert({
      assetsId: item.id,
      type: item.type,
      state: "生成中",
      resolution: projectSettingData.imageQuality,
      model: projectSettingData.derivativeImageModel || projectSettingData.imageModel,
    });
    imageIdMap[item.id!] = imageId;
    await u.db("o_assets").where("id", item.id).update({ imageId });
  }

  // 后台异步生成图片
  const maxConcurrent = concurrentCount ?? projectSettingData.concurrentCount ?? 1;
  (async () => {
    for (let i = 0; i < assetsDataArr.length; i += maxConcurrent) {
      const batch = assetsDataArr.slice(i, i + maxConcurrent);
      await Promise.all(
        batch.map((item: any) =>
          generateSingleAsset(item, projectSettingData, imageIdMap, imageUrlRecord, promptRecord, scriptId, projectId),
        ),
      );
    }
  })().catch((e) => {
    console.error("[batchGenerateDerivativeAssets] 后台生成失败:", e);
  });
}

async function generateSingleAsset(
  item: any,
  projectSettingData: any,
  imageIdMap: Record<number, number>,
  imageUrlRecord: Record<number, string>,
  promptRecord: Record<string, { prompt: string }>,
  scriptId: number,
  projectId: number,
) {
  const imageId = imageIdMap[item.id!];
  const typeConfig = promptRecord[item.type!] || promptRecord["role"];

  try {
    const { text } = await u.Ai.Text("universalAi").invoke({
      system: `${typeConfig.prompt}`,
      messages: [
        {
          role: "user",
          content: `
          父级资产描述: ${item.parentDescribe || "无详细描述"}
          当前资产描述: ${item.describe || "无详细描述"}`,
        },
      ],
    });
    await u.db("o_assets").where("id", item.id).update({ prompt: text });

    const imageBase64 = imageUrlRecord[item.assetsId!] ? await u.oss.getImageBase64(imageUrlRecord[item.assetsId!]) : null;

    const repeloadObj = {
      prompt: text,
      size: projectSettingData.imageQuality as "1K" | "2K" | "4K",
      aspectRatio: "16:9" as `${number}:${number}`,
    };
    const imageCls = await u.Ai.Image((projectSettingData.derivativeImageModel || projectSettingData.imageModel) as `${string}:${string}`).run(
      {
        referenceList: imageBase64 ? [{ type: "image", base64: imageBase64 }] : [],
        ...repeloadObj,
      },
      {
        taskClass: "生成图片",
        describe: "资产图片生成",
        relatedObjects: JSON.stringify(repeloadObj),
        projectId,
      },
    );
    const savePath = `/${projectId}/assets/${scriptId}/${item.type}/${u.uuid()}.jpg`;
    await imageCls.save(savePath);
    await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
  } catch (e) {
    await u.db("o_image").where({ id: imageId }).update({ state: "生成失败", errorReason: u.error(e).message });
  }
}

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { assetIds, projectId, scriptId, concurrentCount } = req.body;
    batchGenerateDerivativeAssets(assetIds, projectId, scriptId, concurrentCount).catch(() => {});
    res.status(200).send(success("开始生成资产图片"));
  },
);
