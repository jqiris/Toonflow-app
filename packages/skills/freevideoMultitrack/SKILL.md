---
name: freevideoMultitrack
description: 把分镜稿与资产稿接成多轨工程、逐镜生成并合成成片的完整链路：先出分镜稿 + 资产稿（文本层，人物 C01/场景 SC01/道具 P01/声音 S01），再用画布上的「导入资产与分镜」节点（`remote-assetImportNode`，工具 `node:importScript`）导入剧本/分镜正文、抽取卡片与分镜、结构校对并可选批量出资产图，把资产图节点连到多轨节点的 in 端口，然后创建/绑定多轨工程 plan/story.mtrack，在多轨界面「参考素材」里只从连线上的资产卡打勾（勾选位次即官方 `<Picture N>` / `<Video N>` / `<Audio N>` 的编号基数），最后逐镜派工生成、人工验收并合成。用户要按我们自己的资产卡与分镜规范做多轨视频、要检查这条链路缺什么、要续接上一镜、要合成成片，或要写资产卡/分镜提示词时使用。
---

> **H3 口径声明**：本工作流视频生成仅支持 MiniMax-H3（H3 官方六段格式 + `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记）；不接受其他视频模型或旧格式占位符。

# FreeVideo 资产卡 → 多轨生成

本技能只用仓库里真实存在的字段与工具。所有字段名可在 `packages/nodeShared/src/mtrack/mtrackProject.ts`、`packages/tools/planOperator/src/index.ts` 核对；所有工具名可在 `packages/nodes/multitrackNode/src/index.vue`、`packages/skills/assetCard/references/generationRunbook.md` 核对。

## 0 边界

**导入入口是画布上的「导入资产与分镜」节点（`remote-assetImportNode`，工具 `node:importScript`），不是外部格式解析器。** 外部小说、剧本、别人的分镜表、旧项目的资产文档，先作为文本正文交给这个节点（选工作区文件 `path`，或直接给正文 `text`），由它抽取卡片与分镜、结构校对、可选批量出资产图，落成我们自己的两种数据——`plan/assetIndex.json` 的资产卡与 `plan/story.mtrack` 的 `clips`。仍然**不认「已有资产编号直接复用」「别人的卡直接投产」这类旁路**：编号与字段一律按本链路口径重出，`assets/assetCards.md` 仍是卡数据的可读原稿。

本链路的三个真源文件：

| 文件 | 内容 | 谁写 |
| --- | --- | --- |
| `assets/assetCards.md` | 资产卡（Markdown 数据行，C/SC/P/KF/S） | 本链路阶段门 2 写文件 |
| `plan/story.mtrack` | 多轨工程：`global` + `clips` | 默认由阶段门 3 的导入资产与分镜节点**独占写**（已存在即拒绝覆盖，`global` 的 `ratio`/`style`/`systemPrompt` 由导入参数写入）；已有工程要手改时用 `node:editProject`；生成状态用 `planOperator mtrackUpdate` 回写 |
| `plan/assetIndex.json` | 卡 id → 画布节点 `nodeId` 的索引（出图的卡才有 `nodeId`） | 默认由阶段门 3 的导入资产与分镜节点**独占写**（与工程一起，先索引后工程）；或阶段门 3 用 `planOperator build` 生成，不手写 |

## 1 硬约束（先记住这几条，能避免绝大部分空转）

1. **资产卡是 `assets/assetCards.md` 里的数据行，不是画布节点类型。** 画布上的图片生成节点只是执行载体，靠 `label` 精确等于卡 id 对齐；`planOperator build/assemble` 就是按 `id` 写 `label`。改掉 label 等于剪断参考线。
2. **`mode=image` 时 `referenceIds[0]` 必须是首帧卡，而且只放一张。** 这是当前实现的隐式约定（`mediaDispatch.ts` 单图链路下发 `startFrameOptional`），不是协议字段；不要去找 `startFramePath` 之类的东西。多图请用 `mode=ref`。
3. **换视频模型 = 改工程 `global.model`（`providerId` + `modelId`），不支持逐镜换模型。** `MtrackClip` 没有模型字段。
4. **参考位次就是 `referenceIds` 里同类型资产的位次**：作者直接写官方 `<Picture N>` / `<Video N>` / `<Audio N>`，每类独立从 1 起、位次取自该类型资产在 `referenceIds` 数组中的先后（同类型去重后按出现顺序）。例如 `referenceIds: ["C01(IMAGE)", "A01(AUDIO)", "C03(IMAGE)"]` 对应 `<Picture 1>` / `<Audio 1>` / `<Picture 2>`。**`referenceIds` 由多轨界面的「参考素材」从连线上打勾产生，agent 不预先写**：那个清单只列本节点 `in` 端口连线上的资产卡、每镜上限 4 张（`packages/nodeShared/src/mtrack/components/referencePicker.vue:33-41`、`:114`），勾选顺序决定位次（`:144`）。引擎下发不再换算、不再代写任何一段，正文里出现旧「双花括号 ref 占位符」会被 `composeClipRequest` 判 error。`node:setReferenceOrder` 只在手工接线、需要临时改位次时用，不是普遍前置。
5. **`continuity` 只有 `shot`（独立起拍/切镜）和 `context`（承接上一镜）**；首镜必须 `shot`；`context` 要求上一镜已成功生成且 `attempts` 里留有 `jobId`，本镜时长至少 10 秒、参考素材合计 ≤3（图片/视频/音频同口径，`mediaDispatch.ts` 的 `composeClipRequest` 在拼装续接请求时拦截，校验器侧同口径规则是 V16）。独立镜的参考上限有两个口径，别混：**校验器允许 9 张图**（V8，`planValidator.ts` 的 `MAX_IMAGE_REFERENCES`），而**多轨界面勾选到 4 就点不动**（`referencePicker.vue` 硬编码）；出资产图的图片参考另有 ≤4 的上限（`freevideo-image` 侧）。**什么时候该用 `context`、什么时候必须用 `shot`，见阶段门 5 的「衔接判定」，不要按场景编号机械决定。**
6. **`status=accepted` 只能由人在多轨界面点验收。** Agent 的写入路径只收 `pending/generating/generated/failed`，不要试图标 accepted 去凑合成条件。
7. **本技能不做采样、LoRA、种子、CFG 这类参数。** 要换的只有模型、画幅、分辨率、时长、音频开关这些工程字段。
8. **`generateAudio` 目前只做透传，freevideo 供应商不消费它。** 传 `true`/`false` 不会改变成片有没有声音；要人声、环境声、配乐，写进提示词的 `overallSoundscape` / `nonDiegeticMusic`，别指望这个开关。换到 apiMart / tfRouter / compshare 时它们**会**消费这个开关（下发为 `generate_audio`），所以别把它当无用字段随便填。

## 2 工具面（只有这些，别找别的）

`planOperator`（工具名 `planOperator`，9 个动作）：

| action | 用途 | 关键参数 |
| --- | --- | --- |
| `parse` | 把资产卡 Markdown 解析成卡数组，报语法/字段问题（`markdown` 必填，先读文件再传内容） | `markdown` |
| `resolve` | 结算三级参考接线，返回 `refs` / `refSource`（省略 `markdown` 时按 `assetCardsPath` 读盘） | `markdown` 或 `assetCardsPath` |
| `validate` | 只读校验 V1–V16（实际实现 V1/V2/V4/V7/V8/V9/V11–V16，V3/V5/V6/V10 未实现），返回 findings（error 清零才允许下一步） | `mtrackPath`、`snapshot` |
| `build` | 校验通过后写 `plan/assetIndex.json` + `plan/assetReport.json` | `assetCardsPath`、`mtrackPath`、`snapshot` |
| `mtrackRead` | 范围读工程（含端点），返回 `global` + `clips` + `missing` | `path`、`from`、`to` |
| `mtrackUpdate` | 只回写 `status`/`nodeId`/`assetPath`/`attempts` 四字段，带 `expectedUpdatedAt` CAS | `updates[]`（`attempts` 整数组替换） |
| `dispatch` | 只出逐镜派工清单，不执行生成 | 必填 `from` + `to` |
| `assemble` | 按 `assetIndex` 批量建资产节点、镜头节点与连线 | `from`/`to` 可省 |
| `composite` | 只取 accepted 段出合成清单 `plan/composite.json`，`execute=true` 才调 ffmpeg | `execute` |

多轨节点工具（`nodeTools` 调 `name`，都带 `nodeId`）：

| 工具 | 用途 |
| --- | --- |
| `node:bindProject` | `mode=open` 绑已有 `.mtrack`；`mode=new` 新建骨架（exclusive，绝不覆盖） |
| `node:getStatus` | 工程状态、脏标记、批次进度（`batchClipIds`）、冲突/错误原文 |
| `node:readClips` | 读片段范围，返回 `updatedAt`（CAS 基线）与 `conflict` |
| `node:editProject` | 批量编辑：`add`/`patch`/`duplicate`/`move`/`remove`/`setGlobal`，一次 1–100 条，整批原子 |
| `node:saveProject` | 强制落盘（与自动保存同一条 CAS 链） |
| `node:reloadProject` | 从磁盘重载，`discard=true` 丢弃未保存修改 |
| `node:dispatchGenerate` | 按 `clipIds` 或 `from`+`to` 派工，`includeFinished` 默认只派 pending/failed；立即返回 `{batchId, skipped}`，不等生成 |
| `node:cancelBatch` / `pauseBatch` / `resumeBatch` | 批次停手 / 暂停 / 继续 |
| `node:retryClip` / `node:rewritePrompt` / `node:refreshOutput` | 单镜重派 / 重写提示词 / 刷新产出 |
| `node:readReferenceMap` | **派工前必查**：每镜 `expectedRef` vs 画布实际位次、`missingCardIds`（真断点）、`unconnectedCardIds`（断线）、`orphanSources`（多连） |

「导入资产与分镜」节点（`remote-assetImportNode`）工具：

| 工具 | 用途 |
| --- | --- |
| `node:importScript` | 从剧本/分镜正文（`path` 指**工作区内的剧本文本**，或 `text` 直接给正文，二选一；别传 `assets/assetCards.md`，会把卡片当正文再抽一遍）抽取资产卡与分镜 → 结构校对 →（`generateImages: true` 时）逐张走媒体通道出资产图并新建图片节点 → **独占写** `plan/assetIndex.json` 与 `plan/story.mtrack`（先索引后工程，工程失败删索引）。可选 `model`（抽取用文本模型，取 `node:importModels` 的 `text` 清单，传 `JSON.stringify([providerId, modelId])`；需要抽正文时必传，清单外直接报错、不回落面板默认）、可选 `imageModel`（出资产图的图片模型，取 `image` 清单）、可选 `extraction`（**定稿直读**：`{ style, systemPrompt, assets[], shots[] }` 整批结构化结果——会话里已抽好/已写好的卡片与分镜走这条，节点一次模型都不调、纯校验落盘，`path`/`text`/`model` 全不需要）、`ratio`/`style`/`systemPrompt`（三个定调值，写进新工程 `global`）、`clips`（按 `clipId` 整段覆盖抽取出来的分镜：`{ clipId, prompt, seconds?, referenceIds?, continuity? }` 数组，原文已写好六段时用它原样落盘）。返回 `{ cards, shots, images, failed, warnings, indexPath, projectPath }`：`failed: [{ id, reason }]` 是出图失败的卡（单张失败不中断整条导入，失败卡在索引里 `nodeId` 为 `null`，补一张即可）；`warnings: string[]` 是没中断导入、但工程已不满足引擎口径的地方（图片参考超 9 只留前 9、参考未出图被移除、承接镜不足 10 秒等），要逐条核对。两个 plan 文件任一已存在即拒绝覆盖——占用探测在入口做，重跑立刻被拒、不会先烧模型；**Agent 侧单次调用上限是画布桥与宿主的 120 秒**（节点里 `timeoutMs: 30 * 60 * 1000` 只对面板按钮生效），整篇抽取 + 逐张出图多半撞顶，撞顶后图片节点与 `assets/<nodeId>/` 不回收——定稿走 `extraction` 是秒级落盘；已有工程改用 `node:bindProject(mode:"open")` |
| `node:importStatus` | 无参数，读本节点进度与上次结果：`{ running, extracting, aborted, phase, done, total, summary, error, failed[], warnings[], placedNodeIds[], savedSummary }`。`running`/`extracting` 区分「在出图」与「在抽取」，`done`/`total` 是出图张数进度，`warnings`/`placedNodeIds` 与返回汇总同源（取消或失败时 `placedNodeIds` 是本次已建的资产图节点，Agent 可用画布工具 `deleteNodes` 清理），`savedSummary` 来自节点 `data.summary`（随画布 JSON 落盘，重开工程也看得到）。长任务中途查进度、事后追失败卡都用它，别反复重跑导入 |

通用节点工具（不是多轨专属，也不是 nodeScaffold 直接提供：nodeScaffold 只管 `nodeTools` 注册表，`getReferenceOrder` / `setReferenceOrder` 由 `packages/nodeShared/src/useNodeReferences.ts` 的 `useNodeReferences` 注册，所以只出现在调用了它的节点上——audio / video / image / director3d / text / multitrack）：`node:getReferenceOrder` / `node:setReferenceOrder` 取/设某节点 in 端口的参考顺序，手工接线时用；`assemble` 与派工链内部也调它。

编辑器内部另有三个函数（不是 agent 工具，用来读懂报错）：`buildPromptText`（`packages/nodeShared/src/mtrack/mediaDispatch.ts`，按六段顺序拼装非空字段并注入首帧指令）、`composeClipRequest`（同一文件，组装生成请求，校验 `<Picture N>` / `<Video N>` / `<Audio N>` 越界并拒绝旧「双花括号 ref 占位符」）、`submitClipTask` / `waitClipTask` / `cancelClipTasks`（`packages/nodeShared/src/mtrack/mediaTask.ts`，提交与轮询 `/api/ai/media/generate`）。agent 侧等价入口是 `node:dispatchGenerate`。

## 3 阶段门

### 阶段 0 入场盘点（不写任何文件）

1. `skillOperator` 有就 `list` → `read freevideoMultitrack`，没有就直读本文；`available_skills` 里的位置才是运行位置，不要把 `packages/skills/...` 当安装路径。
2. 看工作区有没有 `plan/story.mtrack`、`assets/assetCards.md`、`plan/assetIndex.json`；有工程就 `node:bindProject(mode:"open")` 或 `planOperator mtrackRead` 读现状。注意 `plan/story.mtrack` 与 `plan/assetIndex.json` 也可能是上一轮由「导入资产与分镜」节点（`node:importScript`）产出的——它们已存在时不要重导（导入节点会拒绝覆盖），直接进核对与后续阶段门。
3. 产出：现状一句话 —— 已有什么、缺哪个阶段门。

**通过判据**：能明确说出「下一步进哪一门」。

### 阶段 1 定调：风格、画幅、时长区间

问最少的三件事（能沿用就别重复问）：

- 画幅：`9:16` / `16:9` / `1:1` / `4:3` / `3:4`
- 风格：一段可复用的风格词，写进 `global.style`，会前缀到**每一镜**提示词最前面。模板（按题材删改，别只写「电影感」）：`<画法/成像> + <材质与光线> + <色彩与影调> + <镜头质感与颗粒> + <统一排除项>`
- 单镜时长区间：建议 **4–15 秒**（超了拆镜，不加速不吞字）

**单镜时长怎么定**：先按自然口语把台词念一遍估时长，把语气停顿和**并行**动作算进去——能同时发生的动作不重复累加，必须先后发生的不重叠凑时长；台词过长时在**自然语意节点**拆成两镜，不加速、不吞字、不改台词标点；每镜预留约 0.5–1 秒收尾让动作或表情自然落定，这段不被台词占满。声明时长不一定精确落地（freevideo 实测会吸附到帧档：6s→6.583s、10s→10.125s），成片总长以实测为准。

写入有两个口，按当时有没有工程选：**还没有工程**（默认路径）——把这三个定调值作为 `ratio` / `style` / `systemPrompt` 参数交给阶段门 3 的 `node:importScript`，由它写进新建工程的 `global`，**不要为了写 `global` 先建一个空工程**；**已经有工程**——`node:editProject({ operations: [{ type: "setGlobal", ratio, style, systemPrompt, model? }] })`。

- `global.systemPrompt` 放全片硬约束（如「所有人物同一套服装」「不出现现代物件」「无字幕无水印」）。
- `model` 形如 `{ providerId, modelId }`，不确定就先不传，用画布节点上已配的视频模型。

**通过判据**：`ratio` / `style` / `systemPrompt` 三个值说定并经用户确认（工程已存在时 `global.ratio` / `global.style` 要有值）；单镜时长区间说定。

### 阶段 2 资产稿 + 分镜稿（一起出）

**与 LSC 一致：资产卡和分镜在同一个工作流里一起产出，不是分开的两步。** 先从小说/剧本里提取人物和场景，同时编排分镜，一次性交付两种数据：`assets/assetCards.md` 里的资产卡数据行，和分镜稿的 clips 内容（`plan/story.mtrack` 由阶段门 3 的导入资产与分镜节点落盘）。

#### 2a 先建原稿核对表

读完整个已提供的小说/剧本，再开始拆镜，建立以下可追踪清单：

- 台词清单：依出现顺序编号 D001、D002……；保存说话人、完整原句、原标点和原先后顺序。旁白、独白、画外音分别标记。
- 剧情清单：依原稿呈现顺序编号 E001、E002……；记录必须呈现的动作、因果、线索揭示、关系变化和结果。
- 已知设定：人物身份与性格、当前身体/情绪状态、场景、时间、站位、道具与前后状态。

**原稿是母版，定稿即基线**：

- 用户给的剧情、事实、台词及其标点**默认锁定**：新增只补必要的可见动作，不加人物、不加事件、不加对白；需要实质改编时先给可选择的修改建议，不要径自改写。
- **「定稿」= 锁定基线**：资产卡定稿后改卡编号或画幅、分镜定稿后改 `clipId` 或顺序，都等于换基线——受影响的参考接线与已生成镜头必须重新对账，不能默认旧产物还成立。
- 局部修改只同步**受影响**的动作、时间、引用与后续状态，**不覆盖无关的已验收镜头**。

#### 2b 同时产出资产卡和分镜

**资产卡**写入 `assets/assetCards.md`，**分镜**写入 `plan/story.mtrack`（正文定稿后交给阶段门 3 的 `node:importScript` 一次性落成这两个 plan 文件；已有工程要手改 clips 时才用 `node:editProject` 的 `add`）。两者在同一次交付里完成，互相参照：

资产卡骨架（写法以 `packages/skills/assetCard/references/assetCardTemplate.md` 为准）：

```
### C01 · 角色名
- 建议画幅：16:9（2K 四视图整版）
- 提示词：<四视图整版：① 半身像（正面、腰部以上）② 正面全身 ③ 90° 侧面全身 ④ 背面全身；四栏等分、同一张图；②③④ 共用全身比例尺、按脚底线对齐，① 按上半身放大、不按肩线对齐；再写外形/骨相/五官/发型/体型/服装/神态>
- 负面提示词：<不要的东西>

### SC01 · 场景名
- 建议画幅：16:9
- 提示词：<空镜、无人、空间结构与光线>
- 文本类：空镜，不出现人物

### S01 · 角色名/旁白（音色卡）
- 文本类：仅文字记录，不出图
- 提示词：<一句稳定音色描述：年龄感、音高、清亮/沙哑等质感、气息、语速>
```

**角色卡必须出成一张 16:9 + 2K 的四视图整版**，不是单张正面半身，也不是四张分开的图：四栏等分、同一张图；②③④ 共用全身比例尺、按脚底线对齐，① 按上半身放大、不按肩线对齐。

分镜每个镜头的最小完整形状：

```json
{
  "clipId": "S001",
  "title": "第一镜 · 谁在哪做什么",
  "seconds": 8,
  "ratio": "9:16",
  "resolution": "768P",
  "generateAudio": true,
  "mode": "ref",
  "referenceIds": ["C01", "SC01"],
  "continuity": "shot",
  "prompt": {
    "subjectDefinitions": "subject_definitions:\n<Subject 1> is the character in <Picture 1>, wearing <服装>...",
    "summary": "summary:\n[reference generation] <本镜画面与动作，一两句>",
    "retentionAnalysis": "retention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - <保留的外貌/服装/空间结构特征, match <Picture 1>>",
    "detailedDescription": "detailed_description:\n[Shot 1] <画面与动作：Subject 1 from <Picture 1> 是身份、Subject 2 from <Picture 2> 是空间> <d>[Chinese]台词原句</d>",
    "overallSoundscape": "overall_soundscape:\n<环境声与动作声>",
    "nonDiegeticMusic": "non_diegetic_music:\n<配乐，没有就留空>"
  }
}
```

规则：

- **卡类型由 id 前缀决定**（`C` 人物、`SC` 场景、`P` 道具、`KF` 构图卡、`S` 声音，只写文字不出图），不要写「卡类型」字段。id 规则 `^(C|SC|P|KF|S)\d{2,}(-[A-Z])?$`。
- 缺省画幅：人物 16:9（2K 四视图整版）、场景 16:9、道具 1:1、构图卡 9:16。
- **场景卡一定写无人空镜**；不要把人写进场景提示词。
- 参考行字段名按卡类型选，解析器只认这些键：人物卡 `身份参考`（或 `参考`）、场景卡 `空间参考`/`结构参考`、道具卡 `道具参考`；构图卡三类都收。括号里写用途，例：`身份参考：C01（同一张脸，换装）`、`空间参考：SC01（同一空间，换机位）`、`道具参考：P01（同一张桌子，用旧）`；多个目标用顿号。
- 只有用户明确要道具才出 `P` 卡；普通持物写进动作描述。
- **衍生卡基于基础卡**：原文/分镜出现同一角色状态变化（换装、变身、持续伤势）或同一道具状态变化（新变旧、受损）时，基于基础态卡建状态后缀衍生卡（`C01-A`、`P01-B`），参考行指向基卡（例 `身份参考：C01（同一张脸，换装）`、`道具参考：P01（同一张桌子，用旧）`）；衍生卡提示词逐字复用基卡锚点、只改声明的状态项，不重画一个新角色或新道具。单镜头内可表达的瞬时状态写进分镜格描述，不单独建卡。
- **从 assetCards.md 整理 extraction 直读时，refs 必须从 `planOperator resolve` 取**：卡片稿的关联写在 Markdown 参考字段（`身份参考`/`空间参考`/`道具参考`/`参考派生`）里，`node:importScript` 的契约只认 `refs` 数组——先 `planOperator({ action: "resolve", markdown })`（与校验器同一套三级结算+守卫，零写入），把每张卡的 `refs` 原样填进 `extraction.assets[].refs`，再传 `extraction` 落盘；不要凭散文猜关联，也不要让节点把定稿卡当正文重抽一遍。异号衍生（`P02` 引 `P01`）只有走这一步才有真实参考接线；漏了不报错，但衍生卡会退化成独立文生图（同前缀后缀卡 `C01-A→C01` 有自动回落兜底，异号衍生没有）。
- **同场景跨镜多角度**：先生成全景图，再截取对应角度的场景图作该镜参考，不逐角度独立重画。链路：基础场景卡节点 `node:createPanorama({ mode })` → `node:generateImage` → `node:capturePanorama({ count, layout })`；freevideo-image 下全景链路内部用 2:1 / 4:1（不在合法比例内），失败时降级 `node:generateMultiAngle` 预设机位或导演台导出关键帧。角度图逐字沿用基场景卡的空间锚点与光照时段，是本工程中间件、不入 assetCards.md，连线作对应镜头参考。
- `clipId` 形如 `S001`，递增；`seconds` 整数 2–60（建议 4–15）；`resolution` 只有 `768P` / `2K`。
- `referenceIds` 上限分三层，别混：**校验器 V8 拦图片 ≤9、音频 ≤1**（视频参考与图片同桶计数，V8 不校验视频）；**供应商 freevideo 单请求参考 ≤4**（`freevideo.ts` 的 `maxImageReferences = 4`，多轨界面「参考素材」勾选上限同源，勾到 4 就点不动）；**续接镜（`context`）合计 ≤3**（引擎 `continue_from` 限制，V16 + 派工组装双重拦）。「视频 ≤1」只是供应商模式声明（`videoReference:1`），不是校验器拦的；`mode` 取 `ref`（多图参考）/ `image`（单图首帧）/ `text`（纯文）；`continuity` 只有 `shot` / `context`。
- 台词写进 `<d>[Chinese]原句</d>`，演绎说明写在标签外；说话者用 `(S1)`/`(S2)` 并在跨镜保持一致。
- **音色卡（`S`）保证跨镜声音一致**：每个说话人各建一张 `S` 卡，**有旁白的也必须给旁白单独建一张**；卡正文写一句稳定音色描述，此后每一镜提示词里该说话人（含旁白）**逐字复用同一句**（软约束，辅助手段——文字不保证强一致，没有真实音频绑定时跨切镜音色仍可能飘，如实告知）。同一角色跨阶段年龄或明确状态变化导致声线不同时，基于该角色音色卡建后缀衍生卡（`S01-A`），不覆盖基卡；视觉资产变化不自动改声音身份。提示词正文用 `(S1)` 指位时，与 `S` 卡的对应关系写进全片约束或该镜正文。
- **六段官方结构必须保留**（MiniMax-H3 ref2va，顺序不变，一一对应六个驼峰字段）：`subject_definitions` → `prompt.subjectDefinitions`（用 `<Subject N>` 定义被引用的主体/场景/道具，来源用官方 `<Picture N>` / `<Video N>` / `<Audio N>` 指位）、`summary` → `prompt.summary`、`retention_analysis` → `prompt.retentionAnalysis`、`detailed_description` → `prompt.detailedDescription`、`overall_soundscape` → `prompt.overallSoundscape`、`non_diegetic_music` → `prompt.nonDiegeticMusic`。每段字段首行必须写官方段名（如 `subject_definitions:`），段间空一行。参考标记一律写官方 `<Picture N>` / `<Video N>` / `<Audio N>`（每类独立从 1 起），不再写「双花括号 ref 占位符」。导入节点的抽取**原样保留正文里已有的六段**，不会把镜改成一句画面描述；只有缺段才补；要在导入时改写某一镜，用它的 `clips` 参数按 `clipId` 覆盖 `{ prompt, seconds?, referenceIds?, continuity? }`，`clipId` 不在本次分镜里、`prompt` 为空、或引用了不存在/仅文字的资产都会直接报错。
- 每镜围绕一个清楚的戏剧节拍或主要变化；逐镜交代初态、刺激与反应、动作与动线、对白与表演、末态与承接。
- 每镜 `referenceIds` 里的卡 id 必须在资产卡里能找到；人物在画内还是画外要标明。

校验顺序：
1. 读 `assets/assetCards.md` 原文，传给 `planOperator({ action: "parse", markdown })`；有 error 就改卡，直到 0 条。
2. `planOperator({ action: "validate", snapshot })` 校验工程；重点看 V7（`<Picture N>` / `<Video N>` / `<Audio N>` 按媒质分组各自独立查越界，正文出现「双花括号 ref 占位符」一律判 error）、V8（图片 ≤9 / 音频 ≤1，校验器只拦这两个，**不单独校验视频参考（视频并入图片桶计数）**；供应商层 freevideo 单请求参考 ≤4、续接合计 ≤3 是引擎/界面限制，不在 V8）、V11（结构完整，含首镜必须 `shot` 与 `continuity` 取值）、V12（`seconds` 2–60 整数、`resolution` 合法）、V15（`referenceIds` 顺序与画布 `referenceOrder` 一致）、V16（续接镜参考合计 ≤3、时长 ≥10 秒）。**error 清零前不要进下一阶段门。**

**通过判据**：`parse` 零 error + `validate` 零 error；资产卡和分镜在同一次交付里完成；每镜有 `seconds`/`prompt`/`referenceIds`/`continuity`；每镜引用的卡 id 都能在资产卡里找到；**每镜六个驼峰字段（`subjectDefinitions` / `summary` / `retentionAnalysis` / `detailedDescription` / `overallSoundscape` / `nonDiegeticMusic`）已按六段写好**，每段字段首行写官方段名，内容用英文。

### 阶段 3 导入资产与分镜节点：抽取 → 校对 → 批量出资产

**默认路径**：把定稿的正文交给画布上的「导入资产与分镜」节点（`remote-assetImportNode`，工具 `node:importScript`；节点面板的「导入资产与分镜」按钮等价）。它一条链走完：抽取卡片与分镜 → 按内置 Schema 校对字段与卡编号 →（勾选出图时）逐张出资产图 → **独占写** `plan/assetIndex.json` 与 `plan/story.mtrack`（先索引后工程，工程失败删索引；任一文件已存在直接拒绝覆盖）。**V1–V16 的工程校验仍由 `planOperator({ action: "validate" })` 负责**，导入节点只校对抽取结果本身。

**入口只收两份稿的完整定稿**：本集/本次范围的资产卡与分镜都要齐了才调它（阶段门 2「一起出」就是这一门的前置）。对稿件内容，代码硬拦的是：编号重复、结构不合契约、`clips` 覆盖的非法引用（clipId 不在分镜里／prompt 空／引用不存在或仅文字的卡）；**正文 shots 里引用了不存在的卡会被静默掐掉，分镜缺段、缺卡一概不报错**——半套稿会静默落成工程、到派工才爆，而重跑又被独占写拦下，完整性只能在门口保证。传 `extraction` 前逐条过一遍：每镜的 `referenceIds` 都能在 `assets` 里找到；每张被引用的卡都在清单里；后缀/衍生卡带着 `refs`；`shots` 数量与分镜稿段数一致。`shots: []` 只适用于「先导纯资产稿、clip 事后用 `node:editProject add` 补」的确认场景，动手前必须跟用户确认，不是缺分镜的默认出口。

1. **传参**：`path`（工作区剧本文本）或 `text`（直接给正文）二选一；`ratio` / `style` / `systemPrompt` 就是阶段门 1 的三个定调值（写进新工程 `global`）；`generateImages: true` 才出图。导入的抽取**原样保留正文里已有的六段提示词**，不会重写成一句画面描述；要在导入时整体覆盖某一镜的 prompt，用它的 `clips` 参数（按 `clipId` 给 `{ prompt, seconds?, referenceIds?, continuity? }`；`clipId` 从 `S001` 起按正文顺序编号，`continuity` 可写 `true`/`false` 或 `shot`/`context`，填错直接报错）。别把抽取用的文本模型写进 `global.model`——那是多轨派工用的视频模型，写错会让派工报「所选模型不存在」。
2. **校对抽取结果**：逐张核对卡编号与类型（`C` 人物 / `SC` 场景空镜 / `P` 道具 / `S` 声音只文字），逐镜核对 `clipId` / `seconds` / `referenceIds` / `continuity`；编号或分镜不对就回阶段门 2 改文本稿重导，不在工程里手改 id。
3. **出资产图**：`generateImages` 时逐张走媒体通道（与图片生成节点同一条路），产物落 `assets/<节点 id>/`，并在节点右侧新建图片节点（`remote-imageNode`，`label` = `<卡号> <名称>`），画布节点 id 写回 `plan/assetIndex.json` 的 `nodeId`。画风、构图、人物不一致的卡**不要往下走**——错的资产图会被后面每一镜继承，校验拦不住它。**引擎任务名口径**：freevideo 侧任务名 = `类型-代号-时间戳`（资产图如「角色-C01-20261024-2355」，视频如「参考视频-S011-20261025-0156」），由供应商拼装（`packages/providers/src/media/freevideo.ts` 的 `jobLabel`）——调用方只负责把代号放进请求的 `label` 字段（资产卡号、镜头编号），前缀按生成方式/资产类型取，取不到代号退回「生成方式-提示词主题」；同一资产的多次生成靠时间戳区分、不同名。
4. **资产图之间的参考**（同一角色的状态卡、卡引用别的卡）由导入节点自动接线：`extraction.assets[].refs` 写基卡编号（如 `C01-A` 引用 `["C01"]`；后缀卡没声明时自动回落到同前缀基卡），出图前按依赖排序、衍生卡以基卡成图作参考图（≤4 张），并在画布连好「基卡图片节点 → 本卡 `in` 口」的线。手动改位次时才用 `connectNodes` + `node:setReferenceOrder`；那是资产出图内部的参考，与阶段门 4 的多轨参考是两回事。
5. 已有 `assets/assetCards.md`、只想单独建索引时才走旧路径：`planOperator({ action: "build", snapshot })` 校验 V1–V16 并写 `plan/assetIndex.json` + `plan/assetReport.json`（有 error 会直接拒绝，先把 `validate` 清零）。

**通过判据**：`plan/assetIndex.json` 与 `plan/story.mtrack` 存在；每张要用的卡都有 `nodeId`；**每镜六个驼峰字段仍各含官方段首**（被抽取覆盖成一句描述的镜必须补回，或用 `clips` 覆盖）；**并且人眼确认资产图合格**。

> **导入完还要绑工程**：导入只落盘，多轨节点 `node.data.projectPath` 仍是空的——不跑 `node:bindProject({ mode: "open", path: "plan/story.mtrack" })` 就读不到 `clips` 与「参考素材」（下一门第 2 步就是它，漏掉会表现为「工程是空的」）。出图有失败卡时先看 `node:importStatus` 的 `failed[]`，补图后再往下走；长任务中途查进度也用它（别反复重跑，重跑会被独占写拦下）。**卡片与分镜在会话里已经定稿成结构化数据时，用 `node:importScript` 的 `extraction` 整批落盘**——抽取本来就该由会话 Agent 用它确认可用的模型完成，节点只负责契约校验与写盘，Agent 侧调模型受 120 秒硬顶限制。

> **导入后发现问题的纠错回路（不必也不该整体回滚重导）**：`plan/` 两文件被独占写锁死，重导要先清文件且会话 Agent 没有删工作区文件的工具——所以「发现不对」的第一反应不是推倒重来，而是就地修：
> - **分镜内容错**（提示词/时长/衔接/顺序/缺镜多镜）→ `node:editProject` 的 `patch`/`add`/`remove`/`move`/`duplicate`/`setGlobal`（整批原子、CAS 防覆盖），或 `planOperator mtrackUpdate`；改完回 `validate` 清零。
> - **单张资产图不满意** → 注意资产图落的是 `remote-imageNode`（只持图，函数是 `setImage`/`splitGrid`/`createPanorama`/`capturePanorama`/`generateMultiAngle`，**没有 `setPrompt`/`generateImage`**）。重出的正确走法：新建一个 `remote-imageGenerationNode` → `node:setPrompt`（改好的正文）+ `node:generateImage` → 把产物用 `node:setImage` 写回原资产节点（label 保持 `<卡号> <名称>`）；或直接 `deleteNodes` 删掉旧资产节点、补一张带正确 label 的新图节点（换了节点就要按阶段门 4 重新连线并在「参考素材」重新打勾——`setImage` 写回原节点不丢连线，是首选走法）。出图失败的卡补一张即可——派工按 label 兜底找节点（`findCardNodeIds` 认「`<卡号> <名称>`」前缀），不要求回填索引 `nodeId`。
> - **label 漂了**（派工认不出卡）→ `renameNodes` 改回 `<卡号> <名称>` 或 `node:editProject patch` 修 clip，不必重导。
> - **卡片正文/关联错** → 改 `assets/assetCards.md` 留准原稿（Agent 可写）；注意已导入的工程不会回头读它——资产图节点只持图不存提示词，要换图按上条走生成节点（提示词从改好的卡片稿抄进 `setPrompt`）。`refs` 关联缺漏用 `connectNodes` 补基卡→本卡线、`deleteEdges` 拆错线。
> - **残留/多余节点**（取消导入后半截建好的图节点）→ `node:importStatus` 的 `placedNodeIds` 给清单，画布工具 `deleteNodes` 直接清（单次 ≤64，连带删边）。
> - **整条工程作废**（口径全错才走到这一步）→ 请用户从文件树删除/改名 `plan/story.mtrack` 与 `plan/assetIndex.json`（经 MCP `workspaceFiles` 接入的可 rename/remove），连带清 `assets/<导入节点 id>/` 里要弃的图与画布节点，再重新导入。删节点是画布操作、Agent 可代做；删工作区文件是用户动作——这条边界别弄反。

### 阶段 4 资产连线 → 创建/绑定多轨工程 → 从连线打勾

**顺序固定：先把资产节点连到多轨节点 `in` 端口，再建/绑工程，然后在多轨界面「参考素材」里打勾。** 不要一上来就建多轨工程，也不要用 `node:editProject` 预先写 `referenceIds`。

1. **连线**：`connectNodes` 把每个已出图的资产节点接到多轨节点的 `in` 端口（`source` 是资产节点 id、`targetHandle` 固定 `"in"`）。只连这次真正要用的素材；连线只承载素材，不承载剧情。
2. **创建/绑定工程**：`node:bindProject({ mode: "open", path: "plan/story.mtrack" })` 打开阶段门 3 已写好的工程；只有确实还没有工程时才 `mode: "new"`（exclusive，绝不覆盖）。
3. **打勾**：在多轨界面的「参考素材」里逐镜勾选要用的资产卡——**这个清单只列 `in` 端口连线上的来源，没连线的不给勾**（一条都没连时界面直接给接法指引）；**勾选顺序就是 `referenceIds`，也就是官方 `<Picture N>` / `<Video N>` / `<Audio N>` 的位次基数**；断线的旧引用**不进这个网格**（没有勾选框），界面只在提示条里点名并给一次「清掉旧引用」（写回前二次确认，`referencePicker.vue:38-41`、`:127-136`）；被置灰、看得见却勾不上的是**连了线但对不上资产卡**的来源。取消勾选或清掉旧引用都会同步改写正文里的官方参考标记（`multitrackEditor.vue` 的 `remapPromptReferences`：删掉的标记连同多余空格一起归一），改完要重新核对段首与位次。agent 不预先写 `referenceIds`。
4. **核对断点**：`node:readReferenceMap` 一次读全「镜 → 资产卡 → 画布节点 → 官方参考位次」四段映射链：`missingCardIds` 非空是真断点（此时派工会报「参考图未就绪」），`unconnectedCardIds` 是有产出但没连上，`orphanSources` 是多连。断点先补：没出图就回阶段门 3，没连线就补 `connectNodes`。

**通过判据**：工程已绑定；每镜要用的资产都在连线上且已勾选；`node:readReferenceMap` 的 `missingCardIds` 为空。**这一门没做完就派工，等于把同一个检查让派工再拦一次。**

（旧装配路径按需：`planOperator({ action: "assemble" })` 出 `assetNodes` / `clipNodes` 与连线的计划（它只出计划，不碰画布、不生成、不连线），再 `addNode` / `connectNodes` 落地——只在要走「每镜一个视频节点」而不是多轨单节点时才用。）

### 可选环节：3D 导演台预演（复杂转场/动作）

分镜稿里有复杂转场或动作（转场设计、多人动作调度、连续运镜、连续多机位）时，先交项目内 3D 导演台搭 3D 低模定好机位、动线与动作轨迹，避免视频生成直接反复抽卡的代价。简单正反打、单镜头场景不必进本环节；同场景仅换角度、无复杂走位时优先全景派生（见阶段门 2 多角度规则）。跳过须用户确认并记录未预演的镜头范围。

1. `getCanvas({ include: ["nodeTypes"] })` 确认 `remote-director3dNode` 可用，`addNode` 建导演台节点；类型不存在请用户在插件市场启用「导演台」后继续，不手写画布 JSON。
2. 参考图与剧本文本连到导演台 `in` 口（STRING/IMAGE/VIDEO 均进引用序列）；`node:setConfig` 成对设 `providerId`/`modelId`（带图片引用必须选支持视觉的多模态模型），再 `node:getConfig` 核对。
3. `node:generateScene({ instruction })` 发起搭景定机位，指令一次讲清场景布局、角色站位、动作与镜头需求（首次建场同一节点只允许一个生成任务）；`node:getGenerationStatus` 轮询，`node:getState` 审查、`node:selectPlan` 选定方案；空间关系、走位或运镜要修正时继续用自然语言修改。
4. `node:exportKeyframe` 导出机位关键帧 PNG 到图片节点，作对应镜头的构图/机位参考；需要运镜节奏时再 `node:exportVideo` 导出预演 MP4。单次导出受约 240 秒与约 100 MB 上限约束，超限按方案拆短或逐机位导出关键帧。
5. 把导出的关键帧节点连到多轨节点 `in` 口，在「参考素材」里为对应镜头勾选并重新校验（注意单镜参考 ≤4 的上限）；改完重跑 `node:readReferenceMap` 确认无断点。

预演成果是参考素材，不是正式分镜图或成片；验收关口不得因预演存在而跳过。

### 阶段 5 逐镜生成

**衔接判定：能承接就承接。** `shot` / `context` 只有两个取值，**默认是承接**：同一段落、同一空间，画面或动作接上一镜，就写 `context`；只有下表这几种确实不该承接的情况才写 `shot`，并写清为什么：

| 情况 | 用什么 | 判据 |
| --- | --- | --- |
| **默认：同段落、同空间，画面/动作接上一镜** | `context` | 上一镜已成功且 `attempts` 里有 `jobId`；本镜 ≥10 秒、参考合计 ≤3 |
| **换场**：换到另一个空间 | `shot` | 环境不连续，硬接会把上一镜的空间带进来 |
| **时间跳转**：跨日、闪回、跳过一段时间 | `shot` | 上一镜末帧不是本镜起点 |
| **需要重新构图 / 独立起拍**：新段落第一镜 | `shot` | 承接会把上一镜的机位与运动带进来 |
| **本镜 < 10 秒，或参考合计 > 3** | 改时长到 ≥10 秒并减参考后承接，否则 `shot` | 引擎硬限制：续接段每条 ≥10 秒、参考合计 ≤3（图片/视频/音频同口径） |
| **首镜** | `shot` | 没有上一镜可承接，V11 直接拒绝 |

- **多数镜头应当承接**：同一空间里连续的动作、对话、反应镜头默认都是 `context`；一整片几乎全是 `shot` 通常是判错了。
- 承接不是凑数：换场、时间跳转、重新起拍强行 `context`，会把上一镜的机位与运动一起带进来，构图与场景建立白做。
- `context` 拿不到上一镜可用的 `jobId` 时**直接报错，不静默降级成独立镜头**：要么先生成上一镜，要么显式改成 `shot`。

派工前必查：`node:readReferenceMap`（缺 `missingCardIds` 就是真断点，派工会报「参考图未就绪」）。断点先补：资产节点没产出就回阶段门 3 出图，没连线就补 `connectNodes`。

派工时 `referenceIds` 的位次就是官方 `<Picture N>` / `<Video N>` / `<Audio N>` 的编号基数：正文一律写官方尖括号标记（每类独立从 1 起），旧「双花括号 ref 占位符」会被 `composeClipRequest` 判 error。

两条生成路径，二选一，**绝不同时**：

- 批量：`node:dispatchGenerate({ clipIds })` 或 `({ from: "S001", to: "S010" })`。立即返回 `{batchId, skipped}`；进度看 `node:getStatus.batchClipIds` 或 `planOperator mtrackRead`。
- 逐镜 SOP（要逐镜盯质量时）：多轨工程里直接 `node:dispatchGenerate({ clipIds: ["S003"] })` 只派一镜；要走镜头节点的老 SOP 时，工具序列见 `generationRunbook.md` §十三 13.2：`planOperator dispatch` → `node:setConfig` → `node:setPrompt` → `node:generateVideo` → `node:getGenerationStatus` 等结果 → `planOperator mtrackUpdate` 回写；建节点与接线的细节同节（`addNode` / `connectNodes`）。参考位次在多轨界面打勾产生（阶段门 4），不靠手工排序。

**批量派工是串行的。** `node:dispatchGenerate` 对目标镜**按 `clips` 顺序逐个执行**（编辑器里的批次循环等到上一镜出结果才开始下一镜），不是并发下发。所以：

- **同一批次里可以混用 `shot` 和 `context`**：轮到某镜时，它的上一镜已经落盘，`attempts` 里的 `jobId` 已经能读到，`context` 因此成立。
- 上一镜失败时，下一镜的 `context` 会报「上一镜没有可用的生成任务号」并跳过——这是串行的必然结果；修好上一镜后用 `node:resumeBatch` 续跑该镜（沿用同一 `batchId`）。
- 不要为了「批量就不能续接」把承接镜改成 `shot`，也不要为了续接把独立镜改成 `context`。

回写只用 `planOperator mtrackUpdate`：`updates: [{ clipId, status, nodeId, assetPath, attempts: [...] }]`，并带 `expectedUpdatedAt` 防并发覆盖；`attempts` 是**整数组替换**，不是追加。

续接规则：本镜 `continuity=context` 时，上一镜必须已成功且 `attempts` 里有 `jobId`，否则报错：

- `S002 是首镜，衔接方式不能是「承接上一镜」，请改为独立起拍`
- `S003 要承接 S002，但上一镜没有可用的生成任务号…请先生成 S002，或把本镜改为独立起拍`
- `S003 承接 S002 时最多 3 个参考素材（引擎限制，图片/视频/音频合计），当前 4 个…`

**通过判据**：目标镜 `status` 到 `generated` 且 `assetPath` 有值；`attempts` 记录了 `jobId`（续接镜的前提）。

### 阶段 6 人工验收 + 合成

1. 逐个看片，逐镜在界面点「验收」（`status=accepted`）。验收清单：身份不漂 / 服装连续 / 空间结构一致 / 动作在时长内完成 / 台词说完不吞字 / 无字幕水印 / 首尾可接。
2. `planOperator({ action: "composite", execute: false })` 先出 `plan/composite.json` 看清单（只含 accepted、按 `clipId` 顺序连续无空洞，规格不一致会在 execute 前被 ffprobe 挡下）。
3. `execute: true` 出片。

失败原文：`没有 accepted 片段可合成：请先在多轨编辑器里把要合成的片段验收为 accepted`。

**通过判据**：`composite.json` 的 `executed=true` 且有成片路径；未验收的镜头没有被算进合成。

## 4 常见故障对照

| 报错 / 现象 | 原因 | 处置 |
| --- | --- | --- |
| `参考图未就绪：C01 在画布上没有可用产出` | 资产节点没出图，或 `label` 被改掉 | 补出图；`readReferenceMap` 看 `missingCardIds` |
| 派工成功但画面没参考效果 | 参考没连线 / 位次错 | `readReferenceMap` 看 `unconnectedCardIds` 与 `expectedRef` vs `actualRef` |
| `build 被拒绝：仍有 N 条 error 级发现` | 卡或工程校验没过 | 读 findings，先 `validate` 清零 |
| `mtrackUpdate 冲突：…expected …实际 …` | 工程被别人改过 | 重新 `mtrackRead` 拿新 `updatedAt` 再回写 |
| `已绑定 {path}，如需切换请新建节点或重新加载` | 节点已绑别的工程 | 用 `node:reloadProject(discard)` 或在该节点上 `bindProject(mode:"open")` |
| `plan/story.mtrack 已存在，未覆盖`（或 `plan/assetIndex.json …`） | 导入资产与分镜节点、`bindProject(mode:"new")`、`planOperator build` 都不覆盖已有文件 | 已有工程走 `node:bindProject(mode:"open")`；确实要重导就先人工清理这两个文件，不要绕过独占写 |

## 5 与 LSC H3 技能包的关系（核心流程一致，格式本地化）

**核心引导流程（定稿 → 出资产 → 接入多轨编辑器 → 逐镜/批量生成 → 验收合成）与 LSC 一致**；下面是必须本地化、照抄会错的地方：

| 项 | LSC 技能包 | 本链路 |
| --- | --- | --- |
| 画风 | 23 款图文画风库 + 分项词文件 | 只写 `global.style` 一段风格词，没有图库 |
| 资产稿 | 支持「导入已有资产编号/人物卡」的解析入口 | 画布「导入资产与分镜」节点（`node:importScript`）从剧本/分镜正文抽取卡片与分镜、可选批量出资产图，并独占写 `plan/assetIndex.json` + `plan/story.mtrack`；但**不认外部资产编号直接复用**，编号与字段一律按本链路口径重出 |
| 分镜 | 分镜表文档（D/E 编号、初态/刺激/动作/对白/末态），可交 Word | `plan/story.mtrack` 的 `clips`；台词进 `<d>`，事件/初末态写进 `detailedDescription`（`detailed_description:` 段） |
| 采样参数 | 提及模型/模式/时长/分辨率选择 | 只有 `global.model` / `ratio` / `resolution` / `seconds` / `generateAudio`，不碰采样、LoRA、种子 |
| 衔接 | 能承接就承接 + 计划状态 | `continuity` 两态（`shot` / `context`）——**默认 `context`（同段落同空间接着上一镜），例外按阶段门 5 的「衔接判定」**；`context` 靠上一镜 `jobId` |
| 验收 | 成片检查标准 | 人在界面点 accepted，再 `composite` |

## 6 这个技能不管的事

- 不管写小说、改剧本、写纯文案（走 workflow 技能）。
- 不管画布上节点样式、工作台界面长什么样（那是实现层，agent 只依赖工具与数据字段）。
- 不管模型计费与供应商配额；提交生成前如需确认算力消耗，按宿主提示的授权流程走。
