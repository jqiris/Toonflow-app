# Toonflow 能力盘点与扩展插槽报告

> 任务：t2（[toonflowStudy] 盘点 Toonflow 现有能力与可用扩展插槽）。只读研究，未修改任何业务代码。
> 基准：本仓库当前工作树（`packages/providers/src/media/freevideo.ts` 等本机改动尚未提交）。
> 对照对象：`C:\workspace\super-ai\LocalStoryCanvas` 的「资产卡编号 + 声明式参考接线 + 程序化硬校验 + 分镜头到视频节点映射」。

---

## 0. 结论速览

1. **编号 / 声明式接线 / 硬校验三件事在 Toonflow 里都没有一等公民容器**。现有对应物分别是「节点标题 + Markdown 文本」「Agent 手工 `connectNodes` + `setPrompt`」「`canConnect` + 节点函数内联校验」，全部依赖 Agent 自觉。
2. **唯一一等的确定性层是 `nodeTools.register`**：Zod 参数经 `parseAsync` 才执行，schema 转 Draft-7 供 Agent 查询，属于运行时业务校验（不属于测试代码）。这是植入「硬校验 guard」最自然的插槽。
 3. **结构化计划的落点是文本节点正文文件**（`content.md`），不是专用容器；`「双花括号 ref 占位符」` 的编号由 `data.referenceOrder[portId]` + 入边顺序决定，Agent 只能读、不能经工具写。
4. **媒体链路已就绪**：本机 FreeVideo（`/freevideo/agent/v1`，MiniMax-H3）作为媒体供应商接入，视频节点可直接使用；**ComfyUI 无需自研**，Toonflow 侧只面对供应商 HTTP 契约。
5. **成本最低的落地方向**：新增一个 skill（规范化计划 + 接线契约）+ 一个 tool（`planOperator` 结构化存取 + 确定性校验）+ 一个节点函数 guard（`setPrompt` 前置校验）。三者都不需要改宿主代码，均可独立回滚。

---

## 1. 插槽总表

| # | 容器类型 | 落点路径 | 复用/新增 | 成本 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| S1 | skill | `packages/skills/<name>/SKILL.md` | 新增 | 低 | 无代码校验，纯提示词约束易漂移 |
| S2 | team | `packages/teams/<name>/` | 新增（可选） | 中 | 成员工具权限需白名单，团队私有工具须走 toolScaffold 产物 |
| S3 | tool | `packages/tools/<name>/` | 新增 | 中 | 工具是服务端可信代码，无法阻止绕过；只能约束自身行为 |
| S4 | node | `packages/nodes/<name>/` | 新增 | 高 | 需 `bun run dev:plugins` 双终端构建；UMD 版本与宿主耦合 |
| S5 | nodeTools guard | 既有 `imageGenerationNode` / `videoGenerationNode` / `textNode` 的 `nodeTools.register` | 扩展 | 低 | 需改动节点源码，属业务代码修改，须单独授权 |
| S6 | ext | `packages/ext/<name>/`（`resourceKind: "canvasNode"`） | 新增 | 中 | 只做展示/审阅，不提供校验 |
| S7 | server | `apps/server/src/routes/<业务>/*.ts` | 新增（尽量避免） | 高 | 改路由须 `bun run routes`；跨包引用限制严格 |
| S8 | MCP | `packages/mcp` 复用 + `apps/server/src/utils/mcp/operations.ts` | 复用 | 低 | 管理操作走 HTTP 复制，新增操作需改宿主 |
| S9 | 媒体 provider | `packages/providers/src/media/*.ts` + `data/providers/` | 复用 | 低 | 已有 FreeVideo，无需新增 |

---

## 2. 架构分层（含确切路径）

### 2.1 skills：纯 Markdown，无 `package.json`
- 根：`packages/skills/`，三个技能：`canvas/`（`SKILL.md` + `references/videoProduction.md`）、`v118workflow/`（15 个 references + 6 篇 knowledge）、`workflow/`（`SKILL.md` 94 KB + 4 篇 references + 4 篇 methods）。
- 技能契约：`SKILL.md` 首部 YAML frontmatter 必须有 `name`、非空 `description`，可选 `metadata.version/displayName/author/github`（见 `apps/server/src/routes/skills/get.ts`）。
- 目录级资源：`references/` 由 `SKILL.md` 正文相对链接引用，"只用当前阶段需要的资料"是提示词纪律，不是代码约束。
- **插槽 S1**：新增技能目录即可被识别，无需注册。成本低、零编译。

### 2.2 teams：清单 + 成员提示词 + 私有资源
- 根：`packages/teams/storyboardTeam/`：`team.json`、`build.ts`、`readme.md`、`members/{director,writer,reviewer}.md`、`skills/storyboard/SKILL.md`、`knowledge/continuity.md`。
- `team.json` 结构：`name/displayName/description/version/author/github/entry/members`；成员字段 `description`、`instructions`、`delegates`、`tools`（工具名白名单，空数组关闭普通工具）、`skills`、`knowledge`。
- 构建：`createTeamConfig(import.meta.url, { sync })` → `build/agents/<name>/` + `<name>.agent.zip`；`NODE_ENV=dev` 同步到 `data/agents/<name>`，默认只补缺失文件，`--sync` 才完整替换。
- 运行时装配：`apps/server/src/agent/teams/index.ts` 读取 manifest，剥离宿主 `subAgent/report/askUser/delegate/teamResources/requestInput`，按成员 `tools` 过滤，并注入团队私有资源工具（`roots` = instructions + `skills/<name>` + `knowledge/<path>`）。
- 名字规则：团队成员名、工具名、技能目录名均小驼峰；委派链不可成环；目录/文件条目 ≤2000，总包 ≤20 MiB。
- **插槽 S2**：可选。当前 `storyboardTeam` 只有 `read/ls`，属于"纯文字分镜、不操作画布"。若要做"分镜 → 画布"的团队，必须显式放开 `nodeTools`/`connectNodes` 等工具名，并明确成员不得并发改同一画布。

### 2.3 tools：单文件 `.tool.js`，服务端可信代码
- 根：`packages/tools/{askUser,browser,canvas,assetOperator,ffmpeg,mediaGeneration,skillOperator,webFetch,webSearch,workspace}/`，每个含 `build.ts`、`src/index.ts`、`readme.md`。
- 契约：默认导出 `ToolPlugin`，实现 `validateConfig(config)` 与 `createTools(context)`；`context` 提供 `cwd`、`config`、`files`、`skills`、`assets`、`browser`、`ffmpeg`、`media`、`canvas`、`question`、`sdk`。
- 关键既有能力：
  - `packages/tools/canvas/src/runtime.ts`（`@toonflow/tool-canvas/runtime`）定义 Zod schema：`getCanvas / findCanvasNodes / getCanvasNodes / getCanvasEdges / getNodeTools / addCanvas / switchCanvas / renameCanvas / addNode / deleteNodes / moveNodes / renameNodes / connectNodes / deleteEdges / selectNodes / arrangeCanvas / fitCanvas / nodeTools`。读取类每次 ≤64 KiB，`connectNodes` 单批 ≤64 条。
  - `packages/tools/assetOperator/`：全局素材库 `list/read/create/update/mkdir/move/delete/import`，`import` 复制到工作区，改名/移动不覆盖，`update` 需 `revision`。
  - `packages/tools/mediaGeneration/`：Agent 直接出图/视频/音频落盘（默认 `assets/generated`），受三个配置开关约束。
  - `packages/tools/skillOperator/`：`list/read/create/update`，`scope` = `workspace`（工作区 `skill/`）或 `global`（`data/skills/`），同名优先工作区。
- **插槽 S3**：新增工具包 → `build/tools/<name>.tool.js` → 装到 `data/tools/`。是承载"计划解析 + 确定性校验"的最佳服务端落点。风险：工具拥有服务器进程权限，**不是沙箱**；它只能约束自己，拦不住 Agent 另用 `workspace` 工具直写。

### 2.4 nodes 与 nodeTools 契约
- 节点根：`packages/nodes/{textNode,imageNode,imageGenerationNode,videoNode,videoGenerationNode,audioNode,audioGenerationNode,director3dNode}/`，各含 `src/index.vue`、`vite.config.ts`、`readme.md`。
- 说明文档很薄（`readme.md` 多为面向用户的"怎么用"），**真正的契约在 `src/index.vue` 的 `nodeTools.register` 描述里**。以视频节点为例（`packages/nodes/videoGenerationNode/src/index.vue`）：
  - handles：`in`（target，`["IMAGE","VIDEO","AUDIO","STRING"]`）、`video`（source，`VIDEO`）。
  - 注册函数：`getConfig`、`setConfig`（模型/时长/分辨率/比例/模式/声音）、`setPrompt`、`generateVideo`，另有 `useNodeGeneration` 提供的状态/取消函数。
  - `startGeneration` 内联断言：模型已选、提示词非空、所有引用的 `value !== undefined`、`matchingModes` 非空——这就是当前唯一"硬校验"的形态。
  - 参考顺序 → 请求参数映射：`refList`（按 `referenceOrder` 排序）→ `images/videos/audios`；`frameMode` 下 `images[0]` → `firstFrame`、`images[1]` → `lastFrame`；文本引用拼进 `generationPrompt`（`参考 N：\n<正文>`）。
- 图像节点同构：`getConfig/setConfig/setPrompt/generateImage`。
- **插槽 S4/S5**：新节点成本高；**扩展既有节点的 nodeTools（guard）成本最低**。

### 2.5 ext：文档扩展，不是画布逻辑
- 根：`packages/ext/{canvasNode,image,md,media,txt}/`，每个 `src/metadata.ts` + `src/index.ts` + `src/index.vue` + `viteConfig.ts`。
- 契约：`ExtDefinition`（`id: ext-<小驼峰>`、`displayName`、`extensions`（后缀）、`resourceKind: "file" | "canvasNode"`、可选 `text`、`icon`、`configRules`、`load()`）。
- `resourceKind: "canvasNode"` 的扩展在文档标签页里展示原画布节点的上槽位/内容/下槽位，通过 `context.mountNode(element)` 挂载，`context.resource.nodeId` 标识节点，`context.active` 控制挂卸。
- **插槽 S6**：适合做"分镜规划审阅面板"（只读展示 + 高亮缺口），不做校验权威。宿主从 `data/ext/` 枚举，`NODE_ENV=dev` 构建自动同步。

### 2.6 nodeScaffold：节点宿主接口（`packages/nodeScaffold/`）
- `readme.md`（497 行）是节点开发的唯一权威文档，关键条款：
  - **`nodeTools.register`**（`src/nodeTools.ts`）：必须在同步 `setup` 中调用；`name` 必须 `/^[a-z][a-zA-Z0-9]{0,63}$/`；`parameters` 必须是 Zod 对象 schema，经 `z.toJSONSchema(..., { target: "draft-07" })` 转给 Agent；执行前 `parseAsync`，保留默认值/转换/`refine`；注册表挂在共享 Vue Flow 实例的 `Symbol.for("toonflow.nodeTools")`，**不写入画布 JSON**；单次调用 120 s 超时。
  - **`setPrompt` 并非脚手架 API**，而是各生成节点自行注册的函数名约定；脚手架只提供注册与调用通道。
  - **`referenceOrder`**：`useNodeReferences`（`packages/nodeShared/src/useNodeReferences.ts`）从 `node.data.referenceOrder[handleId]` 读取键数组，键为 `encodeURIComponent(JSON.stringify([source, sourceHandle]))`；未列入的项按入边顺序追加。
   - **`「双花括号 ref 占位符」`**：`referenceMentions` 为第 N 项生成 `{ name: "参考 N", value: "「双花括号 ref 占位符」" }`，编号基于排序后的 `refList`，文字与媒体共用同一编号空间。
  - 其它：`useNode` 返回 `outputs/nodeEvent/files/ai/ffmpeg/config`；`nodeEvent.on("canConnect")` 仅调用 target 节点回调且必须同步；输出值固定 `{ dataType, value }`；`files` 走宿主工作区文件接口。
- **插槽边界**：`packages/nodeScaffold` 只放"通用节点基础能力、构建配置、宿主接口"；插件专属逻辑放插件；跨插件共享放 `packages/nodeShared`（`@toonflow/node-shared`，子路径导入，如 `promptInput`、`referenceItem`、`useNodeReferences`、`useNodeGeneration`、`mediaHistory`、`showNodeError`）。

---

## 3. 运行时能力

### 3.1 安装目录与加载方式
| 资源 | 开发同步目标（生产同构） | 根目录解析 | 加载方 |
| --- | --- | --- | --- |
| skill（全局） | `data/skills/`（本机当前已有 `canvas`、`v118workflow`、`workflow`、`cinematicDirector`、`freevideoAgent`、`minimax-h3-prompt-optimizer`、`screenwritingPipeline`） | `apps/server/src/utils/skills/files.ts` → `resolve(dirname(conf.path), "skills")` | `loadSkillsFromDir`（`routes/skills/get.ts`）、`loadAgentSkills`（`agent/skills/index.ts`） |
| skill（工作区） | `<workspace>/skill/` | `apps/server/src/agent/skills/index.ts` → `join(cwd, "skill")` | 同上 |
| team | `data/agents/<name>/`（本机当前**不存在**） | `apps/server/src/utils/teams/files.ts` → `agentsDirectory = resolve(dirname(conf.path), "agents")` | `agent/teams/index.ts`，经 `subAgent` 工具调用 |
| tool | `data/tools/*.tool.js` | server 侧 `listTools/loadTool` | `agent/tools/index.ts` → `createAgentTools` |
| node | `data/nodes/<name>.umd.js`（`/api/nodes/get` + `/api/nodes/files`） | 同上 | 前端 `window.toonflowNodes[名称]` 注册到 VueFlow |
| ext | `data/ext/<id>.umd.js` | 同上 | 文档宿主按 `resourceKind` 枚举 |
| provider | `data/providers/*.ts` | `apps/server/src/utils/media/provider.ts` | 媒体模型列表与生成 |

### 3.2 工作区 skill 优先规则
`loadAgentSkills(cwd, scope)` 传入 `skillPaths = [cwd/skill (workspace), data/skills (global)]`，按 SDK 扫描规则**同名工作区优先**；`createSkillContext` 的 `locate()` 在未指定 `scope` 时按技能实际路径判定范围，写入时 `writeWorkspaceFile` 加文件锁。`skillOperator` 工具文档同样声明"同名技能优先使用工作区版本；新建默认工作区"。

### 3.3 MCP 对外暴露
- 包：`packages/mcp/`（`src/index.ts` 的 `createMcpRouter`、`src/stdio.ts`、`skills/toonflow/SKILL.md` 外部 Agent 技能）。
- 默认地址 `http://127.0.0.1:10588/mcp`，Bearer 凭证由设置管理，仅本机回环。
- 工具：`getAppState`、画布五读 + 变更（与内置 Agent 共用 `tools/canvas` 实现）、`nodeTools`、`listAppOperations`/`appOperation`、`runAgent`、`workspaceFiles`、`getDocument`/`writeDocument`。
- 资源：`resources/list|read` 暴露 `data/skills` 下技能正文与附属文件，URI `toonflow://skills/<编码名称>/<分段编码路径>`。
- 管理操作表：`apps/server/src/utils/mcp/operations.ts`（31 项，含 `listSkills/readSkillFile/saveSkillFile/installSkill`、`listAssets/saveAsset`、`listNodes/installNode`、`listMediaProviders/addMediaProvider` 等），实现方式是**带本地凭证回放宿主 HTTP**，不是直调内部函数。
- **插槽 S8**：新增 MCP 工具须改 `apps/server/src/utils/mcp/*` 或加 `appOperations` 条目（`refresh.type` 仅支持 `node/tool/skill/provider`）。

### 3.4 Server 路由（`apps/server/src/routes/**`，`/api` 前缀由 `core.ts` 生成）
| 领域 | 路由文件 | 方法/路径 |
| --- | --- | --- |
| skills | `skills/get.ts` `list.ts` `read.ts` `create.ts` `save.ts` `move.ts` `order.ts` `setEnabled.ts` `install.ts` `uninstall.ts` | `GET /api/skills/get`、`GET /api/skills/list`、`GET /api/skills/read`、`POST /api/skills/create`、`PUT /api/skills/save`、`PUT /api/skills/move`、`PUT /api/skills/order`、`PUT /api/skills/setEnabled`、`POST /api/skills/install`、`DELETE /api/skills/uninstall` |
| agents（团队） | `agents/get.ts` `read.ts` `save.ts` `setEnabled.ts` `install.ts` `uninstall.ts` `connect.ts`、`agents/a2a/get.ts` `a2a/save.ts` | `GET /api/agents/get` 等；A2A 设置 `GET/PUT /api/agents/a2a/*` |
| agent（会话） | `agent/create.ts` `list.ts` `get.ts` `message.ts` `answer.ts` `skills.ts` `mentionSource.ts` `canvasResult.ts` 等 | `GET /api/agent/skills?directory=`、`GET /api/agent/mentionSource` 等 |
| assets（全局素材库） | `assets/list.ts` `read.ts` `save.ts` `mkdir.ts` `rename.ts` `remove.ts` | `GET /api/assets/list`、`GET /api/assets/read`、`PUT /api/assets/save`（octet-stream，query `path`）等 |
| workspaces | `workspaces/list.ts` `check.ts` `selectDirectory.ts`、`workspaces/files/{list,read,write,mkdir,rename,remove,copy,reveal,importImage}.ts` | `GET /api/workspaces/list`、`PUT /api/workspaces/files/write`（octet-stream + `directory/path/exclusive/expectedRevision/encoding`）、`POST /api/workspaces/files/copy` 等 |
| ai | `ai/models.ts` `ai/generate.ts`、`ai/media/{models,generate,price,balance,balanceEvents}.ts` | `POST /api/ai/generate`（SSE）、`GET /api/ai/models`、`POST /api/ai/media/generate`（JSON 分块 + 20 s 空行保活）、`GET /api/ai/media/models` 等 |

- **重生成路由方式**：**没有专用"重生成"路由**。重新生成 = 对同一节点的 `nodeTools` 再调一次生成函数（`node:generateVideo` / `node:generateImage`），或对同一文本节点再调一次 `ai.generate`。`apps/server/src/routes/ai/media/generate.ts` 只是"一次媒体生成请求"的传输层（AbortController + `X-Accel-Buffering: no`），不带任务 ID 与去重。FreeVideo 供应商内部用 `ref`（时间戳 + 随机盐）做幂等键，但每次调用都新生成，**不构成跨调用的重试恢复**。

---

## 4. 现状差距：Toonflow vs LocalStoryCanvas 四条核心思路

| LocalStoryCanvas 做法（依据 `C:\workspace\super-ai\LocalStoryCanvas\资产卡格式规范.md`） | Toonflow 现有对应物（确切位置） | 缺口 |
| --- | --- | --- |
| **① 资产卡编号**：`C\d+ / SC\d+ / P\d+ / KF\d+ / S\d+`，字母状态后缀（`P01-A`/`P01-B`）属身份，全局唯一，重复即拒绝导入 | 节点 `label`（`renameNodes`，1–200 字符）、文本节点正文 `content.md`、`data.referenceOrder` 的边键 | **无编号字段**。`assetId` 目前只能落在标题或正文里，是**纯文字索引**：节点改名即失效，无唯一性检查，无法被程序检索；`canvas` 读取工具也不按编号过滤（`findCanvasNodes` 只按 `query` 名称/ID、`types`、`selectedOnly`） |
 | **② 声明式参考接线**：卡片字段 `身份参考：C01` / `结构参考：SC01` / `道具参考：P01`，优先级「显式 > 参考派生散文 > 正则兜底 > 不接线」，并带否定守卫与 backwards-only 规则 | `connectNodes({connections:[{source,sourceHandle,target,targetHandle}]})` + `setPrompt` 手写 `「双花括号 ref 占位符」`；`data.referenceOrder[portId]` 存排序 | **接线靠 Agent 手工完成**：先 `connectNodes`，再 `getCanvasEdges(direction:"incoming")` 读入边、`getCanvasNodes({dataKeys:["referenceOrder"]})` 读排序，最后 `setPrompt` 写 `「双花括号 ref 占位符」`。顺序、编号一致性、前置依赖（资产先出图）**全部是提示词纪律**（`packages/skills/canvas/references/videoProduction.md` 第 3 节）。`referenceOrder` 没有写入型 nodeTools，Agent 只能间接靠连线顺序影响排序；每端口连线数上限 ≤2 的规则存在于示例而非统一约束 |
 | **③ 程序化硬校验**：import 期拒绝重复编号；`build_asset_steps` 拓扑排序；执行期严格串行，依赖未完成即抛错暂停；守卫规则（存在性/backwards-only/后缀/少年闪回排除）在解析层确定性生效 | `nodeTools.register` 的 Zod `parseAsync`；`videoGenerationNode.startGeneration` 的 5 条内联断言；`nodeScaffold` 的 `validateConnection` 类型/方向检查；`apps/server/src/utils/workspace/files.ts` 工作区边界与文件锁 | **没有面向"制作计划"的确定性 guard**：无编号唯一性检查、无"目标资产存在且已出图"检查、无"提示词 `「双花括号 ref 占位符」` 与入边一一对应"检查、无拓扑依赖校验。现有校验只覆盖单节点参数合法性，且散落在节点源码，不可配置、不可复用 |
| **④ 分镜头 → 视频节点映射**：一个片段 = 一个视频节点/一份多参提示词；KF 构图卡从提示词正文提取 `C01/SC01/P01` 做拓扑依赖 | `packages/skills/canvas/references/videoProduction.md` 的"一个片段的全部镜头 → 一个视频生成节点的提示词"；`v118workflow/references/{storyboardTable,storyboardPanel,storyboardImages,videoProduction}.md`；视频节点 `in` 端口 + `refList` → `images/videos/audios/firstFrame/lastFrame` | **映射无结构承载**：镜头表只是 Markdown；"哪一段 → 哪个节点"靠 `label`（如"场01·片段01·视频"）人工约定；缺少"片段号/镜号/参考编号"到 `nodeId` 的机器可读映射，重生成时无法定位"这段的节点" |

**补充差距**：`packages/skills/*` 不参与任何编译检查；`storyboardTeam` 成员无画布写入能力；`data/agents` 为空说明团队包从未在本机安装——若要验证团队路径，需先 `bun run --cwd packages/teams/storyboardTeam build`（`NODE_ENV=dev`）。

---

## 5. 媒体链路现状（FreeVideo / ComfyUI）

- 文件：`packages/providers/src/media/freevideo.ts`（278 行，本机新增，`git status` 显示 `AM`），包导出 `packages/providers/package.json` → `"./media/freevideo": "./src/media/freevideo.ts"`，安装副本同内容位于 `data/providers/freevideo.ts`。
- 形态：**自包含供应商模块**，`// 自包含：不 import 任何模块`，HTTP 全走 `this.tool.fetch`，不依赖 `packages/providers` 的其它模块。
- 端点与契约：
  - 基址 `http://127.0.0.1:8188/freevideo/agent/v1`（`agentSuffix` 自动补全，允许只填 origin）。
  - `POST {agent}/media`：`{ name, data_base64 }` → `{ file }`（素材换内部路径）。
  - `POST {agent}/jobs`：提交任务（`kind: "image" | "generate"`）。
  - `GET {agent}/jobs/{id}?wait=25`：轮询，按 `poll_after_ms` 退避，终态 `succeeded / failed / cancelled / interrupted`。
  - 结果下载：用**服务器 origin** 而非 agent 基址（`originOf()`），带同一 Bearer token。
- 模型声明：`MiniMax-H3`（video，`mode: ["text", "startFrameOptional", ["imageReference:4","videoReference:1","audioReference:1"]]`，`audio: "optional"`，2–60 秒，`768P / 2K`）；`freevideo-image`（image，`text/singleImage/multiReference`，`1K/2K`，5 种比例）。
- 参数映射：`seconds = clamp(2..60)`、`quality: "light"`、`aspect ← ratio`、`megapixels ← resolution`（2K→2.0，1080→1.5，其余 1.0）；图像 `width/height` 由比例 + 1K/2K 推算，钳制 256–2048。
- 超时：图像 10 分钟、视频 30 分钟，与外部 `signal` 用 `AbortSignal.any` 合并。
- 与 ComfyUI 的关系：FreeVideo 跑在 ComfyUI 进程内（端口 8188，`FreeVideo-engine/agent/token`，插件 `CinemaWorld` 目录下 `comfyui_freevideo` 注册 `/freevideo/agent` 路由）。**Toonflow 只认 agent HTTP 契约，不知道 ComfyUI 的存在**——这是关键分层结论。
- **可复用**：`ai.generateVideo / generateImage`（`packages/nodeScaffold/src/nodeAi.ts` → `useNodeAi`）、节点侧 `generationInput` 映射、`mediaGeneration` 工具直出、`mediaPrice`/`mediaHistory`、`apps/server/src/utils/media/generation.ts` 落盘与计费。
- **不自研**：ComfyUI 工作流编排、VAE identity 注入、`TextEncode` 参考接线、拓扑排序执行器。LocalStoryCanvas 的 `attach_identity_reference`、`configure_encoder`、`OBJECT_REFERENCE_RULE` 属于**引擎内部实现**，Toonflow 侧没有、也不应复制；Toonflow 只需产出正确的「提示词 + 有序参考素材」，由 FreeVideo 负责画质一致性。
 - **须注意**：`mode` 声明是"可选模式集合"，节点是按引用数量选模式的（`getMatchingModes`）；供应商侧 `images` 直接拼进 `media.references`（图片→视频→音频顺序），**参考序号与提示词 `「双花括号 ref 占位符」` 的对应关系由 Toonflow 的 `refList` 决定，供应商不做编号**。

---

## 6. 约束清单

### 6.1 仓库红线（`AGENTS.md`）
1. **命名**：新建文件/文件夹一律小驼峰（`userStore.ts`、`editorPanel/`），禁止短横线、蛇形、帕斯卡、全大写；组件标签禁大驼峰；props 一律小驼峰；第三方标签允许短横线。函数/变量/计算属性/事件处理也用小驼峰，禁止全大写常量。
2. **目录**：插件专属逻辑留在插件内；跨插件共享进 `packages/nodeShared`（`@toonflow/node-shared` 子路径）；`packages/nodeScaffold` 只放通用节点能力/构建配置/宿主接口。server 侧 `src/routes/` 下 `.ts` 全部当路由扫描，工具实现放 `src/utils/<业务>/`。
3. **文件操作**：自有代码磁盘操作统一 `@toonflow/file`（Bun 对象用 `@toonflow/file/bun`）；覆盖保存完整快照用 `writeAtomic`/`writeAtomicSync`，仅新建用 `exclusive`。禁止各模块重复封装底层 fs。
4. **禁止新增测试代码**：不得新增 `.test.ts`/`.spec.ts`/`scripts/check.ts`/`check*.ts`，不得通过改名、临时文件、mock/fixture 绕过；不得新增测试框架、测试依赖、`package.json` 测试脚本或 CI 测试入口。**运行时业务校验必须保留**（入参校验、路径边界、冲突保护、安装检测等不算测试模块）。
5. **Server**：一接口一文件；改路由文件后必须 `bun run routes`；不要手改 `src/router.ts`；`@/` 指向 `apps/server/src/`；响应统一 `success`/`error`；`conf` 只在 `src/utils/conf/index.ts` 初始化。
6. **输出纪律**：只实现当前明确要求的内容，不主动扩展；按阶段推进，做完当前阶段停。
7. **验证要求**：按改动执行 `bun run typecheck`、`bun run build`，如实说明验证结果，不把编译通过当成功能验证。

### 6.2 脚手架建设边界
| 脚手架 | 可放 | 不可放 |
| --- | --- | --- |
| `packages/nodeScaffold` | 共享 Vite 配置、`nodeSkeleton`、`useNode`、`nodeTools`、`useNodeInputs`、`nodeEvent`、`values`、`workspaceFiles`、`nodeAi`、`nodeFfmpeg` | 业务提示词、预设、插件专属交互；跨插件共享组件（应进 `nodeShared`） |
| `packages/nodeShared` | `promptInput`、`referenceItem`/`referenceCard`、`mediaHistory`、`mediaPrice`、`nodeError`、`groupNodeModels`、`useNodeReferences`、`useNodeGeneration`、`showNodeError` | 需要独立构建成节点的入口；脚手架级宿主接口 |
| `packages/toolScaffold` | `createToolConfig`、`ToolPlugin` 类型、`loadToolComponent`、Pi SDK 注入、共享 Zod | 业务工具实现；跳过 `validateConfig` 的配置读取 |
| `packages/extScaffold` | `createExtConfig`、`ExtDefinition`、`ExtContext`、`bun packages/extScaffold/create.ts <名>` 生成器 | 导入 `apps/web/src`；绕过 `context.updateText` 直写文件 |
| `packages/teamScaffold` | `createTeamConfig`、manifest 校验、打包、`/a2a` 路由与客户端 | 模型密钥、监听端口、自带 SDK 运行时 |

### 6.3 对方案设计的直接约束
 - 不给 `「双花括号 ref 占位符」` 编号增加写入型 nodeTools 之前，任何"声明式接线"最终仍要通过 `connectNodes` 落地——**所以校验必须在接线之后、生成之前执行**（`setPrompt` 或独立 guard 函数）。
- 任何"计划文件"必须是工作区内的普通文件（如 `plan/*.json`），受 `resolveWorkspacePath` + `writeAtomic` 约束；不得改画布 JSON。
- 校验失败必须**抛出中文错误**（与 `videoGenerationNode` 的风格一致），由 Agent 读取后修正，而不是静默跳过。
- 新增工具包必须自带 `readme.md`（构建期嵌入）、`package.json.version`（须非空），且 `configRules` 为纯 JSON。

---

## 7. 建议的插槽组合（供下游方案设计直接引用）

| 目标能力 | 推荐插槽 | 说明 |
| --- | --- | --- |
| 资产编号与计划结构化 | **S3 tool**（如 `packages/tools/planOperator/`）+ 工作区 `plan/storyboardPlan.json` | 工具负责 `create/read/validate`，Zod schema 固化 `assets[] / segments[] / shots[] / referenceBindings[]`；文件名小驼峰、目录小驼峰 |
| 声明式参考接线 | **S3 tool** 输出"期望接线清单" + **S5 nodeTools** 在目标节点侧核对 | 工具不下发 `connectNodes`（权限过大），由 Agent 执行接线；guard 在 `setPrompt`/生成函数内比对期望与实际（入边 + `referenceOrder`） |
 | 程序化硬校验 | **S5 nodeTools guard** 为主，**S3 tool 的 `validate` action** 为辅 | 规则：编号唯一、目标存在、backwards-only、`「双花括号 ref 占位符」` 与 `refList` 一一对应、引用节点 `value !== undefined`、模式与素材数量匹配（复用现有 `matchingModes`） |
| 分镜头 → 视频节点映射 | **S1 skill** 约定命名与字段 + **S3 tool** 存映射表 `{ segmentId → nodeId }` | 增加"重生成"定位能力：按 `segmentId` 找到节点再调 `node:generateVideo` |
| 审阅面板 | **S6 ext**（`resourceKind: "canvasNode"`）或 `packages/ext/<名>` 的 `file` 扩展 | 只读展示 + 导出，不承担校验权威 |
| 多人协作分工 | **S2 team**（可选） | 若引入，成员 `tools` 白名单须显式列出 `nodeTools`/`connectNodes`，并声明"不得并发改同一画布" |

**分期建议（仅记录，不在本任务执行）**：
- 第一期：S1 skill（接线契约文档）+ S3 tool 的只读 `validate`（零风险、可回滚，不装即失效）。
- 第二期：S5 guard 接入 `setPrompt`/生成函数（需改节点源码，须单独授权与 `bun run dev:plugins` 验证）。
- 第三期：S3 tool 写入型 action（`create/update` 计划）+ S6 审阅面板。
- 回滚：所有新增物均为独立包/目录，卸载即回到现状；产物位置 `build/tools`、`data/tools`、`build/ext`、`data/ext`、`data/skills`、`data/agents`，互不影响既有节点与画布。

---

## 8. 证据索引（关键文件）

- 节点契约：`packages/nodeScaffold/readme.md`（L190–234 nodeTools、L363–377 引用读取、L259–292 连接校验）、`packages/nodeScaffold/src/nodeTools.ts`、`packages/nodeShared/src/useNodeReferences.ts`
- 生成节点：`packages/nodes/videoGenerationNode/src/index.vue`（L209–237 引用→请求、L308–338 生成、L380–451 nodeTools）、`packages/nodes/imageGenerationNode/src/index.vue`
- 画布工具：`packages/tools/canvas/src/runtime.ts`、`packages/tools/canvas/readme.md`
- 技能加载与优先规则：`apps/server/src/agent/skills/index.ts`、`apps/server/src/utils/skills/files.ts`、`packages/tools/skillOperator/readme.md`
- 团队：`packages/teams/storyboardTeam/{team.json,readme.md}`、`packages/teamScaffold/readme.md`、`apps/server/src/agent/teams/index.ts`、`apps/server/src/utils/teams/files.ts`
- 扩展：`packages/extScaffold/readme.md`、`packages/ext/canvasNode/`
- 工作流技能里的接线现状：`packages/skills/canvas/references/videoProduction.md` 第 3 节（L55–71）
- MCP：`packages/mcp/README.md`、`packages/mcp/src/index.ts`、`apps/server/src/utils/mcp/operations.ts`
- 媒体：`packages/providers/src/media/freevideo.ts`、`apps/server/src/routes/ai/media/generate.ts`
