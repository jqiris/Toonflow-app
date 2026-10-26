# 多轨界面 → agent 执行桥契约（需求冻结稿）

> 状态：**冻结**。本文是多轨界面（`packages/ext/multitrack`）「选段发起视频生成、并把请求送到 workspace agent 会话」的桥接规格。下游实现按本文落地，不含实现代码。
>
> 冻结范围：`docs/requirementMultitrackAgentBridge.md`。禁止改动 `packages/`、`apps/`。
>
> **历史设计，勿作引导**：本文是「多轨界面 → agent 执行桥」的冻结需求记录，**该桥接方案未实施**——实际落地为 `packages/nodeShared/src/mtrack/directDispatch.ts` 直连派工（编辑器自己经画布 `nodeTools` 逐镜生成，不经对话模型），文中提到的 `agentDispatch.ts` 并不存在。现行口径见 `packages/skills/assetCard/references/generationRunbook.md`（§十五、§十五·五）；本文仅作历史参考。
>
 > **现状更新（2026-10-25）**：下文 §5 调用序列里「`node:setPrompt` 写作者已写好的官方六段正文（含 `<Picture N>`）」**已反转**：写作者正文统一写 `「双花括号 ref 占位符」`（`N` = 本镜 `referenceIds` 位次），尖括号 `<Picture N>`/`<Video N>`/`<Audio N>` 只是 wire 层按参考 `dataType` 换算的模型侧标记，写进正文会被 V7 判 error（`packages/tools/planOperator/src/planValidator.ts` 的 V7 分支）；引擎只拼「全片风格/全片约束」前缀与漏写段名兜底，不代写六段正文。现行口径见 `generationRunbook.md` §四。

## 0. 现状链路盘点（契约的事实基础）

| 事实 | 位置 | 结论 |
|---|---|---|
| workspace 根组件提供画布上下文工厂 | `apps/web/src/pages/workspace/index.vue:189` `provide("canvas", () => canvasPanelRef.value?.getCanvasContext())` | 画布上下文以 Vue `provide/inject` 挂在 workspace 组件树 |
| 画布上下文工厂的实现 | `apps/web/src/pages/workspace/panels/canvas/index.vue:287-289`：`getCanvasContext()` 在 `canvasId` 为空时返回 `undefined` | 画布上下文**存在性随「是否已加载画布」运行时变化** |
| agent 会话组件注入该工厂 | `apps/web/src/components/agent/conversation.vue:212` `inject("canvas")`，`:637` `createCanvasContext?.()`，`:665` 请求体带 `canvas: { id, tools }` | agent 请求的 `canvas` 字段由页面层注入 |
| server 侧 `canvas` 字段定义 | `apps/server/src/routes/agent.ts:17-26`（可选 `z.strictObject({ id, tools })`） | `canvas` 可缺省；缺省时 agent 无画布工具 |
| 多轨是 `file` 资源 | `packages/ext/multitrack/src/metadata.ts` `resourceKind: "file"` | 走 document 面板，非 canvasNode |
| `mountNode` 只在 canvasNode 资源注入 | `apps/web/src/pages/workspace/panels/document/index.vue:311-314`（`resource.kind === "canvasNode"` 才传 `mountNode`） | 多轨拿不到节点挂载能力（与画布上下文无关，但说明 ExtContext 边界按资源类型裁剪） |
| ExtContext 不含任何画布能力 | `apps/web/src/pages/workspace/panels/document/documentSession.ts:29-47` 构造的 `ExtContext` 只有 `resource/files/text/error/dirty/active/loading/config/saveConfig/writeClipboardText/mountNode/openFile/updateText/flushSave`（源定义 `packages/extScaffold/src/runtime.ts:23-39`） | 多轨的 `props.context` 拿不到画布；只能靠组件内 `inject("canvas")` 或页面层代发 |
| workspace 控制通道已暴露画布工具 | `apps/web/src/pages/workspace/index.vue:198-204` `registerWorkspaceControl.getState()` 返回 `{ directory, canvasId, panel, tools, document }`，其中 `tools = getCanvasContext()?.tools ?? []` | 「页面层代为发起」可复用该控制通道取 `tools` |

## 1. 按钮位置与语义

- **入口**：多轨编辑器的轨道区（`packages/ext/multitrack/src/index.vue`）新增一个「批量生成」按钮，置于已选分镜上下文（选中态/多选态附近）。
- **选段语义**：按钮对「当前多选集合」生效；未多选时对「单选的那个 clip」生效。选段范围在请求中表示为**有序 clipId 列表**（`["S001","S003","S004"]`，按文件出现顺序，含端点），而不是只传起止号——因为多选可能是离散的。
- **前置校验（点按钮时本地做，不发请求）**：
  1. 存在选段且每个 clipId 合法；
  2. 画布可用（判定见 §2）且 `tools` 含 `node:generateVideo`；
  3. 范围内 clip 的 `status ∈ { pending, failed }` 才可发起（`generating/generated/accepted` 默认跳过，除非用户明确覆盖）。
- **请求语义**：把「选段 + 派工意图」交给 agent 会话，由 agent 执行 §4 的 nodeTools 生成路径。按钮本身**不直接调供应商**。

## 2. canvas context 可实测判定方法

### 2.1 运行时判定（浏览器 DevTools，打开多轨 tab 后执行）

在 document 面板里打开 `story.mtrack` 后，于浏览器控制台验证（等效于多轨组件作用域内的 `inject("canvas")`）：

```js
// 等价于 multitrack 组件内 inject("canvas") 得到的工厂
const getCanvas = /* 组件内 inject("canvas") */;
const ctx = getCanvas?.();
const canReach = !!(ctx && typeof ctx.id === "string" && ctx.id.length > 0 && Array.isArray(ctx.tools));
const hasNodeTools = canReach && ctx.tools.some(t => t.name === "node:generateVideo");
```

- `canReach === true` 且 `hasNodeTools === true` → 走**退路 A**（§3）。
- 否则（`canvasId` 未加载 / 画布面板未挂载 / 视频生成节点插件未启用）→ 走**退路 B**（§4）。

### 2.2 静态判定（仓库 grep 验证 provide/inject 链是否闭合）

```bash
grep -n 'provide("canvas"' apps/web/src/pages/workspace/index.vue                 # :189
grep -n 'inject.*"canvas"'      apps/web/src/components/agent/conversation.vue    # :212
grep -n 'function getCanvasContext' apps/web/src/pages/workspace/panels/canvas/index.vue  # :287
grep -n 'getCanvasContext' apps/web/src/pages/workspace/panels/canvas/canvasHost.vue      # :205-206
```

### 2.3 结论（契约口径）

**多轨界面「能拿到」canvas context 是「运行时条件成立与否」，不是「静态能力有无」**：provide 链在组件树上对 document 面板内的 ext 组件可见（Vue `provide/inject` 穿透组件层级，不受 `resourceKind` 限制），所以 `inject("canvas")` 能解析到工厂；但工厂返回值在 `canvasId` 为空时是 `undefined`。因此契约**必须同时实现两条退路**，并以上述运行时判定决定走哪条，不能假设其一永远成立。

## 3. 退路 A：多轨界面能拿到 canvas context

前置：§2.1 判定 `canReach && hasNodeTools` 为真。

1. 多轨组件通过 `inject("canvas")` 取得工厂，调用得 `{ id, tools }`，校验 `tools` 含 `node:generateVideo`、`node:setPrompt`、`node:setConfig`、`node:getGenerationStatus`、`node:cancelGeneration`（缺任一则退回退路 B 并提示用户启用视频生成节点插件）。
2. 构造 agent 请求体（与 `conversation.vue:665` 同构）并 `POST /api/agent`（headers 带 `x-toonflow-workspace: 1`）：

```
{
  prompt: "<派工指令>",
  directory, providerId, modelId, thinkingLevel,
  canvas: { id: ctx.id, tools: ctx.tools }
}
```

3. 派工指令必须包含：选段 clipId 列表、每镜的参考集合（`referenceIds` 顺序）、生成参数（`seconds/resolution/ratio/generateAudio`，`model/mode` 留待 `node:getConfig`）、当前状态；并明示「逐镜走 `nodeTools`，状态回写经 planOperator `mtrackUpdate`，可取消（batchId=`<uuid>`）」。
4. **边界声明**：多轨是 `file` 资源，其 `props.context`（ExtContext）不含画布；本路径的 `inject("canvas")` 是组件**直接绕过 ExtContext 取宿主 provide**，等于让 multitrack 插件从此依赖宿主提供 `"canvas"`。此依赖须在 multitrack 的 manifest/SKILL 里显式声明为「可选宿主能力」，宿主未提供时降级到退路 B。

## 4. 退路 B：拿不到 canvas context（页面层代为发起）

前置：§2.1 判定为假（无画布打开 / 插件未启用 / 工厂返回 undefined）。

1. **多轨不直接发 HTTP**，改为把「选段范围 + 派工上下文」通过宿主注入的回调上报到 workspace 页面层。宿主在创建 document session 时注入一个 `launchAgentGeneration(payload)` 能力（或经 `provide/inject` 提供），payload 含 `{ directory, clipIds, batchId }`。
2. 页面层（`apps/web/src/pages/workspace/index.vue`，一定在 `provide("canvas")` 之上，且能触达 `conversation.vue` 的发送逻辑）在 handler 内：
   - 经 `registerWorkspaceControl.getState().tools`（`workspace/index.vue:202`）或直接 `canvasPanelRef.value?.getCanvasContext()` 取 `{ id, tools }`；
   - 复用 conversation 的 `sendMessage` 逻辑（或抽出的公共函数）构造带 `canvas` 字段的请求体并 `POST /api/agent`。
3. **兜底再兜底**：若页面层也拿不到 `tools`（确实没打开画布/没启用视频节点插件），页面层提示「请先打开画布并启用视频生成节点插件」，**不发请求**，避免 agent 退化成「无画布工具只能空谈」。

## 5. 生成必须落 nodeTools 路径（硬约束）

无论退路 A/B，最终生成调用必须走画布节点 `nodeTools` 这条链：

```
node:getConfig        → 读当前 matchingModes / 可用 duration / resolution / ratio（不许跳过）
node:setConfig        → { providerId, modelId, duration=seconds, resolution, ratio, generateAudio, mode }
 node:setPrompt        → 写作者已写好的官方六段正文（含 「双花括号 ref 占位符」 参考标记；尖括号 <Picture N> 一类不是写作者写法，下发前由 wire 层按 dataType 换算；引擎只拼全片风格/全片约束前缀、正文原样透传，不代写任何段、不追加参考顺序声明）
node:generateVideo    → 空调用；记录提交时刻
node:getGenerationStatus → 追终态；换轮/换会话前先 getCanvasNodes({fields:["outputs"]}) 读产物
mtrackUpdate          → 回写 status/nodeId/assetPath/attempts（planOperator，走 §4 契约）
```

依据：`packages/skills/assetCard/references/generationRunbook.md` 的 SOP 只走这条（`:32-37`），且只有它能回写 `nodeId/assetPath` 供 V13/V15 核对。

**禁止**：`packages/tools/mediaGeneration` 那条绕过画布的路径。理由：它不回写 `nodeId/assetPath`，导致 `mtrack` 状态无法闭环、V13/V15 无法核对、`node:cancelGeneration` 无法取消。

**例外与代价**：仅当 clip 尚未建画布节点且用户显式要求「不落画布直接生成」时，允许 `mediaGeneration`。代价须在请求里显式声明：放弃 `nodeId/assetPath` 回写与 V13/V15 校验，且该 clip 不可走本契约的批量取消（只能等供应商侧自然结束或人工处理）。默认一律走 nodeTools。

## 6. 批量取消记账与取消后状态回写

### 6.1 触发

agent 收到取消指令（用户点取消 / 页面层转发），对 `batchId` 命中的、当前 `status === "generating"` 的每个 clip，调用其视频节点的 `node:cancelGeneration`（`packages/nodeShared/src/useNodeGeneration.ts:18`）。

### 6.2 记账方式（复用 `attempts`，不加新字段）

对每个被取消的 clip，在 `attempts` 追加一条：

```
{ at: <ISO now>, nodeId: <videoNodeId>, status: "cancelled", error: "batch:<batchId>" }
```

- **batchId 承载位置**：复用 `attempts[].error` 字段（现有可选字段，`mtrackProject.ts:20`）。派发时在对应 clip 写 `attempts.push({ at, nodeId, status: "generating", error: "batch:<batchId>" })`，取消时按 `attempts.some(a => a.error === "batch:<batchId>" && a.status === "generating")` 匹配命中集合。**零 schema 变更**——不加新顶层字段、不加 `batchId` 到 `MtrackClip`/`ClipAttempt`。
- **`attempts[].status = "cancelled"` 合法**：`ClipAttempt.status` 的类型是 `string`（`mtrackProject.ts:19`），不受 `ClipStatus` 枚举约束（该枚举只约束 `MtrackClip.status`，`mtrackProject.ts:3`）。

### 6.3 取消后 `status` 回写值

取消后 `clip.status` 回写为 **`"pending"`**。

- 理由：`ClipStatus = pending | generating | generated | accepted | failed`（`mtrackProject.ts:3`）没有 `cancelled`；「取消」语义上等价于「回到可重派」，`pending` 是唯一贴合的枚举值，且让该 clip 重新进入 §1 的可发起集合。
- **不写 `failed`**：取消不是失败，写 `failed` 会污染 V14（合成清单只含 `accepted`，虽不受 failed 直接影响）与「失败需人工介入」的语义，把可恢复的取消误判成故障。
- **竞态兜底**：若取消时该 clip 其实已生成成功（供应商侧已落产物），以 `node:getGenerationStatus` / `getCanvasNodes({fields:["outputs"]})` 读到的真实产物为准回写 `"generated"`（并补 `assetPath`），**不强行改成 `pending`**。

### 6.4 与既有状态机一致

回写只使用 `ClipStatus` 既有五值，取消通过 `attempts` 的 `"cancelled"` 记录留痕、通过 `clip.status = "pending"` 恢复可派，与 `packages/ext/multitrack/src/mtrackProject.ts:3` 的枚举零冲突；多轨编辑器渲染 `pending` 时按现有「待生成」样式展示，无需新增 UI 状态。
