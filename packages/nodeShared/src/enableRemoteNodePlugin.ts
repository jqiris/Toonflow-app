import type { Ref } from "vue";

export async function ensureRemoteNodePlugin(deps: {
  name: "imageNode" | "videoNode" | "imageGenerationNode";
  label: string;
  nodeTypes: Readonly<Ref<Record<string, unknown>>>;
  reloadRemoteNode: ((type: string) => Promise<void>) | undefined;
}): Promise<void> {
  const { name, label, nodeTypes, reloadRemoteNode } = deps;
  const nodeType = `remote-${name}`;
  if (nodeTypes.value[nodeType]) return;
  if (!reloadRemoteNode) throw new Error(`请先启用${label}节点插件`);
  const response = await fetch("/api/nodes/setEnabled", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ name, enabled: true }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || `启用${label}节点插件失败（HTTP ${response.status}）`);
  }
  await reloadRemoteNode(nodeType);
}

