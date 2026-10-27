# 导入资产与分镜节点

把剧本/小说/分镜文本（粘贴正文或选工作区文件）抽成资产卡与分镜，可选出资产图，落盘 `plan/assetIndex.json` 与 `plan/story.mtrack`，交给画布上的多轨编辑器接着创作。

## 功能

- 面板入口在卡片内的「导入资产与分镜」按钮上（`el-popover`，根元素 `nodrag nopan nowheel`，拖节点/改选区/平移画布自动收起）。
- 文本来源二选一：工作区根目录的文件列表（`list()`，只列文件），或直接粘贴正文；两者都填时以粘贴正文为准。正文不进节点 `data`，只留在工作区文件里。
- 抽取走设置里已配置的文本模型（`ai.getModels()` + `ai.generate()`），提示词按 `packages/skills/assetCard/references/assetCardTemplate.md` 的编号与字段口径内置在 `src/assetImport.ts`（节点不 import skills 包）。
- 抽取结果先预览再确认：资产卡逐张可勾选（`C` 人物 / `SC` 场景空镜 / `P` 道具 / `S` 仅文字资产），分镜按原文顺序整批导入。
- 「同时生成资产图」勾选后，逐张走媒体通道出图（`ai.generateImage()` → `/api/ai/media/generate`，与图片生成节点同一条路），产物落 `assets/<本节点 id>/`，并在本节点右侧新建图片节点（`remote-imageNode`，label 为 `<资产编号> <名称>`），把画布节点 id 写回资产索引的 `nodeId`。资产卡的画幅按类别取标准档位（人物四视图整版 `2:3`、场景空镜 `16:9`、道具 `1:1`）：模型没给、给成非法形状（空串/中文），或给了非标准档位（旧口径 `16:9`/`9:16`/`4:5`）都归一到标准档，被改写的卡记进 `warnings`，不套工程画幅。`C` 卡出图自动注入英文四视图版面契约（2×2 竖版、默认遮脸，与 assetCard 技能图片提示词 §5.1 同源，`assetImport.ts` 的 `characterSheetLayout`）并固定 2K；卡正文自带的旧中文版面句按子句洗掉，声明「不遮脸」可剥遮脸句；拼接后超引擎 2000 字符上限的卡在该张的 `failed` 里点名。
- **衍生卡与基卡自动关联**：资产的 `refs` 字段声明基卡编号（如 `C01-A` 引用 `C01`）；后缀卡没声明时回落到同前缀基卡。出图前按 `refs` 依赖拓扑排序（基卡列在衍生卡之后也能先出基卡），衍生卡出图时以基卡本次成图作参考图（上限 4 张，超出截断记 warning），并在画布自动连「基卡图片节点 `image` 口 → 本卡 `in` 口」的线；基卡未勾选、出图失败或依赖成环时按无参考出图并记 warning（宁可漏接、不可误接）。`refs` 随卡片写进 `plan/assetIndex.json`。
- 落盘写 `plan/assetIndex.json`（`{ version: "assetIndex-v1", cards }`）与 `plan/story.mtrack`（`normalizeProject` + `createClip` 组装）。两个文件任一已存在就直接拒绝，绝不覆盖；先写索引再写工程，工程写失败会删掉刚建的索引。不写 `global.model`——该字段是多轨派工用的视频模型，写进抽取用的文本模型会让派工报「所选模型不存在」。
- 分镜的参考清单只留本次真的出了图的图片资产：出图失败的卡会从 `clips[].referenceIds` 里剔掉（校验器 V13 只看卡在不在索引里、不看 `nodeId`，失败卡留着会让多轨派工报「参考图未就绪」）；被剔掉、超过引擎上限（单镜图片参考 ≤9、承接镜 ≤3）、承接镜不足 10 秒都记进 `warnings`，不中断导入。
- 原文里已经写好视频提示词的镜头，抽取时整段原样保留（六个官方段名与段序照抄，不改写成一句话）；落盘时按行首段名拆分进六个驼峰字段——`subject_definitions:` / `summary:` / `retention_analysis:` / `detailed_description:` 分别落 `subjectDefinitions` / `summary` / `retentionAnalysis` / `detailedDescription`，`overall_soundscape:` / `non_diegetic_music:` 各自落 `overallSoundscape` / `nonDiegeticMusic`（段名不进字段，与多轨编辑器写入口径一致，免得工程每镜带「缺段」的 V11 warning）。段落要补写或改写时用 `clips` 按 `clipId` 覆盖。
- 分镜的 `continuity` 默认按引擎口径「能承接就承接」：上一镜存在 + 本镜 ≥10 秒 + 参考 ≤3 才算承接（`context`），否则独立起拍（`shot`）；模型或 `clips` 显式给了值就照用。
- 模型一律显式选择，不静默回落：无文本模型时面板首屏报错并禁用抽取；无图片模型时显式提示，取消勾选出图仍可只导入资产卡与分镜。**面板与 `node:importScript` 都不再默认列表第一个模型**——盲选的模型若密钥没配好，整条链路会一路挂到超时，比直接报错难查得多。
- 本节点是「会话 Agent 与画布之间的契约工具」：资产卡与分镜已经定稿（会话里抽好、或从 `assets/assetCards.md` 整理出来）时直接传 `extraction`，节点纯校验落盘、一次模型都不调；只有散文要抽时才传 `path`/`text` + `model`。

## 对话 Agent 的节点函数

节点注册四个函数：`node:importScript`（跑一次导入）、`node:importModels`（列出可用文本/图片模型与面板当前选择）、`node:setModel`（Agent 调整面板当前模型）、`node:importStatus`（看进度与上次结果）。

`node:importScript`（节点自身注册）：

| 参数 | 说明 |
| --- | --- |
| `path` | 工作区内的**剧本文本**路径，与 `text` 二选一；不要指向 `assets/assetCards.md`，那会把已定稿的卡片当正文再抽一遍 |
| `text` | 直接给出的正文，与 `path` 二选一 |
| `extraction` | **定稿直读**：`{ style, systemPrompt, assets[], shots[] }` 整批结构化结果（契约就是 `assetImport.ts` 导出的 `extractionSchema`，与模型返回同一个口径）。传了就不再调文本模型，也不需要 `model`/`path`/`text`；结构不合契约、编号重复会在出图与写盘**之前**报错。**入口要的是两份稿的完整定稿**：对稿件内容，代码硬拦的只有编号重复、结构不合与 `clips` 覆盖的非法引用，正文 `shots` 引用不存在的卡会被静默掐掉、分镜缺段不报错——半套稿会静默落成工程且重跑被独占写拦下，完整性只能在调用前自查；`shots` 仅「先导纯资产、之后 `node:editProject add` 补分镜」的确认场景可为空 |
| `model` | 抽取用文本模型，`JSON.stringify([providerId, modelId])`（数组字符串），编号必须来自 `node:importModels` 的 `text` 清单；需要抽正文时**必填**——不在清单里或没选就直接报错，不再静默用面板默认（面板默认可能是不可用的模型，会一路挂到超时） |
| `imageModel` | 出资产图的图片模型，同上取 `node:importModels` 的 `image` 清单；`generateImages` 为真时必填，同样不回落到列表第一个。Agent 选的模型会回写面板下拉，人工看得见也随时能改 |
| `ratio` | 工程画幅与分镜画幅，取值 `9:16` / `16:9` / `1:1` / `4:3` / `3:4`；非法值回落到 `9:16`（资产卡的画幅另按类别标准档位归一） |
| `style` / `systemPrompt` | 写入工程 `global.style` / `global.systemPrompt` |
| `generateImages` | 是否为资产卡出图并放进画布（需要图片模型） |
| `clips` | 按 `clipId` 覆盖抽取出来的分镜：`{ clipId, prompt, seconds?, referenceIds?, continuity? }[]`。原文已写好视频提示词、或要改写某一镜时用它；`clipId` 从 `S001` 起按正文顺序编号，`continuity` 可写 `true`/`false`（承接上一层/独立起拍）或 `shot`/`context`。引用了不存在的资产、仅文字资产，或 `clipId` 不在本次分镜里，都会**在出图前**直接报错（不会先烧完资产图、建好图片节点再报）；`seconds` 清洗成 2–15 的整数秒，被改写会记进 `warnings` |

返回 `{ cards, shots, images, failed, warnings, indexPath, projectPath }`：`failed: [{ id, reason }]` 是出图失败的卡（单张失败不中断整条导入，失败卡在索引里 `nodeId` 为 `null`，补一张即可，并自动从参考清单里移除）；`warnings` 是不中断导入、但已经不满足引擎口径的提醒（参考超上限被截断、参考未出图被移除、`clips` 覆盖的参考被滤空、承接镜不足 10 秒、画幅被归一、秒数被改写、首镜写了承接被归一）。与面板按钮共用同一条链路（`src/assetImport.ts` 的 `importAssets`），只是不依赖面板打开与按钮状态；面板预览过的结果会带着走，不会二次调用模型。

> **取工具的前提**：不依赖「面板打开」指的是弹层收着也能跑，但这些函数都属于节点工具——**目标画布的节点必须先存在**（用户放上画布，或 agent 先 `addNode`），且**工作区画布页已加载**（`apps/web` 的 `getCanvasContext()` 在画布未初始化时返回空，服务端就注入不了 `tools`）。纯聊天、没有画布上下文的会话里取不到任何 `node:` 工具，这时先请用户打开目标项目的画布。

**超时的真实口径**：`node:importScript` 显式设了 `timeoutMs: 30 * 60 * 1000`（`packages/nodeScaffold/src/nodeTools.ts:143` 的默认是 120 秒），面板按钮直调 `runImport` 也不受这个限制——但**会话 Agent 走不到 30 分钟**：调用要经过 `apps/server/src/agent/bridge/canvas.ts:38` 与 `apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts:81` 两层 `AbortSignal.timeout(120000)`（只豁免 `transcribeAudio`），节点内部的放宽永远轮不到。所以 Agent 侧长任务要么用 `extraction` 走确定性落盘（秒级），要么分批、并用 `node:importStatus` 观察。中断后已建好的图片节点与 `assets/<nodeId>/` 不回收，重跑前还得先清 `plan/assetIndex.json`/`plan/story.mtrack`，否则会撞 `requireNewPlanFiles`。

`node:importModels`（无参数）返回 `{ text: [{ value, label, providerLabel, protocol, contextWindow, maxOutputTokens }], image: [{ value, label, providerLabel }], current: { model, imageModel } }`，`value` 就是能直接填进 `model`/`imageModel` 的字符串。`node:setModel`（`{ model?, imageModel? }`）把 Agent 确认过可用的模型写进面板当前选择，编号不在清单里同样报错。取到清单后自己判断哪个模型跑得通（密钥、上下文长度）是会话 Agent 的职责——节点只保证「不合清单的选择绝不静默生效」。长正文抽取前先看 `contextWindow`：`assetImport.ts` 的 `scriptLimit` 是 20 万字符，但真正把整篇塞进上下文的是所选文本模型的窗口。

`node:importStatus`（无参数）：

| 返回字段 | 说明 |
| --- | --- |
| `running` / `extracting` | 是否正在出图 / 正在抽取（两者互斥，都是 false 表示空闲） |
| `phase` / `done` / `total` | 阶段（`extract` / `images` / `write`）与出图进度张数 |
| `summary` / `error` | 本次结果的摘要文本与错误信息 |
| `failed` | 本次出图失败的卡 `[{ id, reason }]` |
| `aborted` | 本次是否被取消/超时打断（`running=false` + `aborted=true` 表示这一轮是中断结束） |
| `warnings` | 本次没有中断导入、但已被截断或不合引擎口径的提醒 `string[]` |
| `placedNodeIds` | 本次运行已建的资产图节点 id；取消/失败时这些节点与 `assets/<nodeId>/` 会留在画布上，Agent 可用画布工具 `deleteNodes`（单次最多 64 个，连带删边）直接清掉 |
| `savedSummary` | 节点 `data.summary`（随画布 JSON 落盘，重开工程也看得到上一次跑出了什么） |

## 已知边界

- 正文单次上限 20 万字符，超出要求分段导入（避免悄悄截断原文）。
- 媒体通道没有负面提示词字段，资产卡的 `negativePrompt` 并进正向提示（`避免出现：…`）。
- 资产图按 3 列网格排在本节点右侧，不做重叠检测。
- 生成/导入进行中再点一次会被拒绝（同一节点串行），占用标记在第一个 `await` 之前同步置位，同一轮并行发两个 `node:importScript` 也拦得住；画布拖节点不会中断在跑的导入。
- 取消/超时：写盘前会再复查一次中止状态，不会把已取消的工程落成磁盘状态；但已经建好的资产图节点与 `assets/<nodeId>/` 不回收——节点用画布工具 `deleteNodes` 清（`node:importStatus` 的 `placedNodeIds` 给出清单），`assets/<nodeId>/` 的文件由用户在文件树里删（Agent 没有删工作区文件的工具）。
- 分镜参考在落盘前按引擎上限收口：单镜图片参考 ≤9（超出截断并记 warning）、出图失败的卡一律剔掉；承接镜（`context`）的图片参考 ≤3（显式写了 `context` 也截，截断记 warning，与 ≤9 同一口径）；承接镜「≥10 秒」是引擎硬限制但导入只告警、不擅自改模型给的时长。
- 秒数只收 2–15 的整数秒（引擎校验 V12 实际允许 2–60）：抽取结果与 `clips` 的 `seconds` 都清洗，取整或收进档位都会改落盘值并记一条 `warnings`，需要更长请导入后在多轨工程里改。
- 首镜的 `continuity` 由 `normalizeProject` 强制回落成 `shot`（`@toonflow/node-shared/mtrack/mtrackProject.ts:268`）：给首镜写 `context` 不生效，导入会在 `warnings` 里说明；导入路径不会调用多轨编辑器的首镜提示（`firstClipContinuityFindings`）。
- 资产卡的画幅按类别标准化（人物 `2:3`、场景 `16:9`、道具 `1:1`）：模型给了非标准档位会被归一，卡片编号与名称照原样落盘。
- 大量资产在一次导入里逐张串行出图，没有批次与断点续跑；但**单张失败不再中断整条导入**——已出的图与已建节点保留，失败卡的 `nodeId` 留 `null`，失败清单经 `node:importStatus` 的 `failed[]` 与返回摘要带出，人工补一张即可，不必整批重来。
- 重跑会被独占写挡下：`importAssets` 入口先探测 `plan/story.mtrack` 与 `plan/assetIndex.json`，任一已存在立刻报「已存在，未覆盖」，不会先烧文本模型与图片模型；想重来只能先清这两个文件（会话 Agent 没有删工作区文件的工具，请用户从文件树删除或改名；经 MCP `workspaceFiles` 通道接入时可用 rename/remove），或在原工程上 `node:bindProject(mode:"open")` 继续。
