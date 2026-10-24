# 提示词兼容风险推演（t6）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 范围：以 t1–t5 的设计稿为前提（默认走 freevideo / MiniMax-H3、格式随 `global.model`、多轨提示词单字段化、`global.style` 默认空、媒体路由真源落 `canvas/references/videoProduction.md` §0.1），只推演「这样做会出什么问题」，不重开取舍讨论。
> 方式：只读代码与实跑断言，不改任何业务代码、技能文件与 DSH 技能包。全部结论带 `文件:行号`；凡标「实测」的行均为本轮真实执行过。
> 术语：文中「旧REF占位标记」指画布 mention chip 那套双花括号引用写法（本文件不出现其字面量）。

---

## 0. 结论摘要

| # | 风险 | 等级 |
| --- | --- | --- |
| R-01 | `data/skills` 缺 `assetCard` 整套，`workflow/SKILL.md` 的 6 处强制指针全部悬空——多轨硬隔离规则在本机运行时不可执行 | **blocker** |
| R-02 | 多轨切非 freevideo 的 B+C 门槛缺"派工预检"实现，`handleModelChange` 直接写 `global.model`，无拦截、无提示 | **blocker** |
| R-03 | 中间态：三字段对象与单串互相 spread，声音内容被拆成字符索引对象后静默丢弃（实测 40 键） | **blocker** |
| R-04 | `rewriteShot` 的 zod 三字段必填未同步——编辑器完成单字段化后「整理提示词」必 400 | high |
| R-05 | 校验器 V11 改口径后存量工程结论翻转：实测既有 600 条 findings（200 error + 400 warning）→ 预测 200 条（warning 全消失） | high |
| R-06 | 校验器未改而数据已单串时，V7 对标记的扫描整镜失效（fallback 取不到字段即跳过），越界标记漏检 | high |
| R-07 | `buildPrompt` 退化后两声音字段失去唯一拼回点：代码侧 8 文件 32 行、引导侧 12 处 + DSH 5 文件仍按三字段书写 | high |
| R-08 | 两份 `mtrackProject.ts` 同构不同名（`ClipPrompt` vs `MtrackClipPrompt`）、互不导入，编译器抓不住漏改 | high |
| R-09 | 引导层在非 freevideo 场景仍会写出 H3 六段：`workflow/SKILL.md:45` 的硬隔离是形态判据、不是供应商判据 | high |
| R-10 | 媒体路由真源放执行层参考（`videoProduction.md` §0.1）与 master「执行层只搬运」分层冲突，且现存同类悬空引用证明该层引用不受保护 | medium |
| R-11 | DSH 技能包 `toonflow-mtrack` 9 文件整体按三字段 + 默认 freevideo 书写，与 repo 双轨漂移 | high |
| R-12 | 同一规则多处重复：默认口径 14 处、六段表 3 处、硬隔离 2 处，改一处必漏 | medium |
| R-13 | `global.style` 默认空后，"正文首行 = subject_definitions" 与 wire 前缀拼接的顺序未验证（模型侧行为未知） | medium |
| R-14 | 非 freevideo 的 `<Picture N>` 原样下发（`videoGenerationNode/src/index.vue:228`）：供应商不认识，静默劣化 | medium |
| R-15 | 「分镜批量」触发词把新增请求改道多轨，老用户"做个视频"不再走画布直连 | medium |
| R-16 | 单字段化不可逆：无备份、无降级读取、`updatedAt` 冲突检测挡不住人为回退 | medium |
| R-17 | 200 镜存量工程转换后仍逐镜报「缺少提示词」，派工直接抛错，用户看到的失败面扩大 | low |
| R-18 | `promptProfile` 完整版需要动 `ProviderModel` 声明与 wire 换算，成本与灰度面被低估 | medium |

**Q7 证据复核结论：成立，不必报 blocker。** 见 §3。

---

## 1. 六个场景推演

每个场景给「现在会怎样」（当前 merge-v1 实际行为）与「设计后应该怎样」（按 t1–t5 设计的目标行为），并点名两者之间的断点。

### 场景 1：老用户工作区里有 master 时代的单节点 Seedance 工程，继续修改

**现在会怎样。** 画布直连链路完全不受影响：`videoGenerationNode/src/index.vue:228` 只在 `providerId === "freevideo"` 时才把旧REF占位标记换算成 `<Picture N>`，非 freevideo 保持原始文本；`:229-231` 的 `<Picture N>` 兜底归一化对全部供应商生效，但只有正文写了那套词根才触发。工程里 `data.model` 仍是 Seedance 时，提示词原样下发，行为与改动前一致。

但「继续修改」的第一步就可能被改道：`workflow/SKILL.md:21`、`canvas/SKILL.md:24` 与 `references/canvasExecution.md:3` 都把「分镜批量」列为多轨触发词——用户说「把第 3 镜重做一下，顺便这批都重做」，形态判定会命中多轨，于是产物口径从 A9.1/A9.2 切成 ref2va 六段（`workflow/SKILL.md:45`），而用户的工程里根本没有 `story.mtrack`。

**设计后应该怎样。** 形态判据应当只有「工作区存在 `.mtrack` 工程」这一条硬事实，动作动词不单独构成形态依据；无 `.mtrack` 时一律留在直连链路，用户在直连节点里点名 Seedance 就走 A9 外壳。

**断点。** 触发词判据（R-15）与「用户既有工程里没有 mtrack 文件」的事实不一致，属误伤而非有意改道。

### 场景 2：老用户新建项目，说「帮我做个视频」，没指定模型

**现在会怎样。** 三条链都已被改成默认 freevideo / MiniMax-H3（`canvas/SKILL.md:107`、`references/videoProduction.md:45`、`workflow/SKILL.md:45`/`:804`），而 master 原路径是「未指定模型时锁存 Seedance 路由并问 2.0 还是 2.5」（`workflow/SKILL.md` PART A 段首，t1 已定位）。因此现在这条请求会直接落到 H3 六段 + `<Picture N>`，跳过「问 2.0 还是 2.5」。

用户可感知的差异是：拿到的提示词从三段式（素材定义 + 顺序镜头 + 风格约束）变成六段（`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`），字数翻倍且中英混排（后两段内容为中文、正文英文，见 `multitrackTemplate.md:88`）。

**设计后应该怎样。** 默认值只回答"没人点名时用谁"，不回答"怎么写"；写成条件句后，用户点名 Seedance 的同一句话应能得到 A9 外壳，形态（画布直连 / 多轨）只决定"写进哪个字段"（t4 §共存原则）。默认可换、判定动作不能省。

**断点。** 现在缺一句可执行的判定句（t5 建议放 `videoProduction.md` §0.1），于是"默认 freevideo"实际上被读成了"只有 freevideo"。

### 场景 3：新用户在多轨里做分镜批量，默认 freevideo

**现在会怎样。** 基本可用，但有两处摩擦：

1. `global.model` 在本机存量工程里是 `undefined`（实测 `南柯一梦/plan/story.mtrack` 的 `global` 只有 `{ ratio: "16:9" }`），派工时 `directDispatch.ts:379-382` 只有在 `videoModel?.providerId && modelId` 都非空时才下发，于是"默认 freevideo"靠的是节点自身的选中模型，不是工程声明——节点上的模型被换过，全片就静默换供应商。
2. 六段写进去以后，`multitrackTemplate.md:163` 要求"首行必须是 `subject_definitions:`"，而 `buildPrompt`（`directDispatch.ts:105-106`）会把「全片风格 / 全片约束」前缀拼在正文**之前**——只要用户填了 `global.style`，正文首行就不再是 `subject_definitions`。t5 已把这条改成"正文首行"，但这一改动同时放宽了模型侧的唯一结构锚点（见 R-13）。

**设计后应该怎样。** 默认组合显式写进 `global.model`（`multitrackTemplate.md` 的骨架），"首行"判定限定在正文（正文 = 去掉工程级前言之后的文本），且前言与六段的边界在派工前校验一次。

**断点。** 默认值靠节点而不是工程声明（R-02 的同一根因），以及首行判定与前言拼接互相矛盾（R-13）。

### 场景 4：用户在多轨里把模型改成非 freevideo（单字段化之后这是否变得可行）

**结论：数据层可行，传输层不可行——单字段化解决的是"写在哪个字段"，不解决"谁来换算标记"。**

**现在会怎样。** UI 的模型下拉是开的：`multitrackEditor.vue:695-709` 从画布视频节点的 `node:getConfig` 取 `models` 列表（供应商不限 freevideo），`handleModelChange`（`:665-671`）校验非空后直接 `onGlobalPatch({ model })`，**没有对话框、没有受影响镜头数、没有派工预检**。派工时 `configureNode`（`directDispatch.ts:364-384`）照单下发 `providerId`/`modelId`。而 wire 层只有 freevideo 才换算标记（`videoGenerationNode/src/index.vue:228`），非 freevideo 的 `<Picture N>` 原样进入请求体——供应商不认识这套标签，同时 `workflow/SKILL.md:45` 又明令禁止写 A9.1/A9.2 字段，正确格式被规则挡在门外（t2 断点 2）。

**设计后应该怎样。** 按 captain 的 B+C：切模型时弹对话框显示"本工程 N 镜受影响"，只改 `global.model` 不动 `clips`，派工前做「声明 vs 节点实际」不一致即停的预检，整理稿逐镜重写。

**断点。** B+C 的四个动作里，代码侧只有第 2 个（只改 `global.model`）是现成的（`multitrackEditor.vue:670`）；第 1、3 两个没有任何实现，第 4 个依赖 `rewriteShot` 与单字段化同步（R-04）。所以设计后的第一步不是"用户体验改善"，而是把三处缺失补齐，否则 B+C 只是文档承诺。

### 场景 5：用户用 Seedream 做资产图

**现在会怎样。** `assetCard` 的图片规范本身就写明"只有内容要素清单、没有格式"（t3 结论），任何图片模型都能吃。但引导层同时把图片默认成 freevideo（`canvas/SKILL.md` 图片默认段、`assetCard/references/imagePrompt.md`），而 master 的画布口径是"图片未指定模型时优先 gpt-image"（t4 的 NF-1）——换默认时把"按实际可用能力选择"的兜底判定一起删了。于是用户在只有 gpt-image 的环境里会被引导去点 freevideo。

另外 v118 的图片模板被降级为"点名 Seedream/Nanobanana 时的模型卡"（captain Q3），但 `imagePrompt.md:21,296` 仍把这几个模板描述为不适用于现在的资产卡写法（t4 NF-2 定位），两处口径相反。

**设计后应该怎样。** 图片默认走"按实际可用能力优先"，用户点名 Seedream 时按其格式卡（中文段落 +【画面】/【风格与一致性】）书写，v118 模板作为"点名即用"的模型卡存在，措辞全部改条件句。

**断点。** 默认口径与模型卡准入条件不一致（R-12 的重复描述问题在图片侧的投影）。

### 场景 6：用户已有的 `story.mtrack` 里提示词是旧参考标记写法与三字段结构，重新生成

**现在会怎样（实测）。** 实跑 `packages/tools/planOperator/src/planValidator.ts` 对 `C:\workspace\film-maker\video-creator\南柯一梦\plan\story.mtrack`（200 镜、全部 `pending`）配合同目录 `assetIndex.json`：

```
A 现行(带资产卡) 总计: 600 {"V11:error":200,"V11:warning":400}
```

即每镜 1 条 error（`prompt.integratedMultimodalDescription` 为空）+ 2 条 warning（两声音字段为空），其余规则（V7/V8/V13）零 findings。

警告的是：**这台机器上的存量工程三个字段全是空字符串**（实测三字段长度均为 0），所以"旧写法"在这台机器上没有真实内容——真正的风险在别的机器上有内容的工程，以及转换动作本身（R-03）。

派工侧：`dispatchClips`（`directDispatch.ts:407-463`）对每个空提示词镜直接 `throw new Error("该镜没有提示词，请先补全画面描述")`，200 镜会在第 1 镜停下——这个行为在转换前后完全一致，属既有约束而非新增风险（R-17）。

**设计后应该怎样。** 单字段化后同一工程的结论应为：200 条 error 保留（提示词仍为空），400 条 warning 消失（没有独立声音字段了）；派工报错文案改为指向单字段。

**断点。** 校验结论的"翻转"虽在预期内，但用户侧看到的是"警告突然消失"，会被读成"工程质量变好了"（R-05）。

---

## 2. 风险清单

格式：位置 / 机制 / 触发条件 / 等级 / 缓解建议。等级含义：blocker = 上线即坏或不可逆；high = 特定人群必坏；medium = 条件性劣化；low = 体验摩擦。

### R-01 `data/skills` 缺 `assetCard`，workflow 强制指针全悬空

- **位置**：`apps/server/src/utils/plugins/initialize.ts:10`、`:26`；`apps/server/src/app.ts:72`；`packages/skills/workflow/SKILL.md:31,43,45,74,1379,1399`；`packages/skills/workflow/references/canvasExecution.md:3`、`stateAndDelivery.md:59`。
- **机制**：运行时全局技能目录是 `resolve(dirname(conf.path), "skills")`（`apps/server/src/utils/skills/files.ts:12`）= `data/skills`。启动时 `initializePlugins` 用 `data/skills/initialized` 做标记，标记存在且未传 `revision`（`app.ts:72` 未传）就 `return`（`initialize.ts:10`）；即使执行，`cp(..., { force: false })`（`:26`）也不覆盖已存在文件。实测：`data/skills` 只有 `canvas`、`v118workflow`、`workflow` 三个目录 + `initialized` 标记，**没有 `assetCard`**（`Test-Path data\skills\assetCard` → False）；三个已存在目录与工作树逐文件 SHA256 全等（说明内容同步过，但不是启动流程保证的），而 `assetCard` 的 7 个文件一个都没进去。
- **触发条件**：任何一次以运行时技能目录为准的读取——即 agent 按 `workflow/SKILL.md:45` 去读 `../assetCard/references/generationRunbook.md §四`。
- **影响面**：所有多轨任务。命中最重：`workflow/SKILL.md:45` 是"多轨产物格式硬隔离（强制）"，它把格式真源指给一个读不到的文件；agent 只能退回 PART A 或凭记忆写，于是**非 freevideo 场景写出 H3 六段、freevideo 场景写出 A9 字段都会发生**——正是任务书问的第一件事。
- **等级**：blocker（规则不可执行，且没有任何报错提示）。
- **缓解建议**：①上线前把"新技能目录是否已进入 `data/skills`"列为一等验收项，用文件存在性断言，不用"我改好了"；②`initialize.ts` 的处理方式二选一：给 `initializePlugins` 传 `revision`（走 `:29-39` 的覆盖分支），或在文档里明确"新增技能目录必须由安装器/手工同步"；③引导层不要在强制规则里用相对路径当唯一入口，至少同时给出"若该文件不可读，则按主 `SKILL.md` 内联的最小六段骨架执行"的降级句（与 master `canvas/SKILL.md` 现有的降级写法同构）。

> 备注：这同时是 Q4 的一个支持性证据——真源放 `canvas/references/videoProduction.md` 时**恰好落在可见目录**（`data/skills/canvas` 存在），放 `assetCard/references/generationRunbook.md` 则在本机不可见。见 R-10。

### R-02 多轨切非 freevideo 缺预检，声明即生效

- **位置**：`packages/nodeShared/src/mtrack/multitrackEditor.vue:665-671`（无对话框）、`:695-709`（模型清单不限供应商）；`packages/nodeShared/src/mtrack/directDispatch.ts:364-384`（只下发不相较）、`:379-382`。
- **机制**：`handleModelChange` 只做"非空 + 与现值不同"两项检查后写 `global.model`；派工 `configureNode` 直接 `node:setConfig` 下发 `providerId`/`modelId`，代码里没有任何"工程声明 vs 节点当前实际"的比对。
- **触发条件**：用户在多轨高级设置里把模型换成任一非 freevideo 供应商（下拉来自画布节点 `node:getConfig`，非 freevideo 也在列表里）。
- **影响面**：该工程全部未生成镜头。产物仍是 H3 六段，`<Picture N>` 原样下发（`videoGenerationNode/src/index.vue:228`），供应商按自己的语法解释 → 参考图错位或整段被当普通文本；同时 `workflow/SKILL.md:45` 禁止改写成该供应商格式，用户无法自救。
- **等级**：blocker（数据面：静默产生错误的生成费用与错误产物）。
- **缓解建议**：把 B+C 的第 1、3 两个动作当成交付的一部分而不是文档措辞——切换前弹影响面（受影响镜头数 = `clips.filter(c => c.status === "pending").length`）、派工前在 `beginDirectDispatch`（`directDispatch.ts:466-486`）开头加一次声明与节点的比对，不一致即停并把差异原文抛给用户。若这一轮不做代码，则**必须同时把 UI 下拉限制为 freevideo**（等于 A1），否则文档承诺与运行时行为相反。

### R-03 中间态：三字段对象与单串互相 spread，声音内容静默丢失

- **位置**：`packages/nodeShared/src/mtrack/components/clipEditor.vue:102,112,121`（`{ ...clip.prompt, … }`）、`:175-176`；`packages/nodeShared/src/mtrack/mtrackEdit.ts:34-37`（`prompt: { ...clip.prompt, ...(patch.prompt ?? {}) }`）；`packages/nodeShared/src/mtrack/mtrackProject.ts:129-131`（`readPrompt` 只取三个具名字段）；`multitrackEditor.vue:875`（`{ ...clip, prompt: { ...clip.prompt, integratedMultimodalDescription: value } }`）。
- **机制**：`{ ...某字符串 }` 会把字符串展开成字符索引对象。实测：对一个 40 字的单串执行 `{ ...(str), integratedMultimodalDescription: "仅改画面" }` → 得到 **40 个数字键**的对象，再无 `overallSoundscape`/`nonDiegeticMusic`。该对象落盘后，`normalizeProject`/`readPrompt`（`mtrackProject.ts:129-131`）只读三个具名字段，数字键被整体丢弃 → 单串里原本承载的声音内容**不可逆消失**，UI 上表现为"两声音框空、画面框有新文本"，不报错。
- **触发条件**：写入侧已单串（类型/落盘改了）而读改侧仍是 `{...clip.prompt}` 的任一中间态——最容易发生在"先改类型和 `readPrompt`、后改 `clipEditor` 与 `mtrackEdit`"的顺序里。
- **影响面**：所有在中间态窗口内被编辑过的镜头；批量整理（`:875`）一次可以覆盖整批。
- **等级**：blocker（内容丢失且无提示）。
- **缓解建议**：①t5 的顺序必须补一步前置：`mtrackEdit.mergePatch` 与 `clipEditor` 的三个 `onPatch` 先改成"按字段显式取"，禁止对象展开；②写入路径上加一条运行期守卫——`typeof prompt === "string"` 时禁止任何 `{ ...prompt }` 形态的合并（在 `mtrackEdit.ts` 一处拦即可，它是唯一的合并入口）；③转换脚本先全量备份 `story.mtrack`（见 R-16）。

### R-04 `rewriteShot` 的 zod 三字段必填未同步

- **位置**：`apps/server/src/routes/mtrack/rewriteShot.ts:10-13`（`promptSchema` 三字段 `z.string()` 必填）、`:23`（`refine` 要求三段至少一段非空）、`:74-78`（分别拼「画面描述/声音景观/非剧情音乐」）。
- **机制**：前端 `multitrackEditor.vue:840` 组 `RewriteBasis` 时只取画面正文；请求体一旦随单字段化变成单串或单字段，服务端 zod 直接拒绝。
- **触发条件**：编辑器单字段化上线后，用户点「整理本镜提示词」。
- **影响面**：全部多轨工程；按钮 100% 失败，错误信息是 zod 原文而非产品文案。
- **等级**：high。
- **缓解建议**：把 `rewriteShot` 与你 `nodes/multitrackNode/src/index.vue:337-339` 的 zod 一并列入单字段化的同一批改动，并在 `promptCompatRouter.md` 的落点清单里补这一处（t5 §6 现列 R1–R10，未含 `rewriteShot.ts`）。

### R-05 校验器 V11 口径变化的结论翻转

- **位置**：`packages/tools/planOperator/src/planValidator.ts:50`（`prompt` 三字段类型）、`:151-153`（V11：一 error + 两 warning）、`:203-207`（V7 的字段兜底）、`packages/tools/planOperator/readme.md:74`（V7 规则原文）。
- **机制**：V11 逐字段判空；三字段合成单字段后，"缺 two 声音字段"的判据不复存在。
- **触发条件**：`planOperator` `validate` 工具或 UI 校验对任一存量工程跑一次。
- **影响面（实测量化）**：`南柯一梦/plan/story.mtrack`（200 镜）当前 600 条 findings = 200 error + 400 warning。单字段化后预测：200 error 保留（提示词仍为空）、400 warning 消失 → **总 findings 数下降 67%**。对"警告数=工程质量"的既有读法，这是误读风险；对 CI/报告类消费方，是口径突变。
- **等级**：high（不改 bug，但会让"问题消失"的假象进入决策）。
- **缓解建议**：改 V11 时同步改 `readme.md:74` 的规则表与 `V11` 描述；在报告里把"三字段非空"的旧口径写成"正文非空 + 声音可空（N/A 合法）"三条独立判据，不要用一条判据吃掉两条；转换前后各跑一次校验并留档对比。

### R-06 校验器未改而数据已单串时 V7 静默失效

- **位置**：`planValidator.ts:203-207`。
- **机制**：V7 取 `const prompt = clip.prompt ?? { …三字段空 }`，随后逐字段 `?? ""` 扫描标记。若 `clip.prompt` 是字符串，`prompt.integratedMultimodalDescription` 为 `undefined` → `?? ""` → 三行全是空串 → **该镜完全不被 V7 扫描**，不报错也不报 warning。
- **触发条件**：转换先落盘、校验器后改（或其他客户端读到新形态工程）。
- **影响面**：`<Picture N>` 越界、旧REF占位标记残留全部漏检，且是静默的。
- **等级**：high。
- **缓解建议**：V7 入口先做类型判定：`typeof clip.prompt !== "object"` 时抛一条显式 error（"提示词结构不是预期形态"），再谈规则；这条守卫应当在类型改造的同一次提交里进。

### R-07 `buildPrompt` 退化后两声音字段失去唯一拼回点

- **位置**：`packages/nodeShared/src/mtrack/directDispatch.ts:97-114`（`:107-108` 读两字段，`:109-112` 拼 `overall_soundscape:` / `non_diegetic_music:` 尾段，`:113` 合并）。
- **机制**：`buildPrompt` 是**唯一**把两个独立字段拼成六段尾段的地方。退化后它只拼前言、正文透传——两字段的内容若不先合进正文，就没有任何路径进入请求体。
- **影响面量化（本轮 grep 实测）**：
  - 代码侧 **8 文件 32 行**：`mtrackProject.ts:12,13,130,131,199,216`、`directDispatch.ts:107,108`、`clipEditor.vue:111,112,120,121,219`、`nodes/multitrackNode/src/index.vue:338,339`、`apps/server/src/routes/mtrack/rewriteShot.ts:12,13,23,77,78`、`planValidator.ts:152,153,206,207`、`tools/planOperator/src/mtrackProject.ts:12,13,71,72`、`tools/planOperator/src/index.ts:26,27,393,394`。
  - 引导侧 **12 处**：`workflow/SKILL.md:45`、`canvas/SKILL.md:107`、`videoProduction.md:45`、`multitrackTemplate.md:42,43,88-90,152,160,161,170,171`、`generationRunbook.md:108,514,596`、`assetCard/SKILL.md:85`、`nodes/multitrackNode/readme.md:18`、`packages/mcp/skills/toonflow/SKILL.md:71`。
  - DSH 技能 **5 文件**：见 R-11。
  - 行为面三处最痛：派工（`:107-108`，内容不进请求体）、整理（`rewriteShot.ts:77-78`，声音不再是上下文，整理稿可能顺手删掉声音描述）、UI（`clipEditor.vue:111-121`，两个输入框消失，用户无处写）。
- **触发条件**：先改 `buildPrompt` 与类型、后改写入侧（即"先退化派工"在某批镜头之前完成）。
- **等级**：high。当前这台机器的存量工程两字段长度为 0，所以"内容丢失"此刻为 0；风险全在"有人按六段写了声音内容、而退化先一步上线"的窗口里。
- **缓解建议**：退化前先加一步"合成"——读盘时若发现两字段有内容且正文没有对应段首，就把两段以 `overall_soundscape:` / `non_diegetic_music:` 段首合进正文再返回（读兼容只有十几行，与"不做降级读取"不冲突：这不是保留双写，是转换的一次性入口）；同时把 `rewriteShot` 的上下文改为整段单串，避免整理时丢声音。

### R-08 两份 `mtrackProject.ts` 同构不同名，编译器抓不住

- **位置**：`packages/nodeShared/src/mtrack/mtrackProject.ts:11-13`（`ClipPrompt` 三字段）与 `packages/tools/planOperator/src/mtrackProject.ts:11-13`（`MtrackClipPrompt` 三字段）；`packages/nodeShared/src/mtrack/mtrackProject.ts:129-131` 与 `tools/planOperator/src/mtrackProject.ts:70-72` 各有一份 `readPrompt`。
- **机制（实测）**：两份不是副本而是同构实现——233 行 vs 156 行，导出名不同（`ClipPrompt`/`MtrackClipPrompt`、`ClipAttempt`/`MtrackClipAttempt`），API 也不同（nodeShared 有 `createClip`/`nextClipId`/`hasPrompt`；planOperator 有 `clipIdPattern`/`sliceClips`/`clipNumber`）。`planOperator` 全包**不引用** `@toonflow/node-shared`（grep 零命中），两侧互不约束。因此单字段化改一侧，TS 编译**不会**报错；表现为"编辑器正常、`planOperator` 工具读到空"或反之。
- **触发条件**：只改一侧的 prompt 类型与 `readPrompt`。
- **影响面**：agent 经 MCP 工具（`mtrackRead`/`validate`/`mtrackUpdate`）看到的工程与 UI 看到的工程不一致；`validate` 结论与 UI 校验不一致。
- **等级**：high。
- **缓解建议**：把"两处同构实现必须同批改"写进落点清单（t5 §6 需补 `tools/planOperator/src/mtrackProject.ts`）；更彻底的做法是让 `planOperator` 依赖 `@toonflow/node-shared/mtrack/mtrackProject` 的类型（`package.json:17` 已导出该子路径），把类型的真源收敛为一处——哪怕只收敛 `ClipPrompt` 类型，也能让编译期抓住漏改。

### R-09 引导层在非 freevideo 场景仍会写出 H3 六段

- **位置**：`packages/skills/workflow/SKILL.md:45`；`canvas/SKILL.md:107`；`videoProduction.md:45`；`multitrackTemplate.md:152-171`；`assetCard/references/imagePrompt.md:21,296`。
- **机制**：三处强制句的判据都是**形态**（"命中多轨形态后"），不是**供应商**。"多轨 + 用户点名 Seedance"这个组合被显式写成"外壳仍是 ref2va 六段，不得改用 A9.1/A9.2"，而 wire 层并不做非 freevideo 的标记换算（`videoGenerationNode/src/index.vue:228`）。
- **触发条件**：多轨工程里用户点名非 freevideo 供应商（或先切模型再让 agent 整理提示词）。
- **影响面**：所有非 freevideo 的多轨镜头。成因有两层：规则本身按形态定格式（设计层），assetCard 规则不可读（R-01，可得性层）。
- **等级**：high。
- **缓解建议**：把 `:45` 的判据从"形态"改成二元组条件句——多轨 × freevideo（或 H3 系列）→ ref2va 六段；多轨 × 点名其他供应商 → 该供应商格式卡 + 标记按该供应商规则；两者共用同一句"形态只决定写进哪个字段"。同时删掉"点名也要写六段"这一条（它与 R-02 的冲突同源）。

### R-10 Q4 真源错位：把媒体路由真源放执行层参考

- **位置（拟新增）**：`packages/skills/canvas/references/videoProduction.md` §0.1；**现有引用密度**：`canvas/SKILL.md:22,106,128`、`workflow/SKILL.md:804`、`assetCard/references/imagePrompt.md:22`。
- **机制与冲突点**：
  1. **分层语义**：master 的结构是"路由先于执行、执行层只搬运"，且 `workflow/SKILL.md:74` 明确写"执行层只能搬运已定稿 prompt……不得重新改写"，`canvas/SKILL.md:107` 也把"引擎只补前缀、不代写段"当成执行层边界。把"默认用哪个供应商/模型"这个**路由决策**放进执行层参考，等于让被搬运方决定搬运目标——与 `:74` 的自我约束相反。
  2. **依赖方向（实测）**：现存跨技能边只有 `workflow → assetCard`（`:31,43,45,74,1379,1399`）、`workflow → canvas`（`:804`）、`assetCard → canvas`（`imagePrompt.md:22`）、`assetCard → v118workflow`（同处）。`canvas` 目前没有被它反向引用的出边，所以真源放 `canvas` **不会**造出环——这是支持 captain 决策的一条反证；真正的环只会在"canvas 为了写清默认而引用 workflow 的 PART A 判定"时出现，必须禁止。
  3. **该层的引用已经不受保护（实测）**：`canvas/SKILL.md:26` 引用的 `../script/references/assetGuide.md`、`../script/references/productionGuide.md` 两个路径**在 master 与当前工作树都不存在**（实测 `git ls-tree master -- packages/skills` 的技能目录只有 `canvas`/`v118workflow`/`workflow` 三个；工作树多出 `assetCard`，同样没有 `script`；`data/skills` 侧也没有）。把真源放进一个"已有悬空引用先例"的位置，会让新真源的失效概率与这些悬空引用同类。
  4. **可得性**：见 R-01——`data/skills/canvas` 存在、`data/skills/assetCard` 不存在，所以真源放 `canvas` 反而**更可能被读到**。
- **与备选（`assetCard/references/generationRunbook.md`）逐条对比**：

| 维度 | A. 放 `canvas/references/videoProduction.md` §0.1（captain 选定） | B. 放 `assetCard/references/generationRunbook.md` |
| --- | --- | --- |
| 分层语义 | 路由落在执行层，与 `workflow/SKILL.md:74` 冲突 | 路由落在创作/SOP 层，与分层一致 |
| 本机可得性（实测） | 可见（`data/skills/canvas` 存在） | **不可见**（`data/skills/assetCard` 不存在） |
| 现存同类悬空先例 | 有（`:26` 两处 `../script/…`） | 无（`imagePrompt.md:22` 的出边目标都存在） |
| 出边/入边 | 无人引用它之前已存在 4 处入边（含 workflow/assetCard），说明它事实上是叶节点 | 已有 6 处 workflow 入边，是当前格式真源 |
| 漂移面 | 「默认」与「六段格式」两套真源分居两技能，需一句话划界（t4 §共存原则可复用） | 默认与格式同处一文件，单文件自洽但会变成 800 行巨文件 |
| 失效后果 | 默认读不到 → agent 退回"默认为空"，会先问用户（可接受） | 格式读不到 → 硬隔离规则不可执行（当前 R-01 就是这个） |

- **等级**：medium（结构性问题，短期不炸，长期是漂移源）。
- **缓解建议**：①真源写**判定句**而非**默认值**（"用户未点名时，按当前画布视频节点的实际选中模型执行；节点未选中时为 freevideo / MiniMax-H3"），这样执行层只是在陈述它本来就要读的事实，不承担路由决策；②在 `videoProduction.md` §0.1 顶部加一句"本节是媒体路由的唯一真源，格式由各供应商格式卡回答"；③其余 13 处改成指针时，必须同时删掉中文摘要（只留链接），否则重复描述继续漂移（R-12）；④在同一次改动里顺手把 `:26` 两处悬空引用改成可达路径或加降级句——它现在就在证明这一层不受保护。

### R-11 DSH 技能包 `toonflow-mtrack` 与 repo 双轨漂移

- **位置（实测，`C:\Users\jason\.dsh\skills\toonflow-mtrack\`，9 文件）**：`SKILL.md:48`（首行必须 `subject_definitions:`）；`references/h3Format.md:13-18`（六段→字段映射表）、`:20`（"前四段连写、后两段各自单独存字段"）、`:22`（漏段首兜底行为）、`:90-92`（三字段 JSON 样例）；`references/mtrackContract.md:26-27`（`global.model` 默认 freevideo + `global.style` 不是六段一部分）、`:41-43`、`:59-60`（字段表）；`references/productionFlow.md:25,57,63-65`；`references/troubleshooting.md:76`。
- **机制**：该技能是**用户级 DSH 技能**，不在仓库版本控制内（`.dsh` 目录），也不经过 `initializePlugins`；它的 9 个文件全部按三字段 + 默认 freevideo 书写，且把"首行必须 `subject_definitions:`"写成硬要求（与 t5 的"正文首行"改动直接相反）。
- **触发条件**：任何由 DSH agent（而非 Toonflow 内置 agent）驱动的多轨任务——这正是当前会话里大量任务的实际执行者。
- **影响面**：两套口径同时生效时，产物字段形态取决于哪个 agent 在干活；单字段化后 DSH 侧仍写三字段 → `readPrompt` 取不到 → 提示词为空 → 派工抛错（与 R-17 同一失败面，但成因是引导）。
- **等级**：high。
- **缓解建议**：把该技能列入"同批更新清单"并在方案文档里点名（任务书要求"不改 DSH 技能包"，所以本轮只登记）；若不能同批更新，则推导侧（`readPrompt`）必须保留"读到三字段也能合成单串"的入口（同 R-07 缓解）。

### R-12 同一规则多处重复描述

- **位置**：默认口径 14 处（t5 §4 已盘点，本文件不重复列举，仅补两处图片侧：`canvas/SKILL.md` 图片默认段、`assetCard/references/imagePrompt.md:21`）；六段表 3 处（`videoProduction.md:45`、`multitrackTemplate.md:152-171`、DSH `h3Format.md:13-18`）；硬隔离 2 处（`workflow/SKILL.md:45` 与 `:31`）；"首行必须 `subject_definitions`"3 处（`multitrackTemplate.md:163`、DSH `SKILL.md:48`、`h3Format.md:22`）。
- **机制**：同一事实被写成完整段落而非指针；改一处时其余处继续以肯定语气存在。
- **触发条件**：任何一次口径调整（本轮已发生：默认模型、首行判定、风格必填）。
- **影响面**：引导层自相矛盾 → agent 择一执行，择的是哪一处不可控。
- **等级**：medium（但它是其余风险的放大器）。
- **缓解建议**：一处写全、其余只写指针 + 该条的一句话判据；用 grep 验收（t5 §6 已给），验收对象必须包含 DSH 的 9 个文件，否则"单一真源"只在 repo 内成立。

### R-13 `global.style` 默认空后"正文首行"与 wire 前缀的顺序

- **位置**：`directDispatch.ts:104-106`（`first = constraint ? constraint + "\n" + body : body`）；`multitrackTemplate.md:163`；DSH `mtrackContract.md:27`。
- **机制**：前缀拼在正文之前，因此"首行"是前言不是正文。t5 把硬要求改成"正文首行"是对的，但模型侧看到的第一行仍然不是 `subject_definitions`——引擎的"首行"锚点与新口径不同名。
- **触发条件**：`global.style` 或 `global.systemPrompt` 非空时派工（模板示例里 `style` 是必填，`multitrackTemplate.md:72`，captain 已决定取消必填）。
- **影响面**：依赖"首行锚定"的判断（模型理解、V7 的段首校验、用户自查）三处口径不一。
- **等级**：medium（模型侧行为未验证，不能假定安全）。
- **缓解建议**：取消 `style` 必填（已定）后，把前缀拼接改成"仅当正文已含 `subject_definitions:` 段首时才拼前言"，否则把前言追加到末尾或丢弃并记一条 warning——即让"段落结构优先于风格前言"成为代码里的显式规则，而不是文档里的约定。

### R-14 非 freevideo 的 `<Picture N>` 原样下发

- **位置**：`packages/nodes/videoGenerationNode/src/index.vue:228`（仅 freevideo 换算）、`:229-231`（词根归一化走全供应商）、`:232-237`（文本参考以「参考 N：」追加）。
- **机制**：多轨产物在引导层被强制写成 `<Picture N>`，而换算只对 freevideo 生效；`:232-237` 还会把 STRING 参考以「参考 N」形式追加到 prompt 尾部，对所有供应商生效，等于在别人的格式后面挂一段自己的语法。
- **触发条件**：多轨 + 非 freevideo（R-02 的同一人群）。
- **影响面**：生成结果静默劣化（参考错位、编号被当普通文本），无报错。
- **等级**：medium。
- **缓解建议**：短期在派工侧对"非 freevideo × 正文含 `<Picture N>`"记一条 warning 并在 UI 显示；长期按 R-02 的"外壳随供应商"处理；`:232-237` 的文本参考追加在非 freevideo 下应当关闭（它与 t3 的 D4 同源，但不属于本轮并入范围）。

### R-15 「分镜批量」触发词改道

- **位置**：`canvas/SKILL.md:24`、`workflow/SKILL.md:21`、`workflow/SKILL.md:1383`、`references/canvasExecution.md:3`。
- **机制**：把用户说话里的动词当成形态判据，于是"这批都重做"会命中多轨，即使工作区没有 `.mtrack`。
- **触发条件**：老用户在画布直连工程里使用"批量/分镜/批次"一类词。
- **影响面**：master 时代工程被改道到六段产物，且用户的原提示词是旧REF占位标记（非 freevideo 时不会被换算）。
- **等级**：medium。
- **缓解建议**：形态判据收敛为"存在 `.mtrack` 文件"这一条硬事实；动词只作为"提示用户可以在多轨里做"的建议，不作为改道依据。

### R-16 单字段化不可逆

- **位置**：`multitrackEditor.vue:564-582`（保存前只比 `updatedAt`）、`mtrackProject.ts:129-131`（无三字段读兼容）；无备份机制。
- **机制**：合并写入后原三字段结构不存在；`updatedAt` 冲突检测只能防并发覆盖，不能防"想退回去"。Q7 决定不保留降级读取，因此回退只能靠文件备份。
- **触发条件**：转换后发现格式问题需要回退。
- **影响面**：全部被转换过的工程。
- **等级**：medium。
- **缓解建议**：转换动作先 `cp story.mtrack story.mtrack.bak-<时间戳>`（用 `@toonflow/file` 的写入入口，遵守仓库文件规范），并在 runbook 里写明"转换前备份、转换后跑一次 `validate` 留档"；这两步比"保留降级读取"便宜得多。

### R-17 存量工程转换后仍逐镜报缺提示词

- **位置**：`directDispatch.ts:407-463`（空提示词即 `throw`）。
- **机制**：转换只改结构不改内容；空内容工程依旧每镜报错，报错文案指向"补全画面描述"。
- **触发条件**：存量空提示词工程。
- **影响面**：实测的 200 镜工程，第 1 镜即停。
- **等级**：low。
- **缓解建议**：单字段化时同步改报错文案（指向新字段），并在批次开始前预检"空提示词镜数"，一次告知，而不是逐镜停。

### R-18 `promptProfile` 两档实施路径的代价

- **完整版（改 `ProviderModel` 声明 + wire 换算改读它）**：触碰 `packages/nodes/videoGenerationNode/src/index.vue:212-238` 与模型声明结构，换来"换算规则可随供应商声明扩展"；代价是要覆盖 `MiniMax-H3` 的四个 provider 组合（freevideo / metaso / apiMart / compshare / tfRouter，t3 已核）。
- **轻量版（只写引导层）**：零代码风险，但 `:228` 的硬编码 continued 存在，非 freevideo 的标记换算永远不会发生（R-14 保留）。
- **等级**：medium。
- **缓解建议**：本轮取轻量版 + 把完整版写成一条带前置条件的待办（前置：非 freevideo 多轨被真实使用）；两档必须在同一文档里写清"轻量版的已知上限 = 非 freevideo 标记不换算"，避免下次又被读成"已支持"。

---

## 3. Q7 证据复核（blocker 级地基）

独立执行，未引用 t5 结论：

```
$ git cat-file -p master:packages/nodeShared/src/mtrack/mtrackProject.ts
fatal: path 'packages/nodeShared/src/mtrack/mtrackProject.ts' exists on disk, but not in 'master'   [exit 128]

$ git ls-tree master packages/nodeShared/
100644 blob 55ffa10…  packages/nodeShared/package.json
040000 tree 9a4616b…  packages/nodeShared/src
100644 blob 155a73c…  packages/nodeShared/tsconfig.json

$ git ls-tree -r --name-only master | Select-String mtrack      → ZERO matches
$ 对全部 28 个 tag（PAN、v1.0.0–v1.1.7 等）逐个 git ls-tree -r | Select-String mtrackProject
                                                               → ZERO mtrackProject across all 28 tags
```

**结论：Q7 地基成立。** `packages/nodeShared/src/mtrack/` 整个目录不在 `master`，也不在任何已发布 tag 中；三字段结构从未随发布触达用户，故"不保留三字段降级读取"不会伤害已发布产物。

**但这一结论有两个边界，必须同时写进决策记录，否则会被误用**：
1. 它只证明**没有已发布版本**含三字段；它**不能**证明"用户磁盘上没有三字段工程"——本轮实测的 `南柯一梦/plan/story.mtrack`（157 KB、200 镜）就是三字段结构，由 merge-v1 工作树直接产出。**结论的适用范围是"已发布版本的用户"，不是"当前工作区"。** 后者恰恰要求 R-03/R-07 的读兼容入口。
2. 它只覆盖 `packages/nodeShared/src/mtrack/`。`packages/tools/planOperator/src/mtrackProject.ts` 是另一份同构实现，也不在 master（同批新增），但这不改变结论。

---

## 4. 建议 captain 拍板的残余岔路

1. **R-01 的处置顺序**：先把 `assetCard` 同步进 `data/skills`（或给 `initializePlugins` 传 `revision`），还是先让 `workflow/SKILL.md:45` 自带降级句？两条都能止血，但前者需要动 server 代码，后者只动文档。
2. **R-02 的落地边界**：本轮只做"UI 下拉限制 + 派工前比对"两条，还是连对话框一起做？如果都不做，`workflow/SKILL.md:45` 的"点名也要写六段"必须同时删掉，否则规则与运行时相反。
3. **R-03/R-07 的读兼容**：与 Q7"不做降级读取"是否冲突？我的判断是不冲突——Q7 反对的是"长期双写/双读的兼容层"，我建议的是"转换的一次性入口 + 派工前的合成"两步，二者可以合并成同一段代码。
4. **文件命名**：任务书写 `docs/promptCompatRisks.md`，captain 指令写 `docs/promptCompatRisk.md`。本文件按 captain 指令落 `promptCompatRisk.md`；若需与任务书一致，改名即可（内容不依赖文件名）。
