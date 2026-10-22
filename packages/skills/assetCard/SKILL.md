---
name: assetCard
description: LocalStoryCanvas 资产卡与多轨制作约定。把角色/场景/道具/关键帧固定为带编号的资产卡、把分镜稿统一接入多轨工程文件，供 FreeVideo（MiniMax-H3）逐分镜生成与确定性校验使用。用户要求复用 LSC 制作流程、前期统一确定资产与分镜、接入多轨或批量生成分镜时使用；只做画布节点操作、只改单张提示词或只做剧本创作时不使用本技能。
metadata:
  version: "1.0.1"
  displayName: 资产卡与多轨制作约定
  author: Toonflow
  github: https://github.com/HBAI-Ltd/Toonflow-app
---

# 资产卡与多轨制作约定

本技能只提供**契约与模板**：资产卡语法、参考接线规则、多轨工程文件格式。它不执行生成、不操作画布、不改写其他技能已确认的内容。

分工边界：

| 技能 | 负责 |
|---|---|
| `workflow` | 剧本创作、资产设计判断、Seedance 分段提示词 |
| `canvas` | 画布增删改连、节点函数调用 |
| 画布多轨节点的 agent 操作 | 走 `canvas` 技能调用 `remote-multitrackNode` 的 15 个 `node:` 函数（13 个自注册 + 2 个引用函数），语义与纪律见 [生成 SOP runbook](references/generationRunbook.md) 的「对话 Agent 直接操作画布多轨节点」节 |
| **`assetCard`（本技能）** | 资产卡编号、参考关系解析、多轨工程契约、校验规则 |

## 何时读取哪份参考资料

| 要做的事 | 读取 |
|---|---|
| 建立或维护资产卡（`assets/assetCards.md`） | [资产卡模板](references/assetCardTemplate.md) |
| 声明参考关系、解析接线、判断是否允许接线 | [参考接线解析规则](references/referenceResolution.md) |
| 把分镜稿接入多轨、写或改 `story.mtrack` | [多轨工程模板](references/multitrackTemplate.md) |
| 逐分镜生成、批量派工与取消、装配分层 | [逐分镜生成 SOP](references/generationRunbook.md)（§一～§十七） |
| 用对话直接操作画布多轨节点（`remote-multitrackNode` 的 15 个 `node:` 函数，13 个自注册 + 2 个引用函数） | [逐分镜生成 SOP](references/generationRunbook.md) 的「对话 Agent 直接操作画布多轨节点」节（§十五·五） |
| 整理本镜提示词（模型整理草稿 + 人工核对采用） | [逐分镜生成 SOP](references/generationRunbook.md) §15.8 |
| 生成前出校验报告 | 使用 `planOperator` 工具的 `validate` |

## 核心约定（四条）

1. **编号唯一**：资产卡 ID 全工作区唯一，重复即拒收，不静默合并。编号是资产的稳定身份，不随节点改名、移动、画布切换而改变。
2. **参考必须显式**：接线由卡片上的显式字段决定，Agent 不自行猜测；没有声明就不接线。
3. **多轨是唯一真源**：分镜与生成状态只写 `plan/story.mtrack`；画布节点只是执行载体，`canvas` JSON 不存业务语义。
4. **生成前必须校验**：任何生成动作前先用 `planOperator` 的 `validate`；有 error 级发现就停下修契约，不带着错误生成。

## 产物与位置

```text
<workspace>/
├── assets/assetCards.md          # 资产唯一真源
├── plan/
│   ├── script.md                 # 剧本（本次范围）
│   ├── storyboard.md             # 分镜稿
│   ├── assetIndex.json           # 资产索引（由 planOperator build 产出）
│   ├── story.mtrack              # ★ 多轨工程，唯一真源（JSON 内容，自定义扩展名）
│   └── assetReport.json          # 校验报告（只读产物）
└── assets/<nodeId>/              # 节点生成落点，协议不写这里
```

## 生成闭环（简版）

1. 资产卡定稿 → 编号、参考关系、画幅全部锁定；
2. 分镜定稿 → 每段按 MiniMax H3 官方 ref2va 六段写清提示词（参考写 `<Picture N>`，图片从 1 编号；音频/视频各写 `<Audio N>`/`<Video N>`）与参考编号；
3. 导入多轨 → 生成/更新 `story.mtrack`；
4. 校验 → `planOperator validate`，error 清零才继续；
5. 逐分镜生成 → 二选一（同一批镜头绝不同时执行，见 [runbook §十五·五](references/generationRunbook.md)）：会话内按 §十三 SOP 逐镜（即每段一个视频节点、展示方案并等待用户批准算力消耗后 `node:generateVideo`），或 `node:dispatchGenerate` 后台派工（立即返回 batchId，进度看 `node:getStatus` / `mtrackRead`）；
6. 回写状态 → `generated` 不等于交付完成，用户验收后才 `accepted`；
7. 合成 → `planOperator composite` 只拼接 `accepted` 段，顺序连续无空洞（V14），写 `plan/composite.json`；`execute=true` 才真正执行 concat（需要宿主 ffmpeg，输出默认 `plan/composite.mp4`，不覆盖已存在文件）。执行前会逐段 ffprobe 实测尺寸/帧率/像素格式/音轨参数，与首段不一致直接报错——concat 滤镜要求全段一致，帧率或音轨不一致时 ffmpeg 会静默产出错乱成片。

### 三条生成路径对照（同一批镜头只走一条）

第 5 步的「二选一」实际有三条路径（界面按钮、`node:dispatchGenerate`、`planOperator dispatch` + §十三），执行者只有两个：编辑器自己，或对话 Agent。认清入口再动手：

| 入口 | 谁执行 | 返回 / 进度怎么看 | 互斥规则 |
|---|---|---|---|
| 多轨界面「生成选中段」「批量生成…」（`dispatchBar.vue`、`batchPanel.vue`） | 编辑器自己经画布 `nodeTools` 逐镜生成（`packages/nodeShared/src/mtrack/directDispatch.ts` 的 `beginDirectDispatch`），**不经对话模型** | 界面提示「批次 <前 8 位>」；进度看轨道与右侧状态栏，状态随每次变化写回 `story.mtrack`（800ms 防抖） | 与下一行是**同一实现**（共用 `launchDispatch`）：同一批镜头只能由一方发起，界面已在跑就不要再调 `node:dispatchGenerate` |
| 对话里调画布多轨节点的 `node:dispatchGenerate` | 同上，编辑器执行（UI 按钮的等价物） | `{ batchId, skipped }` 立即返回；进度看 `node:getStatus.batchClipIds` 或 `planOperator mtrackRead` 的 `attempts`；停止用 `node:cancelBatch` | 同上；已按 §十三 逐镜在跑时不要调它，否则同一批镜头双份算力 |
| 对话里 `planOperator dispatch` + [runbook §十三](references/generationRunbook.md) 逐镜 SOP | Agent 自己按 §一 的 11 步逐镜建节点、接线、下发配置、生成、回写 | `dispatch` 只返回逐镜清单（`clips[]`），**不生成、不写工程**；生成结果由 Agent 用 `mtrackUpdate` 回写 | 与上面两行**二选一**：本会话在按 §十三 逐镜跑，同一批镜头就不要再点界面按钮或调 `node:dispatchGenerate`；混用会双份算力、双重回写 |

跨路径共用同一套判据：批次号写在 `attempts[].error` 的 `batch:<uuid>` 里，`planOperator mtrackRead` 与 `node:getStatus` 都能读回同一批次。

### 整理本镜提示词（模型整理草稿 → 人工采用）

单镜编辑器的「整理本镜提示词」按钮（`packages/nodeShared/src/mtrack/components/clipEditor.vue` → `multitrackEditor.vue` 的 `rewriteClipPrompt` → `POST /api/mtrack/rewriteShot`）走文本模型，只把本镜草稿整理成画面描述段。四条纪律（细节与接口字段见 [runbook §15.8](references/generationRunbook.md)）：

- **结果不自动采用**：整理稿先落「待采用」区块（左原文只读、右整理稿可编辑），点「采用整理结果」才写回 `prompt.integratedMultimodalDescription`；点「放弃」原文一字不动。任何路径都不自动覆盖，接口返回的 `requiresReview: true` 就是「这是草稿」的契约信号。
- **一致性守卫**：待采用期间原文画面描述、`clip.seconds`、本次整理规则任一变化，「采用」禁用，必须重新整理，不能拿旧稿套新基线。
- **规则可留空**：请求字段 `rules` 可选（≤20000），空/缺省用服务端内置规则；规则只对本次整理生效，不落盘、不随工程保存——不是全片设置。
- **生成中拒绝**：本镜或本批任一镜头 `status === "generating"` 时服务端 409「正在生成，请结束后再整理提示词，避免模型同时占显存」；整理不产生 `attempts`、不占 `batchId`、不改 `status`。
- 采用后仍要按 runbook §四 核对整理稿里的官方 `<Picture N>` 与本镜图片参考的顺序（`<Picture 1>` 是本镜第 1 张图，音频/视频另算 `<Audio N>`/`<Video N>`）；旧工程里残留的 `{{ref N}}` 只是画布 mention chip 与旧格式全局占位，引擎读入时按类型换算归一化为官方标记，不作为新写法。整理只做结构化改写，不新增剧情、人物、道具。

## 能力边界（必须如实告知）

走供应商 HTTP 时，LocalStoryCanvas 依赖本地 ComfyUI 的能力**不可用**，不得假装等价：

| LSC 能力 | 本仓库状态 | 替代 |
|---|---|---|
| VAE identity 注入 | ❌ 无 | 多图参考 + 强约束文案 |
| 原生 context latent 续接 | ❌ 无 | `firstFrame` 首帧续接（上一镜末帧） |
| 调度器 / LoRA / 二采 denoise | ❌ 不可控 | 不提供 |
| 时间线设置（`timeline-settings`：本机 LoRA 目录 + 内置规则文本） | ❌ 无等价物，也**不需要** | 我们走供应商 HTTP，没有「本机 LoRA 目录」这回事，LSC 那份设置页对我们不适用；整理规则按次传入 `rewriteShot.rules`（留空用内置），不做全片持久设置 |

降级项由本表列出；`validate` 当前**不**输出 `capabilityDegraded` 字段（返回只有 `errors`/`warnings`/`findings`，见 `packages/tools/planOperator/src/index.ts:208-218`），所以这些边界必须由本节主动告知用户。
