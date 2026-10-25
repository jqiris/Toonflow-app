/**
 * 确定性校验器 V1–V16（V3/V5/V6/V10 为历史断档编号，不再产生新 finding；V5 的恒假占位块已删除）。纯函数，不读磁盘、不调画布。
 * 校验输入来源：
 *  - parsed：assetCardParser 的解析结果（V1–V9 资产侧）
 *  - resolved：referenceResolver 的结算结果（V1–V9 接线侧）
 *  - mtrack：多轨工程 JSON（V11–V16 片段侧）
 *  - snapshot：画布快照（来自 getCanvasNodes/getCanvasEdges，由调用方传入）
 *
 * 规则权威依据：
 *  - V1–V9：docs/assetCardWorkflowPlan.md §2 K3 + docs/assetCardWorkflowPlanReview.md A3/A4
 *  - V11–V16：docs/multitrackProductionPlan.md §5
 */

export interface Finding {
  rule: string;
  level: "error" | "warning";
  message: string;
  /** 关联资产卡 id 或片段 clipId，便于前端定位 */
  ref?: string;
}

export interface ValidateInput {
  cards?: ParsedCardLite[];
  resolved?: ResolvedCardLite[];
  mtrack?: MultitrackLite;
  snapshot?: SnapshotLite;
}

export interface ParsedCardLite {
  id: string;
  name: string;
  kind: string;
  textOnly: boolean;
  prompt?: string;
}

export interface ResolvedCardLite {
  id: string;
  kind: string;
  textOnly: boolean;
  refs: string[];
}

export interface MultitrackClip {
  clipId: string;
  seconds: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  prompt: { integratedMultimodalDescription: string; overallSoundscape: string; nonDiegeticMusic: string };
  referenceIds: string[];
  continuity: string;
  status: string;
  nodeId: string | null;
  assetPath: string | null;
  /** 生成尝试记录；媒体任务通道的镜用 `batch:<uuid>` / `task:<id>` 标记，见 V13 的 nodeId 例外 */
  attempts?: { at?: string; nodeId?: string | null; status: string; error?: string }[];
}

export interface MultitrackLite {
  global?: { ratio?: string; resolution?: string };
  clips: MultitrackClip[];
}

export interface SnapshotNodeLite {
  id: string;
  type: string;
  status?: string;
  outputs?: Array<{ mediaType?: string; path?: string; url?: string }>;
}

export interface SnapshotLite {
  nodes: SnapshotNodeLite[];
  /** key = nodeId，value = 入边来源 [source, sourceHandle][] */
  incomingEdges: Record<string, Array<[string, string]>>;
  /** key = nodeId，value = referenceOrder（如有） */
  referenceOrder?: Record<string, Array<[string, string]>>;
}

const RESOLUTIONS = new Set(["768P", "2K"]);
const RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);
// MiniMax H3 Ref2VA 独立镜头最多支持 9 张参考图
const MAX_IMAGE_REFERENCES = 9;
// ACT: 卡片体系（CardKind）没有 video 类型，视频参考当前并入图片桶计数，本常量暂无引用（V8 不校验视频参考）。
const MAX_VIDEO_REFERENCES = 1;
const MAX_AUDIO_REFERENCES = 1;
const MIN_SECONDS = 2;
const MAX_SECONDS = 60;

export function validatePlan(input: ValidateInput): Finding[] {
  const findings: Finding[] = [];
  const cards = input.cards ?? [];
  const resolved = input.resolved ?? [];
  const mtrack = input.mtrack;
  const snapshot = input.snapshot;

  const cardById = new Map(cards.map(c => [c.id, c]));
  const resolvedById = new Map(resolved.map(r => [r.id, r]));

  // ---- V1：资产卡 id 唯一 ----
  const seen = new Map<string, number>();
  for (const card of cards) {
    seen.set(card.id, (seen.get(card.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) findings.push({ rule: "V1", level: "error", message: `资产卡编号重复：${id}（出现 ${count} 次），编号必须唯一`, ref: id });
  }

  // ---- V2：参考目标存在且前缀匹配（已结算 resolved 自带前缀匹配，这里查存在性）----
  for (const r of resolved) {
    for (const ref of r.refs) {
      if (!cardById.has(ref)) {
        findings.push({ rule: "V2", level: "error", message: `参考目标不存在：${r.id} → ${ref}`, ref: r.id });
      }
    }
  }

  // ---- V3：backwards-only（由 referenceResolver 已拦截，这里做二次确认）----
  for (const r of resolved) {
    const self = cardById.get(r.id);
    if (!self) continue;
    for (const ref of r.refs) {
      const target = cardById.get(ref);
      if (target && target.kind !== self.kind) {
        findings.push({ rule: "V2", level: "error", message: `参考类型不匹配：${r.id}(${self.kind}) → ${ref}(${target.kind})`, ref: r.id });
      }
    }
  }

  // ---- V4：构图卡必须至少一个母版参考 ----
  for (const r of resolved) {
    if (r.kind === "keyframe" && r.refs.length === 0) {
      findings.push({ rule: "V4", level: "error", message: `构图卡 ${r.id} 没有任何母版参考，不得无参考出图`, ref: r.id });
    }
  }

  // ---- V9：textOnly 卡仍声明参考（warning）----
  for (const r of resolved) {
    if (cardById.get(r.id)?.textOnly && r.refs.length > 0) {
      findings.push({ rule: "V9", level: "warning", message: `文本类卡 ${r.id} 仍声明了参考`, ref: r.id });
    }
  }

  if (!mtrack) return findings;

  const clipIds = new Set<string>();
  // ---- V11：多轨结构完整 ----
  for (const [index, clip] of mtrack.clips.entries()) {
    if (clipIds.has(clip.clipId)) findings.push({ rule: "V11", level: "error", message: `片段 id 重复：${clip.clipId}`, ref: clip.clipId });
    clipIds.add(clip.clipId);
    if (!/^S\d{3}$/.test(clip.clipId)) findings.push({ rule: "V11", level: "error", message: `片段 id 格式应为 S001：${clip.clipId}`, ref: clip.clipId });
    if (!clip.prompt?.integratedMultimodalDescription?.trim()) findings.push({ rule: "V11", level: "error", message: `片段 ${clip.clipId} 缺少 integratedMultimodalDescription`, ref: clip.clipId });
    if (!clip.prompt?.overallSoundscape?.trim()) findings.push({ rule: "V11", level: "warning", message: `片段 ${clip.clipId} 缺少 overallSoundscape`, ref: clip.clipId });
    if (!clip.prompt?.nonDiegeticMusic?.trim()) findings.push({ rule: "V11", level: "warning", message: `片段 ${clip.clipId} 缺少 nonDiegeticMusic`, ref: clip.clipId });
    if (!["pending", "generating", "generated", "accepted", "failed"].includes(clip.status)) {
      findings.push({ rule: "V11", level: "error", message: `片段 ${clip.clipId} 状态非法：${clip.status}`, ref: clip.clipId });
    }
    // ACT: 衔接方式与 LSC 多轨编辑器（continuity_mode）同口径：shot（独立起拍/切镜）或 context（承接上一镜）。
    // 旧工程的 start/continue/cut 由编辑器归一再写入，这里只拦真正非法的取值。
    if (clip.continuity !== "shot" && clip.continuity !== "context"
      && clip.continuity !== "start" && clip.continuity !== "cut" && clip.continuity !== "continue") {
      findings.push({ rule: "V11", level: "error", message: `片段 ${clip.clipId} 衔接方式非法：${clip.continuity}（应为 shot 或 context）`, ref: clip.clipId });
    }
    // 首镜没有上一镜可承接，必须独立起拍。
    // ACT: planOperator 入口的 normalizeProject 已把首镜衔接归一为 shot，所以正常输入下这条不触发；
    // 「被归一改过」这件事由 index.ts 的 firstClipContinuityFindings 以 warning 报出（审计 F4）。
    // 保留本条是给「绕过归一、直接构造 mtrack 对象」的调用方兜底。
    if (index === 0 && (clip.continuity === "context" || clip.continuity === "continue")) {
      findings.push({ rule: "V11", level: "error", message: `片段 ${clip.clipId} 是首镜，衔接方式不能是承接上一镜，请改为独立起拍（shot）`, ref: clip.clipId });
    }
    // 续接镜头走引擎 continue_from，此时参考图上限是 3 张（独立镜头的 V8 阈值见上面 MAX_IMAGE_REFERENCES）。
    if ((clip.continuity === "context" || clip.continuity === "continue") && clip.referenceIds.length > 3) {
      findings.push({ rule: "V16", level: "error", message: `片段 ${clip.clipId} 承接上一镜时最多 3 张参考图（引擎限制），当前 ${clip.referenceIds.length} 张`, ref: clip.clipId });
    }
    // 续接镜头时长下限是 10 秒（引擎原文：Each continued part must be at least 10 seconds）。
    if ((clip.continuity === "context" || clip.continuity === "continue") && clip.seconds < 10) {
      findings.push({ rule: "V16", level: "error", message: `片段 ${clip.clipId} 承接上一镜时最短 10 秒（引擎限制），当前 ${clip.seconds} 秒`, ref: clip.clipId });
    }
  }

  // ---- V12：seconds 2–60 整数；resolution / ratio 合法 ----
  for (const clip of mtrack.clips) {
    if (!Number.isInteger(clip.seconds) || clip.seconds < MIN_SECONDS || clip.seconds > MAX_SECONDS) {
      findings.push({ rule: "V12", level: "error", message: `片段 ${clip.clipId} 时长必须为 ${MIN_SECONDS}–${MAX_SECONDS} 整数秒，实际 ${clip.seconds}`, ref: clip.clipId });
    }
    if (!RESOLUTIONS.has(clip.resolution)) {
      findings.push({ rule: "V12", level: "error", message: `片段 ${clip.clipId} 分辨率非法：${clip.resolution}`, ref: clip.clipId });
    }
    if (clip.ratio && !RATIOS.has(clip.ratio)) {
      findings.push({ rule: "V12", level: "error", message: `片段 ${clip.clipId} 比例非法：${clip.ratio}`, ref: clip.clipId });
    }
  }

  // ---- V13：referenceIds 的存在性与 textOnly；generated/accepted 必须有 nodeId + assetPath ----
  // ACT: 本条只查 referenceIds 指向的卡存在、且没把文本类资产当图片参考；「参考卡已出图」不在这里校验
  // （要读产物快照，牵动磁盘），由派工期 nodeShared/directDispatch.resolveReferenceSources 在实际接线时拦截。
  for (const clip of mtrack.clips) {
    for (const ref of clip.referenceIds) {
      const card = cardById.get(ref);
      if (!card) {
        findings.push({ rule: "V13", level: "error", message: `片段 ${clip.clipId} 引用了不存在的资产：${ref}`, ref: clip.clipId });
        continue;
      }
      if (card.textOnly) {
        findings.push({ rule: "V13", level: "error", message: `片段 ${clip.clipId} 把文本类资产 ${ref} 当图片参考`, ref: clip.clipId });
      }
    }
    if (clip.status === "generated" || clip.status === "accepted") {
      // ACT: 媒体任务通道（界面「生成视频」/`node:dispatchGenerate`）不建画布视频节点，nodeId 恒为 null，
      // 产物与状态由 mediaTask 写回 attempts（`batch:<uuid>` / `task:<id>`）。不识别这层会把界面正常产出的镜
      // 判成「accepted 却无 nodeId」，让「生成前 validate error 清零」永远过不了。上限：仅按 attempts 标记识别，
      // 手改 attempts 的人仍能骗过这一条；accepted 的产物存在性由下游 composite 逐段 ffprobe 兜底。
      const isMediaChannel = !clip.nodeId && (clip.attempts ?? []).some(item => /^(batch|task):/.test(String(item?.error ?? "")));
      if (!clip.nodeId && !isMediaChannel) findings.push({ rule: "V13", level: "error", message: `片段 ${clip.clipId} 状态为 ${clip.status} 却无 nodeId`, ref: clip.clipId });
      if (!clip.assetPath) findings.push({ rule: "V13", level: "error", message: `片段 ${clip.clipId} 状态为 ${clip.status} 却无 assetPath`, ref: clip.clipId });
    }
    if (clip.status === "accepted" && snapshot && clip.nodeId) {
      const node = snapshot.nodes.find(n => n.id === clip.nodeId);
      const ok = node?.outputs?.some(o => o.mediaType === "video" && (o.path || o.url));
      if (!ok) findings.push({ rule: "V13", level: "error", message: `片段 ${clip.clipId} 标为 accepted，但画布节点 ${clip.nodeId} 无可读视频产出`, ref: clip.clipId });
    }
  }

  // ---- V7：提示词参考标记：统一写 {{ref N}}，N 为参考顺序里的序号 ----
  // 同一编号在正文里反复出现是正常写法，因此不查重号、也不要求每个编号都出现。
  for (const clip of mtrack.clips) {
    const refs = clip.referenceIds ?? [];
    const prompt = clip.prompt ?? { integratedMultimodalDescription: "", overallSoundscape: "", nonDiegeticMusic: "" };
    const fields: Array<[string, string]> = [
      ["integratedMultimodalDescription", prompt.integratedMultimodalDescription ?? ""],
      ["overallSoundscape", prompt.overallSoundscape ?? ""],
      ["nonDiegeticMusic", prompt.nonDiegeticMusic ?? ""],
    ];
    const range = refs.length ? `1..${refs.length}` : "空（本镜没有参考）";
    for (const [field, text] of fields) {
      if (!text) continue;
      // 行内媒体标签不是本项目的参考写法：生成侧按 {{ref N}} 换算，尖括号会被当普通文本透传。
      for (const matched of text.matchAll(/<\s*(picture|video|audio)\s*(\d+)\s*>/gi)) {
        findings.push({
          rule: "V7",
          level: "error",
          message: `片段 ${clip.clipId} 的 ${field} 含 ${matched[0]}：参考标记统一写 {{ref N}}，N 为参考顺序里的序号（本镜范围为 ${range}）`,
          ref: clip.clipId,
        });
      }
      // ref 两侧空白均可省略：{{ref1}}、{{ref 1}}、{{ ref1 }}、{{ REF 1 }} 都命中。
      for (const matched of text.matchAll(/\{\{\s*ref\s*(\d+)\s*\}\}/gi)) {
        const n = Number(matched[1]);
        if (n < 1 || n > refs.length) {
          findings.push({
            rule: "V7",
            level: "error",
            message: `片段 ${clip.clipId} 的 ${field} 含越界参考标记 {{ref ${n}}}：本镜参考编号范围为 ${range}`,
            ref: clip.clipId,
          });
        }
      }
    }
  }

  // ---- V8：参考数量上限（MiniMax H3 独立镜 图 ≤9 / 音频 ≤1）。视频参考与图片同桶计数（下面的过滤器只排除 sound）。----
  for (const clip of mtrack.clips) {
    const images = clip.referenceIds.filter(id => (cardById.get(id)?.kind ?? "scene") !== "sound");
    const sounds = clip.referenceIds.filter(id => (cardById.get(id)?.kind ?? "") === "sound");
    if (images.length > MAX_IMAGE_REFERENCES) {
      findings.push({ rule: "V8", level: "error", message: `片段 ${clip.clipId} 图片参考 ${images.length} 个，超过上限 ${MAX_IMAGE_REFERENCES}`, ref: clip.clipId });
    }
    if (sounds.length > MAX_AUDIO_REFERENCES) {
      findings.push({ rule: "V8", level: "error", message: `片段 ${clip.clipId} 音频参考 ${sounds.length} 个，超过上限 ${MAX_AUDIO_REFERENCES}`, ref: clip.clipId });
    }
  }

  // ---- V14：合成清单只含 accepted，顺序连续无空洞 ----
  const accepted = mtrack.clips.filter(c => c.status === "accepted");
  const acceptedSorted = [...accepted].sort((a, b) => a.clipId.localeCompare(b.clipId));
  for (let i = 1; i < acceptedSorted.length; i++) {
    const prevNum = Number(acceptedSorted[i - 1].clipId.slice(1));
    const curNum = Number(acceptedSorted[i].clipId.slice(1));
    if (curNum !== prevNum + 1) {
      findings.push({ rule: "V14", level: "error", message: `合成清单不连续：${acceptedSorted[i - 1].clipId} 之后是 ${acceptedSorted[i].clipId}`, ref: acceptedSorted[i].clipId });
    }
  }

  // ACT: V14 只判镜号连续性，但合成按工程顺序拼接；工程被 move 过时会悄悄按新顺序出片（审计 P2-4）。
  const acceptedOrder = accepted.map(c => c.clipId);
  const acceptedAsc = [...acceptedOrder].sort((a, b) => a.localeCompare(b));
  if (acceptedOrder.join(",") !== acceptedAsc.join(",")) {
    findings.push({ rule: "V14", level: "warning", message: `accepted 片段在工程里的顺序（${acceptedOrder.join(" → ")}）与镜号升序不一致；合成按工程顺序拼接，成片顺序将与镜号不同`, ref: acceptedOrder[0] });
  }

  // ---- V15：referenceIds 顺序与画布 referenceOrder + 入边顺序一致 ----
  if (snapshot && snapshot.referenceOrder) {
    for (const clip of mtrack.clips) {
      if (!clip.nodeId) continue;
      const order = snapshot.referenceOrder[clip.nodeId];
      if (!order) continue;
      const expect = order.map(([source]) => normalizeSourceId(source));
      const actual = clip.referenceIds.map(id => normalizeSourceId(id));
      if (expect.length !== actual.length || expect.some((id, i) => id !== actual[i])) {
        findings.push({ rule: "V15", level: "error", message: `片段 ${clip.clipId} 的 referenceIds 顺序与画布节点 ${clip.nodeId} 的实际参考顺序不一致`, ref: clip.clipId });
      }
    }
  }

  return findings;
}

/** 画布 source handle 常为 `assets/<id>/xxx.png`，取资产卡编号前缀做比对。 */
function normalizeSourceId(source: string): string {
  const matched = /(?:SC|KF|C|P|S)\d+(?:-[A-Za-z])?/i.exec(source);
  return matched ? matched[0].toUpperCase() : source.toUpperCase();
}
