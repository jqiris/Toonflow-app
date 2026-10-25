import { Router } from "express";
import { z } from "zod";
import { readFile } from "@toonflow/file";
import { defaultProjectPath } from "@toonflow/tool-plan-operator/composite";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { translateMessage, validationOptions } from "@/lib/i18n";

const promptSchema = z.object({
  integratedMultimodalDescription: z.string().max(20000),
  overallSoundscape: z.string().max(5000),
  nonDiegeticMusic: z.string().max(5000),
});

const inputSchema = z.object({
  directory: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(128),
  prompt: promptSchema,
  referenceIds: z.array(z.string().min(1).max(128)).max(4).optional(),
  rules: z.string().max(20000).optional(),
}).refine(value => [value.prompt.integratedMultimodalDescription, value.prompt.overallSoundscape, value.prompt.nonDiegeticMusic]
  .some(field => field.trim().length > 0), "请先填写本镜提示词再整理");

/** 可替换的整理规则：只做结构化整理，不新增剧情、不改事实，输出可直接整段替换本镜画面描述。 */
const rewriteRules = [
  "你是分镜提示词整理器。把用户给的一段镜头草稿整理成可直接投喂视频生成模型的提示词。",
  "硬性纪律：",
  "1. 只整理与结构化用户给出的内容，不得新增剧情、人物、道具、动作或任何原文没有的信息；",
  "2. 保留全部画面事实、镜头语言（景别、机位、运动、光线、色彩）与时间顺序；",
  "3. 不要输出解释、不要分段小标题、不要 Markdown 代码块，只输出整理后的提示词正文；",
].join("\n");

// ACT: 规则 3（逐段整理不压段）与规则 5（禁新增尖括号、只保留 {{ref N}}）是下发链路的硬约束：
// 压段丢段名会让多轨引擎对不上字段，尖括号标记进正文会被 wire 层校验判 error。
// 用户自定义 rules 只允许替换上面的可配置部分，这两条永远追加在后，不可覆盖。
const hardDiscipline = [
  "以下为不可覆盖的硬性纪律（无论上文如何约定都必须遵守）：",
  "1. 用英文输出，按「主体与动作 → 环境与空间 → 镜头与运动 → 光线与色彩 → 氛围」的顺序组织；原文已按官方段名（subject_definitions / summary / retention_analysis / detailed_description）分段时保留段名与段序、逐段整理，不得压成一段；",
  "2. 参考标记只保留原文里已有的 `{{ref N}}`（N 是本镜参考位次，从 1 开始）原样不动；不要新增 `<Picture N>`/`<Video N>`/`<Audio N>` 这类尖括号标记——下发前由 wire 层按参考位次自己换算，写进正文会被校验判 error。",
].join("\n");

/**
 * 生成中判定：工程里任一镜头停在 generating 就说明有批次在跑。
 * 编辑器直连链路（directDispatch）的批次号只活在浏览器进程里，服务端拿不到，状态真源只有 plan/story.mtrack；
 * 没有工程文件视为未在生成，权限与越界错误照常抛出，不把「读不到」误报成「未在生成」。
 */
async function isGenerating(cwd: string) {
  let target: string;
  try {
    target = (await u.workspaceFile.resolveWorkspacePath(cwd, defaultProjectPath)).path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let project: unknown;
  try {
    project = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("多轨工程内容无法解析，请先在多轨编辑器中重新保存 plan/story.mtrack"), { status: 409 });
  }
  const clips = (project as { clips?: unknown } | null)?.clips;
  return Array.isArray(clips) && clips.some(clip => typeof clip === "object" && clip !== null
    && (clip as { status?: unknown }).status === "generating");
}

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body, validationOptions());
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  if (await isGenerating(cwd)) throw Object.assign(new Error("正在生成，请结束后再整理提示词，避免模型同时占显存"), { status: 409 });
  const configured = u.ai.getConfiguredModel(input.providerId, input.modelId);
  const { prompt } = input;
  const sections = [
    `画面描述：\n${prompt.integratedMultimodalDescription.trim() || "（空）"}`,
    `声音景观：\n${prompt.overallSoundscape.trim() || "（空）"}`,
    `非剧情音乐：\n${prompt.nonDiegeticMusic.trim() || "（空）"}`,
  ];
  if (input.referenceIds?.length) sections.push(`本镜参考位次（正文里引用时写 \`{{ref N}}\`）：\n${input.referenceIds.map((id, index) => `{{ref ${index + 1}}} = ${id}`).join("\n")}`);
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    const stream = u.ai.streamAi(configured, {
      systemPrompt: `${input.rules?.trim() || rewriteRules}\n\n${hardDiscipline}`,
      messages: [{ role: "user", content: sections.join("\n\n"), timestamp: Date.now() }],
    }, controller.signal);
    let text = "";
    for await (const event of stream) {
      if (event.type === "text_delta") text += event.delta;
    }
    const message = await stream.result();
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw new Error(message.errorMessage || "模型请求失败");
    }
    // requiresReview：结果只是整理稿，前端必须保留原文并等用户勾选采用，不能自动覆盖。
    res.json(success({ text: text.trim(), requiresReview: true }));
  } finally {
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
  }
});
