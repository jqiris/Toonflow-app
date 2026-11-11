# 15 画布操作合约（节点工具的唯一使用规则）

制作链路涉及的所有画布操作只用本轮实际存在的工具，先查询再执行，不猜 ID/类型/端口/函数名，不直接读写画布 JSON 绕过工具。没有画布工具时（用户没打开画布）说明具体条件，继续可完成的文字部分，不伪造操作。

## 读取（五个读取工具，各响应 ≤64 KiB，不提供全图快照）

| 工具 | 参数 | 要点 |
|---|---|---|
| `getCanvas` | `{include?:["canvases","nodeTypes"],cursor?,limit?,canvasId?}` | 默认只回激活画布概览（id、节点/连线数、viewport）；加节点前查 `nodeTypes` |
| `findCanvasNodes` | `{query?,types?,selectedOnly?,cursor?,limit?,canvasId?}` | 按 ID/完整名/类型筛选 |
| `getCanvasNodes` | `{nodeIds:[1–20 不重复],fields?:["label","type","position","ports","data","outputs"],dataKeys?,path?,valueOffset?,valueLimit?,textOffset?,textLimit?}` | **默认只有 label/type/position**；正文、端口、输出必须显式选 fields；`dataKeys` 只在选 `data` 时生效 |
| `getCanvasEdges` | `{nodeIds?,direction?:"incoming"/"outgoing"/"both"}` | 核对参考连线顺序用它 |
| `getNodeTools` | `{nodeIds,names?,cursor?,limit?}` | 返回每个节点的函数清单（name+完整 parameters）；改内容前必查 |

分页纪律：保持原查询参数只换 `cursor`；`hasMore:true` 时空结果也要续；`totalNodes/totalEdges` 是画布总量不是命中数。节点值 `truncated` 时按该项 `path`+`nextOffset` 续读（字符串 `textOffset`、数组/对象 `valueOffset`），不带旧 cursor；`keyTooLong` 可跳过该键继续但被跳过的值未取到。**截断内容永不冒充完整证据。** 五个读取工具都支持可选 `canvasId`，但它只用于**确认当前激活画布**，不能读取未激活的画布；`path` 最多 64 层、整个路径 JSON UTF-8 最多 2048 字节、每段最多 256 字符。

## 结构操作

| 工具 | 参数形状 | 限制 |
|---|---|---|
| `addNode` | `{type, position:{x,y}, label?}` | **不接受任意 data/指定 ID/正文**；创建后拿返回 `node.id` 再 `getNodeTools` |
| `nodeTools` | `{nodeId, name:"node:函数名", args:{...}}` | 节点内容修改与生成的唯一入口 |
| `connectNodes` | `{connections:[{source,sourceHandle,target,targetHandle}]}` | 每批 ≤64；先读两端真实端口再连 |
| `moveNodes`/`renameNodes`/`deleteNodes`/`deleteEdges` | `{moves/renames/nodeIds/edgeIds:[...]}` | 每批 ≤64；删除连带边 |
| `addCanvas`/`switchCanvas`/`renameCanvas` | `{name?}`/`{canvasId}`/`{canvasId?,name}` | 成功后用返回绑定，不沿用旧 ID |
| `fitCanvas`/`arrangeCanvas` | `{nodeIds?}`/`{}` | 本轮成果用 fit 展示；arrange 整理**全部**顶层节点，只在整幅整理属于用户范围时才用 |

回执 ID 列表可能缩略至 100 项（`truncated` 只影响列表不代表只完成部分）；核对改用只读工具，不为拿全列表重复执行修改。

## 节点内容合约（制作常用）

- 文本节点正文用该节点实际注册的 `node:setText({text})`；成功后用 `getCanvasNodes(fields:["data"],dataKeys:["textPath"])` 回读路径，再读该文件核对。`setText` 不返回路径；持久化画布 JSON 不存内联正文，不能据缺字段判"节点为空"。
- 素材挂载 `node:setImage/setVideo/setAudio({path,mimeType})`：`path` 是**工作区相对路径且文件真实存在**，不能填预期输出或外链。
- 生成节点：`node:getConfig` 读真实能力（models/modes/规格上限，**不写死经验值**）→ `node:setConfig`（图片 `providerId/modelId/size/ratio`；视频 `providerId/modelId/duration/resolution/ratio/mode/generateAudio`，providerId/modelId 成对）→ `node:setPrompt({prompt})` → `node:generateImage/generateVideo({})`。先接素材再读配置，只传所需且支持的字段。
- `node:getReferenceOrder/setReferenceOrder`（多轨、图片、视频、音频、导演台、文本节点上有）：手工接线改位次时才用；多轨参考位次的常规产生方式是「参考素材」打勾（11 册）。
- 新节点模型可能未初始化：收到"尚未加载"保留节点稍后再试，不删除重建，不把"未加载"当"未配置"。
- 批量修改按数量拆批；画布切换/新增删除后用 `getNodeTools` 重新发现函数。

## 画布与工具缺口

- 默认复用当前项目与激活画布；有台账先核对绑定；含糊的"继续"遇到不同绑定先澄清。
- 布局：从左到右内容→资产→片段，同阶段纵向排列，避免覆盖用户已有节点。
- 工具不在本轮清单里就报告缺项（如"当前没有画布上下文，请打开目标项目画布"），只继续不依赖它的部分；**不绕过工具直接改 `.json` 画布文件**。
- 连线只表达"下游要用上游的什么内容"，不表达阶段顺序、审批或依赖索引；两个视频节点的播放先后不要求连边。
- 画布上没有多轨节点时（新工程第一步）：`getCanvas({include:["nodeTypes"]})` 查实际类型清单，按清单里的类型名（可能带运行时前缀，如 `remote-multitrackNode`）`addNode` 新建一个，再进入 11 册连线与绑定；类型清单里没有，说明「导演台/多轨等插件未启用」并请用户在插件市场启用，不伪造类型名。

## 制作工具面总表（除画布五件套外的执行工具，一律以本轮实际存在的为准）

| 工具 | 动作与关键参数 | 用于 |
|---|---|---|
| `planOperator` | `{action: parse/resolve/validate/build/mtrackRead/mtrackUpdate/dispatch/assemble/composite}`：parse `{markdown}`；resolve `{markdown 或 assetCardsPath}`（零写入）；validate `{mtrackPath, snapshot}`；build `{assetCardsPath, mtrackPath, snapshot}`（独占写索引+报告，与导入节点二选一）；mtrackRead `{path, from?, to?}`；mtrackUpdate `{updates[], expectedUpdatedAt}`；dispatch **`from` 与 `to` 都必填**（缺一即报「dispatch 需要 from 与 to」，index.ts:395 实测）；assemble `{from?, to?}`（只出计划不落地）；composite `{execute?}` | 07 refs 结算、11 校验/装配/回写、12 合成 |
| `mediaGeneration` | `generateImage/generateVideo/generateAudio`（直生兜底；参数 quality/secondPass/preview/seed/takes/partPrompts/refineFrom/continueFrom）；`listMediaModels`（模型实存与能力）；`planVideo`（长镜分块预检，拿 `chainPlan.blocks`）；`askVlm`（成片三问抽查）；`music`（引擎配乐，caption 英文） | 11 兜底派工与预检、12 验收与配乐 |
| `ffmpeg` | 固定 method 枚举的合成/探测动作 | 12 合成链（一般经 composite 间接使用，不裸调） |
| `askUser` | title/question 必填；多问题用 `fields`，字段名小驼峰；不传 options 又非 fields 会参数校验失败 | 各册确认与授权提问 |
| `assetOperator` | 见其工具面说明（素材导入） | 07 素材落节点 |

缺哪条通道报哪条：本轮没有 `planOperator` 就无法校验/合成，如实报告"需要 Toonflow 服务端工具面"并继续文字部分；不猜同名 HTTP 路径、不用文件工具手写 `plan/` 产物代替工具。
