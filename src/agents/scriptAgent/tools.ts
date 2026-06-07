import { tool, jsonSchema, Tool } from "ai";
import u from "@/utils";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";

export const ScriptSchema = z.object({
  name: z.string().describe("剧本名称"),
  content: z.string().describe("剧本内容"),
});
export const planData = z.object({
  storySkeleton: z.string().describe("故事骨架"),
  adaptationStrategy: z.string().describe("改编策略"),
  script: z.string().describe("剧本内容"),
});

export type planData = z.infer<typeof planData>;

const keySchema = z.enum(Object.keys(planData.shape) as [keyof planData, ...Array<keyof planData>]);
const planDataKeyLabels = Object.fromEntries(
  Object.entries(planData.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof planData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_novel_events: tool({
      description: "获取章节事件",
      inputSchema: jsonSchema<{ chapterIndexs: number[] }>(
        z
          .object({
            chapterIndexs: z.array(z.number()).describe("章节的编号"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ chapterIndexs }) => {
        console.log("[tools] get_novel_events", chapterIndexs);
        const thinking = msg.thinking("正在查询章节事件...");
        const data = await u
          .db("o_novel")
          .where("projectId", resTool.data.projectId)
          .select("id", "chapterIndex as index", "reel", "chapter", "chapterData", "event", "eventState")
          .whereIn("chapterIndex", chapterIndexs);
        thinking.appendText("正在查询章节编号: " + chapterIndexs.join(","));
        const eventString = data.map((i: any) => [`第${i.index}章，标题:${i.chapter}，事件:${i.event}`].join("\n")).join("\n");
        thinking.appendText("查询结果:\n" + eventString);
        thinking.updateTitle("查询章节事件完成");
        thinking.complete();
        return eventString ?? "无数据";
      },
    }),
    get_planData: tool({
      description: "获取工作区数据",
      inputSchema: jsonSchema<{ key: keyof planData }>(
        z
          .object({
            key: keySchema.describe("数据key"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ key }) => {
        console.log("[tools] get_planData", key);
        const thinking = msg.thinking(`正在获取${planDataKeyLabels[key]}工作区数据...`);
        const planData: planData = await new Promise((resolve) => socket.emit("getPlanData", { key }, (res: any) => resolve(res)));
        thinking.appendText(`获取到${planDataKeyLabels[key]}:\n` + planData[key]);
        thinking.updateTitle(`获取${planDataKeyLabels[key]}完成`);
        thinking.complete();
        return planData[key] ?? "无数据";
      },
    }),
    get_novel_text: tool({
      description: "获取小说章节原始文本内容",
      inputSchema: jsonSchema<{ chapterIndex: string }>(
        z
          .object({
            chapterIndex: z.string().describe("章节编号"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ chapterIndex }) => {
        console.log("[tools] get_novel_text", "[tools] get_novel_text", chapterIndex);
        const thinking = msg.thinking(`正在获取小说章节原文...`);
        const data = await u.db("o_novel").where("projectId", resTool.data.projectId).where({ chapterIndex }).select("chapterData").first();
        const text = data && data?.chapterData ? data.chapterData : "";
        thinking.appendText(`获取到原文:\n` + text);
        thinking.updateTitle(`获取小说章节原文完成`);
        thinking.complete();
        return text ?? "无数据";
      },
    }),
    get_script_content: tool({
      description: "获取剧本本内容",
      inputSchema: jsonSchema<{ ids: string[] }>(
        z
          .object({
            ids: z.array(z.string()).describe("脚本id"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        console.log("[tools] get_script_content", "[tools] get_script_content", ids);
        const thinking = msg.thinking(`正在获取脚本内容...`);
        const data = await u.db("o_script").whereIn("id", ids).select("content", "name");
        const text = data && data.length ? data.map((d) => `<scriptItem name="${d.name}">${d.content}</scriptItem>`).join("\n") : "";
        thinking.appendText(`获取到脚本内容:\n` + JSON.stringify(data, null, 2));
        thinking.updateTitle(`获取脚本内容完成`);
        thinking.complete();
        return text ?? "无数据";
      },
    }),
    save_script: tool({
      description: "保存剧本到数据库（插入或更新，按 name 去重）",
      inputSchema: jsonSchema<{ name: string; content: string }>(
        z.object({
          name: z.string().describe("剧本名称，如 '妙善传说 EP01：父病女忧'"),
          content: z.string().describe("完整剧本内容"),
        }).toJSONSchema(),
      ),
      execute: async ({ name, content }) => {
        name = name.trim();
        console.log("[tools] save_script", name);
        const thinking = msg.thinking(`正在保存剧本《${name}》...`);
        const projectId = resTool.data.projectId;
        const existing = await u.db("o_script").where({ projectId, name }).first();
        if (existing) {
          await u.db("o_script").where({ id: existing.id }).update({ content });
        } else {
          await u.db("o_script").insert({ projectId, name, content });
        }
        thinking.appendText(`剧本《${name}》已保存`);
        thinking.updateTitle(`保存剧本完成`);
        thinking.complete();
        return `剧本《${name}》已保存`;
      },
    }),
    set_planData: tool({
      description: "保存工作区数据到数据库（storySkeleton / adaptationStrategy）",
      inputSchema: jsonSchema<{ key: keyof planData; value: string }>(
        z.object({
          key: keySchema.describe("数据key"),
          value: z.string().describe("数据内容"),
        }).toJSONSchema(),
      ),
      execute: async ({ key, value }) => {
        console.log("[tools] set_planData", key);
        const thinking = msg.thinking(`正在保存${planDataKeyLabels[key]}...`);
        const projectId = resTool.data.projectId;
        const row = await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).first();
        let data: Record<string, any> = {};
        if (row?.data) {
          try {
            data = JSON.parse(row.data);
          } catch {
            data = {};
          }
        }
        data[key] = value;
        await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).update({ data: JSON.stringify(data) });
        thinking.appendText(`${planDataKeyLabels[key]}已保存`);
        thinking.updateTitle(`保存${planDataKeyLabels[key]}完成`);
        thinking.complete();
        return `${planDataKeyLabels[key]}已保存`;
      },
    }),
  };
  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
