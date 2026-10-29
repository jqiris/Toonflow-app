// ACT: jobId 是供应商任务号（FreeVideo 形如 j+12hex），随视频产出留底：
// 多轨对账与 agent 查历史节点生成结果时靠它补写 attempts，续接链才不断。
export type NodeMediaValue = { url: string; mimeType: string; jobId?: string };

export type NodeValueMap = {
  STRING: string;
  INT: number;
  FLOAT: number;
  BOOLEAN: boolean;
  IMAGE: NodeMediaValue;
  MASK: NodeMediaValue;
  VIDEO: NodeMediaValue;
  AUDIO: NodeMediaValue;
  FILE: NodeMediaValue;
};

export type NodeOutput = {
  [type in keyof NodeValueMap]: { dataType: type; value: NodeValueMap[type] }
}[keyof NodeValueMap];

export type NodeOutputs = Record<string, NodeOutput | undefined>;
export type NodeInputValue = (NodeOutput | { dataType: string | string[]; value: undefined }) & { source: string; sourceHandle: string };

export function isNodeOutput(output: unknown): output is NodeOutput {
  if (!output || typeof output !== "object" || !("dataType" in output) || !("value" in output)) return false;
  const { dataType, value } = output;
  switch (dataType) {
    case "STRING": return typeof value === "string";
    case "BOOLEAN": return typeof value === "boolean";
    case "INT": return typeof value === "number" && Number.isSafeInteger(value);
    case "FLOAT": return typeof value === "number" && Number.isFinite(value);
    case "IMAGE":
    case "MASK":
    case "VIDEO":
    case "AUDIO":
    case "FILE": {
      const mediaType = dataType === "MASK" ? "image" : dataType.toLowerCase();
      return !!value && typeof value === "object" && "url" in value && typeof value.url === "string" && !!value.url.trim()
        && "mimeType" in value && typeof value.mimeType === "string"
        && (dataType === "FILE" ? /^[^/\s]+\/[^/\s]+$/.test(value.mimeType)
          : value.mimeType.startsWith(`${mediaType}/`) && value.mimeType.length > mediaType.length + 1);
    }
    default: return false;
  }
}
