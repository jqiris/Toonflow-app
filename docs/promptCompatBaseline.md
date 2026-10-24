# master 基线盘点：原有内置提示词引导全貌

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 用途：本轮「freevideo / MiniMax-H3 提示词格式 与 master 原格式兼容性」讨论的**唯一基准**。
> 口径：全部结论取自 `master` 分支（`git show master:<路径>`），不参考工作区现状。
> 盘点命令：`git ls-tree -r --name-only master -- packages/skills`、`git show master:<文件>`、`git grep -n <关键词> master -- packages/skills`。
> 术语约定：画布 mention chip 插入的参考标记（双花括号包 ref 加序号）在本文档统一称「**旧REF占位标记**」，不写其字面量。

## 0. master 分支的技能面（先看边界）

master 的 `packages/skills` 只有**三个**技能包：

| 技能包 | 定位 | 关键入口 |
| --- | --- | --- |
| `canvas` | 画布操作手册 + 画布映射（单节点直连链路） | `packages/skills/canvas/SKILL.md:22`、`packages/skills/canvas/references/videoProduction.md:1` |
| `workflow` | 制片工作流，内嵌 SEEDANCE EPISODE DIRECTOR PART A（导演规则唯一来源） | `packages/skills/workflow/SKILL.md:23`、`packages/skills/workflow/SKILL.md:68-72` |
| `v118workflow` | v1.1.8 分集流程复现 + 多画风/多模型模板知识库 | `packages/skills/v118workflow/SKILL.md:11-15` |

三个直接事实：

1. **master 没有 `packages/skills/script` 技能包**（`git ls-tree master -- packages/skills/` 只列出 canvas / v118workflow / workflow）。但 canvas 有两处硬链接指向它，属**悬空引用**：`packages/skills/canvas/SKILL.md:24`、`packages/skills/canvas/references/videoProduction.md:9`（另见同文件 `:69`）。
2. 悬空引用有**显式降级规则**：`packages/skills/canvas/SKILL.md:26`「跨技能的 `script` 规范按 `available_skills` 中实际 `location` 定位；依赖缺失时说明缺项，仅继续不依赖它的结构操作，不凭简介补造规范」——基线允许依赖缺失，但禁止用简介顶替规范。
3. **master 完全没有「多轨 / freevideo / MiniMax」概念**：`git grep -i -E "多轨|multitrack|freevideo|minimax" master -- packages/skills` 零命中。即本轮新增是**新形态**，不是对既有形态的改写。

---

## 1. 基线格式清单表

### 1.1 canvas 链（单节点直连，画布映射）

| 文件:行 | 面向媒体 | 面向供应商/模型 | 提示词格式 | 参考标记写法 | 默认模型行为 |
| --- | --- | --- | --- | --- | --- |
| `packages/skills/canvas/SKILL.md:24` | 图片（资产） | 未锁定；写前要求读 `script/references/assetGuide.md` | 资产图规范（角色面部特写 + 正侧背三视图） | 未规定 | 未指定模型时**优先 gpt-image**（`:114`） |
| `packages/skills/canvas/SKILL.md:103` | 视频 | 未锁定 | 「一份专用视频提示词」 | 旧REF占位标记 + 素材名称 + 用途，经 `node:setPrompt` 写入 | 连线成功不等于已绑定素材 |
| `packages/skills/canvas/references/videoProduction.md:7` | 视频 | **Seedance 2.0/2.5 多参（默认路线）** | 多参提示词；一片段多镜头 → 一份提示词 → 一个视频节点；不默认关键帧 | 旧REF占位标记 | 默认即 Seedance 2.0/2.5 |
| `packages/skills/canvas/references/videoProduction.md:42,69` | 视频 | 同上 | **三段式**：真实素材定义 → 顺序镜头（动作/空间/单一主运镜/台词/声音）→ 风格与必要约束 | 提示词开头用旧REF占位标记定义主体/场景/道具 | 同上 |
| `packages/skills/canvas/references/videoProduction.md:67` | 视频 | 同上 | 编号来源：入边顺序 + `data.referenceOrder`（键为 `encodeURIComponent(JSON.stringify([source,sourceHandle]))`），第 N 项即 ref N | 旧REF占位标记（编号不得猜） | 同上 |
| `packages/skills/canvas/references/videoProduction.md:77` | 图片/视频 | 视频未定模型时 → Seedance 2.0/2.5 多参；图片未定 → gpt-image 系列 | 同上 | 同上 | 视频比例默认 `9:16`、声音默认开；图片比例默认 `16:9`（`:81`） |
| `packages/skills/canvas/references/videoProduction.md:83` | 视频 | 同上 | 「正式 Seedance 提示词默认按镜号组织而不写绝对秒数时间轴」 | 同上 | 同上 |

补充：canvas 链把**编号核对**做成硬前置——先接线、再读完整入边、再读 `referenceOrder`、最后 `setPrompt`；编号无法确认时不猜、不触发生成（`packages/skills/canvas/references/videoProduction.md:64`）。

### 1.2 workflow 链（内嵌 PART A，导演规则）

| 文件:行 | 面向媒体 | 面向供应商/模型 | 提示词格式 | 参考标记写法 | 默认模型行为 |
| --- | --- | --- | --- | --- | --- |
| `packages/skills/workflow/SKILL.md:23` | 视频 | **Seedance 2.0 / 2.5（唯一路由）** | PART A A0–A12 | 见 1.2.1 | 未指定模型 → **锁存 Seedance 路由**，只问一次「2.0 还是 2.5」（`:25-26`、`:42`、`:79`） |
| `packages/skills/workflow/SKILL.md:791-846` | 视频 | Seedance **2.0** | **A9.1 外壳**：资产标识（涉及角色/场景/关键道具）+ 正式提示词（人物空间关系 / 镜头 N-x 分章 / 光线 / 声音 / 正向锁 / 文字锁） | 见 1.2.1 | 2.0 走 A9.1（`:786`） |
| `packages/skills/workflow/SKILL.md:848-916` | 视频 | Seedance **2.5** | **A9.2 外壳**：`Objective` / `Reference binding` / `Immutable locks` / `Target duration` / `Timeline` / `Visual direction` / `Audio direction` / `Preserve` / `Avoid` 九字段白名单；`Timeline` 用时间块 + 连续自然语言（`:918-950`） | 见 1.2.1 | 2.5 走 A9.2（`:787`） |
| `packages/skills/workflow/SKILL.md:852-869` | 视频 | 2.5 | **格式硬门（强制）**：出现白名单之外的顶层结构即判定格式失败，「不得交付，必须在本轮直接改写为 A9.2」 | — | — |
| `packages/skills/workflow/SKILL.md:170-186` | 视频 | 2.0 vs 2.5 分语言 | A1.1：正文默认全中文；2.0 结构标题中文；2.5 固定九个英文字段标题、内容仍中文；整段英文仅用户明确要求 | — | — |

#### 1.2.1 workflow 的参考标记写法（两套并存，且语义不同）

| 文件:行 | 形态 | 用途 |
| --- | --- | --- |
| `packages/skills/workflow/SKILL.md:188-205` | **身份句柄**：用户命名标签（`@HERO1V2`、`#老宅客厅`）原样引用；无标签库时用纯中文名（`角色｜林直人`），**不加 @** | 资产标识 |
| `packages/skills/workflow/SKILL.md:217-224` | **真实节点句柄**：用户提供的图片节点/资产句柄原样引用，禁止改名、简写、编造不存在的 Ref | 2.5 `Reference binding` 硬规则 |
| `packages/skills/workflow/SKILL.md:879-887, 952-961` | `Reference binding` 每条一行「真实句柄：简洁资产标识」；**每段自包含**，禁「同上」「沿用上一段参考」 | 2.5 交付字段内容 |
| `packages/skills/workflow/references/canvasExecution.md:54-58` | **传输引用**：宿主用旧REF占位标记作传输语法时，第 N 项只对应真实连接顺序与类型，三类媒体共用编号；执行层映射「不授权把 PART A 已定稿 `Reference binding` 的原始节点/资产句柄改写成另一套用户可见提示词格式」 | 执行层 |

### 1.3 v118workflow 链（旧版模板集，按输入模式分模板）

| 文件:行 | 面向媒体 | 面向供应商/模型 | 提示词格式 | 参考标记写法 | 默认模型行为 |
| --- | --- | --- | --- | --- | --- |
| `packages/skills/v118workflow/references/knowledge/videoPromptCraft.md:7-12` | 视频 | Seedance 2.0 / Wan 2.6 / 首尾帧模式 / 通用多参 | 模式选择表 → 各自模板 | 旧REF占位标记（`:25`：模板出现时只是宿主执行引用占位，编号须回读后填写） | **未指定模型先确认**（`:14`）；「这张表是内容模板选择，不是模型兼容性白名单」 |
| 同上 `:32-59` | 视频 | Seedance 2.0 | **中文三段式**：先定义 `<主体1>/<场景1>/<道具1>` 三类标签（分别编号）→ 按原镜号逐镜（景别+一个主要运镜 / 动作表情 / 位置朝向 / 台词音效）→ 短风格与稳定性约束；`台词用花括号、音效用尖括号`（`:42`） | 旧REF占位标记 + 标签 | 只在确认采用该模型与输入模式时用 |
| 同上 `:72-90` | 视频 | Wan 2.6 | **英文叙事单首帧**：风格基调 → 主体动作与环境 → 摄像机收尾；无尾帧、无参考编号 | 不用编号 | 单图首帧 |
| 同上 `:92-121` | 视频 | 首帧/首尾帧模式 | **英文五段式**：`[Visual]` / `[Motion]` / `[Camera]` / `[Audio]` / `[Narrative]` | 不在正文内编号引用帧 | 起尾帧由真实模式绑定 |
| 同上 `:123-145` | 视频 | 其他多参模式 | **英文 References + Instruction** | 旧REF占位标记；有分镜图才写 composition reference（`:145`） | — |
| `packages/skills/v118workflow/references/knowledge/imagePromptCraft.md:7-11` | 图片（分镜图/首帧） | Seedream（中文段落）/ Nanobanana·Gemini（英文 JSON 结构化） | 两套模板并存：`:49-64` 中文段落；`:68-97` 结构化 JSON（字段是写作组织方式，不代表 API 参数） | 旧REF占位标记；`:11`「实际适配采用其他语法时先核实映射」 | **未指定模型先核对可用选择，不沿用旧文「默认 Seedream」**（`:9`） |
| `packages/skills/v118workflow/references/knowledge/assetDesign.md:5-23` | 图片（资产） | 不绑模型，只给设计卡字段（身份/核心辨识/视觉约定/光源构图/事实与提案/变体/执行选用） | 设计卡 + 分类模板 | — | 画风来自 `visualStyles.md` 当前确认条目 |
| `packages/skills/v118workflow/references/generateAssets.md:26-28` | 图片 | 不绑模型 | 「分别写主体、结构/材质、必要风格和禁止项」；负向词只在模型支持时用 | — | 光照与色调在场景资产统一确认，后续分镜沿用 |

v118 视频链另有三个独立确认停点：准备确认 / 生成结果确认 / 选用与交付确认（`packages/skills/v118workflow/references/videoProduction.md:24,38,52`）。

### 1.4 执行层（wire 事实，非 master，但决定「参考标记」的真实语义）

| 位置 | 事实 |
| --- | --- |
| `packages/nodes/videoGenerationNode/src/index.vue:227-231` | 仅当 `providerId === "freevideo"` 时，把旧REF占位标记换算为该供应商的参考标签语法 `<Picture N>` / `<Video N>` / `<Audio N>`；其他供应商的旧REF占位标记**原样进 prompt 文本**。同时 `<picture/video/audio N>` 形态对**所有**供应商统一归一为 `<Picture N>` 等。 |
| `packages/nodeShared/src/mtrack/directDispatch.ts:88,99` | 注释确认换算统一在 wire 层完成，引擎层不替换。 |

结论：master 的「旧REF占位标记」是**画布层统一编号语法**，供应商适配是 wire 层责任（呼应 `packages/skills/workflow/references/canvasExecution.md:62`：当前画布统一给引用编号，部分供应商适配按图片/视频/音频重新组织请求）。

---

## 2. 基线的默认路径决策链：用户说「帮我做视频」会发生什么

基线不是一条链，而是**按「是否已有可执行剧本 / 命中哪个技能」分流的三条链**。以下为 master 原文推导的步骤序列。

### 2.1 主链 A：命中 workflow（已有定稿剧本 / 时间轴，目标是视频）

1. 入口表先判输入：`packages/skills/workflow/SKILL.md:23` —— 已有定稿剧本 + 目标是制作/生成/继续/修订视频时，**无论用户是否提到「Seedance」「提示词」或具体模型，立即进入内嵌 PART A**。
2. 自动判定的两个条件（`:34-38`）：① 已有可执行剧本/时间轴/已确认片段文本；② 意图是制作、修订、准备生成视频或配置即将生成的视频。命中即**锁存 Seedance 执行态**。
3. **先 PART A，后画布**（`:41`）：不得先调画布读取工具、`node:getConfig`、先问 provider/resolution/ratio/mode，或先做通用分镜。
4. A0 目标模型判定（`:77-79`）：用户说 2.5 → 单段最长 30s；说 2.0 → 15s；**没说就必须用一次简短提问确认「2.0 还是 2.5」**，提问前后都保持锁存。
5. 路由到外壳：2.0 → A9.1（`:786`）；2.5 → A9.2（`:787`）。
6. 内容执行：A0.1 剧情保真锁（`:96-102`，只导演不编剧）→ A2 原子节拍账本 `E##`（`:270-362`）→ A3 分段与时长预算（`:364-460`）→ A4 资产与出镜状态（`:461-552`）→ A5 站位双层坐标（`:553-603`）→ A6 表演层（`:604-648`）→ A7 运镜与段间衔接（`:649-713`）→ A8 跨段连续性（`:714-781`）。
7. 交付外壳：A9 只定义「最终交付外壳」（`:784`），A10 全片总览 + 分批（`:990-1029`）。
8. 一次结构校验 + 一次抛光：A11 结构问题（`:1037`），含 A11.2 只做一轮集中修正且禁止 A11↔A12 递归（`:1078-1088`）、A11.3 剧情保真审计（`:1090-1101`）、A11.4 生成稳定性预检（`:1103-1139`）；随后 A12 单次抛光（`:1144`），A12 完成后「不再返回 A11，不再触发第二次 A12」（`:1323`）。
9. 定稿后才进执行层（`:59`）：用户明确要求连参考 / 写入节点 / 生成验收时，才进 `canvasExecution.md` / `stateAndDelivery.md`；执行层「只能搬运已定稿 prompt、连接真实参考、设置真实模型参数和核验结果，不得重新改写 PART A 已确定的分段、格式、剧情、站位、表演、运镜或连续性」。
10. 执行层顺序（`packages/skills/workflow/references/canvasExecution.md:75-80`）：`node:getConfig` 核能力 → 接线 → `node:setConfig`（`providerId/modelId/duration/resolution/ratio/mode/generateAudio`，`:76`）→ 写完整 prompt → 展示授权 → 临执行复核 → `node:generateVideo`。

**关键性质**：这条链上「用哪个模型、写什么格式」由 **A0 的一次判定**决定，且 `packages/skills/workflow/SKILL.md:1395` 明确禁止任何下游信息反向覆盖：节点默认值、宿主默认值、配置表单、历史配置、用户对分辨率/画幅的回答，都不得覆盖或解除 A0 的模型路由。

### 2.2 主链 B：命中 canvas（无定稿剧本，或用户直接在画布上做单节点链路）

1. 读协作规则（`packages/skills/canvas/SKILL.md:22` → `packages/skills/canvas/references/videoProduction.md:5-24`）：**默认只落实当前已确认阶段**，不因用户说「做一个短片」就一次创建全部分镜与生成节点。
2. 默认路线声明（`packages/skills/canvas/references/videoProduction.md:7`）：**默认采用 Seedance 2.0/2.5 多参生产**——先确认完整剧本，再生成角色/场景/道具资产，再从剧本拆片段，每段全部镜头转成一份视频提示词，资产直接作为视频输入；不默认生成关键帧。
3. 阶段表（同上 `:11-18`）：需求与简报 → 完整剧本 → 资产设计与准备 → 剧本分片段与视频提示词 → 视频小样 → 批量制作与交付。每阶段先用 `askUser` 问「按当前方案继续 / 调整」（`:20`）。
4. 资产阶段：写资产提示词前**必须**读 `script/references/assetGuide.md`（`packages/skills/canvas/SKILL.md:24`；该技能在 master 树中缺失，按 `:26` 说明缺项）。图片未指定模型时优先 gpt-image 系列（`:114`、`videoProduction.md:77`）。
5. 视频提示词阶段：写前必须读 `script/references/productionGuide.md`；正文按**三段式**（`videoProduction.md:42,69`），片段内按原镜号逐镜，一镜一个主要运镜。
6. 落画布：`addNode` → `getNodeTools` → `nodeTools` 填内容（`videoProduction.md:45`）→ 接线 → 核对引用编号（`:64,67`）→ `node:setPrompt` 写入旧REF占位标记 + 名称 + 用途（`packages/skills/canvas/SKILL.md:103`）。
7. 生成前：`node:getConfig` 读真实能力，视频未定模型时按已确认路线选 Seedance 2.0/2.5 多参，比例默认 9:16、声音默认开（`videoProduction.md:77,81`）；展示对象/数量/模型/规格/完整提示词/参考/费用并等授权（`:75`）。
8. 生成后台与完成分开（`videoProduction.md:87-96`）：「已开始」不等于有新素材。

### 2.3 主链 C：命中 v118workflow（明确要做旧版分集复现）

1. 定位进度与画布（`packages/skills/v118workflow/SKILL.md:19-44`）：一个剧本总画布、一个资产总画布、每集一个制作画布。
2. 13 步主流程（`:50-65`），第 7–13 步每集循环（`:67`）。
3. 视频提示词（第 13 步）：先读 `references/knowledge/videoPromptCraft.md` 的模式表（`:7-12`）确定本次**实际输入模式**，再取对应模板；**未指定模型先确认**（`:14`）。
4. 三个停点（`references/videoProduction.md:24,38,52`）逐个确认。
5. 整条链不借用其他 workflow 的模型路由：`packages/skills/v118workflow/SKILL.md:15`「不自动套用其他 workflow 的模型路由」；`references/knowledge/videoPromptCraft.md:3`「不引入其他 workflow 的 Seedance 路由或默认模型」。

---

## 3. 基线已有的多供应商共存设计（master 怎么做 Seedance / Seedream / Nanobanana / Wan）

master **不是「不管」，也不是「一套格式打天下」**，而是六种手法叠加：

### 3.1 分层隔离：不同技能包不互相传染模型口径

- `packages/skills/v118workflow/SKILL.md:15`：不自动套用其他 workflow 的模型路由。
- `packages/skills/v118workflow/references/knowledge/videoPromptCraft.md:3`：本文件吸收 v1.1.8 四份模型提示词，**不引入其他 workflow 的 Seedance 路由或默认模型**。
- 后果：workflow 的「Seedance 默认」不会漂到 v118；v118 的「未指定先确认」也不会漂回 workflow。

### 3.2 单点路由 + 白名单硬门

- 路由键只有一个：目标模型（2.0 / 2.5），分支只有两个（`packages/skills/workflow/SKILL.md:786-787`）。
- 2.5 有**字段白名单硬门**（`:852-869`）与最终勾选项（`:1343`）。白名单之外的结构 = 格式失败 = 不得交付。
- 意义：格式正确性可判定、可自检，不靠「看起来像」。

### 3.3 条件句 + 先查真实能力，不写死兼容性白名单

- `packages/skills/v118workflow/references/knowledge/videoPromptCraft.md:14`：「这张表是内容模板选择，不是模型兼容性白名单。先查模型支持的媒体类型/数量、模式、时长、分辨率、声音与当前节点配置。」
- `packages/skills/v118workflow/references/videoProduction.md:13`：「读取当前视频模型实际支持的输入、参考数量、时长、分辨率、比例、音频和模式，**不强制 Seedance**。」
- `packages/skills/canvas/SKILL.md:114`：「图片未指定模型时优先选择可用的 gpt-image，**不能把节点自动默认值当成用户选择**。」
- `packages/skills/canvas/references/videoProduction.md:77`：「不能只因名称相同就假定支持所需素材、数量和规格。」

### 3.4 模板内容与传输标记分离

- 模板正文只写画面/镜头/台词/声音（A9.1/A9.2、v118 各模板），**不写节点 ID、不写编号**。
- 编号由真实连线与 `referenceOrder` 决定（`packages/skills/canvas/references/videoProduction.md:67`），执行层负责映射（`packages/skills/workflow/references/canvasExecution.md:54-58`），供应商分类型重组请求也归执行层（同文件 `:62`）。
- 可复用性来自这里：同一份提示词内容，换供应商时只需换执行层映射，不必重写内容。

### 3.5 模型身份与执行参数解耦

- 目标模型只在 A0 判定（`packages/skills/workflow/SKILL.md:79`、`:1395`）。
- 配置问答（provider/ratio/resolution/mode/generateAudio）只是同一任务的参数补充，回答不得解除路由（`:44-46`；`packages/skills/workflow/references/canvasExecution.md:66-71`）。
- 用户在执行期改模型，视为 **A0 输入更新**：回 PART A 按新模型重路由正式提示词，不允许「只在节点配置层换模型，继续用另一模型的提示词外壳」（`packages/skills/workflow/references/canvasExecution.md:70`）。
- 实时能力不足时只能报冲突，不得静默用默认模型替换（`packages/skills/workflow/SKILL.md:48`、`:60`）。

### 3.6 语言与字段按模型分支

- 2.0 结构标题中文；2.5 固定九个英文字段标题、内容中文；整段英文仅用户明确要求（`packages/skills/workflow/SKILL.md:183-186`）。
- v118 三种语言形态并存：Seedance 2.0 中文段落、Wan 2.6 英文叙事、Nanobanana 英文 JSON（`videoPromptCraft.md:32-147`、`imagePromptCraft.md:49-97`）。

---

## 4. 基线里值得继承的设计（改动时不应丢的 5 条）

### 4.1 模型 = 唯一路由键，每条路由一个可判定的外壳

`packages/skills/workflow/SKILL.md:782-789` 把「格式」收敛为 A9 一节，且 2.0/2.5 各一个外壳；`:852-869` + `:1343` 给 2.5 一个可判定的硬门。
**为什么值得继承**：新增供应商时，正确做法是「加路由分支 + 加该分支的硬门」，而不是在既有分支里塞条件补丁。硬门让格式错误可被自己发现（对应我们当前最难的第 2 题：非 freevideo 模型下的格式冲突，可复用同一机制表达）。

### 4.2 路由先于执行，执行层不得反写内容

`packages/skills/workflow/SKILL.md:41`（先 PART A 再画布）、`:59`（执行层只能搬运）、`:48`（能力冲突只报不替换）、`:1395`（默认值不得反向覆盖）。
**为什么值得继承**：这正是「freevideo 成为默认后，master 三段式/PART A 会不会被打断」这一问题的现成防线——只要「内容格式由路由决定、执行层只做映射」成立，默认模型变化不会改写内容规则。

### 4.3 同一事实只写一处 + 单向校验，不允许回环

- A9 只定义外壳，不重复 A2–A8（`packages/skills/workflow/SKILL.md:784`）。
- A11.2 只做一轮集中修正，**禁止 A11↔A12 递归**（`:1086`）。
- A11.3 用 `E##` 账本做单向审计（`:1090-1101`）。
- A12 完成一次后不再返回 A11、不再触发第二次 A12（`:1323`）。
- 执行层硬冲突一律「回 PART A 受影响项处理」，不得由画布规则另造兼容提示词（`:60`）。
**为什么值得继承**：这是团队第 4 题（同一规则不得两处重复）在 master 里的直接先例——**单一来源 + 单向校验 + 明确回退点**。我们的新方案必须复制这个形状，不能靠「两处都写、保持一致」来防漂移。

### 4.4 模板内容与传输标记分离，编号永远来自现场

`packages/skills/canvas/references/videoProduction.md:64,67`（入边 + `referenceOrder` 决定第 N 项）、`packages/skills/workflow/references/canvasExecution.md:54-58`（执行层映射不授权改写内容层句柄）、`packages/skills/v118workflow/references/knowledge/imagePromptCraft.md:11`（实际语法不同时先核实映射）。
**为什么值得继承**：wire 层只在 freevideo 下把旧REF占位标记换算成 `<Picture N>`（`packages/nodes/videoGenerationNode/src/index.vue:227-231`），其他供应商原样保留——这恰好证明「标记语义归执行层」。引导层如果开始按供应商写死标记语法，就会与这一分层冲突。

### 4.5 跨技能依赖显式声明 + 缺失降级，不含糊

`packages/skills/canvas/SKILL.md:24,26` + `packages/skills/canvas/references/videoProduction.md:9`：链接到外部 `script` 规范；缺失时「说明缺项，不凭简介补造规范」。
**为什么值得继承**：新增供应商规范必然产生新的跨文件依赖。基线给的做法是「声明依赖 + 说明缺项」，而不是把一个技能的规范复制进另一个技能——这正是我们避免第 4 题（规则两处重复）的现成纪律。

---

## 5. 基线自身的薄弱点（供后续文档引用，不是本轮要修的对象）

1. **默认模型口径分散在三处**：`packages/skills/canvas/references/videoProduction.md:7,77`（Seedance 默认）、`packages/skills/workflow/SKILL.md:23-26,79`（Seedance 锁存 + 必须问 2.0/2.5）、`packages/skills/v118workflow/references/knowledge/videoPromptCraft.md:14`（未指定先确认）。三处措辞已经不完全一致（一处「默认」、一处「必须问」、一处「先确认」）——master 自己也存在需要同步的口径，这是本轮必须正面处理的漂移源。
2. **「默认模型」与「默认格式」在 canvas 链是耦合的**：`packages/skills/canvas/references/videoProduction.md:7` 一句话同时声明了路线（Seedance 多参）和格式（三段式），换默认就会同时改格式。
3. **`script` 技能在仓库内不存在**：canvas 的两处硬链接在 master 上为悬空（`packages/skills/canvas/SKILL.md:24`、`packages/skills/canvas/references/videoProduction.md:9,69`），资产图规范与片段制作指南在基线里是**外部依赖**而非内置实体。
4. **「参考标记」在引导层有三套并存语义**：身份句柄（`workflow/SKILL.md:188-205`）、真实节点句柄（`:217-224`）、画布传输编号（`canvasExecution.md:54-58`）。三者靠文字区分，没有一处统一命名表。

---

## 6. 供后续文档引用的锚点速查

| 主题 | 锚点 |
| --- | --- |
| canvas 默认路线与三段式 | `packages/skills/canvas/references/videoProduction.md:7,42,69,83` |
| canvas 引用编号规则 | `packages/skills/canvas/references/videoProduction.md:64,67`；`packages/skills/canvas/SKILL.md:103` |
| canvas 默认模型（图片/视频） | `packages/skills/canvas/SKILL.md:114`；`packages/skills/canvas/references/videoProduction.md:77,81` |
| workflow 入口锁存 | `packages/skills/workflow/SKILL.md:23-26,34-48,52-62` |
| workflow A0 模型判定 | `packages/skills/workflow/SKILL.md:77-79,1395` |
| A9.1 / A9.2 外壳 | `packages/skills/workflow/SKILL.md:791-846,848-916` |
| 2.5 格式硬门 | `packages/skills/workflow/SKILL.md:852-869,1343` |
| A11 一轮修正 / A11.3 审计 / A11.4 稳定性 | `packages/skills/workflow/SKILL.md:1078-1088,1090-1101,1103-1139` |
| A12 单次抛光与终止 | `packages/skills/workflow/SKILL.md:1144,1299-1323,1346` |
| 执行层边界与配置问答 | `packages/skills/workflow/references/canvasExecution.md:3,54-58,66-71,75-80` |
| v118 模式表与四套模板 | `packages/skills/v118workflow/references/knowledge/videoPromptCraft.md:7-12,32-59,72-90,92-121,123-145` |
| v118 图像两套模板 | `packages/skills/v118workflow/references/knowledge/imagePromptCraft.md:7-11,49-64,68-97` |
| v118 不借用其他 workflow 路由 | `packages/skills/v118workflow/SKILL.md:15`；`.../videoPromptCraft.md:3` |
| wire 层参考标记换算 | `packages/nodes/videoGenerationNode/src/index.vue:227-231`；`packages/nodeShared/src/mtrack/directDispatch.ts:88,99` |

---

## 7. 一句话结论

master 的兼容性设计不是「一套格式」，而是**「模型为唯一路由键 → 每路由一个可判定外壳 → 内容与传输标记分离 → 执行层只搬运 → 单向校验无回环」**。我们引入 freevideo 默认化时，真正需要移植的是这套结构，而不是复制某一段三段式文本；master 的薄弱点是「默认模型口径分散在三处且措辞不一」，这一点不能随改动一起继承下去。
