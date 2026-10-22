import { computed, ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { nodeTools, z } from "@toonflow/nodes-scaffold/nodeTools";
import type { NodeData } from "@toonflow/nodes-scaffold/connection";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import type { NodeInputValue } from "@toonflow/nodes-scaffold/values";

export function useNodeReferences(handleId = "in") {
  const { id, node } = useNode<NodeData & { referenceOrder?: Record<string, string[]> }>();
  const { removeEdges, getEdges } = useVueFlow();
  const inputValues = ref<NodeInputValue[]>([]);
  const previews = ref(new Map<string, string>());
  const refList = computed({
    get() {
      const order = new Map(node.data.referenceOrder?.[handleId]?.map((key, index) => [key, index]));
      return [...inputValues.value].sort((a, b) => (order.get(referenceKey(a)) ?? order.size) - (order.get(referenceKey(b)) ?? order.size));
    },
    set(values: NodeInputValue[]) {
      node.data.referenceOrder = { ...node.data.referenceOrder, [handleId]: values.map(referenceKey) };
    },
  });
  const referenceMentions = computed(() => refList.value.flatMap((item, index) =>
    typeof item.dataType === "string" && ["IMAGE", "VIDEO", "AUDIO", "STRING", "FILE"].includes(item.dataType)
      ? [{
          id: referenceKey(item),
          name: `参考 ${index + 1}`,
          value: `{{ref ${index + 1}}}`,
          avatar: previews.value.get(referenceKey(item)) || undefined,
        }]
      : []
  ));

  useNodeEvent().on(`input:${handleId}`, (values) => {
    inputValues.value = values;
    const ids = new Set(values.filter(item => item.dataType === "IMAGE" || item.dataType === "VIDEO").map(referenceKey));
    for (const key of previews.value.keys()) {
      if (!ids.has(key)) previews.value.delete(key);
    }
  });

  function setReferencePreview(item: NodeInputValue, url: string) {
    previews.value.set(referenceKey(item), url);
  }

  function removeReference(item: NodeInputValue) {
    removeEdges(edges => edges.filter(edge =>
      edge.target === id && edge.targetHandle === handleId && edge.source === item.source && edge.sourceHandle === item.sourceHandle
    ));
  }

  // referenceOrder 是参考编号（{{ref N}}）的唯一落点：入边顺序本身不携带顺序，只有这里写下的键数组决定编号。
  nodeTools.register({
    name: "getReferenceOrder",
    description: `查询节点 ${handleId} 端口的参考顺序：按当前生效顺序返回 references（含参考编号、来源节点与端口），并给出 referenceMentions 的 {{ref N}} 文本。未显式排序时按入边顺序。`,
    parameters: z.strictObject({ handleId: z.string().trim().min(1).max(64).optional().describe("输入端口，省略时使用节点默认端口") }),
    execute(args) {
      const target = args.handleId ?? handleId;
      const references = referenceOrderOf(target);
      return {
        handleId: target,
        explicit: !!node.data.referenceOrder?.[target],
        references,
        referenceMentions: references.map((item, index) => ({ index: index + 1, value: `{{ref ${index + 1}}}`, source: item.nodeId, sourceHandle: item.sourceHandle })),
      };
    },
  });
  nodeTools.register({
    name: "setReferenceOrder",
    description: `按给定 sources 顺序重写节点 ${handleId} 端口的参考顺序，写入 referenceOrder，参考编号 {{ref N}} 随之改变。sources 必须是该端口现有的入边来源；未列出的入边保持在其后按原顺序追加。用于让参考编号与资产卡 refs / 多轨 referenceIds 的给定顺序一致。`,
    parameters: z.strictObject({
      handleId: z.string().trim().min(1).max(64).optional().describe("输入端口，省略时使用节点默认端口"),
      sources: z.array(z.strictObject({
        nodeId: z.string().trim().min(1).max(256),
        sourceHandle: z.string().trim().min(1).max(256).optional(),
      })).min(1).max(64).describe("按期望顺序排列的上游节点与输出端口"),
    }),
    execute(args) {
      const target = args.handleId ?? handleId;
      const incoming = incomingSources(target);
      const wanted: { nodeId: string; sourceHandle: string }[] = [];
      for (const source of args.sources) {
        const matched = incoming.filter(item => item.nodeId === source.nodeId
          && (source.sourceHandle === undefined || item.sourceHandle === source.sourceHandle));
        if (!matched.length) throw new Error(`参考顺序包含非入边来源：${source.nodeId}${source.sourceHandle ? `:${source.sourceHandle}` : ""}，请先用 connectNodes 连线`);
        if (matched.length > 1) throw new Error(`参考来源 ${source.nodeId} 在该端口有多条入边，请同时指定 sourceHandle`);
        if (wanted.some(item => item.nodeId === matched[0].nodeId && item.sourceHandle === matched[0].sourceHandle)) throw new Error(`参考来源重复：${source.nodeId}`);
        wanted.push(matched[0]);
      }
      // ACT: 未列出的入边按原顺序追加在后，不丢参考；调用方要精确顺序时应传入全部入边。
      const rest = incoming.filter(item => !wanted.some(kept => kept.nodeId === item.nodeId && kept.sourceHandle === item.sourceHandle));
      const ordered = [...wanted, ...rest];
      node.data.referenceOrder = { ...node.data.referenceOrder, [target]: ordered.map(item => referenceKeyOf(item.nodeId, item.sourceHandle)) };
      return { handleId: target, order: ordered.map(item => [item.nodeId, item.sourceHandle]), appended: rest.length };
    },
  });

  function incomingSources(target: string) {
    return getEdges.value
      .filter(edge => edge.target === id && (edge.targetHandle ?? "in") === target)
      .map(edge => ({ nodeId: edge.source, sourceHandle: edge.sourceHandle ?? "" }));
  }

  function referenceOrderOf(target: string) {
    const order = new Map(node.data.referenceOrder?.[target]?.map((key, index) => [key, index]) ?? []);
    return incomingSources(target)
      .map(item => ({ ...item, key: referenceKeyOf(item.nodeId, item.sourceHandle) }))
      .sort((a, b) => (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size))
      .map(({ key: _key, ...item }) => item);
  }

  return { refList, referenceMentions, setReferencePreview, removeReference };
}

function referenceKeyOf(nodeId: string, sourceHandle: string) {
  return encodeURIComponent(JSON.stringify([nodeId, sourceHandle]));
}

function referenceKey(item: NodeInputValue) {
  return referenceKeyOf(item.source, item.sourceHandle);
}
