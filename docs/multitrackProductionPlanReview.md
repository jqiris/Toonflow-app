# 多轨制作流水线方案审阅报告

> 任务：t8。审阅对象 [docs/multitrackProductionPlan.md](multitrackProductionPlan.md)。
> 输入对照：[LSC 多轨契约](localStoryCanvasMultitrackStudy.md)、[Toonflow 多轨可行性](toonflowMultitrackFeasibility.md)、[资产卡方案](assetCardWorkflowPlan.md)、[资产卡审阅](assetCardWorkflowPlanReview.md) 及本仓库源码。
>
> **结论：verdict = pass（有条件通过）。** 修正 2 处硬错误（均为状态查询语义），方案可据以实施。
> 审阅说明：原执行成员因模型侧 429 连续失败，t7 与 t8 均由 captain 完成；本轮审阅为**自查 + 实测复核**，所有结论均来自源码，不是对他人文稿的信任式放行。

---

## 1. 已修正的硬错误

| # | 问题 | 实测依据 | 修订 |
|---|---|---|---|
| F1 | 原方案写「轮询 `getGenerationStatus` 直到终态」 | `packages/nodeShared/src/useNodeGeneration.ts:11-16`：状态只有 `idle/running/succeeded/failed`，函数描述明确「idle 不表示没有历史输出」 | §4.1 第 10 步改为「同一轮内查终态；跨轮前必须读 outputs 确认产出」，新增 §4.6 状态能力表与三条纪律 |
| F2 | 隐含假设「可用状态字段跨轮判断任务结果」 | 同一文件：`status` 是 `ref`，语义为「查询本次打开节点后的生成状态」 | §4.6 纪律 2：换会话后必须用 `getCanvasNodes({fields:["outputs"]})` 读产物，禁止用 `idle` 推断未生成 |

> 这两处若不修，实现时会出现「提交后换轮，看到 `idle` 判失败并重试同一镜」，导致重复提交与算力浪费。

---

## 2. 可行性逐项核对

| 核对项 | 结论 | 依据 |
|---|---|---|
| 扩展能否承载多轨工程 | ✅ | `ExtFiles` 13 个方法；`documentExtensions` 按后缀关联（`document/extensions.ts`） |
| 扩展无节点写通道 | ✅ | `resource` 仅 `{kind,directory,path,nodeId,label}`；`connectNodes/addNode/nodeTools` 只在 `tools/canvas` 里 |
| 扩展直接调 ffmpeg 不可行 | ✅ | `/api/ffmpeg/execute` 首行 `u.mcpControl.assertAppRequest(req)` |
| 生成调用序列每步有真实函数 | ✅ | `addNode/connectNodes`（`tools/canvas/src/runtime.ts:56,60`）；`nodeTools` name 正则 `/^[a-z][a-zA-Z0-9]{0,63}$/`；视频节点注册 4 个函数（`videoGenerationNode/src/index.vue:380-455`） |
| FreeVideo 参数 | ✅ | `freevideo.ts:194-202`：duration 2–60 逐秒、resolution 768P/2K、mode 三项、audio optional |
| 模式判定 | ✅ | `setConfig` 用 `getMatchingModes` 校验，`node:getConfig` 返回 `matchingModes` |
| 费用 | ✅ | `getPrice()` 返回「免费 · 本机 GPU 生成，无计费」 |
| 合成路径 | ✅ | 工具 `ffmpeg` 支持原生 `concat`（`tools/ffmpeg/readme.md`）；节点内 `useNodeFfmpeg()` |

---

## 3. 契约自洽性

- `story.mtrack`（自定义 mtrack 后缀，JSON 内容）定为**单一真源**，并明确**取代** `assetCardWorkflowPlan.md` 的 `plan/segmentMap.json`（原 K5），避免两套真相 —— 已在方案 §9 写明。
- `assetIndex.json` 保留（资产层索引，非片段层），分层正确：资产层判「参考是否合法/已出图」，片段层判「顺序与数量」。
- 校验分层合理：V1–V10 资产层（复用），V11–V15 片段层（新增），V15 把「顺序一致」落到画布真实 `referenceOrder`。

---

## 4. 与需求的对齐度

| 需求 | 方案对应 |
|---|---|
| 制作流程和 LSC 一样 | §1 端到端流水线，逐阶段产物/关口/回退对齐 LSC |
| 前期定资产和分镜格式 | 阶段 2/3，`assets/assetCards.md` + `plan/storyboard.md`，编号与接线先锁死 |
| 统一接入多轨 | 阶段 4，`story.mtrack` 由分镜稿一次性导入 |
| 多轨界面参考 LSC | §3.2：横向轨道、宽度正比、选中态、增删排序、每镜时长/衔接/提示词、快照文案 |
| 每个分镜用 FreeVideo 生成 | §4.1 调用序列 + §4.2 参数规则 |

---

## 5. 待验证清单（实施前逐条实测）

| # | 项 | 风险 | 何时验 |
|---|---|---|---|
| 1 | `mountNode` 对 `resourceKind:"file"` 扩展是否注入（只读推断仅 canvasNode 注入） | 预览挂不上 | M2（已按不可用设计，走 acquireUrl） |
| 2 | 4 图 vs 3 图+1 视频的真实 `matchingModes` | 模式选错被 `setConfig` 拒 | M3 |
| 3 | 60 秒长任务的终态确认 | 状态误判 | M3 |
| 4 | `.mtrack` 扩展关联持久化 | 每次要手动选扩展 | M2 |
| 5 | 768P 与 2K 片段 concat | 合成失败 | M4 |

---

## 6. 非阻断建议

- **N1（已解除）**：`freevideo.ts` 原为未提交状态（`A`），现已被提交为 `3072611 接入freevideo`，`git ls-files` 确认已跟踪。**原「M1 前先提交」的前置条件已满足**，模式声明阈值可据此锁定。
- **N2**：M2 若 `mountNode` 对视频节点不可用，降级为「编辑器内嵌 `<video>` 读 `assetPath`」（`acquireUrl` 支持），不影响其余设计。
- **N3**：`continuity: "continue"` 的首帧续接需要「从上一镜截帧」，而截帧能力在视频播放器内。建议 M4 再实现该分支，M3 先只支持 `start`/`cut`，避免一次性铺太大。

---

## 7. 最终结论

**通过（pass）**。方案的需求对齐、容器边界（扩展不碰节点）、契约单一真源、FreeVideo 参数与校验分层均经源码核实成立；2 处状态查询语义错误已修正。

**实施顺序**：M0（技能契约）→ M1（工具校验，前置提交 `freevideo.ts`）→ M3（单镜生成闭环，只做 `start`/`cut`）→ M2（多轨编辑器）→ M4（合成 + 首帧续接）。


