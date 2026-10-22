/**
 * 参考接线解析：三级优先级（L1 显式 / L2 派生 / L3 锚点兜底）+ 四道守卫 + 后缀回落。
 * 纯函数，依据 packages/skills/assetCard/references/referenceResolution.md。
 */

import type { AssetCard, ParseWarning } from "./assetCardParser";
import { normalizeId } from "./assetCardParser";
import { parseAssetCards } from "./assetCardParser";

export type RefSource = "explicit" | "directive" | "fallback" | "none";

export interface ResolvedCard {
  id: string;
  name: string;
  kind: string;
  textOnly: boolean;
  ratio: string;
  refs: string[];
  refSource: RefSource;
  order: number;
  nodeId?: string;
}

export interface ResolveResult {
  cards: ResolvedCard[];
  warnings: ParseWarning[];
}

const positivePhrases = ["为同一角色", "同一角色", "同一空间", "同一器物", "同一张脸", "保持脸部结构", "绑定为本卡参考图", "同一"];
const negativePhrases = ["两名", "两人", "同装同使命", "区分", "混同", "不是", "并非", "不与", "独立设卡", "不共用", "不同"];
const flashbackWords = ["少年", "闪回", "回忆", "年轻时", "弱冠"];
const crowdWords = ["群", "众", "同式"];

const characterAnchors = ["同一张脸", "同一人脸", "保持同一身份锚点", "延续面部骨相"];
const sceneAnchors = ["同一空间", "同一布局", "同一棵古槐", "同一棵树", "是同一"];
const propAnchors = ["同一器物", "同一形制", "同一材质"];

const idPattern = /(?:SC|KF|C|P|S)\d+(?:-[A-Za-z])?/g;

function idPrefixMatches(id: string, kind: string) {
  if (kind === "character") return /^C\d/.test(id);
  if (kind === "scene") return id.startsWith("SC");
  if (kind === "prop") return id.startsWith("P");
  if (kind === "keyframe") return id.startsWith("KF");
  return id.startsWith("S");
}

function collectIds(text: string) {
  return [...new Set([...text.matchAll(idPattern)].map(matched => normalizeId(matched[0])))];
}

function hitAny(text: string, words: string[]) {
  return words.filter(word => text.includes(word));
}

function clauseBlocks(text: string, before: number, after: number) {
  return text.split(/[\n。；;]/).map(clause => clause.slice(Math.max(0, clause.length - before - after)));
}

function windowText(text: string, anchor: string, before: number, after: number) {
  const index = text.indexOf(anchor);
  if (index < 0) return undefined;
  return text.slice(Math.max(0, index - before), index + anchor.length + after);
}

function suffixBase(id: string) {
  const matched = /^(SC|KF|C|P|S)\d+/.exec(id);
  return matched ? matched[0] : id;
}

function hasSuffix(id: string) {
  return /-[A-Z]$/.test(id);
}

/**
 * L1 显式声明：前缀不符视为未声明，落到 L2；可用编号按书写顺序返回。
 */
function explicitCandidates(card: AssetCard) {
  return collectIds(card.explicitRefsText || "").filter(id => id !== card.id && idPrefixMatches(id, card.kind));
}

/** L2 参考派生散文：命中正向短语且不命中否定词。 */
function directiveCandidates(card: AssetCard) {
  const text = card.directiveText;
  if (!text.trim()) return [];
  if (hitAny(text, negativePhrases).length) return [];
  if (!hitAny(text, positivePhrases).length) return [];
  return collectIds(text).filter(id => id !== card.id && idPrefixMatches(id, card.kind));
}

/** L3 正则锚点兜底：按类型取窗口内最近编号，否定在同一子句即否决。 */
function fallbackCandidates(card: AssetCard) {
  const text = card.text;
  const anchors = card.kind === "character" ? characterAnchors : card.kind === "scene" ? sceneAnchors : card.kind === "prop" ? propAnchors : [];
  const before = card.kind === "character" ? 16 : 40;
  const after = card.kind === "character" ? 24 : 40;
  for (const anchor of anchors) {
    const index = text.indexOf(anchor);
    if (index < 0) continue;
    const window = text.slice(Math.max(0, index - before), index + anchor.length + after);
    const clauses = clauseBlocks(window, before, after);
    if (clauses.some(clause => hitAny(clause, negativePhrases).length)) continue;
    const candidates = collectIds(window).filter(id => id !== card.id && idPrefixMatches(id, card.kind));
    if (candidates.length) return candidates;
  }
  return [];
}

function crowdish(card: AssetCard) {
  return hitAny(card.name, crowdWords).length > 0;
}

function flashback(card: AssetCard) {
  return hitAny(card.text, flashbackWords).length > 0;
}

export function resolveReferences(cards: AssetCard[], incomingWarnings: ParseWarning[] = []): ResolveResult {
  const warnings: ParseWarning[] = [...incomingWarnings];
  const byId = new Map(cards.map(card => [card.id, card]));
  const resolved: ResolvedCard[] = [];

  const warn = (cardId: string, code: string, message: string) => {
    warnings.push({ card: cardId, code, message });
  };

  for (const card of cards) {
    const refs: string[] = [];
    let refSource: RefSource = "none";
    const excluded = crowdish(card) || flashback(card);
    const explicit = explicitCandidates(card);
    const directive = directiveCandidates(card);
    const fallback = fallbackCandidates(card);
    const base = suffixBase(card.id);
    const baseCard = byId.get(base);

    const push = (id: string) => {
      if (!refs.includes(id)) refs.push(id);
    };

    if (explicit.length) {
      refSource = "explicit";
      for (const id of explicit) {
        const target = byId.get(id);
        if (!target) {
          warn(card.id, "missingTarget", `参考目标 ${id} 不在同一份资产卡文件中`);
          continue;
        }
        if (target.order >= card.order) {
          warn(card.id, "backwardsOnly", `参考目标 ${id} 的出现顺序（order ${target.order}）不早于本卡 ${card.id}（order ${card.order}），前向引用会让生成顺序死锁；正确修法是调整卡片顺序或补一条合法声明，不是强行接线`);
          continue;
        }
        if (excluded) {
          warn(card.id, "identityConflict", `卡片 ${card.id} 命中文群像/闪回特征，显式声明仍接线，但已记 identityConflict 警告，请人工确认身份是否一致`);
        }
        push(id);
      }
      if (!refs.length) refSource = "none";
    } else if (directive.length) {
      if (excluded) {
        warn(card.id, "identityConflict", `卡片 ${card.id} 命中文群像/闪回特征，不自动接线；如确需接线请改为显式声明`);
      } else {
        refSource = "directive";
        for (const id of directive) {
          const target = byId.get(id);
          if (!target) {
            warn(card.id, "missingTarget", `参考目标 ${id} 不在同一份资产卡文件中`);
            continue;
          }
          if (target.order >= card.order) {
            warn(card.id, "backwardsOnly", `参考目标 ${id} 的出现顺序（order ${target.order}）不早于本卡 ${card.id}（order ${card.order}），前向引用会让生成顺序死锁`);
            continue;
          }
          push(id);
        }
        if (!refs.length) refSource = "none";
      }
    } else if (fallback.length) {
      if (excluded) {
        warn(card.id, "identityConflict", `卡片 ${card.id} 命中文群像/闪回特征，不自动接线；如确需接线请改为显式声明`);
      } else {
        refSource = "fallback";
        for (const id of fallback) {
          const target = byId.get(id);
          if (!target) {
            warn(card.id, "missingTarget", `参考目标 ${id} 不在同一份资产卡文件中`);
            continue;
          }
          if (target.order >= card.order) {
            warn(card.id, "backwardsOnly", `参考目标 ${id} 的出现顺序（order ${target.order}）不早于本卡 ${card.id}（order ${card.order}），前向引用会让生成顺序死锁`);
            continue;
          }
          push(id);
        }
        if (!refs.length) refSource = "none";
      }
    } else if (hasSuffix(card.id) && baseCard && baseCard.order < card.order) {
      refSource = "fallback";
      push(base);
    } else if (hasSuffix(card.id)) {
      const sibling = cards
        .filter(item => item.id !== card.id && suffixBase(item.id) === base && item.order < card.order)
        .sort((left, right) => left.order - right.order)[0];
      if (sibling) {
        refSource = "fallback";
        push(sibling.id);
      }
    }

    resolved.push({
      id: card.id,
      name: card.name,
      kind: card.kind,
      textOnly: card.textOnly,
      ratio: card.ratio,
      refs,
      refSource,
      order: card.order,
    });
  }

  return { cards: resolved, warnings };
}

/** Markdown 文本一步到索引结构，供 action=resolve 与 build 复用。 */
export function resolveFromMarkdown(markdown: string) {
  const parsed = parseAssetCards(markdown);
  return resolveReferences(parsed.cards, parsed.warnings);
}
