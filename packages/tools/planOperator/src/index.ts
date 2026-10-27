import { z } from "zod";
import type { ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { parseAssetCards, type ParseWarning } from "./assetCardParser";
import { resolveReferences, resolveFromMarkdown, type ResolveResult, type ResolvedCard } from "./referenceResolver";
import { validatePlan, type Finding, type MultitrackLite, type SnapshotLite, type ParsedCardLite, type ResolvedCardLite } from "./planValidator";
import { createStore, type PlanStore } from "./indexStore";
import { planComposite, type SpecWarning } from "./composite";
import { compositeManifestPath, concatComposite, defaultCompositeOutputPath } from "./compositeRun";
import {
  normalizeProject, isRecord, sliceClips, clipNumber,
  defaultProjectPath, defaultAssetCardsPath, defaultIndexPath,
  type MtrackClip, type MtrackProject,
} from "./mtrackProject";

const configSchema = z.object({
  allowBuild: z.boolean().default(true),
}).strict();

/**
 * 内联多轨工程参数（validate 用）。真实编辑器写出的 story.mtrack 含 title/sourceRange/attempts/notes、
 * global.style/systemPrompt/model、顶层 version/projectId/updatedAt，且未来还会加字段；
 * 这里用 looseObject 逐层放宽，缺字段交给 normalizeProject 补默认值，不再用 .strict() 拒真实文件。
 */
const clipPromptSchema = z.looseObject({
  subjectDefinitions: z.string().optional(),
  summary: z.string().optional(),
  retentionAnalysis: z.string().optional(),
  detailedDescription: z.string().optional(),
  overallSoundscape: z.string().optional(),
  nonDiegeticMusic: z.string().optional(),
});

const clipAttemptSchema = z.looseObject({
  at: z.string().optional(),
  nodeId: z.string().nullable().optional(),
  status: z.string().optional(),
  error: z.string().optional(),
});

const clipSchema = z.looseObject({
  clipId: z.string().optional(),
  title: z.string().optional(),
  sourceRange: z.looseObject({ fromSegment: z.number().optional(), toSegment: z.number().optional() }).optional(),
  seconds: z.number().optional(),
  ratio: z.string().optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
  quality: z.string().optional(),
  secondPass: z.boolean().optional(),
  preview: z.boolean().optional(),
  prompt: clipPromptSchema.optional(),
  referenceIds: z.array(z.string()).optional(),
  continuity: z.string().optional(),
  status: z.string().optional(),
  nodeId: z.string().nullable().optional(),
  assetPath: z.string().nullable().optional(),
  attempts: z.array(clipAttemptSchema).optional(),
  notes: z.string().optional(),
  systemPromptOverride: z.string().optional(),
});

const mtrackSchema = z.looseObject({
  version: z.number().optional(),
  projectId: z.string().optional(),
  name: z.string().optional(),
  updatedAt: z.string().optional(),
  global: z.looseObject({
    ratio: z.string().optional(),
    resolution: z.string().optional(),
    style: z.string().optional(),
    systemPrompt: z.string().optional(),
    model: z.looseObject({ providerId: z.string().optional(), modelId: z.string().optional() }).optional(),
  }).optional(),
  clips: z.array(clipSchema).optional(),
});

const snapshotNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().optional(),
  outputs: z.array(z.object({
    mediaType: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
  }).strict()).optional(),
}).strict();

const snapshotSchema = z.object({
  nodes: z.array(snapshotNodeSchema),
  // ACT: 语义是「节点id → [源id, 边id] 定长二元组」。z.tuple 在 draft-07 下生成
  // items 数组形态，DSH 宿主 MCP 校验器拒收（items must be object|boolean）；
  // z.array(z.string()).length(2) 输出等价 schema 且宿主可收，TS 侧靠既有
  // `snapshot as SnapshotLite` 断言维持二元组语义。上限：单源节点边数无约束。
  incomingEdges: z.record(z.string(), z.array(z.string()).length(2)),
  referenceOrder: z.record(z.string(), z.array(z.string()).length(2)).optional(),
}).strict();

/**
 * mtrackUpdate 的补丁形状：strictObject 让「禁写字段」在 z 层就被拒。
 * 可写只有 status / nodeId / assetPath / attempts 四项；seconds / prompt / referenceIds /
 * continuity / title / notes 等真源字段一律不在 schema 内，传了即校验失败。
 * status 另限四态：accepted 属用户验收判定，写入路径不收（读盘仍保留磁盘上的 accepted）。
 */
// ACT: 用 looseObject 而非 object，与读侧 clipAttemptSchema / ClipAttempt 同口径。
// 编辑器与服务端媒体任务写进 attempts 的字段不止这四个：jobId（续接下一镜的唯一来源，
// continuationJobId 只认 status==="succeeded" && attempt.jobId）、assetPath（clipVersions 的版本身份）、
// signature / index（clipStates 的设置与时间线回显）、parentJobId（承接来源）。z.object 会静默剥掉
// 未声明键，Agent 用 mtrackRead 结果整数组回写时就会丢这些字段，导致下一镜 continuity="context" 取不到任务号。
// 上限：looseObject 不再拒绝 attempts 内的未知键，marker 仍可被手改（见 planValidator V13 的已知上限）。
const updateAttemptSchema = z.looseObject({
  at: z.string().describe("ISO 8601 时间戳"),
  nodeId: z.string().nullable(),
  status: z.string().describe("ClipStatus 取值或 \"cancelled\""),
  error: z.string().optional(),
  jobId: z.string().trim().max(128).optional().describe("成功尝试的供应商任务号（FreeVideo 形如 j+12hex）；整数组回写时必须原样带上，否则该镜不能被下一镜承接"),
});

const clipUpdateSchema = z.object({
  clipId: z.string().regex(/^S\d{3}$/).describe("片段 id，如 S001；仅作定位键，不可改"),
  // ACT: 与 node:editProject 的 clipPatchSchema 同一口径——写入路径不收 accepted。
  // 验收是用户在多轨界面点「验收」的人工判定，Agent 不能把未验收的镜头标成 accepted 去凑合成条件；
  // 读盘路径不受影响，磁盘上已有的 accepted 仍由 normalizeProject 原样接受。
  status: z.enum(["pending", "generating", "generated", "failed"]).optional(),
  nodeId: z.string().nullable().optional(),
  assetPath: z.string().nullable().optional(),
  attempts: z.array(updateAttemptSchema).optional().describe("整数组替换，不是追加合并；每项须保留 jobId 与 error 里的 batch:<uuid>/task:<id> 标记"),
}).strict();

const clipIdSchema = z.string().regex(/^S\d{3}$/).describe("分镜号，形如 S001（含端点）");

function resolvedToLite(resolved: ResolveResult): ResolvedCardLite[] {
  return resolved.cards.map(card => ({ id: card.id, kind: card.kind, textOnly: card.textOnly, refs: card.refs }));
}

function parsedToLite(resolved: ResolvedCard[]): ParsedCardLite[] {
  return resolved.map(card => ({
    id: card.id,
    name: card.name,
    kind: card.kind,
    textOnly: card.textOnly,
  }));
}

export const requestSchema = z.object({
  action: z.enum(["parse", "resolve", "validate", "build", "mtrackRead", "mtrackUpdate", "dispatch", "assemble", "composite"]),
  markdown: z.string().optional().describe("parse/resolve 的资产卡 Markdown 文本；build 不读参数中的 markdown，从盘读取 assets/assetCards.md"),
  path: z.string().default("plan/story.mtrack").describe("多轨工程文件路径（工作区相对）：mtrackRead/mtrackUpdate/dispatch/assemble/composite 读取；validate/build 用 mtrackPath"),
  assetCardsPath: z.string().default("assets/assetCards.md").describe("资产卡文件：resolve/build 读入，dispatch/assemble 用于补参考集合的 name/kind/prompt"),
  mtrackPath: z.string().optional().describe("validate 时多轨工程文件，默认 plan/story.mtrack"),
  mtrack: mtrackSchema.optional().describe("validate 时可直接内联多轨工程 JSON，优先级高于 mtrackPath 读盘"),
  snapshot: snapshotSchema.optional().describe("validate 时画布快照（getCanvasNodes/getCanvasEdges 结果），含 nodes/incomingEdges/referenceOrder；build 不需要"),
  outputIndexPath: z.string().optional().describe("build 时写出的 assetIndex.json 路径，默认 plan/assetIndex.json"),
  outputPath: z.string().optional().describe("build 时写出的 assetReport.json 路径，默认 plan/assetReport.json"),
  from: clipIdSchema.optional().describe("起始分镜号（含端点）；mtrackRead 缺省为 S001，dispatch 必填，assemble 缺省为全部"),
  to: clipIdSchema.optional().describe("结束分镜号（含端点）；mtrackRead 缺省为最后一个 clip，仅给 from 时等于 from"),
  expectedUpdatedAt: z.string().optional().describe("mtrackUpdate 的乐观并发基线：mtrackRead 返回的 updatedAt；缺省不做冲突检查（仍原子写）"),
  updates: z.array(clipUpdateSchema).min(1).max(500).optional().describe("mtrackUpdate 的补丁；只允许 status/nodeId/assetPath/attempts 四项，真源字段禁写"),
  execute: z.boolean().optional().describe("composite 是否真正执行 concat（默认 false 只产出合成清单、不落盘）；true 时才调用宿主 ffmpeg，成功后写 plan/composite.json，需要插件市场已配置 ffmpeg"),
  compositeOutputPath: z.string().optional().describe("composite 输出视频路径，默认 plan/composite.mp4；文件已存在时报错，不自动重命名、不覆盖"),
  indexPath: z.string().default("plan/assetIndex.json").describe("referenceResolver 结算结果：dispatch/assemble 用于参考集合与 nodeId"),
}).strict();

function buildFindings(findings: Finding[], cardsMarkdown?: string): { errors: number; warnings: number; findings: Finding[] } {
  const errors = findings.filter(f => f.level === "error").length;
  const warnings = findings.filter(f => f.level === "warning").length;
  return { errors, warnings, findings };
}

/**
 * 资产卡三级结算的告警并入 findings：resolve 只把 missingTarget/backwardsOnly/identityConflict 放进 warnings，
 * 不并进校验结果的话「卡片声明了不存在的参考目标」= 丢声明 + 0 error + build 通过，生成时少一张参考还看不出来（审计 F2）。
 * missingTarget 按 error 处理（静默少参考比报错更贵）；后两项只是人工确认项，保持 warning。
 */
function resolveFindings(warnings: ParseWarning[]): Finding[] {
  return warnings.map(warning => ({
    rule: warning.code,
    level: warning.code === "missingTarget" ? "error" : "warning",
    message: `${warning.card}：${warning.message}`,
    ref: warning.card,
  }));
}

/** composite 返回文本：清单 JSON + 每段规格提示逐行列出，避免提示被埋在 JSON 里看不见。 */
function withSpecWarnings(summary: unknown, warnings: SpecWarning[]) {
  const text = JSON.stringify(summary, null, 2);
  return warnings.length
    ? `${text}\n${warnings.map(warning => `[规格提示] ${warning.clipId} ${warning.message}`).join("\n")}`
    : text;
}

/** 画布节点端口：声音卡走 audio 输出，其余图片卡走 image 输出；目标端口统一 in。 */
function sourceHandleOf(kind: string | undefined) {
  return kind === "sound" ? "audio" : "image";
}

function nodeTypeOf(kind: string | undefined) {
  return kind === "sound" ? "audioGenerationNode" : "imageGenerationNode";
}

export const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),

  createTools(context) {
    const { allowBuild } = configSchema.parse(context.config);
    const store = createStore(context.files);

    const description = allowBuild
      ? "解析资产卡、结算参考接线，并对资产索引、多轨工程与画布快照执行 V1–V16 确定性校验（含 V16：承接上一镜的片段最多 3 张参考图、时长至少 10 秒）；validate error 清零后可写入派生文件 assetIndex.json、assetReport.json。另可读写多轨工程（mtrackRead/mtrackUpdate）、按起止分镜号出派工清单（dispatch）与画布装配计划（assemble）。composite 按 accepted 片段出合成清单（execute=true 成功后才写 plan/composite.json），并在此条件下经宿主 ffmpeg 拼接成片（不覆盖已有输出）。"
      : "解析资产卡、结算参考接线，并对资产索引、多轨工程与画布快照执行 V1–V16 确定性校验（含 V16：承接上一镜的片段最多 3 张参考图、时长至少 10 秒；只读，不写入派生文件）。另可读取多轨工程（mtrackRead）、出派工清单（dispatch）与画布装配计划（assemble）；mtrackUpdate 受 allowBuild 限制，关闭时不可用。composite 同样需要 allowBuild。";

    return [{
      name: "planOperator",
      label: "资产卡与多轨校验",
      description,
      promptSnippet: "资产卡、参考接线、多轨工程与派工单一律经 planOperator 校验，不靠模型自觉。",
      promptGuidelines: [
        "快照必须完整：getCanvasNodes 有分页与截断，total/truncated 不完整时工具直接报错，不拿半份快照出结论。",
        "状态查询纪律：node:getGenerationStatus 的 idle 只表示本次打开节点后未发起生成，idle 不表示没有历史输出；跨轮或换会话前必须先用 getCanvasNodes({ fields: [\"outputs\"] }) 读该节点已产出的媒体，不能用 idle 推断未生成。",
        "本工具只做解析、结算、校验、多轨回写与计划产出：dispatch 只返回逐镜派工清单、assemble 只返回画布装配计划，生成与画布落盘由 agent 走画布工具（addNodes/connectNodes）与 nodeTools 执行；工具自身不执行生成、不连接画布节点、不调用供应商。用户也可能在多轨界面/节点直接派工，此时生成由编辑器自己执行，不要重复生成。",
        "mtrackUpdate 只回写 status/nodeId/assetPath/attempts 四个生成侧字段，seconds/prompt/referenceIds/continuity 等真源字段归多轨编辑器与对话所有，禁写；status 只接受 pending/generating/generated/failed，accepted 是用户在多轨界面点「验收」的人工判定，Agent 不得代写（磁盘上已有的 accepted 读盘时原样保留）；回写前先用 mtrackRead 的 updatedAt 作为 expectedUpdatedAt 做乐观并发。attempts 是整数组替换（多轨编辑器那边是追加）：传 attempts 时必须把每项原有的 jobId 一并带上，jobId 只由成功的那次尝试产生，丢了它该镜就无法被下一镜 continuity=\"context\" 承接（续接链会断在 mediaDispatch 的「上一镜没有可用的生成任务号」）；error 里以 batch:<uuid>/task:<id> 开头的标记同样要原样保留，V13 靠它识别服务端媒体通道的产物。",
        "composite 只拼接 status 为 accepted 的片段，按工程文件内顺序（即合成顺序）；没有 accepted 片段、V14 顺序不连续、assetPath 缺失或不可读、实测规格与首段不一致都会直接报错。默认只出清单、不落盘（预检不改动已有 plan/composite.json），execute=true 才真正调用宿主 ffmpeg 执行 concat，并在成功后写清单 executed:true；执行前先逐段 ffprobe 实测尺寸/帧率/像素格式/音轨参数，与首段不一致就挡在编码之前，声明 seconds 与实测时长差超过 1s 只记规格提示。输出文件已存在时报错，不自动重命名、不覆盖；输出目录必须已存在，本工具不创建目录。",
      ],
      parameters: z.toJSONSchema(requestSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",

      async execute(_id, rawParams, signal) {
        const params = requestSchema.parse(rawParams);
        signal?.throwIfAborted();
        const { action } = params;

        // ---- parse：卡文本 → 卡数组 + warnings ----
        if (action === "parse") {
          if (!params.markdown) throw new Error("parse 需要 markdown 参数");
          const parsed = parseAssetCards(params.markdown);
          return {
            content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
            details: parsed,
          };
        }

        // ---- resolve：Markdown → assetIndex 结构（含三级参考结算）----
        if (action === "resolve") {
          const markdown = params.markdown ?? (await store.readText(params.assetCardsPath ?? defaultAssetCardsPath));
          signal?.throwIfAborted();
          const resolved = resolveFromMarkdown(markdown);
          const index = buildAssetIndex(resolved);
          // ACT: 三级结算的告警只放在 details 时 agent 在文本通道里看不见（审计 F1）；
          // 同步进 content，声明了不存在/前向引用目标时不会「静默丢声明」。
          const warnings = resolved.warnings;
          const text = warnings.length
            ? `${JSON.stringify(index, null, 2)}\n\n结算告警（${warnings.length}）：\n${warnings.map(item => `  ${item.card} [${item.code}] ${item.message}`).join("\n")}`
            : JSON.stringify(index, null, 2);
          return {
            content: [{ type: "text", text }],
            details: { resolved, index },
          };
        }

        // ---- validate：只读，零写入，返回 V1–V16 findings ----
        if (action === "validate") {
          const resolved = await loadResolvedFromMarkdown(params, store, signal);
          const loadedMtrack = await loadMultitrack(params, store, signal);
          const mtrack = loadedMtrack?.project;
          const snapshot = params.snapshot;
          const findings = [
            ...resolveFindings(resolved.warnings),
            ...(loadedMtrack?.findings ?? []),
            ...validatePlan({
              cards: parsedToLite(resolved.cards),
              resolved: resolvedToLite(resolved),
              mtrack: mtrack as MultitrackLite | undefined,
              snapshot: snapshot as SnapshotLite | undefined,
            }),
          ];
          const summary = buildFindings(findings);
          return {
            content: [{ type: "text", text: JSON.stringify({ ...summary, resolved: resolved.cards.map(c => ({ id: c.id, refs: c.refs, refSource: c.refSource })), mtrackClips: mtrack?.clips?.length ?? 0 }, null, 2) }],
            details: { findings, resolved, mtrack },
          };
        }

        // ---- build：validate 通过后才写入派生文件 ----
        if (action === "build") {
          if (!allowBuild) throw new Error("allowBuild 已关闭，build 不可用");
          const resolved = await loadResolvedFromMarkdown(params, store, signal);
          const loadedMtrack = await loadMultitrack(params, store, signal);
          const mtrack = loadedMtrack?.project;
          const snapshot = params.snapshot;
          const findings = [
            ...resolveFindings(resolved.warnings),
            ...(loadedMtrack?.findings ?? []),
            ...validatePlan({
              cards: parsedToLite(resolved.cards),
              resolved: resolvedToLite(resolved),
              mtrack: mtrack as MultitrackLite | undefined,
              snapshot: snapshot as SnapshotLite | undefined,
            }),
          ];
          const errors = findings.filter(f => f.level === "error").length;
          if (errors > 0) {
            throw new Error(`build 被拒绝：仍有 ${errors} 条 error 级发现\n${findings.filter(f => f.level === "error").map(f => `  [${f.rule}] ${f.message}`).join("\n")}`);
          }
          const index = buildAssetIndex(resolved);
          const indexPath = params.outputIndexPath ?? "plan/assetIndex.json";
          const reportPath = params.outputPath ?? "plan/assetReport.json";
          await store.writeAtomic(indexPath, JSON.stringify(index, null, 2));
          const report = {
            generatedAt: new Date().toISOString(),
            errors: 0,
            warnings: findings.filter(f => f.level === "warning").length,
            findings: findings.map(f => ({ rule: f.rule, level: f.level, message: f.message, ref: f.ref })),
          };
          await store.writeAtomic(reportPath, JSON.stringify(report, null, 2));
          signal?.throwIfAborted();
          return {
            content: [{ type: "text", text: JSON.stringify({ indexPath, reportPath, warnings: report.warnings }, null, 2) }],
            details: { index, report },
          };
        }

        // ---- mtrackRead：范围读，含端点，missing 不整体报错 ----
        if (action === "mtrackRead") {
          const path = params.path ?? defaultProjectPath;
          const { raw, project } = await readProject(path, store, signal, "mtrackRead");
          const from = params.from ?? "S001";
          const lastClipId = project.clips[project.clips.length - 1]?.clipId ?? "S001";
          const to = params.to ?? (params.from ? params.from : lastClipId);
          assertRange(from, to, "mtrackRead");
          const { clips, missing } = sliceClips(project.clips, from, to);
          signal?.throwIfAborted();
          const result = {
            path,
            updatedAt: project.updatedAt,
            version: project.version,
            projectId: project.projectId || undefined,
            name: project.name || undefined,
            global: project.global,
            clips,
            missing,
          };
          const text = missing.length
            ? `${JSON.stringify(result, null, 2)}\n未命中分镜：${missing.join("、")}`
            : JSON.stringify(result, null, 2);
          return {
            content: [{ type: "text", text }],
            details: { ...result, raw },
          };
        }

        // ---- mtrackUpdate：只 patch 四字段 + updatedAt CAS + 原子写 ----
        if (action === "mtrackUpdate") {
          if (!allowBuild) throw new Error("mtrackUpdate 不可用：allowBuild 已关闭");
          const updates = params.updates;
          if (!updates || updates.length === 0) throw new Error("updates 至少 1 条");
          const path = params.path ?? defaultProjectPath;
          const { raw, project } = await readProject(path, store, signal, "mtrackUpdate");
          if (params.expectedUpdatedAt !== undefined && params.expectedUpdatedAt !== project.updatedAt) {
            throw new Error(`mtrackUpdate 冲突：多轨工程已被其他操作修改（expected ${params.expectedUpdatedAt}，实际 ${project.updatedAt}），请重新读取后重派`);
          }
          // 直接在原始 JSON 上 patch：不经 schema 重序列化，未命中字段与未知字段逐字保留。
          const rawClips = Array.isArray(raw.clips) ? raw.clips.filter(isRecord) : [];
          const updated: string[] = [];
          const missing: string[] = [];
          for (const patch of updates) {
            const target = rawClips.find(clip => clip.clipId === patch.clipId);
            if (!target) { missing.push(patch.clipId); continue; }
            if (patch.status !== undefined) target.status = patch.status;
            if (patch.nodeId !== undefined) target.nodeId = patch.nodeId;
            if (patch.assetPath !== undefined) target.assetPath = patch.assetPath;
            if (patch.attempts !== undefined) target.attempts = patch.attempts;
            updated.push(patch.clipId);
          }
          const updatedAt = new Date().toISOString();
          raw.updatedAt = updatedAt;
          signal?.throwIfAborted();
          await store.writeAtomic(path, JSON.stringify(raw, null, 2));
          const result = { path, updatedAt, updated, missing };
          const text = missing.length
            ? `${JSON.stringify(result, null, 2)}\n未命中分镜：${missing.join("、")}`
            : JSON.stringify(result, null, 2);
          return {
            content: [{ type: "text", text }],
            details: result,
          };
        }

        // ---- dispatch：只出逐镜派工清单，不执行生成 ----
        if (action === "dispatch") {
          const from = params.from;
          const to = params.to;
          if (!from || !to) throw new Error("dispatch 需要 from 与 to（如 S001 / S003）");
          const path = params.path ?? defaultProjectPath;
          const { project } = await readProject(path, store, signal, "dispatch");
          assertRange(from, to, "dispatch");
          const { clips, missing } = sliceClips(project.clips, from, to);
          const cards = await readAssetCards(params, store, signal);
          const indexCards = await readAssetIndex(params, store, signal);
          const cardById = new Map(cards.map(card => [card.id, card]));
          const warnings: string[] = [];
          for (const clipId of missing) warnings.push(`范围内未命中：${clipId}`);
          const plan = clips.map(clip => {
            const referencePlan = clip.referenceIds.map(refId => {
              const card = cardById.get(refId);
              const indexCard = indexCards.get(refId);
              if (!indexCard) warnings.push(`参考结算缺 ${refId}（建议先跑 resolve/build）`);
              // 参考结算缺该 refId 时按契约标 kind:"未知"/textOnly:false/nodeId:null，name 由资产卡兜底。
              return {
                refId,
                kind: indexCard?.kind ?? "未知",
                name: card?.name ?? indexCard?.name ?? "",
                textOnly: indexCard ? (card?.textOnly ?? indexCard.textOnly ?? false) : false,
                nodeId: indexCard?.nodeId ?? null,
              };
            });
            const lastAttempt = clip.attempts.length ? clip.attempts[clip.attempts.length - 1] : null;
            return {
              clipId: clip.clipId,
              seconds: clip.seconds,
              ratio: clip.ratio,
              resolution: clip.resolution,
              generateAudio: clip.generateAudio,
              continuity: clip.continuity,
              status: clip.status,
              nodeId: clip.nodeId,
              assetPath: clip.assetPath,
              prompt: clip.prompt,
              referencePlan,
              generationParams: {
                duration: clip.seconds,
                resolution: clip.resolution,
                ratio: clip.ratio,
                generateAudio: clip.generateAudio,
                providerId: "待 node:getConfig 决定",
                modelId: "待 node:getConfig 决定",
                mode: "待 node:getConfig 读 matchingModes 决定（不得写死）",
              },
              promptEssentials: [
                "subjectDefinitions / summary / retentionAnalysis：有参考时必写，逐字对齐 ref-en.txt",
                "detailedDescription：画面主体（含 <Picture N> / <Video N> / <Audio N> 参考标记，各媒质独立编号）",
                "overallSoundscape 为环境声，nonDiegeticMusic 为配乐",
                "无参考时退化：只留 detailedDescription / overallSoundscape / nonDiegeticMusic，三分析段不写",
              ],
              currentState: { status: clip.status, nodeId: clip.nodeId, assetPath: clip.assetPath, lastAttempt },
            };
          });
          const result = {
            path,
            from,
            to,
            generatedAt: new Date().toISOString(),
            updatedAt: project.updatedAt,
            clips: plan,
          };
          signal?.throwIfAborted();
          const text = warnings.length
            ? `${JSON.stringify(result, null, 2)}\n${warnings.join("\n")}`
            : JSON.stringify(result, null, 2);
          return {
            content: [{ type: "text", text }],
            details: { ...result, warnings },
          };
        }

        // ---- assemble：产出画布装配计划，不直接操作画布 ----
        if (action === "assemble") {
          const path = params.path ?? defaultProjectPath;
          const { project } = await readProject(path, store, signal, "assemble");
          const from = params.from ?? "S001";
          const to = params.to ?? (params.from ? params.from : (project.clips[project.clips.length - 1]?.clipId ?? "S001"));
          assertRange(from, to, "assemble");
          const cards = await readAssetCards(params, store, signal);
          const indexCards = await readAssetIndex(params, store, signal);
          const resolved = resolveReferences(cards);
          const cardFindings = validatePlan({ cards: cards.map(card => ({ id: card.id, name: card.name, kind: card.kind, textOnly: card.textOnly })), resolved: resolvedToLite(resolved) });
          const cardErrors = cardFindings.filter(finding => finding.level === "error").length;
          if (cardErrors > 0) throw new Error(`assemble 被拒绝：资产卡仍有 error 级发现（${cardErrors} 条），先跑 validate 清零`);

          const resolvedById = new Map(resolved.cards.map(card => [card.id, card]));
          const cardById = new Map(cards.map(card => [card.id, card]));
          const warnings: string[] = [];

          // 分层：无 ref 的卡 layer=0，其余 = 1 + max(其 refs 的 layer)。resolved 已保证 backwards-only，无环。
          const layerOf = (cardId: string, seen: Set<string> = new Set()): number => {
            const card = resolvedById.get(cardId);
            if (!card || !card.refs.length) return 0;
            if (seen.has(cardId)) return 0;
            seen.add(cardId);
            return 1 + Math.max(...card.refs.map(ref => layerOf(ref, seen)));
          };

          const assetNodes = resolved.cards.map(card => {
            const parsed = cardById.get(card.id);
            const layer = layerOf(card.id);
            // ACT: label 用「<卡号> <名称>」——派工解析参考按 label 前缀匹配卡号（directDispatch.labelMatchesCard），
            // 引擎任务名也靠它取到「角色-C01-时间戳」；只写名称会让参考解析与任务名一起丢掉代号。
            const label = `${card.id} ${card.name}`.trim();
            const data = card.textOnly
              ? { label, text: parsed?.prompt ?? "" }
              : { label, prompt: parsed?.prompt ?? "", ratio: card.ratio };
            return {
              cardId: card.id,
              kind: card.kind,
              name: card.name,
              ratio: card.ratio,
              textOnly: card.textOnly,
              layer,
              nodeType: nodeTypeOf(card.kind),
              data,
              refs: card.refs,
              edges: card.refs.map(ref => ({
                fromNode: ref,
                fromHandle: sourceHandleOf(resolvedById.get(ref)?.kind),
                toNode: card.id,
                toHandle: "in",
              })),
            };
          }).sort((left, right) => left.layer - right.layer || (resolvedById.get(left.cardId)?.order ?? 0) - (resolvedById.get(right.cardId)?.order ?? 0));

          const layerCount = assetNodes.reduce((max, node) => Math.max(max, node.layer + 1), 0);
          const layers = Array.from({ length: layerCount }, (_unused, layer) => ({
            layer,
            items: assetNodes.filter(node => node.layer === layer).map(node => ({ cardId: node.cardId, kind: node.kind })),
          }));

          const { clips } = sliceClips(project.clips, from, to);
          const clipNodes = clips.map(clip => {
            const references: string[] = [];
            const edges: { fromNode: string; fromHandle: string; toNode: string; toHandle: string }[] = [];
            for (const refId of clip.referenceIds) {
              const indexCard = indexCards.get(refId);
              if (!indexCard) {
                warnings.push(`参考结算缺 ${refId}`);
                references.push("缺失");
                continue;
              }
              references.push(refId);
              edges.push({
                fromNode: refId,
                fromHandle: sourceHandleOf(resolvedById.get(refId)?.kind ?? indexCard.kind),
                toNode: clip.clipId,
                toHandle: "in",
              });
            }
            return {
              clipId: clip.clipId,
              nodeType: "videoGenerationNode",
              data: {
                label: clip.clipId,
                duration: clip.seconds,
                resolution: clip.resolution,
                ratio: clip.ratio,
                generateAudio: clip.generateAudio,
              },
              references,
              edges,
            };
          });

          const connectOrder = [
            ...assetNodes.flatMap(node => node.edges.map(edge => `${edge.fromNode}->${edge.toNode}`)),
            ...clipNodes.flatMap(node => node.edges.map(edge => `${edge.fromNode}->${edge.toNode}`)),
          ];
          const result = {
            generatedAt: new Date().toISOString(),
            updatedAt: project.updatedAt,
            layers,
            assetNodes,
            clipNodes,
            connectOrder,
          };
          signal?.throwIfAborted();
          const text = warnings.length
            ? `${JSON.stringify(result, null, 2)}\n${warnings.join("\n")}`
            : JSON.stringify(result, null, 2);
          return {
            content: [{ type: "text", text }],
            details: { ...result, warnings },
          };
        }

        // ---- composite：合成清单（默认）/ execute=true 时经宿主 ffmpeg 拼接 ----
        if (action === "composite") {
          if (!allowBuild) throw new Error("composite 不可用：allowBuild 已关闭");
          const path = params.path ?? defaultProjectPath;
          const output = params.compositeOutputPath ?? defaultCompositeOutputPath;
          const plan = await planComposite(store, path, output);
          // 清单只写一次：execute 成功后才写 executed:true。预检（execute=false）不落盘——写 executed:false
          // 会把上一次成功合成的事实抹掉（画布成片卡按 executed 决定是否挂输出），失败时也不留「谎报已执行」的清单。
          if (params.execute !== true) {
            const summary = {
              manifestPath: compositeManifestPath,
              source: plan.manifest.source,
              output,
              executed: false,
              segments: plan.segments,
              specWarnings: plan.specWarnings,
            };
            signal?.throwIfAborted();
            return { content: [{ type: "text", text: withSpecWarnings(summary, plan.specWarnings) }], details: summary };
          }
          let executed: Awaited<ReturnType<typeof concatComposite>>;
          // 本次之前输出不存在，才可能留下本次的半成品；已存在时 concatComposite 直接报「已存在」，
          // 那不是本次产物，清理绝不能删用户已有成片。
          const hadOutput = await store.exists(output);
          try {
            executed = await concatComposite(store, plan, output, { cwd: context.cwd, ffmpeg: signal => context.ffmpeg(signal) }, signal);
          } catch (error) {
            // ACT: ffmpeg 中途失败/被杀会留半成品，下次合成又被「输出已存在」挡住；这里删掉本次产物再报错（审计 P2-5）。
            if (!hadOutput) await context.files.remove(output).catch(() => {
              // 半成品可能根本不存在，删除失败不影响原始错误。
            });
            throw error;
          }
          const specWarnings = [...plan.specWarnings, ...executed.specWarnings];
          await store.writeAtomic(compositeManifestPath, JSON.stringify({ ...plan.manifest, executed: true }, null, 2));
          const summary = {
            manifestPath: compositeManifestPath,
            source: plan.manifest.source,
            output,
            executed: true,
            segments: plan.segments,
            specWarnings,
          };
          return {
            content: [{ type: "text", text: `${withSpecWarnings(summary, specWarnings)}\n${JSON.stringify(executed.details, null, 2)}` }],
            details: { ...summary, result: executed.details },
          };
        }

        throw new Error(`未知 action：${action}`);
      },
    }];

    /** 加载资产卡并解析 + 结算，纯只读 */
    async function loadResolvedFromMarkdown(params: z.infer<typeof requestSchema>, store: PlanStore, signal?: AbortSignal) {
      const markdown = params.markdown ?? (await store.readText(params.assetCardsPath ?? defaultAssetCardsPath));
      signal?.throwIfAborted();
      return resolveFromMarkdown(markdown);
    }

    /**
     * 加载多轨工程，纯只读；validate 缺文件时返回 undefined（跳过片段侧规则）。
     * ACT: 同时带回「首镜衔接被归一改成 shot」的告警——normalizeProject 为保证落盘工程合法
     * 会静默把首镜 context 改回 shot，若不留痕，V11 的「首镜不能承接上一镜」永远不触发（审计 F4）。
     */
    async function loadMultitrack(params: z.infer<typeof requestSchema>, store: PlanStore, signal?: AbortSignal) {
      const loaded = await (async (): Promise<{ raw: unknown; project: MtrackProject } | undefined> => {
        if (params.mtrack) return { raw: params.mtrack, project: normalizeProject(params.mtrack) };
        const path = params.mtrackPath ?? defaultProjectPath;
        const exists = await store.exists(path);
        if (!exists) return undefined;
        const text = await store.readText(path);
        signal?.throwIfAborted();
        const raw = parseProjectJson(text, path, "validate");
        return { raw, project: normalizeProject(raw) };
      })();
      if (!loaded) return undefined;
      return { project: loaded.project as MultitrackLite, findings: firstClipContinuityFindings(loaded.raw) };
    }

    /** 首镜写了承接时，归一已经把它改成 shot，这里把「被改过」这件事报出来。 */
    function firstClipContinuityFindings(raw: unknown): Finding[] {
      if (!isRecord(raw) || !Array.isArray(raw.clips) || !raw.clips.length) return [];
      const first = raw.clips[0];
      if (!isRecord(first)) return [];
      if (first.continuity !== "context" && first.continuity !== "continue") return [];
      const clipId = typeof first.clipId === "string" ? first.clipId : "S001";
      return [{
        rule: "V11",
        level: "warning",
        message: `首镜 ${clipId} 写的是「承接上一镜」，但首镜没有上一镜可接，已按独立起拍（shot）处理`,
        ref: clipId,
      }];
    }

    /**
     * 读多轨工程：返回原始 JSON（供 mtrackUpdate 原地 patch，保字段）与容错归一后的工程。
     * 错误文案按 action 前缀区分，便于 agent 判断是「文件坏」还是「参数错」。
     */
    async function readProject(path: string, store: PlanStore, signal: AbortSignal | undefined, action: string): Promise<{ raw: Record<string, unknown>; project: MtrackProject }> {
      if (!(await store.exists(path))) {
        // ACT: 多轨工程路径是会话工作目录下的相对路径；最常见的坑是会话跑在另一个目录（例如临时工作区），
        // 报错里把解析基准一起给出来，省掉「路径看起来对、但读的不是同一个工程」这一轮排查。
        throw new Error(`${action} 失败：多轨工程不存在（${path}）；当前会话工作目录：${context.cwd}。请确认打开/绑定的项目目录，或把该工程放到这个目录下。`);
      }
      const text = await store.readText(path);
      signal?.throwIfAborted();
      const raw = parseProjectJson(text, path, action);
      return { raw, project: normalizeProject(raw) };
    }

    function parseProjectJson(text: string, path: string, action: string): Record<string, unknown> {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (reason) {
        throw new Error(`${action} 失败：多轨工程不是合法 JSON（${path}）：${reason instanceof Error ? reason.message : String(reason)}`);
      }
      if (!isRecord(value)) throw new Error(`${action} 失败：多轨工程不是合法 JSON（${path}）：顶层不是对象`);
      return value;
    }

    function assertRange(from: string, to: string, action: string) {
      if (clipNumber(from) > clipNumber(to)) {
        throw new Error(`${action} 失败：起始分镜号 ${from} 不得晚于结束分镜号 ${to}`);
      }
    }

    /** 读资产卡：dispatch/assemble 只用于补 name/kind/prompt，缺文件按空集合处理，不硬失败。 */
    async function readAssetCards(params: z.infer<typeof requestSchema>, store: PlanStore, signal?: AbortSignal) {
      const path = params.assetCardsPath ?? defaultAssetCardsPath;
      if (!(await store.exists(path))) return [];
      const markdown = await store.readText(path);
      signal?.throwIfAborted();
      return parseAssetCards(markdown).cards;
    }

    /** 读 assetIndex：只取 id/name/kind/textOnly/nodeId，缺文件按空集合处理。 */
    async function readAssetIndex(params: z.infer<typeof requestSchema>, store: PlanStore, signal?: AbortSignal) {
      const path = params.indexPath ?? defaultIndexPath;
      const map = new Map<string, { id: string; name?: string; kind?: string; textOnly?: boolean; nodeId?: string | null }>();
      if (!(await store.exists(path))) return map;
      const text = await store.readText(path);
      signal?.throwIfAborted();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return map;
      }
      const cards = isRecord(value) && Array.isArray(value.cards) ? value.cards.filter(isRecord) : [];
      for (const card of cards) {
        if (typeof card.id !== "string") continue;
        map.set(card.id, {
          id: card.id,
          ...(typeof card.name === "string" ? { name: card.name } : {}),
          ...(typeof card.kind === "string" ? { kind: card.kind } : {}),
          ...(typeof card.textOnly === "boolean" ? { textOnly: card.textOnly } : {}),
          nodeId: typeof card.nodeId === "string" ? card.nodeId : null,
        });
      }
      return map;
    }

    /** 构造 assetIndex.json 结构 */
    function buildAssetIndex(resolved: ResolveResult) {
      return {
        version: "assetIndex-v1",
        cards: resolved.cards.map(card => ({
          id: card.id,
          name: card.name,
          kind: card.kind,
          textOnly: card.textOnly,
          ratio: card.ratio,
          refs: card.refs,
          refSource: card.refSource,
          order: card.order,
          nodeId: card.nodeId ?? null,
        })),
      };
    }

  },
};

export default plugin;
