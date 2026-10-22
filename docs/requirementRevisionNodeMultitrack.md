# 需求修订：以「Agent 引导 + 画布节点执行 + 多轨」为主流程

> 用户明确的主流程（2026-10-19 第二次补充，比原需求更具体）：
>
> 1. 用户把故事给 Agent 对话；
> 2. Agent 前期引导制作**符合格式规范的资产稿与分镜稿**，与用户确认；
> 3. 确认没问题 → 开始**构建画布资产节点**；参考衍生的资产需要有**对应的参考连线**；
> 4. 与用户沟通调整画布资产节点 → 没问题后**开始生成资产**；
> 5. 所有资产生成校验 + 与用户沟通确认；
> 6. 确认后**将所有资产接入多轨**；
> 7. 多轨后**用户可以直接在多轨进行视频连续生成**，也可以跟 Agent 会话处理。

本文记录这条流程对既有方案的修订。

---

## 一、这条流程改变/确认了什么

### 1.1 得到确认的设计

| 环节 | 与既有方案一致？ |
|---|---|
| 资产稿先定稿再建节点 | ✅ `assetCardWorkflowPlan` P0/P1 正是如此 |
| 参考关系落成真实连线 | ✅ K2 声明式接线 |
| 资产先生成再供视频用 | ✅ V13「参考必须已出图」 |
| 分镜接入多轨工程 | ✅ `story.mtrack`（自定义 mtrack 后缀） |

### 1.2 被推翻的容器决策（重点）

原方案把多轨界面做成 **`resourceKind: "file"` 的文档扩展**，理由是「编辑工程文件」。但流程第 7 步要求**用户在多轨里直接连续生成视频**，而这是文档扩展做不到的：

| 能力 | 文档扩展（`ext-multitrack`） | 画布节点插件（`node-multitrack`） |
|---|---|---|
| 读写 `story.mtrack` | ✅ `context.files` | ✅ `files.getWorkspaceFiles()` |
| 调 `node:setConfig` / `node:setPrompt` | ❌ 无此上下文 | ✅ 自身就是节点 |
| 调 `node:generateVideo` 生成 | ❌ **不能** | ✅ `ai.generateVideo()` |
| 调 `mountNode` 预览其他节点 | ✅ | ✅ |
| 连边 / 读 `referenceOrder` | ❌ | ✅ |
| 调整画布布局 | ❌ | ✅ 作为节点存在画布上 |

结论：**多轨必须是画布节点插件，不是文档扩展。**

---

## 二、为什么必须由节点直接调 `ai.generateVideo()`

流程第 7 步的语义是「用户在多轨上点生成」。此时没有任何 Agent 参与（用户明确说「也可以跟 agent 会话处理」是两条并列路径，多轨自身要能独立生成）。

多轨节点是唯一同时具备三项能力的容器：
1. `ai.generateVideo(input, signal)` —— 发起媒体生成并落盘（`nodeScaffold/readme.md:186`）；
2. `files.getWorkspaceFiles()` —— 读写 `story.mtrack`；
3. `nodeTools.register` —— 反过来向 Agent 暴露「添加分镜 / 生成该段 / 查询进度」。

也就是说：**同一份多轨工程，用户从画布点、Agent 从会话调，走同一个节点、同一份文件、同一套状态机。** 这正是用户说的「也可以跟 agent 会话处理」。

---

## 三、修订后的完整分工

| 层 | 容器 | 职责 | 实现方式 |
|---|---|---|---|
| 契约层 | skill `packages/skills/assetCard` | 资产卡语法、接线规则、多轨契约、生成 SOP | 纯 Markdown（M0/M3 已完成） |
| 校验层 | tool `packages/tools/planOperator` | V1–V15 校验、`assetIndex.json` / `assetReport.json` | `context.files` + 纯函数（M1） |
| **多轨层** | **node `packages/nodes/multitrackNode`** | 多轨工程编辑 + 逐分镜生成 + 状态回写 + 向 Agent 暴露函数 | `ai.generateVideo` + `files`（**取代原 M2 的 ext 方案**） |
| 资产层 | 现成 `imageGenerationNode` × N | 每个资产一张图，参考关系用连边表达 | 无需新插件 |
| 视频层 | 现成 `videoGenerationNode` × N | 逐分镜生成（Agent 路径） | 无需新插件 |

### 3.1 关键取舍：多轨自己生成，还是调 videoGenerationNode？

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 多轨节点自己调 `ai.generateVideo`** | 用户点一下就能生成，无需 Agent；单进程内完成 | 绕开 videoGenerationNode 的 `mode` 匹配与 `referenceOrder` 校验 |
| B. 多轨节点逐个创建并驱动 videoGenerationNode | 完全复用既有校验 | 画布上瞬间多出几十个节点，布局灾难；用户点一次要等一串连线 |
| C. 多轨节点调 `context.canvas` 让 Agent 建 | —— | 同上，且引入 Agent 依赖 |

**选 A**，把 A 绕开的校验**搬到多轨节点内部与 `planOperator` 里**：
- `referenceIds` 顺序即 `{{ref N}}`，由多轨节点在拼 prompt 时按数组顺序注入，并**在编辑器里显示序号**（人眼可核对）；
- `mode` 由 `ai.getMediaModels()` 返回的能力自行判定（`getMatchingModes` 的逻辑在多轨节点内重实现：按参考集合算出可用模式，**空镜或超 4 图时直接拒绝并提示拆分**）；
- V1–V15 仍由 `planOperator` 在生成前校验，多轨节点生成前调用同一套规则（经 `packages/nodeShared` 共享，避免两处实现漂移）。

> 这样 Agent 路径（驱动 videoGenerationNode）与用户路径（多轨节点直接生成）共享同一份契约与同一套校验，只是入口不同。

---

## 四、修订后的分期

| 期 | 内容 | 说明 |
|---|---|---|
| M0 | skill 契约 | ✅ 已完成（`packages/skills/assetCard`，4 个文件） |
| M1 | tool `planOperator`：V1–V15 校验 | 🔄 进行中（不含 `dispatch` action——生成逻辑移到多轨节点） |
| **M2（改）** | **node `packages/nodes/multitrackNode`** | 原「ext-multitrack」撤销；改为画布节点：多轨编辑 + `ai.generateVideo` + 状态回写 + `nodeTools` 暴露给 Agent |
| M3 | skill 生成 SOP | 改为「Agent 路径」：引导 → 建资产节点 → 接线 → 生成资产 → 校验 → 接入多轨 → 逐分镜（Agent 走 videoGenerationNode） |
| M4 | 质量审阅 + 合成导出 | 合成仍走工具 `context.ffmpeg` 或视频节点 `useNodeFfmpeg` |

### 4.1 M2 新增为节点后必须处理的清单

1. **端口**：`target` 接收上游资产图片（可选，用于整段共享参考）；`source` 输出当前选中片段的视频。
2. **节点函数**（`nodeTools.register`）：`addClip`、`updateClip`、`removeClip`、`reorderClips`、`generateClip`、`getProgress`、`validatePlan`、`exportCompositeList`。
3. **生成参数**：`ai.getMediaModels()` 选 `freevideo` / `MiniMax-H3`；时长取 2–60 整数；`resolution` 768P/2K；`generateAudio`；`mode` 自行判定。
4. **参考上限**：图 ≤4、视频 ≤1、音频 ≤1；超限**拒绝生成**并提示拆段，不静默降级为首尾帧。
5. **状态机**：`pending/generating/generated/accepted/failed`，写回 `story.mtrack`；`attempts` 只追加；写入前读原件并比对 `updatedAt`。
6. **进度**：生成是异步的，节点要能显示「该镜生成中」并在完成后落盘；用户关页面再打开要能从文件恢复状态。
7. **`context.media` 与节点的区别**：节点侧用 `ai.generateVideo`（`useNode()` 的 `ai`），不是工具的 `context.media`——两者最终都走同一后端，但节点版自带取消与状态。

---

## 五、需要用户确认的两点

1. **多轨做成画布节点**（撤销原扩展方案）：这样「用户在多轨直接连续生成」才成立。代价是多轨不再是「独立大面板」，而是画布上的一个节点（可放大、可全屏预览）。
2. **多轨自己调 `ai.generateVideo`**，不逐个驱动 videoGenerationNode。代价是放弃 videoGenerationNode 现成的模式匹配，改由多轨节点 + `planOperator` 内部实现同等校验。

> 如果你更希望「多轨是大面板，视频仍在独立视频节点上」，那就是另一条路：多轨扩展负责编辑，Agent/工具负责逐镜建 videoGenerationNode。此时「用户直接在多轨生成」要变成「用户在多轨点一下，由工具/Agent 代为驱动」，需要画布保持连接。
