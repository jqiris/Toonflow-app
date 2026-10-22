import type { ExtDefinition } from "@toonflow/ext-scaffold/runtime";

export default {
  id: "ext-multitrack",
  displayName: "多轨编辑器",
  icon: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#7aa2f7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18M3 12h10M3 16h13"/><circle cx="18" cy="12" r="2.2"/></svg>'),
  extensions: ["mtrack"],
  resourceKind: "file",
} satisfies Omit<ExtDefinition, "load">;
