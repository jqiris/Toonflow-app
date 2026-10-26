> **HISTORICAL（H3 迁移后口径更新）**：本文档写作于旧双花括号 ref 占位符与三字段提示词口径时期，正文中涉及的 `{{ref N}}` 占位符与 `integratedMultimodalDescription` 三字段存储已随 MiniMax H3 官方六段（`subject_definitions` / `summary` / `retention_analysis` / `detailed_description` / `overall_soundscape` / `non_diegetic_music`）与 `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记口径全量迁移后作废；权威口径见 `docs/h3PromptAlignment.md`，本文件仅作历史追溯保留。

# 资产卡 → 多轨生成 链路缺口审计（对照 LSC H3 技能包）

审计对象：我们这条「FreeVideo 出资产 → 画布资产卡节点 → 多轨总装（assetIndex / project.json）→ 逐镜生成 → 合成」链路。
对照物：`【H3 视频创作工作室】skill` 包（`H3-skills-share-2c63ef41.zip`，解压后仅两个技能 `h3-video-studio/` 与 `ai-screenplay-rewrite/`），只对照其产物流与阶段规则，不搬它的采样 / LoRA / 种子参数。

一句话结论：数据层（`.mtrack` 工程、`assetIndex`、媒体生成请求）已经够撑起「资产卡 → 逐镜 → 合成」，真正缺的不是字段，而是**一条被写成文的阶段门**：从「定调」到「验收」之间没有任何一处告诉 agent 先问什么、每步用什么工具、通过判据是什么，也没有说明「资产卡是 Markdown 数据行、不是画布节点类型」这类最容易找错的边界。

## 1 两条链路对照

| 阶段 | LSC 技能包的产物 | 我们的产物 | 落点 / 代码 |
| --- | --- | --- | --- |
| 起步设定 | 已确认的画幅、风格、改编权限（`references/canvas-production-profile.md:9`） | `project.global.ratio` / `style` / `systemPrompt` + `project.name` | `packages/nodeShared/src/mtrack/mtrackProject.ts:92-96` |
| 资产 | 人物卡、场景卡（未要求道具时不生成 P 卡，`h3-video-studio/SKILL.md:31`） | `assets/assetCards.md` 数据行（C / SC / P / KF / S） | `packages/tools/planOperator/src/assetCardParser.ts:10-25` |
| 分镜 | 分镜表：初态 / 刺激 / 动作 / 对白 / 末态，D、E 编号，`<d>` 只放台词 | `MtrackClip`：`clipId` / `seconds` / 三段 `prompt` / `referenceIds` / `continuity` / `mode` | `packages/nodeShared/src/mtrack/mtrackProject.ts:66-88` |
| 参考接线 | 每个引用说明用途（身份 / 服装 / 空间 / 风格 / 动作 / 声音，`canvas-production-profile.md:31-40`） | `plan/assetIndex.json` 的 `nodeId` + 画布资产节点 `label` | `packages/nodeShared/src/mtrack/mtrackProject.ts:100-106`、`packages/nodeShared/src/mtrack/directDispatch.ts`（`labelMatchesCard`） |
| 生成 | 逐段提交模型（官方 4–15 秒/段） | `composeClipRequest` → `submitClipTask` / `waitClipTask`，或 `node:dispatchGenerate` | `packages/nodeShared/src/mtrack/mediaDispatch.ts:103-211`、`packages/nodeShared/src/mtrack/mediaTask.ts:37/65/78/86` |
| 验收合成 | 成片检查标准（`references/qa-rubric.md`，人眼看片） | `status === "accepted"` → `planOperator composite` → `plan/composite.json` → ffmpeg | `packages/tools/planOperator/src/composite.ts:180-185` |

## 2 缺口清单

每条给：现象 / 证据 / 为什么缺 / 由谁补。「由谁补」只有三种取值：代码、提示词、技能文档。

### G1 没有「起步三问」阶段门

- 现象：agent 拿到「做个片子」直接开始写资产卡或建工程，没有人先定风格、画幅、时长区间；`global.style` 为空时 `buildPromptText` 只是不拼前缀，不会报错，问题要到成片才暴露。
- 证据：`packages/nodeShared/src/mtrack/mtrackProject.ts:96`（`global` 全部可选）；`packages/nodeShared/src/mtrack/mediaDispatch.ts:115`（`style` 为空时「全片风格」前缀整段跳过）。
- 为什么缺：这三项是「全片一次决策」，代码里只能是可选字段（老工程没有也正常），必须由技能文档在开头把它变成必过的门。
- 由谁补：**技能文档**（阶段门 1）。

### G2 风格只有 `global.style` 一个字符串，没有写法约定

- 现象：LSC 让用户从 23 款画风库选一款再取完整分项词（`h3-video-studio/SKILL.md:19`、`references/production-workflow.md:13`）；我们只有一个自由文本字段，写成「电影感」或写成完整材质/光线/色彩分项词，生成结果差很远。
- 证据：`packages/nodeShared/src/mtrack/mtrackProject.ts:96`；`packages/nodeShared/src/mtrack/mediaDispatch.ts:115`。
- 为什么缺：我们没有画风图库，也不该引别人的；缺的是「`style` 里该放什么」的模板。
- 由谁补：**技能文档**（给 4–6 行风格词模板，含画法/材质/光线/色彩/镜头质感，并说明它会前缀到每镜提示词最前面）。

### G3 资产卡没有「引用用途」结构化字段

- 现象：`AssetCard` 的参考只有 `explicitRefsText` / `directiveText` 自由文本，结算后 `refs` 只是 id 数组，看不出「C01 是身份参考还是服装参考」。
- 证据：`packages/tools/planOperator/src/assetCardParser.ts:10-25`（字段表）；`packages/tools/planOperator/src/referenceResolver.ts:145/166/185`（只校验目标是否存在）。
- 为什么缺：新增结构化字段属于协议变更（参考语义会进 `referenceMap` 与续接规则），这期不动数据层；参考行本身是自由文本，可以用 `身份参考` / `空间参考` / `道具参考`（按卡类型）加括号用途承载。
- 由谁补：**技能文档**（规定参考行写法：`身份参考：C01（同一张脸，换装）`、`空间参考：SC01（同一空间，换机位）`，用途词限定为身份/服装/空间/风格/动作/声音）。

### G4 资产卡不带出图参数

- 现象：卡里只有 `ratio` 与 `negativePrompt`，没有模型、分辨率、音频开关；真正的出图参数在画布图片生成节点的配置上。
- 证据：`packages/tools/planOperator/src/assetCardParser.ts:41`（`defaultRatios`：人物 2:3 / 场景 16:9 / 道具 1:1 / 构图卡 9:16）；出图参数走节点的 `node:setConfig`（`packages/skills/assetCard/references/generationRunbook.md:591-608` 的 node 工具表）。
- 为什么缺：这是**设计如此**，不是缺陷；但没写清会让 agent 去卡里找 `model`/`seconds`。
- 由谁补：**技能文档**（明写「卡只到提示词层，参数落节点」）。

### G5 资产卡不是画布节点类型，靠 `label` 对齐

- 现象：画布上的「资产卡节点」其实是图片生成节点，显式对齐键是节点 `label === 卡 id`；用户或 agent 改掉 label，参考结算立刻找不到产出。
- 证据：`packages/nodeShared/src/mtrack/directDispatch.ts` 的 `labelMatchesCard`（`(^|[^A-Za-z0-9])id([^A-Za-z0-9]|$)` 边界匹配）；缺产出时 `packages/nodeShared/src/mtrack/mediaDispatch.ts:120-123` 直接抛错「参考图未就绪…在画布上没有可用产出」。
- 为什么缺：`label` 是唯一连接键，但没有任何文档说明「改名即断线」。
- 由谁补：**技能文档**（列为硬约束）。

### G6 分镜缺「事件 / 对白说话者」结构化字段

- 现象：`MtrackClip` 没有 `events` / `dialogue` / `speaker`；LSC 靠 D、E 编号和 `(S1)` 说话者在跨镜保持一致（`h3-video-studio/SKILL.md:57-61`），我们只能全塞进三段提示词。
- 证据：`packages/nodeShared/src/mtrack/mtrackProject.ts:42-49`（`ClipPrompt` 只有三字段）、`:66-88`（`MtrackClip` 无对白字段）。
- 为什么缺：H3 的 `integrated_multimodal_description` 本身就是自由文本，台词用 `<d>` 写在里面，不需要额外字段；缺的是写法模板与「说话者编号跨镜头一致」的检查项。
- 由谁补：**技能文档**（给分镜行模板 + 一致性检查）。

### G7 `mode=image` 只允许一张参考，但代码不校验

- 现象：`image` 模式下发 `startFrameOptional`，语义是「单图首帧」，但 `composeClipRequest` 会把全部参考都放进 `images`，多于一张也不报错。
- 证据：`packages/nodeShared/src/mtrack/mediaDispatch.ts:241-243`（模式判定：续接/ref → `["imageReference:4","videoReference:1","audioReference:1"]`，单图 → `startFrameOptional`，无参考 → `text`）、`:218-220`（图片/视频/音频按 `dataType` 分三组各自下发，不再「全部进 images」）、`:209-210`（只有续接镜限参考素材合计 3 个）。
- 为什么缺：模式从 LSC `task_mode` 借来，但「首帧模式只有一张」这个隐含约束没有落到校验里。
- 由谁补：**代码**（`composeClipRequest` 里对 `resolveClipMode(clip) === "image"` 且图片数 ≠ 1 抛错）；技能文档先写死「`mode=image` 时 `referenceIds[0]` 必须是首帧卡且只放一张」。

### G8 逐镜不能换模型

- 现象：视频模型只在 `project.global.model` 一处，`MtrackClip` 没有模型字段；换模型只能整片换。
- 证据：`packages/nodeShared/src/mtrack/mtrackProject.ts:96`；`packages/nodeShared/src/mtrack/mediaDispatch.ts:125-135`（`videoModel` 由调用方整片传入，逐镜不可换）。
- 为什么缺：单镜换模型会带来分辨率/时长/参考上限全不一致，协议层刻意不做。
- 由谁补：**技能文档**（写清「换模型 = 改 `global.model`」）。

### G9 资产装配有两条路径，入口没有决策树

- 现象：一条是画布上手工三步「`connectNodes` → `node:setReferenceOrder` → `node:editProject`」（`packages/skills/assetCard/references/generationRunbook.md:610-614`），另一条是 `planOperator assemble` 按 `assetIndex` 批量建节点与连线；agent 经常先手工接一遍再让 assemble 建一遍，得到两份节点。
- 证据：`packages/tools/planOperator/src/index.ts:422`（assemble 分支）；两条路径的 node 工具名在 `packages/skills/assetCard/references/generationRunbook.md:591-614`。
- 为什么缺：两条路都用得上（局部补接 vs 全量装配），但没有「什么时候用哪条」的判据。
- 由谁补：**技能文档**（决策树：已有画布接好的 → 只补缺；从零装配 → `assemble`）。

> 现状更新（2026-10-25）：新项目主入口改为画布「导入资产与分镜」节点（`packages/nodes/assetImportNode`，抽取资产卡与分镜并批量出资产、写索引与 `plan/story.mtrack`）；`planOperator assemble` 与手工三步只用于已有工程补接，上文两条路径并存的现象已由该节点收敛。

### G10 MCP 侧没有 `planOperator` 的直连工具

- 现象：MCP 只暴露 `createAgentTools` 产出的通用工具与 `listSkills`（`apps/server/src/utils/mcp/operations.ts:67`），`skillOperator` 读技能后再落到画布 node 工具或工作区文件读写；`planOperator` 不是 MCP server 直挂工具。
- 证据：`apps/server/src/utils/mcp/tools.ts:8-9`（`createAgentTools` / `runAgent`）；`apps/server/src/agent/runtime/prompt.ts:16`（有 `skillOperator` 时先 list 再 read）。
- 为什么缺：这是形态差异，不是 bug；但技能包必须告诉 MCP 客户端「先读技能、再按阶段门调工具」，否则客户端会去找一个不存在的 `planOperator` MCP 工具名。
- 由谁补：**技能文档**（前置话术 + 工具名清单，注明技能读法与顺序）。

### G11 合成前没有「逐镜画面验收」环节

- 现象：`composite` 只校验 `status === "accepted"` 与 ffprobe 规格一致，不评价画面；LSC 有独立的成片检查标准（`h3-video-studio/SKILL.md:16`、`references/qa-rubric.md`）。
- 证据：`packages/tools/planOperator/src/composite.ts:180-185`（只按 accepted 过滤）。
- 为什么缺：画面质量判定是人的事，代码不该也不能替；缺的是验收清单。
- 由谁补：**技能文档**（阶段门 6 的人工验收清单：身份不漂、服装连续、空间一致、动作完成、台词说完、无字幕水印）。

### G12 时长约束只落在 schema，没有给建议区间

- 现象：`seconds` 只校验整数（工程侧 2–60），LSC 官方口语范围是 4–15 秒/段（`h3-video-studio/SKILL.md:57-61` 约束 4）；agent 经常写 20 秒的单段提示词。
- 证据：`packages/tools/planOperator/src/index.ts:105-114`（可写字段集，含 `seconds` 但不设上下限之外的建议）；`packages/nodeShared/src/mtrack/mtrackProject.ts:67`（`clipId` 规则）。
- 为什么缺：这是平台建议值，不该写成硬校验。
- 由谁补：**技能文档**（建议 4–15 秒；超过就拆镜，拆镜靠 `clipId` 递增与 `continuity`）。

### G13 新技能要同步到本地技能目录才可见

- 现象：技能从两个根加载——工作区 `skill/` 与全局 `<data>/skills/`（`apps/server/src/agent/skills/index.ts:17`），同名时工作区优先；源码里的 `packages/skills` 只是包装源，构建时被拷进 `build/skills`（`apps/server/scripts/build.ts:21`、`apps/server/src/index.ts:22`）。
- 证据：同上两处。
- 为什么缺：仓库内新增 `packages/skills/<name>/SKILL.md` 后，不往 `data/skills` 同步一份，跑着的 agent 看不到。
- 由谁补：**技能文档 + 落盘动作**（本包已同步一份到 `data/skills/freevideoMultitrack/SKILL.md`，并在交付说明里写明「`packages/skills` 为源码，`data/skills` 为本地副本，重建后以源码为准」）。

## 3 旁证：过期文档与疑似死链（不在本期修）

| 位置 | 问题 |
| --- | --- |
| `packages/skills/assetCard/SKILL.md`（能力边界表「连续性」行） | 曾写 continuity 只支持 `start` 与 `cut`，与 `packages/nodeShared/src/mtrack/mtrackProject.ts:10-19` 矛盾；**t10 后已改为 `shot`/`context`（G1 修复单），行号见该文件 `:100`** |
| `packages/skills/assetCard/references/generationRunbook.md:597` | §15.5 工具表同段曾出现 `start/continue/cut`；**t27 已改为 `shot/context` 并补 V16 约束（本次引导层终审修的纯文字项）** |
| `packages/skills/assetCard/references/multitrackTemplate.md:119` | 曾引用已删除的 `clipEditor.vue:13`；**t27 已改指 `packages/nodeShared/src/mtrack/components/shotEditorPane.vue:13-21`（验收按钮所在组件）** |
| `packages/skills/canvas/SKILL.md:26` | 指向 `../script/references/assetGuide.md`，`packages/skills` 下没有 `script` 目录；同段已要求「按 available_skills 的 location 定位资源，找不到就说缺」，属可自愈引用，不修 |
| `packages/nodes/multitrackNode/src/index.vue:365-366` | `clipPatchSchema` 的注释仍指向已删除的 `clipEditor.vue:9-13`（t2 已拆并删除），属注释级死引用，交 .vue 负责人 |

这些都属别人的在改文件，本期只在报告里列旁证。

## 4 引用核对清单（每条均 grep 过）

| 引用 | 核对方式与结果 |
| --- | --- |
| `packages/nodeShared/src/mtrack/mtrackProject.ts:92-96` | 已读：`MtrackProject` 字段 `version/projectId/name/updatedAt/global{ratio,style,systemPrompt,model}/clips` |
| 同上 `:10-19` | 已读：`Continuity = "shot" \| "context"`、`normalizeContinuity` 把 `continue` 归一到 `context` |
| 同上 `:36-39` | 已读：`resolveClipMode`，无参考 → `text`，其余 → `ref` |
| 同上 `:44-49` / `:51-63` / `:66-88` | 已读：`ClipPrompt` 三字段、`ClipAttempt.jobId`、`continuationJobId`、`MtrackClip` 全字段 |
| 同上 `:101-106` | 已读：`AssetIndexCard = {id,name?,kind?,textOnly?,nodeId?}` |
| `packages/nodeShared/src/mtrack/mediaDispatch.ts:18-42` | 已读：`ClipGenerationRequest` 字段 `clipId/providerId/modelId/prompt/images/audios/videos/continueFrom/ratio/resolution/duration/generateAudio/mode/outputDirectory/referenceMap/continuedFrom` |
[HISTORICAL] | 同上 `:60-81` / `:84-96` | 已读：`referenceTags`（`{{ref N}}` → `<Picture N>/<Video N>/<Audio N>`）、`buildPromptText`（风格前缀 + 段名兜底） |
| 同上 `:103-211` | 已读：`composeClipRequest` 签名与全部报错文案（`参考图未就绪…`、`是首镜…`、`承接…最多 3 个参考素材（引擎限制，图片/视频/音频合计）…`，见 `:209-210`） |
| `packages/nodeShared/src/mtrack/mediaTask.ts:37/65/78/86` | 已读：`submitClipTask/readClipTask/cancelClipTasks/waitClipTask`，端点 `/api/ai/media/generate`、`tasks/status`、`tasks/cancel` |
| `packages/tools/planOperator/src/index.ts:131-135` | 已读：`action` 枚举 9 个（parse/resolve/validate/build/mtrackRead/mtrackUpdate/dispatch/assemble/composite）与默认路径 `plan/story.mtrack`、`assets/assetCards.md` |
| 同上 `:105-114` / `:116` | 已读：`clipUpdateSchema` 只收 `status/nodeId/assetPath/attempts`，`status` 不含 `accepted`；`clipId ^S\d{3}$` |
| 同上 `:308-343` / `:345-346` / `:422` / `:536` | 已读：`mtrackUpdate`（四字段 patch + `expectedUpdatedAt` CAS）、`dispatch`（需要 `from`+`to`）、`assemble`、`composite` 分支 |
| `packages/tools/planOperator/src/assetCardParser.ts:10-25` / `:41` | 已读：卡字段与 `defaultRatios` |
| `packages/tools/planOperator/src/referenceResolver.ts:145/166/185` | 已读：`missingTarget` 警告 |
| `packages/tools/planOperator/src/composite.ts:180-185` | 已读：只取 `accepted`，无 accepted 时抛错 |
| `packages/nodes/multitrackNode/src/index.vue`（node 工具） | 已读：`dispatchGenerate` 参数 `clipIds` / `from+to` / `includeFinished`，返回 `{batchId, skipped}` |
| `packages/nodes/imageGenerationNode/src/index.vue:473` | 已读：`node:generateImage` |
| `apps/server/src/utils/mcp/tools.ts:8-9` | 已读：`createAgentTools` / `runAgent` 引用 |
| `apps/server/src/utils/mcp/operations.ts:67` | 已读：`listSkills` 描述「列出全局已安装技能的元数据；工作区技能复用 skillOperator」 |
| `apps/server/src/agent/skills/index.ts:17` | 已读：两个技能根 `join(cwd,"skill")` 与 `join(dirname(conf.path),"skills")` |
| `apps/server/scripts/build.ts:21` / `apps/server/src/index.ts:22` | 已读：`packages/skills` 拷进 `build/skills`，运行时 `skillsRoot` 二选一 |
| `apps/server/src/agent/runtime/prompt.ts:13/16` | 已读：先找 `workflow` 技能；有 `skillOperator` 先 list 再 read |
| `packages/skills/assetCard/references/generationRunbook.md:585-614` | 已读：16 个 node 工具表（`:591-608`）+ 资产接入三步（`:610-614`） |
| `packages/skills/canvas/SKILL.md:26` | 已读：`../script/references/assetGuide.md` 引用 |
| LSC `h3-video-studio/SKILL.md:14-31/53-61` | 已读：按任务加载资料、H3 输入模式、共同约束 8 条 |
| LSC `references/canvas-production-profile.md:9/31-40` | 已读：项目配置沿用、参考图职责 |
| LSC `references/production-workflow.md:7/13` | 已读：沿用用户已给风格画幅、先选画风 |

### 4.1 `packages/skills/freevideoMultitrack/SKILL.md` 引用面核对

| 引用 | 位置 | 核对方式 |
| --- | --- | --- |
| `planOperator` 9 个 action | `packages/tools/planOperator/src/index.ts:205`(parse) `:215`(resolve) `:227`(validate) `:245`(build) `:279`(mtrackRead) `:308`(mtrackUpdate) `:345`(dispatch) `:422`(assemble) `:536`(composite) | grep `action ===` 逐个命中 |
| 14 个多轨 node 工具 | `packages/nodes/multitrackNode/src/index.vue`：getStatus:392 / bindProject:402 / readClips:420 / readReferenceMap:430 / editProject:548 / saveProject:561 / reloadProject:579 / dispatchGenerate:594 / cancelBatch:617 / pauseBatch:629 / resumeBatch:641 / retryClip:657 / rewritePrompt:670 / refreshOutput:682 | grep 14/14 命中，无多余 |
| `node:getReferenceOrder` / `node:setReferenceOrder` | `packages/nodeShared/src/useNodeReferences.ts:52/67`（由该文件的 `nodeTools.register` 注册，任意宿主调用 `useNodeReferences()` 即生效，非多轨专属） | 已读，SKILL 中单列为「通用节点工具」 |
| `editProject` 六种 op | `index.vue:376-387`：`add`/`patch`/`duplicate`/`move`/`remove`/`setGlobal`；patch 形状 `clipPatchSchema:350` | 已读 |
| 写入不收 `accepted` | `index.vue:365-368`（comment + `status: z.enum(["pending","generating","generated","failed"])`） | 已读，与 SKILL 硬约束 6 一致 |
| `composeClipRequest` / `buildPromptText` / `referenceTags` | `packages/nodeShared/src/mtrack/mediaDispatch.ts` | grep 命中 |
| `submitClipTask` / `waitClipTask` / `cancelClipTasks` | `packages/nodeShared/src/mtrack/mediaTask.ts` | grep 命中 |
| `resolveClipMode` / `normalizeContinuity` / `continuationJobId` | `packages/nodeShared/src/mtrack/mtrackProject.ts` | grep 命中 |
| `labelMatchesCard` / `resolveReferenceSources` | `packages/nodeShared/src/mtrack/directDispatch.ts` | grep 命中 |
| `ClipGenerationRequest` 字段 | `mediaDispatch.ts:18-42` | 已读：`clipId/providerId/modelId/prompt/images/audios/videos/continueFrom?/ratio/resolution/duration/generateAudio/mode/outputDirectory/referenceMap/continuedFrom?` |
| 卡类型对应参考字段名 | `assetCardParser.ts:95-99`：人物 `身份参考|参考`、场景 `空间参考|结构参考`、道具 `道具参考|器物参考` | 已读；SKILL 的示例已按此改写 |
| 卡 id 规则与缺省画幅 | `assetCardParser.ts:41/43` | 已读 |
| `referenceIds` 上限 图4/视频1/音频1（V8） | `planValidator.ts:250-258` | 已读 |
| V11 结构完整（首镜 `shot`、`continuity` 取值）/ V12 时长分辨率 / V14 合成连续 / V15 参考顺序一致 | `planValidator.ts:146/177/262/274` | 已读 |
| `parse` 必须传 `markdown`、`resolve` 可省略后按 `assetCardsPath` 读盘 | `index.ts:206` / `:216` | 已读 |
| `assets/assetCards.md`、`plan/story.mtrack`、`plan/assetIndex.json` | `packages/tools/planOperator/src/mtrackProject.ts:57`；`packages/nodeShared/src/mtrack/mtrackProject.ts:64/65` | 已读 |
| 技能可见性（安装目录/工作区两个技能根） | `apps/server/src/agent/skills/index.ts:17` | 已读；SKILL 提示「同步到本地技能目录」 |
| 技能副本已同步 | `data/skills/freevideoMultitrack/SKILL.md`（17,203 B） | `cp` 后确认存在 |