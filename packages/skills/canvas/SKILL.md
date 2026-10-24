---
name: canvas
description: Toonflow 画布操作手册。使用画布工具创建、切换和重命名画布，添加、移动、重命名、连接和删除节点，自动整理整幅画布、调整视口，以及调用节点注册的函数。用户要求操作当前画布或搭建节点流程时使用。
metadata:
  version: "2.2.0"
  displayName: 画布操作手册
  author: Toonflow
  github: https://github.com/HBAI-Ltd/Toonflow-app
---

# 画布操作手册

通过已启用的“画布操作”工具控制当前运行中的画布。工具仅在存在画布上下文时可用；缺少工具时，请用户打开目标项目的画布并确认工具已启用，不通过编辑画布 JSON 绕过工具。

## 操作流程

1. 已知节点 ID 时直接读取目标；否则用 `getCanvas({})` 确认激活画布概览，用 `findCanvasNodes` 按名称、类型或选择状态查找。仅在需要添加节点时用 `getCanvas({ include: ["nodeTypes"] })` 查询类型。
2. 根据用户要求选择下面的操作，逐次等待返回。后续调用使用前一步返回的 ID，不猜测 ID、节点类型、端口或节点函数。
3. 用 `getCanvasNodes` 按需读取目标字段，`getCanvasEdges` 查询局部连接；需要调整节点内容时，用 `getNodeTools` 读取该节点函数的描述和完整 `parameters`，通过 `nodeTools` 调用。
4. 完成结构调整后，按需调用 `fitCanvas` 展示结果，再用 `getCanvasNodes` / `getCanvasEdges` 只核对受影响节点、名称与连接。`arrangeCanvas` 已自动适配视口，不必重复调用 `fitCanvas`。只报告工具实际完成的操作。

故事或视频制作先读取 [制作阶段与确认](references/videoProduction.md#0-逐阶段协作)。默认只落实当前已确认阶段；先逐步收集信息，再展示阶段成果并询问调整，等用户明确继续。不因用户说“做一个短片”就一次创建全部分镜与生成节点，也不把提问失败、跳过或沉默当作确认。

视频生成先判工程形态（详见 workflow 技能「多轨接入（默认制作路径）」节）：工作区存在 `.mtrack` 工程，或任务属于分镜批量、跨镜连续性、需要状态回写 → 走 assetCard 多轨链路（资产卡定稿→分镜接入多轨工程→逐镜生成，按 runbook §十三 SOP 或 `node:dispatchGenerate` 二选一），不在画布上逐段手建视频节点直连生成；只有无多轨工程且用户点名只要一条视频、或对既有单视频节点的局部重生成，才走单节点直连链路。

默认从本次完整剧本生成角色、场景、道具资产，再拆为多镜头片段；直连例外形态下，一片段对应一份视频提示词和一个视频节点，资产直接用于多参生成。写资产提示词前按 `available_skills` 找 `script` 技能里的资产图规范，写视频提示词前按同样方式找片段制作指南（当前可能未安装，缺失时说明缺项，不凭简介补造规范），角色面部特写与正侧背完整三视图不能省成通用单张剧情图。视频提示词按工程形态选写法：多轨工程的镜头提示词直接按 MiniMax H3 官方 ref2va 六段书写、参考标记写 `{{ref N}}`（`N` 是本镜参考位次），画布直连的视频节点用同一套 `{{ref N}}` mention chip；节点在 wire 层按引用类型把 `{{ref N}}` 换算成模型侧标记。

文档内链接相对当前文件目录。跨技能的 `script` 规范按 `available_skills` 中实际 `location` 定位；依赖缺失时说明缺项，仅继续不依赖它的结构操作，不凭简介补造规范。

以下写法表示“工具名（参数对象）”。直接调用对应工具，不额外包一层 `{ name, args }`；只有 `nodeTools` 自身含有 `name` 和 `args` 参数。

## 读取画布

五个读取工具都支持可选 `canvasId`，用于确认当前激活画布，不能用它读取未激活的画布。每次响应最多 64 KiB，不提供全图快照：

| 工具 | 参数与返回 |
| --- | --- |
| `getCanvas` | 默认返回 `id`、节点数、连线数、选中数量和 `viewport`。`include: ["canvases"]` 查询 `{ id, name }` 画布列表，`include: ["nodeTypes"]` 查询 `availableNodeTypes` 的 `{ type, label }`；两类列表共用分页，`limit` 默认 30、最多 100。 |
| `findCanvasNodes` | 按 `query`（ID 或完整名称）、`types`（最多 20 类）、`selectedOnly` 筛选；省略筛选时分页列举。返回 `nodes` 摘要，名称预览最多 512 字符；`limit` 默认 30、最多 100。 |
| `getCanvasNodes` | `nodeIds` 每次 1–20 个、不允许重复；`fields` 默认 `label/type/position`，还可选 `ports/data/outputs`。`dataKeys` 限定需要的 data 自身属性，最多 20 个；返回 `nodes` 投影。 |
| `getCanvasEdges` | `nodeIds` 可选、最多 20 个；`direction` 取 `incoming/outgoing/both`，默认 `both`，省略 ID 才分页遍历全部边。返回 `edges`；`limit` 默认 100、最多 200。 |
| `getNodeTools` | `nodeIds` 每次 1–20 个、不允许重复，`names` 可筛选最多 20 个完整函数名。返回 `nodeTools`（含 `nodeId/name/description/parameters`）；`limit` 默认 20、最多 50。schema 不截断，单项过大则明确报错。 |

分页检查 `hasMore` / `nextCursor`，保留全部原查询参数，仅替换 `cursor`；节点筛选和连线查询每次最多扫描 2000 项，即使当前 `nodes` / `edges` 为空，`hasMore: true` 也表示尚未扫描完。`totalNodes` / `totalEdges` 是整张画布的总量，不是筛选命中数。游标不自行解析或构造，失效后重新查询。`selectedOnly` 按各页读取当时的选择状态筛选，用户编辑可能改变查询结果，不把分页当成冻结快照。

单节点内部也可能很大。`getCanvasNodes` 用 `path` 选择投影内的子路径，例如 `path: ["data", "promptModel"]` 或 `["outputs", "text", "value"]`，返回该路径的 `value`；首段只能是六种投影字段，`ports` 对应节点的 `data.handles`。数组和对象用 `valueOffset` / `valueLimit` 分页，默认 0 / 30、最多 100 项；字符串用 `textOffset` / `textLimit` 分段，默认 0 / 1000、最多 4000 字符。`valueOffset` 或 `textOffset` 大于 0 时必须提供 `path`，避免所有投影字段一起错位。路径只访问自身属性，不能读取继承属性。

`path` 最多 64 层，每段最多 256 字符（允许 JSON 对象的空键），整个路径的 JSON UTF-8 长度最多 2048 字节。达到路径深度或字节边界时返回 `pathDepthLimit` / `pathBytesLimit`，不得将该标记误认成已读完整内容；超长键用 `keyTooLong` 标记，并提供 `nextOffset` 以继续读取后续字段。

顶层 `hasMore/nextCursor` 表示还有节点未返回，保持原参数继续节点分页；每个节点的 `truncated` 表示该节点的值未读全。处理任一截断项时仅查询所属节点，使用该项路径及偏移，不携带原 `cursor`；具体规则：

- `text`：用该项 `path` 和 `nextOffset` 作为 `textOffset` 续读；`entries`：用该项 `path` 和 `nextOffset` 作为 `valueOffset` 续读。没有 `nextOffset` 表示该路径已到末尾，标记仍可能存在，因为本次只返回了后半段。
- `depth/budget`：以该项 `path` 发起新的详情查询，缩小读取范围；重新读取路径时不携带原查询的 `cursor`。
- `pathDepthLimit/pathBytesLimit/keyTooLong/circular` 表示无法完整展开。`keyTooLong` 可按返回的 `nextOffset` 跳过该键继续读取后续字段，但被跳过的值仍未取得；不反复重试硬限制或把它当完整内容。

节点内容先读取所需字段，发现截断后再沿路径补齐，不扩大为整图读取。已有文本文件路径交给文件读取工具；核对全文时必须包含已读片段和续读片段。

全局任务逐页处理并记录进度，只在上下文保留当前批次、累计摘要和游标；不要累计全部详情。对全图做增删操作可能使遍历游标失效，重新查询并根据已处理 ID 或结果核对，避免重复执行。节点新增、删除或画布切换后，用 `getNodeTools` 重新发现相关函数。

## 画布管理

| 工具 | 参数 | 行为与返回 |
| --- | --- | --- |
| `addCanvas` | `{ name? }` | 创建空白画布并切换到它；省略名称时自动使用未占用的“画布N”。返回新激活画布的概览。 |
| `switchCanvas` | `{ canvasId }` | 等待当前修改保存后切换到指定画布，返回新激活画布的概览。 |
| `renameCanvas` | `{ canvasId?, name }` | 省略 ID 时重命名激活画布，同时修改 JSON 文件名。返回操作后的激活画布概览。 |

名称去除首尾空白后为 1–120 个字符，不带 `.json` 扩展名，须为合法文件名；不能包含路径分隔符、文件名非法字符、控制字符，不能以点结尾或使用系统保留名。同名文件不会被覆盖。

画布 ID 与文件名关联，重命名后重新读取返回的 ID。重命名非激活画布不会切换过去。通过上述工具成功创建或切换画布后，本轮后续调用会作用于新的激活画布。

## 节点与连线

| 工具 | 参数 | 行为与返回 |
| --- | --- | --- |
| `addNode` | `{ type, position: { x, y }, label? }` | 新增节点，返回节点信息；函数用 `getNodeTools` 查询。未指定名称时使用类型的 `label`。 |
| `moveNodes` | `{ moves: [{ nodeId, position: { x, y } }] }` | 批量移动，返回 `nodes` 节点信息。不可拖动的节点会拒绝操作。 |
| `renameNodes` | `{ renames: [{ nodeId, label }] }` | 批量更新显示名称，返回 `nodes` 节点信息。不改变节点 ID。 |
| `deleteNodes` | `{ nodeIds: [...] }` | 删除节点及其连接边，返回 `nodeIds`、`removedEdgeCount`、最多 100 项 `removedEdgeIds` 和 `truncated`；截断仅影响回执。 |
| `connectNodes` | `{ connections: [{ source, sourceHandle, target, targetHandle }] }` | 批量连接输出与输入端口，返回 `{ edges }`。完全相同的连接已存在时返回已有边。 |
| `deleteEdges` | `{ edgeIds: [...] }` | 删除指定连线，返回 `edgeIds` 及关联节点信息 `nodes`。 |
| `selectNodes` | `{ nodeIds: [...] }` | 替换当前选择，返回 `selectedCount`、最多 100 项 `selectedNodeIds` 和 `truncated`；空数组取消节点选择。 |
| `arrangeCanvas` | `{}` | 整理整个当前画布：按真实节点尺寸与连线将顶层节点从左到右排列，子节点随父节点移动，并自动适配视口。返回 `arrangedCount`、最多 100 项 `arrangedNodeIds`、`truncated` 和 `viewport`；不改内容、连线或选择，不触发生成。 |
| `fitCanvas` | `{ nodeIds?: [...] }` | 调整视口，返回 `fitted`、`viewport`、`nodeCount` 和 `truncated`；传入 `nodeIds` 时另返回最多 100 项 `nodeIds`，省略时展示全部节点。 |

上述操作回执的 `truncated` 只表示 ID 列表缩略，不表示操作只完成了预览部分。不要为了取全回执重复执行操作；按需用读取工具核对受影响范围。

### 参数约束

- `position` 使用画布坐标，不是屏幕像素坐标；`x`、`y` 必须是有限数字。开启网格吸附时，新增和移动的位置会按网格取整，以返回的 `node.position` 为准。
- 节点 `label` 去除首尾空白后为 1–200 个字符。
- `addNode` 只接受当前 `availableNodeTypes` 中的类型，不接受任意 `data` 或自定义节点 ID。需要填写内容或设置节点参数时使用已注册的节点函数。
- `addNode` 添加多轨编辑器（`remote-multitrackNode`）时带 `agentCreated` 标记且**同画布唯一**：画布已有 agent 添加的多轨节点时再次添加会直接报错并给出既有节点，应复用返回提示的节点，不重复创建（菜单/拖拽添加的人工实例不受此限）。
- 上述移动、重命名、删除、连接操作每批 1–64 项，单项也使用数组参数。任一项校验失败则整批不执行；执行期间的异常不代表已产生的副作用自动回滚，恢复前仍需回读。
- 工具顶层参数采用严格对象校验，不传未声明字段。`nodeTools.args` 还要满足具体节点函数的参数定义。
- 节点 ID、画布 ID、边 ID 是不同的标识，不用显示名称代替它们。

### 连接规则

先通过 `getCanvasNodes({ nodeIds: [...], fields: ["ports"] })` 读取两端端口，每个端口含 `id`、`type`、`dataType`，可能还有 `label`。`source`、`target` 是节点 ID；`sourceHandle`、`targetHandle` 是各自节点内的端口 ID。

- 只能从 `type: "source"` 的输出端口连接到 `type: "target"` 的输入端口。
- 使用实际端口 ID，不根据“图片输入”等提示文字猜测。不同节点可有同名端口，必须同时确认所属节点。
- 工具沿用画布和目标节点的连接校验；类型匹配不保证一定可连，目标节点可能有额外规则。连接被拒绝时检查最新端口和函数说明，不修改 JSON 强行接线。
- 剧本和分镜文本用于规划，不直接作为图片或视频生成节点的输入。先确认角色、场景等资产，再把当前片段的全部镜头转写成一份专用视频提示词；连线只承载本次真正使用的素材。多轨工程形态下，该纪律由资产接入三步承接：`connectNodes` 连资产节点 → `node:setReferenceOrder` 对齐参考编号 → `node:editProject` 把 `referenceIds` 写进对应 clip（见 runbook §十五·五资产接入三步）。
- 接好媒体后核对目标的实际引用顺序，再用 `node:setPrompt` 写入 `{{ref N}}`（画布 mention chip，直连视频节点沿用这套写法）、素材名称和用途。连线成功不等于提示词已绑定素材，详细编号与配置核对见 [制作转换第 3–4 节](references/videoProduction.md)。
- 多轨工程的镜头提示词由写作者直接按 MiniMax H3 官方 ref2va 六段书写：`subject_definitions`、`summary`、`retention_analysis`、`detailed_description` 四段写进 `clips[].prompt.integratedMultimodalDescription`，`overall_soundscape`、`non_diegetic_music` 各自落 `prompt.overallSoundscape` / `prompt.nonDiegeticMusic`。参考标记统一写 `{{ref N}}`，`N` 是本镜 `referenceIds` 的位次（图片、音频、视频按同一份列表连续编号）；节点在下发前按参考的媒体类型把它换算成模型侧标记，写作者不必自己按类型数。引擎只补「全片风格 / 全片约束」前缀、漏写官方段首时的字段名、两个声音字段的段名，不代写资产定义段、镜头摘要段、参考保持分析段与「本段参考顺序」声明行——这几段写不出来就是提示词没写完，不能指望派工补齐。
- 节点或连线禁止连接、选择、移动、删除时遵守返回错误。删除有子节点的节点须先删除子节点或将其纳入同一删除批次；若涉及用户未要求删除的内容，先明确范围，不自动扩大删除操作。

## 调用节点函数

使用 `nodeTools({ nodeId, name, args })`：

- `nodeId` 与 `name` 必须来自同一项函数清单；`name` 保留完整 `node:` 前缀。
- 按该项 `parameters` 的 JSON Schema 构造 `args`，遵守必填字段、枚举与数据结构；无参数函数也传 `{}`。
- 不假定所有节点都有同一组函数，例如设置提示词、导入素材、生成媒体等能力必须以该节点实际注册内容为准。
- 需要核对或修改生成配置时，若清单提供 `node:getConfig`，通过它读取当前配置和可用模型能力；需要变更的选项使用 `node:setConfig` 按实际参数说明修改，再核对返回结果。配置修改不触发生成；用户已确认的有效设置继续沿用，不因普通编辑任务重新选模型。
- 图片节点（`remote-imageNode`）除 `node:setImage` 外还提供 `node:splitGrid`：宫格切图，参数 `{ rows, columns }`（各 1–10、乘积 >1），语义与节点面板「宫格切分」按钮一致——逐格建图片节点，并**独占写**出 `plan/assetIndex.json` 与 `plan/story.mtrack`（每格一镜、只建工程不派工；任一文件已存在即拒绝覆盖）。返回 `{ tiles: [{ nodeId, cardId, path }], projectPath, assetIndexPath }`。细节见 assetCard runbook §15.7。
- 多轨编辑器节点（`remote-multitrackNode`）实际提供 16 个函数：14 个由节点自身注册——`node:getStatus`（入口探针：绑定、镜头统计与在跑批次）、`node:bindProject`（open/new 绑定 `.mtrack` 工程）、`node:readClips`（读前对账磁盘，返回 clips 与 `updatedAt`）、`node:readReferenceMap`（`{ from?, to? }` 与 `readClips` 同语义，返回 `{ updatedAt, conflict, clips[] }`；每镜给出期望参考位次 `expectedIndex/expectedRef`、实际位次 `actualIndex/actualRef`（已派工才有）、资产卡 id、画布节点 id 与是否连线，外加 `missingCardIds`（画布上没有可用产出，真断点）、`unconnectedCardIds`（仅已派工镜头：有产出但没连上）、`orphanSources`，一次读全四段映射链、不必等派工抛「参考图未就绪」；未派工镜头连线尚未建立属正常）、`node:editProject`（add/patch/duplicate/move/remove/setGlobal 整批原子批量编辑，可选立即落盘）、`node:saveProject`（强制保存）、`node:reloadProject`（从磁盘重载，脏数据须 `discard`）、`node:dispatchGenerate`（等价 UI「生成选中段」，立即返回 `{ batchId, skipped }`）、`node:cancelBatch`（按批次请求取消，立即返回）、`node:pauseBatch`（等价 UI「本镜结束后暂停」的软闸门：不 abort 在跑镜头，本镜结束后不再开始下一镜，返回带 `batchPaused` 的状态快照）、`node:resumeBatch`（等价 UI「继续生成」：沿用同一 `batchId` 续跑传入的 `clips`，`includeFinished` 默认只跑 pending/failed）、`node:retryClip`（等价 UI「单镜重试/重新生成本镜」：只派 `clipId` 一镜，生成成功后作为新版本追加——旧视频与画布节点保留，新视频自动成为该镜默认；生成进行中被拒）、`node:rewritePrompt`（等价 UI「整理提示词」：只调文本模型返回 `{ text, requiresReview }`，不改工程，用户确认后用 `node:editProject` 的 `patch` 写回）、`node:refreshOutput`（重读合成清单刷成片）；另外 2 个引用函数由 `useNodeReferences()` 自动注册（`packages/nodeShared/src/useNodeReferences.ts`）——`node:getReferenceOrder`（查询端口当前生效的参考顺序，返回 references 与 `{{ref N}}`（画布 mention chip）的 referenceMentions 文本）、`node:setReferenceOrder`（按给定 sources 顺序重写 referenceOrder 与参考编号，资产接入三步第 2 步即用此函数）。以 `getNodeTools` 实查为准；多轨工程真源读写以 `planOperator` 的 `mtrackRead`/`mtrackUpdate` 为准，`node:editProject` 为编辑器等价能力，同经 `updatedAt` CAS 对账。逐函数说明见 assetCard 技能 runbook 的「对话 Agent 直接操作画布多轨节点」节。写多轨镜头提示词按官方六段写，参考标记统一用 `{{ref N}}`（`N` = 本镜参考位次）。
- 图片或视频生成前展示实际模型、对象与数量、规格、提示词、参考及费用，等待用户明确批准算力消耗方案；报价未知就说明未知。单张、小样、追加、重生成和可能收费的重试都受授权范围约束，具体批次可一次确认。使用可用的 `askUser`，没有该工具时文字提问等待答复；未回答不能触发生成。**媒体资产生成默认使用 freevideo 供应商**（视频 `MiniMax-H3`、图片用 FreeVideo 图像模型）：用户未指定模型时直接按 freevideo 继续，不要换成节点自动默认值或其他供应商；freevideo 不可用时先说明并确认替代模型。用户点名其他模型时才按其指定执行。
- 返回值由节点函数决定；无返回值时为 `null`。五个画布读取工具的 64 KiB 上限不适用于 `nodeTools` 业务函数执行结果。执行成功不自动代表媒体生成成功，须检查返回内容及最新节点状态。
- 新建节点后可立即用返回的节点 ID 查询 `getNodeTools` 并调用，不必结束当前轮对话。

## 常见任务

### 把创作方案转成可执行画布

剧本、小说或创意制作任务需要把分镜、素材和提示词落实为节点时，读取 [视频制作的画布转换](references/videoProduction.md)。其中说明哪些内容放进文本节点、如何复用媒体和连接真实依赖，以及后台生成的完成核对。通用参数仍以本手册和当前工具返回的说明为准。

### 新建画布并添加节点

调用 `addCanvas({ "name": "分镜草稿" })`，再用 `getCanvas({ "include": ["nodeTypes"] })` 查询 `availableNodeTypes`，选取符合用户要求的类型传入 `addNode` 的 `type`。例如位置可用 `{ "x": 120, "y": 160 }`；名称由用户意图决定。记录返回的 `node.id`，用 `getNodeTools` 查询并调用函数填写节点内容，最后调用 `fitCanvas({})`。

### 连接两个已有节点

调用 `findCanvasNodes`，按用户指定的名称或选择状态定位两个节点；已知 ID 时跳过查找，若同名节点无法区分则先明确目标。用 `getCanvasNodes` 读取输出与输入端口后，将实际 ID 填入 `connectNodes` 的 `connections` 数组。检查返回 `edges` 的两端，再按需聚焦这两个节点。

### 查找并读取指定片段

例如用户指定 G51，先调用 `findCanvasNodes({ "query": "G51", "limit": 20 })`，按分页结果确认目标。以下 `目标ID` 须替换成返回的实际 ID：

- 核对提示词与输出：`getCanvasNodes({ "nodeIds": ["目标ID"], "fields": ["label", "data", "outputs"], "dataKeys": ["prompt", "referenceOrder"] })`。默认字段不含 `ports/data/outputs`，不能把未请求的字段当作空值。
- 读取长提示词：`getCanvasNodes({ "nodeIds": ["目标ID"], "path": ["data", "prompt"], "textLimit": 4000 })`；后续使用返回的 `nextOffset`，不自行按请求长度推算。
- 查询目标入边：`getCanvasEdges({ "nodeIds": ["目标ID"], "direction": "incoming", "limit": 100 })`；查询可调用函数：`getNodeTools({ "nodeIds": ["目标ID"], "limit": 20 })`。

### 批量整理节点

仅当用户明确要求整理整幅当前画布时，在确认目标后调用一次 `arrangeCanvas({})`，不自行计算所有节点坐标再逐个移动。此工具复用画布现有整理功能，不接受 `nodeIds` 或其他局部范围参数。

待整理节点尚未测量或不可移动时，工具明确返回错误；不要猜测尺寸或绕过移动限制。空画布正常返回空的 `arrangedNodeIds`，不执行布局或视口调整。

只整理指定镜头或局部节点时，读取实际位置与目标范围，用 `moveNodes` 的 `moves` 数组调整这些节点，按需用 `fitCanvas({ "nodeIds": [...] })` 展示。只要求看清内容时直接用 `fitCanvas`，不重排节点。不得为了局部整理调用 `arrangeCanvas` 移动用户其他节点，也不删除或重建节点来代替移动。

## 失败后的处理

- 节点类型未启用、端口不存在、函数未注册：分别用 `getCanvas({ include: ["nodeTypes"] })`、`getCanvasNodes`、`getNodeTools` 查询最新状态并调整操作，不要猜测替代函数。
- 画布已关闭、用户手动切换项目或画布、本轮上下文失效：停止沿用旧 ID，请用户在目标画布重新发送请求。
- 超时、取消或保存失败不等于操作已回滚。上下文仍有效时先读取最新画布状态，确认是否已创建节点、连线或画布，再决定是否重试，避免重复创建或重复触发生成。
- 工具会等待需要保存的操作完成保存；不要另外直接写画布 JSON。当前工具不提供删除画布、任意写入节点数据或任意设置视口参数的通用接口。
