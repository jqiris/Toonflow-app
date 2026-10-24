# 三份设计的红队质询（t7）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


对象：[t3 freevideo 规范](promptCompatFreevideo.md)（348 行）、[t4 非 freevideo 格式](promptCompatNonFree.md)（317 行）、[t5 数据结构与分流](promptCompatPromptSchema.md)（326 行）＋[t5 主方案](promptCompatRouter.md)（371 行）。
方法：只读比对 + 代码事实复核 + 以「只有 MCP 工具、看不到源码的 agent」为假想执行者走一遍。全部结论带 `file:line`；未改任何技能、业务代码或 DSH 技能包。

**总判决：三份设计单独看都成立，合在一起还不能作为实施依据。** 不是因为谁写错了，而是它们对四个共用事实给了三种答案：**路由键、单镜段落数、换算范围、三字段的去留**。其中两个会直接产出错格式（X-1、X-2），一个会让引导文案承诺代码没做的事（X-5），一个是文档集内部的自相矛盾（X-4）。t5 的数据结构方向正确，但它把「格式归属」只解决到存储层，引导层（DSH 技能包 9 文件）与校验层各留了一半，因此**「格式由供应商提供」目前只完成了约 60%**。

---

## 0. 判决表

| 对象 | 结论 | 一句话理由 | 放行条件 |
| --- | --- | --- | --- |
| t3 可用性 | **内容可用，路由不可用** | 六段/三段/编号/wire 事实全部核实为真；§1.1 的路由键与 §1.3 的决策表逻辑倒置 | 改 §1.1、§1.3；补单镜/多轨段落数裁决 |
| t4 可用性 | **格式卡可用，矩阵两格错** | 6 张卡的字段、编号、语言、上限与代码一致；§七 的「直连三段式内容」与 t3 冲突 | 修 `:94`、`:268` 两格；换算范围与 t5 对齐 |
| t5 可用性 | **方向对，执行与安全未闭环** | 单串 + 读归一 + buildPrompt 退化是正确骨架；但迁移不可逆且无备份、校验器改动顺序有静默窗口、引导层没进落点 | 补 R-03/R-06/R-08 写法；补备份与计数对账；补 DSH 9 文件 |
| 是否可同时实施 | **否** | X-1～X-6 未裁决，实施者会按各自读到的稿子做出互斥实现 | 先拍板 §8 的 5 个决定 |
| 「单字段化 = 格式不绑供应商」 | **存储层成立，整体不成立** | 字段确实中立；但迁移函数把 H3 段名冻进文本、V11 按 modelId 字面量开闸、DSH 引导仍三字段 | 见 §2 的 P-1～P-6 |

---

## 1. 交叉一致性：逐条比对

### 1.1 先说一致的部分（这些可以放心继承）

| 事实 | t3 | t4 | 代码复核 | 判定 |
| --- | --- | --- | --- | --- |
| 官方标记按媒体类型各自从 1 编号 | `promptCompatFreevideo.md:175` | `promptCompatNonFree.md:94` | `promptWriting.md:42` | 一致 |
| 引用位次 ≠ Picture 序号（声音卡会错位） | `:173-175`、`:186-190` | `:94` | `generationRunbook.md:112` | 一致 |
| 换算只发生在 freevideo 的 wire 层 | `:189` | `:181`、`:247` | `videoGenerationNode/src/index.vue:225-228` | 一致（但 t5 要扩，见 X-5） |
| 所有供应商都做的只是词根归一化 | `:190` | 未单列 | `index.vue:229-231` | 一致 |
| 多轨与单镜的差异只有三处 | `:163-171` | 未单列 | `directDispatch.ts:97-114` | 一致 |
| 无参考时 H3 走基础三段 | `:138-146` | 未写 | `freevideo.ts` readme:209 | 一致（t4 漏写） |
| 六段首行/prompt 写作层规则 | `:129` | 未写 | `multitrackTemplate.md:163` | 一致（t5 要改口径） |

**结论：** 格式内容层没有实质冲突；冲突全部集中在「谁决定用哪套格式」与「一套格式落在几个字段」这两件事上。

### 1.2 X-1 单镜视频到底几段（高，会直接产出错格式）

- t3：单镜节点用**同一套六段**，有参考就是 ref2va；「任何『多轨六段、单镜三段』的说法都是错的」（`promptCompatFreevideo.md:157-171`）。
- t4：格式卡把 freevideo 写成「ref2va 六段（多轨三字段 / **直连三段式内容**）」（`promptCompatNonFree.md:94`），矩阵再写「画布直连视频节点 = **三段式内容** + 旧标记 → 引擎换算」（`:268`）。
- 代码事实：单镜节点只认 `data.prompt` 一个字符串（`videoGenerationNode/src/index.vue:453-463` 写、`:225-238` 才拼装），节点没有 `global.style` 前缀；任务类型由 `mode` 与实际参考决定（`:157-159`、`:191-198`）。有参考且未收缩到首尾帧，官方口径就是 ref2va 六段。

**裁决：t3 对。** 但 t4 不一定是「写错」，更可能是**术语碰撞**：t4 的「三段式」指 master 的「素材定义＋顺序镜头＋风格约束」三段式，t3 的「基础三段」指 H3 官方的 `integrated_multimodal_description` ＋两个声音段。两个「三段」在文本里长得一样，执行者无法区分。

**必须做：** 在 t4 里把这两个词改成两个不同的名字——「master 三段式（素材/镜头/风格）」与「H3 基础三段（integrated/overall/non_diegetic）」；`针对 freevideo 的直连格`必须改为「有参考→六段；无参考→H3 基础三段」。否则一个照 t4 写直连 H3 的 agent 会把 ref2va 任务写成三段，属于确定性错误。

### 1.3 X-2 路由键：三份稿三种答案（高，逻辑倒置）

| 稿 | 原文 | 问题 |
| --- | --- | --- |
| t3 | 判定键是二元组，**`providerId` 优先**；「只看 `modelId` 会把『别家的 H3』误判成 freevideo 格式」（`promptCompatFreevideo.md:23-25`）；决策表第一列就是 `config.providerId`（`:39-46`） | 结论与理由相反：H3 由五家提供（`metaso.ts:70`、`tfRouter.ts:170`、`apiMart.ts:191`、`compshare.ts:1762`、`freevideo.ts:216`），`modelId` 才是它们的共同点；按 `providerId` 判反而会把 tfRouter 的 H3 判成「别家」 |
| t4 | 「**模型名是唯一路由键**，且只在 A0（workflow）/ 模型选择（canvas）一处判定」（`promptCompatNonFree.md:257`） | 只按 modelId 也不够：同一 `MiniMax-H3` 在五家的 `mode` 不同（如 compshare 是 `singleImage/endFrameOptional`、tfRouter 没有 `videoReference`，见各文件 `mode` 行），能挂几个参考、能不能首帧，都是 per provider 的 |
| t5 | 二元组，但分工明确：`modelId` 定格式族，`providerId` 定传输换算（`promptCompatRouter.md:49-56`、`:19`） | 与代码事实最贴合；但没有解释「五家 H3 的 `mode` 不同」该归哪一栏 |

**裁决：以 t5 的分工为骨架，补一条能力栏。** 正确表述应是三分：

1. **格式族** ← `modelId`（H3 / Seedance 2.0 / 2.5 / 通用）；
2. **能力与任务类型** ← `(providerId, modelId)` 条目的 `mode`、`durationResolutionMap`、参考上限（五家 H3 不同，必须按条目读，不能按模型名猜）；
3. **传输换算** ← `providerId`（当前只有 freevideo 做旧标记换算，`index.vue:228`）。

t3 的 §1.1 与 §1.3、t4 的 §六 第 1 条都要按这三行改；否则会出现两种可预期的错误：按 t3 写，tfRouter 的 H3 被当成「其他供应商」而套 Seedance 外壳；按 t4 写，以为五家 H3 能力相同而在 compshare 上挂首帧参考。

### 1.4 X-3 `global.style` 与「首行必须 subject_definitions」

- t3：`global.style` 由引擎拼在正文最前，所以「只要 style 非空，wire 首行就是『全片风格：』」，并把这条登记为 D3 未决（`promptCompatFreevideo.md:151`、`:194`；`:309` 登记为 D3）。
- t5：`style` 保持可选、**取消 `multitrackTemplate.md:72` 的必填**；若用户填了，首行变成风格句，与硬要求字面冲突，留给 Q2（`promptCompatPromptSchema.md:197-204`；`promptCompatRouter.md:348`）。
- 代码：`buildPrompt` 确实把 style/systemPrompt 拼在正文前（`directDispatch.ts:101-105`）；节点侧不做前缀（`videoGenerationNode/src/index.vue:225-238`）。
- DSH 引导：`~/.dsh/skills/toonflow-mtrack/references/h3Format.md:22`、`:117` 把「第一行必须是 subject_definitions」写成硬要求，`:102` 同时承认 style 会被拼在最前；`mtrackContract.md:27` 也重复了一次。

**裁决：这不是二选一，是两个作用域。** 写作层（draft / `clips[].prompt` 的正文）首行必须是 `subject_definitions:`；wire 层允许工程前言，前言不属于六段。t3 的 `:194` 已经这么写了，t5 的 Q2 B 与它相容；真正的问题是**同一条规则在五处、三种措辞**：`multitrackTemplate.md:163`（写作层，但没说 scope）、t3 `:129`（写作层）、DSH `h3Format.md:22/117`（不分层）、`mtrackContract.md:27`（分层但另写一份）、t5 `schema:231-235`（warning 按首行判）。实施时必须收成一句、放一处（建议 `multitrackTemplate.md` §四），其余四处只留指针；DSH 副本按同一句改。

另：t5 取消 `style` 必填是**行为变更**，不只是文案；现有工程若依赖「style 必填」的校验（模板层）会松动。这是产品决定，应放进待拍板项，而不是夹在「文档改口径」里。

### 1.5 X-4 三字段 vs 单串：t5 与 t3 的落位表互斥

t3 的 §3.2、§3.4、§3.6 全部以三字段为落位（`clips[].prompt.integratedMultimodalDescription` ＋ 两个声音字段，`promptCompatFreevideo.md:127-136` 落位表、`:163-171` 差异三处）；t5 把 `clips[].prompt` 改成单字符串（`promptCompatPromptSchema.md:75`、`:28`），并删除三字段类型。两者不可能同时实施。

**裁决：t5 在「存储」上优先，t3 在「格式内容」上优先。** 文档集必须显式写这一句，否则实施者按 t3 的落位表建三字段、按 t5 改 schema，必然对不上。具体动作：t3 的落位列全部改为「单字段内的第 1–4 段 / 第 5 段 / 第 6 段」，「落位」表只保留「多轨 vs 单镜」两行；t5 的 §7 改口径清单要加一条「t3、t4 的落位表述随单字段化重写」。这不是实现，属于文档集一致性。

### 1.6 X-5 H3 换算范围：t4「只 freevideo」 vs t5「promptProfile 覆盖五家」

- t4：把「旧标记只由引擎在生成时换算」列为误伤 NF-3，要求改成「**只发生在 freevideo**；其他供应商收到原始文本」（`promptCompatNonFree.md:174-181`）；换算扩围被列为岔路 D，「建议另立需求」（§九）。
- t5：Q6 建议 A，给 `ProviderModel` 加 `promptProfile`，让 metaso/apiMart/compshare/tfRouter 的 H3 也换算（`promptCompatRouter.md:94-100`、`:352`）；§7.2 的示例又承认「旧标记**不换算**（provider 非 freevideo），补 profile 后换算可用」（`:331`）。

**裁决：本轮必须选 C，不能选 A，除非同批改代码。** 现状只有 `index.vue:228` 一处换算，且判据是 `providerId === "freevideo"`；不改代码就写「H3 即换算」，引导层就是在承诺不存在的行为——这正是 t4 的 NF-3 要修的病。若用户要 A，最小改动是：`types.d.ts:14-26` 加可选字段 ＋ 五个 provider 的 H3 条目各加一行 ＋ wire 与 V11 各改判据（约 7 文件），且需逐家实测（tfRouter 没有 video 参考、compshare 模式不同）。**「补 profile 后可用」不能写进本轮的技能文案**，只能写「当前不换算，请直接写官方标记」。

### 1.7 X-6 单点判定：t4「只在 A0」 vs t5「多轨读 global.model」

t4 说路由键只在 A0（直连）/ 模型选择（canvas）一处判定（`:257`）；t5 的多轨流程是在 `global.model` 处判定（`promptCompatRouter.md:262`、`:315`）。多轨没有 A0，这不是矛盾，是两种形态各有一个判定点。但文字上「只在 A0」会把多轨的 `global.model` 判成非法第二真源。

**改法：** 写成「每种形态一个判定点：直连在 A0，多轨在 `global.model`（派工前再以节点 `getConfig` 核实）；两处喂同一张 `promptProfile` 表」。这样既保留单点原则，也承认多轨的入口不同。

### 1.8 一致性汇总

| ID | 冲突点 | 严重度 | 裁决 | 责任稿 |
| --- | --- | --- | --- | --- |
| X-1 | 单镜 H3 有参考的段落数 | 高（错格式） | 六段；t4 两格改 | t4 |
| X-2 | 路由键是 providerId / modelId / 二元组 | 高（错路由） | t5 骨架 ＋ 能力栏；t3 改 §1.1/§1.3 | t3、t4 |
| X-3 | style 与首行规则 | 中（口径冲突） | 写作层 vs wire 层，规则收一处 | t3、t5、DSH |
| X-4 | 三字段 vs 单串 | 高（结构互斥） | 存储随 t5、格式内容随 t3，写进文档集序言 | 全体 |
| X-5 | 换算范围 | 高（假承诺） | 本轮 C（不扩），A 另立并同批改码 | t5 |
| X-6 | 单点判定位置 | 低（措辞） | 每形态一个判定点，共用一张表 | t4 |

---

## 2. 「单字段化后格式归属」审计

### 2.1 审计口径

用户的要求是「多轨提示词只有一个输入框、格式由供应商提供、底层兼容」。它拆成三层：

1. **存储层**：字段名不出现任何供应商/段名；
2. **交互层**：输入框、占位、辅助文案不教某一家的格式；
3. **校验/执行层**：规则按「模型声明」开闸，不按路径/形态/供应商写死。

三层全过才算解耦。逐层查 H3 的六个段名（`subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music`）与它们的执行行为（首行、补段首、声音尾段、换算）。

### 2.2 结果

| 通道 | 是否出现 H3 段名/行为 | 证据 | 判定 |
| --- | --- | --- | --- |
| 数据结构字段名 | 否（`prompt: string`） | `promptCompatPromptSchema.md:75`、`:28` | 过 |
| UI 输入框占位 | 否（「按工程当前视频模型的官方格式书写本镜」） | `:157` | 过 |
| UI 辅助行 | 只显示 providerId/modelId | `:158-161` | 过 |
| 错误/空态文案 | 否（「本镜提示词为空」等） | `:218`、`:253` | 过 |
| 校验器 V11 | 否（只判空） | `:216-220` | 过 |
| 校验器 V7 边界 | **按 `global.model.modelId` 字面量匹配 `MiniMax-H3` 才开闸** | `:228` | **部分泄漏（P-2）** |
| 校验器 warning 文案 | **内嵌「工程模型为 freevideo 时由 wire 换算」** | `:227` | **泄漏（P-3）** |
| 迁移函数 | **合成时写入 `overall_soundscape:` / `non_diegetic_music:`** | `:91-92` | **边界泄漏（P-1）** |
| 工具描述 | planOperator 的 `promptEssentials` 仍四条三字段口径 | `planOperator/src/index.ts:391-396` | **待改（P-4）** |
| DSH 运行时引导 | 9 文件整体三字段 ＋ 硬首行 ＋ 「引擎会兜底补段首」 | `h3Format.md:13-22`、`:100-102`、`:117`；`mtrackContract.md:41-43`、`:59-60`；`productionFlow.md:57`、`:63-65`；`troubleshooting.md:76` | **未解耦（P-5）** |
| 格式真源 | `multitrackTemplate.md` 与 DSH `h3Format.md` 各一份六段表 | 两处 | **双真源（P-6）** |

**结论：存储与 UI 层是干净的（这也是 t5 最大的成果），但「格式由供应商提供」在运行时只完成了一半。** 用户看到的输入框确实中立；agent 真正读的那份技能包仍然按三字段与 H3 写，校验器仍按 `modelId` 字面量开 H3 的闸。只要 P-5 不改，单字段化就只是把「三字段的 H3」换成了「单串的 H3」。

### 2.3 逐条

**P-1（高）迁移把 H3 段名冻进文本，且切模型后不可检测。**
`readPrompt` 对老对象合成时写入 `overall_soundscape:` / `non_diegetic_music:`（`promptCompatPromptSchema.md:91-92`）。这对老 H3 工程是正确的；但迁移是「保存即完成」（`:289`），之后若把工程模型切到 Seedance，`clips[].prompt` 里仍是 H3 段名，而 V7 的 H3 校验因 `global.model` 已不是 H3 而**整段跳过**（`:228`），V11 只判空（`:216-220`），于是**没有任何信号**。这不是「格式随模型」，而是「文本是旧格式、模型是新声明、系统不知道」。
**改法（三选一，必须落一个）：** ① 迁移时在工程里留一个**不可见的兼容标记文件**（不是字段版本位），切换模型时用它提示「本工程提示词由 H3 迁移而来，切换后建议逐镜重写」；② 切换模型时按段名做一次**启发式扫描**，统计疑似 H3 文本的镜头数并显示（只读、不阻塞）；③ 明确写「迁移后的存量文本视为 H3 格式，切模型即视为待重写」，并在切换对话框里写死这句话。①会引入新文件，③最省；无论哪个，都不能假装「正文与模型无关」。

**P-2（中）V11 的边界校验用 modelId 字面量。**
`:228` 写「`global.model.modelId` 匹配 `MiniMax-H3`」。问题有三：`promptProfile` 已经设计出来却不用；同一模型在五家的条目都在，字面量匹配会漏掉大小写/别名；`planValidator` 是纯函数，拿不到 provider 时只能靠字符串猜。**改法：** 把判据改成「`promptProfile === "minimax-h3"`」或「模型条目声明了 H3 边界」，由调用方把 profile 传进校验器；`global.model` 只作为「工程声明」来源，不作为格式判据。

**P-3（中）warning 文案是第二份 wire 规则。**
`:227` 的提示语写「工程模型为 freevideo 时由 wire 换算，其他供应商下原样透传」。这句话本身正确，但它把「换算判据」复制到了校验器文案里；一旦换算扩到五家（X-5），这句就过期。**改法：** 文案只说「正文含旧REF占位标记：换算规则见该模型的格式卡」，把判据留在代码与格式卡两处（代码是事实、格式卡是解释），不要在三处各写一遍。

**P-4（中）`promptEssentials` 仍按三字段描述。**
`planOperator/src/index.ts:391-396` 的四条要点仍是「integratedMultimodalDescription 为画面主体」「overallSoundscape 为环境声」……并含一个旧REF占位标记示例。t5 §7 已列入改口径（`:311`），但**没有给出替换文案**。执行者按「单串」改时容易写成「把三条合成一段」，仍保留字段名。**改法：** 替换成两句：「本镜提示词是一个字符串；格式按工程所选模型的格式卡书写；参考用该模型要求的标记写法指位。」不列任何字段名或段名。

**P-5（高）DSH 技能包 9 文件未进落点，而它是 agent 真正读的那份。**
实测 `~/.dsh/skills/toonflow-mtrack` 9 文件：`h3Format.md:13-18` 的三字段落位表、`:20` 的「前四段连写、后两段各存字段」、`:22` 的「漏写段首时引擎会兜底补 `detailed_description`」、`:100-102` 的 buildPrompt 行为、`:117` 的「第一行必须是 subject_definitions」检查项；`mtrackContract.md:41-43`、`:59-60`；`productionFlow.md:57`、`:63-65`；`troubleshooting.md:76`。t5 的 §7 只列了仓库内文档，没有这 9 个文件；t6 的 R-11 登记了，但没有写进 t5 的落点。
**后果：** 单字段化上线后，MCP agent 仍会按三字段写回，`multitrackNode` 的 strict schema 直接拒绝（`multitrackNode/src/index.vue:336-340`），或写进一个不存在的对象形状；这不是「引导轻微过期」，是**主链路断**。
**改法：** 把 DSH 9 文件列为与代码同批的 P0 交付；`h3Format.md` 的段名表改为「H3 格式卡」并保留（它是 H3 的真源之一，见 P-6），但落位、补段首、buildPrompt 描述必须改；`mtrackContract.md` 的字段表改单串；`troubleshooting.md` 的「按六段补」改为「按格式卡补」。

**P-6（中）六段表有两份真源。**
仓库 `multitrackTemplate.md:152-163` 与 DSH `h3Format.md:13-22` 各有一份六段表，且后者多了「引擎兜底」与「首行检查」两段行为描述。t5 把 `multitrackTemplate.md` 定为 R3 真源（`promptCompatRouter.md:282`），但没有处理 DSH 副本。两份表迟早漂移（现在已经漂了：兜底行为 vs t5 删除兜底）。
**改法：** 二选一：① DSH 文件只留一句「H3 六段的段名、顺序、落位见工程内 `assetCard/references/multitrackTemplate.md` §四」，不再复制表；② 若 DSH 必须自带（离线可用），则把它声明为**生成副本**，并在文件头写「与 X 同步，改一处必须改两处」——这仍是双写，不推荐。优先①，但要先确认 agent 在 MCP 场景下能读到工程内技能文件（见 §3 卡点 G）。

---

## 3. 分流表的可执行性：MCP-only agent 逐步模拟

前提：agent 只有 MCP 工具（`planOperator` 与画布工具），看不到源码，也不知道 `docs/` 里的设计稿；它读到的引导是 DSH 技能包。工作区里有一个多轨工程 `plan/story.mtrack`（可能不存在）与一个已打开的 Toonflow 页面（可能没有）。用户说：「帮我做这段视频」。

| 步 | agent 会做什么 | 实际能拿到什么 | 卡点 |
| --- | --- | --- | --- |
| 0 | 判形态：找 `.mtrack` | `planOperator mtrackRead` 需要 `path`（默认 `plan/story.mtrack`）与 `target.directory`；没有页面时必须显式给目录 | **卡点 1**：没有页面又没有目录时，agent 连「有没有工程」都无法确认，只能先问用户 |
| 1 | 读工程 | `mtrackRead` 返回 `{ raw, project }`（`planOperator/src/index.ts:276-303`，读取在 `:595-600`），`project` 已 normalize | 通过 |
| 2 | 取模型 | `global.model` 声明值（`mtrackProject.ts:45`） | 通过，但只是声明（`multitrackEditor.vue:665-671` 可改、`directDispatch.ts:379-382` 才真下发） |
| 3 | 读任务类型 | 多轨没有节点时读不到 `mode`；只能按「有参考/无参考」猜 | **卡点 2**：`mode` 的权威在节点（`videoGenerationNode/src/index.vue:385-399`），派工前不存在节点；t5 的「九步」第 4 步在多轨规划阶段不可执行 |
| 4 | 查格式卡 | DSH 只有 H3 卡（`h3Format.md`）；Seedance/Wan/Seedream/Nanobanana 卡只在仓库技能里，MCP agent 不一定读得到 | **卡点 3**：用户点名 Seedance 2.5 时，agent 没有可读的 A9.2 九字段卡，只能凭训练知识写，格式不可控 |
| 5 | 写提示词 | 多轨要写 `clips[].prompt`。`planOperator mtrackUpdate` **只允许 status/nodeId/assetPath/attempts 四个字段，明令禁写 prompt**（`planOperator/src/index.ts:142`、`:191`、`:304-312`） | **卡点 4（硬）**：纯 MCP 无页面时**写不进去**；必须经画布节点 `node:editProject`（`multitrackNode/src/index.vue:407-418`），而它要求页面连接 |
| 6 | 参考编号 | 需要知道 `<Picture N>` 按类型各自编号（DSH `h3Format.md` 有）；旧标记换算只在 freevideo | 通过（H3）；非 H3 无卡（同卡点 3） |
| 7 | 自检 | `planOperator validate` 可跑（V1–V15）；无页面也可 | 通过，但校验器仍是三字段口径（P-2/P-5），会给出错误结论 |
| 8 | 派工 | `planOperator dispatch` 出清单；输出里 `providerId/modelId/mode` 三项写「待 node:getConfig 决定」（`index.ts:387-389`） | **卡点 5**：清单是「待定」，agent 必须先建节点、`setConfig` 后才能确认格式——但提示词已经写完了，顺序反了 |
| 9 | 生成/回写 | 画布 `nodeTools` 生成、`node:getGenerationStatus` 轮询；状态回写可走 `mtrackUpdate` 四字段 | 通过（有页面）；无页面时生成不可执行 |

**结论：** 分流表在**「页面已连接」**的形态下可执行，但仍有卡点 2/3/5 三处顺序或资料缺口；在**「纯 headless」**形态下只能完成「读、校验、出清单」，不能写提示词、不能生成，因此不能宣称「agent 可以从一句话走到成片」。t5 的九步（`promptCompatRouter.md:310-323`）需要加一列「所需 surface」：`read/validate/dispatch` = 服务器工具即可；`写 prompt/生成` = 需要画布页面。

**三个必须补的判定项：**
1. **卡点 2 的顺序**：多轨的格式判定发生在「写 prompt 之前」，而 `mode` 的权威在「派工之后」。设计必须明确：规划阶段以 `global.model` ＋「是否有参考」为准，派工后若 `getConfig` 不一致则**停止并重写**，而不是假装预检通过。
2. **卡点 3 的资料**：如果最终形态要支持用户点名非 freevideo，DSH 技能包必须新增/指向 6 张格式卡；否则「格式由供应商提供」只对 H3 成立。
3. **卡点 4 的写入路径**：单字段化后，MCP 侧仍不能写 prompt 是既有边界，不是本次引入；但方案要写明「agent 写多轨提示词必须经画布节点」，并在 DSH 的 `mcpTools.md` 里给出调用顺序，否则执行者会以为 `mtrackUpdate` 能写。

---

## 4. 用户约束对账

| # | 约束 | 判定 | 证据 | 缺口 |
| --- | --- | --- | --- | --- |
| a | 不用「旧版/历史/作废/已迁移」叙事 | **未闭环** | 三份设计稿本身基本干净（t4 只在引用现文时出现，`:168`、`:171`、`:204`；t5 明确要求删除 `:227` 的「迁移」措辞）；但技能树仍有：`v118workflow/SKILL.md:13`「历史流程复现」「旧版工程续作」，`imagePrompt.md:21` 把 Seedream/Nanobanana 定性为「旧模型」（t4 NF-2 已指出） | 本轮设计没有把「改哪些文件」写进落点（t5 §7 未列 v118 与 imagePrompt.md 的这两句）；实施时会漏 |
| b | 不把非 freevideo 模板并掉/改写成 freevideo 口径 | **基本满足，一处风险** | t4 的原样保留清单 R1–R6（`:94-...`）；t5 §7 只把 canvas/videoProduction 的六段规则改指针（`:306-307`），未删 A9 模板 | 风险在 P-1：迁移后的存量文本是 H3 口径，若用户在 Seedance 工程里复用，等于把 H3 文本带进非 H3 工程；需要在切换/复用路径上提示，不能默默混用 |
| c | 默认路径是本地 freevideo | **满足** | t5 默认表（`promptCompatRouter.md:169-184`）与模板默认（`multitrackTemplate.md:74`）；图片默认 freevideo-image | 真源落点 `videoProduction.md` §0.1 的可达性依赖 `data/skills/canvas` 存在（t6 R-10），本机成立；但这是「碰巧可达」，不是机制保证（见 §7 R-01） |
| d | 多轨默认 freevideo | **满足** | 同上；`workflow/SKILL.md:54/57` 保留锁存语义（t5 §4.1 第 6/7 行） | 无 |
| e | 多轨提示词单字段、格式不绑供应商 | **存储满足，整体未满足** | `prompt: string`（`promptCompatPromptSchema.md:75`、`:28`）；UI 一框（`:149-165`） | P-1～P-6：迁移、校验器、DSH 引导仍按 H3/三字段；「格式不绑供应商」在存储层成立，在引导层不成立 |

**术语校准（必须写进最终方案）：** 「格式不绑定供应商」只能理解为「字段与 UI 不绑定供应商」；**内容格式必须随供应商变**。若被读成「所有供应商共用一种格式」，就与 (b) 和 t4 的格式卡直接冲突。t5 的占位文案（`:157`）是正确读法，建议在文档开头用一句同义句固定它。

---

## 5. 最小改动性质疑

### 5.1 真正要动的面（按 t5 的落点累计）

| 层 | 文件数 | 明细 |
| --- | --- | --- |
| 数据结构与编辑 | 5 | `nodeShared/src/mtrack/mtrackProject.ts`、`mtrackEdit.ts`、`components/clipEditor.vue`、`multitrackEditor.vue`、`tools/planOperator/src/mtrackProject.ts`（删或改 re-export） |
| 派工与 wire | 2 | `directDispatch.ts`（buildPrompt）、`videoGenerationNode/src/index.vue`（不动代码，但需回归换算） |
| 校验与接口 | 3 | `tools/planOperator/src/planValidator.ts`、`index.ts`（schema/描述）、`apps/server/src/routes/mtrack/rewriteShot.ts` |
| 节点 schema | 1 | `nodes/multitrackNode/src/index.vue:336-340` |
| 依赖/构建 | 2 | `planOperator/package.json`（加 `@toonflow/node-shared`）、可能的打包配置 |
| 技能与文档 | 11 | t5 §7 的 11 行（`workflow/SKILL.md:45/54/804`、`canvas/SKILL.md:26/107`、`videoProduction.md:45/49`、`multitrackTemplate.md:88-90/152-163`、`generationRunbook.md:514/596/108`、`assetCard/SKILL.md:85`、`planOperator` 描述、`multitrackNode:531`） |
| DSH 技能包 | 9 | `~/.dsh/skills/toonflow-mtrack` 全部相关文件（P-5） |
| 服务端技能同步 | 2 | `apps/server/src/utils/plugins/initialize.ts`、`app.ts:72`（R-01） |
| 合计 | **约 35** | 不含测试（仓库规范不允许新增测试） |

### 5.2 被漏掉的更小方案 M0

t5 的成本表（`promptCompatPromptSchema.md:50-62`）只比较了 a（单串）/ b（保留三字段）/ c（联合类型），把 b 判为「长期漂移最高」。但它没有比较 **b 的一个变体**：

> **M0＝保留三字段形状与 `buildPrompt`，只把 UI 改成「一个框」写 `integratedMultimodalDescription`，两个声音字段冻结为空并降为可选；校验器把声音字段的 error/warning 降级；`rewriteShot` 接受单串并写入第一字段、另两字段置空。**

它同样满足用户五条：一个输入框（写第一字段）、格式按模型（文本就是一个字符串，模型规则不变）、底层兼容（`buildPrompt` 与 `readPrompt` 不动）、无迁移（老工程原样）、可回退（去掉改动即恢复）。代价：schema 里留着两个永远为空的字段，是「诱饵」，长期确实会漂。

改动面：`clipEditor.vue`、`planValidator.ts`（降级）、`rewriteShot.ts`（入参/回写）、`planOperator` 的 `clipPromptSchema`（允许字符串或对象）、文档 2–3 处，约 **6–8 文件**，且**完全可逆**。

**这不是建议选 M0，而是要求 t5 回答：** 为什么「把两个字段冻结为空」不可接受，而「不可逆迁移 ＋ 35 文件 ＋ 双类型副本」可接受？如果答案是「长期只有一种形状」，那是**另一个目标**（可维护性），不是本任务的「最小改动」。用户要的是「单输入框、格式由供应商提供、底层兼容」，M0 全部满足。t5 必须把 M0 放进成本表并给出量化对比，否则「最小改动」这一栏不成立。

### 5.3 单字段化后新增的「同一规则两处」

| 新重复 | 位置 | 风险 |
| --- | --- | --- |
| 六段名与顺序 | `multitrackTemplate.md:152-163` ＋ DSH `h3Format.md:13-18` | 现在已漂（兜底行为），见 P-6 |
| 首行规则 | `multitrackTemplate.md:163`、t3 `:129`、t5 `schema:231-235`、DSH `:117`、`mtrackContract.md:27` | 五处三种 scope，见 X-3 |
| 默认模型 | `videoProduction.md` §0.1（拟）＋ `router` §4.1 的 14 处盘点本身 | 设计稿可以写 14 处，运行时只能留真源＋指针；t5 已意识到，但落点未定稿 |
| `promptProfile` 枚举 | 代码 `types.d.ts` ＋ 技能文案「按 profile 选卡」＋ `router` §2.2 表 | 技能不应出现 profile 字面量（`minimax-h3`），否则第三个真源 |
| 「旧标记换算」 | `index.vue:228`（事实）＋ `canvas:107`/`videoProduction:45`（待改指针）＋ V7 文案 | 见 P-3 |

### 5.4 迁移可逆性：明确不可逆，且没有任何自动保护

- t5 自己写：「保存即迁移为单串」「旧代码读新文件，三字段全空」「明确不支持降级读取」（`promptCompatPromptSchema.md:123`、`:290-291`）。
- t6 实测：本机存在由 merge-v1 工作树产出的 200 镜工程 `南柯一梦/plan/story.mtrack`（`promptCompatRisk.md:317`）；三字段目前内容为空，所以「当下丢失为 0」，但**任何有内容的工程一旦保存就无法回到三字段**。
- 旧代码读到新文件时 `readString` 逐字段取不到 → 空串，**再保存会清空提示词**（`mtrackProject.ts:126-133` 的行为）。这不是崩溃，是静默清空。
- 现方案唯一的缓解是「切换分支前自己复制 `.mtrack`」（`promptCompatPromptSchema.md:123`），把数据安全交给用户记忆，不可接受。

**必须补：** 首次以单串写回前，自动复制一份同目录备份（如 `plan/story.mtrack.bak`，或 `plan/backup/story.<时间戳>.mtrack`），并在 UI 首次提示一次「提示词存储格式已更新，已备份到 X」。这不是版本叙事，是数据安全；备份文件不参与扫描。没有这一条，t5 的 Q7 A 不应放行。

### 5.5 结论

t5 的「最小」是**长期形状最小**（一种形状、一个真源），不是**本轮变更最小**。这两者都合理，但不能混用同一套说辞。建议最终方案明确写：「本轮选择长期形状，代价是 35 文件 ＋ 不可逆迁移；若用户要求本轮最小，选 M0，改动 6–8 文件且可逆。」把选择权交回用户。

---

## 6. 三份设计各 3 条必须补上才能用

### t3（freevideo 规范）

1. **改路由键与决策表（X-2）。** `:23-25` 的「providerId 优先」改为「modelId 定格式族、provider-model 条目定能力、providerId 定换算」；`:41-46` 的决策表第一列改为 `(modelId, 任务)`，并补一行 `tfRouter / MiniMax-H3`（六段、旧标记不换算）。验收：拿 `tfRouter` 的 H3 走表，必须得到「六段 ＋ 直接写官方标记」，不是「其他供应商模板」。
2. **补单镜/多轨的段落数裁决与术语（X-1）。** 在 §3.5 明确「有参考→六段、无参考→H3 基础三段、单镜与多轨同构」；同时给「master 三段式」与「H3 基础三段」两个不同的名字，要求 t4 引用时用全名。验收：t4 的 `:94`、`:268` 两格能直接照这句改，不再出现「直连三段式内容」的歧义。
3. **把「存量文本的格式归属」写成可执行规则（P-1 的上游）。** 现稿只说「三段式→六段映射」，没说「已经存在的三字段内容迁移后是什么格式、切模型怎么办」。补一句：「迁移后的文本视为 H3 ref2va/基础三段格式；工程模型切换后，这些文本不自动改写，按新模型的格式卡重写。」验收：t5 的切换对话框文案可以直接引用这句。

### t4（非 freevideo 格式卡）

1. **修两格矩阵（X-1）。** `:94` 与 `:268` 的「直连三段式内容」改为「有参考→六段；无参考→H3 基础三段」，并把「三段式」这个词限定为 master 三段式。验收：与 t3 §3.5 逐字对齐，grep「直连三段式」为 0。
2. **换算范围与 t5 统一（X-5）。** 在 §九 的 D 岔路写死「本轮 C：不扩换算；`promptProfile` 扩围另立，且必须与 5 个 provider 条目、wire、V11 同批」。并把 NF-3 的改法从「只发生在 freevideo」改为「当前只发生在 freevideo；扩围前不得在引导层承诺」。验收：全仓 grep「补 profile 后换算可用」为 0（`router:331`）。
3. **补「可达性」一节（P-5/P-6）。** 六张卡现在只存在于设计稿与仓库技能；MCP agent 实际读的是 DSH 技能包。补一张表：每张卡在哪个文件、agent 通过哪条路径读到、如果读不到降级为什么。验收：用户点名 Seedance 2.5 时，agent 能在 DSH 技能包内找到九字段卡（或明确的指针），而不是靠模型记忆。

### t5（数据结构与分流）

1. **把 R-03/R-06/R-08 写成硬约束与正向写法。**
   - 写入侧：明令「禁止对 `prompt` 使用对象展开」，给出正向形如 `prompt: patch.prompt ?? clip.prompt`；列出 `mtrackEdit.ts:34-37`、`clipEditor.vue:96-124` 两处现有展开必须删除（t5 只写了「整串替换」，没点名展开陷阱）。
   - 顺序：`planValidator.ts` 的 `[prompt]` 改动必须与 schema 同批，不能留「数据先单串、校验器后改」的窗口（否则 `:203-207` 在三字段 fallback 上静默跳过，R-06）。
   - 副本：只接受「planOperator 依赖 `@toonflow/node-shared`」这一条；「保留副本 ＋ 注释同步」不接受，因为这两份类型正是编译器抓不住漏改的原因（R-08）。若打包不允许，必须给出等价的运行时校验（zod 共用），不能只写注释。
   验收：三处 schema 同一提交；grep `{ ...clip.prompt` 为 0；`planOperator` 的 `mtrackProject.ts` 要么删除要么只 re-export。

2. **迁移安全与计数对账（5.4 ＋ R-05）。** 补「首次单串写回前自动备份」与「首次提示」；把「600→200」改成逐规则对账表：V11 error 200 保留（空提示词）、V11 warning 400 消失（两个声音字段检查被删）、新增 V7 提示（正文缺 H3 段首，若模型声明为 H3）。结论要写成「消失的是检查，不是问题」，避免用户以为工程变干净。验收：备份路径与提示文案确定；对账表覆盖 V11/V7 每条规则的增减。

3. **清理格式归属泄漏并补 DSH 落点（P-1～P-6）。**
   - V11 开闸判据从 `modelId` 字面量改为 `promptProfile`；警告文案不再复述换算规则，只指向格式卡。
   - `readPrompt` 头部注明「唯一的旧形状兼容点；只读；新数据不得经此写入」，并把「迁移后文本视为 H3 格式」写进切换流程。
   - 把 DSH 9 文件写进 §7 落点，与代码同批；`h3Format.md` 保留为 H3 卡，但删除「引擎兜底补段首」与三字段落位描述；`mtrackContract.md` 改单串。
   验收：全仓与 DSH 目录 grep 六个段名，只允许出现在两张格式卡与 `readPrompt` 的兼容分支；grep 三字段名，只允许出现在读兼容与历史数据说明中。

---

## 7. 对 captain 点名项的判定

### 7.1 R-01：只同步一次的机制是不是必须修的根因？——**是，但修法不是覆盖**

**机制复核：** `initialize.ts:10`：`initialized !== null && (revision === undefined || initialized === revision)` 直接 return；`app.ts:72` 调 skills 时**没传 revision**，所以只要 `data/skills/initialized` 存在，之后 `packages/skills` 的任何变化都不会同步。`app.ts:71` 的注释写明这是有意为之：「技能和团队只补首次安装，保留用户修改」。

**为什么它是根因而不是「一次运维」：** 本轮 merge-v1 不只新增 `assetCard`（7 文件），还改了 workflow / canvas / videoProduction 等**已存在**的技能文件。只要用户装过旧版，这些改动**一个都到不了** `data/skills`；`workflow/SKILL.md:31/43/45/74/1379/1399` 的六处强制指针会继续悬空，且永远不会自愈。靠人工 `cp` 只能救当前这台机器，不能救升级路径。

**为什么不能简单「传 revision」：** 现有 revision 分支是 `copyFile` ＋ `rename`（`initialize.ts:30-33`），只处理**单文件**；skills 传进来的是目录（`fileFilter` 未传时 `files` 是目录，`:18-20`），`copyFile` 对目录会抛 `EISDIR`。所以不能只改 `app.ts:72` 一行。

**最小正确修法（本轮设计要写进实施清单，不在本轮改）：**
1. `initialize.ts:22-40` 的循环按 `file.isDirectory()` 分支：目录用 `cp(source, target, { recursive: true, force: false, errorOnExist: false })`——**只补缺失文件，不覆盖用户已改文件**；单文件保持现有原子覆盖。
2. `app.ts:72` 给 skills 传一个**源内容哈希**（可复用 providers 的做法：对 `packages/skills` 逐文件 sha256，`app.ts:58-68` 已有同型逻辑）。`agents` 同理。
3. `initialized` 标记的内容从空串变为哈希；旧机器上的空标记 ≠ 哈希，会触发一次「补缺」，语义仍是「保留用户修改」，不会清空。
4. 对其它调用方无影响：tools/nodes/ext/providers 传的都是文件列表，目录分支不经过；`revision` 已有调用方不受影响。

**边界（必须同时告诉用户）：** 这个修法只能保证「新增文件能到达」；**已存在且被本分支修改过的文件仍不会更新**（因为 `force:false`）。要让 workflow/canvas 的改动到达老用户，需要三向清单同步（记录上一版内置哈希，未改过的覆盖、改过的报冲突），那是另一个任务。**判定：本轮必须修到「新增目录可达」；「已有文件更新」列为已知缺陷并请用户拍板，不能假装 R-01 已经解决。**

### 7.2 R-03：t5 有没有写清「写入侧不得展开」？——**只写了一半，不够**

t5 写了「`prompt` 整串替换，不再做字段浅合并」（`promptCompatPromptSchema.md:110`）、「`mtrackEdit.ts:34-37`：`prompt` 整串赋值」（`:239`），方向对；但**没有点名展开运算符是陷阱**，也没有给正向写法。现有代码 `mtrackEdit.ts:36` 是 `prompt: { ...clip.prompt, ...(patch.prompt ?? {}) }`，对两个字符串会得到 40 个字符索引键（t6 实测），`readPrompt` 只取三个具名键 → 空串。一个照「整串替换」理解的实现者，完全可能保留展开、只把右值换成字符串。

另外 `clipEditor.vue:96-124` 的三处 `{ ...clip.prompt, 字段: 值 }` 不在 t5 的落点表里（§4.1 只说删框、绑 `clip.prompt`），而它是**每次按键**都会走的路径；单字段化后如果保留这三行，输入第一个字就会把 prompt 变成对象、第二个字清空。

**判定：必须补两条硬约束：** ①「`prompt` 禁止任何对象展开／`Object.assign` 到旧对象；写入口只有 `prompt: next` 整串赋值」；②落点表加 `clipEditor.vue:96-124`，并给出替换后的 `@input="onPatch({ prompt: String($event) })"`。否则 R-03 不是「风险」，是**必现**。

### 7.3 R-08：两份 `mtrackProject.ts` 怎么收敛？——**必须选「加依赖」，不接受「只改字段名」**

t5 给了两条（`promptCompatPromptSchema.md:130-135`）：推荐加 `@toonflow/node-shared` 依赖；下策保留副本 ＋ 注释同步。**下策必须删掉**，理由：本次改的是**类型形状**（`ClipPrompt` → `string`），副本不同名（`ClipPrompt` vs `MtrackClipPrompt`）、互不导入，编译器抓不住漏改；planOperator 的 `clipPromptSchema`（`index.ts:24-28`）与 `planValidator`（`:203-207`）都依赖这个形状。只改字段名等于把「漂移」从类型层赶到运行时层。

**选加依赖后的具体动作（必须写死）：**
- `tools/planOperator/package.json` 增加 `"@toonflow/node-shared": "workspace:*"`；
- 删除 `planOperator/src/mtrackProject.ts`，从 `@toonflow/node-shared/mtrack/mtrackProject` 引 `normalizeProject`/`readProject`/类型（该子路径已在 `nodeShared/package.json` exports，且模块不引 Vue）；
- 若打包链路不允许 workspace 依赖，退路不是「保留副本」，而是**共用 zod schema 包**或**构建期类型生成**；两者都比注释强。验收：`planOperator` 内 grep `interface MtrackClipPrompt` 为 0；改 `ClipPrompt` 后 `planOperator` 编译必须报错（故意改一次验证）。

### 7.4 Q7 / 读兼容 vs 不双写：**自洽，但需要「备份」这一条才成立**

读归一（`readPrompt` 合成）＋ 写时不双写是自洽的：读兼容只在入口，写只有一种形状。但 t5 的论据「三字段从未发布，没有历史磁盘数据」（`promptCompatPromptSchema.md:116`；`router:28`）**在版本层面成立，在工作区层面不成立**（t6 实测 200 镜工程）。因此：
- 「读兼容」必须保留（否则本机现有工程直接空白）；
- 「不双写」可以保留；
- 「不支持降级读取」可以保留，但**必须自动备份**，否则降级一次就清空；
- 「无历史数据」这句话要从文档里删掉，改成「无已发布版本；工作区可能已有本分支产出的三字段工程，按读兼容处理」。否则后续评审会拿这句话否掉读兼容的必要性。

### 7.5 600 findings 的预测会不会误导？——**数字可能对，语义一定错**

t6 的预测是 200 error 保留、400 warning 消失（`promptCompatRisk.md:17`、`:107`）。从规则看成立：V11 的空声音字段 warning 被删（`schema:219-220`），200 镜 × 2 ＝ 400。但用户看到的是「警告从 600 降到 200」，会读成「工程变干净了」；实际是**两条检查被删除**，而它们检查的「声音段没写」在迁移后变成了「六段缺两段」——问题没解决，只是不再有检查。对有空内容的工程更危险：原本 warning 提醒补声音，迁移后静默通过。

**判定：** 必须出「规则增减对账表」，并在报告里把「消失的 400」标成「检查移除」而不是「问题修复」；同时保留一条**按 profile 开闸的提示级 V11**（「ref2va 六段缺声音段」），让迁移后仍有信号。t5 现在把 V11 收成一条空判定（`schema:216-220`），等于把这条信号也删了。

### 7.6 R-02：切换门槛的四个动作，设计是否可执行？——**预检写成了同义反复**

t5 的 B＋C 五步（`promptCompatRouter.md:258-266`）方向正确：切换对话框、受影响镜头数、不改存量、逐镜整理、预检。但第 3 步「比较工程声明模型与目标节点实际模型；不一致即停止」（`:264`，引 `directDispatch.ts:364-384`）在**新节点**路径上是空的：`configureNode` 本来就是把 `global.model` 写进节点（`:379-382`），比较「声明 vs 实际」在设置之前没有实际值，设置之后就必然相等。真正会不一致的是「**存量提示词的格式**」与「新模型」，而这没有字段可比较（单字段没有格式标记），只能靠段名启发式。

**改法：** 把「预检」改成「切换影响评估」：
1. 切换对话框显示「已有非空提示词的镜头数 N」；
2. 对这 N 条做只读段名扫描（H3 六段名、A9.2 九字段名、Wan 无段名），给出「疑似 H3 / 疑似 Seedance / 未知」三档计数；
3. 明确「不会自动改写；需逐镜整理或整批重写」；
4. 若用户确认，只写 `global.model`（现状 `multitrackEditor.vue:665-671` 已经是这样，缺的是前面的确认与计数）。
这才是可执行的门槛；「比较声明与节点配置」只适用于**已有节点**的单镜场景，应单独写。

### 7.7 R-04（rewriteShot）：t5 覆盖了，但顺序要并入同一提交

t5 §5.5 已把请求体改为单串、`refine` 改为 `prompt.trim().length > 0`（`schema:242-253`），并列入 §3.6（`:141`）。captain 说的「未列入落点」不准确：它在 §5.5 与 §6.1 的 R7 里。**真正的问题是顺序**：若 UI 已单框、`rewriteShot` 仍要求三字段，点「整理」必 400；t5 的实施顺序（`:274-279`）第 2 步包含 `rewriteShot`，但 `multitrackNode` 的 schema 与 `planValidator` 也在第 2/3 步之间，容易分提交。**要求：** `rewriteShot`、`multitrackNode` schema、`planOperator` schema、`planValidator` 四处**同一提交**，否则中间态必坏。

### 7.8 R-06（校验器静默漏检）：t5 的顺序自己在制造这个窗口

t5 的顺序是「先改读 → 再改 schema/编辑器/rewriteShot → 再改派工（同时 V7）→ 最后文档」（`schema:274-279`）。如果第 2 步先落盘单串、`planValidator` 仍按 `clip.prompt` 对象取字段（`planValidator.ts:203-207`），`prompt` 是字符串，`fields` 枚举取 `prompt[field]` 全 undefined → V7/V11 对整镜跳过，**静默漏检**。这与 R-06 完全一致，而且不是「万一」，是顺序必然。

**改法：** 把 `planValidator` 提到第 2 步，与 schema 同提交；并在 `readPrompt` 之外加一个「形状断言」：若 `prompt` 既不是 string 也不是含三键的对象，validate 直接报 error（「提示词形状非法」），避免任何形状被静默跳过。这条断言本身不绑定供应商。

### 7.9 R-11（DSH 技能包）：必须进实施清单，且优先级高于仓库技能

实测 `~/.dsh/skills/toonflow-mtrack` 的 9 个文件，三字段与硬首行是**主链路**（P-5 的证据）。t5 的 §7 只列仓库内文档；t6 的 R-11 只登记、不排期。**判定：** 这不是「技能包漂移」，是**运行时引导层未改**；如果只改仓库技能，MCP agent 的行为不会变。实施清单必须把它列为 P0，与代码同批；同时明确它的交付方式（DSH 技能包更新，不属于 git 仓库，需要单独打包/复制）。若本轮不准备动它，则必须在最终方案里写「本方案对 MCP agent 暂不生效，只对读仓库技能的路径生效」——不能默认它会同步。

---

## 8. 放行条件与拍板顺序

### 8.1 必须先拍板的 5 个决定

| # | 决定 | 选项 | 红队建议 | 不决定的后果 |
| --- | --- | --- | --- | --- |
| D1 | 路由键 | t3 的 providerId 优先 / t4 的 modelId 唯一 / t5 的二元组分工 | **t5 ＋ 能力栏**（§1.3） | tfRouter 的 H3 被套错外壳 |
| D2 | 单镜 H3 有参考的段落数 | 六段 / 三段 | **六段**（X-1） | 直连 H3 产出错格式 |
| D3 | 换算范围 | 本轮扩到五家 / 只 freevideo | **本轮只 freevideo，A 另立**（X-5） | 引导承诺代码没有的行为 |
| D4 | 三字段去留 | 单串迁移 / 保留三字段（M0） | **先让用户看成本差**（35 文件＋不可逆 vs 6–8 文件可逆） | 实施者按两份稿做出互斥结构 |
| D5 | 存量文本的格式归属 | 视为 H3、切模型即待重写 / 自动改写 / 不处理 | **视为 H3 ＋ 切换时提示 ＋ 首次备份**（P-1） | 迁移后切模型静默错格式 |

### 8.2 必须先修的 4 个 P0（与设计选择无关）

1. `initialize.ts` 的目录同步 ＋ `app.ts:72` 传 skills 哈希（R-01，§7.1）。
2. `prompt` 写入禁止展开 ＋ `clipEditor.vue:96-124` 落点（R-03，§7.2）。
3. `planOperator` 依赖 nodeShared、删除副本（R-08，§7.3）。
4. schema / `planValidator` / `rewriteShot` / 节点 schema 同一提交 ＋ 形状断言（R-06/R-04，§7.8）。

### 8.3 建议的拍板顺序（给用户）

1. **先定 D4（单串 vs M0）**——它决定后面所有工作量；若选 M0，本文件 §2/§3/§5 的大部分风险消失。
2. 再定 D1/D2（路由键、段落数）——它们决定格式卡怎么改，与 D4 无关。
3. 再定 D3/D5（换算范围、存量归属）——它们决定引导文案与切换流程。
4. 最后排 P0 四条的实施顺序；未修完之前，不建议把「多轨默认 freevideo」写进对外文案。

### 8.4 一句话总结

**三份设计把「格式内容」写清楚了，但还没有把「格式归谁管」写成一个可执行的决定。** 在 D1–D5 拍板、P0 四条修完之前，这套方案的净效果是：输入框变中立了，但 agent 仍按 H3 三字段写、校验器仍按 modelId 开闸、升级用户的技能目录仍拿不到新文件——「格式由供应商提供」只实现了存储层，没实现运行时。

---

## 附录：本文引用的关键锚点

| 锚点 | 用途 |
| --- | --- |
| `videoGenerationNode/src/index.vue:225-238` | 旧标记换算仅 freevideo；词根归一化对全部；文本参考追加 |
| `directDispatch.ts:97-114` | buildPrompt 的正文/前言/声音尾段/自动段首 |
| `directDispatch.ts:364-384` | configureNode 直接下发 global.model |
| `planValidator.ts:203-207`、`:219-222`、`:227-247` | V7 字段枚举、边界、旧标记与官方标记检查 |
| `mtrackProject.ts:126-133` | readPrompt 三个具名键（旧代码读新文件为空） |
| `mtrackEdit.ts:34-37` | prompt 对象展开（R-03 的现场） |
| `clipEditor.vue:96-124` | 每次按键的对象展开（R-03 的第二现场） |
| `multitrackNode/src/index.vue:336-340`、`:407-418` | 节点 schema；editProject 是 agent 写 prompt 的唯一入口 |
| `planOperator/src/index.ts:142`、`:191`、`:304-312` | mtrackUpdate 禁写 prompt（纯 MCP 的硬边界） |
| `planOperator/src/index.ts:391-396` | promptEssentials 仍三字段（P-4） |
| `initialize.ts:10`、`:21`、`:25-33`、`:42`；`app.ts:71-73` | 技能只同步一次的机制（R-01） |
| `metaso.ts:70`、`tfRouter.ts:170`、`apiMart.ts:191`、`compshare.ts:1762`、`freevideo.ts:216-220` | 五家 H3 与不同 mode（X-2） |
| `~/.dsh/skills/toonflow-mtrack/references/h3Format.md:13-22`、`:100-102`、`:117`；`mtrackContract.md:27`、`:41-43`、`:59-60`；`productionFlow.md:57`、`:63-65`；`troubleshooting.md:76` | DSH 三字段与硬首行（P-5） |

> 硬约束自查：全文未出现双花括号模板字面量（旧REF占位标记一律以文字指代）；未修改任何技能、业务代码或 DSH 技能包；未使用「旧版/历史/作废/已迁移」作为建议措辞（引用现文以指出违例处除外）。
