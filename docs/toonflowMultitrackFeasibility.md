# Toonflow 多轨容器可行性验证

> 任务：t6（[toonflowStudy] 重试版）。调研对象 `C:\workspace\super-ai\Toonflow-app`。
> 说明：原任务由 targetAnalyst 执行，因模型侧 429 连续三次中断，改由 captain 直接完成并落盘；结论均为**读取仓库源码后的实测事实**，非推测。
> 目标需求：**前期确定资产与分镜格式 → 统一接入多轨 → 多轨里逐个分镜用 FreeVideo 生成**。

---

## 0. 结论速览

| 问题 | 结论 | 依据 |
|---|---|---|
| 多轨界面能否做成扩展？ | **能**，但只能是「编辑 + 状态展示」，**不能调节点** | `packages/extScaffold/src/runtime.ts:23-40` |
| 扩展能否承载多轨工程文件？ | **能**，`resourceKind: "file"` + `files` 全套读写 | `ExtFiles` 接口 13 个方法 |
| 扩展能否触发 FFmpeg 合成？ | **不能直接**：`/api/ffmpeg/execute` 需要 `assertAppRequest` 鉴权，扩展没有该通道 | `apps/server/src/routes/ffmpeg/execute.ts:31` |
| 逐分镜生成由谁执行？ | **Agent 或工具层**，经画布工具 + `nodeTools` | `packages/tools/canvas/src/runtime.ts:56-93` |
| 节点是否够用？ | **够用**，视频节点已注册完整可控面，无需改节点源码 | `videoGenerationNode/src/index.vue:380-455` |
| FreeVideo 模式与时长？ | 2–60 秒逐秒、768P/2K、`text` / `startFrameOptional` / 四参考组合 | `freevideo.ts:194-202` |
| 合成能否实现？ | **能**，两条例：节点内 `useNodeFfmpeg()`；或工具层 `ffmpeg` 工具 | `nodeScaffold/readme.md:111-143`、`packages/tools/ffmpeg/readme.md` |

**一句话**：多轨可以做成一等的**编辑器**（扩展），但必须把「生成」和「合成」交给 Agent/工具层的**执行器**，扩展只负责编辑工程文件与回显状态。

---

## 1. 扩展能力边界（决定性约束）

`packages/extScaffold/src/runtime.ts` 的 `ExtContext`：

```ts
export interface ExtContext {
  resource: ExtResource;      // file: {directory,path,label} | canvasNode: {..., nodeId}
  files: ExtFiles;            // list/read/readText/readJson/write/writeJson/acquireUrl/rename/copy/reveal/remove/mkdir
  text: string; loading: boolean; error: string; dirty: boolean; active: boolean;
  config: Record<string, unknown>; saveConfig: (config) => Promise<void>;
  updateText: (text) => void; flushSave: () => Promise<void>;
  writeClipboardText; openFile; location?;
  mountNode?: (element: HTMLElement) => Promise<() => void>;
}
```

**能做**：
- 读写工作区内任意文件（含 `plan/*.json`、`assets/assetCards.md`），有 `acquireUrl` 可直接预览图片/视频；
- 自绘任意界面（Vue 3 + Element Plus 通过与扩展共用的 `window.toonflowExtHost`）；
- `mountNode(element)` 把**某个节点的既有视图**嵌进面板（只读复用，不能改其 data）。

**不能做**：
- 拿不到节点 `data`（`canvasNode` 扩展的 `resource` 只有 `nodeId`/`label`/`path`）；
- 不能调用 `connectNodes` / `addNode` / `nodeTools`（这些只在 `packages/tools/canvas` 的 Agent 工具里）；
- 不能直接 POST `/api/ffmpeg/execute`：该路由首行即 `u.mcpControl.assertAppRequest(req)`，扩展侧没有携带该凭据的通道。

> **设计后果**：多轨扩展是「编辑器 + 看板」，生成/合成必须由 Agent（读多轨 JSON → 建节点/接线/生成）或新增工具（读多轨 JSON → 校验/派工）完成。

---

## 2. 文件扩展作为多轨工程宿主

`apps/web/src/pages/workspace/panels/document/extensions.ts` 的 `setExtensionAssociation`：
- `resourceKind === "file"` 的扩展按**文件后缀**关联（`extension.extensions.includes(suffix)`）；
- 用户可在文档面板选择「用哪个扩展打开该后缀」，选择结果存进 `settings.documentExtensions`；
- 后缀空数组仅对 `canvasNode` 合法（`runtime.ts:64`：`file` 类型必须至少一个后缀）。

**结论（M2 实现后修订）**：多轨工程用**自定义单段后缀** `.mtrack` 绑定，无需占用 `.json` 的默认打开方式（`.json` 可继续用原文视图）。原 `.mtrack.json` 写法**不可行**：宿主取后缀用 `path.split(".").at(-1)`，`story.mtrack.json` 的后缀被识别为 `json`，会与工作区所有 `.json` 文件撞关联；且 `defineExt`（`packages/extScaffold/src/runtime.ts:63`）要求后缀匹配 `/^[a-z0-9]+$/`（不带点），`"mtrack.json"` 构建期直接报错。因此工程文件定为 `plan/story.mtrack`（内容仍是 JSON），`extensions: ["mtrack"]`。

---

## 3. 画布工具与节点函数（执行层）

`packages/tools/canvas/src/runtime.ts` 注册的 Agent 工具（节选）：

| 工具 | 作用 | 约束 |
|---|---|---|
| `addNode` | 新增节点 | `type` 必须来自 `getCanvas({include:["nodeTypes"]})`；`label` 1–200 字符 |
| `connectNodes` | 批量接线 | 一次多组，需真实 `sourceHandle`/`targetHandle` |
| `renameNodes` | 批量改名 | 用于「场01·片段01·视频」这类映射标签 |
| `deleteNodes` | 批量删除 | 最多 64 个 |
| `nodeTools` | 调用节点函数 | `name` 为 `node:xxx` |

视频节点注册的函数（`videoGenerationNode/src/index.vue`）：

| 函数 | 用途 | 关键参数 |
|---|---|---|
| `node:getConfig` | 读当前配置与可用模式 | 无 |
| `node:setConfig` | 改模型/时长/分辨率/比例/模式/声音 | `duration` 必须在 `durationResolutionMap` 内；`mode` 必须匹配当前引用 |
 | `node:setPrompt` | 写提示词（支持 `「双花括号 ref 占位符」`） | `prompt` |
| `node:generateVideo` | 启动后台生成 | 无；立即返回，用 `getGenerationStatus` 查 |

**结论**：每分镜的完整控制链 = `addNode` → `connectNodes` → `setConfig` → `setPrompt` → `generateVideo`，全部现成。

---

## 4. FreeVideo 供应商现状

`packages/providers/src/media/freevideo.ts:194-211`：

```ts
{ id: "MiniMax-H3", type: "video",
  mode: ["text", "startFrameOptional", ["imageReference:4", "videoReference:1", "audioReference:1"]],
  audio: "optional",
  durationResolutionMap: [{ duration: [2..60 逐秒], resolution: ["768P", "2K"] }] }
{ id: "freevideo-image", type: "image",
  mode: ["text", "singleImage", "multiReference"],
  imageSizes: ["1K", "2K"], imageRatios: ["1:1","16:9","9:16","4:3","3:4"] }
```

- 端点：`POST {agent}/media`、`POST {agent}/jobs`、`GET {agent}/jobs/{id}?wait=25`，结果按 origin 下载；
- `getPrice()` 返回「免费 · 本机 GPU 生成，无计费」；
- **git 状态为 `A`（未提交）**：整条链路依赖它落定，这是方案的前置条件。

**影响契约的硬约束**：`imageReference:4` 意味着一段最多 4 张图参考；超过 4 张参考或混入视频/音频时，节点会被逼到 `startFrameOptional`（只吃 2 张图，且按顺序变首/尾帧）。多轨契约必须**在编辑器层就限制参考数**，不能留给生成时失败。

---

## 5. 合成链路

| 路径 | 可用性 | 说明 |
|---|---|---|
| 节点内 `useNodeFfmpeg()` | ✅ | `nodeScaffold/readme.md:111-143`，链式调用经 `/api/ffmpeg/execute`，支持 `concat` |
| Agent 的 `ffmpeg` 工具 | ✅ | `packages/tools/ffmpeg/readme.md`，`steps` + `operation`（含原生 `concat`） |
| 扩展直接调 | ❌ | 鉴权不通过，见 §1 |

**结论**：合成做成「节点或工具的一个动作」，不放进扩展。

---

## 6. 三条落地方案对比

| 方案 | 界面 | 生成 | 合成 | 改动 | 评价 |
|---|---|---|---|---|---|
| **(A) 扩展编辑器 + 工具执行器** | 扩展 `ext-multitrack`（`resourceKind:file`） | 工具/Agent 读多轨 JSON 执行 | 工具 | 三个新包（skill + tool + ext） | **推荐**：最接近 LSC 观感，扩展只碰文件，职责干净 |
| (B) 纯技能 + 工具（无界面） | 无（JSON/文本节点） | 同上 | 同上 | 两个新包 | 最快落地，但失去「多轨界面」这一明确要求 |
| (C) 新画布节点插件 | 节点内嵌多轨 | 节点自身调 `ai.generateVideo` | 节点内 ffmpeg | 一个重包，需自研生成/价格/状态/参考排序全部逻辑 | **不选**：与现成 `videoGenerationNode` 重复造轮子 |

**推荐 A**，且明确分工：

- **扩展**（`ext-multitrack`）：轨道/片段渲染、增删排序、每镜头三字段提示词、参考顺序展示、校验结果展示、`mountNode` 预览已生成视频；写回多轨 JSON。
- **工具**（`planOperator` 扩展或新增 action）：读多轨 JSON → 校验（V1–V14）→ 输出派工单（每镜头该建哪个节点、接哪些边、什么参数）。
- **执行**：Agent/工具按派工单调 `addNode`/`connectNodes`/`setConfig`/`setPrompt`/`generateVideo`，回写状态。
- **合成**：工具调 ffmpeg 按 `segmentMap` 顺序 concat。

---

## 7. 待验证清单（方案假设 → 需实测）

1. 扩展插件里 `mountNode` 对**视频生成节点**的实际可用性（当前只有 `ext/canvasNode` 用它做过只读展示）。
2. `freevideo.ts` 提交后，`getMatchingModes` 在「4 图参考」与「3 图 + 1 视频」两种集合下的真实模式取值。
3. 长任务（2–60 秒视频）在节点侧的完成通知与 `getGenerationStatus` 的实际刷新行为。
4. 多轨扩展加载后，文档面板是否能稳定记住 `.mtrack` 的扩展关联（`documentExtensions` 持久化）。
5. 合成 concat 时不同分辨率/帧率的片段是否需要先统一转码（LSC 侧由 ComfyUI 固定输出规格规避了这个问题）。
