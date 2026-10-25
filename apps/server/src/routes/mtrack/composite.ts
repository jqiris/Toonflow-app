import { Router } from "express";
import { z } from "zod";
import { lstat, readFile, unlink } from "@toonflow/file";
import { defaultProjectPath, planComposite, type PlanStore } from "@toonflow/tool-plan-operator/composite";
import { compositeManifestPath, concatComposite, defaultCompositeOutputPath } from "@toonflow/tool-plan-operator/compositeRun";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { validationOptions } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.object({
  directory: z.string().min(1).max(4096),
  sourcePath: z.string().min(1).max(4096).optional(),
  execute: z.boolean().default(false),
  compositeOutputPath: z.string().min(1).max(4096).optional(),
}).strict();

/**
 * 工作区目录 → planOperator 的 PlanStore。
 * 每条路径都过 resolveWorkspacePath 的工作区边界与符号链接校验；exists 只把 ENOENT 当 false，
 * 权限、越界等真错误继续抛，避免把「读不到」误报成「可合成」。
 */
function createWorkspaceStore(root: string): PlanStore {
  return {
    async readText(path) {
      const target = await u.workspaceFile.resolveWorkspacePath(root, path);
      return await readFile(target.path, "utf8");
    },
    async writeAtomic(path, content) {
      const target = await u.workspaceFile.resolveWorkspacePath(root, path, true);
      await u.workspaceFile.writeWorkspaceFile(target.path, content);
    },
    async exists(path) {
      try {
        const target = await u.workspaceFile.resolveWorkspacePath(root, path);
        await lstat(target.path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
  };
}

/**
 * 合成失败/页面关闭后的半成品清理：与工具路径同样是「删掉本次输出再报错」的处置，
 * 否则下次合成会被「输出已存在」挡住。失败点可能还没写出文件，路径越界/不存在都只当没删成。
 */
async function removeCompositeOutput(cwd: string, output: string) {
  try {
    const target = await u.workspaceFile.resolveWorkspacePath(cwd, output);
    await unlink(target.path);
  } catch {
    // 清理失败不影响原始错误（与工具路径的 remove().catch(() => {}) 同一口径）。
  }
}

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body, validationOptions());
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  const store = createWorkspaceStore(cwd);
  const output = input.compositeOutputPath ?? defaultCompositeOutputPath;
  // 清单判定复用 planOperator：accepted 为空、V14 顺序断点、assetPath 不可读都在这里原样报错。
  const plan = await planComposite(store, input.sourcePath ?? defaultProjectPath, output);
  if (!input.execute) {
    // ACT: 预检不落盘。以前这里把清单改写成 executed:false，会把上一次成功合成的事实抹掉——
    // 画布成片卡读到 executed 为假就清空输出。清单只由 execute=true 成功那次写。
    res.json(success({
      manifestPath: compositeManifestPath,
      source: plan.manifest.source,
      output,
      executed: false,
      segments: plan.segments,
      specWarnings: plan.specWarnings,
    }));
    return;
  }
  // 执行段复用 compositeRun.concatComposite：输出已存在/目录不存在/规格不一致的报错与工具完全一致。
  // 本次之前输出不存在，才可能留下本次的半成品；已存在时 concatComposite 直接报「已存在」，
  // 那不是本次产物，下面的清理绝不能删用户已有成片。
  const hadOutput = await store.exists(output);
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  try {
    const executed = await concatComposite(store, plan, output, {
      cwd,
      ffmpeg: signal => u.ffmpeg.createWorkspaceFfmpeg(cwd, signal),
    }, controller.signal);
    const specWarnings = [...plan.specWarnings, ...executed.specWarnings];
    await store.writeAtomic(compositeManifestPath, JSON.stringify({ ...plan.manifest, executed: true }, null, 2));
    res.json(success({
      manifestPath: compositeManifestPath,
      source: plan.manifest.source,
      output,
      executed: true,
      segments: plan.segments,
      specWarnings,
      result: executed.details,
    }));
  } catch (error) {
    // ACT: ffmpeg 中途失败或页面关闭（close 中止）会留半成品，下次合成被「输出已存在」挡住；
    // 这里与工具路径（planOperator/src/index.ts 的 composite catch）一致地删掉本次产物再报错。
    if (!hadOutput) await removeCompositeOutput(cwd, output);
    throw error;
  } finally {
    res.off("close", close);
  }
});
