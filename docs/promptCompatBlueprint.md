# 实施蓝图：提示词兼容改造（不实施）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 本文只给可执行步骤与验收方式，不改任何代码、技能或 DSH 包。
> 配套文档：推荐方案见 `promptCompatRecommendation.md`；格式细节见 `promptCompatFreevideo.md` / `promptCompatNonFree.md`；风险编号见 `promptCompatRisk.md`。
> 总原则：**同一批提交内不允许出现「数据已单串、消费者仍按三字段」或「消费者已单串、数据仍三字段」的中间态。** 数据形状、所有写入口、所有读入口、校验器、整理接口必须原子落地。

## 0. 批次与依赖

| 批次 | 内容 | 依赖 | 可否单独回滚 | 备注 |
| --- | --- | --- | --- | --- |
| **B0** | 运行时技能同步机制（R-01） | 无 | 是 | 先修，避免后续技能改动到不了 `data/skills` |
| **B1** | 单串数据形状 + 全部消费者（原子） | B0 可并行，但发布必须晚于 B0 | 整体回滚 + 备份恢复 | 最大的一批；拆开就会产生静默窗口 |
| **B2** | 多轨切换影响评估（R-02 修正版） | B1 | 是 | 只加对话框与回读，不动数据 |
| **B3** | 仓库引导层（packages/skills） | B1 的字段名定稿 | 是 | 与 B1 同一发布批次，不跨版本 |
| **B4** | DSH 技能包（R-11） | B3 同源 | 是 | P0；只改仓库不改 DSH，对 MCP agent 无效 |
| **B5** | 发布、运行时同步、迁移演练 | B0–B4 | — | 含回退演练与用户提示 |

依赖关系一句话：**B0 → B1 →（B2、B3 → B4）→ B5**。B3 的文案依赖 B1 的字段契约，B4 依赖 B3 的同一份 H3 卡；不允许 B3、B4 各写一套。

---

## 1. B0：运行时技能同步机制（P0，R-01）

### 1.1 根因

- `apps/server/src/utils/plugins/initialize.ts:10`：`initialized` 标记存在且未传 `revision` 时直接返回，后续复制永不执行。
- 同文件 `:25-33`：未传 `revision` 走 `cp(..., { force: false })`；传了 `revision` 走 `copyFile + rename`——后者只支持单文件，对目录会 `EISDIR`。
- `apps/server/src/app.ts:71-73`：注释写明「技能和团队只补首次安装」；`:72` 调 `initializePlugins(data/skills, skillsRoot)` **不传 revision**，`:73` 的 agents 同样不传；而 tools / nodes / ext / providers（`:47`、`:48`、`:51`、`:69`）都传了 revision，providers 还自己算了内容哈希（`:58-68`）。

### 1.2 改法（字段级）

1. `initialize.ts` 增加「目录 + revision」分支：先判断目标是目录；是目录则**只补缺失文件**（`cp force:false`，逐项或整树），再写 marker；不是目录才走 `copyFile + rename`。
2. 目录模式下 marker 存**内容哈希**，不再写空串；启动时哈希相同则直接返回，不同则补缺并更新 marker。
3. `app.ts:72` 为 skills 计算内容哈希并传入（复用 providers 的哈希写法，不新造算法）；agents 保持首次安装语义，不传 revision，但在注释里写明这是「用户可编辑配置」而非「内置技能」。
4. 增加一行启动日志：`技能同步：缺失 N、内容不同 M、用户已改 K`（只报告，不覆盖）。这就是后续三向清单的雏形。
5. **边界（必须写进代码注释与发布说明）**：`force:false` 只补缺，不覆盖已存在文件；本分支改过的内置技能文件仍不会自动更新。本次发布必须按 B5 的手工同步清单处理；自动更新内置文件是另一件事，不在本批。

### 1.3 影响面

- tools / nodes / ext / providers 的调用签名不变；providers 的哈希逻辑可抽成共用函数，但**不要**顺手改它们的刷新语义。
- `initialized` 标记从空串变成哈希：老机器第一次启动会走一次「补缺」，不会覆盖用户改动；空标记不会被误判为「已是最新」。
- 目录分支的新增只影响 skills（和未来任何目录型内置资源），不影响单文件插件。

### 1.4 验收

1. 临时数据目录：删掉 `data/skills/assetCard`，启动后 7 个文件全部出现，sha256 与 `packages/skills/assetCard` 一致；marker 为哈希，不是空串。
2. 改一个源文件但不改目标文件，再次启动：日志显示「内容不同 1」，目标文件**保持原样**（证明不覆盖用户修改）。
3. 删掉一个已存在文件，再次启动：被补回（证明 `force:false` 补缺生效）。
4. tools / nodes / ext / providers 的加载日志与改造前一致（证明没有牵连）。

---

## 2. B1：单串数据形状 + 全部消费者（原子批次）

### 2.1 改动文件清单

| # | 文件 | 改什么 | 验收 |
| --- | --- | --- | --- |
| 1 | `packages/nodeShared/src/mtrack/promptFormat.ts`（新建） | `officialSectionPattern`（五个官方段首）、`formatFamily(modelId)` 映射、`OFFICIAL_HEAD_PREFIX` 常量 | 被 2、6、8 引用；正则只此一处 |
| 2 | `packages/nodeShared/src/mtrack/mtrackProject.ts` | `ClipPrompt = string`；`readPrompt(value, referenceIds)`（字符串直读 / 对象合成 / 补段首 / 声音段）；`normalizeProject` 调用点改签名；`hasPrompt` 只看字符串；建镜写 `""` | 类型检查；三字段对象读成单串；空对象读成 `""` |
| 3 | `packages/nodeShared/src/mtrack/mtrackEdit.ts` | `mergePatch` 对 `prompt` 整串替换，禁止对象浅合并；新增保存前备份钩子（见 §2.3） | 单串输入不被展开；备份失败即抛错 |
| 4 | `packages/nodeShared/src/mtrack/components/clipEditor.vue` | 三框改一框；`prompt: String($event)`；参考区标签中立；占位不绑供应商；辅助行只读显示模型 | 输入任意文本不产生字符索引键；保存后仍是字符串 |
| 5 | `packages/nodes/multitrackNode/src/index.vue` | `prompt: z.string().max(20000)`；保留 `strictObject`（去掉三字段形状）；`node:editProject` 的 patch 仍允许写真源字段 | 三字段对象请求被拒；单串通过；保存后回读一致 |
| 6 | `packages/nodeShared/src/mtrack/directDispatch.ts` | `buildPrompt` 改「风格 / 约束前言 + 正文」纯透传；删除补段首、声音尾段、`referenceIds.length` 分支；空正文返回空串 | 3 个样本与改造前输出逐字一致（见 §2.4） |
| 7 | `packages/tools/planOperator/src/mtrackProject.ts` | **删除**；类型与函数改从 `@toonflow/node-shared/mtrack/mtrackProject` 导入 | 临时把共享类型改成 `number`，本包必须编译失败 |
| 8 | `packages/tools/planOperator/package.json` | 增加 `@toonflow/node-shared` 依赖（workspace 协议，按仓库现有写法） | 安装/构建通过；无循环依赖 |
| 9 | `packages/tools/planOperator/src/index.ts` | 删除 `clipPromptSchema` 三字段；入参改 `z.string().max(20000)`；`mtrackUpdate` 仍禁写 `prompt`；`dispatch` 的 `promptEssentials` 与工具描述改单串、去掉旧REF占位标记示例 | 工具描述不再出现三字段名；`dispatch` 只读不写 |
| 10 | `packages/tools/planOperator/src/planValidator.ts` | V11 收一条；形状断言；V7 只查 `prompt`；旧REF占位标记文案条件句；官方标记边界按 `formatFamily` 开闸；新增 H3 段级 warning（保留的唯一提示级检查） | 600 → 200 的逐规则表可复现；有内容的 H3 工程出现段级 warning |
| 11 | `apps/server/src/routes/mtrack/rewriteShot.ts` | 请求 `prompt: z.string().max(20000)` + `refine(trim().length>0)`；响应单串；删除三字段拼给模型；不预生成标记 | 单串请求 200；三字段对象请求 400；回写为字符串 |
| 12 | `packages/nodeShared/src/mtrack/multitrackEditor.vue` | 保存前触发备份（若走同一保存函数）；切换对话框放 B2 | 备份文件存在才允许写 |

> 12 个文件是**一个提交**。若仓库提交流程必须拆分，至少 2、3、4、5、6、7、9、10、11 必须在同一个提交里；否则会出现「编辑器写单串、派工读三字段」的静默窗口（R-06）。

### 2.2 字段级契约

```ts
// 读
readPrompt(value: unknown, referenceIds: string[]): string

// 写（唯一形态）
{ prompt: nextString }

// 派工
buildPrompt(clip): string
// = [工程风格前缀, 工程约束前缀, 正文].filter(Boolean).join("\n\n")

// 整理
rewriteShot({ prompt: string, ... }): { prompt: string, requiresReview: true }
```

- `readPrompt` 的对象分支必须补段首：正文不以五个官方段首之一开头时，参考集非空补 `detailed_description: `，否则补 `integrated_multimodal_description: `；这不是可选项，是不让老工程派工文本变化的唯一办法。
- 声音段以 `overall_soundscape: ` / `non_diegetic_music: ` 段首写进同一字符串，段间一个空行。
- `readPrompt` 必须幂等：字符串输入原样返回，二次归一不重复追加。
- `hasPrompt` 只看 `prompt.trim().length > 0`。

### 2.3 备份与迁移

1. 位置：工程同目录 `backup/story.<yyyyMMdd-HHmmss>.mtrack`；已有备份不覆盖，保留最早一份。
2. 触发：保存函数发现「原文件存在任一 `typeof prompt === "object"`」时，先备份再写；备份失败抛错，不写。
3. 迁移：`normalizeProject` 在内存合成单串；保存即落盘；不双写；不写版本位。
4. 提示：保存成功后由编辑器显示一次横幅（文案见推荐方案 §2.4），不阻塞。
5. 回退：备份覆盖 + 回退构建；发布说明写明「改造前构建不要打开新工程」。

### 2.4 逐字一致性验证（人工，不新增测试文件）

1. 取真实 200 镜工程的副本（**不要在原工程上做第一次验证**）。
2. 在改造前构建上，对 3 个非空镜头记录 `buildPrompt` 的完整输出。
3. 在改造后构建上，打开同一副本，记录 `readPrompt` 合成结果 + 纯透传输出。
4. 三段文本逐字比对；不一致就停下修 `readPrompt` 的补段首或空行规则，不带病发布。
5. 保存后检查原始 JSON：`prompt` 是字符串、没有 40 个字符索引键、声音段在正文内、`backup/` 有文件。
6. 回退演练：用备份覆盖，确认改造前构建可读、三框界面 三框显示正常（这是唯一受支持的回退路径）。

### 2.5 验收口径

- 类型检查通过；全仓 grep 不再有 `prompt.integratedMultimodalDescription` 形式的写访问（读兼容函数与三字段数据说明除外）。
- `planOperator` 删除副本后，编译期能抓到字段变化（用临时改类型的方法验证一次，验证后还原）。
- 校验器在真实工程上输出 200 条 error；规则增减表与推荐方案 §2.9 一致；有内容的 H3 样本出现段级 warning。
- 编辑器保存后重新打开，提示词不丢字、不丢段、不出现字符索引键。

---

## 3. B2：多轨切换影响评估（P1，R-02 修正版）

### 3.1 改法

`packages/nodeShared/src/mtrack/multitrackEditor.vue:665-671` 的 `handleModelChange`：

1. 目标与当前相同 → 不动作。
2. 目标不同 → 先算影响：遍历 clips，统计 `prompt.trim()` 非空的镜头数；对非空正文做**只读**段名扫描，归类「疑似 H3 六段 / 疑似 Seedance 三段式 / 未知」。
3. 弹对话框（文案见推荐方案 §1.7）；确认后**只写 `global.model`**。
4. 不修改任何 `clips[].prompt`，不调用整理接口，不预生成标记。

### 3.2 派工侧

`directDispatch.ts:364-384` 的 `configureNode` 写入后，回读一次 `node:getConfig`，确认节点实际 `providerId/modelId` 与刚写入的一致；不一致停止并报告。**不做「声明 vs 节点」的事前比对**（设置前节点没有目标值，那个预检是自证循环）。

### 3.3 验收

- 切到非 freevideo：对话框出现，数字与手工统计一致；确认后 `global.model` 变化、clips 文本逐字不变；派工能成功设置节点；回读不一致时能停下。
- 切回 freevideo：同样只改声明，不改文本。
- 取不到模型清单（`:675-681` 空数组）时，切换入口禁用并给出原因，不静默失败。

---

## 4. B3：仓库引导层（P0，packages/skills）

### 4.1 先定真源

| 事实 | 唯一真源 | 其他位置 |
| --- | --- | --- |
| 默认媒体模型 + 兜底判定 | `canvas/references/videoProduction.md` 新增 §0.1 | 一律指针（「默认见 §0.1」） |
| H3 六段 / 基础三段写法 | `assetCard/references/multitrackTemplate.md` §四 | `canvas/SKILL.md:107`、`videoProduction.md:45`、`generationRunbook.md` 只留一句指针 |
| 非 freevideo 格式 | 现有 A9 段、`videoPromptCraft.md`、v118 模板 | 不改写，只加条件句与指针 |
| 判定键 | `videoProduction.md` §0.1 的判定句 + 一张格式族映射表 | 审批/校验/派工引用同一张 |

### 4.2 文件级改动

| 文件 | 改什么 | 验收 |
| --- | --- | --- |
| `canvas/references/videoProduction.md` | 新增 §0.1（推荐方案 §1.2 表 + 判定句 + 三键说明）；`:45` 的换算句改条件句；`:49`、`:79` 的默认口径改指针；恢复「按实际可用能力选图」的兜底 | 默认只在 §0.1 出现一次；grep 其余位置为指针 |
| `canvas/SKILL.md` | `:107` 换算句改条件句；`:120` 默认改指针；`:24`「分镜批量」改道多轨加条件（用户要做多轨才走） | 不再承诺非 freevideo 换算 |
| `workflow/SKILL.md` | `:45` 硬隔离改「格式随工程模型」；`:54` / `:57` 默认保留；PART A 入口改「A0 选定 Seedance 时」；`:31` / `:85` 的重复优先级收敛为一句；`:804` 保持指针 | PART A 十步原文不动；只改入口与重复句 |
| `workflow/SKILL.md` A9 段 | **不动**：A9.1、A9.2、九字段白名单、硬门、「不得交付」句原样 | 逐行 diff 为空 |
| `v118workflow/SKILL.md` | 删 `:13` 的时间叙事句，改条件句（「当用户点名本技能模板覆盖的模型，或要求复现指定画风时…」） | 不含四类时间叙事词 |
| `assetCard/references/imagePrompt.md` | `:21`、`:296` 删掉「不可用于新项目」的定性，改成「v118 模板是能力域的一种，点名时按卡执行」；补首帧图一节 | 模板链接可达；首帧图有落点 |
| `videoPromptCraft.md` | `:14` 的版本叙事改条件句 | 不含四类词 |
| `multitrackTemplate.md` | `:72` style 改可选、默认空；`:74` 默认保持；`:88-90` 三字段表改单串；`:152-163` 段首规则限定「正文」；`:199` 与基础三段对齐；`:200-202` 编号说明保留 | 六段表只此一处；字段表与代码一致 |
| `generationRunbook.md` | `:91` 双标签改单段首；`:514`、`:596`、`:108` 三字段叙述改单串；§四只留步骤，写法指向模板 §四 | 不再出现三字段写入示例 |
| `assetCard/SKILL.md` | `:85` 的字段叙述改单串；保留引用链接 | 链接全部可达 |
| `assetCard/references/assetCardTemplate.md` | `:36` 的链接与字段说明对齐 | 同上 |

### 4.3 文案规则

- 一律条件句：**「当工程模型为 X / 用户点名 X 时…」**，不写时间先后、不写「以前 / 现在」。
- 「三段式」拆名：Seedance 用「Seedance 三段式」，H3 用「基础三段」。
- 不在技能里重复默认值；默认只在 §0.1。
- 旧REF占位标记只作为叫法出现，不写模板语法字面量。

### 4.4 验收

1. `grep -n "默认.*freevideo" packages/skills` 只命中 §0.1（以及模板的数据默认值 `:74`，需加注释「数据默认值，不是路由默认值」）。
2. `grep -n "subject_definitions"` 只命中 H3 格式卡与必要示例；`canvas`、`runbook` 只留指针。
3. `grep -n "<Picture"` 只命中 H3 卡、非 freevideo 卡的必要示例；不再出现「所有供应商都会换算」的句子。
4. 四类时间叙事词 0 处。
5. 双花括号字面量 0 处（脚本匹配码位 123、123）。
6. `workflow/SKILL.md` 的 A9 段与改造前逐行一致。

---

## 5. B4：DSH 技能包（P0，R-11）

### 5.1 范围

`~/.dsh/skills/toonflow-mtrack` 9 个文件。只改仓库外的运行时副本，不改 DSH 本体。

| 文件 | 改什么 | 验收 |
| --- | --- | --- |
| `h3Format.md` | 三字段落位表改单串；删「引擎补 `detailed_description`」；首行规则限定正文；六段与两个声音段都写进同一字符串 | grep 无三字段写入示例 |
| `mtrackContract.md` | `prompt` 类型 string；`style` / `systemPrompt` 是前言；删三字段示例；声音段空值写 `N/A` 但仍在正文内 | 与仓库 H3 卡逐字同源 |
| `productionFlow.md` | 写单串；派工前核对模型；去掉三字段写入 | 流程步骤与 Blueprint 一致 |
| `troubleshooting.md` | 修复建议按格式卡补段，不再按字段补 | 不出现字段名式修复 |
| `mcpTools.md` | `prompt` 参数类型、示例改单串 | 与 `planOperator` 描述一致 |
| `SKILL.md` | 默认 freevideo 保留；多轨触发与条件句；不写时间叙事 | 触发词与仓库一致 |
| 其余 3 个文件 | 只做字段名与示例的机械对齐 | grep 无三字段 |

### 5.2 同步与验收

1. 从仓库 H3 卡复制段名与顺序，不手打第二份；DSH 与仓库的六段文本做 `diff`，允许的差异只有「面向 agent 的操作步骤」。
2. 改完后用 MCP-only 视角走一遍：读工程 → 判模型 → 写 `clips[].prompt` → 派工；确认不会写出三字段、不会把非 H3 写成六段。
3. 验收：`grep -n "integratedMultimodalDescription\|overallSoundscape\|nonDiegeticMusic"` 只命中「三字段数据读取」说明；写入示例 0 处。

---

## 6. B5：发布、运行时同步与迁移演练

### 6.1 发布前必须做的同步

| 对象 | 动作 | 为什么 |
| --- | --- | --- |
| `data/skills` | 用修复后的初始化器同步；或按 B3 文件清单手工覆盖；随后 sha256 比对 | 本次改的是**已存在**的技能文件，`force:false` 不会自动更新 |
| `data/skills/assetCard` | 确认 7 个文件齐全（含两个未跟踪新文件） | 否则 `workflow/SKILL.md` 六处强制指针运行时悬空（R-01） |
| MCP 工具描述 | 重新构建 `packages/tools/planOperator`，重启 dev / MCP 宿主 | 否则 agent 看到的仍是三字段 schema 与未同步的描述 |
| DSH 技能包 | 复制 9 个文件到 `~/.dsh/skills/toonflow-mtrack`，重载技能 | 否则 MCP agent 仍按三字段写（R-11） |
| 发布说明 | 写明「改造前构建不要打开新工程」、备份位置、600 → 200 的规则变化 | 避免用户误读「工程变干净」 |

### 6.2 迁移演练（用副本，不用真实工程）

1. 复制 `南柯一梦` 到临时目录；确认 200 镜、三字段结构。
2. 打开副本：`mtrackRead` 应返回单串；`prompt` 为空串（该工程三字段全空）。
3. 编辑一个镜头、保存：检查 `backup/` 出现文件、原始 JSON 的 `prompt` 为字符串。
4. 用改造前构建打开同一副本：确认「显示为空」的行为符合发布说明，不把这次打开当成验证通过。
5. 用备份覆盖，确认改造前构建恢复正常；记录回退耗时。
6. 在另一个**有内容**的工程副本上重复 2–4，并检查 3 个样本的逐字一致性。

### 6.3 验收总表

| 项 | 通过标准 |
| --- | --- |
| 类型与构建 | 仓库现有 typecheck / build 全绿；未新增测试文件 |
| 数据形状 | 全仓无三字段写入；`readPrompt` 幂等；三字段对象可读 |
| 派工 | 3 个样本逐字一致；空提示词被拦截；模型不一致能停 |
| 校验 | 200 error 可复现；规则增减表与文档一致；H3 段级 warning 只在有内容时出现 |
| 引导 | 默认单源、A9 原文不动、无时间叙事、无双花括号、无假换算承诺 |
| 运行时 | `data/skills` 42 文件哈希一致；DSH 9 文件同源；MCP 描述为单串 |
| 回退 | 备份覆盖可回到改造前构建；发布说明写明限制 |

---

## 7. 止损点（遇到就停，不要绕过）

1. **B1 无法原子提交**：停下拆方案，不允许先合「只改数据」或「只改消费者」。
2. **`planOperator` 加 `node-shared` 依赖引发打包/循环依赖**：停下报告；**不接受**退回「保留副本 + 注释」。
3. **逐字一致性比对失败**：停下修 `readPrompt` 的补段首与空行；不允许用「反正新格式更好」解释过去。
4. **备份无法原子写 / 备份失败仍继续**：停下；数据安全优先于迁移进度。
5. **`data/skills` 哈希不一致或 assetCard 缺失**：阻塞发布（R-01 会让强制规则在运行时消失）。
6. **DSH 未同步**：阻塞发布；只改仓库技能对 MCP agent 无效（R-11）。
7. **校验器出现「200 条 = 工程健康」的对外表述**：停下改文案，必须附规则增减表。

---

## 8. 提交切分建议

| 提交 | 内容 | 独立性 |
| --- | --- | --- |
| C1 | B0 技能同步机制 + 测试用临时目录验证（不新增测试文件） | 独立 |
| C2 | B1 原子批次（12 文件） | 只能整体回滚 |
| C3 | B2 切换影响评估 | 独立 |
| C4 | B3 仓库引导层 | 独立 |
| C5 | B4 DSH 9 文件 | 独立 |
| C6 | 发布说明 + 同步清单（文档） | 独立 |

C2 是唯一不可拆的提交；C4、C5 必须同一天进同一发布，不跨版本。
