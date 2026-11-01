import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

/**
 * 只读：返回 H3 六段提示词的整理规则（可配置部分 + 不可覆盖的硬性纪律）。
 *
 * ACT: 「整理本镜提示词」原先由 `/api/mtrack/rewriteShot` 内部调文本模型完成，实测撞供应商 429
 * （insufficient_quota）——且那条路径等于用别的模型替用户做决定。现在规则只读暴露，
 * 整理动作交给 agent 会话自己做，产出后用 `node:editProject` 写回本镜六段。
 * 本路由零模型调用。
 */
const rewriteRules = [
  "你是分镜提示词整理器。把用户给的一段镜头草稿整理成可直接投喂视频生成模型（MiniMax H3）的提示词。",
  "硬性纪律：",
  "1. 只整理与结构化用户给出的内容，不得新增剧情、人物、道具、动作或任何原文没有的信息；",
  "2. 保留全部画面事实、镜头语言（景别、机位、运动、光线、色彩）与时间顺序；",
  "3. 不要输出解释、不要分段小标题、不要 Markdown 代码块，只输出整理后的提示词正文；",
].join("\n");

const hardDiscipline = [
  "以下为不可覆盖的硬性纪律（无论上文如何约定都必须遵守）：",
  "1. 用英文输出，按 H3 官方六段顺序组织，段名逐字对齐：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music；原文已按官方段名分段时保留段名与段序、逐段整理，不得压成一段。无参考的纯文本镜可只保留 detailed_description / overall_soundscape / non_diegetic_music 三段（退化），三分析段留空。",
  "2. 参考标记直接写 `<Picture N>` / `<Video N>` / `<Audio N>`（各媒质独立编号，N 为该媒质在参考位次里的序号，从 1 开始）；不要新增或保留任何旧的双花括号 ref 占位符——下发前不再做换算，写进正文会被校验判 error。",
].join("\n");

/** 六段字段名 → 官方段名（含冒号），顺序逐字对齐 ref-en.txt §1。 */
const promptHeadings: [string, string][] = [
  ["subjectDefinitions", "subject_definitions:"],
  ["summary", "summary:"],
  ["retentionAnalysis", "retention_analysis:"],
  ["detailedDescription", "detailed_description:"],
  ["overallSoundscape", "overall_soundscape:"],
  ["nonDiegeticMusic", "non_diegetic_music:"],
];

const inputSchema = z.strictObject({
  directory: z.string().min(1).max(4096).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body);
  if (input.directory) await u.workspace.resolveWorkspace(req, input.directory);
  res.set("Cache-Control", "no-store").json(success({ rules: rewriteRules, hardDiscipline, promptHeadings }));
});
