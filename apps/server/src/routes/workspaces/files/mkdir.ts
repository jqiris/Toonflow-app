import { mkdir } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096) }), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.body.directory, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  const release = u.workspaceFile.lockWorkspaceFiles([path]);
  try {
    await mkdir(path);
  } catch (error) {
    // 目录已存在时按成功处理——mkdir 语义本就是"确保目录存在"，调用方（assetImport/帧分析）不需要目录尚未存在。
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  finally { release(); }
  res.json(success());
});
