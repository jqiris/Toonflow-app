# 逐分镜 FreeVideo 生成 SOP

> 权威依据：[docs/multitrackProductionPlan.md](../../../../docs/multitrackProductionPlan.md) §4（§4.1 调用序列、§4.2 参数规则、§4.3 模式判定铁律、§4.4 首帧续接、§4.5 批量执行、§4.6 状态查询纪律）；参数值以 `packages/providers/src/media/freevideo.ts`（`MiniMax-H3` 声明的 `mode` / `audio` / `durationResolutionMap`）为准。
> 前置契约：[多轨工程模板](multitrackTemplate.md)（`clips[]` 字段与状态机）、[参考接线解析规则](referenceResolution.md)（`referenceIds` 的来源与顺序）。
> 本文件描述 Agent 的**执行顺序与纪律**。多轨编辑器（`packages/nodeShared/src/mtrack/`，`@toonflow/node-shared/mtrack/*`）不直接调用供应商，但它**不经对话模型**：工作台 footer「生成视频」「逐镜面板…开始生成」与 `node:dispatchGenerate` 落到同一条直连链路（`multitrackEditor.vue` 的 `launchDispatch` → `packages/nodeShared/src/mtrack/mediaDispatch.ts` 的 `composeClipRequest` + `mediaTask.ts` 的 `submitClipTask`/`waitClipTask`），由编辑器逐镜组装请求交给服务端媒体任务通道，并在 `writeClipRun` 里追终态、回写工程（§十五、§十五·五）。只有 Agent 按 §一、§十三 自己编排时，生成、追终态与回写才在 agent 侧完成。两条路径写同一份 `plan/story.mtrack`（`updatedAt` CAS 对账），`batchId` 是唯一归属键。批量、取消、装配与分层生成见 §十二～§十七；对话 Agent 直接命令式操作画布多轨节点见 §十五·五。
> **提示词格式标准**：正文英文；对白、歌词与屏幕文字保留原文；单块时长须落在 `17n+5` 秒网格；宽高须为 32 的倍数；质量档位 `light`/`medium`/`high`/`max`。口径与 [freevideo-agent](C:\Users\jason\.dsh\skills\freevideo-agent) skill 一致，冲突时以该 skill 为准（§四 拼装规则据此执行）。

**验证状态声明（分两块，不要混着说）**：
- **单镜链路**已按 §一 实跑过一镜（首镜 02a，见 §十一 记录表，含 738.5 秒提交时长等实测值）；那次是绕过画布直接落文件，画布内回写仍是部分验证。
- **§十二～§十七 的批量、取消、多轨界面选段、自动装配、基础图分层**是照 t2/t3/t4 已落地的实现写的**执行手册**，写文档时逐处对着源码核过（见 §十九 核对表），但**还没有人照着它端到端跑过一轮**。首次照跑时把差异补回本节与 §十一。

---

## 〇、开始前的准入条件

1. `plan/story.mtrack`（JSON 内容，自定义 mtrack 扩展名）存在且 `clips[]` 非空；该镜 `status` 为 `pending`。
2. 该镜 `referenceIds` 指向的资产**已在 `assetIndex.json` 中且已出图**（V13）；没出图的资产先补生成，不带着缺失参考上场。
3. 该镜 `continuity` 为 `shot` 或 `context`（见 §五）。`context` 需上一镜有成功任务号，本镜时长 ≥10 秒、参考素材合计 ≤3（图片/视频/音频同口径） |
4. 用户已确认资产与分镜定稿（阶段 2/3 关口铁律）；生成前仍需按 §七 单独确认算力。

不满足任一条 → 停下，改契约或改资产，不进入调用序列。

---

## 一、单镜完整调用序列（11 步 + 步 1.5 节点分支判定）

> 每一步失败即停，不带着半成品继续往下走。

| 步 | 动作 | 要点 |
|---|---|---|
| 1 | **校验该镜（已实现 V1/V2/V4/V7/V8/V9/V11–V15）** | 用 `planOperator` 的 `validate` 读当前工程与画布快照，error 级发现清零才继续。**失败即停，不创建节点**；warning 可继续但须向用户说明。校验器**没有**实现 V3/V5/V6/V10，这四条靠本表后面几步人工核对兜住（见 §九） |
| 1.5 | **判定节点分支** | 读同一份 `dispatch` 返回的 `currentState.nodeId`（`packages/tools/planOperator/src/index.ts:393`）：**非空 → 走「复用分支」**，不 `addNode`，后续只对该 `nodeId` 做 `node:getConfig`/`node:setPrompt`/`node:setConfig`（重生成换提示词与配置，不换节点）；**空 → 走「新建分支」**，按步 2 建节点。复用分支下步 11 回写的 `nodeId` 与旧值相同——`mtrackUpdate` 只允许写 `status`/`nodeId`/`assetPath`/`attempts` 四项（`packages/tools/planOperator/src/index.ts:86-108`、`:301`），不会产生新 id。**没有 dispatch 返回时先按 §十三.1 出清单再进门** |
| 2 | **建节点** `addNode` | 视频生成节点；`label` 用 `场<场景号>·片段<片段号>·视频`（1–200 字符）。已有 `nodeId` 的重生成**复用该节点**，不新建（这是 §十三 agent 逐镜编排口径；多轨编辑器的直连派工是另一条链路，重生成会新建节点追加版本，见 §15.9） |
| 3 | **接线** `connectNodes` | 资产图节点 → 视频节点 `in` 端口，**严格按 `referenceIds` 数组顺序**逐条连 |
| 4 | **核对顺序** `getCanvasNodes` | `fields: ["ports"]`、`dataKeys: ["referenceOrder", "mode", "model"]`，比对实际引用顺序与 `referenceIds` 是否逐位一致；不一致先修连线，不进入下一步。**这一步是人工核对，不是等校验器报错**：V15 只在 `validate` 收到 `snapshot`（`packages/tools/planOperator/src/index.ts:80-84`，形如 `{ nodes, incomingEdges, referenceOrder? }`，其中 `nodes[]` 只接受 `id`/`type`/`status`/`outputs`）时才生效，不传快照它一句话都不会说；V6（画布入边数 = 参考数）在 `planValidator.ts` 里根本没有实现，只能靠这里逐位比对 |
| 5 | **读配置** `node:getConfig` | 读当前 `matchingModes`、可用 `duration`、`resolution`、`ratio`。**不许跳过本步**——模式按当前实际参考集合决定（见 §三） |
| 6 | **下发配置** `node:setConfig` | `{ providerId: "freevideo", modelId: "MiniMax-H3", duration: <seconds>, resolution: <768P\|2K>, ratio, generateAudio, mode }`；`duration` 必须等于 `seconds` 且为 **2–60 的整数** |
| 7 | **写提示词** `node:setPrompt` | 写作者已写在 `clips[].prompt` 里的官方六段原样下发（段首标签自己写、参考标记按 §四 的 `{{ref N}}` 口径，引擎不代写），格式见 §四 |
| 8 | **展示方案并等批准** | 按 §七 的话术逐项展示，得到**明确同意**后才继续；未同意不调用生成 |
| 9 | **生成** `node:generateVideo` | 空调用；记录提交时刻 |
| 10 | **追终态** `node:getGenerationStatus` | 同一轮内追到终态；换轮/换会话必须先按 §二 读产物再判断 |
| 11 | **回写多轨** | 成功 → `status: "generated"`、填 `nodeId`、填 `assetPath`；失败 → `status: "failed"`、`attempts` 追加 `{ at, nodeId, status, error }`。成功那条 attempts 还要带 `jobId`（续接靠它）、`assetPath`（历史版本的身份）以及 `signature`/`index`/`parentJobId`（版本签名簿记，§15.9·5）。回写前按 §二 纪律 3 确认文件可读 |

> 第 11 步写的是 `generated`，**不是** `accepted`。只有用户看过成片并认可，才由人工改成 `accepted`。

---

## 二、状态查询纪律（§4.6，三条硬规则）

`node:getGenerationStatus` 的真实语义（`packages/nodeShared/src/useNodeGeneration.ts`）：

| status | 含义 | 能否据此回写 |
|---|---|---|
| `idle` | 本次打开节点后未发起生成 | **否**——`idle` 不表示没有历史输出 |
| `running` | 生成中 | 否 |
| `succeeded` | 本次生成成功 | 是，但仍需读 `outputs` |
| `failed` | 失败，`error` 给出原因 | 否（配 `attempts` 记录） |

1. **提交 ≠ 完成**：`generateVideo` 立即返回，本轮内用 `getGenerationStatus` 追终态；超时不等于失败（60 秒长任务是分钟级）。
2. **换会话/换轮后必须读产物**：用 `getCanvasNodes({ fields: ["outputs"] })` 确认该节点已有新媒体；**严禁用 `idle` 推断「没生成」**，否则会重复提交、浪费算力。
3. **回写前必须可读**：`assetPath` 必须指向一个真正可读取的文件，否则该镜只能标 `failed` + `error: "未找到产出"`，不得写 `generated`。

配套：`node:cancelGeneration` 只**请求**停止，不保证供应商撤销或退费；取消后同样按纪律 2 读产物再判断。

---

## 三、模式判定铁律

- **不得写死「4 图就是多参考」**：必须按**当前实际参考集合**（含文本端口、空端口）读 `node:getConfig` 返回的 `matchingModes` 再选模式。
- `MiniMax-H3` 声明的模式集合为 `text` / `startFrameOptional` / `["imageReference:4", "videoReference:1", "audioReference:1"]`。
- **模式集合会收缩**：空镜段（参考集非空或含 STRING/VOID）或混入视频/音频参考时，可用模式只剩 `startFrameOptional`——该模式只吃 2 张图，且按顺序变首帧/尾帧，语义与「多图参考」完全不同。
- 模式集合不满足本镜需求时，**改参考集合或拆分段落**，而不是挑一个能提交的模式静默生成。**该校验器不覆盖 mode 漂移**：`data.mode` 会被节点自身的 watch 静默改写（`packages/nodes/videoGenerationNode/src/index.vue:190-197`，引用集一变就把当前 mode 换成 `matches` 里的第一个可用项），而 `planValidator.ts` 里并没有 V10 判定。所以「下发前读到的 mode 是否还在 `matchingModes` 内、提交时是否被换掉」只能靠第 5/6 步用 `node:getConfig` 的 `matchingModes` 人工核对，别指望 `validate` 替你兜。

---

## 四、提示词拼装（`node:setPrompt`）

三字段按 `clips[].prompt` 逐字取用，不自行改写内容。段间空一行，段首标签按下述两种情形写——写错会直接破坏六段结构。

**无参考的片段**：正文框只写画面，引擎下发时补一个字段名（`directDispatch.ts:106`）：

```text
integrated_multimodal_description: <画面正文，[Shot 1] 起，多镜头时 [Shot 2] At 00:03.000, …>
```

**接了参考图的片段**：用 MiniMax H3 官方 ref2va 六段。前四段整段写进正文框，**第一行直接是 `subject_definitions:`**——不要再套 `integrated_multimodal_description:`，引擎看到正文已带官方段首就不再补字段名。后两段写进各自字段，**字段里只写内容、不写段名**（`overall_soundscape:` / `non_diegetic_music:` 由引擎拼）：

```text
subject_definitions:
<Subject 1> = C01（<名称>，用途：character）

summary:
<一两句总述本镜>

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - <列出保留的特征：外貌、服装、空间结构、形制>

detailed_description:
[Shot 1] <画面正文>
```

两个声音字段的内容在下发时被拼成这两段，所以字段里不要再写一遍段名：

```text
overall_soundscape: <环境声与动作声>

non_diegetic_music: <配乐>
```

> `buildPromptText`（`packages/nodeShared/src/mtrack/mediaDispatch.ts:84-96`，与旧画布路径 `directDispatch.ts` 的 `buildPrompt` 同口径）只做三件事：在正文最前面拼（有则拼的）「全片风格 / 全片约束」前缀；正文漏写官方段首时才补字段名（有参考 → `detailed_description: `，无参考 → `integrated_multimodal_description: `）；把两个声音字段拼成 `overall_soundscape: …` / `non_diegetic_music: …` 两段尾（字段本身只写内容，不写段名）。正文里的 `{{ref N}}` 在派工前由 `composeClipRequest` 按 `referenceTags`（`mediaDispatch.ts:60-81`）以参考的 `dataType` 逐位换算成模型侧标记（`<Picture N>`/`<Video N>`/`<Audio N>` 各自编号、同源复用首号）；agent 逐镜路径则在画布视频节点 wire 层换算（`packages/nodes/videoGenerationNode/src/index.vue` 的 `generationPrompt` 用 `referenceTags(refList)`）。六段正文（前四段含段首标签）由写作者写进 `integratedMultimodalDescription`，两个声音段只写内容，Agent 与引擎都不代写任何一段正文。

- **写法**：前四段的段首标签自己写、段间空一行；两个声音字段**不写段名**（写了会变成 `overall_soundscape: overall_soundscape: …`）。六段的完整可照抄示例与编号规则见 [多轨工程模板](multitrackTemplate.md) §四。
- **参考形貌必写**：挂了参考的资产，正文仍要在首次出现处写清「被引用的特征 + 画面位置 + 当前动作」，环境与光照照常写。MiniMax H3 官方 full-reference 规范（`references/ref-en.txt` §0 Description detail、§5.3）明确要求 detailed_description 尽可能详细，官方完整示例里同一场景的特征在 `subject_definitions`、`retention_analysis`、`detailed_description` 三处都写了一遍。正文只写 `{{ref 1}}` 不写特征，模型只能靠一张图去猜，画面更容易跑偏。
- **编号按参考位次**：参考标记统一写 `{{ref N}}`，`N` 是本镜 `referenceIds` 的位次（从 1 起），图片、音频、视频按同一份列表连续编号，`referenceIds: ["C01", "A01", "C03"]` 对应 `{{ref 1}}` / `{{ref 2}}` / `{{ref 3}}`。节点在下发前按每个参考的 `dataType` 换算成模型侧标记（图片、视频、音频各自编号），写作者不必自己按类型数。V7（`packages/tools/planOperator/src/planValidator.ts`）只查**越界**：`N` 必须落在 `1..referenceIds.length` 内；**不查重号**，也**不要求**每个编号都出现。
- 对白保持 `<d>[Chinese]…</d>`；说话人 ID 全片唯一。
- 每改一次 `referenceIds` 或连线，都要重新核对正文里的 `{{ref N}}` 位次并重新 `setPrompt`（R9：编号漂移）。

---

## 五、参考上限与 `continuity` 实现范围

**参考上限**：独立镜头**图片 ≤9**（校验器 V8 的 `MAX_IMAGE_REFERENCES = 9`；引擎视频生成单块的参考图默认可到 9，接口封套 `maxItems=32`）、**音频 ≤1**（同属 V8 的 `MAX_AUDIO_REFERENCES = 1`）。**V8 不校验视频参考**：`referenceIds` 里除 `kind: "sound"` 之外的一律并进图片桶计数，而卡体系的 `CardKind` 根本没有 `video`；「视频 ≤1」只是供应商模式声明（`freevideo.ts` 的 `videoReference:1`，`MAX_VIDEO_REFERENCES` 在 `planValidator.ts` 里声明了但零引用）。**多轨界面勾选上限只有 4**（`referencePicker.vue` 的 `toggle` 硬编码；这个 4 来自供应商模式声明 `imageReference:4`）——超 4 张是被界面挡下的，不是校验器挡下的，别把 4 当成契约上限。

- **续接镜头（`continuity: "context"`）参考素材合计上限 3 个**（图片/视频/音频同口径，V16 按 `referenceIds` 总数判）：FreeVideo 的 `continue_from` 契约规定「only references when continue_from is supplied」，guide 原文为 `media.references with at most 3 pictures`。超限由 `planOperator` 的 V16（`packages/tools/planOperator/src/planValidator.ts:174-175`）与派工组装 `composeClipRequest`（`packages/nodeShared/src/mtrack/mediaDispatch.ts`）双重拦下。
- **≥30 秒镜头会被引擎自动分块，此时引擎实限参考图 3 张**（422 原文「at most 3 pictures when … multiple blocks」，guide 原文一致）。排镜时先拆镜头或减参考，勿靠 422 兜底。
- 超限在多轨层就该被拦截（编辑器 `referencePicker` 网格端上限 + V8/V13/V16；`shotEditorPane` 的续接超限警告 `role="alert"` 直接挂在衔接文案下）；执行时若仍超限 → 停止，回到多轨删参考或拆段，不改参数硬跑。

**衔接方式（与 LSC 多轨编辑器 `continuity_mode` 完全一致，仅两态）**：

| `continuity` | 语义 | 实现 |
|---|---|---|
| `shot` | 独立起拍 / 有意切镜 | 不读取上一镜上下文。原 `start`、`cut` 都归一到这里（二者行为本就相同） |
| `context` | 承接上一镜 | 由引擎加载上一镜的**原生音视频上下文**继续生成（`continue_from: { from_job: 上一镜任务号 }`），成片时长不变 |

> 取值不是按场景编号决定的：**动作续接 → `context`**（同一动作继续，上一镜末帧就是本镜起点），**同场切镜**与**换场/时间跳转 → `shot`**。三种情况到两态的完整判据表（含批量串行下的续接口径）见 [多轨工程模板 §2.3](multitrackTemplate.md)。

**续接的五条硬规则**（写提示词与派工前必须核对）：

1. **首镜必须 `shot`**——没有上一镜可承接，`context` 会被校验器直接拒绝（V11）。
2. **上一镜必须有可用的供应商任务号**（`attempts` 里 `status: "succeeded"` 且带 `jobId` 的那条）。没有就报错，**绝不静默降级成独立起镜**——那会让「承接」变成假承接。
3. **参考素材照常生效，但合计最多 3 个**（图片/视频/音频同口径，`mediaDispatch.ts:209` 按 `references` 总数判，不只数图片）：`continue_from` 与 `first`/`last` 互斥，`references` 是续接时官方唯一允许的媒体。所以「续接 + 多参考图」要并存，续接只能走 `continue_from`，不能塞首帧图。
4. **续接段时长至少 10 秒**：引擎原文 `Each continued part must be at least 10 seconds`，可用时长 10 s / 11 s 起；独立镜头 2 秒即可，续接镜不行。
5. **续接任务必须是 two-pass**：`quality: light` 或 `medium`（供应商已固定 `light`），`preview=false`。

> 旧工程里的 `continue` 自动归一为 `context`，`start`/`cut` 归一为 `shot`；`story.mtrack` 不必手工改字段。

---

## 六、批量执行纪律

- 同一时刻只跑 **1–2** 个生成任务（本机 GPU 串行更稳）。
- 每镜独立 `status`，单镜失败不影响其他镜。
- **生成中不改多轨文件**（快照语义：任务按提交时的快照运行）；必须改就先停该镜，改完重新提交该镜。
- 批量前向用户展示总览：镜头数、总时长、预计任务数，仍按 §七 逐批确认。
- 批量怎么编排（agent 层循环、工具只出清单）、怎么取消、多轨界面怎么选段发起、总稿怎么自动装配、基础图怎么分层优先——见 §十二～§十七。

---

## 七、算力确认话术（必须逐项展示，等明确同意）

调用 `node:generateVideo` 前先展示：

```text
准备生成 S001「槐下饮酒」：
- 模型：freevideo / MiniMax-H3
- 数量：1 段（本镜）
- 时长：8 秒（整数，2–60 内）
- 分辨率：768P；画幅 9:16；含声音：是
- 参考：`{{ref 1}}`=C01、`{{ref 2}}`=C03、`{{ref 3}}`=C05、`{{ref 4}}`=SC02（图 4 张）
- 费用：免费 · 本机 GPU 生成，无计费
确认生成这一镜吗？
```

- **单张、变体、重生成各自单独确认**：一次授权只覆盖当次当镜；多镜要逐镜或逐批列出后确认，不用「上次同意过」代替。
- 用户提出改参数（时长、分辨率、参考、提示词）时，改完**重新走 §一 的 1–7 步并重新展示**，不能在原来的批准上叠加。- 展示里必须包含费用行；不得用「很快」「不花钱」替代具体数值。

---

## 八、失败处理

1. **读错误**：先取 `getGenerationStatus` 的 `error` 或供应商报错原文，连同 `attempts` 一起看，不猜。
2. **核对参数**：`seconds` 是否 2–60 整数、`resolution` 是否 `768P`/`2K`、`ratio` 是否合法、`generateAudio` 与 `mode` 是否与当前参考集合匹配、正文里的 `{{ref N}}` 是否越界（V7 只查 `N` 是否落在参考数量内、**不查重号**）。
3. **不自行「跑通」**：不得自行降分辨率、缩时长、换模型、删参考来让提交通过；这些都会改变交付语义，必须报告用户由其决定。
4. **同类错误找不到原因就停下**：连续同类失败（如两次都是模式不匹配）仍定位不了，停止批量，把错误原文、当前参数、参考集合交回用户，不进入下一镜。

回写失败态时 `attempts` 追加 `{ at, nodeId, status, error }`，`status: "failed"`，保留上一轮的 `nodeId`/`assetPath` 历史不被覆盖（重生成复用节点）。

---

## 九、与校验器的对应关系

`planValidator.ts` 里能产出 `rule:` 的规则只有：**V1、V2、V4、V7、V8、V9、V11、V12、V13、V14、V15**。**V3、V5、V6、V10 没有对应的 finding**——V3（前向引用）由 `referenceResolver` 以 `backwardsOnly` 告警形式拦截（`packages/tools/planOperator/src/referenceResolver.ts:148-149`），根本不在 `validate` 的 findings 里；V5 那段（`packages/tools/planOperator/src/planValidator.ts:133-141`）实际只产出 V9 warning；V6（入边数）没有实现；V10（mode 漂移）没有实现。所以本表里的步 4、步 6 是**人工核对步骤**，不是等校验器报错。

| 本 SOP 步骤 | 校验规则 |
|---|---|
| 步 1 校验（非全量） | V1、V2、V4、V7、V8、V9、V11、V12、V13、V14、V15（V3/V5/V6/V10 未实现） |
| 步 1.5 节点分支判定 | 无校验规则，纯人工判定：`dispatch` 的 `currentState.nodeId` 非空走复用、空走新建（`packages/tools/planOperator/src/index.ts:393`、`:301`） |
| 步 4 顺序核对 | 人工核对：V15 仅在 `validate` 传入 `snapshot` 时生效，否则自己用 `getCanvasNodes` 逐位比对 `referenceOrder`；V6 未实现，同一步手工比入边数 |
| 步 6 配置下发 | V8（参考数不超实际模式上限）、V12（`seconds`/`resolution`/`ratio`）；**V10 未实现**——`data.mode` 是否被静默切走要在这一步用 `node:getConfig` 的 `matchingModes` 人工核对 |
| 步 7 提示词 | V7（`{{ref N}}` 的 `N` **只查越界**：必须落在 `1..referenceIds.length` 内；**不查重号**、缺席某个编号不报错；正文里凡出现尖括号标记（如 `<Picture N>`）都报 error，提示改用 `{{ref N}}`） |
| 步 11 回写 | V13（`generated`/`accepted` 的 `nodeId`/`assetPath` 必须存在） |
| 合成（M4） | V14（只拼 `accepted`，顺序连续无空洞）：`planOperator` 的 `composite` 动作产出合成清单并写 `plan/composite.json`，`assetPath` 不可读同样报错；`execute=true` 时先逐段 ffprobe 实测尺寸/帧率/像素格式/音轨参数，与首段不一致直接报错挡在编码之前（concat 滤镜要求全段一致；实测中尺寸不一致会报 `Conversion failed!`，帧率与音轨不一致则静默出错片），声明 `seconds` 与实测时长差 >1s 只记规格提示 |

`validate` **零写入**；只有 `planOperator` 的 `build` 落盘派生文件。

---

## 十、能力边界（执行前如实告知）

与 [SKILL.md](../SKILL.md) 的降级表一致，本节只列与生成直接相关的内容：无 VAE identity 通道（靠多图参考 + 强约束文案）、续接走引擎 `continue_from`（上一镜任务号），与多参考图并存但图参考 ≤3；仍不暴露 context latent 文件（那是引擎内部产物）、调度器/LoRA/二采不可控。**降级项由本节文字列出，`validate` 当前不输出 `capabilityDegraded` 字段**——`packages/tools/planOperator/src/index.ts:221-236` 的返回只有 `errors`/`warnings`/`findings` 加 resolved、mtrackClips，没有降级清单；不要把本节的告知义务当成工具会自动吐的东西。

---

## 十一、首次实跑记录表（2026-10-19 已执行·首镜 02a）

> M3 验收「对 1 镜跑通全链路，状态正确回写」于 2026-10-19 实跑达成。目标镜：段 02a 入梦（节点 4d21e0c9-d31a-48dc-bbff-4de11d235632，15s，参考 C01/SC01/C04/P01）。

| 检查项 | 结果 |
|---|---|
| 单镜 11 步 + 1.5 是否全部按序通过 | ✅ 2026-10-19 完成（资产卡 → resolveFromMarkdown → story.mtrack → submit → poll → download → 回写） |
| `getConfig` 读到的 `matchingModes` 与预期是否一致 | ✅ imageReference:4 与 4 入边一致（66cfc549→0d4968d5→1642df93→0ad5d1ab） |
| 4 图 vs 3 图 + 1 视频的真实模式差异（方案 §8 待验证 2） | 本次仅 4 图 imageReference 模式（task=ref2va）；视频参考差异未测 |
| 60 秒长任务终态确认（方案 §8 待验证 3） | 本次 15s 单块；长任务未测 |
| 跨轮后读 `outputs` 判断是否 reliable（§二 纪律 2） | ⚠️ 本次绕过画布回写：成功 job 直接落文件 assets/nankou/clips/video02a-ca8d1176.mp4 + story.mtrack 回写；画布节点 outputs 未回写（遗留待补） |
| 失败态回写 `failed` + `attempts` | 部分：被用户手动停止 job jfa75986355de 已记入 attempts（cancelled_by_user），未测引擎主动失败分支 |
| 提交时长 | 738.5s（12.3 min）/ RTX 3090 / quality light（8+3 两遍）/ seed 1862430706048062 |
| spec 回读 | 1376×768、frames=362、output_seconds=15.083、task=ref2va、two_pass=true |
| 验收 | 用户确认「视频已生成」；状态转 accepted 待画布预览组件接入后走正式流程 |

### wire 层实测备忘（重提依据，后续改造 freevideo.ts 时对照）

1. 画布 promptInput 里的 `{{refN}}` 只是 mention chip 的旧格式文本（`packages/nodeShared/src/useNodeReferences.ts:27` value=`{{ref ${index + 1}}}`，全局序号、含音频视频与文本），这就是写作者要用的唯一参考标记：手写和 chip 插入完全同源，引擎层原样透传（`buildPrompt` 不改写），由 wire 层的 `referenceTags`（`packages/nodes/videoGenerationNode/src/index.vue`）按 `dataType` 换算成模型侧标记。
2. FreeVideo agent 接口不接受 `width`/`height` 直传（422 `/ must be a permitted field combination`）；分辨率用 **`megapixels` 命中 sizes 档位表**（capabilities.sizes：1.0→1376×768、0.98→1344×768、1.056→1408×800、1.5→1664×928、2.0→1920×1088）。provider 现行 `megapixels` 计算公式据此修正。
3. `POST /media` 返回 **201 Created**（响应含 `{file, url, ...}`），取 `file` 字段进 `spec.media.references`；判定成功须用 2xx 而非 `=== 200`。
4. 分辨率档位表（provider 内已知成功档）：960×544/0.5、1184×672/0.75、1344×768/0.98、1376×768/1.0、1664×928/1.5、1920×1088/2.0。
5. 长轮询按 `GET /jobs/{id}?wait=25` 直至 status ∈ held {succeeded, failed, cancelled, interrupted}；`result.video.url` 带 Bearer 下载；`library_id` 形如 `2026-10-19/ca8d1176dd5e4942a9efcc7a71e49d6b`；每 25s 一次输出。

---

## 十二、批量生成总则（谁循环、谁只出清单）

> 本节是 §十三～§十七 的公共前提。先读本节，再按 §十三 的顺序往下读。

**批次编排在 agent 层，工具内没有循环。** 三处依据：

1. `planOperator` 的 `dispatch` 只返回逐镜清单，不执行任何生成——源码注释原文「只出逐镜派工清单，不执行生成」（`packages/tools/planOperator/src/index.ts:337` 是这行注释，`:338` 才是 `if (action === "dispatch")`）；
2. `planOperator` 的 `executionMode` 是 `"sequential"`（`packages/tools/planOperator/src/index.ts:191`），一次工具调用只跑一趟；
3. 首镜实跑 **738.5 秒（12.3 分钟）/ RTX 3090 / quality light**（本文 §十一 记录表「提交时长」行）。一个 N 镜的同步循环必然超时，工具内循环等于让一次工具调用挂十几分钟。

所以：**agent 每镜一次调用、逐镜汇报；工具只负责算清单与回写状态。**

单镜仍按 §一 的 11 步 + 步 1.5 走。批量 = 把 §一 的 11 步按镜重复 + 两件额外的事：批次归属记账、逐镜汇报。

| 角色 | 负责 | 不负责 |
|---|---|---|
| `planOperator` `dispatch` | 按起止分镜号出逐镜清单（参数、参考集合、提示词、当前状态） | 不建节点、不生成、不写工程 |
| `planOperator` `mtrackRead` / `mtrackUpdate` | 读范围；回写 `status`/`nodeId`/`assetPath`/`attempts` | 不写 `seconds`/`prompt`/`referenceIds`/`continuity`（真源字段禁写） |
| 画布 `assembleCanvas` | 把装配计划落地成节点 + 连线 + `referenceOrder` + 提示词 | 不重算分层、不重算参考顺序、不下发模型配置 |
| 画布 `generateLayer` | 按层 `start` / `status` / `cancel` | 不同步等待、不自动跨层推进 |
| agent（你） | 循环、判定、汇报、按结果回写 | 不手改 `plan/story.mtrack` |

**批次归属怎么记**：`attempts[]` 的元素是 9 字段 `{ at, nodeId, status, error?, jobId?, assetPath?, signature?, index?, parentJobId? }`（`packages/nodeShared/src/mtrack/mtrackProject.ts` 的 `ClipAttempt` 接口）：`jobId` 供续接、`assetPath` 是版本身份，`signature` / `index` / `parentJobId` 是成功落盘时的版本签名簿记（参数签名、时间线位置、续接来源，供 §15.9·5 的待更新判定），**没有 `batchId` 字段，也不许新增**。批次号写进 `error`，形如 `batch:<uuid>`——这与多轨界面直连生成逐字一致（`packages/nodeShared/src/mtrack/multitrackEditor.vue` 的 `writeClipRun` 与 `launchCancel`，判据工具在 `packages/nodeShared/src/mtrack/batchMark.ts`）。会话内自建批次号时用同格式，例如 `batch:7f3c9a1e`。派工发起后批次号可读自 `node:getStatus.activeBatchId` / `batchClipIds`（见 §十五·五）；跨刷新丢失时从 `planOperator mtrackRead` 的 `attempts` 里按 `batch:<id>` 判据找回。

---

## 十三、按起止分镜号批量生成（agent 编排）

> 入口：`planOperator` 的 `dispatch`。它**必须同时给 `from` 与 `to`**（`packages/tools/planOperator/src/index.ts:341` 缺一即报「dispatch 需要 from 与 to（如 S001 / S003）」），不像 `mtrackRead` 可以省略。
> 分镜号格式 `^S\d{3}$`（`packages/tools/planOperator/src/index.ts:110`），**含端点**。

### 13.0 批次开工前（四条，缺一条就停）

1. **校验清零**：`planOperator` `{ action: "validate", mtrackPath: "plan/story.mtrack" }`，error 级发现必须为 0。`dispatch` 不做校验，它只出清单——把校验省掉等于带着 `{{ref N}}` 越界上场。注意校验器只覆盖 V1/V2/V4/V7/V8/V9/V11–V15（见 §九），V10 的 mode 漂移这一轮仍要自己盯。
2. **参考结算存在**：`plan/assetIndex.json` 必须已由 `resolve`/`build` 产出。缺它时 `dispatch` 仍返回清单，但每镜的 `referencePlan[].kind` 变成 `"未知"`、`nodeId` 为 `null`，并在文本尾追加 `参考结算缺 <refId>（建议先跑 resolve/build）`（`packages/tools/planOperator/src/index.ts:338`）。
3. **定批次号**：`batch:<uuid>`，全批次唯一。多轨界面发起时由界面生成（`packages/nodeShared/src/mtrack/multitrackEditor.vue` 的 `launchDispatch` 内 `crypto.randomUUID()`），会话内发起时自建；`node:dispatchGenerate` 派发的批次号由编辑器生成并在返回里给出（§十五·五）。
4. **确认 `allowBuild` 没被关**：`mtrackUpdate` 受它限制，关闭时报「mtrackUpdate 不可用：allowBuild 已关闭」（`packages/tools/planOperator/src/index.ts:16` 的默认值 `true`、`packages/tools/planOperator/src/index.ts:302` 的门禁）。`mtrackRead`/`dispatch`/`assemble` 是只读，不受影响——但批量生成要靠 `mtrackUpdate` 回写，关了就只能出清单一轮游。

### 13.1 出清单

```text
planOperator { action: "dispatch", path: "plan/story.mtrack", from: "S003", to: "S007" }
```

期望返回（`packages/tools/planOperator/src/index.ts:396-403`）：`{ path, from, to, generatedAt, updatedAt, clips[] }`，每个 `clips[]` 项含：

| 字段 | 用途 |
|---|---|
| `clipId` / `seconds` / `ratio` / `resolution` / `generateAudio` / `continuity` | 本镜参数真值 |
| `status` / `nodeId` / `assetPath` / `currentState.lastAttempt` | 是否要新建节点、是否重生成 |
| `prompt` | 三字段原文，写进 `node:setPrompt` 时逐字取用（§四） |
| `referencePlan[]` | 每项 `{ refId, kind, name, textOnly, nodeId }`，`nodeId` 是**已存在的资产图节点**，可直接连线 |
| `generationParams` | `duration`/`resolution`/`ratio`/`generateAudio` 是定值；`providerId`/`modelId`/`mode` 一律是「待 node:getConfig 决定」（`packages/tools/planOperator/src/index.ts:378-386`），**不得写死** |

范围里有编号空洞时：`missing` 语义同 `mtrackRead`——清单照出、文本尾附「未命中分镜：…」，**不整体报错**；向用户说明缺哪几号，不要静默补镜。

失败怎么办：
- `dispatch 失败：多轨工程不存在（<path>）` / `…不是合法 JSON（<path>）：<原因>` / `…起始分镜号 S007 不得晚于结束分镜号 S003`（`packages/tools/planOperator/src/index.ts:592`、`:604`、`:612`）→ 改参数或先修工程，不重试同参数。

### 13.2 逐镜执行（每镜一轮，按 §一 的 11 + 1.5 步）

对清单里 `status` 为 `pending` 或 `failed` 的每一镜，按顺序做。**步 b 之前先做 §一 步 1.5 的节点分支判定**（`currentState.nodeId` 非空走复用、空才新建），不要默认每次新建：

| 步 | 动作 | 关键参数 / 期望 |
|---|---|---|
| a | `mtrackUpdate` 先占位 | `{ action: "mtrackUpdate", expectedUpdatedAt: <13.1 的 updatedAt>, updates: [{ clipId, status: "generating", nodeId: <复用或新建>, attempts: [<原有全部 attempts>, { at: <ISO>, nodeId, status: "generating", error: "batch:<批次号>" }] }] }`。**`attempts` 是整数组替换**（`packages/tools/planOperator/src/index.ts:107`），必须把读到的旧记录一起带上，否则历史被抹掉 |
| b | 建节点（`currentState.nodeId` 为空时） | 画布 `addNode`，`type` 取 `getCanvas({ include: ["nodeTypes"] })` 里真实存在的类型（真实类型带 `remote-` 前缀，见 `apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts:106`）；`label` 用 `场<场景号>·片段<片段号>·视频`。**已有 `nodeId` 的重生成复用该节点，跳过本步** |
| c | 接线 | `connectNodes`，按 `referencePlan` 顺序把资产节点 → 视频节点 `in` 端口；单批上限 64 条（`packages/tools/canvas/src/runtime.ts:61`） |
| d | 核对参考顺序 | `nodeTools` `node:getReferenceOrder`（`packages/nodeShared/src/useNodeReferences.ts:52`）；不一致用 `node:setReferenceOrder`（`packages/nodeShared/src/useNodeReferences.ts:67`）按 `referencePlan` 顺序重写。参考编号（即 `{{ref N}}` 的 `N`）**只由 `referenceOrder` 决定**，不看连线手势 |
| e | 读配置 | `nodeTools` `node:getConfig`（`packages/nodes/videoGenerationNode/src/index.vue:399`），取 `matchingModes`/`duration`/`resolution`/`ratio`/`audio` |
| f | 下发配置 | `nodeTools` `node:setConfig`（`packages/nodes/videoGenerationNode/src/index.vue:411`）：`{ providerId, modelId, duration: <seconds>, resolution, ratio, generateAudio, mode }`；`duration` 必须等于 `seconds` 且为 2–60 整数 |
| g | 写提示词 | `nodeTools` `node:setPrompt`（`packages/nodes/videoGenerationNode/src/index.vue:450`），写作者已写好的官方六段原样下发（段首标签自己写、参考标记按 §四 的 `{{ref N}}` 口径） |
| h | 展示方案等批准 | 按 §七 逐项展示（含费用行），得到明确同意才继续 |
| i | 生成 | `nodeTools` `node:generateVideo`（`packages/nodes/videoGenerationNode/src/index.vue:462`），空参调用，记录提交时刻 |
| j | 追终态 | `nodeTools` `node:getGenerationStatus`（`packages/nodeShared/src/useNodeGeneration.ts:11-16`），按 §二 三条纪律判断 |
| k | 回写 | 成功 → `status: "generated"` + `nodeId` + `assetPath`，那条 `attempts` 一并带 `jobId`、`assetPath` 与 `signature`/`index`/`parentJobId`（版本签名簿记，§15.9·5）；失败 → `status: "failed"` + `attempts` 追加 `{ at, nodeId, status: "failed", error: <原文>, }`（批次号仍写在 `error` 前缀 `batch:<批次号> `）。**回写前必须能读到产出文件**（§二 纪律 3） |

并发纪律：**同一时刻只跑 1–2 个生成任务**（§六，与 `docs/multitrackProductionPlan.md:259` 的 §4.5 一致）。不要 5 镜一起 `generateVideo` 再统一轮询。

逐镜汇报（每镜一行，用户能据此决定要不要继续）：

```text
S003 槐下饮酒 · 已提交（节点 4d21e0c9）· 8s/768P/9:16 · 参考 4 图
S004 入梦 · 失败 · 模式不匹配：当前参考集合只剩 startFrameOptional · 已回写 failed
进度 2/5 · 批次 batch:7f3c9a1e
```

失败处理沿用 §八：读错误原文 → 核参数 → 不自行降级 → 连续两次同类失败就停整批。

---

## 十四、批量取消

取消是**三段**：请求停止 → 追到终态 → 回写状态。少任何一段都会留下「工程说在跑、节点已经停了」的假状态。

### 14.1 找出属于本批次的在跑镜头

判据与多轨界面直连生成的取消逻辑逐字一致（`packages/nodeShared/src/mtrack/multitrackEditor.vue` 的 `launchCancel`）：`attempts` 中任意一项 `error` **等于** `batch:<批次号>` 且 `status` 为 `"generating"`（源码原文是 `error 等于`，不是包含匹配）。批次号优先读 `node:getStatus.activeBatchId`（§十五·五）；编辑器刷新后该值丢失时，用 `mtrackRead` 按 `attempts` 里的 `batch:<id>` 判据找回在跑批次。

```text
planOperator { action: "mtrackRead", path: "plan/story.mtrack" }   // 读全量，自己按 attempts 过滤
```

### 14.2 请求停止

- 单镜：`nodeTools` `node:cancelGeneration`（`packages/nodeShared/src/useNodeGeneration.ts:17-26`）——它**只请求**停止，返回 `cancellationRequested`，不保证供应商撤销任务或退费，也不删已有输出。
- 整层：`generateLayer { layers, layer, action: "cancel" }`，内部同样是逐节点调 `node:cancelGeneration`（`packages/tools/canvas/src/assembly.ts:377`）。

### 14.3 追终态

取消后再 `node:getGenerationStatus` 轮询到 `succeeded`/`failed`（`generateLayer action=status` 返回 `settled` 与每节点 `clipStatus`，`packages/tools/canvas/src/assembly.ts:394-400`）。被取消的节点通常落到 `failed`，`error` 为 `生成已取消`（`packages/nodeShared/src/useNodeGeneration.ts:39`）。**不能用 `idle` 当「已取消」**（§二 纪律 2）。

### 14.4 回写

| 取消时的真实结果 | `clip.status` 写什么 | `attempts` 追加什么 |
|---|---|---|
| 确实停在半路、无产出 | `pending`（ClipStatus 之一，`packages/nodeShared/src/mtrack/mtrackProject.ts` 的 `ClipStatus` 类型） | `{ at, nodeId, status: "cancelled", error: "batch:<批次号>" }` |
| 取消时已出片 | `generated` + 补 `assetPath` | 同上（先按 §二 读 `outputs` 确认可读），条目里带上该次 `assetPath` 留痕 |
| 请求停止失败 | `failed` + `error` 原文 | `{ at, nodeId, status: "failed", error: "batch:<批次号> <原文>" }` |

要点：

1. `clip.status` **只能**取 `pending`/`generating`/`generated`/`accepted`/`failed` 五值之一（读盘口径；`packages/nodeShared/src/mtrack/mtrackProject.ts` 的 `ClipStatus`）。但**写入路径只收四态**——`planOperator` `mtrackUpdate` 的 `clipUpdateSchema.status`（`packages/tools/planOperator/src/index.ts:104`）与 `node:editProject` 的 `clipPatchSchema.status` 都不含 `accepted`：验收是用户点「验收」的人工判定，Agent 代写会被 zod 校验直接拒。`"cancelled"` 不是 `ClipStatus`，只允许出现在 `attempts[].status`（那里是自由字符串，`packages/tools/planOperator/src/index.ts:95`）。
2. `attempts` 整数组替换：先 `mtrackRead` 拿旧数组，再追加，一次 `mtrackUpdate` 写回。
3. 一次 `updates` 最多 500 条（`packages/tools/planOperator/src/index.ts:138`），超了分批。
4. 冲突重试：`mtrackUpdate 冲突：多轨工程已被其他操作修改（expected <a>，实际 <b>），请重新读取后重派`（`packages/tools/planOperator/src/index.ts:308`）→ 重新 `mtrackRead` 再派，不硬覆盖。

---

## 十五、多轨界面选段发起生成（用户入口）

用户不需要在对话里报分镜号——多轨界面自带选段派工。

### 15.1 界面在哪、叫什么

| 元素 | 位置 | 行为 |
|---|---|---|
| 镜头页签条 `shotTabs` | `packages/nodeShared/src/mtrack/components/shotTabs.vue`（每页签 = 「序号.标题 / 起止累计秒 / 状态」；编辑器 `multitrackEditor.vue` 的 `onSelect` 接选段事件） | 单击 = 选中该镜；`Ctrl`/`⌘` 单击 = 离散多选；`Shift` 单击 = 以当前单选为锚的连选区间。多选保留给批量调整与逐镜面板预填，**不再影响播放头**（时间线视图已随工作台改版删除） |
| 「＋ 添加镜头」/ 批量调整 | 01 选择镜头区（`multitrackEditor.vue` 模板 `addClip`/`bulkDuration`/`bulkAdd`） | 新镜默认 5 秒；批量调整 details 提供「统一时长 → 应用到全部镜头」（夹 2–60 整数）与「添加镜头数 → 批量添加」（上限 100） |
| 镜头操作 复制/前移/后移/删除/撤销删除/验收/重新生成本镜/整理本镜提示词 | `components/shotEditorPane.vue` 的「镜头操作」details（`:5-24`：复制/前移/后移/删除 `:8-12`、验收/取消验收 `:13-20`、重新生成本镜 `:22`、整理本镜提示词 `:23`），落点在 `multitrackEditor.vue` 的 `duplicateClip`/`moveClip`/`removeClip`/`undoRemove`/`acceptClip`/`regenerateClip`/`rewriteClipPrompt` | 前移/后移逐个换位（替代旧时间线拖拽改序）；移到首位的镜 `continuity` 归一为 `shot`（首镜约束）；删除后「撤销删除」只保留一份快照。「重新生成本镜」**已生成/已验收的镜也直接重跑**（强制 `includeFinished: true`，追加新版次，§15.9；仅该镜 `generating` 时禁用，有批次在跑时 `regenerateClip` 直接返回）。「整理本镜提示词」把本镜草稿交给文本模型整理（§15.8；结果只进「待采用」区块，人工采用才写回；提示词三段全空时禁用） |
| 名称/时长/画幅/分辨率/生成声音字段 | `shotEditorPane.vue` 的 `shotFields`（`:27-60`） | 每个字段 `onPatch` 写回真源，800ms 防抖落盘 |
| 「这个镜头要拍什么？」大 textarea | `shotEditorPane.vue`（`:61-69`） | 单框 = 三段合成（`promptToText`/`textToPrompt`，`mtrackProject.ts`）：正文 + `overall_soundscape:` / `non_diegetic_music:` 段名行；`{{ref N}}` 在正文里手写 |
| 衔接下拉 + 首镜 hint + 续接超限警告 | `shotEditorPane.vue`（`:71-88`） | `shot`/`context` 两档；首镜显示「首镜必须独立起拍」；续接引导文案带上一镜任务号；**参考 >3 张、时长 <10 秒时 `role="alert"` 黄条警告**（V16/续接下限的编辑期拦截） |
| 参考素材勾选网格 `referencePicker` | `packages/nodeShared/src/mtrack/components/referencePicker.vue`（`:4-9` 使用方式下拉 ref/image/text；`:10-33` 「图N · 名称」勾选网格，摘要「选择参考图 · n/4」；`:121-124` 按模式 hint） | 勾选直接读写 `clip.referenceIds`，**位次即 `{{ref N}}` 的 N**；改编号顺序 = 取消后按想要的顺序重勾（旧 ✕ 移除与「N. <id> ←」调序按钮随工作台改版退役）。界面拦截：点满 4 张不再加（`toggle` 硬上限 `:116`）——这 4 是**界面勾选上限**，校验器 V8 实际允许 9 张（§五），别把两者混成一个数；续接镜超限由 `shotEditorPane` 黄条警告（V16）。缩略图经画布桥反查（编辑器 `resolveReferenceThumbnails`），取不到显示「无预览」 |
| 快捷设置行（画幅 / 视频模型 / 分辨率显示） | `multitrackEditor.vue` 模板 `quickSettings` 区 | 画幅 = `ratioOptions` 五档下拉（`handleRatioChange`）；模型下拉 `loadVideoModels` 取画布 `videoGenerationNode` 的 `getConfig`（`handleModelChange`）；右侧只读「W × H · 24fps」估算（`dimensionsText`）。两者都是 `node:editProject` 的 `setGlobal{ratio,model}` 的 UI 形态。**模型清单取不到时降级为只读 `modelLabel` 文本**，此时口径「模型在哪改」= 对话里让 agent 用 `setGlobal{model}` 改 |
| 生成结果 · 校验折叠区 | `multitrackEditor.vue` 模板 `sectionResults` 区，内挂 `components/statusPanel.vue` | 版本行（见下）、视频预览、attempts 历史与校验发现（V 报告）都在这里 |
| 高级设置折叠区（项目 / 约束 / 生成范围） | `multitrackEditor.vue` 模板 `sectionAdvanced` 区 | 项目名称（借用 `projectId` 字符串位，schema 不动）；全片风格/系统提示词 + **本镜系统提示词（留空沿用全片；借用 `clip.notes` 存储位，派工时 `effectiveGlobal` 覆盖）**；生成范围 = 「从第几个镜头开始」+「生成镜头数（-1 表示到最后）」+「包含已生成」+「完成后自动合并」+ 固定的「合并时带上前面已完成镜头」说明勾选；按钮行 =「逐镜面板…」「校验」「刷新状态」「合成成片」「查看成片」（画布卡片宿主才显示），下方 `rangeText` 显示本批镜数与缺提示词提醒 |
| 工作台 footer「03 生成视频」 `runFooter` | `packages/nodeShared/src/mtrack/components/runFooter.vue`（`:3` 错误行 `role="alert"`；`:10-15` 按钮组；`:52-56` 范围提示；`:58-65` 状态行） | 按钮 =「保存」「生成视频」「本镜结束后暂停」（运行中）「继续 / 重试」（暂停后）「结束本批」（有批次时）；范围提示 =「从第 N 镜头生成至最后 / 生成 M 个 · 保存不会启动生成」；状态行 =「生成中…/ 有未保存的修改 / 准备就绪」，批次进度消息优先 |
| 「项目与成片」浮窗 `resultsOverlay` | `packages/nodeShared/src/mtrack/components/resultsOverlay.vue` + `versionMenu.vue`；编辑器挂载在 `multitrackEditor.vue` 模板 `resultsOverlay` 标签（**仅画布卡片宿主（传 `nodeId`）渲染**） | teleport 到画布世界层 `.vue-flow__transformationpane`（`:147`，根元素 `nopan nozoom` `:5`），随画布缩放平移；标题栏拖动、右下缩放、收起（高 70）/展开；头部「镜头编辑」按钮把视口聚焦回编辑器（`focusEditor`）。内容 = 保存方式说明行 + 大预览 video（`@ended` 推进下一段，见下）+ 片段播放条（上一段/下一段/「选择预览片段」下拉/「打开视频」/「顺序连播已完成片段」checkbox 默认勾选/位置指示 `N / M · 标题`）+ 逐镜版本菜单（「用于合并」勾选 = `generated⇄accepted` 切换，宿主 `toggleClipAccept`；「设为默认」走 `setDefaultVersion`；**版本可删**——每组每行「删除」按钮（`title="永久删除这个版本"`）+ 组头「全部删除」按钮（`title="永久删除本镜全部版本"`），组头在 `stale` 时显示「待更新」徽标；`deleteVersion`/`deleteAllVersions` 两个事件由 `resultsOverlay.vue` 原样转发给编辑器，编辑器再调 `deleteClipVersion`/`deleteAllClipVersions`，判据见 §15.9·6）；浮窗拿 `states`（`clipStates` 派生）给每组算 stale；取不到变换层时降级不渲染并 console.warn。几何经 `geometry` 事件写回 `node.data.resultsUi`（宿主 `packages/nodes/multitrackNode/src/index.vue` 的 `resultsUi` 读 / `onResultsUiChange` 写，随画布 JSON 持久化；缺省 = 节点右缘外 64px、1360×1480，宽夹 540–2400、高夹 540–2200） |
| 单镜「历史版本」下拉 +「设为默认」+「删除版本」 | `components/statusPanel.vue`（`versionRow`/`versionActions`，在工作台「生成结果 · 校验」折叠区内）；数据来自 `mtrackProject.ts` 的 `clipVersions` | **版本行随选中镜渲染；删除按钮组在 `versionOptions.length > 0` 时渲染；「设为默认」按钮组只列非默认版本**。列表按 `attempts` 旧→新、按**产物路径**去重（`key = attempt.assetPath || attempt.nodeId`）；`key === clip.assetPath` 那版文案追加「· 默认」——正常刚生成完时它是最末项，**切到旧版本后默认标记落在中间那一项，列表顺序不变**；`clip.assetPath` 不在 attempts 时补到末尾；无成片时提示「尚未生成视频（无结果文件）。」选项「版本 N · <文件 basename>」，选中即预览（条目自带 `assetPath` 直接取文件，旧工程只有 nodeId 的条目才经编辑器 `acquireNodeVideo` 反查 `outputs.video.value.url`）。「设为默认」按钮经 `setDefaultVersion` 只写 `clip.nodeId`/`assetPath`——**不改 `status`、不追加 `attempts`**；该镜 `generating` 时禁用。`stale && clip.assetPath` 时显示黄条「当前成片已落后于最新设置，建议重新生成」（点击提示「重新生成会追加一个新版本，旧版本保留」，判据见 §15.9·5）。**删除入口**：「删除当前版本」（emit `deleteVersion` 当前选中版本）与「删除全部版本」（emit `deleteAllVersions`），`versionOptions.length === 0` 或该镜 `generating` 时禁用——两者均**不弹确认**的直删语义见 §15.9·6（整镜删除在编辑器侧弹确认） |

### 15.2 点下去之后发生了什么（链路）

1. 本地前置校验（不发请求）：范围空 → 「请先选择要生成的分镜」；范围内无可生成镜头 → 「选段内没有可生成的分镜，可勾选「包含已生成」后再试」；无工作目录 → 「当前没有工作目录，无法发起生成」；工程没选视频模型 → 「工程没有指定视频模型，请在快捷设置里选择后再发起生成」（均在 `packages/nodeShared/src/mtrack/multitrackEditor.vue` 的 `pickDispatchTargets`/`launchDispatch`；「生成视频」按钮入口 `generateFromRange` 把「生成范围」两个数字换算成镜单后走 `startBatch` 同一条链）。
2. 取画布上下文：先 `inject("agentCanvas")`、回落 `inject("canvas")`（`multitrackEditor.vue` 的 `readBridge`/`acquireBridge`，最多短轮询约 2 秒）。取不到 → 「未取到画布上下文：请先打开画布并等待加载完成，再回到多轨界面发起生成」。**为什么需要 `agentCanvas`**：多轨在文档面板内时画布面板不 active，而 `getCanvasContext()` 只在 active 时返回值（`apps/web/src/pages/workspace/panels/canvas/canvasHost.vue`）；宿主为此另给了一条不判 active 的入口 `getAgentCanvasContext`（同文件，经 `provide("agentCanvas", …)` 暴露给面板树，见 `apps/web/src/pages/workspace/index.vue`）。
3. **编辑器逐镜组装请求交给服务端媒体通道，不经过对话模型**（`packages/nodeShared/src/mtrack/mediaDispatch.ts` 的 `composeClipRequest` + `mediaTask.ts` 的 `submitClipTask`/`waitClipTask`）。链路逐镜串行：读画布桥只为**取参考素材路径**（`resolveReferenceSources` 按 `referenceIds` 顺序反查资产节点产出，`{{ref N}}` 按 dataType 换算成 `<Picture N>`/`<Video N>`/`<Audio N>`）→ `buildPromptText` 拼「全片风格/全片约束」前缀、补段首、拼两个声音段名（正文原样透传；六段由写作者写在正文里，§四）→ `POST /api/ai/media/generate`（带自生成 `taskId`，服务端后台跑供应商任务）→ 4 秒一轮 `tasks/status` 轮询到终态（单镜上限 1 小时）→ 产物 path 作 `assetPath`。续接（`continuity: "context"`）时带 `continueFrom` = 上一镜成功尝试的供应商任务号，不静默降级。
4. 回写：`multitrackEditor.vue` 的 `writeClipRun` 在每次状态变化时直接改内存工程并推进 `dirtyVersion`（800ms 防抖写盘），所以 `clip.status`/`nodeId`/`assetPath` 与 `attempts` 都实时落盘——成功那条 attempt 一并写 `assetPath`（历史版本的身份，见 §15.9），`attempts[].error` 记 `batch:<uuid> task:<taskId>`（发起/成功/失败同一批次号，失败为 `batch:<uuid> <原文>`），取消记 `status:"cancelled"`。**这条链路不再有 agent 参与，`node:dispatchGenerate` 与界面「生成视频」是同一实现（共用 `launchDispatch`）**。
5. 取消（footer「结束本批」= `cancelBatch`）：`launchCancel` 先 abort 本地轮询，再对在跑任务发 `tasks/cancel`，把批次内 `generating` 的镜回写 `pending` + `attempts` 追加 `cancelled`。
6. 提示文案：成功后「批次 <前 8 位> 已开始生成，跳过 N 段（如有）；逐镜进度见页签状态与「逐镜面板」」（`multitrackEditor.vue` 的 `startBatch`）。

### 15.3 用户话术（照说即可）

```text
请在多轨工作台的高级设置里把「生成范围」设为从第 3 个镜头开始、生成 5 个（或 -1 到最后），
勾掉不需要的已生成镜就保持「包含已生成」不勾，然后点底部「生成视频」。
批次号会显示在提示里；footer 状态行跟着显示批次进度；中途要停就点「本镜结束后暂停」，
整批中止点「结束本批」。
```

- 点完「生成视频」编辑器就开始逐镜生成，**全程不经过对话模型、不产生 chat/completions 调用**；生成走服务端媒体任务通道，画布只提供在「项目与成片」浮窗里接线/装配用的参考素材路径。
- 想只跑一部分镜：改「生成范围」的两个数字（起始镜 + 镜数，`-1` = 到最后）；页签条上 `Ctrl`/`⌘`/`Shift` 多选保留给批量调整与逐镜面板预填。
- 想在对话里跑同一批：直接报「按 S003–S007 批量生成」，agent 走 §十三（那条路径才会用对话模型编排）。
- 两条路径的纪律一致，`batchId` 是唯一归属键：界面入口写的是同一份 `attempts` 记录，agent 之后读 `mtrackRead` 能看到同一批次号。
- 要**换一版**（旧版本保留）：单镜点「重新生成本镜」，或勾「包含已生成」后按范围生成/逐镜面板重派——都是追加新版本，不是覆盖（§15.9）。
- 要**切回旧版本**：在工作台「生成结果 · 校验」折叠区的版本下拉选中旧版本预览，点对应「版本 N」设为默认；或在「项目与成片」浮窗的逐镜版本菜单里「设为默认」，再重新点「合成成片」（`accepted` 不用改，合成取当前默认版本的 `assetPath`）。

### 15.4 批量面板（`batchPanel.vue`）

入口：高级设置「生成范围」区的「逐镜面板…」（`packages/nodeShared/src/mtrack/multitrackEditor.vue` 模板 `sectionAdvanced` 区，置 `batchPanelVisible`）→ 弹窗标题「批量生成」（`components/batchPanel.vue:5`）。面板与 footer「生成视频」是同一条直连链路（共用编辑器 `launchDispatch`），**同样不经对话模型**；面板打开时用页签多选段预填范围（`batchPanel.vue` 的 `prefill`），三档预设「全片」「当前选段」「从起始镜到最后一镜」只改数字。

| 控件 | 文案（与代码逐字一致） | 语义 |
|---|---|---|
| 起始分镜 | 「起始分镜」（`batchPanel.vue:16`，1 起、上限 `clips.length`） | 1 基镜号；预设「全片」= 从第 1 镜起 |
| 生成镜数 | 「生成镜数」（`batchPanel.vue:20`，最小 `-1`、上限 `clips.length`） | **`-1` = 从起始镜一直生成到最后一镜**；其余为镜数；预设按钮「全片」「当前选段」「从起始镜到最后一镜」（`:23-26`） |
| 包含已生成 | 「包含已生成」（`batchPanel.vue:29`） | 与高级设置里同名复选框同一状态（编辑器 `includeFinished`）：勾上才把 `generated`/`accepted` 一并纳入范围 |
| 开始生成 | 「开始生成」（`batchPanel.vue:35`） | 按 `rangeClips` + `includeFinished` 发起，等价 `node:dispatchGenerate`，立即返回 `batchId` |
| 本镜结束后暂停 | 「本镜结束后暂停」（`batchPanel.vue:36`，仅运行中可见） | 只停派下一镜：当前镜跑完才停，**暂停不产生半截视频** |
| 继续生成 | 「继续生成」（`batchPanel.vue:37`，仅暂停后可见） | 只重派 `pending`/`failed` 的剩余镜，**沿用同一 `batchId`**（同一镜会有两轮 `generating`，见 `batchPanel.vue:212`） |
| 整批取消 | 「整批取消」（`batchPanel.vue:38`，`batchId` 非空才出现） | 等价 `node:cancelBatch`：abort 本地轮询 + 对在跑任务发 `tasks/cancel`，成功即回写 `pending` + `attempts` 追加 `cancelled` |
| 刷新状态 | 「刷新状态」（`batchPanel.vue:40`） | 断点续跑对账（§15.5） |
| 重试 | 表格每行「重试」（`batchPanel.vue:56`，运行/暂停时禁用） | 单镜重新派工 |

- 进度文案（`batchPanel.vue:195-206`）：「正在生成第 N/M 镜 · 已完成 x 镜」；「已在镜头间暂停，已完成 x/M 镜；点「继续生成」接着跑。」；「本批已结束：成功 x 镜，共 M 镜。」；表格列为「镜号 / 标题 / 状态 / 耗时 / 错误 / 操作」。footer 状态行的批次消息（编辑器 `batchMessage`）与之同源。
- 汇报纪律：进度按 `batchId` 认，`node:getStatus.batchClipIds` 与 `planOperator mtrackRead` 的 `attempts` 都能看到同一批次号；**同一批镜头不要再叠加 §十三 逐镜生成**，否则双份算力、双重回写。

### 15.5 重启或重挂后的对账：`generating` 不是可信终态

生成循环挂在编辑器实例上：进程重启、画布重开、节点卸载都会让循环消失，工程里却还停在 `generating`。**看到 `generating` 先判断它是不是本实例在跑**——不是就不要当「还在生成」汇报，也不要当 `failed` 处理，先对账。

- 入口：高级设置行的「刷新状态」（`multitrackEditor.vue` 模板 `sectionAdvanced` 区）或逐镜面板「刷新状态」（`batchPanel.vue:40`）；编辑器打开时也会自动对账一轮（`reconcileFromPanel` → `reconcileGenerating`）。处理「`status==="generating"` 且不属于本实例在跑批次」的镜头，不改在跑批次。两类都在范围内：① 旧画布节点派工的遗留镜（有 `nodeId`，按节点实况对账）；② 媒体任务通道的镜（`nodeId` 为 `null`，按 `attempts` 里的 `task:<uuid>` 查服务端任务表）。服务端结算结果现在会落盘并在内存保留 24 小时（`apps/server/src/utils/media/tasks.ts`），因此关页/重启后回来仍能拿回成片路径，不会因为一次 404 就把已付费的成片丢掉。
- 判定与回写（`directDispatch.ts` 的 `readClipGeneration`）：

| 节点实况 | 回写 | 备注 |
|---|---|---|
| `succeeded` 且有视频路径 | `generated` + `assetPath` | `attempts` 追加 `error: "对账恢复"` |
| `failed`，或节点已从画布删除 | `failed` | 原文「画布上的视频节点已不存在，该镜需要重新生成」或节点自己的报错 |
| `idle` 且**有产物** | `generated` + `assetPath` | 真·进程重启后任务没了但产物还在：补成 `generated`，不丢已有产出 |
| `idle` 且**零产物** | `pending` | 「重启后未在节点上找到生成产物，已退回待生成」（`directDispatch.ts` 的 `readClipGeneration` 返回 `outcome: "pending"`）；`attempts` 记 `error: "重启后回退"`，用户可重新派工 |
| `running` | 不动 | 下一轮再看 |
| 查询本身失败（画布重挂/工具不可用） | 整轮跳过、一条都不写 | 「画布暂不可用，未能对账，请稍后重试」（编辑器 `throwCanvasUnavailable`） |

- 结果提示（`reconcileFromPanel`）：「已对账 N 镜：恢复 x，失败 y」，或「没有需要恢复的镜头」。
- 纪律：对账只读，**绝不把「查不出来」写成 `failed`**（会误伤还在跑的生成）；对账后仍停在 `generating` 的镜头才值得继续轮询。
- 派工互斥只在单个编辑器实例内（`multitrackEditor.vue` 的 `dispatching` 守卫）+ 落盘 CAS，**跨节点/跨窗口没有工作区级锁**：同一个 `.mtrack` 工程不要同时打开在两个多轨节点或两个窗口里派工，否则可能对同一镜重复提交、双份计费。需要并发时，先在其中一个编辑器里停止派工再切到另一个。

### 15.6 合成成片（界面按钮 + `POST /api/mtrack/composite`）

**前置条件（最容易搞错）**：只有 `status === "accepted"` 的镜头进合成。界面按钮可用条件是 `hasAccepted`（编辑器 `multitrackEditor.vue` 的高级设置「合成成片」按钮 `:disabled="!hasAccepted || compositeBusy"`）——一个 accepted 都没有时按钮直接禁用，服务端也会报「没有 accepted 片段可合成：请先在多轨编辑器里把要合成的片段验收为 accepted」（`packages/tools/planOperator/src/composite.ts:182`）。`generated` 只表示视频落地，**不参与合成**；验收入口有两处：镜头操作 details 的「验收」/「取消验收」（`shotEditorPane.vue:13-20`），以及「项目与成片」浮窗逐镜版本菜单的「用于合并」勾选（`versionMenu.vue:10-11`，宿主 `toggleClipAccept`，同一段 `generated⇄accepted` 切换守卫）。

- 合成按 `clip.assetPath` 取文件，也就是该镜**当前默认版本**：在工作台「生成结果 · 校验」折叠区或「项目与成片」浮窗把旧版本「设为默认」后重新合成即用旧版本文件，`status` 仍是 `accepted`、不需要重新验收（版本机制见 §15.9）。

流程（`multitrackEditor.vue` 的 `handleComposite`，`:939-961`）：

1. 点「合成成片」→ 先发 `execute:false`：只校验并写清单 `plan/composite.json`（`executed:false`），返回 `{ segments, output, specWarnings, … }`；
2. 二次确认弹窗「将合成 N 段，输出到 plan/composite.mp4」，按钮「开始合成」/「取消」；
3. 确认后发 `execute:true`：宿主 ffmpeg 逐段 `input` + `concat` 出成片，成功后把清单改写为 `executed:true`；
4. 提示「已合成 N 段：plan/composite.mp4」；画布节点侧用 `node:refreshOutput` 重读清单，把成片挂到 `video` 输出端口。

接口（`apps/server/src/routes/mtrack/composite.ts:11-16`、`:46-88`）：

```text
POST /api/mtrack/composite
body: { directory: string, sourcePath?: string, execute?: boolean = false, compositeOutputPath?: string = "plan/composite.mp4" }
data: { manifestPath: "plan/composite.json", source, output, executed, segments, specWarnings[], result? }
```

- 权限同其他 app 接口（同源 Origin/Referer + `x-toonflow-workspace: 1`）；`directory` 是工作目录绝对路径，`sourcePath` 缺省 `plan/story.mtrack`，`compositeOutputPath` 缺省 `plan/composite.mp4`。
- 拒绝条件（服务端原文透出）：`合成输出已存在：<path>。不自动覆盖，请换一个输出路径或确认后手动删除该文件`、`合成输出目录不存在：<dir>。请先创建目录再合成`、`没有 accepted 片段可合成：…`、`合成清单顺序不连续（V14）：…。断点需在多轨文件里补齐或去掉空洞后再合成`、`合成片段文件不可读，无法合成：…。assetPath 必须指向真实可读的产出文件`、`合成片段规格不一致，concat 会失败或产出错乱成片：<首段> 为 <规格>，<该段> 为 <规格>。请先生成同规格片段再合成`、`探测不到视频流：…`。
- 两档规格检查（`composite.ts` 的 `verifySegmentSpecs`，`:127-148`）：**编码前逐段 ffprobe 实测**——分辨率/帧率/像素格式等与首段不一致直接 throw（挡住编码，避免白跑一遍长编码）；只有「工程声明 `seconds` 与实测时长相差超过 1s」记进 `specWarnings`、不阻断（`composite.ts:139-145`），交人工核对工程声明。`specWarnings` 随响应返回，`execute:true` 时是两层的并集（`apps/server/src/routes/mtrack/composite.ts:75`）：声明层 `checkSpecs`（`composite.ts:74-87`，`ratio`/`resolution` 与首段不一致的告警）与实测层 `verifySegmentSpecs`（`composite.ts:139-145`，声明 `seconds` 与实测时长差 > 1s）。
- 与工具的关系：`planOperator { action: "composite", execute: true }` 与本路由共用 `packages/tools/planOperator/src/compositeRun.ts` 的 `concatComposite`（清单判定共用 `composite.ts` 的 `planComposite`），两条入口的路径、拒绝文案与 `plan/composite.json` 结构完全一致——agent 用工具、用户点按钮，结果可互换。

### 15.7 九宫格拆图 → 自动建多轨工程（图片节点「宫格切分」面板）

> 入口不是多轨编辑器：是**图片节点**的宫格切分面板（`packages/nodes/imageNode/src/components/imageGridSplit.vue:137-169` 的 `writeSplitProject`，面板本体在同文件 template 的「宫格切分」弹层）。用户在图片节点上选 2×2～5×5（或自定义行列，每轴 1–10、总量需 >1）点「切分为图片节点」，除了逐格建 `remote-imageNode` 图片节点之外，还会**独占写**出两份计划文件，直接得到一个可派工的多轨工程。
>
> **Agent 等价入口**：`node:splitGrid`（`packages/nodes/imageNode/src/index.vue:153-181`，图片节点的节点函数）。参数 `{ rows, columns }` 各 1–10 且乘积 >1，语义与面板按钮完全一致（复用 `imageGridSplit.vue` 的 `splitGrid(rows, columns, src, signal)`，同一套切图/落盘/拒绝覆盖逻辑），返回 `{ tiles: [{ nodeId, cardId, path }], projectPath, assetIndexPath }`。节点没有图片时报「节点没有图片，无法切分」；节点不在视口内也能调（内部自行读工作区图片生成 objectURL 并在结束后 revoke）。所以「先有图片节点、再要一个可派工的多轨工程」这条链，agent 不必等用户点面板。

写什么（与 `mtrackProject.ts` 的 `createClip`/`ratioOptions` 同源，逐字段核对过）：

| 产物 | 内容 |
|---|---|
| `plan/assetIndex.json` | 每格一张卡：`id` 形如 `C01`（从左到右、逐行递增），`name` 取该格图片节点 label（`<原图label> · 行-列`），`textOnly: false`，**`nodeId` 取该格 `remote-imageNode` 真实节点 id**（切图不分类别，不写 `kind`；`version: "assetIndex-v1"`） |
| `plan/story.mtrack` | 每格一镜：`clipId` 从 `S001` 顺排、`seconds=5`、`ratio=9:16`（面板没有比例设置，统一竖屏，取 `ratioOptions[0]`）、`resolution=768P`、`generateAudio=false`；`continuity` 首镜 `start` 其余 `cut`、`status: "pending"`、`nodeId: null`、`attempts: []`；**`referenceIds` 只指向该格对应卡片 id**（第 1 格 → C01）。工程 `global.ratio=9:16` |

纪律：

1. **不覆盖已有计划文件**：`defaultProjectPath`（`plan/story.mtrack`）或 `assetIndexPath`（`plan/assetIndex.json`）任一已存在就整体拒绝，报「**`<path> 已存在，未覆盖`**」（`imageGridSplit.vue` 的 `requireNewPlanFiles` 与 `writeExclusive`），不追加也不合并——想续用先手动改名或换目录，别指望它合并。
2. **写失败不留半截现场**：先写索引、再写工程；工程写失败会把刚建的索引删掉再抛错（`imageGridSplit.vue:162-168`），重试是干净的。
3. **只建工程，不派工**：切分完成只落文件 + 弹「已切分为 N 个图片节点，并创建多轨工程 plan/story.mtrack 与资产索引 plan/assetIndex.json」，**不会**自动生成任何视频；后续生成走 §十五界面选段或 §十三 agent 编排。
4. 每镜空提示词（`createClip` 的三字段都是空串）、镜切分没有分镜语义，用户要在编辑器里逐镜补提示词与标题，再按 §〇 准入条件上场。

**该工程没有 `plan/assetReport.json`（这是切图工程与手工工程最大的口径差）**：

- 切分只写索引与工程，**不产出** `plan/assetReport.json`（校验报告是 `planOperator build` 等动作的落盘物）。
- agent 侧/界面口径：`multitrackEditor.vue` 的 `runLoadReport`（`:734-761`）把「报告与索引各读各的」解耦了——**索引是必需的**（缺了参考网格为空），**报告缺失按空处理**（`isMissingFile` 分支：`ENOENT` 时不记错误、`report.value = undefined`）。因此 `statusPanel.vue:42` 的校验发现栏会显示「**未读取到 plan/assetReport.json**」而**不是**「未发现明显问题」——后者只有报告真实存在且 finding 为空时才出现。看到「未读取到」别当成「校验通过」。也不是错误：它只说明这份工程还没跑过校验落盘。
- **需要校验时应先补齐报告**：跑 `planOperator { action: "build", … }`（或先 `validate` 清零再 `build`）产出 `plan/assetReport.json` 后，界面「校验」按钮重读，才进入正常的「错误 N · 警告 N / 未发现明显问题」显示。

### 15.8 整理本镜提示词（模型整理草稿 → 人工核对 → 勾选采用）

> 入口在**镜头操作 details**（02 镜头内容区的「镜头操作」折叠面板，`packages/nodeShared/src/mtrack/components/shotEditorPane.vue` 的「整理本镜提示词」按钮，emit `rewrite`，由 `multitrackEditor.vue` 的 `rewriteClipPrompt` 接住）→ `POST /api/mtrack/rewriteShot`（`apps/server/src/routes/mtrack/rewriteShot.ts`）。只走文本模型，**不建节点、不提交视频、不写画布、不进批次**；返回的整理稿**不自动写回**，只进「待采用」区块，由用户在 `adoptRewrite` 里点「采用整理结果」后才替换 `prompt.integratedMultimodalDescription`（画面描述段），环境声与配乐原样保留。

**四条硬行为（这是本节的要点，与生成链路的纪律同等重要）**：

| # | 行为 | 具体规则 |
|---|---|---|
| 1 | **结果不自动采用** | 请求成功**不改工程**：整理稿进 02 镜头内容区的「待采用」区块（左原文只读、右整理结果可编辑），点「采用整理结果」才经 `onPatch` 写回画面描述；点「放弃」清空区块，原文一字不动。**任何路径都不自动覆盖原文**，界面提示只报「已整理，请核对后采用」这类文案，不报「已替换」 |
| 2 | **一致性守卫（`rewriteBasis`）** | 发请求时记下 `basis = { 原文画面描述, clip.seconds, 本次 rules }`；处于待采用状态时这三者任一变化（手改画面描述、改时长、改整理规则），「采用整理结果」禁用并提示「本镜原文、时长或整理规则已变化，请核对整理结果后重新整理」——必须重新整理，不能拿旧稿套新基线 |
| 3 | **生成中 409 拒绝** | 服务端在调模型前读 `plan/story.mtrack`（`apps/server/src/routes/mtrack/rewriteShot.ts:42-66` 的 `isGenerating`）：**任一 `clip.status === "generating"`**（本镜或本批别的镜）就返回 **HTTP 409** +「正在生成，请结束后再整理提示词，避免模型同时占显存」（`:72`，在解析模型之前，判定的是状态真源而不是某个浏览器里的批次号）；工程文件不存在或全无 `generating` 时放行。理由同 LSC：整理要额外加载一个文本模型，与视频生成抢显存。界面把 409 文案原样透出，不改成「整理失败」 |
| 4 | **规则可配置、默认内置** | 请求 `rules` 可选（≤20000 字符）：非空覆盖内置规则，空/缺省回落到服务端内置 `rewriteRules` 五条（只整理不新增剧情、保留画面事实、英文输出、不输出解释、`{{ref N}}` 参考标记原样保留）。界面的「整理规则」输入留空即「用服务端内置规则」。**规则是本次一次性指定，不落盘、不随工程保存、不进 `global`**——刷新编辑器即回内置，想固定口径就每次粘贴 |

**接口**（`apps/server/src/routes/mtrack/rewriteShot.ts`，`POST /api/mtrack/rewriteShot`）：

```text
body: {
  directory: string,
  providerId: string, modelId: string,     // 文本模型；界面自动取第一个可用文本模型
  prompt: { integratedMultimodalDescription, overallSoundscape, nonDiegeticMusic },  // 三段至少一段非空，否则报「请先填写本镜提示词再整理」（:23-24）
  referenceIds?: string[],                 // ≤9（多轨界面勾选上限 4），只决定送进引擎的参考顺序；正文里用 `{{ref N}}` 按位次指代，引擎不代写参考顺序声明
  rules?: string                           // 可选，≤20000（:22）；空/缺省用内置 rewriteRules（:88）
}
success data: { text: string, requiresReview: true }   // :100
409 → 正在生成，请结束后再整理提示词，避免模型同时占显存        // :72
409 → 多轨工程内容无法解析，请先在多轨编辑器中重新保存 plan/story.mtrack   // :61
```

- **第二种 409 不是「生成中」**：`plan/story.mtrack` 读得到但 JSON 解析失败时也回 409（`:61`），提示先重新保存工程。看到这句就修工程，不要当成模型报错重试。
- **`requiresReview: true` 是契约字段，不是提示文案**（`:99-100` 的注释即此意）：前端据此走待采用流程，不直接写回；看到它为 `true` 就当「草稿」处理。
- 内置 `rewriteRules`（`:27-35`）五条硬纪律：只整理不新增、保留全部画面事实与镜头语言、英文按「主体与动作 → 环境与空间 → 镜头与运动 → 光线与色彩 → 氛围」成一段、不输出解释/小标题/Markdown、`{{ref N}}` 参考标记原样保留。传了 `rules` 就整段替换它，不是追加。
- `rules` 只影响**整理**这一步，不参与视频生成的提示词拼装（生成只读 `clip.prompt` 三字段原文，六段由写作者写在正文里，§四）。
- 采用后仍要按 §四 复核：整理稿里的官方标记必须与本镜参考位次一致（V7）。整理稿里的 `{{ref N}}` 必须与本镜参考位次一致；改过 `referenceIds` 或连线就要重新核对并重新 `setPrompt`。
- 整理只做结构化改写，**不新增剧情、人物、道具**；需要加内容时先改原文再整理，别指望模型补。
- 该入口不进批次：整理不产生 `attempts`、不占 `batchId`、不改 `status`；生成中互斥只靠上面的 409，不要用它绕开「同一批镜头只走一条生成路径」（§十五·五）。

### 15.9 镜头视频版本机制（重新生成 = 新产物追加，可切回默认；版本可删、可判待更新）

> LSC 对齐：重新生成一镜**不覆盖**旧视频。编辑器直连链路（媒体任务通道）每次成功生成都把新的产物文件路径写进 `clip.assetPath`，旧文件留在磁盘（产物目录 `assets/<clipId>/`）；工程里的 `attempts` 历史就是版本台账，`clip.nodeId`/`assetPath` 始终指向**当前默认版本**。
> **版本身份 = 产物文件路径**（对齐 LSC 的 `resultVersions` 按 `file.url` 去重），不再依赖画布 nodeId——媒体任务通道不建画布节点（attempts 的 `nodeId` 恒为 `null`），它生成的成片**现在同样出现在历史版本里**。
> **本轮已补齐 LSC 的两项版本能力**：`clipStates(project)` 的**待更新（stale）派生**（§15.9·5）与**删除版本**（单版本 + 整镜全部，§15.9·6）。历史版本不再是「只读、只切」——它是可判新鲜度、可永久删除的磁盘产物台账。

**1. 谁决定版本落点（直连链路的 `writeClipRun`）**

| 判定点 | 现行为 | 说明 |
|---|---|---|
| 每次生成的产物 | `mediaTask.ts` 轮询到 `succeeded` 后取 `files[0].path`（服务端按 `outputDirectory = assets/<clipId>` 落盘的新文件） | **不复用、不覆盖旧文件**——这就是「追加版本」而不是「覆盖」的关键；文件名带随机后缀，路径天然唯一，正是版本身份 |
| `clip.nodeId` | 新通道不建画布节点，`writeClipRun` 把 `nodeId` 写成 `null`（旧工程里画布节点版次的 nodeId 仍保留在历史 attempts 里） | 「设为默认/预览反查」只有这条条目没有 `assetPath` 时，才拿它走画布桥 |
| 版本身份 | `attempt.assetPath`（本次尝试的产物路径），旧工程的 attempt 只有 nodeId 时回退用 `nodeId` | 对齐 LSC 的 `resultVersions`（按 `file.url` 去重）；`writeClipRun` 在 `attempt.status === "succeeded"` 且本次 patch 带 `assetPath` 时自动把产物路径写进这条 attempt，调用点无需再传字段 |
| 版本列表 | `mtrackProject.ts` 的 `clipVersions(clip)` 返回 `ClipVersion[]`：`attempts` 里 `succeeded` 的记录按 `key = attempt.assetPath || attempt.nodeId` 去重、旧→新；末尾若 `clip.assetPath` 不在列表里则补一条 | 媒体任务通道的新版次也在列表里（这是本次修复的核心）；每条 attempt 仍留痕（`error` 带 `batch:<uuid> task:<taskId>` 与 `jobId`） |
| 版本签名簿记 | 成功那条 attempt 还写 `signature` / `index` / `parentJobId` 三个字段（`writeClipRun` 在 `attempt.status === "succeeded"` 分支写：`signature = clipStates(current)[clipId]?.signature ?? ""`、`index = clipIndex`、`parentJobId = continuationJobId(current.clips[clipIndex - 1])`，`continuationJobId(clip)` = 上一镜最后一条带 `jobId` 的 `succeeded` attempt 的 `jobId`） | 记录的是**落盘那一刻**的参数签名、时间线位置与续接来源，供 §15.9·5 的 stale 判定逐字段比对 |

- 生成成功时 `multitrackEditor.vue` 的 `writeClipRun` 把 `status` 写成 `generated`、`assetPath` 换成新产物，并追加一条 `succeeded` 的 `attempts`（带 `jobId`——下一镜 `context` 续接靠它；带 `assetPath`——版本身份；带 `signature`/`index`/`parentJobId`——版本签名簿记）。**新产物自动成为该镜默认**，不需要额外确认。
- 旧版「为每镜在画布上新建视频节点」的 `directDispatch.ts` `ensureNode`/`findClipNodeId` 已退出界面链路（编辑器不再调它），仅作为旧工程节点版次的历史背景存在。

**2. 三个入口，含义相同**（都是追加新版次，不是覆盖）

| 入口 | 位置 | 备注 |
|---|---|---|
| 单镜「重新生成本镜」 | 镜头操作 details（`packages/nodeShared/src/mtrack/components/shotEditorPane.vue:22`，该镜 `generating` 时禁用）→ `multitrackEditor.vue` 的 `regenerateClip` | 强制 `includeFinished: true`，已生成/已验收的镜直接重跑 |
| 批量「包含已生成」 | 高级设置「生成范围」复选框（`multitrackEditor.vue` 模板 `sectionAdvanced` 区）、逐镜面板「包含已生成」（`packages/nodeShared/src/mtrack/components/batchPanel.vue:29`） | 勾上才把 `generated`/`accepted` 纳入派工；被纳入的已生成镜同样追加新版次 |
| `node:retryClip` | `packages/nodes/multitrackNode` 的节点函数（薄代理 `multitrackEditor.vue` 的 `retryClip`） | 单镜重派，同样强制纳入已完成镜；`dispatching`/在跑批次时**直接抛错**，不返回成功快照 |

**3. 版本 UI**：控件位置见 §15.1 表的「历史版本」行与「项目与成片」浮窗行，口径如下。

- 列表**旧版本在上、新版本在下**（`statusPanel.vue` 的 `versionOptions` 按 `attempts` 序），每项 label 是「版本 N · <文件 basename>」，键是 `entry.key`（产物路径）。当前默认是 `key === clip.assetPath` 那一项，文案带「 · 默认」：正常刚生成完时它是最末项，**切到旧版本后默认标记落在中间项、顺序不变**；`clip.assetPath` 不在 attempts 中时补到末尾，保证当前默认始终可选。媒体任务通道的新版次同样在列表里（见上表）。无成片时 `statusPanel` 显示「尚未生成视频（无结果文件）」，浮窗 `versionMenu` 的组内空态走组件自带的 `versionEmpty` 占位（`versionMenu.vue:25`）。
- 下拉可预览任意版本：条目自带 `assetPath` 时直接取该文件；旧工程只有 nodeId 的条目才经 `multitrackEditor.vue` 的 `acquireNodeVideo` 按 nodeId 读该节点 `outputs.video.value.url`。快速连点会用 `previewJob` 丢弃过期结果。
- **待更新提示**：工作台 `statusPanel` 在 `stale && clip?.assetPath` 时显示黄条「当前成片已落后于最新设置，建议重新生成」，点击弹 `ElMessage.warning("重新生成会追加一个新版本，旧版本保留")`；浮窗 `versionMenu` 的组头在 `stale` 时显示「待更新」徽标。判据见 §15.9·5。
- **删除版本**：`statusPanel` 的 `versionActions` 两个按钮——「删除当前版本」（`emit('deleteVersion', activeVersion)`）与「删除全部版本」（`emit('deleteAllVersions')`），`versionOptions.length === 0` 或该镜 `generating` 时禁用；浮窗 `versionMenu` 每组每行一个「删除」按钮（`title="永久删除这个版本"`，`emit('deleteVersion', item.key)`），组头一个「全部删除」按钮（`title="永久删除本镜全部版本"`）。两处都向编辑器发事件，实际删除在 §15.9·6。
- 「设为默认」= 编辑器 `setDefaultVersion(version)`（version 就是产物路径）经 `onPatch` **只写 `{ nodeId, assetPath }`**：不改 `status`、不改 `attempts`、不追加记录——切换不是一次生成尝试。只有没有 `assetPath` 的旧版次会先经画布桥反查节点产物，反查不到就报错不写（「读取画布节点失败」「该版本没有视频产物」）；`await` 期间用户换了选中镜也会放弃写入（避免写到另一条镜上）。成功提示显示文件名。
- 该镜 `generating` 时「设为默认」与两个删除按钮全部禁用（`statusPanel.vue` 的 `defaultLocked` 与各按钮的 `clip?.status === 'generating'` 判断；浮窗 `versionMenu` 经宿主同样守卫）：产物还在写，切了会和回写抢同一份工程。

**4. 合成口径**：合成清单只收 `status === "accepted"` 的镜，取的是 `clip.assetPath`——即**该镜当前默认版本**。所以切回旧版本后重新合成就会用旧版本文件，`status` 仍是 `accepted`，不需要重新验收（流程见 §15.6）。

- **验收不跨版本保留**：重新生成已验收的镜，发起时就把 `status` 打回 `generating`，成功后落 `generated`——新版本要再验收一次才回到合成清单。「设为默认」是唯一不改 `status` 的切换路径（§15.9·3）。

**5. 待更新（stale）派生：`clipStates`**

`mtrackProject.ts` 的 `clipStates(project)` 返回 `Record<clipId, ClipState>`，一份派生给工作台与「项目与成片」浮窗共用（编辑器 `states` computed），**不需要各自遍历**。`ClipState = { signature, recordSignature, recordIndex, recordParentJobId, stale }`。

| 字段 | 怎么来 |
|---|---|
| `signature` | 键排序 JSON 规范化串（`stableJson`，**不用哈希、零依赖**）。内容 = 项目级 `global{ratio, style, systemPrompt, model}` + 本镜 `{clipId, title, seconds, ratio, resolution, generateAudio, prompt, continuity, mode, systemPromptOverride}` + `referenceIds` + （`continuity === "context"` 时上一镜的 `signature` 作续接链，否则空串） |
| `recordSignature` / `recordIndex` | 取自该镜 `attempts` 里**最后一条 `succeeded`** 记录落盘时的 `ClipAttempt.signature` / `ClipAttempt.index`（`writeClipRun` 在成功分支写入，见 §15.9·1）；无记录时 `recordSignature` 为空串、`recordIndex` 为 `null` |
| `recordParentJobId` | 同一条记录的 `ClipAttempt.parentJobId`（该镜生成时上一镜的 `continuationJobId`；独立镜为空串） |
| `stale` | 恒从 `false` 起算，**只有 `clip.assetPath && attempt?.signature` 同时成立时才可能为 `true`**，且三条件任一命中：`recordSignature != signature`（参数变了）／`recordIndex != 当前时间线位置`（镜头挪过序）／（`continuity === "context"` 且 `recordParentJobId != 上一镜当前 continuationJobId`，即续接来源变了） |

- 对齐 LSC 的 `signatures()` / `public()` 判定：`record['signature'] != current[s['id']] or record['index'] != index or not context_ok(...)`，三个条件逐一对应。
- **已知限制（写明）**：签名只覆盖**参考集合的增删改序**，覆盖不到参考素材内容变更——同一个 `referenceId` 指向的资产卡**重画**（内容变了但 id 不变）检测不到，`stale` 仍为 `false`。另外，旧工程的 `succeeded` 记录没有 `signature` 字段，一律视为**不 stale**（无从比对）；没有成片（`clip.assetPath` 为空）时 `stale` 恒 `false`。

**6. 删除版本**

编辑器提供两种删除：**单版本**与**整镜全部版本**，都落在 `mtrackProject.ts` 的两个纯函数上，编辑器只做「调函数 → 删物理文件 → 回写工程」三步。

| 入口 | 内核 | 确认 |
|---|---|---|
| 单版本删除 | `deleteClipVersion(clip, key)` → `{ clip, paths }`：从 `clipVersions(clip)` 找 `key`，过滤掉 `attempts` 里 `status === "succeeded"` 且键相同的记录；删的不是当前默认时只清 attempts，当前默认（`clip.assetPath`/`clip.nodeId`）不动；删掉的就是当前默认时，默认**回落到剩余版本里最新的一条**（`succeededVersionEntries` 的末项），全删光则回落为 `null` | **不弹确认**（对齐 LSC：`scope === "version"` 直接 `delete`） |
| 整镜全部版本删除 | `deleteAllClipVersions(clip)` → `{ clip, paths }`：清掉全部 `succeeded` 的 attempts，`assetPath`/`nodeId` 归 `null` | 走 `ElMessageBox.confirm`，danger 按钮；标题 `永久删除「<镜头标题>」的全部版本？`（无标题时用 `clipId`），正文 `将永久删除 N 个视频版本，不可撤销。镜头脚本与其他镜头保留；依赖被删版本的续接镜头需要重新生成。`（`N = clipVersions(clip).length`，为 0 时不弹窗直接返回） |

- **删物理文件**：`EditorFiles` 新增可选能力 `remove?(path: string): Promise<void>`，两个宿主都已实现——画布宿主 `WorkspaceFiles.remove`（`packages/nodes/multitrackNode`）、扩展宿主 `ExtFiles.remove`（`packages/ext/multitrack`）。**宿主不提供删除能力时只清记录、不报文件失败**；文件本身已不存在不算失败（按 `/404|not found|ENOENT|不存在/i` 判定，对齐磁盘上已经手删的情况）。
- **`generating` 时禁止删除**：`clip.status === "generating"` 直接 `ElMessage.warning("该镜头正在生成，请等生成结束再删除版本")` 并返回（对齐 LSC 的 `locked()` 检查）。
- **删除不改 `clip.status`**：生成状态与版本簿记是两回事——删掉全部版本后镜头仍是 `generated`/`accepted`，只是「当前默认」没了。对齐 LSC 的 `mergeDeletedResultDraft`（只更新结果簿记，不覆盖用户未保存的编辑字段）。
- 删除后走 `dirtyVersion += 1` 触发 800ms 防抖落盘；若 `await` 期间用户换了选中镜则放弃写回（避免写到另一条镜上）。成功提示三种：`已删除版本 <basename>，默认已回落到剩余版本` / `已删除版本 <basename>，该镜头已无成片` / `已删除 N 个视频版本`（有文件删失败时追加 `，有 M 个文件删除失败`）。
- 删的是画布节点版次（旧工程只有 `nodeId`、没有 `assetPath`）时，`paths` 为空——只清 attempts 记录，不动画布节点本身（本轮不提供删除画布节点的能力）。
- **连播中删除版本不中断播放**：连播只看 `previewVersion` 指向的条目存在与否（与 `previewJob` 丢过期同口径），删除的是别的版本的条目时不影响当前播放；连播到该镜时若版本被删则按回落口径取默认版本继续播。

**7. Agent 侧口径**：

- 版本台账读 `planOperator mtrackRead` / `node:readClips` 的 `attempts`（`succeeded` 记录即历次版本，按 `assetPath` 去重；旧工程的尝试只有 nodeId 时回退按 nodeId），不必去画布上找节点名。
- 代切默认版本：`node:editProject` 的 `patch` 里 `nodeId`/`assetPath` 是**普通可写字段**，不属于 `accepted` 那种人工判定，agent 可以先 `readClips` 取某条 `succeeded` 记录的 `assetPath`（媒体任务通道的版本就是它；旧画布节点版次没有 `assetPath` 时才取该节点 `outputs.video.value.url`），再把 `nodeId`/`assetPath` 一起 patch 回去，与工程同一口径。只写其中一个会留下 `nodeId` 与 `assetPath` 不是同一版本的不一致工程。`planOperator mtrackUpdate` 同样收 `nodeId`/`assetPath`，但它的 `attempts` 是**整数组替换**（`packages/tools/planOperator/src/index.ts:107`）——切版本时别带 `attempts`，否则会把历史版本列表整条覆盖掉。
- **agent 不做删除版本**：`deleteClipVersion` / `deleteAllClipVersions` 是编辑器内的纯函数，`node:editProject` / `mtrackUpdate` 都没有「删一个版本」的 op——agent 要清版本只能整条替换 `attempts` 数组（会连带丢掉该版本记录的结构信息，且不删磁盘文件），不建议这么做。删除是用户在界面里的手动动作。
- **`stale` 是派生值，不落盘**：`ClipState` 由 `clipStates(project)` 实时算出，`attempts` 里存的只是落盘那一刻的 `signature`/`index`/`parentJobId` 三个簿记字段，工程 schema 不新增「stale」字段。
- 合成仍只认 `accepted`：`patch` 改得动「默认是哪一版」，改不动「哪条镜进成片」。
- agent 自己按 §十三 逐镜编排时按 §一 步 1.5 复用 `clip.nodeId`（不新建节点），界面「重新生成本镜/重派」入口则是媒体任务通道的新产物追加——两条路径的台账都写进同一份 `attempts`。

**8. 本轮不做（写明理由）**：

- **`result_mode` append/replace**：LSC 里它只影响「把结果挂到画布节点」这个动作（append 新建画布节点、replace 复用旧节点）。Toonflow 的服务端媒体任务通道**不建画布结果节点**，没有对应的挂接动作——做它等于留一个假开关，UI 上能选、行为上无差别。
- **`save_policy` keep/overwrite + 回收站（trash）**：属于 LSC 的 local-media 项目归档子系统（`/api/local-media/projects`），管的是「整个项目媒体目录怎么留、怎么回收」，与多轨编辑器的镜头级版本簿记正交。
- **`context_latent` 上下文缓存文件校验**：LSC 的续接靠 latent 文件，所以它能校验文件在不在。Toonflow 用 jobId 续接（`continuationJobId` → 服务端 `continue_from.from_job`），**不用 latent 文件**，没有可校验的产物，只能靠 §15.9·5 的续接来源 `parentJobId` 比对。
- **`result_clips`（删镜头后视频仍可见）**：Toonflow 的 `remove` 操作只删 clip 记录不删文件，视频其实已留在磁盘，但当前没有入口可见；要做成 LSC 那样的「删镜头、成片还在」需要 project schema 变更，本轮不做。
- **删除版本入口不放画布节点工具栏**：本轮只在多轨编辑器 UI 里加（`statusPanel` 与 `versionMenu`）。画布节点工具栏要接就要把删除语义暴露到节点层，牵涉节点生命周期，留待下一轮。
- **双缓冲预载与 RAF 轮询**：LSC 用两个 video 元素（`.nh-result-preview` + `.nh-result-buffer`）做切换预载、用 RAF 轮询 `currentTime >= duration - 0.0005` 判播完。Toonflow 用单个 `<video v-if="previewUrl">`，每次换 URL 元素销毁重建，天然无换源卡顿，不需要双缓冲；连播判定用 `@ended` 事件而非 RAF 轮询（无自定义播放条/时间轴/音频队列，`@ended` 足够且更简单）。

历史版本仍是磁盘上的真实产物（旧工程还包括画布上的真实节点）；本轮加上的删除是**编辑器内的显式动作**，带整镜确认弹窗与 `generating` 锁定，不做静默回收。手工删掉某个旧版次的画布节点后，它的条目仍留在 `attempts` 里，但预览与设为默认都会报「读取画布节点失败」。

---

## 十五·五、对话 Agent 直接操作画布多轨节点（16 个 `node:` 函数）

多轨能力除了文档面板里的独立界面（§十五），还以**画布节点**形态提供（`packages/nodes/multitrackNode`，节点类型 `remote-multitrackNode`）。对话 Agent 可对这类节点直接调用以下 16 个节点函数，命令式完成绑定/读/读参考映射/批量编辑/保存/重载/派工/取消/暂停/继续/单镜重试/整理提示词/刷成片。其中 14 个由节点自身注册（`packages/nodes/multitrackNode/src/index.vue`），2 个引用函数由 `useNodeReferences()` 自动注册（`packages/nodeShared/src/useNodeReferences.ts`），内部全部薄代理 `packages/nodeShared/src/mtrack/multitrackEditor.vue` 暴露的编辑器 API。

**调用纪律**：和其他节点函数一样，先 `getNodeTools({ nodeIds })` 查该节点真实提供的函数名与参数 schema，再经 `nodeTools` 调用；清单里没有就不调，不猜参数。

| 函数 | 入参 | 返回 | 用途与要点 |
|---|---|---|---|
| `node:getStatus` | 无 | `{ bound, projectPath, clipCount, totalSeconds, statusCounts, dirty, saving, dispatching, activeBatchId, batchClipIds, findingsCount, conflictError, loadError }` | 入口探针：先调它确认节点已绑定工程、有没有在跑批次（`batchClipIds` = 状态 `generating` 且 `attempts` 含 `error == "batch:" + activeBatchId` 的镜头）。`activeBatchId` 空只说明当前编辑器实例没记账，不代表无批次在跑——按 §十四 从 `mtrackRead` 的 `attempts` 找回 |
| `node:bindProject` | `{ mode: "open" \| "new", path? }`；`open` 必填 `path`（工作区相对路径、限 `.mtrack`、禁 `..`） | 绑定后的工程状态 | `new` 顺延 `plan/story[-N].mtrack` 并以 exclusive 写、绝不覆盖已有工程；同路径重复绑定幂等；已绑异路径报错「已绑定 {path}，如需切换请新建节点或重新加载」 |
| `node:readClips` | `{ from?, to? }`（分镜号，可省 = 全量） | `{ clips[], updatedAt, missing, conflict }` | **读前已对账磁盘**：`updatedAt` 即后续 `planOperator mtrackUpdate` 与保存链的 CAS 基线；`missing` 为区间内未命中编号；`conflict=true` 表示磁盘已被他人改过且本节点有未保存修改（返回的是内存版本，先 `saveProject` 或 `reloadProject(discard=true)` 再继续）。`from > to` 报「起始分镜号 {from} 不得晚于结束分镜号 {to}」 |
| `node:readReferenceMap` | `{ from?, to? }`（分镜号，含端点，可省 = 全量，语义同 `readClips`） | `{ updatedAt, conflict, clips[] }`，每镜 `{ clipId, clipNodeId, items[], unconnectedCardIds[], missingCardIds[], orphanSources[] }` | 一次读全「镜 → 用哪些资产 → 资产卡 id → 画布节点 id → `{{ref N}}` 位次」四段映射链，映射断在哪一步一眼可见，不必等 `node:dispatchGenerate` 抛「参考图未就绪」。`items[]` 每项 `{ expectedIndex, expectedRef, cardId, kind, nodeId\|null, sourceHandle\|null, connected, actualIndex?, actualRef? }`：expected* 来自该镜 `referenceIds` 顺序，actual* 来自视频节点上 `node:getReferenceOrder` 的实际参考顺序（仅该镜已有 `nodeId`、已派工时返回）。`missingCardIds` = `referenceIds` 里有、但画布上根本没有可用产出的卡片 id（真断点，派工会报「参考图未就绪」）；`unconnectedCardIds` = **已派工**镜头里卡有产出但没连到视频节点 `in` 端口的卡片 id；**未派工的镜头（`clipNodeId` 为 null）连线尚未建立属正常，只报 `missingCardIds`、不算 `unconnected`**。`orphanSources` = 视频节点 `in` 端口上连了、但 `referenceIds` 里没有的来源 `{ nodeId, sourceHandle }`。来源解析与派工共用 `packages/nodeShared/src/mtrack/directDispatch.ts` 的 `resolveReferenceSources`，查到的就是派工真会接的 |
| `node:editProject` | `{ operations: [1..100 条 op], save? = true }`；op 六种：`add{clipId?,after?,patch?}` / `patch{clipId,patch}` / `duplicate{clipId}` / `move{clipId,to|after}` / `remove{clipId}` / `setGlobal{ratio?,style?,systemPrompt?,model?}` | `{ applied, issues[], conflict, saved, updatedAt }` | 编辑器等价批量编辑（内核 `packages/nodeShared/src/mtrack/mtrackEdit.ts` 的 `applyClipOperations`/`validateClip`）：**整批原子**，任一 op 校验失败整批拒收、`issues` 返回不抛错；`conflict=true` 是磁盘对账冲突（同 `readClips`），内存不落 edits。`patch` 的 `prompt` 需整组三字段提交（先 `readClips` 取现值再合并落盘）。校验覆盖 clipId `^S\d{3}$` 唯一（V11）、`seconds` 2–60 整数、`ratio`/`resolution` 枚举、`referenceIds` 去重且 **≤9（与 V8 的 `MAX_IMAGE_REFERENCES` 同口径，超限在编辑校验中直接拒绝）**、`continuity ∈ shot/context`（旧值 `start`/`cut`/`continue` 只在 `normalizeProject` 归一后接受，写入请直接给 `shot`/`context`；`context` 另受 V16 约束：时长 ≥10 秒、参考素材合计 ≤3）。真源字段可写——但**生成前仍必须跑 `planOperator validate` 且 error 清零**，本工具不代跑完整契约校验。`save=true`（默认）成功后立即落盘，不等防抖 |
| `node:saveProject` | 无 | `{ saved: <updatedAt> }` | 强制落盘（编辑器 `flushSave`），返回写盘的 `updatedAt`；与 800ms 防抖自动保存共用同一条 CAS 保存链，磁盘被他人改过会报冲突而不是覆盖 |
| `node:reloadProject` | `{ discard? = false }` | 重载后的工程状态 | 从磁盘重读。有未保存修改且未传 `discard: true` 时报错不重载 |
| `node:dispatchGenerate` | `{ clipIds?: [1..200] }` 或 `{ from, to }`；`includeFinished? = false` | `{ batchId, skipped }` **立即返回** | UI footer「生成视频」按范围派工的等价物（复用 `pickDispatchTargets` 的本地校验与编辑器 `launchDispatch`）：编辑器逐镜组装请求交给服务端媒体任务通道生成（§15.2），**不经过对话模型**。**与 §十三 逐镜 SOP 二选一**——若本会话正在按 §十三 逐镜生成，绝不要再调它，否则同一批镜头双重执行、双份算力。拿到 `batchId` 就汇报进度看 `node:getStatus.batchClipIds` / `planOperator mtrackRead`，停手用 `node:cancelBatch`。ACT 边界：单次节点调用有 120 秒超时约束，故只发起不待流；生成循环随编辑器实例卸载中断（删节点即断轮询），服务端任务继续跑，重开编辑器按 §十五·五/§15.5 处理在跑批次 |
| `node:cancelBatch` | `{ batchId? }`（缺省取 `activeBatchId`） | `{ cancellationRequested: true, batchId }` | UI footer「结束本批」等价物：abort 本地轮询，再对批次在跑任务发 `tasks/cancel`，回写 `pending` + `attempts` 追加 `cancelled`。同样**立即返回不等待**；取消成功不等于供应商退费或撤销任务 |
| `node:pauseBatch` | 无 | 编辑器状态快照（`batchPaused` 为闸门状态、`batchClipIds` 为待续镜头、`batchRunning` 为在跑标记） | UI「本镜结束后暂停」等价物：**软闸门**——在跑的镜头不中断，本镜生成结束后不再开始下一镜；不 abort、不取消供应商任务，整批中止用 `node:cancelBatch`。没有在跑的批次时闸门不置位、`batchPaused` 仍为 false；续跑交 `node:resumeBatch` |
| `node:resumeBatch` | `{ clips: [1..200], includeFinished? = false }` | 编辑器状态快照 | UI「继续生成」等价物：沿用同一 `batchId` 续跑 `clips` 里的镜头（取 `node:getStatus.batchClipIds` 中尚未完成的那些），`attempts` 标记与批次行都不变；`includeFinished=false` 默认只跑 pending/failed。**被拒时直接抛错**（如「已有派工操作正在进行，请等待结束」或派工失败原文），不返回成功快照——拿到错误即视为未受理，不要重试同一批 |
| `node:retryClip` | `{ clipId }` | 编辑器状态快照 | UI「单镜重试」等价物：只派这一镜、**强制把已生成/已验收的旧结果也纳入**（追加新版本，不覆盖旧视频，见 §15.9），不连带同批其他镜头；`dispatching` 或 `batchRunning` 为真时**直接抛错**（不返回成功快照），先 `node:pauseBatch` 等当前镜结束或 `node:cancelBatch` |
| `node:rewritePrompt` | `{ clipId?, rules? }`（`clipId` 缺省取当前选中镜；`rules` 覆盖内置整理规则，≤20000 字） | `{ text, requiresReview }` | UI「整理提示词」等价物：**只调文本模型，不改工程、不写编辑器的待采用区块**。结果需用户确认后，由 agent 用 `node:editProject` 的 `patch` 写回 `prompt.integratedMultimodalDescription`（`prompt` 三字段整组提交）；生成中调用返回服务端 409 原文，错误原样抛出、不重试 |
| `node:refreshOutput` | 无 | `{ hasOutput, url? }` | 重新读取 `plan/composite.json` 合成清单：`executed` 为真时把成片挂到节点 `video` 输出端口并在卡片播放，否则清空输出。`planOperator composite execute=true` 之后调它刷新成片展示 |
| `node:getReferenceOrder` | `{ handleId? }`（省略 = 节点默认端口） | `{ handleId, explicit, references, referenceMentions }` | 查询该端口的参考顺序：按当前生效顺序返回 references（含参考编号、来源节点与端口），并给出 `referenceMentions` 的 `{{ref N}}` 文本（生成时由 wire 层按参考类型换算）。未显式排序时按入边顺序。参考编号唯一落点的读取口 |
| `node:setReferenceOrder` | `{ handleId?, sources[] }`（sources 须为该端口现有入边来源） | `{ handleId, order, appended }` | 按给定 sources 顺序重写该端口的参考顺序、写入 `referenceOrder`，参考编号（即 `{{ref N}}` 的 `N`）随之改变；未列出的入边保持在其后按原顺序追加。§十三.2 步 d 与下方资产接入三步第 2 步即用此函数 |

**资产接入多轨节点的三步**（把资产图接到某镜的参考）：

1. `connectNodes` 把资产节点 → 多轨节点 `in` 端口（按期望引用顺序逐条连）；
2. `node:setReferenceOrder` 按同一顺序对齐编号——参考编号（即 `{{ref N}}` 的 `N`）只由 `referenceOrder` 决定（§一 步 4），不看连线手势；
3. `node:editProject` 用 `patch` op 把 `referenceIds` 写进对应 clip（真源落盘）。**上限 4（V8）**：超限时 editProject 的校验整批拒绝，`issues` 里给原因，先减参考再写。

**与 planOperator 的边界**：多轨工程真源的批量读写与回写仍以 `planOperator` 的 `mtrackRead`/`mtrackUpdate` 为准（§十二）；`node:editProject`/`node:saveProject` 是编辑器等价能力，两边同经 `updatedAt` CAS 对账——节点侧保存与 `mtrackUpdate` 谁先落盘谁更新 `updatedAt`，另一方基线过期时报冲突，不静默覆盖。拿到编辑器内存态优先用 `node:readClips`（自带磁盘对账）。

---

## 十六、从资产总稿自动装配画布节点与连线

两步：`planOperator` 出计划（只算），`assembleCanvas` 落地（只写画布）。**不要自己算分层、不要自己排连线顺序。**

**硬前置（缺了会静默丢参考边）**：`plan/assetIndex.json` 必须已存在。`assemble` 对每个 `clip.referenceIds` 查 `indexCards.get(refId)`（`packages/tools/planOperator/src/index.ts:477`），查不到时只把 `参考结算缺 <refId>` 记进 `warnings`、`references` 记 `"缺失"`（`:479-480`），**不产出这条片段参考边**，且 warnings 只追加在返回 JSON 文本尾（`:519-521`），不拦流程。没跑过 `resolve`/`build` 时资产卡自身 `refs` 边仍在（`:457-462`），但**片段→资产图的参考边会整批悬空**。所以顺序固定为：`validate` 清零 → `resolve`/`build` 产出 `plan/assetIndex.json` → `assemble`。

### 16.1 出装配计划

```text
planOperator { action: "assemble", path: "plan/story.mtrack", assetCardsPath: "assets/assetCards.md", indexPath: "plan/assetIndex.json", from: "S001", to: "S007" }
```

`from`/`to` 可省（省 = 全部 clips，`packages/tools/planOperator/src/index.ts:418-419`）。

返回（`packages/tools/planOperator/src/index.ts:510-517`）：`{ generatedAt, updatedAt, layers[], assetNodes[], clipNodes[], connectOrder[] }`。

| 字段 | 内容 |
|---|---|
| `layers[]` | `{ layer, items: [{ cardId, kind }] }`，**只覆盖资产卡、不含任何片段节点**（`layerCount` 只从 `assetNodes` 推出，`packages/tools/planOperator/src/index.ts:466-469`）；`layer = 1 + max(其 refs 的 layer)`，无 ref 的卡 `layer = 0`（`packages/tools/planOperator/src/index.ts:433-439`） |
| `assetNodes[]` | `{ cardId, kind, name, ratio, textOnly, layer, nodeType, data, refs, edges[{ fromNode, fromHandle, toNode, toHandle }] }`，按 layer 升序再按卡顺序排（`packages/tools/planOperator/src/index.ts:441-464`） |
| `clipNodes[]` | `{ clipId, nodeType: "videoGenerationNode", data{ label, duration, resolution, ratio, generateAudio }, references, edges }`（`packages/tools/planOperator/src/index.ts:473-504`） |
| `connectOrder[]` | `"C01->S003"` 形式的连线顺序，资产边在前、片段边在后（`packages/tools/planOperator/src/index.ts:506-509`） |

`kind → nodeType`：`character`/`scene`/`prop`/`keyframe` → `imageGenerationNode`；`sound` → `audioGenerationNode`；片段 → `videoGenerationNode`（`packages/tools/planOperator/src/index.ts:163-165` 的 `nodeTypeOf`、`:454` 调用）。

拒绝条件：资产卡仍有 error 级发现 → `assemble 被拒绝：资产卡仍有 error 级发现（N 条），先跑 validate 清零`（`packages/tools/planOperator/src/index.ts:426`）。

### 16.2 落地

```text
assembleCanvas { plan: <16.1 返回的 { assetNodes, clipNodes, layers } 原样>, options: { origin: {x:0,y:0}, columnGap: 460, rowGap: 300, writePrompt: true, writeReferenceOrder: true } }
```

工具在 `packages/tools/canvas/src/index.ts:30`，实现在 `packages/tools/canvas/src/assembly.ts:121-286`。它做的事：

1. `getCanvas({ include: ["nodeTypes"] })` 取可用类型，**先把所有节点的类型都解析成功再动画布**（`packages/tools/canvas/src/assembly.ts:149-153`），避免只建了一半；一个类型都取不到时报「画布没有可用节点类型，请先启用对应节点插件再装配」（`packages/tools/canvas/src/assembly.ts:126`）。
2. 类型解析：精确名优先，其次唯一 `-<name>` 后缀匹配（真实类型是 `remote-imageGenerationNode` 这类，`packages/tools/canvas/src/assembly.ts:107-111`、`apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts:106`）；歧义或未命中直接报错并列出画布现有类型（`packages/tools/canvas/src/assembly.ts:151`）。
3. 建节点：资产按 layer 从 0 往上、同层按计划顺序（`packages/tools/canvas/src/assembly.ts:177-185`）；`clip` 层固定排在所有资产层右侧（`packages/tools/canvas/src/assembly.ts:188-193`）。`addNode` 只能传 `type`/`position`/`label`（`packages/tools/canvas/src/runtime.ts:56`，`apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts:140-145` 只写 `data: { label }`）。
4. 连线：按计划 edges 顺序，每批 ≤64 条（`packages/tools/canvas/src/runtime.ts:61`、`packages/tools/canvas/src/assembly.ts:92`）；端点没落地的连线跳过并记进 `failures`（`packages/tools/canvas/src/assembly.ts:204-208`）。
5. 写参考顺序：按「目标节点 + 目标端口」分组，把 edges 的给出顺序写成 `node:setReferenceOrder`（`packages/tools/canvas/src/assembly.ts:224-246`，工具在 `packages/nodeShared/src/useNodeReferences.ts:67`，落盘在 `packages/nodeShared/src/useNodeReferences.ts:92`）。这是参考编号（即 `{{ref N}}` 的 `N`）的唯一落点。
6. 写提示词：`data.prompt` / `data.text` 走 `node:setPrompt`（`packages/tools/canvas/src/assembly.ts:260-272`）。
7. 其余字段（`ratio`/`duration`/`resolution`/`generateAudio`）进 `deferredSeeds`，**装配阶段不下发**——`node:setConfig` 会校验模型能力，模型未选时下发必被拒（源码注释原文「装配阶段模型尚未选定，强行下发必然被拒」，`packages/tools/canvas/src/assembly.ts:255-258`）。

返回：`{ created, layers[{ layer, nodeIds }], connected, referenceOrder, prompts, deferredSeeds, failures }`（`packages/tools/canvas/src/assembly.ts:277-285`）。

**`layers` 的差别要注意**：`planOperator` 返回的 `layers` **只有资产层，一个片段节点都不含**（`packages/tools/planOperator/src/index.ts:466-469`）；`assembleCanvas` 返回的 `layers` 才多出 clip 层（`nodeIds` 是视频节点，`packages/tools/canvas/src/assembly.ts:275-279`）。**后续分层生成必须用 `assembleCanvas` 的 `layers`**，否则视频层永远轮不到。

失败怎么办：
- 报「找不到与节点类型 X 匹配的可用节点类型」→ 先启用对应节点插件（图片/视频/音频生成节点），再重跑。
- `failures` 非空 → 逐条看 `stage`：`connectNodes` 说明端点没建（`packages/tools/canvas/src/assembly.ts:206`，检查 `assemble` 的 `referenceIds` 是否含未结算的卡）、`referenceOrder` 说明该端口入边与计划不符（`packages/tools/canvas/src/assembly.ts:243`）、`setPrompt` 说明节点不接受提示词。
- `deferredSeeds` 不要丢，§十七 每层 start 前要用。

---

## 十七、基础图优先的分层生成

**为什么分层**：资产卡之间有依赖（`keyframe`/`prop` 常引用 `character`/`scene`），依赖它的图必须先有母版参考；片段层（视频）又依赖全部资产图。层号小的先出图，是拓扑序，不是排序偏好。

### 17.1 逐层推进

```text
generateLayer { layers: <assembleCanvas 返回的 layers 原样>, layer: 0, action: "start" }
generateLayer { layers: <同上>, layer: 0, action: "status" }
generateLayer { layers: <同上>, layer: 1, action: "start" }   // 上一层全部 succeeded 之后
```

工具在 `packages/tools/canvas/src/index.ts:47`，实现在 `packages/tools/canvas/src/assembly.ts:325-401`。

> **别混两套 action**：`start` / `status` / `cancel` 是**画布工具 `generateLayer` 自己的** `action` 取值（`packages/tools/canvas/src/assembly.ts:85` 的 `z.enum(["start", "status", "cancel"])`），不是 `planOperator` 的 action。`planOperator` 只有九个 action：`parse`/`resolve`/`validate`/`build`/`mtrackRead`/`mtrackUpdate`/`dispatch`/`assemble`/`composite`（`packages/tools/planOperator/src/index.ts:126`）。给 `planOperator` 传 `start` 会被 `.strict()` 之外的 enum 校验直接拒。

| 要点 | 细节 |
|---|---|
| 三段式 | `start` 只发起并立即返回（`packages/tools/canvas/src/assembly.ts:358-375`），`status` 轮询，`cancel` 请求停止（`packages/tools/canvas/src/assembly.ts:377-393`）。**不要等出图**——738.5 秒一镜的理由同样适用于出图与出片 |
| 基础图硬守卫 | `action: "start"` 前会逐个查本层之前所有层的节点状态，**有任何未 `succeeded` 就抛错**并列出前 5 个阻塞节点，文案为「分层 N 不能开始：前序分层仍有 M 个节点未成功（…）。基础图必须先完成；失败或取消的节点按 SOP 单独处理后重试本层」（`packages/tools/canvas/src/assembly.ts:339-356`）。不允许静默跳过 |
| 状态映射 | `idle→pending`、`running→generating`、`succeeded→generated`、`failed→failed`（`packages/tools/canvas/src/assembly.ts:96`）。回写多轨时**直接用返回的 `clipStatus`**，不要自己映射字符串 |
| 生成函数发现 | 逐批 `getNodeTools`（`nodeIds` 单批 ≤20，`packages/tools/canvas/src/runtime.ts:8` 的 `nodeIds = z.array(nodeId).min(1).max(20)`，`packages/tools/canvas/src/assembly.ts:94`），匹配 `/^node:generate[A-Z]/`；整批报错时退化为逐个查询，只把错误归给真正查不到的节点（`packages/tools/canvas/src/assembly.ts:293-323`） |
| 返回 | `start` → `{ action, layer, results[{ nodeId, name, status, clipStatus, error? }], next }`（`packages/tools/canvas/src/assembly.ts:374`）；`status`/`cancel` → 另加 `settled` 与 `clipStatuses`（`packages/tools/canvas/src/assembly.ts:394-400`） |

### 17.2 每层 start 之前还要做什么

`generateLayer` 只调生成函数，不做配置。所以每层开工前：

1. **资产层**：对同层节点 `node:getConfig` → `node:setConfig`，把 `deferredSeeds` 里该节点的 `ratio` 等字段连同模型一起下发（图片节点 `packages/nodes/imageGenerationNode/src/index.vue:420`、`packages/nodes/imageGenerationNode/src/index.vue:432`；音频节点 `packages/nodes/audioGenerationNode/src/index.vue:271`、`packages/nodes/audioGenerationNode/src/index.vue:282`）。提示词已由 `assembleCanvas` 写入（`packages/nodes/imageGenerationNode/src/index.vue:461`、`packages/nodes/audioGenerationNode/src/index.vue:310`）。
2. **视频层（clip 层）**：视频节点**必须先按 §一 的 1.5–7 步配好** `node:getConfig` + `node:setPrompt`（`packages/nodes/videoGenerationNode/src/index.vue:411`、`packages/nodes/videoGenerationNode/src/index.vue:450`），否则 `start` 会拿空配置去提交。视频层本质上就是 §十三 的逐镜流程，`generateLayer` 只是帮你按层批量提交、批量查状态。
3. 每层 `start` 前按 §七 展示算力（镜数、时长、参考、费用行），得到明确同意。

### 17.3 某层有节点失败

1. `action: "status"` 拿到 `failed` 的 `nodeId` 与 `error`。
2. 按 §八 处理（读原文 → 核参数 → 不自行降级）。
3. **不要跳过失败节点继续下一层**——下一层 `start` 会被守卫拒绝，报「前序分层仍有 N 个节点未成功」。先单独修该节点、重跑该层，再往下。
4. 整批要停：对该层 `action: "cancel"`，再按 §十四 回写多轨。

---

## 十八、改动要生效：插件产物与技能文档的部署事实

**这一节不是可选知识。** 按前面几节改完插件源码后，如果不按本节做，真机上跑的还是旧代码——SOP 会变成「纸面能力」。

### 18.1 server 只读 `data/`，不读 `build/`

| 事实 | 位置 |
|---|---|
| 运行时插件目录 = `dirname(conf.path)/tools`、`/nodes`、`/ext` | `apps/server/src/utils/plugins/tools.ts:22`、`apps/server/src/utils/plugins/nodes.ts:8`、`apps/server/src/utils/plugins/ext.ts:9` |
| `conf` 的 cwd = `TOONFLOW_DATA_DIR`，缺省是仓库根 `data/` | `apps/server/src/utils/conf/index.ts:12-15` |
| 启动时把 `build/tools|nodes|ext` 当**源**同步进 `data/` | `apps/server/src/index.ts:15-17`、`apps/server/src/app.ts:46-52` |

所以：**`build/` 只是源，`data/` 才是运行时真正加载的东西。**

### 18.2 同步有闸门，dev 构建才会写进 `data/`

- `initializePlugins` 先读目标目录的 `initialized` 标记；`initialized !== null && (revision === undefined || initialized === revision)` 时**直接返回**（`apps/server/src/utils/plugins/initialize.ts:5-10`）。无 revision 的分支用 `cp(source, target, { recursive: true, force: false })`——**已存在就跳过**（`apps/server/src/utils/plugins/initialize.ts:25-27`）。
- 真正的「构建即落盘」在脚手架里，且**只有 dev 才会 copyFile**：
  - 工具：`if (process.env.NODE_ENV === "dev") { … await copyFile(builtPath, resolve(dataDir, fileName)); }`（`packages/toolScaffold/index.ts:134-138`）
  - 节点：`let syncToData = process.env.NODE_ENV === "dev";`（`packages/nodeScaffold/index.ts:56`），`configResolved` 里再补 `build.watch` 或 `mode === "development"`（`packages/nodeScaffold/index.ts:66`），`writeBundle` 才复制（`packages/nodeScaffold/index.ts:85-96`）
  - 扩展：`let syncToData = process.env.NODE_ENV === "dev";`（`packages/extScaffold/index.ts:37`），`writeBundle` 复制（`packages/extScaffold/index.ts:82-93`）

**结论（写进每个改插件的步骤）**：改完 `packages/tools|nodes|ext/*` 的源码，构建命令必须是

```powershell
$env:NODE_ENV = "dev"; bun run dev:plugins
```

`dev:plugins` 的定义就是 `NODE_ENV=dev bun run --filter './packages/tools/*' --filter './packages/nodes/*' --filter './packages/ext/*' build`（根 `package.json:33`）。

- 不带 `NODE_ENV=dev`（例如 `bun run build`）只会写 `build/`，**`data/` 不会更新**，重启也没用——闸门在 `force: false` 与 revision 上。
- `dev:plugins` 的**整体退出码会是 1**，那是 `bun --filter` 的汇总行为，不代表失败：逐包输出是 `Exited with code 0`。判定成功看逐条输出，`error|failed|Exited with code [^0]` 零命中即视为成功。**不要因为整体退出码 1 就中止流程或写「命令失败」。**

### 18.3 技能文档（含本 SOP 自己）不会自动同步

- 技能目录的同步是**不带 revision** 的：`if (dataDirectory && skillsRoot) await initializePlugins(resolve(dataDirectory, "skills"), skillsRoot);`（`apps/server/src/app.ts:72`），源码注释写明「技能和团队只补首次安装，保留用户修改」（`apps/server/src/app.ts:71`）。
- 结合 `apps/server/src/utils/plugins/initialize.ts:5-10`：`data/skills/initialized` 一旦存在，后续**任何**技能文件改动都不会被同步，`cp(..., { force: false })` 也不会覆盖已存在文件。
- **本 SOP 的运行时可读副本是 `data/skills/assetCard/references/generationRunbook.md`**；改 `packages/skills/assetCard/references/generationRunbook.md` 之后，必须人工同步一份到 `data/skills/assetCard/references/generationRunbook.md`，真机才读到新内容。改其它技能文件（`SKILL.md`、模板、参考文档）同理。

### 18.4 重启验证前先看端口

dev server 固定监听 3000（`apps/server/src/index.ts:6` 的 `const realPort = 3000;`）。启动前先确认端口没被别的进程占用：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess
```

有占用就先关掉（或确认那不是本项目的 server），再启动；不要直接起第二个实例去抢端口。

---

## 十九、本节涉及的 action / 按钮 / 定位核对表

写文档时逐处读文件核对过，复核用。**多轨编辑器相关引用已取消行号**：编辑器从旧 ext 插件目录迁入 `packages/nodeShared/src/mtrack/`（旧目录只剩挂载薄壳），行号随迁移与并行改动必然漂移，函数名才是稳定锚点，所以多轨相关一律按「文件 + 函数/字段名」定位、复核直接 grep 函数名。表内其他插件的行号是核对当时的真实行号，同样建议按函数名 grep 现查。**`planOperator` 尤其注意**：写入路径的 `clipUpdateSchema.status` 收紧为四态时新增了 ACT 注释块，`src/index.ts` 全表行号整体下移（`requestSchema` 在 `:125`、`action` 枚举 `:126`、`clipUpdateSchema.status` `:104`、`mtrackRead` `:273`、`mtrackUpdate` `:301`、冲突抛错 `:308`、`dispatch` `:338`、`assemble` `:415`、`composite` `:529`），下表若与实测不符一律以函数名 grep 为准。

| 引用对象 | 位置 | 核对结果 |
|---|---|---|
| 九个 action 枚举 | `packages/tools/planOperator/src/index.ts:126` | `parse`/`resolve`/`validate`/`build`/`mtrackRead`/`mtrackUpdate`/`dispatch`/`assemble`/`composite` 九项，逐字一致 |
| `requestSchema` 仍是 strict | `packages/tools/planOperator/src/index.ts:142` | `}).strict();` |
| `path` / `assetCardsPath` / `indexPath` 默认值 | `packages/tools/planOperator/src/index.ts:128`、`:129`、`:141` | `plan/story.mtrack` / `assets/assetCards.md` / `plan/assetIndex.json` |
| `execute` / `compositeOutputPath` | `packages/tools/planOperator/src/index.ts:139`、`:140` | 均为 `.optional()`；`execute` 默认 `false`，`compositeOutputPath` 默认 `plan/composite.mp4` |
| `from` / `to` / `expectedUpdatedAt` / `updates` | `packages/tools/planOperator/src/index.ts:135`、`:136`、`:137`、`:138` | 存在；`updates` `.min(1).max(500)` |
| `mtrackRead` 实现 | `packages/tools/planOperator/src/index.ts:273` | 存在 |
| `mtrackUpdate` 实现与 CAS | `packages/tools/planOperator/src/index.ts:301`（分支）、`:308`（冲突抛错）、`:326`（`writeAtomic`） | 存在；冲突文案逐字一致；`writeAtomic` |
| `dispatch` 实现 | `packages/tools/planOperator/src/index.ts:338`（分支）、`:341`（`from`/`to` 必填报错）、`:396-403`（返回结构） | 只出清单；`from`/`to` 必填；缺失参考告警；`generationParams` 三项待定 |
| `assemble` 实现 | `packages/tools/planOperator/src/index.ts:415`（分支）、`:510`（返回结构起点） | 分层、拒绝条件、返回结构逐项一致 |
| V7 真正实现 | `packages/tools/planOperator/src/planValidator.ts` 的 V7 分支 | 扫 prompt 三字段的参考标记：`{{ref N}}` 只查**越界**（`N` 必须落在 `1..referenceIds.length` 内），不查重号、不要求每个编号都出现；正文里凡出现尖括号标记（如 `<Picture N>`）都报 error，提示改用 `{{ref N}}` |
| 校验器实际覆盖的规则 | `packages/tools/planOperator/src/planValidator.ts` 全文 | 出现 `rule:` 的只有 V1/V2/V4/V7/V8/V9/V11/V12/V13/V14/V15；**V3/V5/V6/V10 没有 `rule:` 产出**。V3 由 `packages/tools/planOperator/src/referenceResolver.ts:148-149` 以 `backwardsOnly` 告警处理（不在 findings 里）；V5 的块在 `packages/tools/planOperator/src/planValidator.ts:133-141`（注释在 `packages/tools/planOperator/src/planValidator.ts:133`）只产出 V9 warning；V6 无实现；V10 无实现 |
| `composite` 实现与执行段 | `packages/tools/planOperator/src/index.ts:529-563`（composite 分支，`:548` 调 `concatComposite`），concat/ffprobe 实测已抽到 `packages/tools/planOperator/src/compositeRun.ts` 的 `concatComposite`（与服务端 `POST /api/mtrack/composite` 共用），清单与实测判定在 `packages/tools/planOperator/src/composite.ts`（`planComposite`、`verifySegmentSpecs`、`probeSignature`） | 默认只写 `plan/composite.json`（`executed:false`）；`execute=true` 先经 `context.ffmpeg` 走 `executeRemoteFfmpeg` 的 `input` + `ffprobe` 逐段实测规格（与首段不一致即抛），再走 `input` + `concat`，成功后改写 `executed:true`；输出目录不存在、输出已存在均报错 |
| concat 规格不一致的真实行为 | 2026-10-20 实测（样本工程真实产出造变体，绕过探针直接调 fluent `concat`） | 尺寸不一致（640×360 + 1376×768）报 `ffmpeg exited with code 234 ... Conversion failed!`，**错误信息不含尺寸线索**；帧率不一致（30fps + 24fps）与音轨不一致（无音轨 + 有音轨）**均静默成功**，分别产出 30.175s / 30.167s 的错乱成片。这正是 `verifySegmentSpecs` 必须挡在编码之前的理由 |
| `validate` 返回无降级字段 | `packages/tools/planOperator/src/index.ts:221-236` | 只返回 `errors`/`warnings`/`findings` + `resolved`/`mtrackClips`；`build` 的报告字段见 `:258-264`，同样无 `capabilityDegraded` |
| `snapshot` 结构（V15 的开关） | `packages/tools/planOperator/src/index.ts:80-84`、`:132` | `{ nodes, incomingEdges, referenceOrder? }`，`.strict()`；节点只允许 `id`/`type`/`status`/`outputs`，**不接受 `data`**，所以 V10 想在快照里核对 `data.mode` 也做不到 |
| V15 只在有 snapshot 时才跑 | `packages/tools/planOperator/src/planValidator.ts:246` | `if (snapshot && snapshot.referenceOrder)`——不传快照整段跳过 |
| `data.mode` 会被 watch 静默改写 | `packages/nodes/videoGenerationNode/src/index.vue:190-197` | `flush: "sync"` 的 watch，引用集变化时把 `data.value.mode` 换成 `matches` 里第一个可用项 |
| `assembleCanvas` / `generateLayer` 注册 | `packages/tools/canvas/src/index.ts:30`、`packages/tools/canvas/src/index.ts:47` | 存在 |
| 前序层守卫与状态映射 | `packages/tools/canvas/src/assembly.ts:339-356`、`packages/tools/canvas/src/assembly.ts:96` | 存在；`idle→pending` 等四项映射一致 |
| 装配主流程 | `packages/tools/canvas/src/assembly.ts:121-286` | `runAssemble` 全文 |
| 分层推进 | `packages/tools/canvas/src/assembly.ts:325-401` | `runGenerateLayer` 全文 |
| `node:getReferenceOrder` / `setReferenceOrder` | `packages/nodeShared/src/useNodeReferences.ts:52`、`packages/nodeShared/src/useNodeReferences.ts:67` | 存在；`referenceOrder` 写在 `packages/nodeShared/src/useNodeReferences.ts:92` |
| 视频节点四函数 | `packages/nodes/videoGenerationNode/src/index.vue:399`、`:411`、`:450`、`:462` | `getConfig`/`setConfig`/`setPrompt`/`generateVideo` |
| 图片 / 音频节点函数 | `packages/nodes/imageGenerationNode/src/index.vue:420`、`:432`、`:461`、`:473`；`packages/nodes/audioGenerationNode/src/index.vue:271`、`:282`、`:310`、`:321` | 存在 |
| 多轨工作台入口与交互 | `packages/nodeShared/src/mtrack/components/shotTabs.vue`（页签选段 `additive`/`range`）、`packages/nodeShared/src/mtrack/components/runFooter.vue`（「保存」「生成视频」「本镜结束后暂停」「继续 / 重试」「结束本批」与范围提示）、`packages/nodeShared/src/mtrack/multitrackEditor.vue`（`onSelect` 选段语义、`rangeClips` 范围换算、`generateFromRange`/`startBatch`、`cancelBatch`、`pickDispatchTargets`） | 逐处读文件核对存在 |
| 镜头版本机制（§15.9） | `packages/nodeShared/src/mtrack/multitrackEditor.vue`（`writeClipRun` 成功分支写 `clip.assetPath`/`signature`/`index`/`parentJobId` 并把产物路径写进该次 attempt、`regenerateClip`/`setDefaultVersion`/`setClipDefaultVersion`/`acquireNodeVideo`、`deleteVersionFiles`/`deleteVersionInClip`/`deleteAllVersionsInClip`、`states` computed = `clipStates`）、`packages/nodeShared/src/mtrack/mtrackProject.ts`（`clipVersions` 返回 `ClipVersion[]`、`clipStates` 返回 `Record<clipId, ClipState>`、`deleteClipVersion`/`deleteAllClipVersions` 返回 `VersionDeletion`、`stableJson`/`globalSignature`/`clipSignature`/`succeededVersionEntries`/`continuationJobId`、`ClipAttempt` 9 字段）、`packages/nodeShared/src/mtrack/components/statusPanel.vue`（`versionRow`/`versionActions`/`staleWarning`）、`packages/nodeShared/src/mtrack/components/shotEditorPane.vue`（「重新生成本镜」按钮）、`packages/nodeShared/src/mtrack/components/resultsOverlay.vue` + `versionMenu.vue`（浮窗逐镜版本菜单，「用于合并」=accepted、「设为默认」、「删除」/「全部删除」、「待更新」徽标，`stale` prop；顺序连播：`videoRef`/`continuousPlay`/`playbackPosition`/`playTicket`/`requestPreview`/`onPreviewEnded`/`playPreview`，「顺序连播已完成片段」checkbox 默认勾选、位置指示 `N / M · 标题`，口径见 §15.9·8） | 逐处读文件核对：版本身份 = 产物路径，`clipVersions` 遍历 `succeeded` 按 `key = attempt.assetPath || attempt.nodeId` 去重、旧→新，末尾补 `clip.assetPath`；媒体任务通道（不建画布节点）的新版次同样在列表里；设为默认只写 `nodeId`/`assetPath`、不追加 attempts；`clipStates` 派生 `stale`（签名 / 时间线位置 / 续接来源三条件，参考素材同 id 重画检测不到）；删除版本已实现（单版本直删、整镜弹确认、`EditorFiles.remove?` 删物理文件、`generating` 锁定、不改 `clip.status`） |
| `agentCanvas` 入口 | `apps/web/src/pages/workspace/panels/canvas/canvasHost.vue:205-207`、`apps/web/src/pages/workspace/panels/canvas/canvasHost.vue:214-218`、`apps/web/src/pages/workspace/panels/canvas/canvasHost.vue:417`；`apps/web/src/pages/workspace/index.vue:190` | 存在 |
| 批次号记账与取消判据 | `packages/nodeShared/src/mtrack/mediaDispatch.ts`（`composeClipRequest`）、`packages/nodeShared/src/mtrack/mediaTask.ts`（`submitClipTask`/`waitClipTask`/`cancelClipTasks`）、`packages/nodeShared/src/mtrack/multitrackEditor.vue`（`writeClipRun` 写 `batch:<uuid>`、`launchDispatch`/`launchCancel`/`cancelBatch`）、`packages/nodeShared/src/mtrack/batchMark.ts`（`batchMarker`/`attemptsOfBatch`） | 生成走服务端任务通道（`/api/ai/media/generate` + `tasks/status`），旧的画布节点派工 `beginDirectDispatch`/`beginDirectCancel` 已删；`batch:<uuid>` 写在 `attempts[].error` |
| `ClipStatus` 五值与 `attempts` 字段 | `packages/nodeShared/src/mtrack/mtrackProject.ts`（`ClipStatus`、`ClipAttempt`） | 一致；`ClipAttempt` 为 9 字段 `{ at, nodeId, status, error?, jobId?, assetPath?, signature?, index?, parentJobId? }`，无 `batchId` 字段，成功尝试带 `jobId`（续接）、`assetPath`（版本身份）、`signature`/`index`/`parentJobId`（版本签名簿记，供 §15.9·5 待更新判定） |
| 编辑内核与节点函数落点（§十五·五） | `packages/nodeShared/src/mtrack/mtrackEdit.ts`（`applyClipOperations`/`validateClip`/`EditOp`）、`packages/nodeShared/src/mtrack/multitrackEditor.vue`（`status`/`bind`/`readRange`/`applyOperations`/`syncFromDisk`/`launchDispatch`/`launchCancel`，经 `defineExpose` 暴露）、`packages/nodes/multitrackNode/src/index.vue`（14 个多轨函数 `nodeTools.register` + `useNodeReferences()` 自动注册 2 个引用函数，共 16 个 `node:` 函数） | 冻结契约（t1/t2/t3），实现落地后由验证复核 |
| `cancelGeneration` 语义 | `packages/nodeShared/src/useNodeGeneration.ts:17-26`、`packages/nodeShared/src/useNodeGeneration.ts:39` | 只请求停止；取消后 `error` 为「生成已取消」 |
| 首镜实跑 738.5s | 本文 §十一 记录表的「提交时长」行 | 一致 |
| 批量执行纪律 1–2 个任务 | `docs/multitrackProductionPlan.md:259`（§4.5 批量执行） | 一致 |
| dev 构建才落 `data/` | `packages/toolScaffold/index.ts:134-138`、`packages/nodeScaffold/index.ts:56`、`packages/extScaffold/index.ts:37`、根 `package.json:33` | 一致 |
| 插件同步闸门 | `apps/server/src/utils/plugins/initialize.ts:5-10`、`:25-27`、`apps/server/src/app.ts:46-52` | 一致 |
| 技能不自动同步 | `apps/server/src/app.ts:71-72` | 一致；`data/skills/initialized` 存在即不再补 |
| 端口固定 3000 | `apps/server/src/index.ts:6` | 一致 |
