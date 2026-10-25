import { copyFile, mkdir, readFile, rename, rm, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile } from "vite";
import vue from "@vitejs/plugin-vue";
import { z } from "zod";
import { defineExt, type ExtDefinition } from "./src/runtime.ts";

const tiptapGlobals = {
  "@tiptap/core": "toonflowTiptapHost.core",
  "@tiptap/vue-3": "toonflowTiptapHost.vue3",
  "@tiptap/starter-kit": "toonflowTiptapHost.starterKit",
  "@tiptap/markdown": "toonflowTiptapHost.markdown",
  "@tiptap/extension-find-and-replace": "toonflowTiptapHost.findAndReplace",
  "@tiptap/extension-highlight": "toonflowTiptapHost.highlight",
  "@tiptap/extension-image": "toonflowTiptapHost.image",
  "@tiptap/extension-list": "toonflowTiptapHost.list",
  "@tiptap/extension-subscript": "toonflowTiptapHost.subscript",
  "@tiptap/extension-superscript": "toonflowTiptapHost.superscript",
  "@tiptap/extension-table": "toonflowTiptapHost.table",
  "@tiptap/extension-text-align": "toonflowTiptapHost.textAlign",
  "@tiptap/pm/model": "toonflowTiptapHost.model",
  "@tiptap/pm/state": "toonflowTiptapHost.state",
  "@tiptap/pm/view": "toonflowTiptapHost.view",
  "marked": "toonflowTiptapHost.marked",
  "dompurify": "toonflowTiptapHost.dompurify",
};

export type ExtMetadata = Omit<ExtDefinition, "load">;

/**
 * 记录构建器写进 data/ext 的那份产物哈希，供服务端启动同步（initializeExt.ts:43-44）判定
 * 「这份是同版本内置包、可以覆盖」——不记这一步时，构建器直写的文件在 bundled.json 里没有条目，
 * 服务端会把它当成「市场安装或本地修改」而永远跳过同版本更新。
 * ACT: 多个扩展并行构建时这里是读-改-写，最坏情况漏记一个条目——那个扩展退化成今天的行为
 * （同版本不再被服务端同步覆盖），不会写入错误数据；要彻底消除请改成单一构建后处理步骤。
 * ACT: 这里用 node:crypto 的 sha256 而不是 Bun.hash——vite 加载本配置的上下文里没有 Bun 全局；
 * 服务端 initializeExt 两种哈希都认（见那里 :44 附近的注释）。
 */
async function recordBundledState(dataDir: string, fileName: string) {
  const name = fileName.slice(0, -7);
  const statePath = resolve(dataDir, "bundled.json");
  const source = await readFile(resolve(dataDir, fileName), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!source) return;
  const saved = await readFile(statePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  let state: Record<string, { hash: string; revision?: string }> = {};
  try { state = JSON.parse(saved) as typeof state; } catch { state = {}; }
  state[name] = { hash: createHash("sha256").update(source).digest("hex"), revision: "dev" };
  await writeAtomic(statePath, JSON.stringify(state), { mode: 0o600 });
}

export function createExtConfig(config: ExtMetadata, configUrl: string) {
  defineExt({ ...config, load: async () => ({ default: {} }) });
  const root = fileURLToPath(new URL(".", configUrl));
  const fileName = `${config.id}.umd.js`;
  const outDir = fileURLToPath(new URL("../../build/ext", import.meta.url));
  const dataDir = fileURLToPath(new URL("../../data/ext", import.meta.url));
  let syncToData = process.env.NODE_ENV === "dev";

  return defineConfig({
    root,
    plugins: [
      vue(),
      {
        name: "extBundle",
        enforce: "post",
        configResolved(resolvedConfig) {
          syncToData ||= Boolean(resolvedConfig.build.watch) || resolvedConfig.mode === "development";
        },
        async generateBundle(_options, bundle) {
          const chunk = bundle[fileName];
          if (!chunk || chunk.type !== "chunk") throw new Error(`未生成扩展文件：${fileName}`);
          const packagePath = resolve(root, "package.json");
          const readmePath = resolve(root, "readme.md");
          const metadataPath = resolve(root, "src/metadata.ts");
          this.addWatchFile(metadataPath);
          const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, metadataPath, root);
          if (!loaded) throw new Error(`扩展缺少声明文件：${metadataPath}`);
          for (const dependency of loaded.dependencies) this.addWatchFile(dependency);
          const { load: _load, ...metadata } = defineExt({ ...loaded.config as unknown as ExtMetadata, load: async () => ({ default: {} }) });
          if (metadata.id !== config.id) throw new Error("修改扩展 ID 后请重新启动构建命令");
          const configRules = z.array(z.record(z.string(), z.json())).max(100).parse(metadata.configRules ?? []);
          this.addWatchFile(packagePath);
          this.addWatchFile(readmePath);
          const packageInfo = JSON.parse(await readFile(packagePath, "utf8"));
          const version = typeof packageInfo.version === "string" ? packageInfo.version.trim() : "";
          if (!version) throw new Error(`扩展 package.json 缺少有效的 version：${config.id}`);
          const readme = await readFile(readmePath, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
          let css = "";
          for (const [name, asset] of Object.entries(bundle)) {
            if (asset.type !== "asset" || !name.endsWith(".css")) continue;
            css += typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
            delete bundle[name];
          }
          const styleId = JSON.stringify(`toonflowExt-${config.id}`);
          const injectStyle = css ? `if(typeof document!=="undefined"){let style=document.getElementById(${styleId});if(!style){style=document.createElement("style");style.id=${styleId};document.head.appendChild(style)}style.textContent=${JSON.stringify(css)}}\n` : "";
          // 压缩完成后加入元数据和样式，单个 JS 即可供扩展加载器使用。
          chunk.code = `/*! toonflowExt:${JSON.stringify({ ...metadata, configRules, version, readme }).replaceAll("/", "\\u002f")} */\n${injectStyle}${chunk.code}`;
        },
        async writeBundle() {
          if (!syncToData) return;
          await mkdir(dataDir, { recursive: true });
          const targetPath = resolve(dataDir, fileName);
          const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
          try {
            await copyFile(resolve(outDir, fileName), tempPath);
            await rename(tempPath, targetPath);
          } finally {
            await rm(tempPath, { force: true });
          }
          await recordBundledState(dataDir, fileName);
        },
      },
    ],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      // ACT: 多个扩展共享目录，构建单包时保留其他扩展产物。
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: {
        entry: resolve(root, "src/index.ts"),
        name: `toonflowExts.${config.id}`,
        formats: ["umd"],
        fileName: () => fileName,
      },
      rolldownOptions: {
        external: ["vue", "@vue/runtime-core", "@vue/runtime-dom", "element-plus", "@toonflow/i18n/vue", ...Object.keys(tiptapGlobals)],
        output: {
          exports: "default",
          codeSplitting: false,
          globals: {
            ...tiptapGlobals,
            vue: "toonflowExtHost.vue",
            "@vue/runtime-core": "toonflowExtHost.vue",
            "@vue/runtime-dom": "toonflowExtHost.vue",
            "element-plus": "toonflowExtHost.elementPlus",
            "@toonflow/i18n/vue": "toonflowExtHost.i18n",
          },
        },
      },
    },
  });
}
