import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import desktopConfig from "../../electrobun.config.ts";
import postcssConfig from "../../postcss.config.ts";
import { i18nPlugin } from "@toonflow/i18n/vite";

const serverOrigin = `http://127.0.0.1:${process.env.TOONFLOW_SERVER_PORT || 3000}`;

export default defineConfig({
  css: { postcss: postcssConfig },
  define: {
    "import.meta.env.appVersion": JSON.stringify(desktopConfig.app.version),
  },
  server: {
    proxy: {
      "/mcp": { target: serverOrigin, changeOrigin: false },
      "/a2a": { target: serverOrigin, changeOrigin: false },
      "/api": {
        target: serverOrigin,
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            request.setHeader("x-toonflow-local-client", ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "") ? "1" : "0");
          });
        },
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: /^shiki$/, replacement: fileURLToPath(new URL("./src/lib/shiki.ts", import.meta.url)) },
    ],
  },
  build: {
    outDir: "../../build/web",
    emptyOutDir: true,
    // ACT: 桌面端页面从本地磁盘加载，Vite 默认的 500 kB 是「网络传输」启发式阈值，在这里只会持续刷警告。
    // 当前最大分块约 6.3 MB（shiki 语言包一类），阈值抬到 8 MB 覆盖；再超出说明真有意外膨胀，警告依然会报。
    // 要真正减小首屏体积应做路由级懒加载 / vendor 手动切分，那是独立优化，不在本次日志清理范围内。
    chunkSizeWarningLimit: 8192,
  },
  plugins: [
    i18nPlugin(),
    vue(),
    components({
      globsExclude: ["src/components/settings/panels/**/*Dialog.vue"],
      dts: "src/types/components.d.ts",
      resolvers: [
        ElementPlusResolver(),
        (name) => {
          if (name.startsWith("Icon")) return { name, from: "@tabler/icons-vue" };
        },
      ],
    }),
  ],
});
