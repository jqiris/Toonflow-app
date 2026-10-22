# Agent 引导审计：多轨 / 分镜制作链路够不够 agent 自己走通

- 审计日期：2026-10-21
- 审计方式：只读代码与技能文档，未改动任何既有文件；本文件是唯一新增产物
- 审计对象（全部实读）：
  - 技能装载路径：`packages/skills/workflow/SKILL.md`、`packages/skills/workflow/references/canvasExecution.md`、`packages/skills/workflow/references/stateAndDelivery.md`、`packages/skills/canvas/SKILL.md`、`packages/skills/canvas/references/videoProduction.md`、`packages/skills/assetCard/SKILL.md`、`packages/skills/assetCard/references/generationRunbook.md`、`packages/skills/assetCard/references/multitrackTemplate.md`
  - 工具提示词（随工具下发给 agent）：`packages/tools/planOperator/src/index.ts`、`packages/tools/canvas/src/index.ts`、`packages/tools/canvas/src/assembly.ts`
  - 实现真源：`packages/nodeShared/src/mtrack/directDispatch.ts`、`packages/nodeShared/src/mtrack/multitrackEditor.vue`、`packages/nodeShared/src/mtrack/components/dispatchBar.vue`、`packages/nodeShared/src/mtrack/components/batchPanel.vue`、`packages/nodes/multitrackNode/src/index.vue`、`apps/server/src/routes/mtrack/composite.ts`、`packages/tools/planOperator/src/compositeRun.ts`
- 行号说明：分支 `multitrack` 上有并行未提交改动，`multitrackEditor.vue` 增长很快；本文引用行号以审计时快照为准，定位优先看函数名与文件名。

## 结论摘要

> **2026-10-22 更新**：本文是首轮审计记录。D1–D6 已全部修复（`mtrack-doc-fix` 轮次），E1–E4 也已闭环；剩余 D7/D8/D9 为 P2 建议级未排期。详见文末 D 表的「当前状态」列与 E 节。

**首轮结论：能走通，但会被一句过期声明引到错误路径；三个界面入口（批量面板 / 合成成片 / 刷新状态）在技能文档里完全不可发现。**

| # | 结论 | 级别 |
| --- | --- | --- |
| 1 | `generationRunbook.md:5` 仍说「编辑器只把选段+派工意图送到 agent 会话、生成都在 agent 侧」——与实现相反，会诱导 agent 去等派工或重复生成 | **P0** |
| 2 | 逐镜 11 步 SOP 本身够用：`§一` 序列、`§十三` 会话内批量、`§十五·五` 11 个 node 函数的入参/返回/风险都写全了，agent 照着能跑 | 通过 |
| 3 | 编辑器的批量面板（起始分镜+生成镜数、本镜结束后暂停、继续生成沿用同一 batchId、整批取消、刷新状态）零文档 | **P1** |
| 4 | 「合成成片」链路零文档：界面按钮 + `/api/mtrack/composite` 路由与 `planOperator composite` 的关系没有一处说明 | **P1** |
| 5 | generating 的过期回退（重启后对账回 pending）没有写进任何状态机或 SOP 段落，agent 重启后会把过期 generating 当成还在跑 | **P1** |
| 6 | 多轨工程「谁写状态」三处口径不一致（模板 :13/:170 vs :111-115；`stateAndDelivery:73` 未写执行者） | P1/P2 |
| 7 | `planOperator` 的 `dispatch` 与节点 `node:dispatchGenerate` 同名不同物，没有一处集中对照 | P2 |

## A. 错误引导（agent 会照着做错）

### A1（P0）编辑器直连生成被写成「派给 agent」

- 位置：`packages/skills/assetCard/references/generationRunbook.md:5`
- 现状原文：

  > 本文件描述 Agent 的**执行顺序与纪律**。多轨编辑器（`packages/nodeShared/src/mtrack/`，`@toonflow/node-shared/mtrack/*`）本身仍不直接调用供应商，它只把「选段 + 派工意图」送到 agent 会话（§十五）；真正的生成、追终态与回写都在 agent 侧完成（§一、§十三）。

- 实际行为：编辑器自己经画布 `nodeTools` 逐镜生成，不经过对话模型，也没有任何「派给 agent」的通道。
  - `packages/nodeShared/src/mtrack/directDispatch.ts:2` 头注释：「编辑器自己经画布 nodeTools 逐镜生成视频，不经对话模型」。
  - 同一份 runbook 的 `:376-377` 就写「**这条链路不再有 agent 参与**，`node:dispatchGenerate` 与界面按钮是同一实现」；`:409`、`:388` 同口径。
  - `packages/skills/canvas/SKILL.md:117`、`packages/skills/canvas/references/videoProduction.md:47`、`packages/skills/assetCard/SKILL.md:62` 也都是「立即返回 batchId / 后台派工」，没有 agent 中转。
  - 全仓已无 `agentDispatch`、`/api/agent` 派工路由；该文件是旧设计残留（`docs/requirementMultitrackAgentBridge.md:28` 那版需求）。
- 后果：agent 读到文件头会认为「用户在多轨界面点生成 = 给我派活」，于是要么空等消息，要么另起 §十三 循环 → 同一批镜头双重执行、双份算力（正是 `:143`、`:409` 反复警告的情形）。
- 建议改法（整段替换，语义与 §十五/§十五·五 对齐）：

  > 本文件描述 Agent 的**执行顺序与纪律**。多轨编辑器自己就能经画布 `nodeTools` 逐镜生成（§十五、§十五·五），不经过对话模型、不产生 `chat/completions` 调用；Agent 只在用户要求「在对话里批量」时走 §十三。两者对同一批镜头**二选一**。
- 必须改：**是**。

### A2（P1）多轨工程「谁写状态」三处口径互相打脸

- 位置与原文：
  - `packages/skills/assetCard/references/multitrackTemplate.md:13`：「写者只有两类：多轨编辑器……与 `planOperator` 的 `build`。**Agent 不手改该文件**；人工手改视为草案，下次校验会被指出。」
  - 同文件 `:111-115` 状态表「谁写入」列：`generating`「Agent 提交后立即写」、`generated`「Agent 确认产出后写」、`accepted`「人工作验收后写」、`failed`「Agent 追终态失败时写」。
  - 同文件 `:170`：「Agent 只通过工具 action（`build`/`dispatch`）与编辑器改文件；不在多轨生成中改文件——改完必须重新提交该镜」。
- 实际行为：三条路径都在写同一个文件——
  1. 界面直连生成：`multitrackEditor.vue:748` 的 `writeClipRun` 每次状态变化直接改内存工程并防抖写盘（runbook `:377`）；
  2. 会话内批量：§十三 SOP 的 `mtrackUpdate` 回写（runbook `:254` 起，`:264` 还专门说明 `allowBuild` 关闭会影响回写）；
  3. 验收：`multitrackEditor.vue:652` 的 `acceptClip`，按钮在 `clipEditor.vue:9-13`（只有 `generated` 可接受、`accepted` 可打回）。
- 后果：agent 读 `:13`/`:170` 会得出「我不能写 status」的结论，于是 §十三 的第 11 步（回写 `generated`/`nodeId`/`assetPath`）不敢做，或反过来按 `:111-115` 把自己当唯一写者、越过编辑器抢写。
- 建议改法：
  - `:13` 改为「写者：多轨编辑器（直连生成与用户验收）、`planOperator` 的 `build`/`mtrackUpdate`（会话内编排）、用户在编辑器里的验收按钮。Agent 不手工编辑文件内容。」
  - `:111-115` 的「谁写入」列改为「编辑器直连 / `mtrackUpdate`」，`accepted` 保留「用户点验收」。
  - `:170` 补一句：「会话内 §十三 用 `mtrackUpdate` 回写状态/`nodeId`/`assetPath` 是明确例外」。
- 必须改：**是**（口径不一致会让 agent 在两种相反结论间随机）。

### A3（P2）验收「谁写 accepted」缺主语，与 runbook 的「人工」冲突

- 位置：`packages/skills/workflow/references/stateAndDelivery.md:73`
- 现状原文：「镜头核验通过、用户明确采用后，把验收结果回写 `clip.status = "accepted"`（`generated` 只表示已生成，不等于验收通过）」
- 对照：`generationRunbook.md:44`「只有用户看过成片并认可，才由**人工**改成 `accepted`」；`multitrackTemplate.md:114`「人工作验收后写」；`stateAndDelivery.md:59`「`accepted` 只能由用户验收产生」。
- 实际行为：`accepted` 的唯一入口是编辑器验收按钮（`multitrackEditor.vue:652`），agent 侧 `mtrackUpdate` 技术上也能写 `accepted`。
- 后果：agent 可能为了让「合成」跑通，自己把 `generated` 批量改成 `accepted`，把未验收镜头拼进成片——直接违反 V14 的业务含义。
- 建议改法：`:73` 补主语与禁令——「`accepted` 由用户在编辑器点「验收」写入；agent 不得代写，只能在用户逐段明确认可后按指示批量回写，并注明依据」。
- 必须改：建议改（P2，但与 A1 同类风险，建议一并处理）。

## B. 缺项（agent 走不通或只能绕路）

### B1（P1）批量面板完全没写进技能

- 代码：`packages/nodeShared/src/mtrack/components/batchPanel.vue`
  - `:12`「按『起始分镜 + 生成镜数』逐镜串行生成（镜数 -1 = 生成到最后一镜）。生成期间当前镜头跑完才停，暂停不产生半截视频。」
  - `:35-40` 按钮：开始生成 / 本镜结束后暂停 / 继续生成 / 整批取消 / 刷新状态。
  - `:197`「已在镜头间暂停，已完成 x/y 镜」；`:212`「暂停后继续沿用同一 batchId」。
  - 入口：`dispatchBar.vue:9`「批量生成…」→ `multitrackEditor.vue:48` `@openBatch`、`:54-55` 挂载、`:695` 状态。
- 技能文档现状：`packages/skills` 全目录搜 `batchPanel|批量面板` **0 命中**；`generationRunbook.md:363-371`（§15.1 界面表）只列了轨道条、派工条、「包含已生成」、「生成选中段」、「取消批次」、跳过提示，**没有**「批量生成…」「合成成片」「刷新状态」。
- 后果：用户问「能不能从 S003 连续生成 8 镜、中途暂停」，agent 只知道 §十三（会话内逐镜、消耗对话轮次）和「生成选中段」，答不出面板用法，也解释不了「暂停是镜头间暂停、不产生半截视频、继续沿用同一 batchId」。
- 建议改法：§15.1 表补三行按钮；新增 §15.4「批量面板与断点续跑」，写清参数语义（镜数 -1）、暂停/继续（同一 batchId）、整批取消与 `node:cancelBatch` 的关系、刷新状态的对账作用（见 B2）。
- 必须改：**是**。

### B2（P1）generating 过期与重启对账没有文档

- 代码：`directDispatch.ts:191` `readClipGeneration`；`:217` 未找到产物时 `{ outcome: "pending", error: "重启后未在节点上找到生成产物，已退回待生成" }`；编辑器 `multitrackEditor.vue:987` `reconcileFromPanel`、`:1014` `reconcileGenerating` 批量对账；入口是 `dispatchBar.vue:16`「刷新状态」与批量面板 `:40` 同名按钮。
- 技能文档现状：搜「重启」只命中 `generationRunbook.md:550`、`:559`（dev 构建与端口），与状态机无关；§一/§十三/`multitrackTemplate.md:109-119` 的状态机里没有「`generating` 可能是陈旧值」这条。
- 后果：agent 重启后 `mtrackRead` 看到 `generating` 会当成「还在跑」继续轮询或直接汇报「生成中」；实际应提示用户点「刷新状态」（或自己核对画布节点实况），把陈旧 `generating` 对账成 `generated`/`failed`/`pending`。
- 建议改法：§二「状态查询纪律」加一条第 4 硬规则，或 §15.4 里写清：`generating` 不是可信终态，会话中断/画布重开后先用 `node:getStatus` + 刷新状态对账，再判断进度。
- 必须改：**是**。

### B3（P1）「合成成片」界面与 `/api/mtrack/composite` 零文档

- 代码：
  - 服务端 `apps/server/src/routes/mtrack/composite.ts`：`POST`，zod strict `{ directory, sourcePath?, execute?=false, compositeOutputPath? }`（`:11-16`）；非 execute 只写 `plan/composite.json`（`executed:false`，`:54-63`）；`execute=true` 才经 `concatComposite` 拼接（`:71-74`），成功后清单改 `executed:true`（`:76`）。
  - 路由注册：`apps/server/src/router.ts:75`、`:205`（自动生成，勿手改）。
  - 共用实现：`packages/tools/planOperator/src/compositeRun.ts:3`「工具（`src/index.ts` 的 composite execute=true）与 server 的 `/api/mtrack/composite` 共用这一条路径」。
  - 界面：`dispatchBar.vue:12`「合成成片」（`hasAccepted` 才可点）；`multitrackEditor.vue:561` `CompositeResult`、`:567` `postComposite`、`:582` `handleComposite`（先 `execute=false` 拿段数做二次确认，再 `execute=true`；「输出已存在」补处置建议）。
- 技能文档现状：搜 `mtrack/composite|合成成片` **0 命中**；只有工具口径 `assetCard/SKILL.md:64`、`generationRunbook.md:190`、`:411`、`:588`（都写 `planOperator composite`）。
- 后果：用户说「合成成片」，agent 不知道界面按钮存在，会去调 `planOperator composite`（能出片，但绕过界面二次确认、且需自己指定 `path`/`compositeOutputPath`），或干脆让用户手动跑 ffmpeg；也不知道 `sourcePath` 可以指向 `plan/story-2.mtrack` 这类非默认工程。
- 建议改法：§十五 增一小节「合成成片」：按钮入口、二次确认流程、`POST /api/mtrack/composite` 契约与错误透出（V14 断点、没有 accepted、输出已存在不覆盖）、与 `planOperator composite` 共用 `compositeRun` 的关系。
- 必须改：**是**。

### B4（P2）验收按钮的位置没写

- 现状：runbook `:44` 只说「人工改成 accepted」，没说入口是轨道/片段面板上的验收按钮（`multitrackEditor.vue:652` `acceptClip`，只有 `generated` 才能接受、`accepted` 才能打回）。agent 无法引导用户点哪里。
- 建议：`:44` 后补一句入口与前置状态。

### B5（P2）三条生成路径没有一张对照表

- 现状：`planOperator` 的 `dispatch`（`packages/tools/planOperator/src/index.ts:333-337`，注释「只出逐镜派工清单，不执行生成」，必须 `from`+`to`）、节点函数 `node:dispatchGenerate`（`packages/nodes/multitrackNode/src/index.vue:371-389`，执行生成、立即返回 `{ batchId, skipped }`）、界面「生成选中段/批量生成」（同一条 `directDispatch` 链路）三者名字相近、语义不同。
- 文档只在 `:143`、`:390`、`:409`、`assetCard/SKILL.md:62`、`canvas/SKILL.md:24` 分散提到「二选一」，没有一处讲清「谁循环、谁只出清单、三者为什么互斥、同时用会怎样」。
- 参数侧：`node:dispatchGenerate` 的 `clipIds` 1–200 / `from`+`to` / `includeFinished` 默认 `false` 在 `multitrackNode/src/index.vue:374-380` 有 schema，runbook `:409` 也复述了；缺的是与另外两条路径的对照，不是参数本身。
- 建议：`assetCard/SKILL.md:56` 的「生成闭环（简版）」后加一张 3 行对照表（入口 / 谁执行 / 返回 / 互斥规则）。

### B6（P2）`planOperator` 提示词只描述 agent 侧路径

- 位置：`packages/tools/planOperator/src/index.ts:182` promptGuidelines：「生成与画布落盘由 agent 走画布工具……与 nodeTools 执行」。
- 与 A1 同源：没说编辑器可直连。建议补半句「用户也可能在多轨界面/节点直接派工，此时不要重复生成」。

**B 总评**：验收与合成的关系本身写清了（`generationRunbook.md:44`、`:190`、`multitrackTemplate.md:114`、`:119`：只有 `accepted` 进合成、V14 顺序连续）；缺的是「入口在哪、谁点」。批量面板与重启回退是真正的空白，`/api/mtrack/composite` 是新增能力没同步。「够不够 agent 自己走通」的答案是：**按 §一/§十三/§十五·五 能走通；靠界面入口的用户提问走不通，且会被 A1 引向错误的等待路径。**

## C. 矛盾与过期能力声明

| # | 位置 | 现状 | 判定 |
| --- | --- | --- | --- |
| C1 | `generationRunbook.md:5` vs `:376-377`、`:409`、`canvas/SKILL.md:117` | 「派给 agent 会话」 vs 「不经过对话模型、不再有 agent 参与」 | **P0 矛盾**，见 A1 |
| C2 | `multitrackTemplate.md:13`/`:170` vs `:111-115` | 「Agent 不手改该文件」 vs 「Agent 提交后立即写」 | P1 矛盾，见 A2 |
| C3 | `stateAndDelivery.md:73` vs `generationRunbook.md:44` | 「回写 accepted」未写谁执行 vs 「只有用户认可才由人工改」 | P2，见 A3 |
| C4 | `docs/multitrackProductionPlan.md:372`、`:453` | 仍写 `agentDispatch.ts`「agent 执行桥」「批量派工」，实际文件已是 `directDispatch.ts`，且不存在 agent 派工桥 | P2 历史文档漂移（docs 不进技能加载路径，不误导 agent；会误导维护者与全文搜索） |
| C5 | `docs/requirementMultitrackAgentBridge.md:28`、`docs/videoGuideMultitrackDesign.md:46`、`:60` | 「把选段 + 派工意图交给 agent 会话」是冻结的旧需求/设计记录 | P2，建议在文件头加「历史设计，勿作引导」 |
| C6 | `packages/tools/mediaGeneration/src/index.ts:18` | 仍提供 `generateVideo` 直连能力，但技能已统一为「只走画布 `nodeTools`」（`canvasExecution.md:82` 明令禁止绕过画布改走直接媒体工具），**不需要改**，仅记录 | 通过 |

## D. 问题清单（P0/P1/P2，标明必须改）

> **状态更新（2026-10-22）**：D1–D5 已由 `mtrack-doc-fix` 轮次全部落地（`mtrack-doc-fix` d1–d5，5 个文档文件改动、零代码）；D6 已在同轮由 d3 修复（`stateAndDelivery.md:73` 补主语 + 禁令）。D7/D8/D9 未排期，维持「建议」级；**后由 `mtrack-leftover` 轮次补齐**（见下表「当前状态」列）。下文清单保留原始判定，新增「当前状态」列标注实际落地情况。

| ID | 级别 | 问题 | 位置 | 改法 | 必须改 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **P0** | 文件头声明「编辑器把派工意图送到 agent 会话、生成都在 agent 侧」，与直连实现相反 | `generationRunbook.md:5` | 整句替换为直连口径（A1 给出现成文案） | **是** | **已修复**（`:5` 整句替换为「生成选中段/批量生成…/node:dispatchGenerate 都走 `directDispatch.ts` `beginDirectDispatch`…」，同文件 `:379` 口径一致） |
| D2 | P1 | 批量面板（起始分镜+镜数、暂停/继续沿用 batchId、整批取消、刷新状态）零文档 | `batchPanel.vue`、`dispatchBar.vue:9` | §15.1 表补三行 + 新增 §15.4 | **是** | **已修复**（§15.1 表 `:370-372` 补「批量生成…/刷新状态/合成成片」三行；`:396-413` 新增 §15.4 批量面板小节，写清起始分镜/镜数 -1/暂停/继续沿用同一 batchId/整批取消/刷新状态/重试） |
| D3 | P1 | 重启后 `generating` 过期回退 / 刷新状态对账无文档 | `directDispatch.ts:217`、`multitrackEditor.vue:987/1014`、`dispatchBar.vue:16` | §二 加第 4 条硬规则，或写进 §15.4 | **是** | **已修复**（`:415-432` 新增 §15.5「重启/重挂对账」：generating 非可信终态；idle+零产物→pending；idle+有产物→generated「对账恢复」；查询失败整轮跳过） |
| D4 | P1 | 「合成成片」按钮与 `/api/mtrack/composite` 无文档，与 `planOperator composite` 关系缺失 | `dispatchBar.vue:12`、`multitrackEditor.vue:561-604`、`apps/server/src/routes/mtrack/composite.ts`、`compositeRun.ts:3` | §十五 增「合成成片」小节（契约+二次确认+错误透出+共用路径） | **是** | **已修复**（`:434-456` 新增 §15.6 合成成片小节：accepted 前置、execute=false→二次确认→execute=true、7 条拒绝条件原文、规格不一致直接 throw） |
| D5 | P1 | 多轨工程写者口径矛盾（模板 :13/:170 vs :111-115） | `multitrackTemplate.md` | 按 A2 统一写者列与边界条款 | **是** | **已修复**（`multitrackTemplate.md:13`/`:111-115`/`:170` 写者口径统一为两条通道：编辑器直连写 / `planOperator` `build`+`mtrackUpdate` 写，Agent 不手改，`updatedAt` CAS） |
| D6 | P2 | `accepted` 回写缺主语，可能被 agent 代写 | `stateAndDelivery.md:73` | 补「由用户验收按钮写；agent 不代写」 | 建议 | **已修复**（`:73` 重写为有主语 + 禁令：accepted 由用户点「验收」写入，agent 不得代写；`:59` 已有同义句并补交叉引用） |
| D7 | P2 | 三条生成路径（界面直连 / `node:dispatchGenerate` / `planOperator dispatch`+§十三）无对照表 | `assetCard/SKILL.md:56` 附近 | 加 3 行对照表 | 建议 | **已修复**（`packages/skills/assetCard/SKILL.md`「生成闭环（简版）」末尾新增「三条生成路径对照（同一批镜头只走一条）」表：入口 / 谁执行 / 返回与进度 / 互斥规则 四列，含「界面按钮与 `node:dispatchGenerate` 是同一实现」「§十三 与二者二选一」两条互斥规则） |
| D8 | P2 | `planOperator` 提示词只描述 agent 生成，不提编辑器直连 | `planOperator/src/index.ts:182` | 补半句互斥说明 | 建议 | **已修复**（`packages/tools/planOperator/src/index.ts` `promptGuidelines` 第 3 条补「用户也可能在多轨界面/节点直接派工，此时生成由编辑器自己执行，不要重复生成」） |
| D9 | P2 | `docs/` 旧设计仍写 `agentDispatch.ts` / 「派工意图送 agent」 | `docs/multitrackProductionPlan.md:372,453`、`docs/requirementMultitrackAgentBridge.md:28`、`docs/videoGuideMultitrackDesign.md:46,60` | 文件头加「历史设计，勿作引导」 | 建议 | **已修复**（三份 docs 文件头均加「历史设计，勿作引导」标注：写明 `agentDispatch.ts` 不存在、实际链路是 `directDispatch.ts` 的 `beginDirectDispatch`，现行口径指向 `generationRunbook.md`） |

**必须改的最小集 D1–D5 已全部落地**，且额外带掉了 D6。剩余 D7/D8/D9 均为 P2 建议级，不影响 agent 走通主链路；三项也已在 `mtrack-leftover` 轮次补齐，本表无未修项。

## E. 本轮（2026-10-22）新增审计结论

在 D1–D9 之外，对 D1–D5 落地后的新一轮代码做了增量核对，发现并处理以下三项（均已完成或已有结论）：

| ID | 级别 | 问题 | 结论 |
| --- | --- | --- | --- |
| E1 | 中 | 九宫格拆图建多轨工程（`imageGridSplit.vue:137-169`：每格一镜、`assetIndex` 每格一卡、`referenceIds` 指向该格、已存在不覆盖）在 `packages/skills` 全目录搜 `imageGridSplit\|宫格\|拆图` **0 命中** | **已修复**：`generationRunbook.md:462-484` 新增 §15.7「九宫格拆图 → 自动建多轨工程」，写清落盘形状与「只建工程不派工」边界 |
| E2 | 中 | 拆图工程不产出 `plan/assetReport.json`，而 `multitrackEditor.vue:382-411 loadReport` 曾把报告与索引耦合（任一缺失整个进 catch，`indexCards` 不赋值 → 参考列表空 → 拆图工程的参考绑定形同虚设） | **已修复（代码）**：`loadReport` 拆两个独立 try + `isMissingFile` 只认 ENOENT；报告缺失时 `report=undefined` → 状态面板显示「未读取到 plan/assetReport.json」而非「未发现明显问题」（避免误判校验已跑）。该口径已写进 runbook §15.7 |
| E3 | 低 | `multitrackNode/readme.md:10` 写「9 个节点函数」，实际 11 个（9 自带 + `useNodeReferences.ts:52/:67` 自动注册 2）；`ext/multitrack/readme.md:9`「不在扩展内做生成」与同文件 `:11` 自相矛盾 | **已修复**：前者先改为 11、再随本轮新增 4 个函数统一到 15（13 自带 + 2 引用）；后者改为「不在扩展内直连供应商」，矛盾消除 |
| E4 | 低 | 界面与文档把 `global.style`/`global.systemPrompt` 描述成「渲染时拼到段尾」，实际 `directDispatch.ts:109-113` 是**前拼到画面正文开头**（不新增段落标题） | **已修复**：`multitrackEditor.vue:126` UI 标签 + `multitrackTemplate.md:28`/`:71` + `docs/multitrackProductionPlan.md:82` + `docs/multitrackGapAudit.md:182` 共 5 处口径统一为「拼到画面正文开头」 |

**E 系列遗留**：D7/D8/D9 三项 P2 已在 `mtrack-leftover` 轮次补齐；`docs/` 目录下的历史方案文档（`multitrackProductionPlan.md`、`requirementMultitrackAgentBridge.md`、`videoGuideMultitrackDesign.md`）仍保留 `agentDispatch.ts` 等旧描述，但文件头均已加「历史设计，勿作引导」标注，不再误导维护者。

## F. 已知问题（不影响 agent 走通主链路，记录症状避免重复排查）

| ID | 级别 | 症状 | 根因与现状 |
| --- | --- | --- | --- |
| F1 | 中 | 桌面壳起不来，日志报 `JSON Parse error: Unrecognized token '锘?` | `data/settings.json` 被外部工具（如 PowerShell `Set-Content -Encoding utf8`）写入 UTF-8 BOM，而 `conf` 直接让第三方库 `JSON.parse`。**已修复**：`apps/server/src/utils/conf/index.ts` 在实例化 `conf` 前剥掉 `\uFEFF` 前缀并原子写回（与 `personalization.ts:42`、`agent/runtime/resources.ts:36`、`routes/skills/save.ts:25` 同款容错），conf 之后的自身重写天然无 BOM，等于自愈 |
| F2 | 低 | dev 环境下改了 `packages/skills/**` 的文档，运行时读到的还是旧版 | `initializePlugins` 对 skills **故意不传 revision**（生产要保护用户修改），`initialized` marker 一旦存在就永久跳过，且 `cp` 用 `force:false` 不覆盖已存在文件。**已修复（仅 dev）**：`apps/desktop/scripts/build.ts` 在 dev 模式把 `packages/skills` 同步进 `data/skills`；产品初始化逻辑未改 |
| F3 | 低 | 打开工程时 Network 出现十余条 `files/read` 404 | 均为设计内降级：读尚未生成的派生产物（`plan/assetReport.json`、`plan/composite.json`）与探测式读取（`probeDefaultProject`、`pathIsFree`）。服务端 `app.ts:112-114` 明文背书 4xx 预期，界面有「未读取到 plan/assetReport.json」降级文案。**已优化**：`loadReport`/`refreshOutput` 加 in-flight 去重，砍掉并发重复请求 |
| F4 | 提示 | `data/nodes` 里有源码已删除的节点 bundle（如 `depthCaptureNode`、`webEpisodeEditorProNode`） | 源码删除后 dev 不会重建它们，但服务端从 `data/nodes` 扫描列表，所以仍会出现。属既有状态，需清理时连 `data/settings.json` 里的节点启用记录一起看 |

## 附：关键证据索引

| 事实 | 位置 |
| --- | --- |
| 编辑器直连、不经对话模型 | `packages/nodeShared/src/mtrack/directDispatch.ts:2`；`generationRunbook.md:5`、`:376-377` |
| 编辑器写状态 | `multitrackEditor.vue` `writeClipRun`（800ms 防抖写盘） |
| 用户验收入口 | `clipEditor.vue:7-14` 验收/取消验收按钮；`multitrackEditor.vue` `acceptClip`（双守卫）；`generationRunbook.md:44` |
| 批量面板参数与按钮 | `batchPanel.vue`（起始分镜/生成镜数 -1=到最后一镜/暂停/继续沿用同一 batchId/整批取消/刷新状态/重试）；入口 `dispatchBar.vue` 「批量生成…」 |
| 暂停后沿用同一 batchId | `batchPanel.vue`（runbook §15.4 已收录） |
| 重启回退 pending | `directDispatch.ts:191`、`:217`；对账 `multitrackEditor.vue` `reconcileGenerating`/`reconcileFromPanel`；入口「刷新状态」；runbook §15.5 |
| 合成成片按钮 | `dispatchBar.vue` 「合成成片」；`multitrackEditor.vue` `handleComposite`；runbook §15.6 |
| 合成路由 | `apps/server/src/routes/mtrack/composite.ts`；注册 `apps/server/src/router.ts`（自动生成） |
| 工具与路由共用执行段 | `packages/tools/planOperator/src/compositeRun.ts` |
| 整理本镜提示词（新增） | `apps/server/src/routes/mtrack/rewriteShot.ts`（POST，`providerId`+`modelId`+三段提示词，可选 `rules` 覆盖内置整理规则；返回 `{text, requiresReview:true}`，工程级 `generating` 时 409 拒绝）；入口 `clipEditor.vue` 「整理本镜提示词」→ `multitrackEditor.vue` `rewriteClipPrompt`（自动取第一个可用文本模型）→ **待采用区块**：`adoptRewrite` 按 `pending.clipId` 人工采用才写回 `prompt.integratedMultimodalDescription`，环境声/配乐不动；`rewriteBasisChanged` 守原文/时长/规则三者，变化即禁用采用；runbook §15.8 |
| 九宫格拆图建工程 | `packages/nodes/imageNode/src/components/imageGridSplit.vue` `writeSplitProject`（每格一镜 + `assetIndex` 每格一卡 + `referenceIds` 指向该格；`plan/story.mtrack` 与 `plan/assetIndex.json` 已存在则抛「已存在，未覆盖」）；runbook §15.7 |
| 全片风格 / 系统提示词拼装位置 | `directDispatch.ts:109-113`：前拼到画面正文**开头**，不新增段落标题；两字段为空时输出逐字节一致 |
| 参考缩略图解析 | `multitrackEditor.vue` `resolveReferenceThumbnails`：`card.nodeId` 优先，为空回落 `findCardNodeIds` label 匹配，取并集去重 |
| planOperator composite 文档口径 | `assetCard/SKILL.md:64`；`generationRunbook.md` §15.6 |
| `planOperator dispatch` 只出清单 | `packages/tools/planOperator/src/index.ts` composite/dispatch action |
| 节点函数清单（15 个） | `canvas/SKILL.md:117`；`videoProduction.md:47`；`generationRunbook.md` §15.5（13 自带 + `useNodeReferences` 自动注册 2；新增 pauseBatch/resumeBatch/retryClip/rewritePrompt，另 imageNode 的 `node:splitGrid` 见 `packages/nodes/imageNode/src/index.vue`） |
| 状态机与写者表 | `multitrackTemplate.md:13`、`:109-119`、`:170`（写者口径已统一） |
| 多轨状态口径 | `stateAndDelivery.md:59`、`:73`（accepted 只能由用户验收写入，agent 不代写） |
| 技能对 mtrack 能力的命中 | D1–D6 + E1 落地后，`mtrack/composite`、`合成成片`、`批量面板`、`刷新状态`、`宫格/拆图` 在 `packages/skills` 全目录均已命中（首轮为 0） |
