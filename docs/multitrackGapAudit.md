# 多轨编辑器界面与服务端差距清单（对照 LocalStoryCanvas）

> 审计对象：本仓库 `packages/nodeShared/src/mtrack/`、`packages/nodes/multitrackNode/`、`packages/tools/planOperator/`、`packages/nodes/videoGenerationNode/`、`packages/providers/src/media/freevideo.ts`、`apps/server/src/routes/`
> 参考实现（只读）：`C:\workspace\super-ai\LocalStoryCanvas`（下文简称 LSC）
> 性质：只读调研，未改动任何业务代码。
> 结论口径：**已走通** = 界面可触发且服务端/画布链路闭环；**部分走通** = 有能力但没有界面入口，或界面有入口但只覆盖一半；**完全缺失** = 两侧都没有对应实现。
> 版本注记（ref2va 六段改造后）：文中关于 `buildPrompt` 的旧行为描述（自动拼资产定义段 / 摘要段 / 参考保持分析段、追加段尾「本段参考顺序」声明行、只拼 `clip.prompt` 三字段而不读 `global`）属**审计时快照**，已不适用于现行代码——现行实现不再代写任何段、不再追加参考顺序声明，且会把「全片风格 / 全片约束」作为前缀拼进正文；六段由写作者直接书写。

---

## 0. 一页结论

我们与 LSC 的差距不在「能不能生成一镜视频」——单镜/选段生成、逐镜串行、失败自动续跑下一镜、整批取消都已走通，甚至取消能力比 LSC 更强（LSC 的 `scene-jobs` 只有 `pause`，没有整批 cancel）。

真正的断点在**批次这一层**：

1. **批量生成面板不存在**。LSC 有一套完整的批次 UI（范围输入 `start/count`、`第 i/N 镜` 进度条、单镜 redo、镜间暂停/继续、自动合并开关），我们只有「选段 + 生成选中段 + 取消批次」三个按钮，进度靠轨道色块和 `attempts` 文本自己看。
2. **生成循环活在浏览器内存里**，节点卸载/刷新即断轮询，工程里 `status=generating` 会永久卡住；LSC 把 job 落盘，重启后 `load()` 主动降级为 `paused` 并提示「点击继续会先找回已提交任务，不会自动重复生成」。我们连「已 succeeded 但 UI 未回写」都无对账入口。
3. **合成（merge）只有工具、没有界面**。`planOperator composite` 已能出清单 + ffprobe 校验 + concat，但只能由对话模型调用；多轨卡片上的「成片」只是读 `plan/composite.json` 的展示位。
4. **工程级设置是「能改、能存、但不生效」**（审计时口径）：`global.style` / `global.systemPrompt` 在界面可编辑、随工程落盘，但审计时 `directDispatch.buildPrompt()` 只拼 `clip.prompt` 三字段，这两个字段从未进入生成提示词（现实现已把二者作为「全片风格 / 全片约束」前缀拼进正文）；`global.ratio` / `global.model` 连界面控件都没有。

---

## 1. 总表

| # | 能力 | LSC 位置 | 我们现状 | 缺口 | 优先级 | 预估改动面 |
|---|---|---|---|---|---|---|
| 1 | 单镜 / 选段生成 | `native-h3-scene.js:1489`（run 提交）、`:1821-1830`（单段 run start=index,count=1）；`native_h3_scene.py:741`（action=run） | **已走通**：`multitrackEditor.vue:612-657` `launchDispatch` → `directDispatch.ts:217-261` 逐镜建节点/接线/配参/写提示词/生成/轮询 | 无 | P2（已完成） | 0 |
| 2 | 批量范围选择（起始段 + 段数 / 勾选分镜） | `native-h3-scene.js:1348`（`从第几个镜头开始` + `生成镜头数（-1表示到最后）`）；`native_h3_run_range.py:6-11` | **部分**：轨道点选 / Ctrl 追加 / Shift 区间（`trackBar.vue:68-70`、`multitrackEditor.vue:420-438`）+ 「包含已生成」（`dispatchBar.vue:6`）+ 命令式 `from/to`（`multitrackNode/src/index.vue:373-380`） | 无「起始段 + 段数」数字输入；无「范围外镜头不必补提示词」的选段校验（`plan_run_range` 语义）；无「合并时带上前面已完成镜头」 | **P0** | `dispatchBar.vue` +60 行、`multitrackEditor.vue` +30 行 |
| 3 | 逐镜进度 | `scene-video-batch.js:90`（`<progress max=shots.length>` + message）、`:35`（`N镜 / 共N秒 · W×H · 24fps · 逐镜串行`）；`scene_video_jobs.py:299`（`第{i}/{n}镜正在生成，逐镜执行`）；`native_h3_scene.py:598`（`第{index+1}段`） | **部分**：轨道色条（`trackBar.vue:15`、`:136-154`）+ 单镜 `attempts` 列表（`statusPanel.vue:14-18`）+ `node:getStatus` 的 `batchClipIds` | 无批次级「第 i/N 镜 · 正在生成」状态行，无进度条，无「本批还剩几镜」；`attempts` 要逐镜点开看 | **P0** | 新组件 `batchProgress.vue` ≈120 行 + `multitrackEditor.vue` +40 |
| 4 | 单镜重试 | `scene-video-batch.js:85-86`（`修改并重做本镜` / `核对原输出后重新提交本镜`）；`scene_video_jobs.py:403-428`（redo / retry-missing）、`:325-334`（`reset_shot` 把旧 result/attempt 推进 history） | **部分**：勾选单镜 + 勾「包含已生成」+「生成选中段」可重跑；`attempts` 追加留痕（`multitrackEditor.vue:591-605`） | 无 per-clip「重试」按钮；无「只重试失败镜」一键；无「旧结果进 history 且可回看版本」；`retry-missing`（提交记录丢失时的谨慎重提交）语义完全没有 | **P0** | `clipEditor.vue` +30 行、`multitrackEditor.vue` +40 行 |
| 5 | 暂停 / 继续 | `scene_video_jobs.py:293-296`（镜间检查 `pause_requested`）、`:394-396`（`将在当前镜头完成后暂停，不强行中断模型`）、`:429-432`（resume 重置 failed 镜）；`native_h3_scene.py:762-771`（pause / continue） | **完全缺失**：`directDispatch.ts` 只有 `AbortSignal` 全停（`:238` `signal.throwIfAborted()`），没有「跑完当前镜就停」的闸门 | 无暂停、无继续；暂停语义（不中断在跑镜头、保留已完成、不重复生成）整条都没有 | **P0** | `directDispatch.ts` +25 行、`multitrackEditor.vue` +60 行、`dispatchBar.vue` +15 行 |
| 6 | 整批取消 | LSC **无**整批 cancel（`scene_video_jobs.py:436-437` 未知操作即拒；`native_h3_scene.py:772` 只有 `finish` 结束本批、素材保留） | **已走通且更强**：`launchCancel`（`multitrackEditor.vue:663-702`）abort 本地循环 → 逐镜 `node:cancelGeneration` → 回写 `pending` + `attempts.status=cancelled`；界面按钮 `dispatchBar.vue:11`；命令式 `node:cancelBatch`（`multitrackNode/src/index.vue:393-403`） | 无（相对 LSC 是优势项） | P2（已完成） | 0 |
| 7 | 生成队列与并发 | `scene_video_jobs.py:281-314`（`async with media.SERIAL, studio.LOCK` 全局串行、逐镜 for、`shot.status=='done'` 跳过）、`:143-148`（`ensure_idle` 全局闸门）、`:317-322`（launch 注册 TASKS） | **部分**：串行 ✅（`directDispatch.ts:236-237` 注释「本机 GPU 串行更稳」）；失败自动下一镜 ✅（`:256-259` catch → `onFailed` → 继续）；**无**队列持久化、无进程级闸门、无「已有别批在跑就拒绝」 | 队列只活在页面内存；两个标签页/两个节点可同时派工抢显存；进程重启队列即蒸发 | **P1** | 新增派工注册表（node 侧或 server 路由）≈200 行 |
| 8 | 成片合并 / 拼接 | `native_h3_scene.py:556-583`（`merge_files`：逐段 `context_ok`、ffprobe 比对编码签名、单段直取、多段 concat 清单 + `-c copy`、合并后帧数核对）、`:780-787`（action=merge 手动合并勾选镜头）；`scene_video_jobs.py:258-278`（`merge_job`：未全部完成拒绝、`merged_signature` 幂等、单镜直取、多镜 `assemble`）；界面 `native-h3-scene.js:1340`（合并勾选镜头）、`:1509`（POST merge） | **工具已走通 / 界面缺失**：`planOperator` 的 `composite`（`src/index.ts:524-530`）只拼 `accepted`、V14 复核、`verifySegmentSpecs` 逐段 ffprobe（`composite.ts:122-143`）、`execute=true` 走宿主 ffmpeg concat（`index.ts:668-706`），产物 `plan/composite.mp4` + 清单 `plan/composite.json`；多轨卡片「成片」行 + 刷新按钮只读清单展示（`multitrackNode/src/index.vue:197-209`、`:21-27`） | 界面无「合成」按钮 → 只能靠对话模型调工具；无「验收 accepted」入口（合成前置条件在界面上无法完成）；无勾选任意段合并（我们只能按 accepted 全量顺序拼）；无 `-c copy` 无损路径（走 concat 滤镜重编码） | **P0** | 新 node 函数 `compositeOutput` + `multitrackNode/src/index.vue` ≈80 行、`multitrackEditor.vue` +50 行 |
| 9 | 剪辑时间线设置 / 整理本镜文字 | `local_video_timeline.py:92`（`GET /api/local-media/timeline-settings` 返回 LoRA 目录 + 内置 H3 规则 system_prompt）、`:101-136`（`POST /api/local-media/rewrite-shot`：`allow_configured_model` 必填、生成中 409、返回 `{text, requires_review:true}`）；界面 `video-timeline.js:49`、`:75-80`（`整理本镜提示词` + 结果 textarea + 「本镜采用（不覆盖原文）」）、`:97`（改写基线一致性守卫） | **已走通（整理本镜，2026-10-22）**：`POST /api/mtrack/rewriteShot`（`apps/server/src/routes/mtrack/rewriteShot.ts`，`router.ts:76` import、`:207` 注册）已有 `rules` 可选覆盖内置规则、本工程任一镜头生成中 409、返回 `{text, requiresReview:true}`；界面入口「整理本镜提示词」在 `clipEditor.vue`（emit `rewrite` → `multitrackEditor.vue` 的 `rewriteClipPrompt`），结果进「待采用」区块，人工勾选「采用整理结果」才写回，原文/时长/规则变化即禁用采用（一致性守卫） | 时间线设置部分**不适用**（本机 LoRA 目录 + 全片规则文本对这仓不适用，理由见 §2.5）；整理规则是请求级一次性指定，不做全片持久设置 | P2（整理本镜已完成） | 剩余可选项：把整理规则做成工程级设置（当前按 YAGNI 不做） |
| 10 | 九宫格拆图与建工程 | `h3-grid-multitrack.js:71`（`自动拆分到 9 个镜头`）、`:189`（`POST /plan {standalone:true}`）、`:204-211`（拼 9 个 segment：prompt/seconds/continuity/mode/reference_ids）、`:217`（`POST /projects`）、`:222`（`openMultitrack`） | **部分**：`imageGridSplit.vue:17-37`（2/3/4/5 宫格 + 自定义行列）、`:111-194`（canvas 逐格切分 + 上传 + `addNodes` 建 `remote-imageNode`）——**只产图片节点**，不建多轨工程、不写 segments/prompt/时长 | 缺「拆图 → 建多轨工程（每格一镜、每镜 reference 指向该格、给默认时长）」这条链；拆图与多轨是两个孤立功能 | **P1** | `imageGridSplit.vue` +120 行或新增「拆图建工程」动作 |
| 11 | 工程级设置（比例/风格/systemPrompt/模型） | `native-h3-scene.js:1332`（`ratio` 8 档 + quality）、`:1345`（`common_prompt` / 项目 `system_prompt` / 本镜 `system_prompt`） | **部分（关键缺口）**：界面只有「全片风格」`global.style` 与「系统提示词」`global.systemPrompt` 两个 textarea（`multitrackEditor.vue:73-95`），经 `onGlobalPatch`（`:466-469`）落盘；`global.ratio` 与 `global.model` **无 UI**（只能 `setGlobal` op 或命令式，`mtrackEdit.ts:141-148`）；**且 `buildPrompt` 不读 global**（审计时口径：`directDispatch.ts:83-96` 只拼 `clip.prompt` 三字段 + 参考顺序；现实现已拼「全片风格 / 全片约束」前缀，且不再追加参考顺序声明） | ① 改风格/系统提示词对生成**零影响**（死字段）；② 无全片比例下拉；③ 无视频模型选择器（`global.model` 只能命令式写入，`launchDispatch` 才把它传给 `configureNode`） | **P0** | `directDispatch.ts` +8 行（真正生效）、`multitrackEditor.vue` +60 行（ratio/model UI） |
| 12 | 状态回写与断点续跑 | `scene_video_jobs.py:37-49`（`load()` 把 `ACTIVE` 强制降级 `paused` + 文案「后台曾重启。点击继续会先找回已提交任务，不会自动重复生成」）、`:290-292`（`shot.status=='done'` 跳过不重做）、`:174-255`（attempt 状态机 new→submitting→submitted→raw→normalized→done，`lost`/`unknown` 显式不重提交）；`native_h3_scene.py:593-600`（`index in run['done']` 跳过） | **部分**：在线回写 ✅（`writeClipRun` 写 status/nodeId/assetPath/attempts，`multitrackEditor.vue:591-605`）；**离线/重启后无对账**：`onMounted` 只 `probe + readProject + loadReport`（`:879-883`），全文件无「按 nodeId 回读 `outputs` 纠正 status」的逻辑；`useNodeGeneration` 的 status 是纯内存（`useNodeGeneration.ts:6`），节点卸载即丢；freevideo 每次新 `ref`、不落 jobId（`freevideo.ts:187-192`），已 succeeded 的任务无法找回 | ① 重启后 `status=generating` 永久卡住（已知「freevideo job 已 succeeded 但 UI 未回写」即此类）；② 无 `lost`/`unknown` 与「确定失败」的区分，重试等于无条件重提交；③ 无断点续跑（不会跳过已完成镜继续跑剩余） | **P0** | `multitrackEditor.vue` 新增 `reconcile` ≈80 行 + `onMounted` 调用；`directDispatch.ts` +20 行 |

---

## 2. 逐项证据与判断

### 2.1 单镜 / 选段生成（已走通）

链路完整且与 LSC 语义等价：选段 → 复用或新建 `videoGenerationNode` → 接参考图并写 `referenceOrder` → `node:setConfig`（时长/分辨率/比例/声音，有 `global.model` 时下发模型）→ `node:setPrompt` → `node:generateVideo` → 2 秒轮询 `node:getGenerationStatus`（单镜上限 1 小时）→ 取 `outputs.video.value.url` 作 `assetPath`。

- `directDispatch.ts:24`（`pollDelay=2000`）、`:26`（`pollLimit=60*60*1000`）、`:28`（`nodeGap=480`）、`:199-209`（`waitForSettled`）
- `directDispatch.ts:112-135`（`ensureNode`）、`:138-174`（`connectReferences`）、`:177-196`（`configureNode`）
- 界面：`dispatchBar.vue:9`「生成选中段」；命令式：`node:dispatchGenerate`（`multitrackNode/src/index.vue:370-391`）

LSC 的对应入口在 `native-h3-scene.js:1489`（POST `/projects/{id}/run`）与 `:1821-1830`（单段直跑 `start=index+1, count=1`）。差异只在后端由谁跑循环：LSC 在 Python 进程里，我们在浏览器里经画布 `nodeTools`。

### 2.2 批量生成面板（部分：范围有一半，进度/重试/暂停缺失）

**已有**：
- 轨道多选：单击单选 / Ctrl 追加 / Shift 区间（`multitrackEditor.vue:420-438`、`trackBar.vue:68-70`），选段文案显示标题而非 clipId（`dispatchBar.vue:36-43`）
- 派工范围过滤：默认只派 `pending`/`failed`，「包含已生成」放行 `generated`/`accepted`（`multitrackEditor.vue:560-561`、`:567-577`）
- 三条拒绝文案齐备：「请先在轨道上选择要生成的分镜」/「选段内没有可生成的分镜…」/「当前没有工作目录，无法发起生成」

**缺**：
- 「从第 N 段开始 + 生成 N 段（-1 到最后）」数字输入。LSC 的 `plan_run_range`（`native_h3_run_range.py:4-11`）还顺带做了一件我们没有的事：**只校验本次范围内的段有没有提示词**（`第{index+1}段缺少提示词。本次范围以外的镜头无需补填。`）——我们当前没有这条选段校验，范围外缺提示词的镜头会阻断整个派工（`directDispatch.ts:245`「该镜没有提示词，请先补全画面描述」直接抛错）。
- 批次进度：无 `第 i/N 镜` 行、无 `<progress>`、无「本批剩余」。
- 单镜重试按钮：只能靠「勾单镜 + 包含已生成 + 生成选中段」绕。
- 暂停/继续：整条缺失（见 2.3）。
- 自动合并开关：LSC `native-h3-scene.js:1348` 有「完成后自动合并」+「合并时带上前面已完成的镜头」；我们无。

### 2.3 生成队列与并发（部分）

**已走通**：
- 串行：`directDispatch.ts:236-237` `for (const [index, clip] of clips.entries())`，注释「ACT: 逐镜串行——本机 GPU 串行更稳」
- 失败不阻断：`:256-259` 单镜 catch → `hooks.onFailed` → 循环继续下一镜
- 取消：`beginDirectCancel`（`:285-313`）逐个 `node:cancelGeneration`，节点已卸载时跳过不报错

**缺**：
- **暂停**。LSC 的暂停语义是「当前镜跑完再停，不强行中断模型」（`scene_video_jobs.py:293-296`、`:394-396`），我们只有 abort 硬停；`dispatchKind`（`multitrackEditor.vue:552`）只区分 generate/cancel，没有 paused 态。
- **队列持久化与全局闸门**。LSC 每 job 一个 JSON（`scene_video_jobs.py:18`）、`ensure_idle` 拒绝并发批（`:143-148`）、`media.SERIAL + studio.LOCK` 进程级串行（`:285`）。我们的串行只在单个浏览器标签页的 `for` 循环里——两个节点/两个标签页同时派工就并行抢显存，且进程重启即丢。
- 断点续跑：LSC `shot.status=='done'` 直接跳过（`:290-292`），重启后「继续」只补未完成的；我们没有这一层（重新点「生成选中段」时靠 `includeFinished=false` 天然跳过 generated，但 `generating` 卡住的镜头会被跳过、永远不再跑）。

### 2.4 成片合并 / 拼接（工具已通、界面缺失）

对应关系：LSC `merge_files` / `merge_job` ≈ 我们的 `planOperator` `composite` action。

- 清单：`composite.ts:159-207` `planComposite`，只取 `status==="accepted"`（`:175`），无 accepted 直接抛「没有 accepted 片段可合成：请先在多轨编辑器里把要合成的片段验收为 accepted」（`:177`）
- 顺序：V14 复核，不连续即抛（`:180-185`）
- 规格：`verifySegmentSpecs`（`:122-143`）逐段 ffprobe 比对 `宽x高/fps/pix_fmt/音频参数`，不一致抛「合成片段规格不一致，concat 会失败或产出错乱成片」（`:130-132`）；声明 `seconds` 与实测差 >1s 只记 warning（`:135-139`）
- 执行：`index.ts:668-706`，`execute=true` 才真跑；输出已存在拒绝覆盖（`:673-675`）；产物 `plan/composite.mp4`，清单 `plan/composite.json`
- 展示：`multitrackNode/src/index.vue:197-209` 读清单，`executed` 为真才把成片挂到 video 输出端口；卡片「成片」行（`:21-27`）

与 LSC 的差异（值得抄的）：
1. LSC 支持**勾选任意段合并**（`native-h3-scene.js:1509` `indices`），我们只能按 accepted 全量顺序拼；
2. LSC 多段走 `ffmpeg -f concat -c copy`（`native_h3_scene.py:577-578`）无损，合并后再核对帧数（`:579-582`）；我们走 concat 滤镜重编码（文档 `docs/multitrackProductionPlan.md` §10.9 已记录规格不一致时尺寸报错、帧率/音轨静默出错的实测行为）；
3. LSC 有 `merged_signature` 幂等（`scene_video_jobs.py:262-264`），重复合并不重跑；我们靠「输出已存在就拒绝」。

**界面断点**：多轨编辑器里没有「合成」按钮，`accepted` 也没有验收入口（`clipEditor.vue` 无 status 控件），所以「验收 → 合成」这条人在环上的闭环在界面上是断的，只能由对话模型调 `planOperator` 完成。

### 2.5 剪辑时间线设置 / 整理本镜（整理本镜已走通；时间线设置不适用）

> **2026-10-22 更新**：本小节的审计原文记于 rewriteShot 落地之前，保留在下方作为**历史状态**。现状：
>
> 1. **路由与界面入口都已存在**：`POST /api/mtrack/rewriteShot`（`apps/server/src/routes/mtrack/rewriteShot.ts`，`router.ts:76` import、`:207` 注册）；界面「整理本镜提示词」按钮在 `packages/nodeShared/src/mtrack/components/clipEditor.vue`（emit `rewrite`），由 `multitrackEditor.vue` 的 `rewriteClipPrompt` 接线调用。
 > 2. **本次补齐三项（对齐 LSC）**：①**结果不自动采用**——返回 `{ text, requiresReview: true }`（`rewriteShot.ts:100`），整理稿进单镜编辑器「待采用」区块（左原文只读、右整理稿可编辑），点「采用整理结果」才写回 `prompt.detailedDescription`，「放弃」原文一字不动；②**一致性守卫**——待采用期间原文画面描述、`clip.seconds`、本次整理规则任一变化即禁用采用并提示重新整理；③**生成中互斥**——服务端读 `plan/story.mtrack`，任一 clip `status === "generating"` 即 409「正在生成，请结束后再整理提示词，避免模型同时占显存」（判定 `rewriteShot.ts:42-66`，抛出 `:72`），工程文件不存在或全无 `generating` 时放行。另：`rules` 可选（≤20000，`rewriteShot.ts:22`），非空整段替换内置规则（`:88`），空/缺省用内置 `rewriteRules`（`:27-35`）。
> 3. **仍然没有 timeline-settings 等价物，且不打算做**：LSC 那份设置页一半是「本机 LoRA 目录」——它喂本机 ComfyUI 的 LoRA 清单，我们走供应商 HTTP（`freevideo.ts` 直连 MiniMax-H3），既没有本机 LoRA 目录也没有 ComfyUI 模型库，这个字段对我们没有对应物；另一半「内置 H3 规则文本」我们的对应物是 `rewriteShot` 的内置 `rewriteRules` + 请求级 `rules`，不需要一张全片设置页承载，也没有落盘全片整理规则的字段（`global` 只有 `ratio`/`style`/`systemPrompt`/`model`，其中 `systemPrompt` 至今不进入生成提示词，见 §2.7）。
>
> 结论：差距表第 9 行的整理本镜部分从**完全缺失**改为**已走通**（时间线设置部分标为不适用）；剩余可选项只有「把整理规则做成工程级设置」，当前按 YAGNI 不做。

**以下为 2026-10-22 之前的审计原文（历史状态，不代表现状）**

LSC 有两块：
- `GET /api/local-media/timeline-settings`（`local_video_timeline.py:92-99`）返回本机 LoRA 目录 + 内置 H3 完整规则文本，**不调模型**；界面在 `video-timeline.js:49` 读它。
- `POST /api/local-media/rewrite-shot`（`:101-136`）用当前 Agent 模型整理本镜文字：`allow_configured_model` 必填、生成中 409「正在生成，请结束后再整理提示词，避免模型同时占显存」、返回 `{text, requires_review:true}`；界面（`video-timeline.js:75-80`）保留原文、结果默认不采用、勾选才生效，并用 `rewriteBasis` 做一致性守卫（`:97`「第N镜的原文、时长或规则已变化，请核对整理结果后重新勾选采用」）。

我们这边（当时）：`apps/server/src/routes/` 全表无任何 `timeline-settings` / `rewrite-shot` / 批量队列路由；`clipEditor.vue` 只有时长、衔接、比例、分辨率、声音、参考顺序、三段提示词。**「用模型把本镜文字整理成提示词」这个动作在我们这里不存在**，用户只能手写三段提示词，或让对话模型在外面写好后粘贴。

### 2.6 九宫格拆图与建工程（部分）

我们已有的 `imageGridSplit.vue`（`packages/nodes/imageNode/src/components/imageGridSplit.vue`）：
- 预设 2/3/4/5 宫格 + 自定义行列 1–10（`:17-37`），预览网格（`:41-45`）
- `splitImage()`（`:111-194`）：canvas 逐格切分 → `uploadNodeFile` 上传 → `addNodes` 批量建 `remote-imageNode`（`:175`），预置 `data.outputs.image`
- **只产图片节点**，不建多轨工程、不写 `segments`/`prompt`/`seconds`/`reference_ids`

LSC `h3-grid-multitrack.js` 是另一条链：拆 9 格图 → 上传 → `POST /plan {standalone:true}` → 组装 9 个 segment（每镜 `continuity:'shot'`、`mode:'image'`、`reference_ids` 指向该格）→ `POST /projects` → 写 `parent.nativeH3ProjectId` 与 `nativeH3EditorUI={start:1,count:-1,includePrevious:false}` → `openMultitrack`（`:189-222`）。

即：LSC 是「拆图即建工程，拆完就能逐镜生成」；我们是「拆图只出图片节点，要建工程得再手动加 9 个片段并逐个挂参考图」。中间缺一个「把宫格结果写成多轨工程」的动作。

### 2.7 工程级设置（部分，且关键字段不生效）

**已走通**：`global.style` 与 `global.systemPrompt` 在「高级设置 · 全片约束」里可编辑（`multitrackEditor.vue:73-95`），经 `onGlobalPatch`（`:466-469`）改 `project.global`，走原有整份快照保存链落盘（含 CAS 冲突检测，`:371-397`）。

**缺口**：
 1. **这两个字段不参与生成**（审计时口径）。`directDispatch.buildPrompt`（`:83-96`）当时只取 `clip.prompt.detailedDescription / overallSoundscape / nonDiegeticMusic` + 参考顺序声明（现行实现只拼全片前缀并原样透传正文，不再追加参考顺序声明）；`launchDispatch` 传给 `beginDirectDispatch` 的也只有 `clips` 和 `videoModel`（`multitrackEditor.vue:625-631`），`global.style/systemPrompt` 从未下传。全仓 grep `global.style|global.systemPrompt` 只有四类引用：编辑器展示（`multitrackEditor.vue:81`、`:90`）、`normalizeProject` 归一（`mtrackProject.ts:157-158` 与 `planOperator/src/mtrackProject.ts:97-98`）、`mtrackEdit.setGlobal` 写入（`mtrackEdit.ts:144-145`）、模板文档说明（`skills/assetCard/references/multitrackTemplate.md:70-71`）——没有任何一处把它们拼进提示词。
2. **`global.ratio` 无 UI**：只在新建空白工程时写死 `"9:16"`（`:212`），之后只能通过 `setGlobal` op 改；而 `createClip` 会用 `global.ratio` 做新片段默认比例（`mtrackProject.ts:191-207`、`mtrackEdit.ts:78`）。
3. **`global.model` 无 UI**：只有命令式 `setGlobal{model:{providerId,modelId}}` 能写；写了之后 `configureNode` 才下发（`directDispatch.ts:191-194`）。界面用户无法选视频模型，只能靠节点自身默认值。
4. 无「quality / 采样 / 种子 / 自动合并」这类 LSC 有的批次级参数（`native-h3-scene.js:1332`、`:1348`）。

### 2.8 状态回写与断点续跑（部分，含已知故障）

**已走通**：`writeClipRun`（`multitrackEditor.vue:591-605`）在 `onStart/onSucceeded/onFailed/onCancelled` 四个钩子里写 `status`/`nodeId`/`assetPath` 并追加 `attempts`，批次号以 `attempts[].error === "batch:<uuid>"` 记账（`:621`、`:634`、`:637`、`:640`）。

**断点（这是已知问题的根因）**：
1. `onBeforeUnmount` 直接 `dispatchController?.abort()`（`:885-891`），注释自认「直连生成随节点卸载中断（轮询停止）…升级路径：宿主级派工注册表」。轮询一停，`waitForSettled` 永远不会再写终态。
2. `useNodeGeneration` 的 `status` 是纯内存 ref（`useNodeGeneration.ts:6`），节点卸载/刷新即归 `idle`；`getGenerationStatus` 只反映「本次打开节点后」的生成（文档 `docs/multitrackProductionPlan.md` §4.6 已明确 `idle` 不可作交付依据）。
3. 编辑器 `onMounted` 只做 `probeDefaultProject + readProject + loadReport`（`:879-883`），**没有**「对 `status==="generating"` 的镜头按 `nodeId` 回读 `outputs` 纠正状态」的对账步骤；也没有用 `getCanvasNodes({fields:["outputs"]})` 找回产物的路径。
4. `freevideo.runJob`（`freevideo.ts:145-185`）的 `jobId` 只活在这次调用栈里，`makeRef` 每次新随机且注释明确「不复用」（`:187-192`）——供应商侧 job 已 `succeeded` 时，我们没有任何手段按 ref 或 jobId 把它找回来写进工程。

结果就是任务描述里的现象：**freevideo job 已 succeeded，但工程里该镜停在 `generating`**。LSC 对此有三层防护：job 落盘 + `load()` 把 ACTIVE 降级 `paused`（`scene_video_jobs.py:45-47`）、attempt 状态机区分 `lost`/`unknown` 并拒绝自动重提交（`:183-185`、`:232-234`）、`run['done']` 跳过已完成段（`native_h3_scene.py:594`）。

---

## 3. 优先级汇总

### P0（不补则核心流程走不通，本轮应做）

| 编号 | 项 | 为什么是 P0 |
|---|---|---|
| P0-1 | 批量生成面板（范围数字输入 + 逐镜进度 + 单镜重试 + 暂停/继续） | 团队目标的落地项；LSC 的主界面就是这块，我们现在只能「选段 → 点生成 → 盯着轨道看」 |
| P0-2 | 断点续跑与状态对账（重启后按 nodeId 回读 outputs 纠正 `generating`） | 已在真实使用中造成「已生成但 UI 卡住」，数据可信度问题 |
| P0-3 | 合成与验收进界面（`accepted` 验收 + 「合成」按钮 → `plan/composite.mp4` → 卡片播放） | 合成是整条链的终点，现在只有对话模型能触发，人无法在界面闭环 |
| P0-4 | `global.style` / `global.systemPrompt` 真正参与提示词拼装 | 界面能改、能存、不生效，属于会误导用户的「假能力」；改动仅 8 行 |
| P0-5 | 全片比例 / 视频模型选择器 | `global.ratio`/`global.model` 是生成的关键参数，现在只能命令式写 |

### P1（走通主流程后再补）

| 编号 | 项 | 说明 |
|---|---|---|
| P1-1 | 派工队列持久化 + 全局并发闸门 | 多标签页/多节点同时派工会抢显存；进程重启队列蒸发。需要宿主级注册表或 server 路由 |
| P1-2 | 时间线设置 / 整理本镜（模型改写提示词，保留原文 + 人工采用） | **已完成（2026-10-22）**：整理本镜三项（不自动采用 / 一致性守卫 / 生成中 409）已落地，见 §2.5 更新。剩余可选项只有「整理规则工程级设置」，当前不做；`timeline-settings` 本身不适用 |
| P1-3 | 九宫格拆图 → 建多轨工程 | 让拆图与多轨连成一条链；目前拆完还得手工建 9 个片段 |
| P1-4 | 勾选任意段合并 + `-c copy` 无损路径 + 合并幂等 | 对齐 LSC 的 `merge_files`；当前只支持 accepted 全量重编码 |

### P2（已完成或低优先）

| 编号 | 项 | 说明 |
|---|---|---|
| P2-1 | 单镜 / 选段生成 | 已走通，无需动作 |
| P2-2 | 整批取消 | 已走通，且强于 LSC（LSC 无 cancel） |
| P2-3 | 失败自动续跑下一镜 | 已走通（`directDispatch.ts:256-259`） |
| P2-4 | 本镜 `system_prompt` 覆盖（LSC 三档：公共/项目/本镜） | 当前只有项目级一档；在 P0-4 之后按需加 |
| P2-5 | 参考图/音频/视频引用数量与用途标注 | LSC `capabilities` 返回 image:9/audio:3/video:3；我们固定 4 图（V8），属产品限制，不急于对齐 |

---

## 4. 建议下一轮实现的前 3 项

### 第 1 项：批量生成面板（P0-1，含 P0-4 的前置修复）

**做什么**
- `dispatchBar.vue` 加「起始段 / 段数（-1 = 到最后）」数字输入，与轨道多选互斥（给了数字就以数字为准），并在提交前只校验本次范围内镜头的提示词是否齐全（对齐 `native_h3_run_range.py:14-17` 的「范围外无需补填」）。
- 新增 `batchProgress.vue`：`第 i/N 镜 · 正在生成`（LSC `scene_video_jobs.py:299` 文案口径）+ `<progress>` + 每镜一行状态（含失败原因），点击行可定位到该片段。
- `directDispatch.ts` 增加 `pauseRequested` 闸门：**镜头之间**检查（绝不中断在跑镜头），暂停时把 `status` 保持 `generating` 但批次状态标 `paused`；「继续」从第一个非终态镜头接着跑（已完成镜自然跳过）。
- `clipEditor.vue` 加「重试本镜」按钮（等价于 `launchDispatch([clipId], {includeFinished:true})`）；批次面板加「只重试失败镜」。
- **前置修复**：`buildPrompt` 接收 `project.global`，把 `style` 与 `systemPrompt` 拼到画面正文开头（否则面板上改风格仍是无效操作）。

**改动面**：`packages/nodeShared/src/mtrack/components/dispatchBar.vue`（+60）、新增 `components/batchProgress.vue`（≈120）、`multitrackEditor.vue`（+120）、`directDispatch.ts`（+30）、`clipEditor.vue`（+30）、`packages/nodes/multitrackNode/src/index.vue`（`dispatchGenerate` 增加 `count` 参数与 `pauseBatch`/`resumeBatch` 两个 node 函数，+60）。

**验收**
- 输入「从第 3 段起 2 段」只跑 S003/S004，S001–S002 缺提示词不报错；
- 生成中能看到「第 2/2 镜正在生成」与进度条推进；
- 点「本镜结束后暂停」→ 当前镜跑完后停住，已完成镜的 `assetPath` 已落盘，点「继续」不重跑已完成镜；
- 单镜「重试」只重跑该镜，`attempts` 追加一条且历史保留。

### 第 2 项：断点续跑与状态对账（P0-2）

**做什么**
- `multitrackEditor.vue` 新增 `reconcile()`：对 `status==="generating"` 且有 `nodeId` 的片段，用 `getCanvasNodes({nodeIds, fields:["outputs"]})` 回读 `outputs.video.value.url`——有值则回写 `status:"generated"` + `assetPath` + `attempts` 追加一条 `reconciled`；无值且节点已不存在则降级 `status:"pending"` 并保留原 `attempts` 记录（不删历史）。
- `onMounted` 在 `readProject` 之后调用 `reconcile()`；`node:getStatus` 返回值增加 `reconciled` 计数便于对话侧知晓。
- 提供「继续本批」入口：按 `attempts` 里的 `batch:<id>` 找回未终态镜头，从第一个非终态继续（对齐 LSC `run['done']` 跳过语义）。
- `attempts.status` 增加 `reconciled` / `lost` 两种取值（`attempts[].status` 是自由字符串，不破坏 `ClipStatus` 五值约束）。

**改动面**：`multitrackEditor.vue`（+90）、`directDispatch.ts`（`waitForSettled` 抽出可复用的单镜查询，+20）、`multitrackNode/src/index.vue`（`getStatus` 描述与返回字段，+10）。

**验收**
- 造一镜 `status:"generating"` 且其 `nodeId` 在画布上已有 `outputs.video`：打开编辑器后该镜自动变 `generated` 且 `assetPath` 正确；
- 造一镜 `status:"generating"` 且 `nodeId` 已不存在：变 `pending`，`attempts` 历史完整保留；
- 断网重连/刷新页面后不出现「永远 generating」。

### 第 3 项：验收 → 合成 → 回画布 的界面闭环（P0-3）

**做什么**
- `clipEditor.vue` 加「验收本镜（accepted）」/「打回（pending）」按钮，直接改 `clip.status`（真源字段，走 `onPatch`）。
- `multitrackNode/src/index.vue` 新增 node 函数 `compositeOutput`（参数 `{ execute?: boolean, output?: string }`），内部复用 `planOperator` 的 `composite` 语义：先出清单 `plan/composite.json`，`execute=true` 时经宿主 ffmpeg concat 到 `plan/composite.mp4`，完成后调 `refreshOutput` 挂到 video 端口。
- 多轨编辑器「生成结果」区加「合成成片」按钮：调 `compositeOutput({execute:true})`，按钮下方显示 `plan/composite.json` 的 `segments` 数与 `executed` 状态；未全部 accepted 时按钮禁用并给出「还有 N 镜未验收」。

**改动面**：`packages/nodes/multitrackNode/src/index.vue`（+90）、`multitrackEditor.vue`（+60）、`clipEditor.vue`（+25）、`packages/tools/planOperator`（**不改**，只复用其既有能力；若要做「勾选任意段合并」则另开 P1-4）。

**验收**
- 全部镜头 `accepted` 后点「合成成片」→ 产出 `plan/composite.mp4`，多轨卡片「成片」行可播放；
- 有镜头未 accepted 时按钮禁用并显示未验收数量；
- 输出已存在时给出「不自动覆盖」的明确报错（复用 `index.ts:673-675` 文案）。

---

## 5. 证据索引（按文件）

| 文件 | 关键行 | 用途 |
|---|---|---|
| `packages/nodeShared/src/mtrack/multitrackEditor.vue` | 12-13、27-36、73-95、108、420-438、466-469、560-577、591-605、612-657、663-702、879-891、905-915 | 界面全部入口、派工/取消、global 编辑、无对账 |
| `packages/nodeShared/src/mtrack/components/dispatchBar.vue` | 6、9、11、36-43 | 三个按钮 + 选段文案，无暂停/进度/重试 |
| `packages/nodeShared/src/mtrack/components/statusPanel.vue` | 4-19、40 | 单镜状态与 attempts，无批次视图 |
| `packages/nodeShared/src/mtrack/components/trackBar.vue` | 15、56、68-70、136-154 | 状态色条、宽度正比、多选语义 |
| `packages/nodeShared/src/mtrack/components/clipEditor.vue` | 单镜属性区 / 提示词三段 / 参考顺序折叠区 / 「整理本镜提示词」按钮与「待采用」区块 | 有整理本镜入口（2026-10-22）；无重试按钮、无 status 控件 |
| `packages/nodeShared/src/mtrack/directDispatch.ts` | 24、26、28、83-96、112-135、138-174、177-196、199-209、217-261、285-313 | 串行、失败续跑、无暂停、buildPrompt 不读 global |
| `packages/nodeShared/src/mtrack/mtrackProject.ts` | 3、5、7、23-39、41-47、95-99、145-179 | 数据契约（`global.model` 存在但无 UI） |
| `packages/nodeShared/src/useNodeGeneration.ts` | 6、11-16、17-26 | 状态纯内存，idle 不可作交付依据 |
| `packages/nodes/multitrackNode/src/index.vue` | 21-27、197-209、286-416 | 九个 node 函数（+2 引用函数 = 11）、成片展示、无合成/暂停/时间线函数 |
| `packages/nodes/videoGenerationNode/src/index.vue` | 268-273、350、356 | 卸载即 abort、成功才写 outputs |
| `packages/nodes/imageNode/src/components/imageGridSplit.vue` | 17-37、51-53、111-194 | 宫格切分只建图片节点 |
| `packages/providers/src/media/freevideo.ts` | 145-185、187-192 | jobId 不落盘、ref 不复用 |
| `packages/tools/planOperator/src/composite.ts` | 122-143、159-207 | 只拼 accepted、V14、ffprobe 规格校验 |
| `packages/tools/planOperator/src/index.ts` | 122-136、524-530、668-706 | composite 动作与 concat 执行、不覆盖守卫 |
| `packages/tools/canvas/src/assembly.ts` | 96、335-399 | 状态映射与分层生成（对话侧路径，非界面） |
| `apps/server/src/routes/mtrack/rewriteShot.ts` | 1-106 | `POST /api/mtrack/rewriteShot`：`rules` 可选覆盖内置规则（:22、:88）、生成中 409（:42-66、:72）、`requiresReview:true`（:100）；注册于 `router.ts:76`/`:207` |
| `apps/server/src/routes/` | 全表 | 有 `mtrack/rewriteShot`、`mtrack/composite` 等；无 `timeline-settings` / `scene-jobs` / 批量队列路由 |

LSC 侧对应位置见各节内联引用；核心文件：`app/native_h3_scene.py`（806 行）、`app/scene_video_jobs.py`（441 行）、`app/native_h3_run_range.py`（34 行）、`app/local_video_timeline.py`（138 行）、`app/static/js/native-h3-scene.js`、`scene-video-batch.js`、`h3-grid-multitrack.js`、`video-timeline.js`。
