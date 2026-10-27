---
name: assetCard
description: Toonflow 资产卡与多轨制作约定（自有核心流程技能，四视图资产卡与多轨契约的唯一真源）。把角色/场景/道具/关键帧固定为带编号的资产卡，由画布「导入资产与分镜」节点写入 plan/assetIndex.json 与 plan/story.mtrack，供 FreeVideo（MiniMax-H3）逐分镜生成与确定性校验使用。用户要求前期统一确定资产与分镜、接入多轨或批量生成分镜时使用；只做画布节点操作、只改单张提示词或只做剧本创作时不使用本技能。
metadata:
  version: "1.0.1"
  displayName: 资产卡与多轨制作约定
  author: Toonflow
  github: https://github.com/HBAI-Ltd/Toonflow-app
---

> **H3 口径声明**：本工作流视频生成仅支持 MiniMax-H3（H3 官方六段格式 + `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记）；不接受其他视频模型或旧格式占位符。

# 资产卡与多轨制作约定

本技能只提供**契约与模板**：资产卡语法、参考接线规则、多轨工程文件格式。它不执行生成、不操作画布、不改写其他技能已确认的内容。

分工边界：

| 技能 | 负责 |
|---|---|
| `workflow` | 剧本创作、资产设计判断、Seedance 分段提示词 |
| `canvas` | 画布增删改连、节点函数调用 |
| 画布多轨节点的 agent 操作 | 走 `canvas` 技能调用 `remote-multitrackNode` 的 16 个 `node:` 函数（14 个自注册 + 2 个引用函数），语义与纪律见 [生成 SOP runbook](references/generationRunbook.md) 的「对话 Agent 直接操作画布多轨节点」节 |
| **`assetCard`（本技能）** | 资产卡编号、参考关系解析、多轨工程契约、校验规则 |

## 何时读取哪份参考资料

| 要做的事 | 读取 |
|---|---|
| 建立或维护资产卡（`assets/assetCards.md`） | [资产卡模板](references/assetCardTemplate.md) |
| 写资产图提示词正文（角色四视图 / 场景空镜 / 道具静物） | [图片提示词规范](references/imagePrompt.md) |
| 判断资产设计维度是否到位、出图后怎么验收 | [资产设计维度与验收](references/assetDesign.md) |
| 声明参考关系、解析接线、判断是否允许接线 | [参考接线解析规则](references/referenceResolution.md) |
| 把分镜稿接入多轨、写或改 `story.mtrack` | [多轨工程模板](references/multitrackTemplate.md) |
| 逐分镜生成、批量派工与取消、装配分层 | [逐分镜生成 SOP](references/generationRunbook.md)（§一～§十七） |
| 用对话直接操作画布多轨节点（`remote-multitrackNode` 的 16 个 `node:` 函数，14 个自注册 + 2 个引用函数） | [逐分镜生成 SOP](references/generationRunbook.md) 的「对话 Agent 直接操作画布多轨节点」节（§十五·五） |
| 整理本镜提示词（模型整理草稿 + 人工核对采用） | [逐分镜生成 SOP](references/generationRunbook.md) §15.8 |
| 生成前出校验报告 | 使用 `planOperator` 工具的 `validate` |

## 核心约定（六条）

1. **编号唯一**：资产卡 ID 全工作区唯一，重复即拒收，不静默合并。编号是资产的稳定身份，不随节点改名、移动、画布切换而改变。
2. **参考必须显式**：接线由卡片上的显式字段决定，Agent 不自行猜测；没有声明就不接线。
3. **多轨是唯一真源**：分镜与生成状态只写 `plan/story.mtrack`；画布节点只是执行载体，`canvas` JSON 不存业务语义。
4. **生成前必须校验**：任何生成动作前先用 `planOperator` 的 `validate`；有 error 级发现就停下修契约，不带着错误生成。
5. **定稿即基线**：用户给的剧情、事实、台词及其标点默认锁定——新增只补必要的可见动作，不加人物、不加事件、不加对白；需要实质改编时先给可选择的修改建议。资产卡定稿后改卡编号或画幅、分镜定稿后改 `clipId` 或顺序，都等于换基线，下游（参考接线、已生成镜头）必须重新对账，不能默认旧产物还成立；局部修改只同步**受影响**的动作、时间、引用与后续状态，**不覆盖无关的已验收镜头**。
6. **角色卡只有四视图整版**：`C` 卡固定 **16:9 + 2K**，横向四栏 ①半身像（正面、腰部以上、头顶贴齐栏顶、按上半身放大、面部结构清晰）②正面全身 ③90° 侧面全身 ④背面全身；②③④ 共用同一全身比例尺、按脚底线对齐、头顶自然等高，① **不参与**这套比例尺、**不按肩线或脚底线**去对齐别人，也不许被拉成全身；「三视图」「单视图」「特写＋完整三视图」一律作废，不许为了省尺寸降级成单张。改栏序或画幅同样等于换基线（见第 5 条）。细则见 [资产设计维度 §3.1](references/assetDesign.md) 与 [图片提示词 §5.1](references/imagePrompt.md)。

## 产物与位置

```text
<workspace>/
├── assets/assetCards.md          # 资产唯一真源
├── plan/
│   ├── script.md                 # 剧本（本次范围）
│   ├── storyboard.md             # 分镜稿
│   ├── assetIndex.json           # 资产索引（画布「导入资产与分镜」节点独占写入；planOperator 也会写同名文件）
│   ├── story.mtrack              # ★ 多轨工程，唯一真源（JSON 内容，自定义扩展名）
│   └── assetReport.json          # 校验报告（只读产物）
└── assets/<nodeId>/              # 节点生成落点，协议不写这里
```

Agent 侧阶段门与逐镜操作顺序见 `freevideoMultitrack` 技能；数据契约仍以本链路 runbook/模板为准。

## 生成闭环（简版）

1. 资产卡定稿 → 编号、参考关系、画幅全部锁定（`C` 卡一律 16:9 四视图整版，见核心约定 6）；
2. 分镜定稿 → 每段按 MiniMax H3 官方 ref2va 六段写清提示词（参考标记一律写官方 `<Picture N>` / `<Video N>` / `<Audio N>`，每类独立从 1 起编号）与参考编号；
3. **导入资产与分镜** → 画布「导入资产与分镜」节点（`packages/nodes/assetImportNode`，agent 侧 `node:importScript`）按卡片抽取，**独占写** `plan/assetIndex.json` 与 `plan/story.mtrack`。导入时**代码确定性报错的只有三类**：编号重复与结构不合契约（`assetImport.ts` 的 `normalizeExtraction`——模型返回与 `extraction` 入参共用同一份契约）；正文为空或超 20 万字符（`extractAssets` 开头）；`plan/assetIndex.json` 与 `plan/story.mtrack` 任一已存在（`requireNewPlanFiles`，在出图之前就探测，不会先烧模型）。`clips` 覆盖里的 `clipId` 不在本次分镜里、`prompt` 为空、引用了不存在或仅文字的资产，也直接报错（`resolveClipOverrides`）。**静默修正（只记 `warnings`，不中断）**：`seconds` 夹到 2–15（`sanitizeSeconds`/`secondsWarning`，落盘在 `writePlanFiles` 的逐镜循环）；分镜引用不是本次卡片、或引用仅文字卡，直接从 `referenceIds` 掐掉（`parseExtraction` 的 shot 归一 + `writePlanFiles` 的 `visual`/`usable` 过滤）；出图失败的卡自动移出参考清单（同 `usable` 过滤，失败清单来自 `generateAssetImages`）；图片参考超 9 个只留前 9 个（`writePlanFiles` 里 `maxImageReferences` 判断）；`context` 却不足 10 秒只告警不拦（`writePlanFiles` 的逐镜循环）。原文里已写好的六段提示词会被**整段原样保留**（抽取提示词 `extractionSystemPrompt` 的要求 3 与 7：照抄段名、顺序与换行），要改写单镜就传 `clips`。`style` / `systemPrompt` 在资产出图时逐张自动拼进卡提示词；视频派工不注入这两项，须逐镜写进六段本体（写入义务见 `freevideoMultitrack` 技能阶段门 1–2，本文不复写细则）。「场景卡空镜无人 / 道具卡无手」只是内置抽取提示词里的要求（`extractionSystemPrompt` 的编号规则段），**不是落盘校验**，出图后要人眼核。`KF` 卡不抽（人工补）。`path` 指**剧本文本**（传 `assets/assetCards.md` 会把卡片当正文再抽一遍），`path` 与 `text` 二选一；**卡片与分镜已经定稿就别让节点再抽一遍**——整批结构化结果传 `extraction`（`{ style, systemPrompt, assets[], shots[] }`，契约是 `assetImport.ts` 导出的 `extractionSchema`），节点一次模型都不调、也不需要 `model`；**`extraction` 要的是两份稿的完整定稿**——代码只拦编号重复与结构不合，分镜引用了不在本次清单里的卡会被**静默掐掉该引用**（不留 warning），半套稿照常落成工程、之后重跑又被独占写拦下，所以完整性只能在调用前保证；`shots` 为空只适用于「先导纯资产稿、clip 事后用 `node:editProject add` 补」的确认场景，要抽散文才传 `path`/`text`，此时 `model` 必须取自 `node:importModels` 的 `text` 清单（`JSON.stringify([providerId, modelId])`；清单外编号直接报错，**不再静默回落面板默认**——默认那个模型可能密钥都没配，会一路挂到超时），出资产图另用 `imageModel`（取 `image` 清单）；Agent 选的模型会回写面板下拉，人工看得见也能改。中途想看跑到第几张用 `node:importStatus`。**会话 Agent 侧单次调用上限是画布桥与宿主的 120 秒**（`apps/server/src/agent/bridge/canvas.ts` 与 `apps/web` 的 `useCanvasTools`；节点里的 `timeoutMs: 30 * 60 * 1000` 只对面板按钮生效），整篇抽取加逐张出图多半撞顶，撞顶后已建图片节点与 `assets/<nodeId>/` 不回收、`plan/` 两文件任一已落则重跑被独占写拦下——定稿一律走 `extraction`；
4. 批量生成资产图 → 每张 `C` 卡出图即四视图整版（横向四栏），节点 label 必须保持 `<代号> <名称>`，否则派工侧认不出资产卡；
5. **绑定工程** → 导入只落了磁盘上的两个文件，多轨节点 `node.data.projectPath` 仍是空的：必须 `node:bindProject({ mode: "open", path: "plan/story.mtrack" })` 之后才读得到 `clips` 与「参考素材」（不绑或绑错文件时，下游 `readClips` / `readReferenceMap` 看到的是空工程）；
6. 接线并勾选参考 → 资产节点连到多轨节点 `in` 端口后，由用户在编辑器「参考素材」网格里打勾，勾选直接写 `clip.referenceIds`、**位次即官方 `<Picture N>` / `<Video N>` / `<Audio N>` 的编号基数**；Agent 不预写 `referenceIds`，只在用户明确要求批量改写时才动它；
7. 校验 → `planOperator validate`，error 清零才继续；
8. 逐分镜生成 → 二选一（同一批镜头绝不同时执行，见 [runbook §十五·五](references/generationRunbook.md)）：会话内按 §十三 SOP 逐镜（即每段一个视频节点、展示方案并等待用户批准算力消耗后 `node:generateVideo`），或 `node:dispatchGenerate` 后台派工（立即返回 batchId，进度看 `node:getStatus` / `mtrackRead`）；
9. 回写状态 → `generated` 不等于交付完成，用户验收后才 `accepted`；
10. 合成 → `planOperator composite` 只拼接 `accepted` 段，顺序连续无空洞（V14），写 `plan/composite.json`；`execute=true` 才真正执行 concat（需要宿主 ffmpeg，输出默认 `plan/composite.mp4`，不覆盖已存在文件）。执行前会逐段 ffprobe 实测尺寸/帧率/像素格式/音轨参数，与首段不一致直接报错——concat 滤镜要求全段一致，帧率或音轨不一致时 ffmpeg 会静默产出错乱成片。

> **衔接与时长（写稿与派工共用）**：`continuity` **默认承接**——同一段落、同一空间、画面或动作要接上一镜就写 `context`（需上一镜已成功、`attempts` 里有 `jobId`，本镜 ≥10 秒、参考合计 ≤3）；只有换场、时间跳转（跨日/闪回）、需要重新构图或独立起拍（新段落第一镜）、本镜 <10 秒或参考合计 >3、以及首镜这几种情况才写 `shot`，并写清原因。`context` 拿不到上一镜 `jobId` 时直接报错，不静默降级；批量派工按 `clips` 顺序串行执行，所以同一批次里可以混用两态（判据见 [多轨工程模板 §2.3](references/multitrackTemplate.md)）。时长先按自然口语把原句念一遍估，语气停顿与**并行**动作算进去（能同时发生的不重复累加，必须先后发生的不重叠凑时长），预留约 0.5–1 秒收尾；台词过长在**自然语意节点**拆成两镜，不加速、不吞字、不改台词标点。声明值会被供应商吸附到帧档（freevideo 实测 17n+5：6s→6.583s、10s→10.125s），成片总长以实测为准。

### 三条生成路径对照（同一批镜头只走一条）

第 8 步的「二选一」实际有三条路径（界面按钮、`node:dispatchGenerate`、`planOperator dispatch` + §十三），执行者只有两个：编辑器自己，或对话 Agent。认清入口再动手：

| 入口 | 谁执行 | 返回 / 进度怎么看 | 互斥规则 |
|---|---|---|---|
| 多轨界面 footer「生成视频」与「逐镜面板…→开始生成」（`multitrackEditor.vue` + `runFooter.vue`、`batchPanel.vue`） | 编辑器逐镜组装请求交给服务端媒体任务通道生成（`packages/nodeShared/src/mtrack/mediaDispatch.ts` 的 `composeClipRequest` + `mediaTask.ts`），**不经对话模型** | 界面提示「批次 <前 8 位>」；进度看页签状态、footer 状态行与逐镜面板，状态随每次变化写回 `story.mtrack`（800ms 防抖） | 与下一行是**同一实现**（共用 `launchDispatch`）：同一批镜头只能由一方发起，界面已在跑就不要再调 `node:dispatchGenerate` |
| 对话里调画布多轨节点的 `node:dispatchGenerate` | 同上，编辑器执行（UI 按钮的等价物） | `{ batchId, skipped }` 立即返回；进度看 `node:getStatus.batchClipIds` 或 `planOperator mtrackRead` 的 `attempts`；停止用 `node:cancelBatch` | 同上；已按 §十三 逐镜在跑时不要调它，否则同一批镜头双份算力 |
| 对话里 `planOperator dispatch` + [runbook §十三](references/generationRunbook.md) 逐镜 SOP | Agent 自己按 §一 的 11 步逐镜建节点、接线、下发配置、生成、回写 | `dispatch` 只返回逐镜清单（`clips[]`），**不生成、不写工程**；生成结果由 Agent 用 `mtrackUpdate` 回写 | 与上面两行**二选一**：本会话在按 §十三 逐镜跑，同一批镜头就不要再点界面按钮或调 `node:dispatchGenerate`；混用会双份算力、双重回写 |

跨路径共用同一套判据：批次号写在 `attempts[].error` 的 `batch:<uuid>` 里，`planOperator mtrackRead` 与 `node:getStatus` 都能读回同一批次。

### 整理本镜提示词（模型整理草稿 → 人工采用）

镜头操作里的「整理本镜提示词」按钮（`packages/nodeShared/src/mtrack/components/shotEditorPane.vue` → `multitrackEditor.vue` 的 `rewriteClipPrompt` → `POST /api/mtrack/rewriteShot`）走文本模型，只把本镜草稿整理成画面描述段。四条纪律（细节与接口字段见 [runbook §15.8](references/generationRunbook.md)）：

- **结果不自动采用**：整理稿先落「待采用」区块（左原文只读、右整理稿可编辑），点「采用整理结果」才写回该镜的六个驼峰字段（`prompt.subjectDefinitions` / `summary` / `retentionAnalysis` / `detailedDescription` / `overallSoundscape` / `nonDiegeticMusic`）；点「放弃」原文一字不动。任何路径都不自动覆盖，接口返回的 `requiresReview: true` 就是「这是草稿」的契约信号。
- **一致性守卫**：待采用期间原文画面描述、`clip.seconds`、本次整理规则任一变化，「采用」禁用，必须重新整理，不能拿旧稿套新基线。
- **规则可留空**：请求字段 `rules` 可选（≤20000），空/缺省用服务端内置规则；规则只对本次整理生效，不落盘、不随工程保存——不是全片设置。
- **生成中拒绝**：本镜或本批任一镜头 `status === "generating"` 时服务端 409「正在生成，请结束后再整理提示词，避免模型同时占显存」；整理不产生 `attempts`、不占 `batchId`、不改 `status`。
- 采用后仍要按 runbook §四 核对整理稿里的官方 `<Picture N>` / `<Video N>` / `<Audio N>` 与本镜参考顺序（各类型独立从 1 起）；整理只做结构化改写，不新增剧情、人物、道具。

## 能力边界（必须如实告知）

走供应商 HTTP 时，LocalStoryCanvas 依赖本地 ComfyUI 的能力**不可用**，不得假装等价：

| LSC 能力 | 本仓库状态 | 替代 |
|---|---|---|
| VAE identity 注入 | ❌ 无 | 多图参考 + 强约束文案 |
| 原生 context latent 续接 | ❌ 无 | `firstFrame` 首帧续接（上一镜末帧），**仅单镜直连路径可用**；多轨工程的 `continuity` 只有 `shot` / `context` 两态，`context` 靠上一镜 `jobId` 续接（参考合计 ≤3），不要在多轨里承诺首帧续接 |
| 调度器 / LoRA / 二采 denoise | ❌ 不可控 | 不提供 |
| 时间线设置（`timeline-settings`：本机 LoRA 目录 + 内置规则文本） | ❌ 无等价物，也**不需要** | 我们走供应商 HTTP，没有「本机 LoRA 目录」这回事，LSC 那份设置页对我们不适用；整理规则按次传入 `rewriteShot.rules`（留空用内置），不做全片持久设置 |

降级项由本表列出；`validate` 当前**不**输出 `capabilityDegraded` 字段（返回只有 `errors`/`warnings`/`findings`，见 `packages/tools/planOperator/src/index.ts` 的 `buildFindings`，按函数名 grep 定位），所以这些边界必须由本节主动告知用户。
