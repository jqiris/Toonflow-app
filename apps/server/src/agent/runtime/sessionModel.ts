import { readFile } from "@toonflow/file";
import { basename, resolve } from "node:path";

/**
 * 当前 agent 会话使用的文本模型。
 *
 * ACT: 白模场景代码、3D 导演台的场景/镜头生成这类「agent 触发的文本模型调用」必须默认用用户正在聊的那个模型，
 * 而不是设置里排第一的模型——后者可能是限流额度很紧的供应商（实测撞 429），而且用户已经为当前会话选过模型，
 * 再用另一个模型等于在背后换掉他的选择。
 *
 * 读取顺序（全部来自磁盘，不依赖内存态，跨进程/重启一致）：
 *   1. 会话文件里最后一条 `model_change` 条目（用户或 agent 切模型时落盘）；
 *   2. 最后一条 assistant 消息上的 `provider` / `model`（老会话可能只记消息、没记 model_change）；
 *   3. 都没有 → undefined，调用方回落到自己的默认选择。
 *
 * 上限：只读当前会话文件，不跟入父/子 Agent 链；子 Agent 有自己的会话文件，各自解析各自。
 */
export type SessionTextModel = { providerId: string; modelId: string };

const sessionCache = new Map<string, { at: number; model?: SessionTextModel }>();
// ACT: 会话文件在同一轮里可能被反复读取（多个工具调用），1.5 秒短缓存避免同一轮重复解析。
const cacheTtl = 1500;

function parseModelEntries(text: string): SessionTextModel | undefined {
  let fromModelChange: SessionTextModel | undefined;
  let fromMessage: SessionTextModel | undefined;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
      fromModelChange = { providerId: entry.provider, modelId: entry.modelId };
      continue;
    }
    const message = entry.type === "message" ? entry.message : undefined;
    if (message && typeof message === "object") {
      const record = message as Record<string, unknown>;
      if (record.role === "assistant" && typeof record.provider === "string" && typeof record.model === "string") {
        fromMessage = { providerId: record.provider, modelId: record.model };
      }
    }
  }
  // 后写的优先：model_change 是显式切换，比消息回显更权威，故最后一条 model_change 胜出。
  return fromModelChange ?? fromMessage;
}

/** 读某会话文件当前使用的模型；文件不存在/无记录都返回 undefined（不抛错，调用方回落）。 */
export async function getSessionTextModel(sessionsDir: string, sessionFile: string): Promise<SessionTextModel | undefined> {
  const fileName = basename(sessionFile);
  if (!/^[\w.-]+\.jsonl$/.test(fileName)) return undefined;
  const target = resolve(sessionsDir, fileName);
  const cached = sessionCache.get(target);
  const now = Date.now();
  if (cached && now - cached.at < cacheTtl) return cached.model;
  try {
    const text = await readFile(target, "utf8");
    const model = parseModelEntries(text);
    sessionCache.set(target, { at: now, model });
    return model;
  } catch {
    // 会话还没落盘（新对话首条回复前）或已被删除：回落，不把读不到当成错误。
    return undefined;
  }
}
