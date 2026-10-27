import u from "@/utils";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { maxSystemPromptLength } from "@/agent/runtime/prompt";
import { t } from "@/lib/i18n";
import { providerSchema } from "@/utils/ai";

const router = Router();
let saveQueue = Promise.resolve();

export default router.put("/", validateFields({ settings: z.record(z.string(), z.json()).and(z.object({
  agentSystemPrompt: z.string().max(maxSystemPromptLength, { error: () => t`系统提示词不能超过 ${maxSystemPromptLength} 个字符` }).optional(),
  customProviders: z.array(providerSchema.extend({ id: z.string().min(1), label: z.string() })).optional(),
  network: u.network.networkSchema.optional(),
  desktopAutoUpdate: z.boolean().optional(),
  desktopUpdateSource: z.enum(["official", "github", "custom"]).optional(),
  desktopUpdateCustomUrl: z.string().max(2048).refine(value => !value || u.desktop.isValidUpdateUrl(value),
    "自定义更新源必须是不含账号、查询参数或锚点的 HTTP(S) 地址").optional(),
  mcp: z.object({ enabled: z.boolean().optional(), token: z.string().optional(), port: z.number().int().min(1).max(65535).optional() }).optional(),
})).refine(value => value.desktopUpdateSource !== "custom" || !!value.desktopUpdateCustomUrl, {
  path: ["desktopUpdateCustomUrl"], message: "选择自定义更新源前，请先填写有效地址",
}) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { settings } = req.body;
  // ACT: 系统代理读取是异步的；串行保存完整快照，避免较早的请求覆盖较晚的配置。
  const saving = saveQueue.then(async () => {
    u.removeLegacySettings(settings);
    u.cleanNodeMenuSettings(settings);
    const previousSettings = u.conf.get("settings", {});
    const network = settings.network !== undefined || previousSettings.network !== undefined
      ? await u.network.prepareNetwork(settings.network) : undefined;
    if (network) u.network.configureNetwork(network, undefined, () => u.conf.set("settings", settings));
    else u.conf.set("settings", settings);
    const [models] = await Promise.all([u.ai.refreshProviderModels(previousSettings), u.mcpRuntime.reloadMcpRuntime()]);
    return { ...models, aiModels: u.ai.listAiModels(), nodeMenu: u.conf.get("settings.general.nodeMenu") ?? null };
  });
  saveQueue = saving.then(() => {}, () => {});
  res.json(success(await saving, "设置已保存"));
});
