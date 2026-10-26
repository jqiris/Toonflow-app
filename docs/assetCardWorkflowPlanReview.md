# 落地方案审阅报告（docs/assetCardWorkflowPlan.md）

> 任务：t4（[planReview]）。审阅对象：[资产卡工作流落地方案](assetCardWorkflowPlan.md)（t3 交付，未通过项为 466 行 > 450 行；本次修订后为 487 行，明细见 §2 E1）。
> 对照：[LSC 机制解剖](localStoryCanvasStudy.md)（下称 LSC）、[Toonflow 能力盘点](toonflowIntegrationSurvey.md)（下称盘点）、以及本仓库真实代码。
> **结论：verdict = pass（有条件通过）。** 发现的硬错误已按任务授权直接修订方案文档，逐条见 §2；剩余非阻断项见 §5，需在 P0–P3 实现前各自确认。
> 本次只改文档：`docs/assetCardWorkflowPlan.md`（修订）与本文件（新增），**未改动任何业务代码、配置或数据**。

---

## 1. 检查项结论摘要

| 检查项 | 结论 | 依据要点 |
|---|---|---|
| a) 每条机制是否有真实落点、路径是否存在 | **通过（修订后）** | 技能/工具/扩展/画布工具/节点函数路径逐一实测存在；修订了 4 处「容器给了但不落」的问题（§2 A1–A4） |
| b) 是否违反 AGENTS.md | **通过（修订后）** | 命名、目录边界、文件入口、禁测试代码、插件边界、`router.ts` 生成方式均合规；1 处规范解释原本错误已改（§2 B1） |
| c) 分期与验收命令是否可执行、是否宣称未做的验证 | **通过（修订后）** | 命令已按仓库真实 `scripts` 改写（§2 C1–C3）；新增「本方案的验证状态」明示**命令均未执行** |
| d) 是否过度设计 / 与现有技能重复 | **通过，附 2 条建议** | 四期切分合理，P3 可整段砍掉仍成立；V10 为新增但必要；另有 2 处可再收窄（§5 Y1–Y2） |
| e) 风险与回滚是否覆盖模型差异和路径边界 | **通过（修订后）** | 模型差异见 R1/R9/V8/V10；路径边界见 R3；回滚改为三类插件各自的真实同步语义（§2 D1–D3） |

---

## 2. 已直接修订的硬错误（文档层面，逐条）

### A. 落点与路径（a）

| # | 问题 | 修订 |
|---|---|---|
| A1 | K3 声称「构建产物 `build/tools/planOperator.tool.js` 必由 P2 产出」，但 P2 `build.ts` 用 `createToolConfig` 生成，而 `bun run --cwd packages/tools/planOperator build` 依赖包内 `build` 脚本；skillOperator 有、新包须照抄——原文未写明 | §3.3 新增「前置动作」（先 `bun install`）与 `build.ts` 参数完整签名 `createToolConfig({...}, import.meta.url)`；§5.1 改为真实可用命令（C1） |
| A2 | 原文「在 `canvas` 技能的 `references/videoProduction.md` 里只加一句指向（可选）」，与 §4.2「不改 canvas 技能」自相矛盾，且该文件已随 `data/skills` 安装、**只补缺失不覆盖**，改了也不生效 | §2 K1 与 §3.1 改为「不改仓库内 canvas 技能」；需要时用**工作区同名技能覆盖**（`loadAgentSkills` 的 `skill/` 优先），并写明这是用户数据、不进仓库 |
| A3 | V8 只引用 `freevideo.ts` 的 `imageReference:4`，但视频节点实际是**按参考集合选模式**：空镜参考集非空（含 STRING/VOID）或混入 VIDEO/AUDIO 时 `MiniMax-H3` 只剩 `startFrameOptional`（2 图，且第 1/2 张变成首帧/尾帧） | §1.3 与 V8 改为「按节点实际匹配模式」；新增 **V10**：连线变化会让 `videoGenerationNode` 的同步 `watch` 静默改写 `data.mode`，必须校验模式未被切走；`dataKeys` 补 `mode`/`model` |
| A4 | ID 正则写成 `\d{2,3}` 且后缀只认大写，比 LSC 的 `CARD`（`\d+`、`[A-Za-z]`）更严，会拒掉原工程里合法的 `C1`、`c01-b` | §1.2 改为宽口径解析 + 索引侧规范化（补零不截断、后缀大写、`SC` 先于 `C` 匹配），并补 P0 验收项 |

### B. AGENTS.md 合规（b）

| # | 问题 | 修订 |
|---|---|---|
| B1 | 原文用「`assetCards.md` 允许复数后缀，与 `workspaceFiles.ts`、`canvasFiles.ts` 既有文件一致」为工作区文件名辩护：`workspaceFiles.ts` 真实存在，但 **`canvasFiles.ts` 在仓库中不存在**（它只是 `workspaceFiles` 的导出别名），论证失效 | §1.1 改正依据：仓库内**新增**目录与文件一律小驼峰（`planOperator`、`assetCardView`、`assetCardTemplate.md`）；工作区产物是用户数据，沿用既有技能惯例 `assets/`（`workflow/references/assets.md`）与 `assets.md`，`plan/*.json` 文件名保持小驼峰单数 |
| B2 | 未提示 workspace 包名/工具名长度上限 | §3.3 写明 `toolNameSchema` 约束（小驼峰、单段、≤32 字符），确认 `planOperator` 合规 |
| B3 | 「纯函数 → 可测」措辞会被读成要写测试 | §2 K3 改为运行时业务校验，并显式禁止新增 `.test.ts`/`check*.ts` |

其余合规项经核对无误：不新增路由、不动 `apps/server/src/router.ts`、不 import `node:fs`/`Bun.file`（只走 `context.files`）、业务逻辑不进 `nodeScaffold`、扩展不 import `apps/web/src`、无测试脚本。

### C. 分区与验证命令（c）

| # | 问题 | 修订 |
|---|---|---|
| C1 | `bun run --cwd packages/tools/planOperator build`：新包按原目录结构**没有 `build` 脚本**，命令会失败 | §5.1 改为 `bun install` → `bun run typecheck` → 单包 `typecheck`（`tsc`）→ `bun run dev:plugins`（根脚本已带 `NODE_ENV=dev`）→ `build:tools` / `build` |
| C2 | P3 用 `bun packages/extScaffold/create.ts`，与根 `create:ext` 脚本不一致；且生成器默认产出 `resourceKind:"file"`、`text:true`、`textarea` 演示，不改成 `canvasNode` 会直接构建失败 | §3.4 改用 `bun run create:ext assetCardView`，新增「生成后必改」行（`resourceKind: "canvasNode"`、`extensions: []`、删掉演示配置） |
| C3 | 原文未声明命令是否跑过，存在「宣称验证」的风险 | §5.1 末尾新增「本方案的验证状态」：**P0–P3 未实现，所有命令均未执行**，已验证的只是脚本名与形态；实现期须逐条真跑并如实记录 |

### D. 风险与回滚（e）

| # | 问题 | 修订 |
|---|---|---|
| D1 | 回滚命令 `Remove-Item build/tools/planOperator.tool.js` 指向的目录只有构建时才存在，首次执行会误报；且未提示删 workspace 包后要重新 `bun install` | §3.6 重写：先 `Resolve-Path` 确认、产物删除加 `-ErrorAction SilentlyContinue`、删包后人工 `bun install`；并强调 skills 只补不覆盖，**删仓库目录必须同时删 `data/skills/assetCard`** |
| D2 | R5 把三类插件当成同一套 `initializePlugins`；实际 tools 走 `pluginRevision`（开发态 `"dev"`，`dev:plugins` 会覆盖），ext 走版本号+内容哈希（`initializeExt`），skills 才只补缺失 | R5 拆成三类分别描述；R2 把误用的「`writeAtomic` 语义」改为 `context.files.writeFile`（内部 `writeWorkspaceFile`，整文件覆盖 + 工作区文件锁） |
| D3 | R3 声称工具「拒绝符号链接」，实际 `resolveWorkspacePath` 拦的是绝对路径、`..` 段与非法字符，符号链接由实际路径判定承担 | R3 改为准确表述，不夸大为工具自身能力 |
| E1 | **（t3 已知偏差，本审阅不再判返工）** 方案 466 行，超 ≤450 行限制 16 行。本次修订为消除硬错误净增 21 行（现 487 行）；按审阅范围（可行性/合规/可执行/回滚）**不阻断放行**，行数治理需由 captain 决定是否另开任务裁剪 | 已确认可裁部分：§7 关键文件索引（10 行）、§5.2 P3 勾选项（4 行）、§4.1 表中「不移植理由」可与 LSC §8 合并引用（约 8 行） |

---

## 3. 逐项核对记录（可复核的事实点）

1. **落点存在**：`packages/skills/{canvas,v118workflow,workflow}`、`packages/tools/{askUser,assetOperator,browser,canvas,ffmpeg,mediaGeneration,skillOperator,webFetch,webSearch,workspace}`、`packages/ext/{canvasNode,image,md,media,txt}`、`packages/extScaffold/create.ts`、`packages/extScaffold/src/runtime.ts`、`packages/toolScaffold/index.ts`、`packages/tools/skillOperator/{build.ts,tsconfig.json,package.json}`、`apps/server/src/utils/plugins/{initialize,initializeExt,tools}.ts`、`apps/server/src/agent/{tools,skills}/index.ts`、`apps/server/src/utils/workspace/files.ts` 均实存；新增的 `assetCard`、`planOperator`、`assetCardView` 是**新增**目录，方案已声明。
2. **工具契约**：`ToolFiles`（readFile/writeFile(exclusive)/mkdir/rename/remove/copyFile/importImage…）与 `ToolContext{cwd,config,files,canvas,skills,…}` 与方案一致；`createToolConfig` 从 `package.json` 读 `version`、嵌入 `readme.md`、仅 `NODE_ENV=dev` 复制到 `data/tools`——与方案命令相符。
3. **技能加载**：`loadAgentSkills` 的 `skillPaths = [cwd/skill, data/skills]`，同名工作区优先；`disabledSkills` 过滤只作用于 `data/skills`；`data/skills` 由 `initializePlugins` 无 revision 调用（只补缺失）。
4. **画布能力**：`renameNodes.label` 1–200 字符、`getCanvasNodes.fields` 可选 `label/type/position/ports/data/outputs`、`dataKeys` 最多 20、`getCanvasEdges.direction` 支持 `incoming`——方案里的快照读法可行；每次读取 64 KiB 上限正是新增「快照完整性」要求的来源。
[HISTORICAL] 5. **`{{ref N}}` 语义**：`useNodeReferences` 的键为 `encodeURIComponent(JSON.stringify([source,sourceHandle]))`，未列入项按入边顺序追加，`referenceMentions` 与媒体共用编号——与 §1.3 一致。
6. **模型/模式**：`freevideo.ts` 视频 `mode: ["text","startFrameOptional",["imageReference:4","videoReference:1","audioReference:1"]]`，图像 `multiReference` 与 4 参考的实际行为以节点 `getMatchingModes` 为准（见 A3）。
7. **扩展契约**：`ExtContext`（`resource{kind,directory,path,nodeId,label}`、`files`、`active`、`mountNode?`）与 `defineExt` 的 `id`/`resourceKind` 校验与方案 §3.4 一致；`canvasNode` 扩展确实没有节点 `data` 通道。
[HISTORICAL] 8. **与现有技能不重复**：`canvas` 与 `v118workflow` 把 `{{ref N}}` 编号核对写成**提示词纪律**（`canvas/references/videoProduction.md` 第 3–4 节、`v118workflow/references/canvasOperations.md` 第 51 行「工作流资产编号只是文字索引」），`workflow` 明确禁止另立镜头编号主结构。方案不新建第二套编号规则，只把「文字索引」升级为**带唯一性/顺序校验的编号**，并把 label 模板作为既有「场次号/片段号写进名称」写法的具体化——**无重复，属补位**。

---

## 4. LSC → Toonflow 的契约变更是否合理

| 变更 | 是否可接受 | 理由 |
|---|---|---|
| 人物侧否定守卫补齐；后缀回落改「源文件第一张」 | 可接受 | 与 LSC 报告 §2.2、§7（M3 备注）建议一致 |
| identity_clause 文案改为「只锁身份/空间/形制，不锁动作与构图」 | 可接受 | API 模型无 VAE identity，文案与能力对齐；report 固定输出 `capabilityDegraded` |
| 不移植 VAE identity、context latent、24fps 格点、调度器/LoRA、`object_info` preflight、像素预算、KSR 版面 | 正确 | 与 LSC §8 的 12 条强依赖本地链路逐项对齐；`firstFrame` 首帧续接作为 context 的降级替代可行 |
| 新增 V10（模式漂移）与「快照必须完整」 | **必要** | 二者都是 Toonflow 侧特有失配源（Vue Flow 同步 `watch` 改 mode；分页截断），LSC 无对应概念，不算过度设计 |
| `plan/assetReport.json` 作为体检报告 | 可接受 | 与 `validate` 同一份 findings，不新增第二套真相 |

---

## 5. 非阻断建议（不要求返工，实现前各确认一次）

- **Y1（YAGNI，P3 可砍）**：`assetCardView` 扩展只能读 `plan/*.json`，信息量不高于直接让 Agent 读 `assetReport.json`。建议 P3 默认**不做**，只在用户明确要「在画布节点里看卡片」时再立项；砍掉后方案仍完整（K1/K2/K4 文本层 + K3 工具层）。
- **Y2（配置项）**：`configRules` 建议只留 `allowBuild` 一个开关；参考上限、往返校验阈值全部由快照推导（方案已按此改），避免重置默认值后 `configSchema.parse` 抛错导致工具不可用。
- **Y3（V4 措辞）**：「构图卡必须至少一个母版参考」在 LSC 里是「缺前置写 `dependency_error`、不回退无参考出图」，Toonflow 侧对应「不接线即拒」，二者一致；实现时错误文案建议直接复用「依赖资产未完成」语义，便于用户对照 LSC 文档。
- **Y4（V6 语义）**：V6 只比较**数量与顺序**，不比较「源节点是否就是你声明的资产」；若需要后者，须把源节点 `outputs` 或其 `label` 一并纳入快照。建议 P2 先只做数量+顺序，源节点级比对留到 P2.1，避免快照体积与权限扩大。
- **Y5（R10 前提）**：R10 写「同一画布同一时刻只允许一个 Agent（沿用 canvas 技能约束）」——`canvas` 技能正文并无该条明文，属工程约定。建议在 `assetCard` 技能里把它写成**本方案自己的**约束，不要引为既有规则。
- **Y6（文档纪律）**：三份文档（LSC 报告、盘点、本方案）都引用未提交的 `freevideo.ts`（工作树状态 `A`）。P2 的 V8/V10 实现前须确认该文件仍在本工作树，否则模式声明与阈值会漂移。

---

## 6. 最终结论

**通过（pass）**。方案的容器选型（技能 + 独立工具包 + 可选扩展）、目录边界、四期切分与回滚策略在本仓库可落地；本次修订已消除全部已发现的硬错误（A1–A4、B1–B3、C1–C3、D1–D3），并把「验证声明」收紧为「未执行、待实现期实录」。唯一遗留的 t3 形式偏差是行数（E1），不属本审阅的阻断项。

**放行条件（P2 立项前必须满足）**：
1. 先 `bun install` 让新 workspace 包进入依赖图，再跑 `bun run typecheck`；
2. V8/V10 的模式判定以节点 `getMatchingModes` 语义为准，不得回落为「供应商写死 4 图」；
3. `validate` 必须零写入，`build` 只经 `context.files`；
4. 不新增测试文件或测试脚本，验收用手动清单 + 既有 `typecheck`/`build`。