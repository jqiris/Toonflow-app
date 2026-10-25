import { resolve } from "node:path";
import { createApp } from "./app";
import config from "../../../electrobun.config";

const startTime = Date.now();
const realPort = Number(process.env.TOONFLOW_SERVER_PORT || 3000);
if (!Number.isInteger(realPort) || realPort < 1 || realPort > 65535) throw new Error("TOONFLOW_SERVER_PORT 必须是 1–65535 之间的整数");
// 源码位于 apps/server/src，生产构建位于 build/server，均从文件位置定位根目录。
const fromSource = import.meta.path.endsWith(".ts");
const appDirectory = resolve(import.meta.dirname, fromSource ? "../../.." : "../..");
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(appDirectory, "data");
const app = await createApp({
  webRoot: resolve(appDirectory, "build/web"),
  appVersion: config.app.version,
  dataDirectory,
  toolsRoot: resolve(appDirectory, "build/tools"),
  nodesRoot: resolve(appDirectory, "build/nodes"),
  extRoot: resolve(appDirectory, "build/ext"),
  // ACT: 暂不安装内置团队，随团队打包一同恢复。
  // agentsRoot: resolve(appDirectory, "build/agents"),
  providersRoot: resolve(appDirectory, fromSource ? "packages/providers/src" : "build/providers"),
  skillsRoot: resolve(appDirectory, fromSource ? "packages/skills" : "build/skills"),
});
const { initializeMcpRuntime } = await import("./utils/mcp/runtime");
const { startMobileLinkRuntime } = await import("./utils/mobileLink");
// ACT: listen 回调只在成功时执行且不带参数；端口占用（EADDRINUSE）走 server 的 "error" 事件，
// 原来无人监听会裸崩。这里显式监听并给出可执行的处置提示。
const server = app.listen(realPort, async () => {
  await initializeMcpRuntime(app, `http://127.0.0.1:${realPort}`, resolve(appDirectory, fromSource ? "packages/mcp/src/stdio.ts" : "build/mcp/stdio.js"));
  await startMobileLinkRuntime(app).catch(error => console.error("设备互联启动失败：", error));
  console.log(`[服务启动成功]: http://localhost:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") console.error(`[服务启动失败]: 端口 ${realPort} 已被占用。请关闭占用该端口的程序，或通过环境变量 TOONFLOW_SERVER_PORT 换一个端口后重新启动。`);
  else console.error("[服务启动失败]:", error.message);
  process.exit(1);
});
