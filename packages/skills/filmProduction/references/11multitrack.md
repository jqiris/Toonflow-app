# 11 多轨执行（提示词 → story.mtrack → 逐镜派工生成）

10 册定稿后按本册落工程与生成。**执行层只搬运定稿内容**：不重新分段、不改拍法、不替换 Timeline；发现模型真实能力与定稿冲突→报告具体冲突、回 10 册受影响项，执行层不自造兼容提示词、不用节点默认模型静默替换已锁模型。

## 1 真源三文件与写者纪律

| 文件 | 内容 | 写通道 |
|---|---|---|
| `assets/assetCards.md` | C/SC/P/KF/S 资产卡 | 07 册写稿 |
| `plan/story.mtrack` | 工程唯一真源（global+clips） | 导入节点独占建；改内容 `node:editProject`；改状态 `planOperator mtrackUpdate`；**不手改 JSON** |
| `plan/assetIndex.json` | 卡号→图片节点索引 | 导入节点独占写（与工程一起先索引后工程） |

- `updatedAt` CAS 对账，谁先落盘谁更新；工程/索引任一已存在导入即**拒绝覆盖**——续接走 `node:bindProject({mode:"open"})`，作废重建是用户动作（请用户从文件树删/改名 `plan/` 两文件），agent 不绕过独占写、不擅自回滚。
- 画布节点是执行载体，画布 JSON 不存业务语义；素材文件保留宿主返回位置（`assets/<nodeId>/`），不为整理搬动。
- 单写者：同一时刻一个写者持有工程；两个编辑器同开视为非法。

## 2 落工程顺序（固定，颠倒必爆）

1. **定调**（缺则补，已确认沿用）：画幅 `ratio`（9:16/16:9/1:1/4:3/3:4）、`global.style` 一句风格模板（`<画法/成像>+<材质与光线>+<色彩与影调>+<镜头质感与颗粒>+<统一排除项>`，按题材实改别只写"电影感"；**多风格分区项目留空、分区句进各卡正文**）、`global.systemPrompt` 全片硬约束（"所有人物同一套服装""不出现现代物件""无字幕水印"）。⚠️ **`global.style/systemPrompt` 只在资产出图时被自动拼进卡提示词；视频派工不注入——全片约束必须已逐镜写进六段本体，没有机制替你补。** 单镜时长区间建议 4–15s。没工程时三个定调值随导入参数写进新工程，**不为写 global 先建空工程**；已有工程 `setGlobal`。
2. **导入定稿**：`node:importScript` 会话已定稿走 `extraction`（`{style, systemPrompt, assets[], shots[]}` 整批校验落盘，秒级零模型调用；Agent 侧单次调用有 120 秒硬顶，逐张抽+逐张出图多半撞顶，撞顶后已建节点不回收——定稿必走 extraction）。`generateImages:true` 才出图。`refs` 先 `planOperator resolve` 结算再原样填。抽取通道原样保留正文六段，缺段才补；导入时改某镜用 `clips` 参数按 clipId 覆盖 `{prompt, seconds?, referenceIds?, continuity?}`——其中 **referenceIds 是唯一允许 agent 预写的例外**：仅当连线已就位、位次就是你要写的那组时用它同步；界面还没打勾时**不要靠它绕过第 6 门**（勾选仍是位次的最终事实源，改完必回读核对）。**门口自检**：`shots[]` 引用不存在的卡会被**静默掐掉**——传前逐条过：每镜 `referenceIds` 能在 `assets[]` 找到；被引用的卡都在清单；衍生卡带 `refs`；`shots` 数量=分镜稿段数。半套稿会静默落成工程、派工才爆、重跑又被独占写拦。
3. **校验清零**：`planOperator parse`（卡）→ `validate`（V7 标记越界/旧占位符、V8 图≤9 音≤1、V11 结构+首镜 shot、V12 时长分辨率、V15 位次与画布一致、V16 续接 ≤3 参考 ≥10s）。**error 清零才许进下一门。**
4. **绑工程**：`node:bindProject({mode:"open", path:"plan/story.mtrack"})`——漏了表现为"工程是空的"。
5. **连线**：`connectNodes` 把这次要用的资产图片节点接多轨节点 `in` 端口（连线只承载素材，不承载剧情、阶段、审批）。
6. **打勾生位次**：多轨界面「参考素材」逐镜勾选——清单只列连线上的卡、单镜上限 4、**勾选顺序=referenceIds=官方标记位次基数**；agent 不预先写 referenceIds；断线旧引用只在提示条点名给一次"清掉旧引用"（会同步改写正文标记位次，改完重核段首与位次）。
   **三个参考上限为什么并存（按链路各管一段，别混用）**：常规多轨链路以**界面勾选 4** 为准（供应商声明 imageReference:4，勾到 4 就点不动）——所以写六段时 `<Picture N>` 的 N 实际最多到 4；**校验器 V8 允许图片 ≤9** 是给旧工程与 `editProject patch` 手工写 referenceIds 的兜底上限，不是让你往界面塞 9 张；**续接镜（context）合计 ≤3** 是引擎硬限制，优先级最高。判断顺序：先按衔接定 `context`（≤3）或 `shot`（界面 ≤4），patch 例外才看 9。
7. **核对断点**：`node:readReferenceMap`：`missingCardIds` 非空=真断点（派工必报"参考图未就绪"）｜`unconnectedCardIds`=有产出没连线→补线｜`orphanSources`=多连。**这门没做完就派工=把同样的检查让派工再拦一次。**

## 3 clips 字段口径（镜头规划成果 → 工程字段映射）

| 制作成果 | 工程落点 |
|---|---|
| 生成单元 `generationUnits` | 一个 `clip`（`clipId: S001` 起递增；定稿后改号或顺序=换基线，受影响接线与已生成镜头重新对账） |
| 单元时长 | `seconds` 整数 2–60；建议 4–15；超了拆镜不加速不吞字；实际吸附帧档（6s→6.583s），总长以实测 |
| 镜头 1/2/… | `detailedDescription` 内 `[Shot n]` + `At MM:SS.mmm` 切点（双层时间，不是一 clip 一镜头） |
| 资产 ID | `referenceIds`（必须在 assetIndex 且已出图，V13）；`mode`: `ref` 多图/`image` 单图首帧（要首帧必须显式写，推断不出；单图且非承接时才作 firstFrame 下发）/`text` 纯文。**多轨通道没有尾帧槽位**：09 登记的尾帧/首尾帧需求在派工时无处落地——要锁结尾状态，改为在下一承接镜用 `context`+绝对初始状态重述，或走 `mediaGeneration generateVideo` 直生通道（其 schema 支持首尾帧）单独出该镜，不谎称多轨已支持 |
| 连续性判定 | `continuity`（见下） |
| 六段提示词 | `prompt` 六驼峰字段，段首标签由作者写在字段首行 |
| 描述性备注 | `notes`（不参与提示词下发，不当系统提示词读） |

每镜 `ratio` 写全（缺省不跟随 global，会静默落 9:16）；`resolution` 只有 `768P`/`2K`。

## 4 衔接判定（shot/context，默认能承接就承接）

| 情况 | 用 | 判据 |
|---|---|---|
| **默认：同段落同空间，画面/动作接上一镜** | `context` | 上一镜已成功且 attempts 有 jobId；本镜 ≥10s；参考合计 ≤3 |
| 换场 | `shot` | 硬接会把上一镜空间带进来 |
| 时间跳转/闪回 | `shot` | 上镜末帧不是本镜起点 |
| 新段落第一镜需重新交代空间机位 | `shot` | 承接会把上镜机位运动带进来 |
| 本镜 <10s 或参考 >3 | 改到 ≥10s 减参考后承接，否则 `shot` | 引擎硬限制，做不到就不承诺承接 |
| 首镜 | `shot` | 无上一镜可接，V11 拒 |

连续动作、对话、反应镜头**默认 context**——一整片几乎全 shot 通常判错了；反之强行 context 让构图建立白做。拿不到 jobId 直接报错不静默降级：先生成上一镜，或显式改 shot。**批次是串行的**（按 clips 顺序逐个，上镜出结果才开始下镜），同批可混用两态；上镜失败下镜 context 会跳过，修好后 `node:resumeBatch` 同批续跑。

## 5 派工与逐镜参数

- 优先派工链路：批量 `node:dispatchGenerate({clipIds 或 from+to})` → 立回 `{batchId, skipped}`；单镜 `({clipIds:["S003"]})`。进度 `node:getStatus`/`mtrackRead`，不 tight loop。
- 逐镜参数（默认即引擎默认，写稿阶段不填）：`quality` light/medium/high/max（context 镜只能 light/medium）、`secondPass`（context 必开）、`preview`（仅 <30s 非 context；预览转正片用 `refineFrom: <jobId>` 精修**不重生成**）、`seed`（**同种子+同提示词产物逐字节一致**——满意镜头要只改周边参数重派时，先 `readClips` 读回 seed 带上）、`takes` 1–8（高废片率动作镜直接 3，第一条成默认；带 seed 候选逐条 +1 整批可复现）、`partPrompts`（>30s 分块长镜才用，条数必须等于 `planVideo` 预检 `chainPlan.blocks` 数，逐块写各自要演的剧情不重播整段）、`loras`（只从 `engineProfile` 已装清单逐字选）、`continueFrom`（仅 context 消费，显式优先于隐式上镜链）。**上限与区间一律 `POST /api/ai/media/engineProfile` 现查，不写死经验值。** agent 控参数：先 `node:editProject patch` 写本镜字段再派工；回写前先读别覆盖用户设置。
- 复杂转场/多人动作/连续运镜可先 3D 导演台预演（`remote-director3dNode`：优先 `node:applyPlan` 自写场景文档零模型调用；导出关键帧接多轨同走连线+打勾；**预演成果是参考素材不是成片，验收不因预演跳过**）；白模只定构图机位走位不保长相（`node:whitebox`，代码自己写，需用户打开 FreeVideo 页面）。
- 回写：走派工时编辑器自己写；直生兜底成功当场 `mtrackUpdate`（status+assetPath+带 jobId 的 succeeded attempt），**禁止把回写推迟到用户说"通过"后**——否则工程里没有、界面看不到、下镜承接不到。`mtrackUpdate` 带 `expectedUpdatedAt`；attempts 按 `at` upsert 只传变更项。
- 状态机 `pending→generating→generated→(人点)accepted / failed→pending 重试`；**agent 只写前四态；`accepted` 只能用户在多轨界面点**。写 `generated` 前必须真实读到产出文件，读不到只能 `failed`+原因。`generating` 只表示已开始；本轮无等待能力就登记在跑、告知完成后回来续，不伪造后台轮询。切换画布/项目/关页可能中止请求，恢复后重新发现状态。

## 6 实测硬守卫（每条都对应一次真实翻车，不做必炸）

1. **模式判定不写死**：`mode` 必须按**当前实际参考集合**（含文本端口、空端口）读 `node:getConfig` 返回的 `matchingModes` 再选——"4 图就是多参考"这类经验值会漂移。
2. **`generating` 不是可信终态**：换轮/换会话先用 `node:readClips`/`getCanvasNodes(fields:["outputs"])` 读产物再判断，**严禁用节点 idle 推断"没生成"**（会重复提交烧算力）；批次中断同理，先对账再决定续跑还是重派。
3. **重 roll 保画面走 seed**：直生路径先 `node:getConfig` 读回该节点 `config.seed` 原样带回（同种子+同提示词逐字节一致，实测）；`seed:null` 清空、省略不改。多轨镜走 `editProject patch.seed`。
4. **续接链只认默认版本 jobId**：多版本时取与该镜**当前默认版本同键**的 succeeded attempt；改过默认版本，后续承接镜的续接来源随之变化（`continueFrom` 显式值优先）。
5. **生成中不改工程**（快照语义：任务按提交时快照运行）；必须改就先停该镜（`node:pauseBatch`/`cancelBatch`），改完重新提交该镜。
6. **失败不自行"跑通"**：不得自行降分辨率、缩时长、换模型、删参考来让提交通过——这些改变交付语义，报告原文让用户决定。用户改了参数（时长/分辨率/参考/提示词）后，**重走配置与展示流程并重新确认**，不在原批准上叠加。
7. **`dispatch` 清单里的 providerId/modelId/mode 全是"待 getConfig 决定"**，不得写死；`dispatch` 不做校验，校验必须先 `validate` 清零；`dispatch` 必须同时给 `from`+`to`。
8. **位次漂移（R9）**：每改一次 `referenceIds` 或连线，重新核对正文 `<Picture N>/<Video N>/<Audio N>` 位次并重新写入提示词；`editProject patch.referenceIds` 只在用户明确要求批量改写时用，编辑校验同场拦 ≤9、去重。
9. **装配依赖**：`planOperator assemble` 在 `assetIndex.json` 缺失时**静默丢片段→资产参考边**（只尾追 warnings）——顺序固定 validate 清零→索引就位→assemble；分层生成必须先基础图后衍生图（拓扑序），前序层有未成功节点时引擎拒绝开下一层，不允许静默跳过。
10. **整理本镜提示词**（`node:rewritePrompt`）：内置硬纪律永远追加不可被规则覆盖——原文按官方段名分段的**保留段名段序逐段整理，不得压成一段**；参考标记只保留已有的原样，禁止新增旧占位符。整理结果采用前与原文基线核对，基线（画面描述/时长/规则）变了必须重新整理。
11. **concat 规格必须先探针拦截**：尺寸不一致 ffmpeg 会直接报错但信息不含尺寸线索；**帧率不一致与音轨不一致会静默成功产出错乱成片**——这正是合成前必须逐段验规格（ffprobe 挡在编码之前）的理由，不能只靠合成失败回补。

## 7 授权与临执行复核（烧算力前的最后闸）

1. 固定本次方案：对象与数量、完整提示词、参数（模型/画幅/分辨率/时长/quality/seed/takes）、参考文件与用途位次、执行次数，展示并取得**消耗算力授权**（统一称"消耗算力"，查不到写"算力消耗未知"，对话 Token 不算媒体消耗；展示必须含费用行，不得用"很快""不花钱"替代具体数值）。
2. 已批准的同一具体方案或批次不逐镜重复问；新增数量、换方案、额外重试→核对授权覆盖后补问。普通"继续"、沉默、表单失败不构成新生成授权。
3. **临执行复核**：用户回复后重读工程与配置，比对节点、提示词、模式、声音、引用位次与数量；变化了：仍匹配的对象沿用，受影响对象重展差异再授权。不以"已确认"执行界面后来改过的配置。读回复核非原子：并发编辑时保留尝试快照标"依据待核实"。
4. 失败先确认真实状态与原因，返回不明确**不盲重试**；换方案与额外尝试核对授权。

## 8 单镜重做与版本

重生成=追加新版本（`assets/<clipId>/` 新文件，旧产物不覆盖）；版本列表=`attempts` 有产物条目按路径去重；切默认只改指向不改状态、不追加尝试。重 roll 保满意镜头：带原 seed 只改要动的参数。动作戏高废片率用 `takes: 3` 一次出候选（用户版本菜单挑默认；承接链只认默认版本 jobId）。**生成中的镜头禁止删版本**；`stale`（参数签名/时间线位置/续接来源三条件比对）是派生值不落盘，agent 侧不做删除版本操作。局部修改只同步受影响的动作、时间、引用与后续状态，**不覆盖无关的已验收镜头**。

## 9 故障对照

| 现象 | 原因 | 处置 |
|---|---|---|
| `参考图未就绪：C01 …` | 卡没出图或 label 漂 | 补图；`readReferenceMap` 看 missingCardIds；label 改回 `<卡号> <名称>` |
| 派工成功但没参考效果 | 没连线/位次错 | `unconnectedCardIds`、`expectedRef` vs 实际位次；重打勾重核 |
| `已存在，未覆盖` | 独占写 | `bindProject open` 续接；重导请用户先清理 |
| `mtrackUpdate 冲突` | 他人改过 | 重新 `mtrackRead` 取新 updatedAt |
| 「上一镜没有可用的生成任务号」 | 上镜未成功 | 先生成上镜 / `resumeBatch` / 显式改 shot |
| `build 被拒绝：N 条 error` | 校验没过 | 读 findings 清零 |
| 承接镜被拒 | <10s/参考>3/light-medium 外/secondPass 关 | 按判据修，不硬凑 |
| `dispatch 需要 from 与 to` | 缺一即报 | 补齐区间参数，不重试同参数 |
| `合成输出已存在：…不自动覆盖` | 输出路径占用 | 换输出路径或用户确认后删除 |
| `合成清单顺序不连续（V14）` | accepted 有空洞 | 补齐断点镜头或去掉空洞再合成 |
| `合成片段规格不一致，concat 会失败…` | 混了不同画幅/分辨率 | 同规格重生成后再合成（见 §6-11） |
| 合成报 `ffmpeg exited with code 234` | 尺寸不一致绕过探针 | 回 §6-11 逐段验规格 |
