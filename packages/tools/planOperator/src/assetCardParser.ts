/**
 * 资产卡 Markdown 解析：输入字符串，输出卡数组。
 * 纯函数，不碰磁盘；IO 只发生在 indexStore.ts。
 * 语法依据 packages/skills/assetCard/references/assetCardTemplate.md 与
 * docs/assetCardWorkflowPlan.md §1.2（宽口径编号解析 + 索引侧规范化，审阅 A4）。
 */

export type CardKind = "character" | "scene" | "prop" | "keyframe" | "sound";

export interface AssetCard {
  id: string;
  rawId: string;
  name: string;
  kind: CardKind;
  line: number;
  order: number;
  ratio: string;
  sectionRatio: string;
  textOnly: boolean;
  prompt: string;
  negativePrompt: string;
  explicitRefsText: string;
  directiveText: string;
  text: string;
}

export interface ParseWarning {
  card: string;
  code: string;
  message: string;
}

export interface ParseResult {
  cards: AssetCard[];
  warnings: ParseWarning[];
  duplicates: { id: string; lines: number[] }[];
}

const displayPrefix: Record<string, string> = { c: "C", sc: "SC", p: "P", kf: "KF", s: "S" };
const cardKinds: Record<string, CardKind> = { c: "character", sc: "scene", p: "prop", kf: "keyframe", s: "sound" };
const defaultRatios: Record<CardKind, string> = { character: "2:3", scene: "16:9", prop: "1:1", keyframe: "9:16", sound: "" };

export const assetIdPattern = /^(?:C|SC|P|KF|S)\d{2,}(?:-[A-Z])?$/;

const promptKeys = new Set(["提示词", "人物提示词", "场景提示词", "道具提示词", "资产提示词", "图片提示词", "视频提示词"]);
const negativeKeys = new Set(["负面提示词", "可选负面提示词"]);
const ratioKeys = new Set(["建议画幅", "画幅"]);
const identityKeys = new Set(["身份参考", "参考"]);
const structureKeys = new Set(["结构参考", "空间参考"]);
const propRefKeys = new Set(["道具参考", "器物参考"]);
const directiveKeys = new Set(["参考派生", "参考派生说明", "派生参考"]);
const textOnlyKeys = new Set(["文本类", "仅文字记录", "不引用独立图片"]);
const knownFieldKeys = new Set([...promptKeys, ...negativeKeys, ...ratioKeys, ...identityKeys,
  ...structureKeys, ...propRefKeys, ...directiveKeys, ...textOnlyKeys]);

const cardIdPattern = /^([A-Za-z]{1,3}\d+(?:-[A-Za-z])?)$/;
const titleSeparators = /[·|｜:：]/;
const fieldLinePattern = /^(?:[-*+]\s*)?\**\s*([^：:\n]{1,24}?)\**\s*[：:]\s*(.*)$/;
const ratioPattern = /(\d{1,2}\s*[:：]\s*\d{1,2})/;
const listMarkerPattern = /^[-*+]\s+/;
const hashPattern = /^\s{0,3}#{1,6}\s*/;

export function parseCardId(rawId: string) {
  const matched = /^([A-Za-z]{1,3})(\d+)(?:-([A-Za-z]))?$/.exec(rawId.trim());
  if (!matched) return undefined;
  const prefix = matched[1]!.toLowerCase();
  const display = displayPrefix[prefix];
  if (!display) return undefined;
  const digits = matched[2]!;
  return {
    display,
    digits: digits.length >= 2 ? digits : digits.padStart(2, "0"),
    suffix: matched[3]?.toUpperCase(),
    kind: cardKinds[prefix]!,
  };
}

/** 索引侧规范化：SC 先于 C 匹配、数字补零不截断、后缀统一大写（审阅 A4）。 */
export function normalizeId(rawId: string) {
  const parsed = parseCardId(rawId);
  if (!parsed) return rawId.trim();
  return `${parsed.display}${parsed.digits}${parsed.suffix ? `-${parsed.suffix}` : ""}`;
}

function normalizeFieldKey(raw: string) {
  return raw.replace(/[\s*`·\-_＿、,，]/g, "");
}

function normalizeRatio(text: string) {
  const matched = ratioPattern.exec(text);
  if (!matched) return "";
  return matched[1]!.replace(/\s*[:：]\s*/, ":").trim();
}

function explicitKeysFor(kind: CardKind) {
  if (kind === "character") return identityKeys;
  if (kind === "scene") return structureKeys;
  if (kind === "prop") return propRefKeys;
  return new Set([...identityKeys, ...structureKeys, ...propRefKeys]);
}

interface TitleMatch { id: string; rawId: string; kind: CardKind; name: string; hashed: boolean }

/** 识别卡片标题行；`#` 可 1–6 级也可省略，分隔符 `·` `|` `｜` `:` `：` 或空格。 */
function matchCardTitle(rawLine: string): TitleMatch | undefined {
  const hashed = hashPattern.test(rawLine);
  const body = rawLine.replace(hashPattern, "").replace(listMarkerPattern, "").trim();
  if (!body) return undefined;
  const separator = titleSeparators.exec(body);
  const [idPart, ...rest] = separator ? body.split(separator[0]) : body.split(/\s+/);
  if (!idPart || !cardIdPattern.test(idPart)) return undefined;
  const parsed = parseCardId(idPart);
  if (!parsed) return undefined;
  const name = (separator ? rest.join(separator[0]) : rest.join(" ")).trim();
  // 空格分隔且无 `#` 时要求是短标题：正文提示词行通常带逗号或冒号，不作为卡片标题。
  if (!separator && !hashed && (/[，,：:]/.test(body) || body.length > 40)) return undefined;
  return { id: normalizeId(idPart), rawId: idPart, kind: parsed.kind, name: name.split(/[｜|]/)[0]!.trim(), hashed };
}

function matchField(rawLine: string) {
  const body = rawLine.replace(listMarkerPattern, "").trim();
  if (!body || body.startsWith("#")) return undefined;
  return fieldLinePattern.exec(body);
}

export function parseAssetCards(markdown: string): ParseResult {
  const cards: AssetCard[] = [];
  const warnings: ParseWarning[] = [];
  const occurrence = new Map<string, number[]>();
  const cardFields = new Map<AssetCard, Map<string, string>>();
  let sectionRatio = "";
  let current: AssetCard | undefined;
  let fields = new Map<string, string>();
  let activeKey: string | undefined;
  let activeValue: string[] = [];

  const closeField = () => {
    if (current && activeKey !== undefined) fields.set(activeKey, activeValue.join("\n").trim());
    activeKey = undefined;
    activeValue = [];
  };

  const openCard = (title: TitleMatch, line: number) => {
    const card: AssetCard = {
      id: title.id, rawId: title.rawId, name: title.name, kind: title.kind, line, order: cards.length + 1,
      ratio: "", sectionRatio, textOnly: title.kind === "sound", prompt: "", negativePrompt: "",
      explicitRefsText: "", directiveText: "", text: "",
    };
    cards.push(card);
    const cardMap = new Map<string, string>();
    // 与外层 fields 绑定为同一 map；若在调用处另 new 一次，closeField 会写进
    // 另一个空 map，卡片字段永远收不到（2026-10-19 实测 promptLen=0）。
    cardFields.set(card, cardMap);
    fields = cardMap;
    occurrence.set(card.id, [...(occurrence.get(card.id) ?? []), line]);
    return card;
  };

  for (const [index, rawLine] of markdown.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    const title = matchCardTitle(rawLine);
    if (title) {
      closeField();
      current = openCard(title, lineNumber);
      continue;
    }
    if (hashPattern.test(rawLine)) {
      closeField();
      current = undefined;
      fields = new Map();
      sectionRatio = normalizeRatio(rawLine.replace(hashPattern, ""));
      continue;
    }
    const field = matchField(rawLine);
    const fieldKey = field ? normalizeFieldKey(field[1]!) : "";
    if (current) {
      if (field && knownFieldKeys.has(fieldKey)) {
        closeField();
        activeKey = fieldKey;
        activeValue = [field[2]!.trim()];
      } else if (activeKey !== undefined) {
        if (trimmed) activeValue.push(trimmed);
      }
      current.text = current.text ? `${current.text}\n${rawLine}` : rawLine;
    }
  }
  closeField();

  for (const card of cards) {
    const values = cardFields.get(card)!;
    const pick = (keys: Set<string>) => [...values.entries()].filter(([key]) => keys.has(key)).map(([, value]) => value).join("\n").trim();
    card.prompt = pick(promptKeys);
    card.negativePrompt = pick(negativeKeys);
    card.ratio = normalizeRatio(pick(ratioKeys)) || normalizeRatio(card.sectionRatio) || defaultRatios[card.kind];
    card.textOnly = card.textOnly || pick(textOnlyKeys).length > 0;
    card.explicitRefsText = [...values.entries()].filter(([key]) => explicitKeysFor(card.kind).has(key)).map(([, value]) => value).join("\n");
    card.directiveText = pick(directiveKeys);
    if (!card.textOnly && !card.prompt.trim()) {
      warnings.push({ card: card.id, code: "missingPrompt", message: `卡片 ${card.id} 缺少提示词字段，非文本类卡必须填写提示词` });
    }
    if (!card.name.trim()) {
      warnings.push({ card: card.id, code: "missingName", message: `卡片 ${card.id} 的标题行缺少名称` });
    }
  }

  const duplicates = [...occurrence.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([id, lines]) => ({ id, lines }));

  return { cards, warnings, duplicates };
}
