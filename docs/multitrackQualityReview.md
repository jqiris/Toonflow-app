# 多轨制作流水线质量审阅（M0–M3 产出）

> 审阅人：captain（t5 attempt 6，接手原因：qualityReviewer / toolEngineer / extEngineer 连续 `PI_AI_ERROR` provider 故障）
> 审阅对象：M0 技能契约、M1 `planOperator` 工具、M2 `multitrack` 扩展、M3 生成 SOP，对照 `docs/` 下已定稿方案。
> 审阅时间：2026-10-19。

[HISTORICAL] > **现状更新（2026-10-25）**：文中「写作者直接写官方六段 + `<Picture N>`」「旧 `{{ref N}}` 只报迁移 warning」两条口径已反转——写作者写 `{{ref N}}`（N = `referenceIds` 位次），写 `<Picture N>` 会被 V7 判 error（`planValidator.ts:239-245`）；角色参考板统一 16:9·2K 四栏；资产与分镜接入由画布「导入资产与分镜」节点（`packages/nodes/assetImportNode`）承接。本文件其余审阅结论保留为当时记录。

---

## 1. 交付物清单（全部核实存在）

| 项 | 路径 | 行数 | 状态 |
|---|---|---|---|
| M0 技能主文件 | `packages/skills/assetCard/SKILL.md` | 73 | ✅ |
| M0 资产卡模板 | `packages/skills/assetCard/references/assetCardTemplate.md` | 110 | ✅ |
| M0 参考解析 | `packages/skills/assetCard/references/referenceResolution.md` | 164 | ✅ |
| M0 多轨模板 | `packages/skills/assetCard/references/multitrackTemplate.md` | 194 | ✅ |
| M3 生成 SOP | `packages/skills/assetCard/references/generationRunbook.md` | 185 | ✅ |
| M1 工具配置 | `packages/tools/planOperator/build.ts` | 18 | ✅ |
| M1 工具入口 | `packages/tools/planOperator/src/index.ts` | 232 | ✅ |
| M1 校验器 | `packages/tools/planOperator/src/planValidator.ts` | 242 | ✅ |
| M1 解析器 | `packages/tools/planOperator/src/assetCardParser.ts` / `referenceResolver.ts` / `indexStore.ts` | 4 文件 | ✅ |
| M2 扩展元数据 | `packages/ext/multitrack/src/metadata.ts` | 9 | ✅ |
| M2 工程模型 | `packages/ext/multitrack/src/mtrackProject.ts` | 85+ | ✅ |
| M2 容器与组件 | `packages/ext/multitrack/src/index.vue` + `components/{trackBar,clipEditor,referenceList,statusPanel}.vue` | 8 文件 | ✅ |

## 2. 本轮发现的硬错误（已由 captain 直接修复）

### E1. 多轨工程文件名不一致（阻断性）

**问题**：M2 实现把工程文件定为 `plan/story.mtrack`（`metadata.ts` 的 `extensions: ["mtrack"]`、`mtrackProject.ts` 的 `defaultProjectPath`），但 M0/M1/M3 的文档与工具**仍写 `plan/story.mtrack.json`**。

**根因**：任务书（M2）字面写的 `["mtrack.json"]` 与实际宿主契约冲突——
1. `packages/extScaffold/src/runtime.ts:63` 要求后缀匹配 `/^[a-z0-9]+$/`（**不带点**），`"mtrack.json"` 构建期 zod 直接报错；
2. `apps/web/src/pages/workspace/panels/document/extensions.ts:118` 取后缀用 `path.split(".").at(-1)`，`story.mtrack.json` 的后缀被识别为 `"json"`，会与工作区所有 `.json` 文件撞关联。

**已修复**（全部改为 `story.mtrack`，内容仍是 JSON，并补扩展名决策说明）：
- `packages/skills/assetCard/SKILL.md`（4 处）
- `packages/skills/assetCard/references/multitrackTemplate.md`（标题 + 定位节）
- `packages/skills/assetCard/references/generationRunbook.md`（准入条件 1）
- `packages/tools/planOperator/src/index.ts`（`mtrackPath` 默认值、`path` describe）
- `packages/tools/planOperator/build.ts`（prompt）
- `packages/tools/planOperator/readme.md`（2 处）
- `docs/multitrackProductionPlan.md`（9 处 + 新增扩展名说明段）
- `docs/toonflowMultitrackFeasibility.md`（§2 结论改为 M2 实现后修订 + §7 待验证 4）
- `docs/multitrackProductionPlanReview.md`（3 处）
- `docs/requirementRevisionNodeMultitrack.md`（4 处）
- `docs/officialPluginGuideFindings.md`（1 处）

### E2. 方案文档承诺了 M2 未实现的 `mountNode` 预览

**问题**：`docs/multitrackProductionPlan.md` §0/§3.1 把 `mountNode` 预览列为编辑器层能力，§7 待验证 1 要求「M2 建测试面板挂载实测」。

**事实**：`apps/web/src/pages/workspace/panels/document/index.vue` 仅在 `resource.kind === "canvasNode"` 时注入 `mountNode`；`resourceKind: "file"` 的扩展（含本扩展）拿不到。extEngineer 的只读推断与此一致，`statusPanel.vue` 实际走 `context.files.acquireUrl(assetPath, "video/mp4")`。

**已修复**：方案 §0 层职责表、§3.1 能做/不能做表改为「经宿主 `acquireUrl` 预览该镜视频文件」；§7 待验证 1 改为「宿主 `mountNode` 注入是否覆盖 `resourceKind:"file"` 扩展」并注明已按不可用设计；审阅文档 §5 同步。

## 3. 契约一致性核对（修复 E1/E2 后）

| 核对项 | 结论 |
|---|---|
| 多轨字段表（模板 §2 vs `planValidator.ts` `MultitrackClip`） | ✅ 一致：`clipId/seconds/ratio/resolution/generateAudio/prompt.*/referenceIds/continuity/status/nodeId/assetPath` 全部对齐；`seconds` 2–60 整数、`resolution ∈ {768P,2K}`、`ratio` 五档、`clipId ^S\d{3}$` 与 V11/V12 实现逐字一致 |
| 状态机（模板 §3 vs `resolvedToLite`/`clipSchema`） | ✅ 一致：`pending/generating/generated/accepted/failed` 五态，`planValidator.ts:154` 同集合 |
| 参考上限 4（模板 §2.2 vs `MAX_IMAGE_REFERENCES`） | ✅ 一致：`planValidator.ts:80` V8 同值；编辑器 `referenceList` 上限 4 同值 |
[HISTORICAL] | 参考顺序协议（写作者标 `{{ref N}}`，模板 §四 vs SOP §四） | ✅ 现口径一致：写作者写 `{{ref N}}`（N = `referenceIds` 位次），模板 §四 与 SOP §四 仍要求写作者直接写官方六段，但标记不是 `<Picture N>`——尖括号只在 wire 层换算后出现，写进正文会被 V7 判 error |
[HISTORICAL] | V7 校验 | ✅ 已实现（口径已反转）：现行 V7 把 `<Picture N>`/`<Video N>`/`<Audio N>` 当非法写法报 error（`planValidator.ts:239-245`），只校验 `{{ref N}}` 是否越界、不查重号；旧「尖括号是官方标记」的记录作废 |
| 生成调用序列 11 步（SOP §一 vs 方案 §4.1） | ✅ 一致 |
| 状态查询纪律（SOP §二 vs 方案 §4.6 vs 工具 promptGuidelines） | ✅ 一致，三处同文 |
| 能力边界/降级（SKILL.md vs SOP §十 vs readme） | ⚠️ 见 W2（`capabilityDegraded` 字段未实现） |
| 编号/前缀/参考规则（模板 vs LSC 研究报告） | ✅ 一致（C/SC/P/KF/S、状态后缀、宽口径解析） |

## 4. AGENTS.md 合规

| 规则 | 结论 |
|---|---|
| 小驼峰文件/目录名 | ✅ `planOperator/`、`assetCard/`、`multitrack/`、`mtrackProject.ts`、`trackBar.vue`、`statusPanel.vue` 等全部小驼峰 |
| `.vue` 顶层 `<template>→<script>→<style>` | ✅ 抽查 `statusPanel.vue`、`index.vue` 顺序正确 |
| 自有组件标签小驼峰 | ✅ `track-bar` 未出现，模板内使用小驼峰标签 |
| 文件操作入口 | ✅ 编辑器 `index.vue:139` 走 `props.context.files.acquireUrl`，`writeJson`/`readJson` 经宿主；工具侧经 `context.files`（`indexStore.ts`） |
| 无新增测试文件 | ✅ 全仓 `.test/.spec` 未新增；`cmd /c` 只为绕 PowerShell stderr 回抛，非测试 |
| 插件边界（不动现有业务代码） | ✅ `git status` 确认三份改动全部在新增目录 + 上述 docs；`packages/ext/multitrack/package.json` 仅补 element-plus peer（与 `packages/ext/media` 一致，属构建必需） |
| server 路由未手改 | ✅ 未触碰 `apps/server` |

## 5. 过度设计检查（YAGNI）

| 项 | 判断 |
|---|---|
| `planOperator` 只做 parse/resolve/validate/build 四个动作 | ✅ 恰好覆盖，无冗余层 |
| 工具 `dispatch` action（方案 §6 M3 曾提） | ✅ **未实现**——M3 只写 SOP，符合「按阶段推进、不提前造能力」；方案 §6 M3 行已注明「工具加 `dispatch` action」属后续，需回改方案 |
| `P3 assetCardView` | ✅ 明确不做 |
| M4 `composite.json` 合成 | ✅ 未提前实现，V14 只校验 |
| 编辑器 rfmt | ✅ 无多余抽象，`mtrackProject.ts` 为纯函数模块 |

## 6. 非阻断问题与建议

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
[HISTORICAL] | W1 | V7（旧口径：`{{ref N}}` 在 `1..参考数` 内且每个 N 至少出现一次）在 `planValidator.ts` **未实现** | 提示词越界不报错，靠人工 | **已修复**：现行 V7 校验 `{{ref N}}` 是否越界、不查重号；`<Picture N>`/`<Video N>`/`<Audio N>` 一律 error（`packages/tools/planOperator/src/planValidator.ts:239-257`） |
| W2 | `capabilityDegraded` 字段在 `planValidator.ts` 与 `build` 产出中**未实现**，SKILL.md/readme/SOP §十 三处宣称「固定输出」 | 降级项不显式落盘 | M1 补 `capabilityDegraded: string[]` 常量字段（3 项降级恒为 true，直接静态输出） |
| W3 | `mtrackSchema`（`index.ts:30-33`）不含 `version/projectId/updatedAt/global.style/global.systemPrompt/global.model` 与 `clips[].title/sourceRange/attempts/notes` | 这些字段不被校验也不被拒（`z.object` 非 strict，静默忽略） | 可接受：V11–V15 不依赖这些字段；但应在 readme 注明「未校验字段清单」避免误以为校验过 |
| W4 | 方案 §6 M3 行仍写「工具加 `dispatch` action」 | 与已交付范围不符 | 已在方案 §6 M3 保留为后续项，建议下一轮明确「M3 仅 SOP，dispatch 待定」 |
| W5 | `build-planop.log` 已删；无遗留临时文件 | — | ✅ 已清理 |

## 7. 构建验证（本轮 captain 复跑）

| 命令 | 结果 |
|---|---|
| `bun run --cwd packages/tools/planOperator typecheck` | ✅ EXITCODE=0（`tsc` 无输出） |
| `bun run --cwd packages/ext/multitrack typecheck` | ✅ EXITCODE=0（`vue-tsc` 无输出） |
| 此前（member 执行）`bun run dev:plugins` | ✅ EXITCODE=0；`data/tools/planOperator.tool.js` 29038 字节、`data/ext/ext-multitrack.umd.js` 35.44 kB，hash 与 `build/` 一致 |

未复跑 build/dev:plugins 的原因：本轮只改文档与工具 describe 字符串、默认路径值，未改类型与导出；typecheck 通过即可覆盖。如实说明：**未重新生成 `data/` 产物**，`data/tools/planOperator.tool.js` 仍是改动前版本（差异仅为 JS 内联文本）。

## 8. 结论

**verdict = pass（带 2 项非阻断建议 W1/W2）**

- 阻断性问题 E1（文档与实现的工程文件名不一致）已在本轮修复并全仓对齐；
- E2（方案承诺未实现的 `mountNode`）已改为与实际实现一致的 `acquireUrl` 路径；
- 契约一致性、AGENTS.md 合规、构建可执行性均符合定稿方案；
- W1/W2 不阻断「对 1 镜跑通全链路」，但 M3 SOP §十一 已如实标注「尚未实际执行过生成验证」，未宣称完成未做的事。

## 9. 后续待办（用户决策）

1. M3 验收项「对 1 镜跑通全链路，状态正确回写」仍未执行——需启动应用实跑；
2. W1/W2 是否在 M4 前补（V7 + `capabilityDegraded`）；
3. `dispatch` action 是否仍属本期范围。