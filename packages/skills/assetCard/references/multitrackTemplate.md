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

> 片段带参考时，`integratedMultimodalDescription` 要按 §四 直接写官方六段（`subject_definitions:` → `summary:` → `retention_analysis:` → `detailed_description:`），正文用 `<Picture N>` 指位；上面骨架为求简短，只示意了画面正文段。

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
| `referenceIds` | string[] | ✅ | **图 ≤4**；顺序是画布引用位次（可混入 `kind: "sound"` 音频卡，决定官方标记的编号基数） | 资产卡编号，须存在于 `assetIndex.json` 且资产已出图（V13） |
| `continuity` | enum | ✅ | `start`/`continue`/`cut` | **首段必须 `start`** |
| `status` | enum | ✅ | `pending`/`generating`/`generated`/`accepted`/`failed` | 状态机见 §三 |
| `nodeId` | string\|null | ✅ | 生成后必有 | 视频节点 ID；`generated`/`accepted` 时不得为 `null`（V13） |
| `assetPath` | string\|null | ✅ | 工作区相对路径 | 产出视频；必须**真实可读**，否则该镜只能记 `failed` |
| `attempts` | object[] | ✅ | 追加写，`{ at, nodeId, status, error? }` | 每次尝试留痕，重生成不覆盖历史；其中 `status === "succeeded"` 的 `nodeId` 去重后即该镜的**视频版本列表**（旧→新，见 §三 重生成口径） |
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
| `accepted` | **只能由用户**在多轨界面单镜编辑器点「验收」写入（`clipEditor.vue:13`）；Agent 的 `mtrackUpdate` / `node:editProject` 写入枚举都不含它，代写会被校验拒绝 | 唯一进入合成清单的状态 | M4 按顺序 concat（generationRunbook §15.6） |
| `failed` | 发起派工的一方写 | 含 `attempts[].error` | 修参数 → `pending` 重试 |

- **重生成 = 追加版本，不覆盖旧产物**：编辑器直连链路（`directDispatch.ts` 的 `ensureNode`）对**已产出视频**的节点不再复用，改新建同 label 视频节点，旧节点与旧视频留在画布；`clip.nodeId`/`assetPath` 指向新版本，即新版本成为该镜默认。版本列表 = `attempts` 里 `status === "succeeded"` 的 `nodeId` 去重（旧→新，`mtrackProject.ts` 的 `clipVersionNodes`）。切回旧版本只改 `clip.nodeId`/`assetPath`（编辑器「设为默认」或 agent `node:editProject` 的 `patch`），**不改 `status`、不追加 `attempts`**——切换不是一次生成尝试；`accepted` 状态不受影响，合成仍按 `assetPath` 取当前默认版本（generationRunbook §15.9）。**注意**：generationRunbook §一 步 1.5 的 agent 逐镜编排（`planOperator dispatch` → `mtrackUpdate`）仍复用自己的 `nodeId`，那条路径不产生新版本。
- **回写状态的硬门槛**（§4.6 纪律 3）：写 `generated` 前必须能读到真实产出文件；`assetPath` 指向不存在或不可读的文件时，只能写 `failed` + `error: "未找到产出"`。
- `accepted` 是唯一进入合成的状态；合成清单（`plan/composite.json`）只含 `accepted` 镜，且顺序连续、无空洞（V14）。

---

## 四、参考标记：写作者直接写官方六段 + `<Picture N>`

`referenceIds` 的数组顺序即权威。Toonflow 侧的实际顺序由 `data.referenceOrder`（键为 `encodeURIComponent(JSON.stringify([source, sourceHandle]))`）+ 入边顺序决定，**必须逐一核对**，不能假定连线手势等于数组顺序（V15）。

**编号规则**：官方标记按**参考类型各自编号**——`<Picture 1>`、`<Picture 2>`… 只数**图片类**参考，`<Audio 1>` 从音频自己的第 1 个起算，`<Video 1>` 同理，三类互不共用序号。`referenceIds` 的位次是**画布引用位次**，不是 Picture 序号（它可能混入 `kind: "sound"` 的音频卡，V8 把图片 ≤4 与音频分开计）。下面这个例子是「参考全是图片」的简单情形，此时位次恰好等于 Picture 序号：

```text
referenceIds: ["C01", "C03", "C05", "SC02"]   ← 全是图片
                ↓        ↓        ↓        ↓
          <Picture 1> <Picture 2> <Picture 3> <Picture 4>
```

**位次 ≠ Picture 序号**：音频卡（`kind: "sound"`）会占 `referenceIds` 的一个位次，所以混排时必须按类型重新数，**绝不能**拿位次当 Picture 号——那会把图片参考的编号整体错位、把音频当成图片：

```text
referenceIds: ["C01", "A01", "C03"]（A01 是 kind: "sound" 的音频卡）
画布引用位次：    1        2        3
正确写法：  <Picture 1> <Audio 1> <Picture 2>
错误写法：把 A01 写成 <Picture 2>（C03 的图被当成音频，位次整体错一位）
```

视频参考同理只数视频（`<Video 1>`）。**「位次 = Picture 序号」只在参考全是图片时成立**，是特例不是通例。

V7 只查越界：三类标记的编号落在**该类型参考的数量范围**内——画面上限 = 非 sound 卡数、音频上限 = sound 卡数、视频或参考卡缺 `kind` 时上限 = 参考总数。**不查重号**（同一编号在正文里反复复述属正常写法），也**不要求**每个编号都出现——某张参考本镜用不上，正文里可以完全不出它的标记，但它仍要留在 `referenceIds` 里才会送进引擎。

### 六段由写作者直接写，引擎不再代写

官方 ref2va 六段里，前四段写进 `clips[].prompt.integratedMultimodalDescription`（段首标签自己写，段间空一行），后两段分别写进 `overallSoundscape` / `nonDiegeticMusic`：

| 段 | 段首标签 | 写进哪个字段 | 写什么 |
|---|---|---|---|
| 资产定义段 | `subject_definitions:` | `integratedMultimodalDescription` | 每个参考资产一行 `<Subject N> = <卡ID>（<名称>，用途：<kind>）`，并写出该资产的外貌 / 空间结构 / 形制特征 |
| 摘要段 | `summary:` | 同上 | 一两句总述本镜画面与动作 |
| 参考保持分析段 | `retention_analysis:` | 同上 | 逐条写 `<Subject N>` 保留了哪些特征，用官方关系标记 `fully_preserved` / `partially_preserved` |
| 画面正文段 | `detailed_description:` | 同上 | `[Shot 1]` 起的分镜动作与环境；被引用资产首次出现处写「被引用特征 + 画面位置 + 当前动作」，用 `<Picture N>` 指位 |
| 环境声段 | `overall_soundscape:` | `overallSoundscape` | 环境声与动作声 |
| 配乐段 | `non_diegetic_music:` | `nonDiegeticMusic` | 配乐 |

**硬要求：有参考的片段，`integratedMultimodalDescription` 的第一行必须是 `subject_definitions:`**（段首标签，不能只按顺序罗列六段内容）。漏写段首时 `buildPrompt`（`packages/nodeShared/src/mtrack/directDispatch.ts:106`）会兜底补一个 `detailed_description: `（有参考）/ `integrated_multimodal_description: `（无参考），等于把整段当成画面正文——`summary` 与 `retention_analysis` 直接缺失，六段结构不完整。

可直接照抄的完整示例（沿用 §一 骨架的 S001；正文按 §〇 口径用英文，资产名可写中文卡名）：

```jsonc
"prompt": {
  "integratedMultimodalDescription": "subject_definitions:\n<Subject 1> = C01（淳于棼·人间游侠，用途：character），青灰短褐、腰间旧玉佩、束发木簪。\n<Subject 2> = C03（淳于棼·驸马，用途：character），驸马红袍、金冠、腰悬玉带。\n<Subject 3> = C05（罗云，用途：character），藕荷色襦裙、右眉浅疤、垂鬟。\n<Subject 4> = SC02（槐下饮酒·夜，用途：scene），老槐树、石桌石凳、树下灯笼。\n\nsummary:\n槐树下夜饮：C01 举碗饮尽，C05 斟酒，镜头由中景推到碗的特写。\n\nretention_analysis:\n<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - 青灰短褐、旧玉佩、束发木簪，与 <Picture 1> 一致。\n<Subject 3> (appears in [Shot 2]): fully_preserved - 藕荷色襦裙、右眉浅疤，与 <Picture 3> 一致。\n<Subject 4> (appears in [Shot 1], [Shot 2]): partially_preserved - 保留老槐树形态与石桌位置，夜色与灯笼暖光按本镜重打。\n\ndetailed_description:\n[Shot 1] Live-action, cinematic, dusk light under the old locust tree south of the Guangling mansion. C01 (Picture 1), a lean man in a grey short jacket with an old jade pendant, stands by the stone table and drains the ceramic bowl; C05 (Picture 3) leans in to refill it. The old locust tree and stone table from SC02 (Picture 4) frame them in the foreground shadow. [Shot 2] At 00:04.500, the camera cuts to a close shot of the bowl tilting, a drop of wine running down its rim.",
  "overallSoundscape": "Cicadas, wind through locust leaves, the clink of the ceramic bowl, wine pouring.",
  "nonDiegeticMusic": "A low guzheng and xiao motif, sparse."
}
```

下发到引擎时，`buildPrompt`（`packages/nodeShared/src/mtrack/directDispatch.ts:97-114`）看到正文已自带官方段首就**不再套字段名**（`:95` 的 `officialSection` 匹配即跳过补全），正文原样进 wire（**旧标记也不改写**），段间空一行：

```text
subject_definitions:
<Subject 1> = C01（…）

summary:
…

retention_analysis:
…

detailed_description:
[Shot 1] …

overall_soundscape: Cicadas, wind through locust leaves, …

non_diegetic_music: A low guzheng and xiao motif, sparse.
```

上面是**节点 wire 层（freevideo）最终发给引擎的文本**。`buildPrompt` 的输出里旧标记仍是原样：正文残留的 `{{ref N}}` 不会被引擎层改写，要等 `packages/nodes/videoGenerationNode/src/index.vue:225-238` 的 `generationPrompt` 用 `referenceTags(refList)` 按 `dataType` 逐位替换成 `<Picture N>` / `<Video N>` / `<Audio N>`（仅 freevideo 生效；未规范书写的 `{{Picture N}}` 双花括号形式也在这一层兜底）。所以新稿直接写官方标记最稳，旧工程带 `{{ref N}}` 的片段靠这一层兜底，引擎层不做换算。

工程设了 `global.style` / `global.systemPrompt` 时，引擎会把「全片风格：…」「全片约束：…」这两行拼在整段正文最前面（`packages/nodeShared/src/mtrack/directDispatch.ts:101-105`），它们不属于官方六段；要求 wire 提示词严格以 `subject_definitions:` 开头的场合，把这两个工程字段留空。

- 没有参考的片段只写画面正文段（其余五段不出现），下发时仍是 `integrated_multimodal_description: <正文>`。
- 旧工程兼容：旧方案正文里写的 `{{ref N}}` 用**画布引用位次**（图片、音频、视频、文本混排后的位次），与官方「按类型各自编号」的基数不同。引擎层（`packages/nodeShared/src/mtrack/directDispatch.ts:97-114`）**不改写**它、原样透传，到节点 wire 层才由 `packages/nodes/videoGenerationNode/src/index.vue:212-224` 的 `referenceTags` 按 `dataType` 逐项换算成正确的官方编号。旧标记只作为兼容入口存在，新稿一律直接写官方标记，也不要教人把官方编号换算回旧标记。
- 不要记「官方 `<Picture N>` 等于旧标记的 N」——两者编号基数不同，等号会让写作者把音频编号错写成图片编号。
- 新工程一律直接写 `<Picture N>`，不再使用旧标记；画布 mention chip 插进 promptInput 的 `{{ref N}}` 属同一套旧格式兼容入口，wire 层同样换算成 `<Picture N>`，所以画布链路不需要任何改动。
- 用途取值 `character` / `scene` / `prop` / `composition`，与 `assetIndex.json` 的 `kind` 一致。
- 每改一次 `referenceIds` 或连线，都要重新核对正文里的 `<Picture N>` 位次并重新 `setPrompt`（R9：编号漂移）。

### 参考形貌规则

挂了参考的资产，**正文仍要写清它的形貌**——这是 MiniMax H3 官方 full-reference（ref2va）规范的硬要求，不是可选项：

- `subject_definitions` 里定义 `<Subject N>` 时要列出该资产的特征（外貌 / 空间结构 / 形制）。
- `retention_analysis` 里用官方关系标记写清保留了哪些特征（见 [生成工作手册](generationRunbook.md) §十一）。
- `detailed_description` 里该资产首次出现时，要同时写「被引用的特征 + 画面位置 + 当前动作」，环境与光照照常写；`[Shot 1]` 前允许用一两句英文定下风格。
- 担心模型把第 1 张图当精确首帧时，可在 `detailed_description` 末尾自己补一句「图片仅作参考，不自动作为精确首帧。」——本仓库无 latent 续接，这是可选句子，引擎不再自动追加。

"因为挂了参考图所以正文不能描述"是错的：官方 `ref-en.txt` §0 明确要求 detailed_description 尽可能详细，§5.3 要求在参考主体首次出现时描述其被引用特征；官方完整示例里同一处咖啡店砖墙、沙发、霓虹灯在 `subject_definitions`、`retention_analysis`、`detailed_description` 三处都写了一遍。正文只留一句 `<Picture 1>` 而不写特征，模型就只能靠一张图去猜，这才是画面跑偏的常见原因。

需要换装、换状态时，改的是**参考卡的编号**（换 `C03`），不是把参考图里没有的新外貌写成另一套；描述要与参考图一致。

---

## 五、编辑纪律（写者必须遵守）

| 项 | 规则 |
|---|---|
| **单一写者** | 同一时刻只有一个写者持有该文件：编辑器在编辑态写，工具只在 `build` 时写。两个编辑器同时打开同一工程视为非法 |
| **保存时机** | 字段失焦即 `files.writeJson` 落盘，并显示「已保存 · <时间>」；存在未保存改动时标题加 `*` |
| **`updatedAt` 冲突** | 每次保存前重新读一次磁盘上的 `updatedAt`，与本次编辑前读到的不一致 → 中止写入，提示「文件已被其他操作修改，请重新加载」，**不静默覆盖** |
| **快照提示** | 编辑器与生成界面固定展示：「生成任务按提交时的快照运行，此处修改只影响下次生成。」 |
| **空值与追加** | `nodeId`/`assetPath` 在生成成功/失败时落值；**唯一例外是切换默认版本**：编辑器把 `nodeId`/`assetPath` 指向某个历史 `succeeded` 版本（不改 `status`、不追加 `attempts`）；`attempts` 只追加，不删除、不改写历史项 |
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
| 官方标记 `<Picture N>`/`<Video N>`/`<Audio N>` 的编号**只查越界**（上限按类型计数：画面 = 非 sound 卡数、音频 = sound 卡数、视频或参考卡缺 `kind` = 参考总数），**不查重号**、缺席某个编号不报错；旧工程遗留的 `{{ref N}}` 只报迁移 warning | V7 |
| 参考数超过节点实际匹配模式上限 | V8 / V10 |

`validate` 对工程文件**零写入**；只有 `build` 落盘派生文件。
