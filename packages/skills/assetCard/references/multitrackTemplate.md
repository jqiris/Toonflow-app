# 多轨工程模板（`plan/story.mtrack`，JSON 内容，自定义扩展名 mtrack）

> 权威依据：[docs/multitrackProductionPlan.md](../../../../docs/multitrackProductionPlan.md) §2（全量契约）、§2.5（参考顺序协议）、§3.4（保存与冲突）、§4.1/§4.6（生成调用序列与状态查询纪律）、§5（V11–V15）、§9（与 `segmentMap.json` 的关系）。
> 资产侧编号与接线规则见 [参考接线解析规则](referenceResolution.md)；卡片写法见 [资产卡模板](assetCardTemplate.md)。
> 本文件只描述**契约与写作文本纪律**，不描述编辑器实现（编辑器内核属于 `packages/nodeShared/src/mtrack/`，画布节点在 `packages/nodes/multitrackNode`）。

---

## 〇、定位与边界

- `plan/story.mtrack` 是**唯一真源**：分镜、参数、参考顺序、生成状态只在这里。画布节点是执行载体，画布 JSON 不存业务语义。该文件为 JSON 内容、自定义 `.mtrack` 扩展名（宿主按 `split(".").at(-1)` 关联，`.mtrack.json` 会被识别为 json 撞关联）。
- 它**取代** [旧方案](../../../../docs/assetCardWorkflowPlan.md) 的 `plan/segmentMap.json`（片段 → 节点映射）：`clips[].nodeId` 就是映射，不再维护第二份文件。
- 写者只有两条通道：①多轨编辑器内核（`packages/nodeShared/src/mtrack/`，文档面板扩展与画布多轨节点共用同一实现）——界面「生成选中段」「批量生成…」与 `node:dispatchGenerate` 都是直连生成（`directDispatch.ts` 的 `beginDirectDispatch`），`status`/`nodeId`/`assetPath`/`attempts` 由编辑器写；②`planOperator`——`build` 写工程初稿，`mtrackUpdate` 在 Agent 按生成 SOP 逐镜编排（会话内路径）时写状态。**Agent 不手改该文件**（不直接写 JSON、不调 `files.writeJson`）；两条通道同经 `updatedAt` CAS 对账，谁先落盘谁更新。人工手改视为草案，下次校验会被指出。
- 路径一律工作区相对、`/` 分隔；写入走 `context.files`（工具）或 `ExtFiles`（扩展），不直接调 `node:fs` / `Bun.write`。

---

## 一、文件骨架

```jsonc
{
  "version": 1,
  "projectId": "nanKe",
  "updatedAt": "2026-10-19T10:00:00+08:00",
  "global": {
    "ratio": "9:16",
    "style": "写实电影质感，自然光，胶片颗粒",
    "systemPrompt": "…（可选：全片规则，渲染时拼到画面正文开头（段首），不新增段落标题；为空则完全不出现）",
    "model": { "providerId": "freevideo", "modelId": "MiniMax-H3" }
  },
  "clips": [
    {
      "clipId": "S001",
      "title": "槐下饮酒",
      "sourceRange": { "fromSegment": 1, "toSegment": 2 },
      "seconds": 8,
      "ratio": "9:16",
      "resolution": "768P",
      "generateAudio": true,
      "prompt": {
        "integratedMultimodalDescription": "[Shot 1] Live-action, cinematic, dusk light under the old locust tree south of the Guangling mansion. C01 raises the bowl and drinks; [Shot 2] At 00:04.500, the camera cuts to a close shot of the bowl tilting.",
        "overallSoundscape": "Cicadas, wind through locust leaves, the clink of the ceramic bowl.",
        "nonDiegeticMusic": "A low guzheng and xiao motif, sparse."
      },
      "referenceIds": ["C01", "C03", "C05", "SC02"],
      "continuity": "start",
      "status": "pending",
      "nodeId": null,
      "assetPath": null,
      "attempts": [],
      "notes": ""
    }
  ]
}
```

---

## 二、字段表

### 2.1 根字段

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `version` | number | ✅ | 当前为 `1` | 契约版本，升级时整体迁移，不原地改写 |
| `projectId` | string | ✅ | 非空 | 项目标识，用于跨文件对账 |
| `updatedAt` | string | ✅ | ISO 8601 带时区 | **写者每次保存必须刷新**，冲突判定见 §五 |
| `global` | object | ✅ | 见下 | 全片默认值，`clips[]` 同名项覆盖它 |
| `global.ratio` | string | ✅ | `9:16`/`16:9`/`1:1`/`4:3`/`3:4` | 默认画幅 |
| `global.style` | string | ✅ | 非空 | 风格统一词 |
| `global.systemPrompt` | string | 否 | — | 可选的规则段，渲染时拼到画面正文开头（段首），不新增段落标题；`style`/`systemPrompt` 为空时完全不出现，输出与不填时逐字节一致 |
| `global.model` | object | ✅ | `{ providerId, modelId }` | 本工程目标模型；默认 `{ "freevideo", "MiniMax-H3" }` |
| `clips` | array | ✅ | ≥1，`clipId` 唯一 | 片段数组，**顺序 = 合成顺序** |

### 2.2 `clips[]` 字段

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `clipId` | string | ✅ | `^S\d{3}$`，全文件唯一 | 片段 ID |
| `title` | string | ✅ | 1–120 字符 | 显示名 |
| `sourceRange` | object | 否 | `{ fromSegment, toSegment }` | 溯源到剧本/分镜稿的段号，便于回改 |
| `seconds` | number | ✅ | **整数 2–60** | 提交整数秒；实际成片落在引擎 `17n+5` 网格（6s→6.583s，10s→10.125s），≥30s 自动分块时参考图实限 3 张 |
| `ratio` | string | ✅ | 五档枚举 | 与 `global.ratio` 不同则覆盖 |
| `resolution` | string | ✅ | `768P`/`2K` | 来自 `durationResolutionMap`（V12） |
| `generateAudio` | boolean | ✅ | — | H3 `audio: "optional"` 的开关 |
| `prompt.integratedMultimodalDescription` | string | ✅ | 非空 | 画面/动作/对白；**正文用英文**，`[Shot 1]` 起，多镜头写 `[Shot 2] At 00:03.000, …`（严格递增且在时长内）；对白包 `<d>[Chinese]…</d>` |
| `prompt.overallSoundscape` | string | ✅ | 可 `N/A` | 环境声与动作声 |
| `prompt.nonDiegeticMusic` | string | ✅ | 可 `N/A` | 配乐 |
| `referenceIds` | string[] | ✅ | **图 ≤4**；顺序即 `{{ref N}}` | 资产卡编号，须存在于 `assetIndex.json` 且资产已出图（V13） |
| `continuity` | enum | ✅ | `start`/`continue`/`cut` | **首段必须 `start`** |
| `status` | enum | ✅ | `pending`/`generating`/`generated`/`accepted`/`failed` | 状态机见 §三 |
| `nodeId` | string\|null | ✅ | 生成后必有 | 视频节点 ID；`generated`/`accepted` 时不得为 `null`（V13） |
| `assetPath` | string\|null | ✅ | 工作区相对路径 | 产出视频；必须**真实可读**，否则该镜只能记 `failed` |
| `attempts` | object[] | ✅ | 追加写，`{ at, nodeId, status, error? }` | 每次尝试留痕，重生成不覆盖历史 |
| `notes` | string | 否 | — | 自由备注 |

> 字段名一律小驼峰（AGENTS.md）；`clips[]` 内允许的键以上表为限，不自行新增字段——新增字段会让旧版工具与编辑器直接校验失败。

---

## 三、状态机

```text
pending ──提交生成──> generating ──成功──> generated ──用户验收──> accepted
   ↑                        │                                        │
   └──────失败可重试─────────┴──失败──> failed ──重试──> generating     └─改需求──> pending
```

| 状态 | 谁写入 | 含义 | 下一步 |
|---|---|---|---|
| `pending` | 编辑器 / Agent（经 `planOperator mtrackUpdate`）/ `build` | 待生成；参数已定稿 | 校验通过 → 提交生成 |
| `generating` | 发起派工的一方：界面按钮或 `node:dispatchGenerate` → 编辑器；会话内逐镜 → Agent 经 `mtrackUpdate` | 已提交，供应商侧在跑 | 追终态 → `generated` / `failed` |
| `generated` | 同上（须先读到真实产出，见下方硬门槛） | 视频已落地，**不等于交付完成** | 用户验收 → `accepted`；打回则改提示词后回 `pending` |
| `accepted` | 人工作验收后写（单镜编辑器「验收」按钮，或用户明确确认后 Agent 经 `mtrackUpdate` 代写） | 唯一进入合成清单的状态 | M4 按顺序 concat（generationRunbook §15.6） |
| `failed` | 发起派工的一方写 | 含 `attempts[].error` | 修参数 → `pending` 重试 |

- **重生成**：把旧 `assetPath` 与旧 `status` 追加进 `attempts`，`status` 回 `pending`；同一 `clipId` **复用**自己的 `nodeId`，不新建节点（否则 `V13`/`V15` 会指向悬空引用）。
- **回写状态的硬门槛**（§4.6 纪律 3）：写 `generated` 前必须能读到真实产出文件；`assetPath` 指向不存在或不可读的文件时，只能写 `failed` + `error: "未找到产出"`。
- `accepted` 是唯一进入合成的状态；合成清单（`plan/composite.json`）只含 `accepted` 镜，且顺序连续、无空洞（V14）。

---

## 四、参考顺序 = `{{ref N}}` 编号协议

```text
referenceIds: ["C01", "C03", "C05", "SC02"]
               ↓        ↓        ↓       ↓
            {{ref 1}} {{ref 2}} {{ref 3}} {{ref 4}}
```

- `referenceIds` 的数组顺序即权威。Toonflow 侧的实际顺序由 `data.referenceOrder`（键为 `encodeURIComponent(JSON.stringify([source, sourceHandle]))`）+ 入边顺序决定，**必须逐一核对**，不能假定连线手势等于数组顺序（V15）。
- LSC 的 `<Picture N>` ↔ 本工程的 `{{ref N}}`；不要在正文里写 `Picture` 号。

### 段尾追加句（写入 `integratedMultimodalDescription` 末尾）

```text
本段参考顺序：{{ref 1}} = C01（淳于棼·人间游侠，用途：character）；{{ref 2}} = C03（淳于棼·驸马，用途：character）；{{ref 3}} = C05（罗云，用途：character）；{{ref 4}} = SC02（槐下饮酒·夜，用途：scene）。图片仅作参考，不自动作为精确首帧。
```

格式要求：

1. 一句写完，位于该片段提示词**最后一行**；
2. 每个参考一项，`{{ref N}} = <卡ID>（<名称>，用途：<kind>）`，`N` 从 1 起且与 `referenceIds` 下标一一对应；
3. 用途取值 `character` / `scene` / `prop` / `composition`，与 `assetIndex.json` 的 `kind` 一致；
4. 段尾固定收一句「图片仅作参考，不自动作为精确首帧。」——本仓库无 latent 续接，模型容易把第 1 张图当首帧。

### 素材排他规则

写了 `{{ref N}}` 的资产，**正文不得再详细描述其外貌/空间/形制**；只允许写「姿态、动作、镜头、光线、情绪、时间变化」。否则模型在「参考图」与「文字描述」之间左右摇摆，产出一张既不像参考、也不符描述的中间态。

| 可以写 | 禁止写 |
|---|---|
| `C01 抬碗欲饮，袖口垂落` | `C01 面容清瘦，剑眉星目，束发着青衫` |
| `沿用 SC02 的空间关系，人物自槐树下走入画面中央` | `SC02 中有一株巨大古槐，树冠遮天，地面落满槐花` |
| `P01 置于案上，被 C01 端起` | `P01 为白底青瓷枕，正交视角，无人手` |

需要换装、换状态时，改的是**参考卡的编号**（换 `C03` 而不是改文字），不是把新外貌写进正文。

---

## 五、编辑纪律（写者必须遵守）

| 项 | 规则 |
|---|---|
| **单一写者** | 同一时刻只有一个写者持有该文件：编辑器在编辑态写，工具只在 `build` 时写。两个编辑器同时打开同一工程视为非法 |
| **保存时机** | 字段失焦即 `files.writeJson` 落盘，并显示「已保存 · <时间>」；存在未保存改动时标题加 `*` |
| **`updatedAt` 冲突** | 每次保存前重新读一次磁盘上的 `updatedAt`，与本次编辑前读到的不一致 → 中止写入，提示「文件已被其他操作修改，请重新加载」，**不静默覆盖** |
| **快照提示** | 编辑器与生成界面固定展示：「生成任务按提交时的快照运行，此处修改只影响下次生成。」 |
| **空值与追加** | `nodeId`/`assetPath` 只在生成成功/失败时落值；`attempts` 只追加，不删除、不改写历史项 |
| **Agent 边界** | Agent 不直接写该文件（不手改 JSON）：改状态只走两条通道——界面按钮/`node:dispatchGenerate` 由编辑器写，会话内逐镜由 `planOperator mtrackUpdate` 写；不在多轨生成中改文件，改完必须重新提交该镜 |

---

## 六、与方案文档的一致性说明

- 本文件是 [docs/multitrackProductionPlan.md](../../../../docs/multitrackProductionPlan.md) §2 的**技能侧落地副本**：字段、枚举、范围、状态机、参考顺序协议、编辑纪律均以 §2（含 §2.1–§2.5、§3.4）为准，本文件不新增、不放宽任何语义。
- 计划文档后续若发生修订，**以计划文档为准**，本文件与 [SKILL.md](../SKILL.md) 同步更新；出现分歧时按计划文档执行并在下一次修订中改回一致。
- 生成调用序列、参数规则、模式判定铁律（`node:getConfig` 读 `matchingModes`，不写死「4 图」）与状态查询纪律见计划文档 §4.1–§4.6；M3 的逐分镜生成 SOP 引用同一节，不在技能里另立一套。

---

## 七、与校验器的对应关系

| 契约点 | `planOperator` 校验 |
|---|---|
| `clipId` 唯一、必填字段齐全、`status` 合法 | V11 |
| `seconds` 2–60 整数、`resolution` ∈ {768P, 2K}、`ratio` 合法 | V12 |
| `referenceIds` 存在于 `assetIndex.json` 且资产已出图；`generated`/`accepted` 的 `nodeId`/`assetPath` 必须存在 | V13 |
| 合成清单只含 `accepted` 镜，顺序连续无空洞 | V14 |
| `referenceIds` 顺序与画布实际 `referenceOrder` + 入边顺序逐一一致 | V15 |
| `{{ref N}}` 只出现在 `1..参考数` 且每个 N 至少出现一次 | V7 |
| 参考数超过节点实际匹配模式上限 | V8 / V10 |

`validate` 对工程文件**零写入**；只有 `build` 落盘派生文件。
