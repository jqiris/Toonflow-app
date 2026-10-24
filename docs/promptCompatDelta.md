# 提示词兼容性差异盘点（merge-v1 相对 master）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 任务：t2（差异盘点）。只读盘点，除本文件外未修改任何仓库文件。
> 盘点基线：`master`；盘点对象：`packages/skills/**`；工作分支：`merge-v1`。
> 命令：`git diff master --stat -- packages/skills`、`git status --short -- packages/skills`、逐文件 `git diff master -- <file>`。

## 〇、写法约定（硬约束）

本轮全队禁止出现双花括号模板语法字面量。本文引用原文时统一改写为：

| 原文形态 | 本文写法 | 说明 |
|---|---|---|
| 双花括号包 ref 加序号 | ｛｛ref N｝｝ | 即画布 mention chip，团队统一称「旧REF占位标记」 |
| 双花括号包 Picture/Video/Audio 词根 | ｛｛Picture N｝｝ 等 | wire 层兜底归一化的另一种写法 |
| MiniMax H3 官方参考标记 | `<Picture N>` / `<Video N>` / `<Audio N>` | 尖括号形式，与原文字面一致，可直接引用 |

凡表格里出现 `｛｛…｝｝`，均表示「原文该处是双花括号旧标记」，引用时已全角代写。

## 一、分类口径

| 类 | 定义 | 兼容性含义 |
|---|---|---|
| **A** | 纯新增：新文件、新段落、新条目，不改变任何既有路径的判定与产物 | 安全，除非新增内容里含强制约束又指向新路径 |
| **B** | 改变默认值：把「未指定时默认 X」改成「未指定时默认 Y」 | 用户点名即回到原值，但默认产出会变 |
| **C** | 给原有路径加前置条件：原来无条件生效，现在要先满足某个判定 | 高风险：不满足条件就走不到原路径 |
| **D** | 改变原有路径的产物格式或语义 | 高风险：走到路径也可能拿不到原格式 |

混合项在「备注」列标注次类，统计按主导类计。

## 二、文件清单（13 个：11 个入 diff + 2 个未跟踪）

`git diff master --stat -- packages/skills` 结果：**11 files changed, 1497 insertions(+), 33 deletions(-)**；`git status --short` 另有 **2 个未跟踪新文件**，`??` 状态未入 diff。

| # | 文件 | 相对 master | 行数 | git 状态 | 主导类 |
|---|---|---|---|---|---|
| 1 | `packages/skills/assetCard/SKILL.md` | 新增 | +102 | 已提交，另有 −1/+3 未提交 | A |
| 2 | `packages/skills/assetCard/references/assetCardTemplate.md` | 新增 | +110 | 已提交，另有 −2/+2 未提交 | A |
| 3 | `packages/skills/assetCard/references/generationRunbook.md` | 新增 | +799 | 已提交 | A |
| 4 | `packages/skills/assetCard/references/multitrackTemplate.md` | 新增 | +254 | 已提交，另有 −1/+1 未提交 | A（含 1 处 D 型示例修正） |
| 5 | `packages/skills/assetCard/references/referenceResolution.md` | 新增 | +166 | 已提交 | A |
| 6 | `packages/skills/assetCard/references/imagePrompt.md` | 新增 | 25 464 B | **未跟踪 `??`** | A |
| 7 | `packages/skills/assetCard/references/assetDesign.md` | 新增 | 20 864 B | **未跟踪 `??`** | A |
| 8 | `packages/skills/canvas/SKILL.md` | 修改 | 16 行变动（2.1.0→2.2.0） | 已提交 | C/D |
| 9 | `packages/skills/canvas/references/videoProduction.md` | 修改 | 18 行变动 | 已提交 | B/D |
| 10 | `packages/skills/workflow/SKILL.md` | 修改 | 51 行变动（2.7.0→2.8.0） | 已提交 | C |
| 11 | `packages/skills/workflow/references/canvasExecution.md` | 修改 | 6 行变动 | 已提交 | C |
| 12 | `packages/skills/workflow/references/stateAndDelivery.md` | 修改 | +4 | 已提交 | A |
| 13 | `packages/skills/v118workflow/SKILL.md` | 修改 | 4 行变动（1.1.0→1.1.1） | 已提交 | C |

> 注意 1：`git status` 只把 assetCard 三个文件标成 `M`，说明 canvas / workflow / v118workflow 的改动已在 merge-v1 上提交，assetCard 的三处是**本轮未提交增量**。
> 注意 2：第 6、7 个文件未纳入 git，但已被 `assetCard/SKILL.md:29`、`assetCard/SKILL.md:30`、`assetCardTemplate.md:3`、`assetCardTemplate.md:36` 四处链接引用——提交时漏 `git add` 会让这四条链接悬空。
> 注意 3：团队背景称「v118workflow 三份文件已整体回退到 HEAD」，与实测不符，见第七节。

## 三、分类汇总

逐处清点后共 **58 处**改动：

| 类 | 处数 | 分布 |
|---|---|---|
| A 纯新增 | 21 | assetCard 8、canvas/SKILL 5、videoProduction 2、workflow 3、stateAndDelivery 2、v118workflow 1 |
| B 改默认值 | 8 | canvas/SKILL 1、videoProduction 2、workflow 4、canvasExecution 1 |
| C 加前置条件 | 18 | canvas/SKILL 2、videoProduction 1、workflow 12、canvasExecution 2、v118workflow 1 |
| D 改产物格式/语义 | 11 | canvas/SKILL 2、videoProduction 4、workflow 3、assetCard 2 |

合计 58 处。C + D 合计 **29 处，占 50%**——这就是本轮兼容风险的全部面积。

## 四、逐文件逐处盘点

### 4.1 `packages/skills/canvas/SKILL.md`（10 处）

diff 前像：`3e7ee83`；后像：`f2d3abc`。hunk 头：`@@ -2,7 +2,7 @@`、`@@ -21,7 +21,9 @@`、`@@ -88,6 +90,7 @@`、`@@ -99,8 +102,9 @@`、`@@ -111,7 +115,9 @@`。

| 位置 | 类 | 原（master） | 现（merge-v1） | 备注 |
|---|---|---|---|---|
| `:5` | A | `version: "2.1.0"` | `version: "2.2.0"` | 版本号 |
| `:24` | **C** | master 无此段；canvas 链路对视频制作无条件适用 | 「视频生成先判工程形态……走 assetCard 多轨链路……**不在画布上逐段手建视频节点直连生成**；只有无多轨工程且用户点名只要一条视频、或对既有单视频节点的局部重生成，才走单节点直连链路」 | 首次给直连链路加前置条件，且触发词包含「分镜批量」 |
| `:26` | **C**（次 D） | 「默认从本次完整剧本生成……一片段对应一份视频提示词和一个视频节点，资产直接用于多参生成」 | 前半句加「**直连例外形态下**」，并新增「视频提示词按工程形态选写法，两者不混用：多轨……ref2va 六段、参考写 `<Picture N>`；画布直连……沿用画布 mention chip ｛｛ref N｝｝」 | 原段落被切成两个口径 |
| `:93` | A | 无 | 「`addNode` 添加多轨编辑器（`remote-multitrackNode`）时带 `agentCreated` 标记且**同画布唯一**……」 | 纯新增约束 |
| `:105` | A | 「先确认角色、场景等资产，再把当前片段的全部镜头转写成一份专用视频提示词；连线只承载本次真正使用的素材」 | 加「多轨工程形态下，该纪律由资产接入三步承接：`connectNodes` → `node:setReferenceOrder` → `node:editProject`」 | 原句保留 |
| `:106` | **D**（澄清型） | 「……再用 `node:setPrompt` 写入 ｛｛ref N｝｝、素材名称和用途」 | 「写入 ｛｛ref N｝｝**（画布 mention chip，直连视频节点沿用这套写法）**、素材名称和用途」 | 原指令被限定为直连专用 |
| `:107` | **D** | 无 | 「多轨工程的镜头提示词由写作者直接按 MiniMax H3 官方 ref2va 六段书写……参考一律写官方 `<Picture N>`，**不再写旧 ｛｛ref N｝｝ 占位标记**……旧 ｛｛ref N｝｝ 是含图片/视频/音频/文本的全局序号，两者基数不同、不能当等号映射，旧标记只由引擎在生成时换算兼容」 | 对新增多轨路径是 A，对「既有提示词写法」是 D |
| `:118` | A | 无 | 图片节点新增 `node:splitGrid` 宫格切图，独占写 `plan/assetIndex.json` 与 `plan/story.mtrack` | 纯新增 |
| `:119` | A | 无 | 多轨编辑器 15 个 `node:` 函数逐个说明 | 纯新增 |
| `:120` | **B** | 「**图片未指定模型时优先选择可用的 gpt-image**，不能把节点自动默认值当成用户选择；不可用时先确认替代模型」 | 「**媒体资产生成默认使用 freevideo 供应商**（视频 `MiniMax-H3`、图片用 FreeVideo 图像模型）：用户未指定模型时直接按 freevideo 继续，不要换成节点自动默认值或其他供应商；freevideo 不可用时先说明并确认替代模型。用户点名其他模型时才按其指定执行」 | 图片默认 gpt-image→freevideo；视频默认补齐为 MiniMax-H3 |

### 4.2 `packages/skills/canvas/references/videoProduction.md`（9 处）

diff 前像：`e65c8b7`；后像：`7165d38`。hunk 头：`@@ -4,7 +4,7 @@`、`@@ -39,12 +39,14 @@`、`@@ -59,14 +61,14 @@`、`@@ -74,7 +76,7 @@`、`@@ -95,7 +97,7 @@`。

| 位置 | 类 | 原（master） | 现（merge-v1） | 备注 |
|---|---|---|---|---|
| `:7` | **B**（次 C） | 「**默认采用 Seedance 2.0/2.5 多参生产**：先完成并确认本次范围的完整剧本……」 | 「视频生成先判工程形态……默认走 assetCard 多轨链路……形态为直连例外（无多轨工程且用户点名只要单条视频，或对既有单视频节点的局部重生成）时，**默认媒体模型为 freevideo / MiniMax-H3**（用户点名 Seedance 时才按其版本）」 | 默认生产模型换人，且原段落被条件化 |
| `:42` | **C** | 表格行「一个片段的全部镜头 → 一个视频生成节点的提示词」 | 行标题改为「一个片段的全部镜头（**直连例外形态下**）」，内容加「多轨工程形态下镜头内容落 `clips[].prompt`……六段书写、参考写 `<Picture N>`」 | 示例与映射表只覆盖直连例外 |
| `:45` | A | 无 | 「多轨工程形态下镜头提示词只有一套写法……官方标记**按类型各自从 1 编号**……例如挂了 2 张图 + 1 段音频时，正确是 `<Picture 1>`、`<Picture 2>`、`<Audio 1>`」 | 全新段落，只约束多轨 |
| `:49` | A | 「当前内置节点可能提供 `node:setText`……不将这些名称套给其他插件」 | 原句保留，追加多轨节点 15 函数清单、`updatedAt` CAS 对账、旧标记归一化说明 | 原句未删 |
| `:64` | **D** | 「每项实际使用的媒体都在提示词中写 ｛｛ref N｝｝、素材名称和具体用途，不能只连边」 | 原句加「（画布 mention chip，直连视频节点沿用这套写法）」并追加「多轨工程的镜头提示词写官方 `<Picture N>`，编号按图片参考自身从 1 数」 | 与 canvas/SKILL:106 同型 |
| `:69` | **D** | 「列表中第 N 项就是 ｛｛ref N｝｝。这些是核对依据」 | 「列表中第 N 项就是 ｛｛ref N｝｝（画布 mention chip；多轨工程按官方 `<Picture N>` 书写）」 | 同上 |
| `:71` | **D** | 「提示词开头用真实 ｛｛ref N｝｝ 定义主体、场景、道具及稳定特征……最后写已确认风格与必要约束」 | 原句保留，追加「多轨工程把同一套内容写成官方 ref2va 六段：`subject_definitions` 定义 `<Subject N>` 及其来源 `<Picture N>`……」 | 一套内容两套外壳 |
| `:79` | **B** | 「**图片未指定模型时优先选择实际可用且支持所需输入/规格的 gpt-image 系列**……**视频尚未确定制作模型时，按已确认路线选择实际提供的 Seedance 2.0/2.5 多参能力**」 | 「**媒体资产生成默认使用 freevideo 供应商**：用户未指定模型时，视频直接用 `freevideo / MiniMax-H3`、图片用 FreeVideo 图像模型，节点自动填入的其他默认模型不算用户指定」 | 两处默认同时换，且 gpt-image 优先级被整段删除 |
| `:100` | **D** | 「## 6. 示例：三镜头组成一个视频片段」 | 「## 6. 示例：**灵感模式单条三镜头合段直连生成（非多轨工程形态）**」 | 示例适用范围收窄 |

### 4.3 `packages/skills/workflow/SKILL.md`（22 处，主战场）

diff 前像：`0cb7413`；后像：`f049d3e`。hunk 头：`@@ -2,7 +2,7 @@`、`@@ -18,30 +18,45 @@`、`@@ -56,7 +71,7 @@`、`@@ -67,7 +82,7 @@`、`@@ -76,7 +91,7 @@`、`@@ -368,6 +383,7 @@`、`@@ -785,6 +801,7 @@`、`@@ -1353,17 +1370,17 @@`、`@@ -1379,7 +1396,7 @@`、`@@ -1392,7 +1409,7 @@`。

| 位置 | 类 | 原（master） | 现（merge-v1） | 备注 |
|---|---|---|---|---|
| `:5` | A | `version: "2.7.0"` | `version: "2.8.0"` | 版本号 |
| `:21` | **C** | 表格无此行 | 新增首行：「任何视频制作、生成、继续或修订意图 → **先按下方「多轨接入（默认制作路径）」节做形态判定**；命中多轨形态的走该节，不锁进 Seedance 执行态」 | 把形态判定提到所有意图之前 |
| `:24` | **C**（次 B） | 「已定稿剧本 / 时间轴 + 当前目标是制作、生成、继续或修订视频 → **无论用户是否提到“Seedance”…都立即进入 PART A**。用户未指定模型时，立即锁存 Seedance 路由，并只用一次简短提问确认“Seedance 2.0 还是 2.5”」 | 行条件加「**且形态为直连例外**」；正文改「（PART A 是提示词创作内核，与最终用哪个媒体模型无关）**默认媒体模型是 freevideo / MiniMax-H3**：用户未指定模型时直接按 freevideo 继续，**不再询问“Seedance 2.0 还是 2.5”**；只有用户明确点名 Seedance 时才按 2.0/2.5 路由并确认版本」 | 入口行被双重收紧 |
| `:26` | **B** | 行「Seedance 任务中用户未指定模型 → **必须先确认目标模型**。只问一次“Seedance 2.0 还是 2.5”」 | 行改「直连例外形态下用户未指定模型 → **默认 freevideo / MiniMax-H3，直接继续，不再询问 Seedance 版本**。媒体资产生成（视频与图片）默认走 freevideo 供应商」 | 强制确认变成不问 |
| `:27` | **C** | 行「Seedance 任务中用户已指定 2.0/2.5 → 直接执行 PART A」 | 行改「用户明确点名 Seedance 2.0 / 2.5 → 按点名版本执行 PART A」 | 从「已指定」收紧到「明确点名」 |
| `:31` | **C** | 「该内嵌规则是本 workflow 在 Seedance 提示词生成阶段的**最高优先级**执行规范……若本 workflow 其他段落、references/methods、storyboard 或旧说明与其冲突，**以当前内嵌 PART A 为准**」 | 「……是本 workflow 在**直连例外形态下**的 Seedance 提示词生成阶段的最高优先级执行规范……**该最高优先级不适用于多轨形态**：多轨产物格式以 assetCard runbook §四 与多轨模板 §四 为准，PART A 的 A9.1/A9.2 字段结构不得进入多轨产物」 | 核心 C 类，题面已点名 |
| `:33` | A | 无 | 新增一级标题「### 多轨接入（默认制作路径）」整节（含三条例、形态判定、禁止绕过回写） | 新路径入口 |
| `:45` | **D** | 无 | 「**多轨产物格式硬隔离（强制）**：命中多轨形态后，本段产物只能是 `clips[].prompt` 三字段里的 MiniMax H3 官方 ref2va 六段……**PART A 的 Seedance 字段结构一律禁止进入多轨产物**：A9.1「资产标识 + 正式提示词」外壳，以及 A9.2 的 `Objective` / `Reference binding` / `Immutable locks` / `Target duration` / `Timeline` / `Visual direction` / `Audio direction` / `Preserve` / `Avoid` 字段，都不得出现……」 | 对新增路径是 A，对其他供应商是 D（见第五节 E2） |
| `:52` | **C** | 「当前意图是制作视频、生成视频、继续视频、修订视频、准备视频生成、把剧情做成视频，或对即将生成的视频进行配置」 | 加限定「当前意图是**直连例外形态下**的制作视频……」 | 自动路由的判定条件收紧 |
| `:54` | **C** | 「一旦命中，立即锁存为 **Seedance 执行态**」 | 「命中前先按「多轨接入」节做形态判定。**多轨形态下 PART A 仍作提示词创作内核**……**A0 不问“Seedance 2.0 还是 2.5”**——多轨工程模型按工程声明（默认 FreeVideo MiniMax-H3）」 | 锁存前插一道判定 |
| `:57` | **B** | 「用户没有指定 2.0/2.5 时，**必须在 Seedance 路由已经锁存后，用一次简短提问确认“Seedance 2.0 还是 2.5”**」 | 「**默认媒体模型是 freevideo / MiniMax-H3，未点名 Seedance 时不询问版本。** 直接以 freevideo 作为 A0 目标模型继续 PART A，执行层 `node:setConfig` 按 `{ providerId: "freevideo", modelId: "MiniMax-H3" }` 下发；只有用户明确点名 Seedance 时才提问」 | 默认值 + 行为双变 |
| `:59` | **C** | 「**目标模型确认与执行配置询问分开。** 未指定 2.0/2.5 时，先在 A0 内确认目标模型；确认后……」 | 「需要确认模型（**仅点名 Seedance 时**）就在 A0 内确认；确认后……」 | 触发条件收窄 |
| `:74` | **C** | 「……才退出提示词硬隔离，进入 `canvasExecution.md` / `stateAndDelivery.md` 的**执行层**」 | 「……才退出提示词硬隔离：**先按「多轨接入」节做形态判定**——多轨 → runbook §十三/§十五·五；直连例外 → canvasExecution / stateAndDelivery 的执行层」 | 执行层分叉 |
| `:85` | **C** | 「本节与 workflow 其他内容冲突时，**本节优先**」 | 「**优先边界**：本节仅在**直连例外形态下优先**——直连例外时与 workflow 其他内容冲突以本节为准；命中多轨形态时本节不享受该优先级」 | 与 `:31` 同源，两处表述 |
| `:94` | **B** | A0-1「**如果用户没说，必须用一次简短提问确认“Seedance 2.0 还是 2.5”后再继续**」 | A0-1「**默认目标是 freevideo / MiniMax-H3，用户未点名 Seedance 时直接用 freevideo 继续，不做版本提问**。只有用户明确点名 Seedance 而未说版本时，才用一次简短提问确认」 | PART A 内部 A0 同口径 |
| `:386` | A | 硬上限只有 Seedance 2.0 ≤15s / 2.5 ≤30s | 新增「freevideo / MiniMax-H3（默认）：每段 2–60s 整数，逐秒可调；单段 ≥ 30s 会被引擎自动分块，此时参考图实限 3 张（见 assetCard runbook §五）」 | 新增默认模型的时长/参考上限 |
| `:804` | **D** | 「Seedance 2.0 → 使用 A9.1；Seedance 2.5 → 使用 A9.2」 | 新增一行「freevideo / MiniMax-H3（默认） → **不使用 A9 外壳**；直连例外按 canvas 三段式写；多轨按 runbook §四 的 `clips[].prompt` 三字段写（正文英文，段首写 `integrated_multimodal_description:` / `overall_soundscape:` / `non_diegetic_music:`……）」 | 交付外壳按模型分叉 |
| `:1373` | **C** | 「实际制作默认在当前画布呈现，但 **Seedance 路由优先于画布发现与配置**：若已有可执行剧本/时间轴且当前目标是视频制作……必须先按本文件 PART A 完成……」 | 「……**直连例外形态下** Seedance 路由优先于画布发现与配置……**命中多轨形态时不适用本条**：按「多轨接入」节走 assetCard 链路」 | 优先级条款条件化 |
| `:1379` | **D** | 阶段表行「3. Seedance 提示词 → 只执行本文件内嵌 PART A（2.0 走 A9.1、2.5 走 A9.2）」 | 行标题改「3. Seedance 提示词（**直连例外形态**）」，并加「多轨形态改按 runbook §四 写 `clips[].prompt` 的 ref2va 六段」 | 阶段成果按形态分叉 |
| `:1383` | **C** | 「一个剧情片段可以有多个镜头，默认对应一份完整提示词、一个视频生成节点；不默认给每个镜头先生成关键帧」 | 原句加「直连例外形态下」，并追加「多轨工程中不逐段手建视频节点——节点由派工清单建/复用（runbook §一步 1.5、§十三.2），画布节点只是执行载体」 | 直连建节点纪律被限制形态 |
| `:1399` | **C** | 「Seedance 成品提示词之后的媒体执行与验收 → canvasExecution、stateAndDelivery」 | 「……**先按「多轨接入」节做形态判定**：多轨 → runbook §十三/§十五·五；直连例外 → canvasExecution、stateAndDelivery」 | 参考表分叉 |
| `:1412` | **B** | 「Seedance 目标模型只按 PART A A0 判定；**未指定时必须先用一次简短提问确认 2.0 或 2.5。**」 | 「目标模型默认 freevideo / MiniMax-H3，**用户未点名 Seedance 时不询问版本，直接按 freevideo 继续**；只有用户明确点名 Seedance 而未说 2.0/2.5 时，才按 A0 用一次简短提问确认」 | 授权章节同口径 |

### 4.4 `packages/skills/workflow/references/canvasExecution.md`（3 处）

diff 前像：`8974749`；后像：`19ec4db`。hunk 头：`@@ -1,5 +1,7 @@`、`@@ -65,7 +67,7 @@`、`@@ -77,7 +79,7 @@`。

| 位置 | 类 | 原（master） | 现（merge-v1） | 备注 |
|---|---|---|---|---|
| `:3` | **C** | 文件开头只有「Seedance 使用边界」引用块 | 新增引用块：「**适用边界：** 本文件是**直连例外**形态的执行手册。视频生成先按主 `SKILL.md`「多轨接入」节做形态判定——存在 `story.mtrack`……立即转 runbook §十三/§十五·五，**不在本文件路径上继续**」 | 整份执行手册被降级为分支手册 |
| `:70` | **B** | 「……并完成 A0 目标模型确认之后；**若用户未指定 2.0/2.5，主 PART A 必须先用一次简短提问确认**」 | 「……**默认目标是 freevideo / MiniMax-H3，用户未点名 Seedance 时不询问 2.0/2.5**，只有用户明确点名 Seedance 且未说版本时，才由主 PART A 用一次简短提问确认」 | 默认值 |
| `:82` | **C** | 「……经 `nodeTools` 调用实际 `node:generateImage` 或 `node:generateVideo`……不绕过画布改走直接媒体工具」 | 追加「**也不得对属于某多轨工程的镜头用本路径绕过回写**（多轨选段生成同样只走画布 `nodeTools` 并直接回写工程，`directDispatch.ts` 的实现即此口径）」 | 原路径被加禁区 |

### 4.5 `packages/skills/workflow/references/stateAndDelivery.md`（2 处，全 A）

diff 前像：`0012e02`；后像：`3f6cfdb`。hunk 头：`@@ -56,6 +56,8 @@`、`@@ -68,6 +70,8 @@`。

| 位置 | 类 | 内容 | 备注 |
|---|---|---|---|
| `:59` | A | 新增「**多轨项目口径**：状态真源 = `story.mtrack` 的 `clip.status`……`generated` ≠ 交付完成……合成交付以 `planOperator` `composite` 为准（只拼 `accepted` 段）」 | 原台账语义未动 |
| `:73` | A | 新增「**多轨项目口径**：`clip.status = "accepted"` 由**用户在编辑器里点“验收”按钮**写入，不由 Agent 主动回写」，并给出代码锚点（`clipEditor.vue:7`、`multitrackEditor.vue:905`、`multitrackNode/src/index.vue:346`、`planOperator/src/index.ts:104`） | 纯补充说明 |

### 4.6 `packages/skills/v118workflow/SKILL.md`（2 处）

diff 前像：`6cb5594`；后像：`39b301c`。hunk 头：`@@ -2,7 +2,7 @@`、`@@ -10,6 +10,8 @@`。

| 位置 | 类 | 原（master） | 现（merge-v1） | 备注 |
|---|---|---|---|---|
| `:5` | A | `version: "1.1.0"` | `version: "1.1.1"` | 版本号 |
| `:13` | **C** | 无 | 「> **边界：** 本技能是 **v1.1.8 历史流程复现**，不含多轨工程（`story.mtrack`）制作……本流程的逐节点直连口径**仅用于旧版工程续作**」 | 把整个技能排除在多轨之外；同时**使用了版本叙事**，与本轮写作约束冲突 |

### 4.7 `packages/skills/assetCard/**`（7 个文件 + 3 处未提交增量）

| 位置 | 类 | 内容 | 备注 |
|---|---|---|---|
| `assetCard/SKILL.md` | A | 新增技能入口 102 行：资产卡契约、工具表、能力边界表 | master 无 assetCard 技能 |
| `assetCard/references/generationRunbook.md` | A | 新增 799 行 SOP（§〇～§十九，含 §十三 逐镜批量、§十五·五 15 个 `node:` 函数） | 纯新增 |
| `assetCard/references/multitrackTemplate.md` | A | 新增 254 行多轨工程模板（§四 ref2va 六段模板、V7 编号校验） | 纯新增 |
| `assetCard/references/referenceResolution.md` | A | 新增 166 行参考接线解析规则 | 纯新增 |
| `assetCard/references/imagePrompt.md` | A | 新增 25 464 B：「freevideo-image 硬约束（尺寸档只有 1K/2K、无 4K/8K）」「三类模板」等，全文 11 处 `freevideo` | **未跟踪**；是「图片默认走 freevideo」这条 B 类改动的落地依据 |
| `assetCard/references/assetDesign.md` | A | 新增 20 864 B：角色四视图/场景空间/道具状态的设计维度与验收 | **未跟踪** |
| `assetCard/SKILL.md:29-30` | A | 未提交增量：工具表新增两行，指向 `references/imagePrompt.md` 与 `references/assetDesign.md` | 与前两个未跟踪文件绑定 |
| `assetCard/SKILL.md:97` | **D**（澄清型） | 原「原生 context latent 续接 ❌ 无 → `firstFrame` 首帧续接（上一镜末帧）」；现加「**仅单镜直连路径可用**；多轨工程的 `continuity` 只支持 `start` 与 `cut`（`continue` 字段可填，生成侧尚未实现），跨镜续接尚未实现，不要在多轨里承诺首帧续接」 | 收回一项原有能力承诺 |
| `assetCard/references/assetCardTemplate.md:3,36` | A | 未提交增量：链接到 imagePrompt.md / assetDesign.md | 同上 |
| `assetCard/references/multitrackTemplate.md:168` | **D**（示例修正） | 示例正文 `C01 (Picture 1)` → `C01 (<Picture 1>)`，`SC02 (Picture 4)` → `SC02 (<Picture 4>)` | 示例标记补成官方尖括号形态 |

> 记账说明：`assetCard/references/assetCardTemplate.md`（+110 行的新增文件）已列在第二节 #2，此处只列它的未提交增量，不重复计数；其余 5 个新增文件各占一行。

## 五、C / D 类集中清单与兼容性判定（核心）

判定问题：**若用户使用的是 master 时代的非 freevideo 供应商，这处改动会不会让他拿不到原来能拿到的东西？**

### 5.1 C 类逐处判定

| # | 位置 | 收紧点 | 非 freevideo 用户会失去什么 | 结论 |
|---|---|---|---|---|
| C1 | `canvas/SKILL.md:24` | 视频制作前先进形态判定；「分镜批量、跨镜连续性、需要状态回写」→ 多轨 | master 的默认生产方式就是「从完整剧本拆多个片段、每片段一节点直连」；新闸门把「分镜批量」直接判给多轨。不点名要单条视频就**走不回原直连形态** | **会**：路径改道，不是格式丢失 |
| C2 | `canvas/SKILL.md:26` | 原直连段落加「直连例外形态下」 | 该段落的默认地位被降级为示例分支 | 会（同 C1） |
| C3 | `videoProduction.md:42` | 片段→节点映射表只覆盖直连例外 | 多片段多节点直连不再有表格依据 | 会（同 C1） |
| C4 | `workflow/SKILL.md:21` | 任何视频意图先做形态判定 | master 的「无条件进入 PART A」被前置 | 会 |
| C5 | `workflow/SKILL.md:24` | 入口行加「且形态为直连例外」 | 定稿剧本 + 视频意图不再自动进 PART A | **会**：这是题面点名的「PART A 从无条件优先变仅直连例外优先」 |
| C6 | `workflow/SKILL.md:27` | 「已指定 2.0/2.5」→「明确点名」 | 隐式指定（如只回「2.5」）不再成立为模型指令 | 会（弱：仍有「短答案」条款兜底，`:60`） |
| C7 | `workflow/SKILL.md:31` | PART A 最高优先级 → 仅直连例外 | 多轨形态下 PART A 失去「冲突以我为准」 | **会**（多轨内） |
| C8 | `workflow/SKILL.md:52` | Seedance 自动路由条件加「直连例外形态下」 | 不再「无论是否提到 Seedance 都自动锁存」 | **会** |
| C9 | `workflow/SKILL.md:54` | 锁存前插入形态判定；多轨不问版本 | 多轨内无 Seedance 版本确认入口 | 会（多轨内） |
| C10 | `workflow/SKILL.md:59` | 目标模型确认仅在点名 Seedance 时 | 未点名时不再确认模型 | 会（并入 B 类后果） |
| C11 | `workflow/SKILL.md:74` | 退出提示词硬隔离后按形态分叉执行层 | canvasExecution / stateAndDelivery 不再是唯一执行层 | 会（多轨内） |
| C12 | `workflow/SKILL.md:85` | 「本节优先」→ 仅直连例外优先 | 与 C7 同源 | **会** |
| C13 | `workflow/SKILL.md:1373` | 画布优先条款条件化 | 多轨形态下不再要求先做 PART A 再读画布 | 会（多轨内） |
| C14 | `workflow/SKILL.md:1383` | 直连建节点纪律限定形态 | 多轨内不得逐段手建视频节点 | 会（多轨内） |
| C15 | `workflow/SKILL.md:1399` | methods 执行/验收路径分叉 | 参考表不再唯一 | 会（弱） |
| C16 | `canvasExecution.md:3` | 整份手册限定为直连例外 | 多轨任务不得在本文件路径继续 | **会**（多轨内） |
| C17 | `canvasExecution.md:82` | 多轨镜头禁止绕过回写 | master 允许多节点直连生成；属多轨工程的镜头失去该形态 | **会** |
| C18 | `v118workflow/SKILL.md:13` | 整个技能排除多轨 | v1.1.8 流程不能用于多轨新项目 | 不会（能力上本就不同路径） |

### 5.2 D 类逐处判定

| # | 位置 | 变了什么格式/语义 | 非 freevideo 用户会失去什么 | 结论 |
|---|---|---|---|---|
| D1 | `canvas/SKILL.md:106` | 旧REF占位标记指令标注为「直连视频节点沿用」 | 直连不受损；多轨内不得再用旧标记 | 直连不影响 |
| D2 | `canvas/SKILL.md:107` | 多轨强制官方 `<Picture N>`，禁旧标记 | 直连不受损 | 多轨内影响 |
| D3 | `videoProduction.md:64` | 同 D1 | 同 D1 | 直连不影响 |
| D4 | `videoProduction.md:69` | 同 D1 | 同 D1 | 直连不影响 |
| D5 | `videoProduction.md:71` | 「一套内容两套外壳」：多轨 six-段 | 直连仍写三段式 | 直连不影响 |
| D6 | `videoProduction.md:100` | 示例收窄为「非多轨工程形态」 | 无实质损失，仅示例适用范围 | 不影响 |
| D7 | `workflow/SKILL.md:45` | **多轨产物只能是 H3 ref2va 六段；A9.1/A9.2 字段一律禁止进入多轨产物** | 见 5.3 | **会（硬冲突）** |
| D8 | `workflow/SKILL.md:804` | 交付外壳按模型分叉：freevideo 不用 A9 | 点名 Seedance 仍走 A9.1/A9.2，未受损；未点名者默认拿到非 A9 外壳 | 点名不影响 |
| D9 | `workflow/SKILL.md:1379` | 阶段 3 成果按形态分叉 | 多轨内不再产出 A9 外壳 | 会（多轨内） |
| D10 | `assetCard/SKILL.md:97` | 收回「首帧续接」能力承诺（多轨 continuity 只支持 start/cut） | master 在直连路径下从未承诺多轨续接，此项属新增路径的真实能力澄清 | 不影响 master 路径 |
| D11 | `assetCard/references/multitrackTemplate.md:168` | 示例参考标记补尖括号 | 示例与官方语法对齐 | 不影响 |

### 5.3 最危险的一条：D7（多轨硬隔离 × 用户改模型）

代码事实（不可假设，已逐行核对）：

| 事实 | 位置 | 含义 |
|---|---|---|
| wire 层参考标记换算只在 `providerId === "freevideo"` 时生效 | `packages/nodes/videoGenerationNode/src/index.vue:227-228`（`const tags = selectedModel.value?.providerId === "freevideo" ? referenceTags(refList.value) : undefined;`） | 非 freevideo 供应商拿到的仍是原始文本 |
| 另有一层**无条件**归一化：以 Picture/Video/Audio 词根写的双花括号标记会被转成 `<Picture N>` 等 | `packages/nodes/videoGenerationNode/src/index.vue:229-231` | 「非 freevideo 保持原始文本」只对旧REF占位标记成立 |
| 多轨 UI 的模型下拉写 `global.model`，派工时作为 `node:setConfig` 下发 | `packages/nodeShared/src/mtrack/multitrackEditor.vue:665-670`、`packages/nodeShared/src/mtrack/directDispatch.ts:379-380` | 用户**可以**在多轨工程里把模型切成非 freevideo，且会被真正执行 |
| 多轨派工把 `clips[].prompt` 三字段拼成 prompt 后 `node:setPrompt` | `packages/nodeShared/src/mtrack/directDispatch.ts:88-107,446` | 多轨产物走的就是 videoGenerationNode 的 `generationPrompt` |

由此得冲突链：用户在多轨工程里把视频模型改成非 freevideo → 派工把 H3 六段 + `<Picture N>` / `<Subject N>` 原样写入 → 该供应商既不认 H3 ref2va 语法，也不认尖括号标记 → 而 `workflow/SKILL.md:45` 明令禁止改写成该供应商的 A9.1/A9.2 外壳 → **用户拿不到该供应商的正确格式**。这是本轮唯一「引导层明确规定了一个会产出错误格式的动作」的位置。

## 六、三条最危险的兼容断点（按危害排序）

1. **「分镜批量」触发词把 master 的默认直连路径改道到多轨**（C1/C3/C15/C16/C17）
   证据：`canvas/SKILL.md:24`、`workflow/SKILL.md:21`、`workflow/SKILL.md:1383`、`canvasExecution.md:3`。master 的默认生产模式（完整剧本拆多片段 → 每片段一视频节点多参生成）恰好命中「分镜批量」，于是**不点名要单条视频就走不到原路径**。这是面积最大的一处 C 类。

2. **多轨硬隔离与「UI 可切模型」直接抵触**（D7 + C9）
   证据：`workflow/SKILL.md:45`、`workflow/SKILL.md:54`、`videoGenerationNode/src/index.vue:227-228`、`multitrackEditor.vue:665-670`。引导层假设多轨只走 FreeVideo（「多轨工程模型按工程声明（默认 FreeVideo MiniMax-H3）」），但 UI 与派工链允许切换，切换后没有任何一条引导规定该供应商的格式。

3. **PART A 从「无条件最高优先级」缩成「仅直连例外优先」**（C5/C7/C8/C12）
   证据：`workflow/SKILL.md:24`、`:31`、`:52`、`:85`、`:1373`。master 的强承诺是「无论用户是否提到 Seedance 都立即进入 PART A」「未指定模型就锁存 Seedance 路由并问 2.0 还是 2.5」；现在同一入口先过形态判定、未点名默认 freevideo、且不再询问版本。**同一规则目前写在 5 处**（`:24`、`:31`、`:57`、`:85`、`:94`，再加 `:1373`、`:1412`），正是题面所说「上一轮的漂移源」，本轮并未收敛。

## 七、对 captain 背景的四点校正（供下游直接引用）

| # | captain 背景说法 | 实测 | 影响 |
|---|---|---|---|
| 1 | 「v118workflow 三份文件上一轮已整体回退到 HEAD，不纳入本轮改动」 | `git diff master -- packages/skills/v118workflow/SKILL.md` 仍有 4 行：`:5` 版本 1.1.0→1.1.1、`:13` 新增边界段 | 若不处理，merge-v1 会带着一段**版本叙事**（「v1.1.8 历史流程复现」「仅用于旧版工程续作」）落地，违反本轮「一律条件句、不用版本叙事」的写作约束 |
| 2 | 「11 文件、+1497/−33」 | 该数字只含 git 跟踪文件；另有 `imagePrompt.md`（25 464 B）、`assetDesign.md`（20 864 B）**未跟踪**，且被 4 处链接引用 | 提交漏 `git add` → 链接悬空；diff 数字也少算约 46 KB 新增正文 |
| 3 | 「assetCard 整套已定稿」 | `git status` 显示 assetCard 三文件仍有未提交增量（+6/−4）：`SKILL.md` 工具表与能力边界、`assetCardTemplate.md` 链接、`multitrackTemplate.md:168` 示例标记 | 「assetCard 已定稿」为时过早，三处增量属本轮实际差异 |
| 4 | 「代码事实：参考标记换算只在 freevideo 时生效，其他供应商保持原始文本」 | 成立，但仅对**旧REF占位标记**成立；`index.vue:229-231` 还有一层对所有供应商生效的归一化（Picture/Video/Audio 词根的双花括号 → 尖括号） | 下游若据此断言「非 freevideo 一律原样透传」会错；正确表述是「旧REF占位标记原样透传」 |

## 八、移交下游的判定输入

下一位成员（分流设计 / 三条路径方案）可直接取用三根分叉轴：

| 轴 | 取值 | 依据位置 |
|---|---|---|
| 工程形态 | 多轨（存在 `.mtrack` / 分镜批量 / 跨镜连续性 / 状态回写） vs 直连例外 | `workflow/SKILL.md:33-45`、`canvas/SKILL.md:24` |
| 供应商 | freevideo（本地默认） vs 点名其他（Seedance 2.0/2.5、其他图像模型） | `canvas/SKILL.md:120`、`videoProduction.md:79`、`workflow/SKILL.md:57` |
| 产物外壳 | H3 ref2va 六段 + 官方尖括号标记 vs 三段式（直连 freevideo） vs A9.1/A9.2（点名 Seedance） | `workflow/SKILL.md:45`、`:804`、`videoProduction.md:45` |

未解决、且必须由方案阶段回答的三问：

1. 形态判定的触发词「分镜批量 / 跨镜连续性 / 需要状态回写」是否需要更有边界，否则 master 默认路径将被吞掉（C1）。
2. 多轨工程内用户切到非 freevideo 时，六段硬隔离让位给谁——按供应商分流，还是禁止切换（D7）。
3. PART A 的优先级规则目前散在 5–7 处，是否需要单一来源（第六节第 3 条）。

---

*盘点完成时间：2026-10-23；盘点方式：`git diff master` 逐文件逐 hunk 阅读 + 代码事实核对（`videoGenerationNode/src/index.vue`、`directDispatch.ts`、`multitrackEditor.vue`）。本文档之外未改动任何文件。*
