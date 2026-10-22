# 资产卡与多轨校验工具（planOperator）

把 `assetCard` 技能定稿的契约变成可执行的确定性校验。工具只做解析、结算、校验、多轨回写与计划产出，不触发生成、不连画布节点、不调用供应商。

## 动作

| action | 说明 | 写入 |
|---|---|---|
| `parse` | 资产卡 Markdown → 卡数组 + warnings | 无 |
| `resolve` | Markdown → assetIndex 结构（含三级参考结算与四道守卫） | 无 |
| `validate` | V1–V15 里已实现的 V1/V2/V4/V7/V8/V9/V11–V15 校验（V3/V5/V6/V10 未实现，见下），输入 assets / mtrack / canvas 快照 | 无（只读） |
| `build` | validate 的 error 清零后，写入 `plan/assetIndex.json` 与 `plan/assetReport.json` | 是 |
| `mtrackRead` | 按 `from`/`to` 范围读多轨工程（含端点），返回 `clips` 全量字段与 `missing` | 无 |
| `mtrackUpdate` | 回写片段生成侧四字段（`status`/`nodeId`/`assetPath`/`attempts`），`updatedAt` 乐观并发 | 是 |
| `dispatch` | 按起止分镜号出逐镜派工清单（提示词、参考计划、生成参数、当前状态） | 无 |
| `assemble` | 出画布装配计划（资产节点分层 + 参考连线 + 片段节点），由 agent 执行 | 无 |
| `composite` | 取 `accepted` 片段出合成清单（复跑 V14 + assetPath 可读校验），写 `plan/composite.json`；`execute=true` 时先逐段 ffprobe 实测规格，再经宿主 ffmpeg 执行 concat | 是 |

`build`、`mtrackUpdate` 与 `composite` 写盘受 `allowBuild` 开关控制；关闭后 `mtrackRead`、`dispatch`、`assemble` 与三个原有只读动作仍可用。`story.mtrack` 由多轨编辑器与 `mtrackUpdate` 共同写入：编辑器持有全部字段，工具只回写生成侧四个字段并原子替换整份文件，真源字段（`seconds`/`prompt`/`referenceIds`/`continuity`）禁写。

## 参数

| 参数 | 适用 | 默认 |
|---|---|---|
| `markdown` | parse / resolve / build | 读盘 |
| `assetCardsPath` | resolve / build / dispatch / assemble | `assets/assetCards.md` |
| `mtrackPath` | validate / build | `plan/story.mtrack` |
| `mtrack` | validate / build（内联，优先于 mtrackPath） | — |
| `snapshot` | validate / build | 可省略（无画布侧校验） |
| `outputIndexPath` | build | `plan/assetIndex.json` |
| `outputPath` | build | `plan/assetReport.json` |
| `path` | mtrackRead / mtrackUpdate / dispatch / assemble / composite | `plan/story.mtrack` |
| `from` / `to` | mtrackRead / dispatch / assemble | mtrackRead 缺省 S001..末条；dispatch 必填；assemble 缺省全部 |
| `expectedUpdatedAt` | mtrackUpdate | 省略则不查冲突（仍原子写） |
| `updates` | mtrackUpdate | —（1–500 条） |
| `indexPath` | dispatch / assemble | `plan/assetIndex.json` |
| `execute` | composite | `false`（只产出合成清单并写 `plan/composite.json`；`true` 才调用宿主 ffmpeg 执行 concat） |
| `compositeOutputPath` | composite | `plan/composite.mp4`（已存在即报错，不自动重命名、不覆盖） |

`from`/`to` 为含端点的分镜号（`S001` 格式）；只传 `from` 时 `to` 等于 `from`。`updates` 每项只接受 `clipId` + 可写的四个字段，其他字段传了直接校验失败。

`snapshot` 来自 `getCanvasNodes` + `getCanvasEdges`；getCanvasNodes 有分页与截断，`total`/`truncated` 不完整时工具直接报错，不拿半份快照出结论。

### composite 合成清单

`composite` 取 `path`（默认 `plan/story.mtrack`）中 `status === "accepted"` 的片段，**按文件内原始顺序**（即合成顺序）组装清单：

- 没有 accepted 片段 → 报错「没有 accepted 片段可合成」；
- 复跑 `validatePlan` 筛出 `rule === "V14"` 的 error（只含 accepted、按 `clipId` 排序后连续无空洞）→ 不连续时报错并列断点；
- 逐段校验 `assetPath` 非空且文件真实可读 → 不可读时报错并列 `clipId`；
- 通过后写 `plan/composite.json`，并返回清单摘要与规格提示。清单模式写 `executed:false`；`execute=true` 成功后才改写为 `executed:true`，执行失败不会留下一份谎报已执行的清单。

各段 `ratio`/`resolution` 声明不一致时给 warning 级提示、不阻断；执行段另有实测核对（见下）。

`execute=true` 才进入执行段：先经宿主 ffprobe **逐段实测**尺寸、帧率、像素格式与音轨参数（`codec_name`/`sample_rate`/`channels`），任一段与首段不一致直接报错并列两段实际规格，挡在编码之前——concat 滤镜要求全段同尺寸/同帧率/同像素格式/同音轨参数，不一致时 ffmpeg 要么报一句不含线索的 `Conversion failed!`，要么静默产出时间戳错乱的成片。声明 `seconds` 与实测 `format.duration` 相差超过 1s 只记规格提示、不拦执行。

随后按合成顺序逐段 `input`，最后 `concat` 到输出文件（默认 `plan/composite.mp4`）。执行段需要宿主 ffmpeg 已就绪——未就绪时报错提示在插件市场下载安装或配置可用版本后重试。输出目录必须已存在（本工具不创建目录），输出文件已存在时报错要求换路径或确认后手动删除，**不自动重命名、不覆盖**。

## 校验规则（V1–V15）

> 实际实现的是 **V1、V2、V4、V7、V8、V9、V11、V12、V13、V14、V15**（`planValidator.ts` 里能产出 `rule:` 的集合）。**V3、V5、V6、V10 未实现**，下表逐条注明现状。

### 资产侧（V1–V9）

| 规则 | 级别 | 说明 |
|---|---|---|
| V1 | error | 资产卡编号全局唯一；重复即拒并列出两处行号 |
| V2 | error | 参考目标必须存在，且前缀匹配本卡 kind（人物/场景/道具/构图/声音） |
| V2 | error | 参考目标 kind 必须与本卡一致 |
| V3 | — | **未实现为 finding**。前向引用由 `packages/tools/planOperator/src/referenceResolver.ts` 以 `backwardsOnly` 告警拦截（该文件内三处 `target.order >= card.order`），`validate` 的 findings 里不会有 V3 |
| V4 | error | 构图卡 `KF*` 必须至少一个母版参考，不得无参考出图 |
| V5 | — | **未实现**（该块只产出 V9 warning） |
| V6 | — | **未实现**（画布入边数与参考数的一致性并入 V15，且 V15 需传 `snapshot`） |
| V7 | error / warning | 提示词三字段（`integratedMultimodalDescription`/`overallSoundscape`/`nonDiegeticMusic`）里的**官方标记** `<Picture N>`/`<Video N>`/`<Audio N>` 只查越界：N 必须落在该类型参考的数量上限内（画面 = 非 sound 卡数、音频 = sound 卡数、视频或参考卡缺 `kind` 时 = 参考总数），越界即 error；**不查重号**、也**不要求**每个编号出现。旧工程遗留的 `{{ref N}}` 只报迁移 warning「旧格式，建议迁移为 MiniMax H3 官方标记」。官方标记匹配大小写与内部空白不敏感（`/<\s*(picture|video|audio)\s*(\d+)\s*>/gi`） |
| V8 | error | 片段图片参考 ≤4；声音参考 ≤1；视频参考 ≤1 |
| V9 | warning | 文本类卡仍声明了参考 |

A3 修订：模式判定按节点实际 `matchingModes`，不写死「4 图就是多参考」。A4 修订：编号宽口径解析（`C1`、`c01-b` 均接受），索引侧规范化：补零不截断、后缀大写、`SC` 先于 `C` 匹配。

### 片段侧（V10–V15）

| 规则 | 级别 | 说明 |
|---|---|---|
| V10 | — | **未实现**。`node.data.mode` 是否仍在模型 `matchingModes` 内没有判定：`snapshotNodeSchema` 只接受 `id`/`type`/`status`/`outputs`，快照里根本没有 `data`，要在校验器里核对须先扩 schema。当前只能在读配置那一步用 `node:getConfig` 的 `matchingModes` 人工核对 |
| V11 | error | 片段 `clipId` 唯一、`S\d{3}` 格式、必填字段、`status` 枚举、`continuity` 枚举 |
| V12 | error | `seconds` 为 2–60 整数；`resolution ∈ {768P, 2K}`；`ratio` 合法 |
| V13 | error | `referenceIds` 全部存在于资产索引；文本类资产不得当图片参考；`generated`/`accepted` 必须有 `nodeId` + `assetPath`；`accepted` 时画布节点必须有可读视频产出 |
| V14 | error | 合成清单只含 `accepted` 片段；顺序连续无空洞 |
| V15 | error | `referenceIds` 顺序与画布节点实际 `referenceOrder` + 入边顺序一致 |

## 状态查询纪律

`node:getGenerationStatus` 的 `idle` 只表示本次打开节点后未发起生成，**不表示没有历史输出**。跨轮或换会话前必须先用 `getCanvasNodes({ fields: ["outputs"] })` 读该节点已产出的媒体，不能用 `idle` 推断未生成。回写 `status` 前必须确认 `assetPath` 文件可读，否则标 `failed` 并记原因。

## 构建与验证

```bash
bun install                              # 新增 workspace 包先安装
bun run --cwd packages/tools/planOperator typecheck
bun run dev:plugins                      # 同步到 data/tools/planOperator.tool.js
```

工具构建走 `@toonflow/tools-scaffold` 的 `createToolConfig`，与 `skillOperator` 同构。`build` 动作只写 `plan/` 下两个派生文件；不碰 `assets/`、不碰 `data/`、不碰 `skill/`。`composite` 执行段依赖宿主 ffmpeg（`@toonflow/ffmpeg`，随插件构建打包），ffmpeg 二进制未在插件市场安装或配置时报错，需用户先配置再执行。

## 能力边界

本工具走供应商 HTTP 时，LocalStoryCanvas 依赖本地 ComfyUI 的能力不可用。降级项由本节列出，`validate`/`build` 当前**不**输出 `capabilityDegraded` 字段——`validate` 只返回 `errors`/`warnings`/`findings`（外加 resolved、mtrackClips），`build` 的报告是 `generatedAt`/`errors`/`warnings`/`findings`。本次降级项（无 VAE identity、无原生 context latent 续接、无调度器/LoRA/二采 denoise）必须由 agent 主动告知用户。
