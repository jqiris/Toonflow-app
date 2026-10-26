import { Router } from "express";
import { z } from "zod";
import { readFile } from "@toonflow/file";
import { defaultProjectPath } from "@toonflow/tool-plan-operator/composite";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { translateMessage, validationOptions } from "@/lib/i18n";

/**
 * H3 官方六段提示词（段名与顺序逐字对齐 ref-en.txt：subject_definitions / summary /
 * retention_analysis / detailed_description / overall_soundscape / non_diegetic_music）。
 * 全部 optional 以支持无参考退化（三分析段可留空）。有内容的一律走六段。
 * 本工作流视频生成仅支持 MiniMax-H3（H3 官方六段格式 + <Picture N>/<Video N>/<Audio N> 参考标记）；
 * 不接受其他视频模型或旧格式占位符。
 */
const promptSchema = z.object({
  subjectDefinitions: z.string().max(20000).optional(),
  summary: z.string().max(20000).optional(),
  retentionAnalysis: z.string().max(20000).optional(),
  detailedDescription: z.string().max(20000).optional(),
  overallSoundscape: z.string().max(5000).optional(),
  nonDiegeticMusic: z.string().max(5000).optional(),
});

const inputSchema = z.object({
  directory: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(128),
  prompt: promptSchema,
  referenceIds: z.array(z.string().min(1).max(128)).max(4).optional(),
  rules: z.string().max(20000).optional(),
}).refine(value => {
  const prompt = value.prompt;
  return [prompt.subjectDefinitions, prompt.summary, prompt.retentionAnalysis,
    prompt.detailedDescription, prompt.overallSoundscape, prompt.nonDiegeticMusic]
    .some(field => Boolean(field && field.trim().length > 0));
}, "请先填写本镜提示词再整理");

/** 可替换的整理规则：只做结构化整理，不新增剧情、不改事实，输出可直接整段替换本镜六段。 */
const rewriteRules = [
  "你是分镜提示词整理器。把用户给的一段镜头草稿整理成可直接投喂视频生成模型（MiniMax H3）的提示词。",
  "硬性纪律：",
  "1. 只整理与结构化用户给出的内容，不得新增剧情、人物、道具、动作或任何原文没有的信息；",
  "2. 保留全部画面事实、镜头语言（景别、机位、运动、光线、色彩）与时间顺序；",
  "3. 不要输出解释、不要分段小标题、不要 Markdown 代码块，只输出整理后的提示词正文；",
].join("\n");

/*
 * ACT: H3 官方格式由写作者直接书写，不再有换算层。参考标记直接写 <Picture N> / <Video N> /
 * <Audio N>（各媒质独立编号），旧的双花括号占位符一律报错。
 * 六段段名与顺序逐字对齐官方原文，段名与段序不可改写、不可压段。
 * 官方格式权威依据：
 *   C:\\workspace\\film-maker\\video-skills\\MiniMax-H3\\skills\\h3-prompt-writing\\references\\ref-en.txt
 *   C:\\workspace\\film-maker\\video-skills\\MiniMax-H3\\skills\\h3-prompt-writing\\references\\base-en.txt
 * 用户自定义 rules 只允许替换上面的可配置部分，这两条永远追加在后，不可覆盖。
 */
const hardDiscipline = [
  "以下为不可覆盖的硬性纪律（无论上文如何约定都必须遵守）：",
  "1. 用英文输出，按 H3 官方六段顺序组织，段名逐字对齐：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music；原文已按官方段名分段时保留段名与段序、逐段整理，不得压成一段。无参考的纯文本镜可只保留 detailed_description / overall_soundscape / non_diegetic_music 三段（退化），三分析段留空。",
  "2. 参考标记直接写 `<Picture N>` / `<Video N>` / `<Audio N>`（各媒质独立编号，N 为该媒质在参考位次里的序号，从 1 开始）；不要新增或保留任何旧的双花括号 ref 占位符——下发前不再做换算，写进正文会被校验判 error。",
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

// 六段段名与顺序逐字对齐 ref-en.txt §1「Overall Structure」——prompt 字段名 → 官方段名（含冒号+空格）。
const promptHeadings: Array<[keyof z.infer<typeof promptSchema>, string]> = [
  ["subjectDefinitions", "subject_definitions:"],
  ["summary", "summary:"],
  ["retentionAnalysis", "retention_analysis:"],
  ["detailedDescription", "detailed_description:"],
  ["overallSoundscape", "overall_soundscape:"],
  ["nonDiegeticMusic", "non_diegetic_music:"],
];

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body, validationOptions());
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  if (await isGenerating(cwd)) throw Object.assign(new Error("正在生成，请结束后再整理提示词，避免模型同时占显存"), { status: 409 });
  const configured = u.ai.getConfiguredModel(input.providerId, input.modelId);
  const { prompt } = input;
  // 段名与顺序逐字对齐 H3 官方原文，空段整段省略（段名也不输出）。
  const sections = promptHeadings
    .map(([field, heading]) => {
      const trimmed = String(prompt[field] ?? "").trim();
      return trimmed ? `${heading}\n${trimmed}` : "";
    })
    .filter(Boolean);
  // 参考位次只作提示（正文里引用时直接写 <Picture N> / <Video N> / <Audio N>，各媒质独立编号），
  // 不把位次预生成成占位符——旧的双花括号 ref 占位符不再合法（V7 error）。
  if (input.referenceIds?.length) sections.push(`本镜参考位次（正文里引用时直接写 <Picture N> / <Video N> / <Audio N>，各媒质独立编号）：\n${input.referenceIds.map((id, index) => `#${index + 1} = ${id}`).join("\n")}`);
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
