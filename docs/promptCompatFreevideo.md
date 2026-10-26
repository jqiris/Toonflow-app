> **DEPRECATED (H3 迁移后作废)**：本文档描述老双花括号 ref 占位符与三字段提示词格式，已随 MiniMax H3 官方六段（subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music）与 `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记口径全量迁移后**作废**；权威口径见 `docs/h3PromptAlignment.md`，文件保留不删除，仅作历史追溯。

# freevideo 路径的图片与视频格式规范（设计稿）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。

> **现状更新（2026-10-25）**：① 角色参考板现行唯一版面是 16:9·2K 四栏（半身像腰部以上、正面全身、90° 侧面全身、背面全身；三张全身按脚底线对齐），本文 :75 的「半身像按肩线」已被取代；② 写作者侧参考标记统一 `{{ref N}}`（N = `referenceIds` 位次），`<Picture N>` 只是 wire 层按 `dataType` 换算后的模型侧标记，不是写作者写法——本文 :134（§3.2 六段表「来源写 `<Picture N>`」）、:259（freevideo 六段示例「来源分别写 `<Picture 1>`/`<Picture 2>`」）、:298（§5.2 出稿检查第 2 项「来源写 `<Picture N>`/`<Video N>`/`<Audio N>`」）三处仍是旧写法，按此口径读、不得照抄；③ 资产与分镜接入改由画布「导入资产与分镜」节点（`packages/nodes/assetImportNode`）承接。


> 定位：本文回答「`providerId` 为 `freevideo` 时，提示词该写成什么样」，是 compatibility 方案里 freevideo 这一条分支的**格式权威**。
> 不在本文范围：资产卡的字段契约（见 `packages/skills/assetCard/references/assetCardTemplate.md`）、多轨工程字段（见 `multitrackTemplate.md`）、逐镜执行 SOP（见 `generationRunbook.md`）、画布直连链路（见 `packages/skills/canvas/references/videoProduction.md`）。
> 性质：设计文档，只描述规范，不改技能文件、不改代码。所有结论都标注了代码或文档出处，可直接被其他文档引用。

---

## 〇、结论速览

| 对象 | 一句话定型 | 判定依据 |
| --- | --- | --- |
| freevideo 图片 | **没有格式，只有内容要素清单**：接口吃的是一段自由文本，没有段首字段名、没有负向通道 | `packages/providers/src/media/freevideo.ts:236-263` |
| freevideo 视频（有参考） | **是格式**：MiniMax H3 官方 ref2va 六段，段首逐字、段间空行、顺序固定 | `data/skills/freevideoAgent/references/promptWriting.md:18` |
| freevideo 视频（无参考） | **是格式**：基础三段（正文 + 两个声音字段） | 同上 `:17` |

一句话记忆：**图片写「五件事」，视频写「六段话」**。图片的五件事没有顺序门槛，视频的六段有。

---

## 一、判定入口：agent 凭什么知道现在该写 freevideo 格式

### 1.1 判定键是二元组，不是 `modelId`

格式归属由 **(providerId, modelId)** 决定，且 `providerId` 优先。理由：同一个 `modelId` 会被多家供应商提供——`MiniMax-H3` 在 `freevideo` 之外还出现在 `metaso`（`packages/providers/src/media/metaso.ts:70`）、`apiMart`（`apiMart.ts:191`）、`compshare`（`compshare.ts:1762`）、`tfRouter`（`tfRouter.ts:170`）。只看 `modelId` 会把「别家的 H3」误判成 freevideo 格式。

### 1.2 取 `providerId` 的真实途径（按权威降序）

| 顺序 | 途径 | 拿到什么 | 权威性 | 出处 |
| --- | --- | --- | --- | --- |
| 1 | 视频节点 `node:getConfig` | `config.providerId`、`config.modelId`、`config.duration/resolution/ratio/mode/generateAudio`、可用 `models`、`ratios`、`matchingModes` | **最高**：节点真实配置，就是下发时用的值 | `packages/nodes/videoGenerationNode/src/index.vue:385-399` |
| 2 | 图片节点 `node:getConfig` | `config.providerId`、`config.modelId`、`config.size`、`config.ratio`、可用模型清单 | 最高（图片侧） | `packages/nodes/imageGenerationNode/src/index.vue:407-417` |
| 3 | 用户点名 | 用户明确说的供应商与模型 | 覆盖默认 | `videoProduction.md:79`、`assetCard/SKILL.md:79` |
| 4 | 工程 `story.mtrack` 的 `global.model` | `{ providerId, modelId }` 声明值 | **只是声明**，不是节点真实值 | `packages/tools/planOperator/src/mtrackProject.ts:88-101` |
| 5 | 都没说 | 默认 `freevideo` + `MiniMax-H3`（视频）、`freevideo` + `freevideo-image`（图片） | 兜底 | `videoProduction.md:79`、`assetCard/SKILL.md:79` |

第 4 条为什么不能当权威：界面切模型会把新值写回 `global.model`（`packages/nodeShared/src/mtrack/multitrackEditor.vue:665-671`），派工时该值又作为 `node:setConfig` 的 `providerId/modelId` 真下发（`packages/nodeShared/src/mtrack/directDispatch.ts:369-381`）。也就是说**工程字段会被改、改了会生效**，只有节点回读能确认「这一镜到底跑在谁身上」。

### 1.3 判定决策表

| `config.providerId` | 参考集 | 写什么 |
| --- | --- | --- |
| `freevideo` | 有（≥1 个图/视频/音频参考卡） | 视频 ref2va **六段**（见 §3.2） |
| `freevideo` | 无 | 视频**基础三段**（见 §3.3） |
| `freevideo` | 图片任务 | 图片**五要素正文**（见 §2.2），不写任何段首标签 |
| 其他供应商 | 任意 | 该供应商自己的模板与格式；**不得套六段**，也不得写 `<Picture N>` 当通用标记 |

### 1.4 三个不能用的判法

1. **不能按路径形态判**：多轨工程里模型可被切到别的供应商（§1.2 第 4 条），单镜直连节点也能自由换模型。「多轨 = 六段」在默认配置下成立，在用户切过模型后不成立。
2. **不能按「有没有挂图」判**：挂了图但 `mode` 收缩到 `startFrameOptional` 时，任务是首/尾帧而不是 ref2va，官方口径是基础段落（见 §6 D5）。
3. **不能按名字猜**：`MiniMax`、`H3`、`freevideo-image` 这些字串都不构成格式承诺，只有 `config.providerId` 与供应商 readme 算数。

---

## 二、freevideo 图片：内容要素清单，不是格式

### 2.1 定型与理由

**freevideo 图片没有「提示词格式」这回事。** 接口收一个字符串，直接作为 `prompt` 提交，中间没有任何段落拼装、没有段首校验、没有负向字段（`freevideo.ts:249-257` 只读 `request.prompt`，连同 `width/height/images` 一起进 job）。因此规范只能落在**内容必须写清哪几件事**，而不是「按什么段落顺序写」。

这条定性有三个直接后果：

- 段首标签（`subject_definitions:` 之类）**没有任何语义**，写进去只会被当成画面文字需求，属于错误类比（`imagePrompt.md:16` 已把「把六段套到图片上」列为常见错误）。
- 「无 negative 通道」意味着排除项只能写成正文最后一句「排除：……」，不能写参数名（`imagePrompt.md:230-262`）。
- 「四视图必须一张图」是内容约束不是格式约束：它是版面描述，不是分段协议（`imagePrompt.md:52`）。

### 2.2 必写内容（五要素）

| # | 要素 | 必须写清 | 判定标准 |
| --- | --- | --- | --- |
| 1 | 主体与版面 | 一张卡画谁/画什么；角色四视图要写清四栏从左到右各是什么、各自以哪条线对齐（**已作废**：半身像按肩线；现行四栏为半身像腰部以上、按上半身放大、不按肩线，三张全身按脚底线对齐，见文首「现状更新」） | 只看正文能还原版面，不用看图 |
| 2 | 形貌锚点 | 外貌 4–6 条、服装 3–5 条、空间 4–6 条，**逐字复制**资产卡，不作同义改写 | 与资产卡 `anchor` 字段逐字一致 |
| 3 | 状态与视角 | 当前状态、视角/机位、动作；写状态不写过渡（不写「正在……着」） | 一眼能看出「这一帧停在哪」 |
| 4 | 背景与光 | 角色卡纯色背景；场景卡三层景深 + 光照时段；道具卡白底无手 | 背景与卡型匹配，光有来源 |
| 5 | 排除项 | 以「排除：」起头写正文最后一句，按卡型取最小集，8–12 项封顶 | 正向覆盖优先，不堆词表 |

五要素的详细写法（含每类卡的参考排法）以 `packages/skills/assetCard/references/imagePrompt.md` §四、§五为准，本文不复写，避免同一规则两处漂移。

### 2.3 可选内容

- **尺度参照**（道具卡必备、场景卡可选）：给出可比较的参照物尺寸，避免「多大不知道」。
- **材质与状态分开写**：材质是恒定量，状态是本次变量，混在一起会让锚点失效。
- **参考用途声明**：单参考写「以参考图 1 为身份锚点」；两参考写清哪张定身份、哪张定结构。
- **「图片仅作参考」提示**（视频侧派生用）：可选，不写也不会错。

### 2.4 接口硬约束

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 模型 | `freevideo-image`（`type: "image"`，本机 GPU，不产生外部费用） | `freevideo.ts:224-231` |
| 尺寸 | 只有 `1K` / `2K`；`2K` 基准 2048、`1K` 基准 1024，按比例换算后钳在 256–2048 | `freevideo.ts:70-80`、`:224-231` |
| 比例 | 只有 `1:1`、`16:9`、`9:16`、`4:3`、`3:4` 五档 | `freevideo.ts:230` |
| 模式 | `text`（文生图）、`singleImage`（单参考）、`multiReference`（多参考） | `freevideo.ts:228` |
| 参考图 | ≤ 4 张；超过在提交前抛「这类模型最多支持4张参考图，当前提交了N张」 | `freevideo.ts:246` |
| 负向 | **无** `negative` / `negative_prompt` 通道，`generateImage` 只读 `prompt` | `freevideo.ts:249-257` |
| 输出 | PNG 单张 | `freevideo.ts:258-262` |
| 超时 | 10 分钟（图片 job） | `freevideo.ts:241-242` |

**关于「4 张」的准确表述**（这条很容易被写成引擎能力，必须写清）：

- `imageReference:4` 是 **Toonflow 产品侧**上限（`freevideo.ts:219` 注释、`:207` readme 原文），引擎单块默认可到 9 张。
- 引擎请求体里**没有「参考图数量」字段**——参考图就是 `images` 数组本身，数量由数组长度决定。所以「4」不是引擎声明的能力参数，而是提交前的产品校验。
- 设计结论：按「1 张基卡 + 最多 3 张派生/结构参考」使用；不试探第 5 张，也不因为引擎能收 9 张就把 4 当可配置项。

### 2.5 参数与正文的边界

- `ratio` / `size` 是**节点参数**，通过 `node:setConfig` 设置；正文只能给构图暗示，不能改变落盘比例（`videoProduction.md:79` 已点明「提示词写 9:16 不能让 16:9 节点变竖屏」）。
- 正文与参数不一致 = 白写（`imagePrompt.md:54`）。写法上：先定参数，再让正文按该比例描述版面。
- 正文里不出现参数名（`width`、`height`、`negative_prompt` 等）——图片链路没有参数解析，写了只会被当画面元素。

---

## 三、freevideo 视频：六段与三段

### 3.1 分界条件

官方口径只有两种段落结构（`promptWriting.md:15-19`）：

- **ref2va（参考图/视频/音频驱动）** → 六段：`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`。
- **t2va / i2va / fl2va / l2va（文生、首帧、首尾帧、尾帧）** → 基础三段：`integrated_multimodal_description` → `overall_soundscape` → `non_diegetic_music`。

所以分界是**实际下发的任务/模式**，不是「有没有挂参考图」。挂了图但模式被收缩成 `startFrameOptional` 时，任务已不是 ref2va（见 §6 D5）。

### 3.2 六段：段名、落位、写什么

| # | 段首（逐字） | 多轨落位 | 写什么 | 硬要求 |
| --- | --- | --- | --- | --- |
| 1 | `subject_definitions:` | `clips[].prompt.integratedMultimodalDescription` 第 1 行 | 每个被引用主体/场景/道具一行：`<Subject N> = 资产编号（名称，用途：character/scene/prop）`，来源写 `<Picture N>` | 有参考时**第一行必须是它**（`multitrackTemplate.md:163`） |
| 2 | `summary:` | 同一字段第 2 段 | 1–2 句：本镜任务类型 + 主要参考关系 | 与 `:16` 官方示例口径一致 |
| 3 | `retention_analysis:` | 同一字段第 3 段 | 每个参考保留/迁移/复制：`fully_preserved` / `partially_preserved` + 列出保留的特征 | 用固定词，不自由发挥 |
| 4 | `detailed_description:` | 同一字段第 4 段 | 逐镜画面正文：`[Shot 1]` 起；多镜写 `[Shot 2] At 00:03.000, …`，时间码严格递增且在时长内 | 正文英文（专有名词、对白、屏幕文字保留原文） |
| 5 | `overall_soundscape:` | `clips[].prompt.overallSoundscape` 字段 | 环境声与动作声，1–4 句 | 可写 `N/A` |
| 6 | `non_diegetic_music:` | `clips[].prompt.nonDiegeticMusic` 字段 | 配乐，1–3 句 | 可写 `N/A` |

编排原则：**前四段一个字符串、后两段各自字段**。`buildPrompt` 把后两段按固定顺序拼成尾段，正文原样居首（`directDispatch.ts:97-114`）。

### 3.3 无参考：基础三段

| # | 段首 | 多轨落位 | 说明 |
| --- | --- | --- | --- |
| 1 | `integrated_multimodal_description:` | `integratedMultimodalDescription` | 画面正文，`[Shot 1]` 起 |
| 2 | `overall_soundscape:` | `overallSoundscape` | 同六段第 5 段 |
| 3 | `non_diegetic_music:` | `nonDiegeticMusic` | 同六段第 6 段 |

前四段（`subject_definitions` / `summary` / `retention_analysis` / `detailed_description`）**一个都不出现**。注意：`multitrackTemplate.md:199` 写的是「其余五段不出现」，措辞与这里不一致，已登记为 D2。

### 3.4 多轨落位（clips 数组）

- 文本进 `clips[].prompt` 三个字段，字段名固定为 `integratedMultimodalDescription` / `overallSoundscape` / `nonDiegeticMusic`，三者都必填（`multitrackTemplate.md:88-90`）。
- 段首标签写在**字段值里面**，不靠字段名隐含。也就是说 `integratedMultimodalDescription` 的值第一行必须是 `subject_definitions:`（有参考）或 `integrated_multimodal_description:`（无参考）。
- 全片风格与全片约束不在提示词里，落 `global.style` / `global.systemPrompt`（`multitrackTemplate.md:72-73`）；派工时引擎把这两项拼成前缀插在正文最前（`directDispatch.ts:101-105`），因此**它们不属于六段**。
- 参考来源是 `referenceIds`（画布引用位次），不是自由排列。

### 3.5 单镜视频节点落位

单镜路径（一个片段一个视频节点）用**同一套六段**，区别只在承载方式：

- 文本进节点的 `data.prompt` 一份字符串，用 `node:setPrompt` 一次写完整段（含段首标签、段间空行）。
- 节点没有 `global.style` 这类"全片"层，**风格写在 `[Shot 1]` 的定语里**（官方写法本来就是「`[Shot 1]` 带视觉风格与开场构图起」，`promptWriting.md:23`）。不要把「风格：……」写成正文首行——那会顶掉 `subject_definitions` 的段首位置。
- 参考来源是节点入边顺序，编号规则与多轨一致（按类型各自编号）。

### 3.6 多轨与单镜：差异只有三处

| 维度 | 多轨 `clips[]` | 单镜视频节点 | 是否影响格式 |
| --- | --- | --- | --- |
| 文本放哪 | `prompt` 三字段（前四段一个字符串 + 两个声音字段） | `data.prompt` 一个字符串（六段全在一个字符串里） | 否，段内容同构 |
| 风格从哪来 | `global.style` / `global.systemPrompt`，引擎拼前缀 | 无前缀，写进 `[Shot 1]` 定语 | 是，前缀位置影响"首行" |
| 参考顺序谁定 | `referenceIds`（画布引用位次） | 节点入边顺序 | 否，编号规则同构 |

结论：**两边的提示词内容完全同一套；差异只在「文本放哪、风格从哪来、参考顺序谁定」。** 任何「多轨六段、单镜三段」的说法都是错的——单镜有参考同样是六段。

### 3.7 编号：按类型各自从 1

- `<Picture N>` 只数图片、`<Audio N>` 只数音频、`<Video N>` 只数视频，各自从 1 起，互不占用（`promptWriting.md:42`、`videoProduction.md:45`）。
- `referenceIds` 的位次是**画布引用位次**，不是 Picture 序号。混入 `kind: "sound"` 的音频卡后位次会错位：挂 `["C01","A01","C03"]` 时正确编号是 `C01 → <Picture 1>`、`A01 → <Audio 1>`、`C03 → <Picture 2>`（`generationRunbook.md:112`）。
- 只有参考**全是图片**时，位次才恰好等于 Picture 序号——那是特例，不是通例。
- 文本参考（`dataType: "STRING"`）不产 Picture 编号：wire 层把它以「参考 N：」的形式追加在整段末尾（`videoGenerationNode/src/index.vue:232-238`）。它仍计入参考集，会影响模式（见 D4）。
- 校验只查后界：V7 检查编号是否越界，**不查重号、不要求每个编号都出现**（`planOperator/src/planValidator.ts:209-222`、`:237`）。顺序与完整性是写作纪律，没有机器兜底。

### 3.8 wire 层到底做了什么（拼装事实）

| 步骤 | 行为 | 出处 |
| --- | --- | --- |
| 1 | 取 `integratedMultimodalDescription.trim()` 作正文 | `directDispatch.ts:100` |
| 2 | `style` 非空 → 拼「全片风格：…」；`systemPrompt` 非空 → 拼「全片约束：…」，合成前缀插在**正文最前** | `:101-105` |
| 3 | 正文未以五个官方段首之一开头时补字段名（有参考 → `detailed_description: `，无参考 → `integrated_multimodal_description: `） | `:95`、`:106` |
| 4 | 两个声音字段拼成尾段，与正文之间空一行 | `:107-110` |
| 5 | 节点侧：`providerId === "freevideo"` 时按 `dataType` 把旧REF占位标记换算成 `<Picture N>` / `<Video N>` / `<Audio N>` | `index.vue:225-228` |
| 6 | 对所有供应商：把 `Picture/Video/Audio` 词根做大小写与空白归一化 | `index.vue:229-231` |
| 7 | 文本参考以「参考 N：\n内容」追加在段尾，空行分隔 | `index.vue:232-238` |
| 8 | 供应商层原样透传，不做段落拼装、不改标记 | `freevideo.ts:282-296` |

必须记住的一条推论：**只要 `global.style` 非空，wire 文本第一行就是「全片风格：」，不可能以 `subject_definitions:` 开头。** 「六段第一行必须是 `subject_definitions:`」在写作层成立，在 wire 层不成立——两者差着一层前缀（见 D3）。

### 3.9 接口硬约束（视频）

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 时长 | 整数 2–60 秒；实际成片落 `17n+5` 网格（6s→6.583s）；≥30s 自动分块，此时参考图实限 3 张 | `freevideo.ts:222`、`promptWriting.md:63-70`、`generationRunbook.md:122` |
| 分辨率 | `768P` / `2K`（`durationResolutionMap`） | `freevideo.ts:224-232` |
| 比例 | 五档，同图片 | 同上 |
| 声音 | `audio: "optional"`，由 `generateAudio` 决定 | `freevideo.ts:221`、`multitrackTemplate.md:87` |
| 质量档 | 代码固定 `"light"`，写作者/agent 不选 | `freevideo.ts:290` |
| 模式 | `text` / `startFrameOptional` / `["imageReference:4","videoReference:1","audioReference:1"]` | `freevideo.ts:224-232` |
| 参考上限 | 图 ≤ 4（产品限制）、视频 ≤ 1、音频 ≤ 1 | `freevideo.ts:207`、`generationRunbook.md:120` |
| 对白 | `<d>[Chinese]…</d>`，说话人 ID 全片唯一 | `promptWriting.md:29-33` |
| 镜头 | `[Shot 1]` 起；多镜 `[Shot 2] At 00:03.000`，严格递增且在时长内 | `promptWriting.md:22-25` |

关于模式收缩（必须写进规范，否则写作者会把六段用错地方）：空镜段（参考集含 STRING/VOID）或混入视频/音频参考时，可用模式只剩 `startFrameOptional`，它只吃 2 张图且按顺序当首帧/尾帧，**语义与 ref2va 的「多图参考」完全不同**（`generationRunbook.md:71`）。这不是可用方案，是失败信号（`:124`）。

---

## 四、与 master 三段式的映射

master 的 canvas 直连写法是**三段式**（`videoProduction.md:42`、`:69-71`、`canvas/SKILL.md:71`）：

- **A 真实素材定义**：用画布旧REF占位标记（mention chip）定义主体、场景、道具及稳定特征。
- **B 顺序镜头**：按本段原镜号逐镜写动作与空间、单一主运镜、完整台词和声音。
- **C 已确认风格与必要约束**：最后写风格与稳定性约束。

### 4.1 逐段映射

| master 段 | 落到 freevideo 哪一段 | 搬运要点 |
| --- | --- | --- |
| **A 素材定义** | `subject_definitions`（定义是谁、来源哪张图）+ `retention_analysis`（参考图里什么必须留住）+ `detailed_description` 首次出现处的形貌复述 | 一段拆三段：**定义 → 保留 → 复述**。这是最容易少搬的地方，只写 `subject_definitions` 会被判「参考形貌没写」 |
| **B 顺序镜头** | `detailed_description` | 原镜号按顺序转成 `[Shot k]`；多镜补 `At 时间码`；单一主运镜不变；台词进 `<d>` |
| **B 里的声音** | `overall_soundscape`（环境/动作声）+ `non_diegetic_music`（配乐） | 声音从「镜头段里的一句」升为两个独立字段，必须显式写或 `N/A`，不能省 |
| **C 风格与约束** | 多轨：`global.style` / `global.systemPrompt`（引擎拼前缀）；单镜：写进 `[Shot 1]` 定语 | 不要写成「风格：……」独立段落，它不在官方六段里 |
| （无对应段） | `summary` | 六段新增的段：1–2 句任务类型与参考关系。三段式没有等价物，按「参考图驱动的人物动作镜头」这类句式补 |

### 4.2 三个搬运动作

1. **标记换算法**：master 的标记是**全局序号**（图片、视频、音频、文本共用一套编号），freevideo 是**分类序号**（各自从 1）。不存在「官方 N = 标记 N」的等号映射，必须按类型重新数（`videoProduction.md:45`）。新稿直接写官方标记，不写旧标记。
2. **风格前移**：三段式把风格放最后；六段体系里它被提到最前，由引擎当前缀拼（多轨）或由写作者塞进 `[Shot 1]`（单镜）。位置的改变不改变内容。
3. **声音下沉**：三段式里声音是镜头描述的一部分；六段体系里它是两个独立字段，并且 `buildPrompt` 会按固定顺序拼到段尾。写作者不能把「雨声、脚步」只写在 `detailed_description` 里就算完。

### 4.3 等价性判定

| 维度 | 是否等价 | 说明 |
| --- | --- | --- |
| 信息量 | 等价 | A→1+3+4、B→4、C→前缀/定语、声音→5+6，逐条搬完不丢信息 |
| 标记编号 | **不等价** | 全局序号 vs 分类序号，必须重编 |
| 段落结构 | **不等价** | 三段式允许「素材定义」一段写完；六段要求定义与保留分析分列，且正文复述一遍形貌 |
| 机器校验 | **不等价** | 三段式无校验；六段只有 V7 越界检查，顺序/重号/完整性靠纪律 |

### 4.4 同一条镜的两种写法（对照）

设定：2 张图（陈默、雨夜长街）+ 1 段环境音，两个镜头。

- **master 三段式**（旧REF占位标记按画布位次编号，此处用文字描述不写字面量）：
  开头用标记 1 指陈默、标记 2 指雨夜长街，各带稳定特征；随后按镜号写「陈默撑伞走入画面 / 切近景手部」；最后写「潮湿冷调、胶片颗粒」。
- **freevideo 六段**：
  - `subject_definitions:` 两行——`<Subject 1> = C01（陈默，用途：character）`、`<Subject 2> = SC02（雨夜长街，用途：scene）`，来源分别写 `<Picture 1>`、`<Picture 2>`；
  - `summary:` 一句「参考图驱动的人物入场镜头，主体与场景均由参考图锁定」；
  - `retention_analysis:` 两条，`<Subject 1> (appears in [Shot 1]): fully_preserved - 面部特征、黑色风衣、伞的形制`、`<Subject 2>: partially_preserved - 街道纵深与霓虹颜色保留，摊位位置可变`；
  - `detailed_description:` `[Shot 1] …` + `[Shot 2] At 00:04.000, …`；
  - `overall_soundscape:` 雨声、伞面拍打、远处车流；
  - `non_diegetic_music:` `N/A` 或一句低音弦乐。

差别一目了然：**同一个意图，六段把「定义 / 保留 / 复述 / 正文 / 声音 / 配乐」拆成了六个可分别校验的槽位**，三段式把它们压在三段散文里。

---

## 五、写作者最小操作清单

### 5.1 六段填空骨架（直接照抄，替换占位）

```text
subject_definitions:
<Subject 1> = <资产编号>（<名称>，用途：character）
<Subject 2> = <资产编号>（<名称>，用途：scene）

summary:
<一句话：任务类型 + 参考关系>

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - <特征1、特征2>
<Subject 2> (appears in [Shot 1]): partially_preserved - <保留什么、可变什么>

detailed_description:
[Shot 1] <风格定语 + 画面正文 + 动作 + 台词>
[Shot 2] At 00:03.000, <下一镜>

overall_soundscape: <环境声与动作声>

non_diegetic_music: <配乐或 N/A>
```

### 5.2 出稿前八项检查

1. 有参考时第一行是 `subject_definitions:`；无参考时第一行是 `integrated_multimodal_description:`。
2. 每个参考都在 `subject_definitions` 出现一次，来源写 `<Picture N>` / `<Video N>` / `<Audio N>`。
3. `retention_analysis` 每条都用 `fully_preserved` / `partially_preserved`，且列了具体特征。
4. `[Shot k]` 从 1 连续，多镜带 `At mm:ss.mmm`，严格递增且在时长内。
5. Picture/Audio/Video 编号按类型各自从 1，未把音频写成 Picture。
6. 挂了参考的资产，正文里复述了形貌，不是只写一个编号。
7. 两个声音字段都填了（可 `N/A`），没有把声音只塞进正文。
8. 正文英文；对白、屏幕文字保留原文。

---

## 六、已发现的漂移点（登记，不在本文修）

| 编号 | 现象 | 冲突双方 | 建议以谁为准 |
| --- | --- | --- | --- |
| D1 | 六段示例首行写成「`integrated_multimodal_description: subject_definitions:`」双标签 | `generationRunbook.md:91` vs `multitrackTemplate.md:163` | 以 `multitrackTemplate` 为准（首行就是 `subject_definitions:`），runbook 示例待修 |
| D2 | 「无参考时其余五段不出现」 | `multitrackTemplate.md:199` vs `promptWriting.md:17`（无参考是基础三段） | 改为「无参考时是基础三段：正文 + 两个声音字段」 |
| D3 | `global.style` 必填非空，但要求严格以 `subject_definitions` 开头需要它留空 | `multitrackTemplate.md:72` vs `:197` + `directDispatch.ts:101-105` | 待决（见 §7 Q1） |
| D4 | 文本参考以「参考 N：」追加在 `non_diegetic_music` 之后，破坏六段顺序 | `videoGenerationNode/src/index.vue:232-238` vs 六段顺序 | 待决（见 §7 Q5） |
| D5 | 模式收缩到 `startFrameOptional` 时仍写六段 | `directDispatch.ts:106` 只按 `referenceIds.length` 判 vs 官方任务分类 | 待决（见 §7 Q6） |
| D6 | `modelId` 不构成格式承诺：`MiniMax-H3` 还被 metaso / apiMart / compshare / tfRouter 提供 | 各供应商 readme | 非 freevideo 的 H3 按其自身 readme 定，不默认继承六段 |
| D7 | 「参考图最多 4 张」易被读成引擎能力 | `freevideo.ts:207`/`:219`（产品限制，引擎 9 张）vs `imagePrompt.md:27-38`（按 4 写） | 按 4 写，但文档必须注明「这是产品限制，不是引擎能力上限」 |

---

## 七、待决岔路口

| 编号 | 问题 | 选项 | 影响 |
| --- | --- | --- | --- |
| Q1 | `global.style` 必填 vs 严格首行，怎么解 | A 保留必填，接受「全片风格：」前缀（放弃严格首行）；B 默认留空 + 放宽校验；C 派工时把 style 折进 `[Shot 1]`（改代码，超出本轮） | A 改动最小但破坏官方首行；C 最干净但要动 `buildPrompt` |
| Q2 | 六段首行是否升级为硬校验（新增校验规则） | 只写纪律 / 上校验 | 上校验要先定 Q1，否则必踩 |
| Q3 | 单镜路径是否也走 `buildPrompt` 同款拼装 | 保持 agent 自拼 / 复用 | 复用可消灭「风格放哪」的二义性 |
| Q4 | 非 freevideo 的 H3 供应商是否吃六段 | 按 readme 各自定 / 统一按 H3 系列处理 | 统一处理会让「模型名相同」再次变成隐式路由键 |
| Q5 | 文本参考是否允许接视频节点 | 允许（段尾追加、声明不属于六段）/ 禁止 | 允许会让六段顺序不可保证 |
| Q6 | `startFrameOptional` 片段怎么写 | 三段 + 首尾帧说明 / 仍写六段 | 影响 D5 的判定时机（提交前还是写稿时） |

---

## 八、引用索引

| 结论 | 出处 |
| --- | --- |
| 图片无官方规范、六段不套图片 | `packages/skills/assetCard/references/imagePrompt.md:3`、`:16`、`:282-296` |
| 图片五要素、模板、锚点、负向并进正文、自检 | `imagePrompt.md:84-112`、`:116-192`、`:196-226`、`:230-262`、`:265-278` |
| 图片硬约束（尺寸/比例/模式/参考 4 张/无负向/PNG） | `packages/providers/src/media/freevideo.ts:224-231`、`:246`、`:249-257` |
| 视频模式与时长分辨率 | `freevideo.ts:224-232` |
| 参考上限与 ≥30s 分块 3 张 | `freevideo.ts:207`、`generationRunbook.md:120-124` |
| 六段/三段官方结构 | `data/skills/freevideoAgent/references/promptWriting.md:15-19`、`:22-44` |
| 六段落位与编号硬要求 | `packages/skills/assetCard/references/multitrackTemplate.md:88-91`、`:125-218` |
| `buildPrompt` 拼装事实 | `packages/nodeShared/src/mtrack/directDispatch.ts:97-114` |
| 旧标记换算仅 freevideo 生效 | `packages/nodes/videoGenerationNode/src/index.vue:225-231` |
| 文本参考追加位置 | `videoGenerationNode/src/index.vue:232-238` |
| 节点真实配置回读 | `videoGenerationNode/src/index.vue:385-399`、`imageGenerationNode/src/index.vue:407-417` |
| 工程 `global.model` 只是声明值 | `packages/tools/planOperator/src/mtrackProject.ts:88-101`、`multitrackEditor.vue:665-671`、`directDispatch.ts:369-381` |
| 模型可被多家供应商提供 | `packages/providers/src/media/metaso.ts:70`、`apiMart.ts:191`、`compshare.ts:1762`、`tfRouter.ts:170` |
| master 三段式 | `packages/skills/canvas/references/videoProduction.md:42`、`:69-71`、`packages/skills/canvas/SKILL.md:71` |
| 默认走 freevideo 的口径 | `videoProduction.md:79`、`packages/skills/assetCard/SKILL.md:79` |
