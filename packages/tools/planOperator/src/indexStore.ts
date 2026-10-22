/**
 * 唯一触碰 IO 的模块。所有文件读写都经宿主注入的 context.files，
 * 不 import node:fs / Bun.file，不用相对 cwd 的手写路径。
 * read 用 readOnly 标记只读，避免占用写锁。
 *
 * 原子写：本模块只有 writeAtomic 一条覆盖写路径。宿主把 ToolFiles.writeFile 实现为
 * @toonflow/file 的 writeAtomic（临时文件 + rename）——
 * apps/server/src/agent/tools/index.ts:45-47 → apps/server/src/utils/workspace/files.ts:6-8
 * → packages/file/src/index.ts:147。工具侧不 import fs/Bun.write、不先 access 再覆盖，
 * 也不自行拼绝对路径绕过宿主的写锁与工作区边界校验。
 */
import type { ToolFiles } from "@toonflow/tools-scaffold/runtime";

export interface PlanStore {
  readText(path: string): Promise<string>;
  /** 覆盖保存整份快照（原子替换），mtrackUpdate 与派生文件共用。 */
  writeAtomic(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function createStore(files: ToolFiles): PlanStore {
  return {
    async readText(path: string): Promise<string> {
      const buffer = await files.readFile(path, true);
      return buffer.toString("utf8");
    },
    async writeAtomic(path: string, content: string): Promise<void> {
      await files.writeFile(path, content);
    },
    async exists(path: string): Promise<boolean> {
      try {
        await files.access(path, true);
        return true;
      } catch {
        return false;
      }
    },
  };
}
