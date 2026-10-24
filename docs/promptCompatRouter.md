# 条件分流与多轨兼容方案（本轮汇聚稿）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 状态：设计方案，**不实施**。不改 `packages/skills`、不改业务代码、不重启 dev。
> 分册：[单字段化数据结构决策稿](promptCompatPromptSchema.md)。
> 上游：[master 基线](promptCompatBaseline.md)、[差异盘点](promptCompatDelta.md)、[freevideo 路径规范](promptCompatFreevideo.md)、[非 freevideo 格式卡](promptCompatNonFree.md)。
>
> 写作约束：全文不出现双花括号模板字面量；旧REF占位标记一律以文字指代；建议文案一律用条件句，不使用版本叙事。

---

## 0. 一页方案

**一句话**：默认值只回答「没人点名时用谁」，从不回答「怎么写」；怎么写永远由「工程所选模型 × 实际任务类型」决定，且这条规则只在路由表里说一次。

五条落地结论：

1. **多轨提示词收敛为单字段**（详见分册）。三字段是按 H3 段结构切的，字段本身就是格式耦合；单字段化之后，「多轨强制六段」这条硬隔离失去存在理由。
2. **分流的行是「媒体类型 × 任务类型」，不是「工程形态」**。形态只决定「写进哪个字段」：多轨写 `clips[].prompt`，单镜写节点 `data.prompt`。格式与形态无关——同一个 H3 ref2va 任务，在多轨和单镜里都是六段。
3. **判定键是 `(providerId, modelId)` 二元组，但两个分量管不同的事**：`modelId` 决定格式族（H3 的六段/三段、Seedance 2.0 三段、2.5 九字段…），`providerId` 决定传输实现（是否做参考标记换算）。用 provider 当格式键会得出「tfRouter 提供的 H3 不是 H3」这种错误结论。
4. **多轨允许切非 freevideo，格式随工程声明模型切换**；切换是显式的、有门槛的，不自动改写存量提示词。引导层禁止（方案 A）与 UI 限死（方案 D）都被淘汰，因为它们既挡住 tfRouter / metaso 等四家提供的 H3，又挡住用户点名 Seedance 的合法诉求。
5. **默认模型口径收敛到一张「媒体路由表」**，其余 13 处一律改指针或保留本处特有的交互规则。这是本轮唯一能真正消灭漂移的动作——上一轮的教训是「同一规则写两处，两处都会各自演化」。

### 0.1 数据结构结论（分册摘要）

- `clips[].prompt` 改为单个字符串；三字段（画面/环境声/非叙事音乐）在**读归一**阶段合成一段，声音段带官方字段名，段间空行。
- 合成结果与现行 `buildPrompt` 的下发内容逐字对齐（除"正文缺段首时自动补 `detailed_description:`"这一分支，有意去掉）。
- `buildPrompt` 退化为「工程风格/约束前言 + 正文原样透传」：删自动段首、删两个声音尾段，D5 的 `referenceIds.length` 分支随之消失。
- 不双写、不写版本位；三字段只存在于本分支，master 树中无 `packages/nodeShared/src/mtrack/`，没有已发布的历史磁盘数据，因此不承诺降级读取。
- `planValidator` V11 收成一条（空→error）；V7 字段枚举收缩，H3 边界校验按模型启用；段名不做硬校验。
- `rewriteShot` 单串进出，内置规则去掉"英文输出"与"H3 标记"绑定，参考清单不再预生成标记。
- 两处 `mtrackProject.ts` 副本：nodeShared 为唯一真源，planOperator 加 workspace 依赖复用，顺带修 `updatedAt` 默认值漂移。

---

## 1. 判定轴与判定键

### 1.1 三条互不替代的轴

| 轴 | 取值 | 决定什么 | 不决定什么 |
|---|---|---|---|
| 工程形态 | 多轨工程 / 直连例外（单镜节点） | 文本写进哪个字段、派工走哪条链路 | 格式 |
| 实际任务类型 | t2va / i2va / fl2va / l2va / ref2va（H3 口径）；等价能力按各供应商模式 | 同一模型下用六段还是三段 | 供应商 |
| 模型 | `(providerId, modelId)` | 格式族、参考标记写法、时长/分辨率上限 | 文本落点 |

差异盘点的三条断点，本质上都是把这三条轴压成一条：用形态推格式（`workflow/SKILL.md:45`）、用挂没挂参考图推六段（`directDispatch.ts:106`）、用供应商 id 推能力（`index.vue:228`）。

### 1.2 判定键与取数权威

**判定键**：`(providerId, modelId)`。理由：[freevideo 规范](promptCompatFreevideo.md) 已核实 MiniMax-H3 除 freevideo 外还由 metaso / apiMart / compshare / tfRouter 四家提供；只按 `providerId === "freevideo"` 判会把「同一模型」判成两种格式。反过来只按 `modelId` 判也不行——同名模型在不同供应商下的参考数量、模式、时长可能不同。

**取数权威（降序，子任务不得越级）**：

1. 目标视频/图片节点 `node:getConfig` 返回的 `config`（`videoGenerationNode/src/index.vue:385-399`、`imageGenerationNode` 同类接口）。这是唯一"实际会下发什么"的真相。
2. 用户在对话中明确点名的模型。
3. 工程 `global.model` 声明值（`mtrackProject.ts:45`，UI 写入点 `multitrackEditor.vue:665-671`）。它是"用户希望用什么"，可被改写，`configureNode`（`directDispatch.ts:364-384`）才真下发，**不能当权威**。
4. 媒体路由表的默认值（§4）。

工程声明与实际配置不一致时：**停止并报告**，不静默按任一方继续。这条与 master「能力冲突只报不换」（`workflow/SKILL.md:63` 及 A0 相关条款）同源。

### 1.3 三个禁止判法

| 禁止 | 反例 | 后果 |
|---|---|---|
| 按工程形态判格式 | 「多轨 = 六段」 | 切到 Seedance 后仍写六段，正确格式被明令禁止 |
| 按有没有挂参考图判六段 | `referenceIds.length > 0 → detailed_description`（`directDispatch.ts:106`） | 首/尾帧任务挂了图但不是 ref2va，六段写错 |
| 按名称猜供应商能力 | 名字含 H3 就假定 freevideo 的换算可用 | tfRouter 的 H3 拿不到标记换算，标记原样进正文 |

---

## 2. 把 master 的五段兼容结构移植到本链

master 的兼容性不是一套格式，而是五段结构（[基线](promptCompatBaseline.md) §5）。逐条落到本链：

| 结构 | master 的做法 | 本链落点 | 违反后果 |
|---|---|---|---|
| ① 模型为唯一路由键 | A0 单点决定模型与格式，执行层不得反写（`workflow/SKILL.md:1395`） | 判定键 `(providerId, modelId)` + 任务类型；路由表是唯一真源 | 默认值被节点默认值覆盖（现 `canvas/SKILL.md:120` 已在防这一条，但用的是"不要换成节点自动默认值"的措辞，不是路由表） |
| ② 每路由一个可判定外壳 | A9.1 / A9.2 有各自可判定的字段白名单与硬门 | 每个模型条目声明 `promptProfile`（§2.2）；外壳 = 段结构 + 标记写法 + 语言 | 靠供应商 id 推外壳 → H3 经其他供应商提供时判错 |
| ③ 内容与传输标记分离 | 句柄原样引用，编号来自现场 | 文本里的标记是内容；`referenceIds` 与画布连接是传输；换算只发生在 wire | 把 `<Picture N>` 当内容写进 Seedance 提示词 |
| ④ 执行层只搬运 | `workflow/SKILL.md:59`、`:74` | `buildPrompt` 只拼工程前言；`dispatchClips` 不补段、不改写 | 自动补段首（`directDispatch.ts:106`）在非 H3 模型下就是污染 |
| ⑤ 单向校验无回环 | A11.2 禁递归、A12 不返 A11 | 静态校验（planValidator）→ 派工前预检（getConfig）→ wire 换算；任一层不修改上游文本 | 预检自动"修好"再下发 → 用户看到成功的假象，源文件仍是错的 |

### 2.1 谁是路由键（本链的具体化）

- **格式判定**：先取 `modelId` → 找到模型条目 → 读该条目声明的 `promptProfile`；未声明时按 `modelId` 回退到格式卡。`providerId` 只在「同一 modelId 有多套实现」时用于区分传输能力，不参与格式判定。
- **传输判定**：取 `providerId` 与实现（`videoGenerationNode/src/index.vue:228` 现有换算只在 freevideo）。
- **任务判定**：取节点 `mode`（`index.vue:157-159`）+ 实际参考构成；`mode` 会被引用变化静默改写（`:191-198`），所以取数必须在派工前重读，不能用创建时的快照。

### 2.2 可判定外壳：`promptProfile`

现状问题：格式与供应商的映射只存在于文本（技能文档）和一处硬编码（`index.vue:228`），代码无法回答"这个模型用什么外壳"。

建议（**实施项，本轮只设计**）：在 `ProviderModel` 上增加可选 `promptProfile` 字段，取值是有限集合，例如：

| `promptProfile` | 含义 | 声明方 |
|---|---|---|
| `minimax-h3` | 六段（ref2va）/ 三段（其他任务）+ 官方尖括号标记（按类型各自编号） | freevideo、metaso、apiMart、compshare、tfRouter 的 H3 条目 |
| `seedance-2.0` | 中文三段式 / A9.1 | Seedance 2.0 条目 |
| `seedance-2.5` | A9.2 九字段白名单 | Seedance 2.5 条目 |
| 缺省 | 通用：按模型卡自述，引擎不做任何转换 | 其余供应商 |

消费方：wire 的标记换算改为读 `promptProfile === "minimax-h3"`（覆盖四家 H3 提供方）；planValidator 的 H3 边界校验按同一信号启用；技能层按 profile 选格式卡。**一处声明，三处消费，且都不再硬编码供应商名。**

替代方案（不推荐）：维护一份「H3 供应商名单」常量。它会在第五家接入时静默过期，且名单本身又是一处需要同步的真源。

### 2.3 标记怎么分离

| 标记类别 | 位置 | 归属 | 换算者 |
|---|---|---|---|
| 旧REF占位标记 | 提示词正文（画布 mention chip 语义） | 内容 | 仅 `promptProfile = minimax-h3` 的 wire 换算 |
| 官方尖括号标记（按类型各自编号） | 提示词正文 | 内容 | 写作者按格式卡写，wire 不重写 |
| 身份句柄 / 真实节点句柄 | 提示词正文（master 的 Seedance 路线） | 内容 | 不换算，原样透传 |
| `referenceIds` / 画布连接 | 节点数据 | 传输 | 引擎按连接与数据组装 |

四类标记的交接契约一句话：**换算只发生在声明了对应 profile 的模型上；其余供应商的标记是内容，不是传输编码，原样透传并由该模型卡承接。**

### 2.4 校验怎么做到单向不循环

- **静态层**（planValidator）：只回答「有没有内容、标记是否越界、参考顺序是否与画布一致」。不回答「像不像某家格式」；H3 段首只做提示级。
- **预检层**（派工前）：`node:getConfig` 读实际模型与模式，与工程声明比对；不一致即停。预检不写任何内容。
- **wire 层**：只换算标记与追加文本参考，不改段落结构。
- **禁止回环**：预检结果不得写回 `prompt`；整理接口的结果必须经过用户确认才回写（现有 `requiresReview` 已是这个语义，`rewriteShot.ts:99-100`）；校验器不提供 autofix。

---

## 3. 分流表

### 3.1 主表：媒体类型 × 供应商

| 媒体类型 | 默认（未点名，freevideo） | 用户点名其他供应商 | 判定字段 | 格式真源 |
|---|---|---|---|---|
| **资产图**（C / SC / P 设定图） | `freevideo-image`；内容要素清单（主体与版面、形貌锚点、状态与视角、背景与光、排除项），无段式、无负向通道；比例五档、参考≤4（产品限） | Seedream / Nanobanana / gpt-image，各按其格式卡（中文段落 / JSON / 提示词式） | 图片节点 `node:getConfig` 的 `providerId` + `modelId` | `assetCard/references/imagePrompt.md` §一 边界 + §四 内容要素清单（唯一权威） |
| **分镜首帧图** | **当前无归属**（NF-2 缺口，见 §3.2） | 同上 | 同上（图片节点，与视频模型无关） | 待补：`imagePrompt.md` 新增首帧图节 |
| **多轨视频**（`clips[].prompt`） | `MiniMax-H3`；ref2va 六段 / 其他任务三段，写进单字段；标记按类型各自从 1 编号 | Seedance 2.0 三段 / 2.5 九字段 / Wan 单首帧…写进同一字段，标记用该模型写法 | 工程 `global.model` 声明 + 派工节点 `getConfig` 的 `providerId` / `modelId` / `mode` | H3：`multitrackTemplate.md` §四；其他：格式卡（`promptCompatNonFree.md` 暂为设计稿） |
| **单镜视频节点**（`data.prompt`） | 同一套六段/三段写进节点提示词；旧REF占位标记由 wire 换算 | 按其格式卡书写；标记原样书写，wire 不换算 | 该节点 `node:getConfig` | H3：同 `multitrackTemplate.md` §四（内容格式同构）；其他：格式卡 |

> 注：多轨与单镜的差异只有三处——文本放哪、风格从哪来、参考顺序谁定（[freevideo 规范](promptCompatFreevideo.md)）。分流表因此不按这两行分格式，只按"谁提供模型"分。

### 3.2 H3 任务类型子表（决定六段还是三段）

| 实际任务 | 官方任务名 | 外壳 | 触发条件（按实际配置读） |
|---|---|---|---|
| 有参考的多参生成 | ref2va | 六段：素材定义 → 概要 → 保留分析 → 详细描述 → 环境声 → 非叙事音乐 | `mode` 未收缩到首/尾帧模式，且参考构成符合多参 |
| 纯文本 / 首帧 / 首尾帧 / 尾帧 | t2va / i2va / fl2va / l2va | 三段：画面与声音整体描述 → 环境声 → 非叙事音乐 | `mode` 为 `startFrameOptional` 等；或未挂参考 |

分界判据是「实际下发的任务是不是 ref2va」，不是「有没有挂参考图」，也不是「是不是多轨」。

### 3.3 分镜首帧图缺口（NF-2 的准确说法）

事实链：

- `imagePrompt.md:23` 声明「图片规范只有这一处权威」。
- 同一文件 `:22` 把「分镜首帧图」交给 `v118workflow` 的对应知识。
- 而 `imagePrompt.md:21` 又把该技能里的 Seedream / Nanobanana 模板定性为「旧模型的写作模板，不是资产图规范」。

于是首帧图这条路径：唯一的权威文件声明自己不管它，被委托的家又被权威文件声明"不是规范"。这不是「所有非 freevideo 路径被关掉」——资产卡路径有活家（`imagePrompt.md`），**真正的问题是首帧图没有活家**；默认切到 `freevideo-image` 之后，它连"名义上的家"都没有了，因为 `imagePrompt.md` 只覆盖 C / SC / P 资产图。

**建议补法**（本轮只设计）：

1. 在 `imagePrompt.md` 新增「分镜首帧图」节：内容要素 = 资产图五要素 + 三项叠加（构图与机位、该镜在段落中的时序位置与前后状态、跨镜形貌锚点）。首帧图是图，判定走图片节点 `getConfig`，与视频模型无关。
2. `v118workflow` 的图片模板保留为「用户点名 Seedream / Nanobanana 时的模型卡」，删除「旧模型」定性——那是能力差异，不是版本问题。
3. 删掉 `v118workflow/SKILL.md` 中以「历史 / 旧版」措辞限定适用范围的边界句，改为条件句：「当用户点名本技能模板集覆盖的模型、或要求复现指定画风与流程时适用。」

---

## 4. 默认模型口径收敛

### 4.1 现状盘点（14 处，5 种措辞）

| # | 位置 | 现文要点 | 处置 |
|---|---|---|---|
| 1 | `canvas/SKILL.md:120` | 媒体默认 freevideo；不可用先说明并确认替代；点名才按点名 | **指针**（保留"不可用先确认"的判定动词，见 4.3） |
| 2 | `canvas/references/videoProduction.md:7` | 直连例外默认 freevideo，点名 Seedance 才按版本 | **本文件新增 §0.1 作真源**，`:7` 改为指向 §0.1 |
| 3 | `canvas/references/videoProduction.md:79` | 媒体默认 freevideo + 兜底 + 点名 | 指针 |
| 4 | `workflow/SKILL.md:24` | 直连例外 + 默认 freevideo，不问版本 | 保留交互规则，删默认值重述 |
| 5 | `workflow/SKILL.md:26` | 未指定模型行：默认 freevideo + 图片默认 | 指针 |
| 6 | `workflow/SKILL.md:54` | 多轨模型按工程声明（默认 H3） | 指针 |
| 7 | `workflow/SKILL.md:57` | 锁存条款：默认 freevideo，执行层按 freevideo 下发 | 指针；保留"锁存"语义 |
| 8 | `workflow/SKILL.md:94` | A0 目标模型：默认 freevideo，不问版本 | 保留 A0 的交互，删默认值重述 |
| 9 | `workflow/SKILL.md:386` | 时长表首行「freevideo / MiniMax-H3（默认）」 | 删「（默认）」，只留能力 |
| 10 | `workflow/SKILL.md:804` | 路由行：freevideo 不用 A9 外壳 | 条件句化（H3 vs 其他） |
| 11 | `workflow/SKILL.md:1412` | 目标模型默认 freevideo，不问版本 | 指针 |
| 12 | `workflow/references/canvasExecution.md:70` | 默认 freevideo，本文件不得自行选择 | 指针；保留"不得自行选择" |
| 13 | `assetCard/references/multitrackTemplate.md:74` | `global.model` 默认 freevideo/H3 | 保留为"工程默认声明"（这是数据默认值，不是路由默认值），并加一句"与媒体路由表一致" |
| 14 | `v118workflow/.../videoPromptCraft.md:3`、`:14` | 不引入其他 workflow 默认模型；未指定先确认 | **不消费默认表**（见 4.4） |

### 4.2 真源：`canvas/references/videoProduction.md` 新增「§0.1 媒体路由表」

内容只允许三行 + 一条判定：

| 媒体 | 未点名时的默认 | 点名时 |
|---|---|---|
| 视频 | freevideo / MiniMax-H3 | 按用户点名；未说版本时按该供应商的版本确认规则问一次 |
| 图片 | freevideo 图像模型 | 按用户点名 |
| 分镜首帧图 | 同图片默认（首帧图是图，不是视频） | 按用户点名 |

判定句（**这段是本轮唯一允许出现默认值的地方**）：

> 未点名模型时按本表继续，不询问模型；本表默认不可用时，先查实际可用能力，说明后确认替代模型，不静默换成节点默认值。用户点名其他模型时按其指定执行。工程 `global.model` 只是声明值，派工以目标节点实时配置为准；两者不一致时停止并报告。

选择这个位置的理由：`videoProduction.md` 同时承载"形态判定"（`:7`）与"媒体默认"（`:79`），是两条默认口径的天然交汇点；`workflow/SKILL.md:804` 已直接链接它，`canvas/SKILL.md` 与它在同一技能内。

备选真源：`assetCard/references/generationRunbook.md`（多轨 SOP 的主入口）。代价是直连单镜路径要跨技能取默认值，反而多一跳。

### 4.3 「默认值可换，判定动词不能省」

`canvas/SKILL.md:120` 与 `videoProduction.md:79` 的兜底句其实还在——"freevideo 不可用时先说明并确认替代模型"。真正被替换掉的是 master 的**判定动词**："按实际可用能力选择"，现在变成了无条件默认。

所以收敛时不能只留一句"默认 freevideo"。必须保留三件事，且只在真源表里说一次：

1. 未点名 → 按表继续（不问模型）。
2. 默认不可用 → **先查能力，再说明，再确认替代**（不是直接换、不是静默换）。
3. 点名 → 按点名执行，但执行前仍要核对该模型是否支持所需素材/数量/规格（`videoProduction.md:79` 后半句）。

### 4.4 三类引用形态（允许的只有两种）

| 形态 | 示例 | 允许 |
|---|---|---|
| 指针 | 「未点名时的默认见 `../canvas/references/videoProduction.md` §0.1」 | ✅ |
| 本处特有交互 | 「不点名时不再询问模型版本」；「本文件不得自行选择默认模型」 | ✅ |
| 重述默认值 | 「默认 freevideo / MiniMax-H3」 | ❌（除真源表） |

`v118workflow` 是唯一不消费默认表的技能：它的模式表是"点名之后的模板选择"，不是入口默认。因此 `videoPromptCraft.md:3` 的「不引入其他 workflow 的默认模型」保留，但 `:14` 的「未指定模型先确认」要补一句条件：「若媒体路由表已给出默认且用户未反对，按默认继续，不再询问」。否则两条规则会互相触发二次提问。

### 4.5 条件句模板（可直接替换的写法）

| 场景 | 现文风格 | 条件句写法 |
|---|---|---|
| 默认模型 | 「默认 freevideo / MiniMax-H3」 | 「未点名时按媒体路由表」 |
| 标记换算 | 「旧标记只由引擎在生成时换算兼容」（`canvas/SKILL.md:107`） | 「当模型声明为 MiniMax-H3 时，旧REF占位标记由 wire 换算为官方标记；其他供应商下标记原样透传，按该模型格式卡书写」 |
| 多轨格式 | 「多轨产物只能是六段，禁止 A9 字段」（`workflow/SKILL.md:45`） | 「多轨产物格式跟随工程所选模型：H3 写六段/三段且不写 A9 字段；Seedance 2.0 写其外壳；2.5 写九字段白名单。禁的是格式与模型不符，不是某一家的字段」 |
| v118 边界 | 以「历史 / 旧版」措辞限定（`v118workflow/SKILL.md:12`） | 「当用户点名本技能模板集覆盖的模型，或要求复现指定画风与流程时适用」 |
| 图片默认 | 「图片默认 freevideo」 | 「图片未点名时按媒体路由表」 |
| 首帧图 | 「分镜首帧图走 v118workflow」 | 「分镜首帧图按图片模型规则书写，见 imagePrompt.md 首帧图节」 |
| 时长 | 「freevideo / MiniMax-H3（默认）2–60s」 | 「MiniMax-H3：2–60s；≥30s 自动分块时参考实限 3」 |

### 4.6 术语表（补 master 的缺口）

master 的参考标记有三套语义却没有统一命名，这是"同一事实写两处"的温床。统一为：

| 名称 | 指什么 | 谁产出 |
|---|---|---|
| 旧REF占位标记 | 画布 mention chip 语义的引用占位 | 写作者（画布直连场景） |
| 官方尖括号标记 | 按媒体类型各自编号的参考标记 | 写作者（H3 场景）或 wire 换算产出 |
| 身份句柄 / 节点句柄 | Seedance 路线下对真实节点或角色的引用 | 写作者 |
| 传输编号 | `referenceIds` 与画布连接的顺序 | 画布/工程数据 |

---

## 5. 多轨选非 freevideo：四方案重评

单字段化之前，切非 freevideo 的成本是"结构化数据不合规"；单字段化之后，成本降到"提示词文本按新模型重写"。这个变化足以推翻原来的硬隔离结论。

| 方案 | 做法 | 优点 | 代价 | 结论 |
|---|---|---|---|---|
| A 引导层禁止 | 保留"多轨只能 H3"，切了就报错 | 零实现成本 | ①与 UI 的可选下拉直接冲突（`multitrackEditor.vue:665-671`）②挡住 tfRouter / metaso / apiMart / compshare 四家的 H3 ③用户点名 Seedance 时，正确格式被明令禁止 | ❌ 淘汰 |
| B 格式随 `global.model` 切换 | 工程模型是唯一格式来源；切模型 = 切格式卡；存量提示词由用户决定是否重写 | 与判定键一致；单字段后实现成本≈0；覆盖所有供应商 | 需要格式卡齐全（Seedance 2.0/2.5、Wan、Seedream、Nanobanana…） | ✅ **推荐** |
| C 只警告 | 切换时提示"格式可能不符"，照常派工 | 不阻断 | 警告可被忽略，浪费算力；错格式产出废片 | ⚠️ 仅作 B 的补充门槛 |
| D UI 限死 | 下拉只列 H3 | 简单 | 把"H3"和"freevideo"绑死；生态封闭；与"用户点名其他供应商"总原则冲突 | ❌ 淘汰 |

### 5.1 推荐组合：B + C（切换门槛，不自动改写）

1. **格式来源**：`global.model` 声明 → `promptProfile` → 格式卡；无声明时按派工节点实际配置。
2. **切换时**：`multitrackEditor` 在模型变更对话框里显示「受影响镜头数」，并提示「已有提示词按切换前模型的格式书写，切换后需按切换后模型的格式重写」。确认后**只改 `global.model`，不改任何 `clips[].prompt`**——执行层不反写。
3. **派工时预检**：比较「工程声明模型」与「目标节点实际模型」；不一致即停止并报告（`directDispatch.ts:364-384` 目前会把 `global.model` 直接下发，属于"声明即生效"，需补这一步）。
4. **重写入口**：复用「整理本镜提示词」，它已带 `providerId`/`modelId`（`rewriteShot.ts:16-24`），改成单串后正好可以按新模型格式整理；用户逐镜确认，不批量静默改。
5. **引导层同步**：`workflow/SKILL.md:45` 从"硬隔离"改成 §4.5 的条件句；`canvas/SKILL.md:107`、`videoProduction.md:45` 的重复描述改为指针。

### 5.2 为什么不是"只警告"

只警告没有改变任何执行路径：错格式照样下发、照样计费、照样产出废片。C 的价值在于**把切换变成一次显式决策**（确认框 + 受影响镜头数），而不是把判断权留给警告文案。

---

## 6. 落点设计：同一事实只写一处

### 6.1 规则 → 真源 → 引用点

| ID | 规则 | 唯一真源 | 引用点（改成一句指针或删重述） | 代码锚点 / 校验 |
|---|---|---|---|---|
| R1 | 工程形态判定 | `workflow/SKILL.md`「多轨接入（默认制作路径）」节 | `canvas/references/videoProduction.md:7`、`workflow/references/canvasExecution.md:3` | 无（纯引导） |
| R2 | 默认媒体模型 + 兜底判定 | `canvas/references/videoProduction.md` §0.1（新增） | 14 处中的 11 处（§4.1） | 无 |
| R3 | H3 六段 / 三段写法 | `assetCard/references/multitrackTemplate.md` §四 | `canvas/SKILL.md:107`、`videoProduction.md:45`、`generationRunbook.md` §四（只留步骤） | `buildPrompt` 不再代写；planValidator 提示级 |
| R4 | 其他供应商格式 | 本次格式卡设计稿（`promptCompatNonFree.md`）→ 未来落 `imagePrompt.md`（图片）与各技能格式卡（视频） | 各路由行 | `promptProfile` 声明 |
| R5 | 参考标记换算 | 代码事实（`videoGenerationNode/src/index.vue:225-238`）+ §0.1 一句条件句 | `canvas:107`、`videoProduction:45/49` 现有通则表述 | `promptProfile = minimax-h3` |
| R6 | 图片规范（含首帧图） | `assetCard/references/imagePrompt.md` | `canvas/SKILL.md:26`、`v118workflow` 图片模板（降级为模型卡） | 图片节点 `getConfig` |
| R7 | 多轨数据结构（单字段） | `promptCompatPromptSchema.md` → 未来类型定义与模块注释 | 6 处技能文档、4 处工具描述 | 类型 + zod + V11/V7 |
| R8 | 静态校验规则 | `planValidator.ts`（V7/V8/V11/V15） | 引导层只引用"提交前检查"，不复述 V 编号细节 | planValidator |
| R9 | 提示词创作内核 | `workflow/SKILL.md` PART A（A1–A8、A11–A12） | 多轨与直连都引用同一内核 | 无 |
| R10 | 多轨工程契约（字段、状态、CAS） | `multitrackTemplate.md` §一·§二 | runbook 只讲步骤 | `multitrackNode` |

### 6.2 现存重复的 6 组（必须先拆再谈收敛）

| 组 | 重复位置 | 保留 | 其余改法 |
|---|---|---|---|
| 六段落位规则 | `multitrackTemplate.md:152-163`、`canvas/SKILL.md:107`、`videoProduction.md:45`、`generationRunbook.md` §四 | `multitrackTemplate.md` §四 | 另三处各留一句"写法见 §四"，删除段序与段首表 |
| 默认模型口径 | §4.1 的 14 处 | `videoProduction.md` §0.1 | 指针或本处特有交互 |
| 多轨触发词 | `canvas/SKILL.md:24`、`workflow/SKILL.md:21`、`canvasExecution.md:3` | `workflow/SKILL.md` R1 节 | 其余两处引用 R1，不再枚举触发条件 |
| PART A 优先级 | `workflow/SKILL.md:24/31/52/57/85/1373/1412` 等 5–7 处 | "多轨接入"节一处 | 其余删重述，只留"内核仍适用"一句 |
| 标记换算 | `canvas:107`、`videoProduction:45/49`、`workflow:804`、`runbook:108` | §0.1 条件句 | 其余引用；runbook 保留"现状说明"但标注为事实描述 |
| 图片默认 | `canvas:120`、`videoProduction:79`、`workflow:26` | §0.1 | 指针 |

### 6.3 落点验收（设计层面）

一条规则合格的标准是：**在仓库里 grep 它的关键词，只能命中真源一处 + 若干"见 X"的指针**。若出现两处完整描述，即视为未收敛。建议后续实施任务把这条写成评审清单项，而不是靠人记。

---

## 7. agent 侧判定步骤

### 7.1 九步

1. **定形态**：读 R1 节。工作区有 `.mtrack` 工程，或任务属于分镜批量 / 跨镜连续性 / 需要状态回写 → 多轨；否则直连例外。
2. **定媒体**：图（资产卡 / 分镜首帧 / 关键帧 / 图片编辑）还是视频；视频再分多轨镜与单镜节点。
3. **取模型**：
   - 多轨：读 `global.model` 声明；未声明则用路由表默认，并在首次派工时用节点 `getConfig` 核实。
   - 单镜：直接 `node:getConfig`。
   - 用户点名优先于工程声明；点名与节点实际不一致 → 报告，不静默换。
4. **取任务类型**（仅视频）：读 `mode` 与实际参考构成 → ref2va / 其他。`mode` 可能被引用变化改写，必须现读。
5. **查表**：按 `(providerId, modelId)` 找 `promptProfile` → 格式卡；找不到 profile 时按 `modelId` 回退，仍找不到则按通用模型卡并说明不确定。
6. **落位**：多轨写 `clips[].prompt` 单字段；单镜写 `data.prompt`；图片写节点提示词。
7. **写作**：按格式卡写；标记用该模型的写法；不写"引擎会替我补"的东西。
8. **自检**：静态检查（planValidator 或等价人工核对）+ 预检（模型/模式/参考数是否支持）→ 派工 / 生成。
9. **切模型事件**：重查表 → 提示受影响镜头 → 用户逐镜整理 → 不自动改写。

### 7.2 判定实例

| 场景 | 形态 | 模型 | 任务 | 外壳 | 标记 |
|---|---|---|---|---|---|
| 多轨，默认工程 | 多轨 | freevideo / MiniMax-H3 | ref2va | 六段写进单字段 | 官方尖括号，按类型各自编号 |
| 多轨，用户点名 Seedance 2.5 | 多轨 | Seedance 2.5 | 对应其多参模式 | 九字段白名单 | 句柄原样，不编号 |
| 多轨，tfRouter 提供 H3 | 多轨 | tfRouter / MiniMax-H3 | ref2va | 六段 | 旧REF占位标记**不换算**（provider 非 freevideo），需直接写官方标记；补 `promptProfile` 后换算可用 |
| 单镜，首帧模式 | 直连 | freevideo / H3 | startFrameOptional | 三段 | 官方标记 |
| 资产图 | 图片 | freevideo-image | 文生图 | 内容要素清单（无段式） | 多参考时按该模型卡 |

### 7.3 判定失败时怎么办

- 模型能力不足（时长超限、参考数超限、模式不支持）→ 报告 + 给可行替代，不静默降级（master 的「只报不换」）。
- 格式卡缺失 → 说明缺项，按"先查实际能力再问"处理，不凭简介编造格式（沿用 master 的 `canvas/SKILL.md:26` 降级规则）。
- 工程声明与实际节点不一致 → 停止，等用户确认。

---

## 8. 待决岔路口（请用户拍板）

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| Q1 | 多轨能否切非 freevideo | A 引导层禁止 / B 格式随模型 / C 只警告 / D UI 限死 | **B + C**（§5） |
| Q2 | `global.style` 与「首行必须 subject_definitions」冲突 | A 接受前缀 / B style 默认空且放宽首行口径 / C 派工时折进 `[Shot 1]` 定语 | **B**：style 默认空；若填了，前言不属于六段的表述写进格式卡；C 违反"执行层不改写" |
| Q3 | 分镜首帧图的归属 | A 补进 `imagePrompt.md` / B 留在 `v118workflow` / C 新建独立规范 | **A**（§3.3） |
| Q4 | 默认口径真源位置 | A `videoProduction.md` §0.1 / B `generationRunbook.md` | **A**（直连与多轨都够得着） |
| Q5 | 文本参考追加在六段之后（D4） | A 保持现状 + 文档说明 / B 改为写进 `detailed_description` 或文首 | 需要产品/模型验证，暂**不并入本轮** |
| Q6 | H3 经其他供应商提供时的换算 | A 加 `promptProfile` 声明 / B 维护供应商名单 / C 不换算、要求直接写官方标记 | **A**；B 会静默过期；C 会让 tfRouter 用户体验退化 |
| Q7 | 是否保留旧代码可读的降级形状 | A 不保留（单串，旧代码读空）/ B 双写三字段 / C 保留"扁平三字段"兼容形状 | **A**（三字段从未发布，见分册 §3.4） |

---

## 9. 边界与接口

- **本轮不实施**：上面所有"改法"都是设计与文案级建议，不改 `packages/skills`、不改代码、不改 DSH 技能包。
- **与分册的接口**：数据结构、UI、`buildPrompt`、校验器、`rewriteShot` 的完整规格见 [promptCompatPromptSchema](promptCompatPromptSchema.md)；本文只引用结论。
- **与 t3 的接口**：六段/三段分界、标记编号、派工拼装事实取 `promptCompatFreevideo.md`；本文把它转成"任务类型"这一列。
- **与 t4 的接口**：非 freevideo 六张格式卡与其误伤清单取 `promptCompatNonFree.md`；本文的 §4.5 条件句模板是对其 NF 清单的落地形态。
- **本轮未覆盖**：wire 层文本参考追加顺序（D4）、`configureNode` 的模型一致性预检实现、`promptProfile` 的 provider 侧声明改造，均需另立实施任务。

---

### 附：硬约束自查

- 全文无双花括号模板字面量。
- 所有建议文案使用条件句（"当…时"），未使用版本叙事。
- 只新增 `docs/` 下文件，未触碰技能、业务代码与 DSH 技能包。
