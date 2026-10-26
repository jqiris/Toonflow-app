# 官方插件开发指南核实结论

> 来源：`C:\Users\jason\Downloads\Toonflow插件开发指南_extracted\Toonflow 插件开发指南.md`
> 本文只记录**经本仓库源码逐层核实**的结论，以及它对既有方案的修订影响。指南本身的事实以官方文档为准，本文标注验证位置。

---

## 一、指南给出的三类插件契约（与仓库一致）

| 类型 | 交付物 | 运行位置 | 仓库位置 |
|---|---|---|---|
| tools | `<name>.tool.js` | Bun 服务端 | `packages/tools/*` |
| nodes | `<name>.umd.js` | 浏览器 / 桌面 WebView | `packages/nodes/*` |
| skill | `SKILL.md` + 资源（.md/.zip/.tar） | 按需读取，无编译 | `packages/skills/*` |
| teams | — | **未开放** | 仓库保留脚手架 |

关键点：
- tools/nodes 版本取自各自 `package.json` 的 `version`；skill 版本取 frontmatter 的 `metadata.version`。
- 安装管理**必须从桌面端或 Server 本机发起**；开发者选项支持本地文件与 HTTP(S) 直链（最多 20 MiB、下载等 30 秒、最多 5 次重定向）。
- `dev:plugins` 构建并同步开发目录 `data/`；普通单包 `build` 只写 `build/`，仅 `NODE_ENV=dev` 才同步 `data/`。
- **修改 `packages/skills` 不等于更新已安装副本**：内置技能首次初始化后只补缺失，不覆盖。调试优先用工作区 `skill/` 目录（单数）。

---

## 二、对方案的实质性修订：工具可以直接驱动画布与媒体

这是本次核实最重要的发现。**指南 02 §4「宿主上下文」列出 `context.canvas`、`context.media`、`context.ffmpeg`、`context.question`、`context.skills`。我已逐层在源码中证实它们真实存在。**

### 2.1 `context.canvas`（已验证）

| 位置 | 事实 |
|---|---|
| `packages/toolScaffold/src/runtime.ts:64-72` | `CanvasContext` 接口：`{ id, tools, getNodeLabel?, call(request, signal?) }` |
| `apps/server/src/agent/bridge/canvas.ts:11-55` | `createCanvasContext(cwd, canvas, send)` 实现 `call()`：按名查 `canvasOperations` → `operation.parameters.parse(args)` → 分配 callId → 事件下发前端 → 等回传 |
| `apps/server/src/agent/tools/index.ts:74` | 注入 `canvas`（无画布绑定时为 `undefined`） |

**能力边界（实测）**：
- 可调用 `packages/tools/canvas/src/runtime.ts` 注册的**全部**画布操作：`getCanvas`、`getCanvasNodes`、`getCanvasEdges`、`getNodeTools`、`addNode`、`moveNodes`、`renameNodes`、`deleteNodes`、`connectNodes`、`deleteEdges`、`selectNodes`、`arrangeCanvas`、`fitCanvas`、`nodeTools`。
- 即**工具可以建节点、连边、调用 `node:setConfig` / `node:setPrompt` / `node:generateVideo`**。
- 限制：画布调用**顺序排队**执行；单次 120 秒超时；支持 `signal` 取消；需要画布页面保持连接，否则报「画布调用超时，请确认画布仍然打开」。

### 2.2 `context.media`（已验证）

`apps/server/src/agent/tools/index.ts:78-83`：

```ts
media: workspaceAvailable ? {
  listModels: listMediaModels,
  generateImage: (request, signal) => generateMedia(cwd, "image", request, signal),
  generateVideo: (request, signal) => generateMedia(cwd, "video", request, signal),
  generateAudio: (request, signal) => generateMedia(cwd, "audio", request, signal),
} : undefined,
```

请求类型 `MediaGenerationRequest`（`runtime.ts:93-118`）支持 `providerId/modelId/prompt/outputDirectory`、`images[]/videos[]/audios[]`、`firstFrame/lastFrame`、`ratio/size/resolution/duration/generateAudio/voice/speed/volume/pitch/language/format/sampleRate`、`mode`。结果 `GeneratedMedia[]` 带已落盘 `path` 与 `mimeType`。

### 2.3 `context.ffmpeg`（已验证）

`apps/server/src/agent/tools/index.ts:77` → `createWorkspaceFfmpeg(cwd, signal)`，返回**原生 `@renmu/fluent-ffmpeg` 工厂**（指南示例可直接用）。注意指南明确的取消边界：`context.ffmpeg(signal)` 只覆盖获取工厂的准备阶段，启动后需调用方监听取消并 `command.kill("SIGKILL")`。缺 FFmpeg 时抛 `FFMPEG_REQUIRED`（HTTP 424），不自动安装。

### 2.4 `context.question`（已验证）

`runtime.ts:164-166` → `ask(toolCallId, request, signal)`，可向用户提问并等待；需要配套 Vue 交互组件（参考 `packages/tools/askUser`）。

---

## 三、方案修订：工具可以成为执行器

### 3.1 原方案的问题

`docs/toonflowMultitrackFeasibility.md` 与 `docs/multitrackProductionPlan.md` 判定「工具不能碰画布，生成只能由 Agent 调 nodeTools」，据此把 Agent 放在执行层。该结论**部分错误**：扩展确实没有节点写通道（`ExtContext` 无 `canvas`/`nodeTools`），但**工具有**。

### 3.2 修订后的分工

| 层 | 容器 | 职责 |
|---|---|---|
| 契约层 | skill `assetCard` | 编号、接线规则、多轨模板、段头语法 |
| 编辑器层 | ext `multitrack` | 编辑与回显 `story.mtrack`（仍无节点通道） |
| **校验层** | tool `planOperator` | V1–V15 校验、索引产物 |
| **执行层** | tool `planOperator`（新增 `dispatch` action） | `context.canvas.call()` 建节点/连线/配参/写提示词/生成/查状态/回写 |
| 语义层 | Agent | 判断本期范围、确认关口、批准算力、失败决策 |

 **Agent 不再逐镜手工执行 11 步调用**，只做语义判断与确认；重复性的建节点、连线、setConfig、setPrompt、generateVideo、回写状态交给工具的 `dispatch`。这大幅降低 Agent 出错面，也让「参考顺序 = `「双花括号 ref 占位符」`」由程序保证而非提示词纪律。

### 3.3 仍然不变的硬约束

1. **逐分镜生成仍走 videoGenerationNode**，不改成 `context.media.generateVideo`——因为多轨需要 `referenceOrder` 与 `mode` 匹配的一致性校验，直接用 media 会绕开 V6/V8/V10/V15。
2. **`validate` 零写入**，只有 `build` 写派生文件；`dispatch` 只写多轨 JSON 与调用画布操作，不写 `skill/`、不碰 `data/`。
3. 生成前仍需用户批准算力；`context.question` 可承载该确认，但**FreeVideo 是免费（本机 GPU）**，按现有纪律仍须展示方案并等明确同意。
4. 扩展仍然不能调画布：这是 `ExtContext` 的真实边界，与工具不同，不要混为一谈。

---

## 四、安装与调试要点（来自指南，直接影响验收）

| 事项 | 正确做法 |
|---|---|
| 工具改动后不生效 | 只更新 `build/` 未同步 `data/`；或 Bun 模块缓存未清——**直接覆盖 `data/tools` 不经过缓存清理**，须重启 Server 或走安装入口重装 |
| 单包同步（PowerShell） | 先 `$env:NODE_ENV="dev"` 再 `bun run --cwd packages/tools/planOperator build`，`finally` 里恢复 |
| 同版本覆盖调试 | 设置 → 开发者选项 → 手动安装插件 → 勾选「强制安装」 |
| skill 调试 | 放工作区 `<project>/skill/`（单数），避免与 `data/skills` 全局副本冲突 |
| skill 打包 | ZIP 内恰好一个 `SKILL.md`，资源在其目录内；不支持加密、ZIP64、PAX/GNU |
| 插件发布 | https://api.toonflow.net/console/plugIn 上传，无需给主仓库提 PR |

---

## 五、待修订的文档清单

| 文档 | 修订点 |
|---|---|
| `docs/toonflowMultitrackFeasibility.md` | §1「不能调用 connectNodes/addNode/nodeTools」改为「**扩展不能，工具能**」；§7 待验证清单去掉「工具能否调画布」 |
| `docs/multitrackProductionPlan.md` | §0 表格执行层、§4 生成执行、§6 分期 M1 范围（`dispatch` action） |
| `docs/multitrackProductionPlanReview.md` | 记录本次事实更新与影响 |
| M1/M3 实施任务 | `planOperator` 增加 `dispatch`；`generationRunbook.md` 改为「工具执行 + Agent 确认」 |
