---
name: freevideoMultitrack
description: 把 FreeVideo 出好的资产接成多轨工程、逐镜生成并合成成片的完整链路：先定风格与画幅，再出角色/场景/道具资产卡与画布资产节点，然后拆镜写 plan/story.mtrack，逐镜经画布多轨节点派工生成、回写状态，最后人工验收并合成。用户要按我们自己的资产卡与分镜规范做多轨视频、要检查这条链路缺什么、要续接上一镜、要合成成片，或要写资产卡/分镜提示词时使用。没有「导入分镜」「导入资产稿」入口：资产卡与分镜只能在本链路里产出。
---

# FreeVideo 资产卡 → 多轨生成

本技能只用仓库里真实存在的字段与工具。所有字段名可在 `packages/nodeShared/src/mtrack/mtrackProject.ts`、`packages/tools/planOperator/src/index.ts` 核对；所有工具名可在 `packages/nodes/multitrackNode/src/index.vue`、`packages/skills/assetCard/references/generationRunbook.md` 核对。

## 0 边界

**没有「导入分镜」「导入资产稿」这两个入口。** 外部小说、剧本、别人的分镜表、旧项目的资产文档，都只是对话里的素材：要进生产，必须在本链路里按阶段门重新落成两种数据——`assets/assetCards.md` 里的资产卡数据行，和 `plan/story.mtrack` 里的 `clips`。不做解析导入、不做格式转换入口、不认「已有资产编号直接复用」这类旁路。

本链路的三个真源文件：

| 文件 | 内容 | 谁写 |
| --- | --- | --- |
| `assets/assetCards.md` | 资产卡（Markdown 数据行，C/SC/P/KF/S） | 本链路阶段门 2 写文件 |
| `plan/story.mtrack` | 多轨工程：`global` + `clips` | 阶段门 1 写 `global`、阶段门 2 写 `clips`（都用 `node:editProject`）；生成状态用 `planOperator mtrackUpdate` 回写 |
| `plan/assetIndex.json` | 卡 id → 画布节点 `nodeId` 的索引 | 阶段门 3 用 `planOperator build` 生成，不手写 |

## 1 硬约束（先记住这几条，能避免绝大部分空转）

1. **资产卡是 `assets/assetCards.md` 里的数据行，不是画布节点类型。** 画布上的图片生成节点只是执行载体，靠 `label` 精确等于卡 id 对齐；`planOperator build/assemble` 就是按 `id` 写 `label`。改掉 label 等于剪断参考线。
2. **`mode=image` 时 `referenceIds[0]` 必须是首帧卡，而且只放一张。** 这是当前实现的隐式约定（`mediaDispatch.ts` 单图链路下发 `startFrameOptional`），不是协议字段；不要去找 `startFramePath` 之类的东西。多图请用 `mode=ref`。
3. **换视频模型 = 改工程 `global.model`（`providerId` + `modelId`），不支持逐镜换模型。** `MtrackClip` 没有模型字段。
4. **参考位次就是 `referenceIds` 的顺序**：`referenceIds[0]`（数组第一项）对应 `{{ref 1}}`，第二项对应 `{{ref 2}}`，以此类推；下发时按媒体类型换算成 `<Picture N>` / `<Video N>` / `<Audio N>`。
5. **`continuity` 只有 `shot`（独立起拍/切镜）和 `context`（承接上一镜）**；首镜必须 `shot`；`context` 要求上一镜已成功生成且 `attempts` 里留有 `jobId`，本镜时长至少 10 秒、参考素材合计 ≤3（图片/视频/音频同口径，`mediaDispatch.ts:214`）。独立镜的参考上限有两个口径，别混：**校验器允许 9 张图**（V8，`planValidator.ts` 的 `MAX_IMAGE_REFERENCES`），而**多轨界面勾选到 4 就点不动**（`referencePicker.vue` 硬编码）；出资产图的图片参考另有 ≤4 的上限（`freevideo-image` 侧）。**什么时候该用 `context`、什么时候必须用 `shot`，见阶段门 5 的「衔接判定」，不要按场景编号机械决定。**
6. **`status=accepted` 只能由人在多轨界面点验收。** Agent 的写入路径只收 `pending/generating/generated/failed`，不要试图标 accepted 去凑合成条件。
7. **本技能不做采样、LoRA、种子、CFG 这类参数。** 要换的只有模型、画幅、分辨率、时长、音频开关这些工程字段。
8. **`generateAudio` 目前只做透传，freevideo 供应商不消费它。** 传 `true`/`false` 不会改变成片有没有声音；要人声、环境声、配乐，写进提示词的 `overallSoundscape` / `nonDiegeticMusic`，别指望这个开关。换到 apiMart / tfRouter / compshare 时它们**会**消费这个开关（下发为 `generate_audio`），所以别把它当无用字段随便填。

## 2 工具面（只有这些，别找别的）

`planOperator`（工具名 `planOperator`，9 个动作）：

| action | 用途 | 关键参数 |
| --- | --- | --- |
| `parse` | 把资产卡 Markdown 解析成卡数组，报语法/字段问题（`markdown` 必填，先读文件再传内容） | `markdown` |
| `resolve` | 结算三级参考接线，返回 `refs` / `refSource`（省略 `markdown` 时按 `assetCardsPath` 读盘） | `markdown` 或 `assetCardsPath` |
| `validate` | 只读校验 V1–V15，返回 findings（error 清零才允许下一步） | `mtrackPath`、`snapshot` |
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

通用节点工具（不是多轨专属，也不是 nodeScaffold 直接提供：nodeScaffold 只管 `nodeTools` 注册表，`getReferenceOrder` / `setReferenceOrder` 由 `packages/nodeShared/src/useNodeReferences.ts` 的 `useNodeReferences` 注册，所以只出现在调用了它的节点上——audio / video / image / director3d / text / multitrack）：`node:getReferenceOrder` / `node:setReferenceOrder` 取/设某节点 in 端口的参考顺序，手工接线时用；`assemble` 与派工链内部也调它。

编辑器内部另有两个函数（不是 agent 工具，用来读懂报错）：`composeClipRequest`（`packages/nodeShared/src/mtrack/mediaDispatch.ts`，把一镜组装成一份生成请求，`{{ref N}}` 在此换算成 `<Picture N>`）、`submitClipTask` / `waitClipTask` / `cancelClipTasks`（`packages/nodeShared/src/mtrack/mediaTask.ts`，提交与轮询 `/api/ai/media/generate`）。agent 侧等价入口是 `node:dispatchGenerate`。

## 3 阶段门

### 阶段 0 入场盘点（不写任何文件）

1. `skillOperator` 有就 `list` → `read freevideoMultitrack`，没有就直读本文；`available_skills` 里的位置才是运行位置，不要把 `packages/skills/...` 当安装路径。
2. 看工作区有没有 `plan/story.mtrack`、`assets/assetCards.md`、`plan/assetIndex.json`；有工程就 `node:bindProject(mode:"open")` 或 `planOperator mtrackRead` 读现状。
3. 产出：现状一句话 —— 已有什么、缺哪个阶段门。

**通过判据**：能明确说出「下一步进哪一门」。

### 阶段 1 定调：风格、画幅、时长区间

问最少的三件事（能沿用就别重复问）：

- 画幅：`9:16` / `16:9` / `1:1` / `4:3` / `3:4`
- 风格：一段可复用的风格词，写进 `global.style`，会前缀到**每一镜**提示词最前面。模板（按题材删改，别只写「电影感」）：`<画法/成像> + <材质与光线> + <色彩与影调> + <镜头质感与颗粒> + <统一排除项>`
- 单镜时长区间：建议 **4–15 秒**（超了拆镜，不加速不吞字）

**单镜时长怎么定**：先按自然口语把台词念一遍估时长，把语气停顿和**并行**动作算进去——能同时发生的动作不重复累加，必须先后发生的不重叠凑时长；台词过长时在**自然语意节点**拆成两镜，不加速、不吞字、不改台词标点；每镜预留约 0.5–1 秒收尾让动作或表情自然落定，这段不被台词占满。声明时长不一定精确落地（freevideo 实测会吸附到帧档：6s→6.583s、10s→10.125s），成片总长以实测为准。

写入：`node:editProject({ operations: [{ type: "setGlobal", ratio, style, systemPrompt, model? }] })`。

- `global.systemPrompt` 放全片硬约束（如「所有人物同一套服装」「不出现现代物件」「无字幕无水印」）。
- `model` 形如 `{ providerId, modelId }`，不确定就先不传，用画布节点上已配的视频模型。

**通过判据**：`global.ratio` / `global.style` 有值且用户确认；单镜时长区间说定。

### 阶段 2 资产稿 + 分镜稿（一起出）

**与 LSC 一致：资产卡和分镜在同一个工作流里一起产出，不是分开的两步。** 先从小说/剧本里提取人物和场景，同时编排分镜，一次性交付两种数据：`assets/assetCards.md` 里的资产卡数据行，和 `plan/story.mtrack` 里的 `clips`。

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

**资产卡**写入 `assets/assetCards.md`，**分镜**写入 `plan/story.mtrack`（用 `node:editProject` 的 `add` 写 clips）。两者在同一次交付里完成，互相参照：

资产卡骨架（写法以 `packages/skills/assetCard/references/assetCardTemplate.md` 为准）：

```
### C01 · 角色名
- 建议画幅：2:3
- 提示词：<外形/骨相/五官/发型/体型/服装/神态，一段写完>
- 负面提示词：<不要的东西>

### SC01 · 场景名
- 建议画幅：16:9
- 提示词：<空镜、无人、空间结构与光线>
- 文本类：空镜，不出现人物
```

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
    "integratedMultimodalDescription": "detailed_description: <画面与动作，{{ref 1}} 是身份，{{ref 2}} 是空间> <d>[Chinese]台词原句</d>",
    "overallSoundscape": "<环境声与动作声>",
    "nonDiegeticMusic": "<配乐，没有就留空>"
  }
}
```

规则：

- **卡类型由 id 前缀决定**（`C` 人物、`SC` 场景、`P` 道具、`KF` 构图卡、`S` 声音，只写文字不出图），不要写「卡类型」字段。id 规则 `^(C|SC|P|KF|S)\d{2,}(-[A-Z])?$`。
- 缺省画幅：人物 2:3、场景 16:9、道具 1:1、构图卡 9:16。
- **场景卡一定写无人空镜**；不要把人写进场景提示词。
- 参考行字段名按卡类型选，解析器只认这些键：人物卡 `身份参考`（或 `参考`）、场景卡 `空间参考`/`结构参考`、道具卡 `道具参考`；构图卡三类都收。括号里写用途，例：`身份参考：C01（同一张脸，换装）`、`空间参考：SC01（同一空间，换机位）`、`道具参考：P01（同一张桌子，用旧）`；多个目标用顿号。
- 只有用户明确要道具才出 `P` 卡；普通持物写进动作描述。
- `clipId` 形如 `S001`，递增；`seconds` 整数 2–60（建议 4–15）；`resolution` 只有 `768P` / `2K`。
- `referenceIds` 上限：图片 ≤9、音频 ≤1（校验器 V8 只拦这两个；视频参考与图片同桶计数）；视频 ≤1 是供应商模式声明（`videoReference:1`），**不是**校验器拦的；`mode` 取 `ref`（多图参考）/ `image`（单图首帧）/ `text`（纯文）；`continuity` 只有 `shot` / `context`。
- 台词写进 `<d>[Chinese]原句</d>`，演绎说明写在标签外；说话者用 `(S1)`/`(S2)` 并在跨镜保持一致。
- 六段官方结构：`subject_definitions` / `summary` / `retention_analysis` / `detailed_description` 进 `integratedMultimodalDescription`，`overall_soundscape` / `non_diegetic_music` 各进自己的字段（不要连字段名一起写进去，下发改写时会补段名）。
- 每镜围绕一个清楚的戏剧节拍或主要变化；逐镜交代初态、刺激与反应、动作与动线、对白与表演、末态与承接。
- 每镜 `referenceIds` 里的卡 id 必须在资产卡里能找到；人物在画内还是画外要标明。

校验顺序：
1. 读 `assets/assetCards.md` 原文，传给 `planOperator({ action: "parse", markdown })`；有 error 就改卡，直到 0 条。
2. `planOperator({ action: "validate", snapshot })` 校验工程；重点看 V7（`{{ref N}}` 越界）、V8（图片 ≤9 / 视频 ≤1 / 音频 ≤1，MiniMax H3 独立镜）、V11（结构完整，含首镜必须 `shot` 与 `continuity` 取值）、V12（`seconds` 2–60 整数、`resolution` 合法）、V15（`referenceIds` 顺序与画布 `referenceOrder` 一致）。**error 清零前不要进下一阶段门。**

**通过判据**：`parse` 零 error + `validate` 零 error；资产卡和分镜在同一次交付里完成；每镜有 `seconds`/`prompt`/`referenceIds`/`continuity`；每镜引用的卡 id 都能在资产卡里找到。

### 阶段 3 出资产图 + 建索引

**这一门只做资产**：把每张要用的卡变成画布上「已出图」的图片节点，并让 `assetIndex.json` 记住卡 id → 节点 id。**别在这一门建镜头节点**，那是阶段 4。

1. **建资产节点**：`addNode` 图片生成节点，节点 `label` 写成卡 id；卡本身有参考时，按 `resolveReferences` 的层序先接资产之间的连线（`connectNodes`），再用 `node:setReferenceOrder` 定参考位次。
2. **逐张出图**：`node:setPrompt` 写卡提示词 → `node:generateImage` → `node:getGenerationStatus` 等完成。画风、构图、人物不一致的卡**不要往下走**——错的资产图会被后面每一镜继承，`build` 拦不住它。
3. **建索引**：`planOperator({ action: "build", snapshot })` 校验 V1–V15 并写 `plan/assetIndex.json`（卡 id → `nodeId`）+ `plan/assetReport.json`。`build` 有 error 会直接拒绝，先把 `validate` 清零。

**通过判据**：`build` 通过、`assetIndex.json` 存在且每张要用的卡都有 `nodeId`；`assetReport.json` 的 errors 为 0；**并且人眼确认资产图合格**。

### 阶段 4 统一接入多轨

**这一门把已出图的资产绑到多轨工程的每一镜上。顺序不能提前**：`assemble` 要靠 `assetIndex.json` 解析每镜 `referenceIds` 对应的节点 id，索引还没写或卡没出图，它只能给「参考结算缺 X」的 warning，接出来的线是断的。

1. **出装配计划**：`planOperator({ action: "assemble" })`（`from`/`to` 可省 = 全部）。返回两类计划——
   - `assetNodes`：卡 id、`kind`、层序 `layer`、`nodeType`、`data`（`label`/`prompt`/`ratio`）与资产之间的 `edges`；
   - `clipNodes`：每镜一个 `videoGenerationNode`，`data` 带 `label`/`duration`/`resolution`/`ratio`/`generateAudio`，`references` 是该镜引用到的卡 id，`edges` 是从卡节点到镜头节点的连线。

   **它只出计划，不碰画布、不生成、不连线。**
2. **落地**：按计划 `addNode` 建镜头节点、`connectNodes` 连线（`fromHandle` 按卡的 `kind` 取，`toHandle` 固定 `"in"`）。资产节点在阶段 3 已建好的，只补缺。
3. **核对断点**：`node:readReferenceMap`，返回的 `missingCardIds` 非空就是真断点——此时派工会报「参考图未就绪」。回阶段 3 补图，或回阶段 2 改 `referenceIds`。

**通过判据**：每镜的镜头节点都在画布上、参考连线齐全、`readReferenceMap` 的 `missingCardIds` 为空。**这一门没做完就派工，等于把同一个检查让派工再拦一次。**

### 阶段 5 逐镜生成

**衔接判定：三种情况映射到我们的两态。** `shot` / `context` 只有两个取值，按「这一段真正需要什么上下文」判定，**不要按场景编号机械决定**：

| 情况 | 用什么 | 判据 |
| --- | --- | --- |
| **动作续接**：同一动作继续，上一镜末帧就是本镜起点 | `context` | 上一镜已成功且 `attempts` 里有 `jobId`；本镜 ≥10 秒、参考合计 ≤3 |
| **同场切镜**：同一空间换机位/景别，身份、服装、道具、环境状态连续 | `shot` | 保持 `referenceIds` 里的身份/场景/道具卡一致即可；**不因为场景编号相同就强制延续运动上下文** |
| **换场或时间跳转** | `shot` | 只继承剧情需要的人物与物品状态 |

- **只有动作续接用 `context`。** 同场切镜用 `context` 会强制延续上一镜的运动，多半得到一段拖沓的重复动作；反过来，真正的动作续接用 `shot` 会丢掉起点的身体姿态与持物状态。
- `context` 拿不到上一镜可用的 `jobId` 时**直接报错，不静默降级成独立镜头**：要么先生成上一镜，要么显式改成 `shot`。
- 少数镜用 `context` 属正常；全片都用 `context` 通常是判错了。

派工前必查：`node:readReferenceMap`（缺 `missingCardIds` 就是真断点，派工会报「参考图未就绪」）。断点先补：资产节点没产出就去出图，没连线就 `connectNodes` 或重跑 `assemble`。

两条生成路径，二选一，**绝不同时**：

- 批量：`node:dispatchGenerate({ clipIds })` 或 `({ from: "S001", to: "S010" })`。立即返回 `{batchId, skipped}`；进度看 `node:getStatus.batchClipIds` 或 `planOperator mtrackRead`。
- 逐镜 SOP（要逐镜盯质量时）：`planOperator dispatch` 出清单 → 按清单逐镜派工 → 等结果 → 回写。工具序列见 `generationRunbook.md` §十三 13.2：`planOperator dispatch` → `node:setConfig` → `node:setPrompt` → `node:generateVideo` → `node:getGenerationStatus` 等结果 → `planOperator mtrackUpdate` 回写；建节点与接线的细节同节（`addNode` / `connectNodes` / `node:setReferenceOrder`）。

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

## 5 与 LSC H3 技能包的关系（核心流程一致，格式本地化）

**核心引导流程（定稿 → 出资产 → 接入多轨编辑器 → 逐镜/批量生成 → 验收合成）与 LSC 一致**；下面是必须本地化、照抄会错的地方：

| 项 | LSC 技能包 | 本链路 |
| --- | --- | --- |
| 画风 | 23 款图文画风库 + 分项词文件 | 只写 `global.style` 一段风格词，没有图库 |
| 资产稿 | 支持「导入已有资产编号/人物卡」的解析入口 | **没有导入入口**：卡只能在阶段门 2 写出来 |
| 分镜 | 分镜表文档（D/E 编号、初态/刺激/动作/对白/末态），可交 Word | `plan/story.mtrack` 的 `clips`；台词进 `<d>`，事件/初末态写进 `integratedMultimodalDescription` |
| 采样参数 | 提及模型/模式/时长/分辨率选择 | 只有 `global.model` / `ratio` / `resolution` / `seconds` / `generateAudio`，不碰采样、LoRA、种子 |
| 衔接 | 三种衔接 + 计划状态 | `continuity` 两态（`shot` / `context`）——**三种情况按阶段门 5 的「衔接判定」映射**；`context` 靠上一镜 `jobId` |
| 验收 | 成片检查标准 | 人在界面点 accepted，再 `composite` |

## 6 这个技能不管的事

- 不管写小说、改剧本、写纯文案（走 workflow 技能）。
- 不管画布上节点样式、工作台界面长什么样（那是实现层，agent 只依赖工具与数据字段）。
- 不管模型计费与供应商配额；提交生成前如需确认算力消耗，按宿主提示的授权流程走。
