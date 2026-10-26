# 视频生成引导多轨化 · 设计冻结稿（r3）

> 输入：r1（引擎实测核验 + 供应商差距清单）、r2（引导全量盘点 + 改写蓝图）。本文为裁决全文，含三份自包含任务书（A 引导改写 → docs-dev/t4；B 技能包处置；C 供应商优化 → provider-dev/t5）。实施成员无调研上下文，所有依据在文内复述。
> 基线环境事实（r1 实测，引擎 v0.4.17 / build 2026.10.20.133102）：引擎↔技能包契约一致；`/jobs/{id}/resume` 实测可用（features jobs.resume=true），同 ref 同内容→HTTP 200 原任务、改内容→409，`failed`/`cancelled` 不自动恢复由引擎文案保证。
>
> **历史设计，勿作引导**：本文是视频引导多轨化的设计冻结稿（r3），文中「把选段 + 派工意图交给 agent 会话」的桥接假设**已被直连实现取代**——实际是 `packages/nodeShared/src/mtrack/directDispatch.ts` 的 `beginDirectDispatch`：编辑器自己经画布 `nodeTools` 逐镜生成、不经对话模型；文中提到的 `agentDispatch.ts` 已不存在。现行口径见 `packages/skills/assetCard/references/generationRunbook.md`（§十二、§十五、§十五·五）；本文仅作历史参考，不据此施工。
>
[HISTORICAL] > **现状更新（2026-10-25）**：文中 A-10/A-15 的「资产接入三步（`connectNodes` → `node:setReferenceOrder` → `node:editProject`）」只用于已有工程补接；新项目的资产与分镜接入由画布「导入资产与分镜」节点（`packages/nodes/assetImportNode`）承接，正文参考标记统一写 `{{ref N}}`，`<Picture N>` 只是 wire 层换算后的模型侧标记。

## 0. 三问裁决总览

| 用户问题 | 裁决 |
|---|---|
| ① 引导改多轨 | **批准 r2 蓝图并冻结**为任务书 A：多轨接入成为视频生成默认主路径，直连降为「无多轨工程时的单条例外」；改动收敛在 workflow / canvas / v118workflow 一句话边界 / mcp-skill 一条 bullet / assetCard 计数修正，runbook 与模板作为真源**不反向改写**。 |
| ② 技能包要不要更新 | **不更新**。r1 实测一致；可选补漏（端点表加 `GET /`、`GET /connect/status` 两行）裁决**不做**，理由见任务书 B。`data/skills/freevideoAgent` 本轮零改动。 |
| ③ 内部要不要优化 | 六项差距：**只接一项**（interrupted 自动 resume，受限版）+ 修正一处误导注释（makeRef）+ 一行 readme 公开声明；其余不接（/plan、SSE、/queue、ref 复用、inspect/frame、quality 档位、422 预拦），逐条理由见任务书 C。 |

---

## 任务书 A：视频生成引导多轨化改写（docs-dev / t4 执行）

### A0 范围与风格

- 只改 `packages/skills/` 与 `packages/mcp/skills/toonflow/SKILL.md`，不改任何源码、不改 `data/skills/freevideoAgent`（见任务书 B）。
- 文档内引用代码一律「文件+函数名」，禁止行号。本任务书中标注的 `:NNN` 仅为定位辅助，不得写入文档。
- 遵循各文件现有文风（表格化、短句、纪律用加粗）。每处改动保持最小，不顺手扩写。

### A1 统一分流口径（逐字基准，写入各文件时可按上下文缩写但不得改语义）

```text
视频生成先判工程形态：
一、多轨主路径（默认）：工作区 plan/ 下存在 story.mtrack（或任意 .mtrack 工程），或本次任务属于分镜批量、跨镜连续性、需要状态回写与验收合成 → 走 assetCard 技能链路：资产卡定稿 → 分镜接入多轨工程（多轨编辑器绑定，或按 assetCard 多轨模板建立）→ planOperator validate 清零 → 逐镜生成，二选一：会话内按 runbook §十三 逐镜 SOP（planOperator dispatch 出清单，逐镜按 §一 11 步执行），或画布多轨节点 node:dispatchGenerate 后台派工（立即返回 batchId，进度看 node:getStatus / mtrackRead）。同一批镜头两者绝不同时执行。
二、直连例外：工作区没有多轨工程，且用户点名只要一条视频（单段、无分镜表、无资产卡体系、不要求跨镜连续性的灵感短片），或对既有单视频节点的局部重生成/参数修正 → 按 canvasExecution 单节点链路 node:getConfig → node:setConfig → node:setPrompt → node:generateVideo → node:getGenerationStatus 直调；仍须逐项展示方案并取得消耗算力授权；产物不回填 mtrack。
三、存在多轨工程时，一切视频生成走一（二选一），禁止直连绕过回写；用户明确说明某条生成与工程无关时，先确认再按二执行。
```

**无引导真空核对**：「生成一条 10 秒视频」在（无工程）→ 唯一路径=直连例外；（有工程）→ 唯一路径=多轨。两条判据以工作区是否存在 `.mtrack` 文件为准，客观可判。

### A2 逐文件-节改写清单（13 条，全部必做）

| # | 文件 | 节（定位） | 动作与目标口径 |
|---|---|---|---|
| A-1 | `packages/skills/workflow/SKILL.md` | 「从哪里开始」路由表 | 表首新增一行判据：**任何视频制作/生成/继续意图，先按「多轨接入」节做形态判定**；命中多轨形态的行走新节，不锁进 Seedance 执行态。原「已定稿剧本+制作视频→立即锁 PART A」行改写为「…且形态为直连例外时，锁进 PART A」。 |
| A-2 | 同上 | 「从哪里开始」表后、Seedance 锁存节之前**新增小节「多轨接入（默认制作路径）」** | 内容 = A1 统一分流口径（逐字基准）+ 指针链接：`assetCard` 技能（资产卡/多轨契约）与其 runbook 的 §十三、§十五·五；细则一律指针化，本文件不复写 runbook 内容（防两处漂移）。链接指向 [生成 SOP runbook](../packages/skills/assetCard/references/generationRunbook.md)。 |
| A-3 | 同上 | 「Seedance 路由锁存」节（含意图条款与全部锁存子弹） | 命中条件第 2 项限定为「**直连例外形态下**的制作/生成/继续/修订视频」；节首补一段：多轨形态下 PART A 仍作提示词创作内核（节拍/站位/连续性规则可用），但产物落 `clips[].prompt` 三字段、格式纪律以 runbook §四 为准，**A0 不问「Seedance 2.0 还是 2.5」**——多轨工程模型按工程声明（默认 FreeVideo MiniMax-H3）；用户点名要 Seedance 提示词写作时仍锁 PART A。其余锁存条款在不与上段冲突处原样保留。 |
| A-4 | 同上 | 「Seedance 阶段硬隔离」:59 与「按当前创作问题读取方法」表 :1382 两处「进入执行层」落点 | 落点从「canvasExecution.md」改为「先按『多轨接入』节做形态判定：多轨 → assetCard runbook §十三/§十五·五；直连例外 → canvasExecution.md」。 |
| A-5 | 同上 | 「在画布上推进」节点创建纪律（「一个剧情片段…默认对应一份完整提示词、一个视频生成节点」段） | 该句加限定「直连例外形态下」；补一句：「多轨工程中不逐段手建视频节点——节点由派工清单建/复用（runbook §一步 1.5、§十三.2），画布节点只是执行载体（assetCard 核心约定 3）。」 |
| A-6 | 同上 | frontmatter `metadata.version` | `"2.7.0"` → `"2.8.0"`。 |
| A-7 | `packages/skills/workflow/references/canvasExecution.md` | 标题下引语段（:3） | 段首加「适用边界」：本文件是**直连例外**的执行手册；命中多轨形态（工作区存在 story.mtrack 或任务属批量/连续性/回写）立即转 assetCard runbook §十三/§十五·五，不在本文件路径上继续。 |
| A-8 | 同上 | 「生成前准备」第 6 条（不绕过画布改走直接媒体工具） | 原句保留；追加「也不得对属于某多轨工程的镜头用本路径绕过回写（与派工硬约束同源：agentDispatch.ts `buildDispatchPrompt` 第 2 条禁止 mediaGeneration 生成视频）」。 |
| A-9 | `packages/skills/workflow/references/stateAndDelivery.md` | 「已采用媒体与局部修订」与「核验与采用」两节 | 各加一小段多轨项目口径：状态真源 = `story.mtrack` 的 `clip.status`（pending/generating/generated/failed，`accepted` 只能由用户验收产生）；本文台账在项目中只记非 mtrack 范围与版本快照；合成交付以 `planOperator composite` 为准（只拼 `accepted` 段），不复写 runbook 细节、放指针链接。 |
[HISTORICAL] | A-10 | `packages/skills/canvas/SKILL.md` | :22-24 制作阶段段；:103-104 连接规则「剧本分镜文本不直连生成节点」两条；:115 多轨函数清单；frontmatter | ① :22-24 加 A1 分流口径的简版（两三句，指向 workflow「多轨接入」节），「一片段对应一份视频提示词和一个视频节点」句前加限定「直连例外形态下」；② :103-104 改双口径：直连形态沿用现纪律；多轨工程里该纪律由「connectNodes → `node:setReferenceOrder` → `node:editProject` 写 referenceIds」三步承接（见 runbook §十五·五资产接入三步）；③ :115 「实际提供 9 个函数」→「实际提供 11 个函数」，清单补 `node:getReferenceOrder`（读输入端口当前生效参考顺序与 `{{ref N}}` 文本）与 `node:setReferenceOrder`（按给定 sources 顺序重写参考编号；资产接入三步第 2 步），语义逐字对齐 `packages/nodeShared/src/useNodeReferences.ts` 注册描述；④ version `"2.1.0"` → `"2.2.0"`。 |
| A-11 | `packages/skills/canvas/references/videoProduction.md` | §0 首段；§2 表「一个片段的全部镜头」行；:47 多轨函数句；§6 示例标题 | ① §0「默认采用 Seedance 2.0/2.5 多参生产」改为形态分流句（默认多轨→assetCard 链路；直连例外才按 Seedance 多参单节点描述走）；② §2 该行加「直连例外形态下」限定；③ :47「九个函数」→「十一个函数」并补上述两个引用函数（同 A-10③ 措辞）；④ §6 标题改「示例：灵感模式单条三镜头合段直连生成（非多轨工程形态）」，正文保留——它就是直连例外的范本。 |
| A-12 | `packages/skills/v118workflow/SKILL.md` | 顶部（标题段后）+ frontmatter | 加一行边界：本技能是 v1.1.8 历史流程复现，不含多轨工程（story.mtrack）制作；多轨工程与新项目主路径走 workflow/assetCard 技能；本流程的逐节点直连口径仅用于旧版工程续作。version `"1.1.0"` → `"1.1.1"`。**其余内容一字不动。** |
| A-13 | `packages/mcp/skills/toonflow/SKILL.md` | 「生成媒体」节 | 加一条 bullet：触发视频生成前先判形态——画布存在 `remote-multitrackNode` 或工作区存在 `plan/story.mtrack` 时，经多轨节点的 `node:dispatchGenerate` 或内置 runbook §十三 SOP（二选一）生成并回写 mtrack；不回写 mtrack 的直调会造成状态漂移。函数细节指向内置 assetCard 技能文档，不展开 SOP、不提任何供应商名（保持 MCP 文档供应商无关）。 |
| A-14 | `packages/skills/assetCard/SKILL.md` | 分工表 :21、参考表 :32、「生成闭环」第 5 步、frontmatter | ① 两处「9 个 `node:` 函数」→「11 个」；② 闭环第 5 步「每段一个视频节点…再 node:generateVideo」改写为「逐镜生成二选一：§十三 SOP 逐镜（即本闭环的每段一节点一生成）或 `node:dispatchGenerate` 后台派工」并指向 runbook §十五·五；③ version `"1.0.0"` → `"1.0.1"`。 |
[HISTORICAL] | A-15 | `packages/skills/assetCard/references/generationRunbook.md` | §十五·五标题、首段、函数表；§十九 核对表对应行 | ① 标题「（9 个 `node:` 函数）」→「（11 个 `node:` 函数）」；② 首段「以下 9 个节点函数」→「以下 11 个节点函数：9 个由节点自身注册（`packages/nodes/multitrackNode/src/index.vue`），2 个引用函数由 `useNodeReferences()` 自动注册（`packages/nodeShared/src/useNodeReferences.ts`）」；③ 表末补两行：`node:getReferenceOrder`（入参 `{handleId?}`；返回 references 与 referenceMentions；`{{ref N}}` 编号唯一落点的读取口）与 `node:setReferenceOrder`（入参 `{handleId?, sources[]}`；重写参考顺序，sources 必须是现有入边来源；§十三.2 步 d 与资产接入三步第 2 步即用此函数）；④ §十九「（9 个 `nodeTools.register`）」行同步注记「9 个多轨函数 register + useNodeReferences 自动注册 2 个引用函数」。**本文件其余节（§十三/§十四/§十五·五二选一行等）是纪律真源，一律不改。** |

（A-10③/A-11③/A-14①/A-15 即队长追加的「无争议必修项 9→11 四处改齐」，本清单已覆盖，按本表执行即可。）

### A3 逐字兼容核对表（docs-dev 改完自查，verifier 复核）

1. **二选一纪律**：新口径中「§十三 SOP 与 dispatchGenerate 二选一、同批绝不同时执行」必须与 runbook §十五·五 dispatchGenerate 行及 `multitrackNode/index.vue` 注册 description 原句语义一致，不另造第三种发起方式。
2. **agentDispatch 五条硬约束**：任何新增文字不得改写或弱化 `agentDispatch.ts buildDispatchPrompt` 五条（逐镜走 nodeTools、禁 mediaGeneration、派发前写 generating+attempts、成功写 generated+nodeId/assetPath、取消按批次回写）；直连手册与多轨 SOP 都是该五条的下游，A-8 的追加句与其第 2 条同源。
3. **batchId 找回细节唯一出处**：runbook §十四/§十五·五；其他文件（含 mcp-skill bullet）只放链接或指针，不复写 `attempts[].error == "batch:<id>"` 判据。
4. **状态机口径**：`generated` ≠ 交付完成、`accepted` 仅人工验收（runbook §一步 11 注、assetCard 闭环第 6 步），A-9 新增段不得引入第三种状态语义。
5. **无行号引用**、**无新增文件**、**不改 `packages/skills` 与 `packages/mcp/skills/toonflow/SKILL.md` 之外任何文件**。

### A4 部署同步（最后一步，必做）

技能运行时读 `data/skills/`，且 `data/skills/initialized` 存在后**不再自动覆盖**（runbook §十八.3）。改完 packages 侧后，把**每个被改的文件**逐个人工复制覆盖到 `data/skills/` 同名路径（涉及：workflow/SKILL.md、workflow/references/canvasExecution.md、workflow/references/stateAndDelivery.md、canvas/SKILL.md、canvas/references/videoProduction.md、v118workflow/SKILL.md、assetCard/SKILL.md、assetCard/references/generationRunbook.md；`packages/mcp/skills/toonflow` 无 data 侧副本，仅改 packages 侧）。已知现状：上述多数文件 packages 版本新于 data 版本（packages 为 git 真源，一律以 packages→data 方向覆盖）；复制前用 hash 对比列一张「改前/改后」表进任务报告。`data/skills/freevideoAgent` **不在复制清单内**（零改动）。

---

## 任务书 B：freevideoAgent 技能包处置（并入 t4 报告，预期零改动）

**裁决：不改。** r1 对运行引擎（v0.4.17 / build 2026.10.20.133102）逐条实测：endpoints.md 69 条全部存在、无删除无改参；17n+5 网格、宽高 32 倍数、≤5 段、quality 枚举、status 枚举、ref 幂等、wait=25 钳制、多块参考图 ≤3——全部与 SKILL.md/jobs.md 表述一致。安装副本与 zip 逐字节相同（队长预检 + r1 SHA 抽检双重印证）。

- 唯一候选改动「端点表补 `GET /`、`GET /connect/status` 两行」裁决**不做**：两者是纯信息端点，SKILL.md 连接流程已实际使用 `GET /` 且写法正确；表定位为 v1 契约端点清单，为不缺的信息扩维护面违反「不顺手完善」边界。
- 本机 features 中 images.edit/layers 等为 false 属部署状态而非契约差异，技能包已有「看 features」指引，无需改。
- t4 报告要求：在 diff 摘要中如实记一行「freevideoAgent 处置=零改动（r3 裁决）」，并对 `data/skills/freevideoAgent` 做一次 hash 复核（应与 zip 一致，供 v1 验证引用）。
- **无上游同步事项**（本轮未改任何文件，无需回写用户 Comfy 目录）。
- 若日后引擎升版，以 r1 本基线为对照再做增量核验。

---

## 任务书 C：供应商 freevideo.ts 优化（provider-dev / t5 执行）

范围：仅 `packages/providers/src/media/freevideo.ts`。遵循根 AGENTS.md（小驼峰、双引号、两空格、ACT 注释标注有意简化、不引新依赖、不新增测试文件）。**不触碰其他供应商文件。**

### C0 裁决总表（r1 六项差距 + 两项附带发现）

| 差距项 | 裁决 | 理由 |
|---|---|---|
| 1. `POST /plan` 提交前预检 | **不接** | 实测 `POST /jobs` 本身即全量同步校验（非法参数入队前 422、逐字段报错带 next，不产生任务）；/plan 增量只有分段可视化与耗时估算，本机估算恒 unavailable；Toonflow provider 接口（`types.d.ts GenerateMedia`）无「未提交预检」挂点。多轨派工如需派单前展示分段计划，属引导层议题，本任务不做。 |
| 2. `POST /jobs/{id}/resume` interrupted 续拍 | **接（受限）** | 见 C1。 |
| 3. `GET /jobs/{id}/events`（SSE） | **不接** | 供应商契约同步返回 `MediaAsset[]`，无进度回调通道；`wait=25` 长轮询已覆盖等待需求；SSE 徒增连接维护。 |
| 4. `GET /queue` | **不接** | 排队位次提示无 Toonflow UI 承接面；引擎 busy 错误的 `retry_after_seconds` 已随 `errorMessage` 透传给用户。 |
| 5. ref 幂等复用 | **行为不改，仅修正误导注释** | 见 C2。内容哈希不可行（spec 含每次不同的上传文件名）；只哈希 prompt+秒数会把「同参数再抽一次」误合并回旧任务，比偶发重复提交更糟。 |
| 6. `POST /media/inspect`、`/media/frame` | **不接** | 首/尾帧与参考图全部由宿主提供、供应商只转传，抽帧服务的是引擎自己的 VLM/审片流，超出供应商边界。 |
| 附 1. quality 四档只用 `light` | **不接（保持）** | `VideoRequest` 无 quality 字段，UI 无控制通路可映射；light 与实跑口径一致。升级路径：将来宿主透传 quality 时，在 `generateVideo` spec 组装处加一档映射即可，无需现在铺面。 |
| 附 2. ≥30s 自动分段且带 4 参考图会被引擎 422 | **不预拦，仅记录** | 引擎报错清晰（"at most 3 pictures when … multiple blocks"）、经 `errorMessage` 用户可感知；自拦需要 seconds×参考数联合推断，收益低于复杂度。 |

### C1 实现书：interrupted 自动 resume（唯一改动行为项）

现状：`runJob` 轮询循环见 `status === "interrupted"` 与 failed/cancelled 走同一抛错分支。

改为（约 15 行，全部在 `runJob` 内，不加新函数文件）：

1. 循环内区分 `interrupted`：维护本函数作用域的 `resumeTries`（上限 **2**）。见 `interrupted` 且额度未用尽 → `POST ${agent}/jobs/${jobId}/resume`，头同轮询（Authorization），body `{}`，`Content-Type: application/json`，沿用同一 `signal`。
2. resume 返回 2xx → 解析 job（沿用 `object()`），**继续用同一 `jobId` 轮询**（引擎语义：已成功块保留，从断点续）。resume 返回非 2xx → 抛 `context.tool.errorMessage?.(await response.json().catch(()=>({})) || "续拍失败：HTTP <status>")`。
3. 两次 resume 后仍 `interrupted` → 抛 `new Error("生成中断，自动续拍两次仍未成功；请检查 FreeVideo 引擎状态后重试本镜头")`。
4. `failed`、`cancelled` 维持现抛错路径**绝不自动 resume**（引擎文案确认 cancelled_by=user 时恢复会违背用户意图；failed 多需换提示词，交人判断）。
5. 注释写明 ACT 取舍：resume 上限 2、仅 interrupted、块保留由引擎侧完成（供应商无需分段记账）。

可感知落点（不是哑函数）：

- `readme` 视频要点追加一行：`- 生成中断（引擎重启、显存波动）时自动尝试续拍，最多 2 次，已生成部分保留；续拍仍失败会明确报错。`——供应商公开声明。
- 顶层 `const version = "1.0.0"` → `"1.1.0"`（行为变化对外可辨）。
- 用户可见链路：续拍成功 → 节点照常 `succeeded` 回产物；最终失败 → `node:getGenerationStatus` 的 `error` 即第 3 点文案，UI 直接可见。

兼容性核对（对照技能包 jobs.md 原文「接续失败/中断/已取消的生成，已成功块保留；活跃或已成功任务不能恢复」）：我们只在轮询到终态 `interrupted` 后发起，不会命中「活跃任务不能恢复」；resume 与提交一样带 ref 语义由引擎处理。

### C2 实现书：makeRef 注释修正（零行为改动）

现 jsdoc「幂等键：每次生成一个，重试同一请求可恢复原任务」与实现不符（每次新随机值，从不复用）。改为如实描述并以 ACT 注记录取舍：`/** 每次调用生成新 ref；不复用——spec 含每次不同的上传文件名，内容哈希幂等会把「同参数再抽一次」误合并回旧任务。需要断线找回时应在请求级持有同一 ref 重发（当前无此需求）。 */`。函数体一字不动。

### C3 禁止项与验证

- 禁止：新增 quality 参数面、/plan 调用、SSE、/queue、inspect/frame、任何占位代码；禁止动 `metaso.ts` 等其他供应商；禁止新增测试/自检文件。
- 验证：优先 `bun run typecheck`（根 package.json 已按 `--filter '@toonflow/*'` 逐包执行，providers 无自带脚本时以根过滤结果如实汇报）；HTTP 行为变化在引擎在跑时实测一条 `light` 短任务走通提交→轮询→下载回归（interrupted 路径需引擎重启才能自然复现，无法复现时如实说明为代码级走查，r1 已实测 resume 端点可用）。逐条报告：裁决项→实现/未实现→证据。

---

## 边界声明（本轮明确不做）

技能包端点表补漏；引导文档除 A2 清单外的任何「顺手完善」（含 PART A A0–A12 正文重写、v118 references 改动、mcp-skill SOP 展开）；供应商除 C1/C2 外的一切改动；`docs/multitrackProductionPlan.md` 等历史设计文档回填。