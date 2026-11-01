import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { getMediaProvider, loadMediaProviderSource } from "@/utils/media/provider";

/**
 * 白模（3D blocking）**直接提交**：调用方（agent 会话）已按引擎权威规范写好自己的
 * `export function build(THREE)` 场景代码，这里只把代码交给引擎、不调用任何语言模型。
 *
 * ACT: 这是白模唯一的提交路径。原 `whiteboxGenerate`（服务端用会话模型代写代码）已删除——
 * 实测会打供应商 API 并撞 429 insufficient_quota，也等于用别的模型替用户做决定。
 * 白模场景代码一律由 agent 会话按 `node:whitebox action=prompt` 的规范自己写。
 */
const inputSchema = z.strictObject({
  directory: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(128),
  code: z.string().trim().min(1).max(65536),
  summary: z.string().trim().min(1).max(500),
});

/** 与 provider create 同口径的形状校验：必须导出 build(THREE)，否则引擎会报 scene_error。 */
function assertBuildCode(code: string) {
  if (!/export\s+(?:async\s+)?function\s+build\s*\(/.test(code)) {
    throw Object.assign(new Error("场景代码必须导出 `export function build(THREE)`（引擎契约），当前代码里没有这个导出"), { status: 400 });
  }
}

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body);
  await u.workspace.resolveWorkspace(req, input.directory);
  assertBuildCode(input.code);
  const info = await getMediaProvider(input.providerId);
  const configurations = u.conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const provider = await loadMediaProviderSource(info.source, { ...configurations?.[input.providerId] });
  if (!provider.whitebox?.available || !provider.whitebox.create) throw Object.assign(new Error("当前视频供应商不支持白模参考"), { status: 400 });
  const created = await provider.whitebox.create.call(provider, input.code, input.summary);
  if (!created.id) throw new Error("引擎没有返回白模任务号");
  res.set("Cache-Control", "no-store").json(success({ id: created.id, status: created.status, codeLength: input.code.length }));
});
