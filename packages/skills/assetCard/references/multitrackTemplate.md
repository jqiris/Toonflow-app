# 多轨工程模板（`plan/story.mtrack`，JSON 内容，自定义扩展名 mtrack）

> 权威依据：[docs/multitrackProductionPlan.md](../../../../docs/multitrackProductionPlan.md) §2（全量契约）、§2.5（参考顺序协议）、§3.4（保存与冲突）、§4.1/§4.6（生成调用序列与状态查询纪律）、§5（V11–V16）、§9（与 `segmentMap.json` 的关系）。
> 资产侧编号与接线规则见 [参考接线解析规则](referenceResolution.md)；卡片写法见 [资产卡模板](assetCardTemplate.md)。
> 本文件只描述**契约与写作文本纪律**，不描述编辑器实现（编辑器内核属于 `packages/nodeShared/src/mtrack/`，画布节点在 `packages/nodes/multitrackNode`）。

---

## 〇、定位与边界

- `plan/story.mtrack` 是**唯一真源**：分镜、参数、参考顺序、生成状态只在这里。画布节点是执行载体，画布 JSON 不存业务语义。该文件为 JSON 内容、自定义 `.mtrack` 扩展名（宿主按 `split(".").at(-1)` 关联，`.mtrack.json` 会被识别为 json 撞关联）。
- 它**取代** [旧方案](../../../../docs/assetCardWorkflowPlan.md) 的 `plan/segmentMap.json`（片段 → 节点映射）：`clips[].nodeId` 就是映射，不再维护第二份文件。
- 写者只有两条通道：①多轨编辑器内核（`packages/nodeShared/src/mtrack/`，文档面板扩展与画布多轨节点共用同一实现）——界面「生成选中段」「批量生成…」与 `node:dispatchGenerate` 都是直连生成（走服务端媒体任务通道：`mediaDispatch.ts` 的 `composeClipRequest` + `mediaTask.ts` 的 `submitClipTask`/`waitClipTask`，不建画布节点），`status`/`nodeId`/`assetPath`/`attempts` 由编辑器写；②`planOperator`——`build` 写工程初稿，`mtrackUpdate` 在 Agent 按生成 SOP 逐镜编排（会话内路径）时写状态。**Agent 不手改该文件**（不直接写 JSON、不调 `files.writeJson`）；两条通道同经 `updatedAt` CAS 对账，谁先落盘谁更新。人工手改视为草案，下次校验会被指出。
- 路径一律工作区相对、`/` 分隔；写入走 `context.files`（工具）或 `ExtFiles`（扩展），不直接调 `node:fs` / `Bun.write`。

---

## 一、文件骨架

```jsonc
{
  "version": 1,
  "projectId": "nanKe",
  "name": "南柯记·第一集",
  "updatedAt": "2026-10-19T10:00:00+08:00",
  "global": {
    "ratio": "9:16",
    "style": "写实电影质感，自然光，胶片颗粒",
    "systemPrompt": "…（可选：全片规则留底；资产出图时由导入节点逐张并入卡提示词，视频派工不注入，写稿时须逐镜写进六段本体）",
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
        "subjectDefinitions": "subject_definitions:\n<Subject 1> is the young man in <Picture 1> wearing a grey short jacket with a jade pendant.",
        "summary": "summary:\n[reference generation] A two-shot dusk drinking scene under an old locust tree, camera push-in to the bowl at 00:04.500.",
        "retentionAnalysis": "retention_analysis:\n<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - grey short jacket and jade pendant match <Picture 1>.",
        "detailedDescription": "detailed_description:\n[Shot 1] Live-action, cinematic, dusk light under the old locust tree south of the Guangling mansion. <Subject 1> from <Picture 1> raises the ceramic bowl and drinks. [Shot 2] At 00:04.500, the camera cuts to a close shot of the bowl tilting.",
        "overallSoundscape": "Cicadas, wind through locust leaves, the clink of the ceramic bowl.",
        "nonDiegeticMusic": "A low guzheng and xiao motif, sparse."
      },
      "referenceIds": ["C01", "C03", "C05", "SC02"],
  "continuity": "shot",
      "status": "pending",
      "nodeId": null,
      "assetPath": null,
      "attempts": [],
      "notes": ""
    }
  ]
}
```

> 片段带参考时，六段字段的正文都按 §四 直接写官方六段结构（段首标签 + 段内正文，段间空一行）：`subjectDefinitions`（subject_definitions）、`summary`、`retentionAnalysis`、`detailedDescription`（detailed_description）、`overallSoundscape`、`nonDiegeticMusic`；正文里指位一律用官方 `<Picture N>` / `<Video N>` / `<Audio N>`，N = `referenceIds` 中同类型参考的位次（图片、视频、音频各自独立从 1 起编号）。上面骨架为求简短，只示意了画面正文段。

---

## 二、字段表

### 2.1 根字段

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `version` | number | ✅ | 当前为 `1` | 契约版本，升级时整体迁移，不原地改写 |
| `projectId` | string | ✅ | 非空 | 项目标识，用于跨文件对账（编辑器/建工程处写 `mtrack-<时间戳>`）。**不是显示名**，界面「项目名称」编辑的是 `name` |
| `name` | string | 否 | — | 项目显示名（工作台与「项目与成片」浮窗头部）；additive 可选字段，缺失即留空，不参与生成与合成 |
| `updatedAt` | string | ✅ | ISO 8601 带时区 | **写者每次保存必须刷新**，冲突判定见 §五 |
| `global` | object | ✅ | 见下 | 全片默认值，`clips[]` 同名项覆盖它 |
| `global.ratio` | string | ✅ | `9:16`/`16:9`/`1:1`/`4:3`/`3:4` | 默认画幅 |
| `global.style` | string | ✅ | 非空 | 风格统一词：资产出图时由导入节点逐张前拼进卡提示词；视频派工不注入（见 §四），母版留底 |
| `global.systemPrompt` | string | 否 | — | 全片规则段：资产出图时由导入节点逐张并入「全片约束：」句；视频派工**不注入**（buildPromptText 只拼 clip.prompt 六段、composeClipRequest 不消费 global），写稿时须逐镜把约束写进六段本体 |
| `global.model` | object | ✅ | `{ providerId, modelId }` | 本工程目标模型；默认 `{ "freevideo", "MiniMax-H3" }` |
| `clips` | array | ✅ | ≥1，`clipId` 唯一 | 片段数组，**顺序 = 合成顺序** |

### 2.2 `clips[]` 字段

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `clipId` | string | ✅ | `^S\d{3}$`，全文件唯一 | 片段 ID |
| `title` | string | ✅ | 1–120 字符 | 显示名 |
| `sourceRange` | object | 否 | `{ fromSegment, toSegment }` | 溯源到剧本/分镜稿的段号，便于回改 |
| `seconds` | number | ✅ | **整数 2–60** | 提交整数秒；实际成片落在引擎 `17n+5` 网格（6s→6.583s，10s→10.125s），≥30s 自动分块时参考图实限 3 张 |
| `ratio` | string | ✅ | 五档枚举 | 与 `global.ratio` 不同则覆盖；**缺省不跟随 `global.ratio`，会静默落 `9:16`**（`mtrackProject.ts:262`），手写 JSON 必须每镜写全 |
| `resolution` | string | ✅ | `768P`/`2K` | 来自 `durationResolutionMap`（V12） |
| `generateAudio` | boolean | ✅ | — | H3 `audio: "optional"` 的开关 |
| `prompt.subjectDefinitions` | string | 有参考时 ✅；无参考可空 | 段首标签 `subject_definitions:` 由本字段首行书写 | 六段之一：定义每个 `<Subject N>` 及其 `<Picture N>` / `<Video N>` / `<Audio N>` 来源与主要特征（详见 §四）；**正文用英文** |
| `prompt.summary` | string | 有参考时 ✅；无参考可空 | 段首标签 `summary:` 由本字段首行书写 | 六段之一：一句话总述任务类型（`[reference generation]` / `[keyframe completion]` / `[video continuation]` 等）与主要参考关系 |
| `prompt.retentionAnalysis` | string | 有参考时 ✅；无参考可空 | 段首标签 `retention_analysis:` 由本字段首行书写 | 六段之一：逐条写 `<Subject N>` / `<Picture N>` 等的关系标记，可见内容用 `fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`，音频用 `fully_copy` / `partially_copy` / `reference` / `weak_reference` |
| `prompt.detailedDescription` | string | ✅ | 非空 | 六段之一；段首标签 `detailed_description:` 由本字段首行书写；正文用英文，`[Shot 1]` 起、多镜头写 `[Shot 2] At 00:03.000, …`（严格递增且在时长内）；对白包 `<d>[Chinese]…</d>`；参考标记用官方 `<Picture N>` / `<Video N>` / `<Audio N>` |
| `prompt.overallSoundscape` | string | ✅ | 可 `N/A`；**留空则不下发该段** | 六段之一；段首标签 `overall_soundscape:` 由本字段首行书写；环境声与动作声 |
| `prompt.nonDiegeticMusic` | string | ✅ | 可 `N/A`；**留空则不下发该段** | 六段之一；段首标签 `non_diegetic_music:` 由本字段首行书写；配乐 |
| `referenceIds` | string[] | ✅ | **图片 ≤9**（校验器 V8 的 `MAX_IMAGE_REFERENCES = 9`）、**音频 ≤1**（同属 V8 的 `MAX_AUDIO_REFERENCES = 1`）；**视频参考并入图片桶一起计数，V8 不校验视频**（卡体系没有 `video` 这个 `kind`，「视频 ≤1」只是供应商声明）；**多轨界面勾选上限只有 4**（`referencePicker.vue` 的 `toggle` 硬编码，4 来自供应商声明的 `imageReference:4`）——超 4 张是被界面挡下的，不是校验器挡下的；顺序是画布引用位次；官方参考标记 `<Picture N>` / `<Video N>` / `<Audio N>` 的 `N` 按 `referenceIds` 中同类型（IMAGE / VIDEO / AUDIO）位次独立从 1 起编号（详见 §四） | 资产卡编号，须存在于 `assetIndex.json` 且资产已出图（V13） |
| `mode` | enum | 否 | `ref` / `image` / `text` | 任务模式：`ref` 多图参考、`image` 单图首帧、`text` 纯文。**缺省只能推断出 `text`（无 `referenceIds`）或 `ref`（有参考）；`image` 推断不出来，要单图首帧必须显式写**（`resolveClipMode`，`mtrackProject.ts:47-51`） |
| `continuity` | enum | ✅ | `shot`（独立起拍/切镜）/ `context`（承接上一镜） | **首段必须 `shot`**；`context` 时参考素材合计 ≤3（图片/视频/音频同口径，V16 按 `referenceIds` 总数判）、时长 ≥10 秒；**默认 `context`**，例外与判据见 §2.3 |
| `status` | enum | ✅ | `pending`/`generating`/`generated`/`accepted`/`failed` | 状态机见 §三 |
| `nodeId` | string\|null | ✅ | — | 视频节点 ID；**媒体任务通道的镜恒为 `null`**（该通道不建画布节点，`generated`/`accepted` 也不要求它，V13 对这类镜有例外），旧工程的画布节点版次才有值 |
| `assetPath` | string\|null | ✅ | 工作区相对路径 | 产出视频；必须**真实可读**，否则该镜只能记 `failed`。也是**历史版本的身份**（见 §三）；`generated`/`accepted` 时不得为 `null`（V13） |
| `attempts` | object[] | ✅ | 追加写，9 字段 `{ at, nodeId, status, error?, jobId?, assetPath?, signature?, index?, parentJobId? }` | 每次尝试留痕，重生成不覆盖历史；`jobId` 供续接，`assetPath` 是本次尝试的产物路径；`signature` / `index` / `parentJobId` 只在**成功**那一条写，记录落盘那一刻的参数签名、时间线位置与续接来源（父镜 `continuationJobId`），供编辑器的待更新判定比对（generationRunbook §15.9·5）。其中 `status === "succeeded"` 的记录按**产物路径**去重（旧记录回退用 `nodeId`）即该镜的**视频版本列表**（旧→新，见 §三 重生成口径） |
| `notes` | string | 否 | — | 自由备注，**不参与提示词下发**（agent 可写，界面只作备注读；当系统提示词读会有提示词注入隐患） |
| `systemPromptOverride` | string | 否 | — | 本镜系统提示词**预留写入口**：当前派工链路不消费（视频下发不含 `global.systemPrompt` 与本字段），保留是写入口/留底；additive 可选字段 |

> 字段名一律小驼峰（AGENTS.md）；`clips[]` 内允许的键以上表为限，不自行新增字段——新增字段会让旧版工具与编辑器直接校验失败。

### 2.3 `continuity` 取值判据：能承接就承接

`shot` / `context` 只有两个取值。**默认是承接**：同一段落、同一空间，画面或动作要接上一镜，就写 `context`；只有下表这几种确实不该承接的情况才写 `shot`，并在标题或提示词里写清为什么不能承接：

| 情况 | 用什么 | 判据 |
| --- | --- | --- |
| **默认：同段落、同空间，画面/动作接上一镜** | `context` | 上一镜已成功且 `attempts` 里有 `jobId`；本镜 ≥10 秒、参考合计 ≤3 |
| **换场**：换到另一个空间 | `shot` | 环境不连续，硬接会把上一镜的空间带进来 |
| **时间跳转**：明确的跨日、闪回、跳过一段时间 | `shot` | 上一镜末帧不是本镜起点 |
| **需要重新构图 / 独立起拍**：新段落第一镜、要重新交代空间与机位 | `shot` | 承接会把上一镜的机位与运动带进来，等于重新交代失败 |
| **本镜 `seconds` < 10 秒，或参考合计 > 3** | 改 `seconds` 到 ≥10 秒并减参考后承接，否则 `shot` | 引擎硬限制：续接段每条 ≥10 秒、参考素材合计 ≤3（图片/视频/音频同口径），做不到就不要承诺承接 |
| **首镜** | `shot` | 没有上一镜可承接，V11 直接拒绝 |

- **多数镜头应当承接**：同一个空间里连续的动作、对话、反应镜头默认都是 `context`；一整片几乎全是 `shot` 通常是判错了。
- 承接不是凑数：换场、时间跳转、重新起拍这几类强行 `context`，会把上一镜的机位与运动一起带进来，构图与场景建立白做。
- `context` 拿不到上一镜可用的 `jobId` 时**直接报错，不静默降级成独立镜头**：要么先生成上一镜，要么显式改成 `shot`。
- **批量派工是串行的**：`node:dispatchGenerate` 对目标镜按 `clips` 顺序逐个执行（上一镜出结果才开始下一镜），不是并发下发。所以同一批次里可以混用两态——轮到某镜时上一镜已落盘、`attempts` 里的 `jobId` 已经能读到；不要为了「批量就不能续接」把承接镜改成 `shot`，也不要为了续接把独立镜改成 `context`。上一镜失败时下一镜的 `context` 会报「上一镜没有可用的生成任务号」并跳过（串行必然结果），修好上一镜后用 `node:resumeBatch` 续跑该镜（沿用同一 `batchId`）。

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
| `accepted` | **只能由用户**在多轨界面单镜编辑器点「验收」写入（`packages/nodeShared/src/mtrack/components/shotEditorPane.vue:13-21`）；Agent 的 `mtrackUpdate` / `node:editProject` 写入枚举都不含它，代写会被校验拒绝 | 唯一进入合成清单的状态 | M4 按顺序 concat（generationRunbook §15.6） |
| `failed` | 发起派工的一方写 | 含 `attempts[].error` | 修参数 → `pending` 重试 |

- **重生成 = 追加版本，不覆盖旧产物**：每次成功生成都落一个新的产物文件（`assets/<clipId>/` 下带随机后缀），旧文件不覆盖；`clip.assetPath` 指向新版本，即新版本成为该镜默认，这条 `succeeded` 的 attempt 也带同样的 `assetPath`。版本列表 = `attempts` 里 `versionKeyOf` 非空的条目（有产物路径的条目，或 `succeeded` 且有 `nodeId` 的旧画布条目）按**产物路径**去重（`key = attempt.assetPath || attempt.nodeId`，旧记录回退用 nodeId，旧→新，末尾补 `clip.assetPath`；`versionKeyOf` 是列表与删除共用的唯一谓词），即 `mtrackProject.ts` 的 `clipVersions(clip)` 返回的 `ClipVersion[]`——对齐 LSC 的 `resultVersions`（按 `file.url` 去重），**不再依赖画布 nodeId**，所以服务端媒体任务通道（不建画布节点、`nodeId` 恒为 `null`）的成片**同样出现在历史版本里**；这类条目的产物直接按路径读，只有旧工程没有 `assetPath` 的条目才经画布桥反查节点产物。切回旧版本只改 `clip.nodeId`/`assetPath`（编辑器「设为默认」或 agent `node:editProject` 的 `patch`），**不改 `status`、不追加 `attempts`**——切换不是一次生成尝试；`accepted` 状态不受影响，合成仍按 `assetPath` 取当前默认版本（generationRunbook §15.9）。**注意**：generationRunbook §一 步 1.5 的 agent 逐镜编排（`planOperator dispatch` → `mtrackUpdate`）复用已有的 `nodeId`，那条路径不新增版本。
- **版本可删除、可判待更新**：多轨编辑器提供单版本删除与整镜全部删除（`mtrackProject.ts` 的 `deleteClipVersion(clip, key)` / `deleteAllClipVersions(clip)`，按与列表同一个 `versionKeyOf` 谓词删掉对应条目、只留没有产物的诊断记录，并按 `EditorFiles.remove?` 删物理文件），删除后当前默认回落到剩余版本里最新的一条；生成中的镜禁止删除。版本新鲜度由 `clipStates(project)` 派生 `stale`（参数签名 / 时间线位置 / 续接来源三条件，对齐 LSC 的 `signatures()` / `public()`）；`stale` 是派生值，**不落盘、不进本文件字段表**，agent 侧不做删除版本（`node:editProject` / `mtrackUpdate` 没有删除版本操作）。明细见 generationRunbook §15.9·5 与 §15.9·6。
- **回写状态的硬门槛**（§4.6 纪律 3）：写 `generated` 前必须能读到真实产出文件；`assetPath` 指向不存在或不可读的文件时，只能写 `failed` + `error: "未找到产出"`。
- `accepted` 是唯一进入合成的状态；合成清单（`plan/composite.json`）只含 `accepted` 镜，且顺序连续、无空洞（V14）。

---

## 四、参考标记：作者直接写官方六段 + `<Picture N>`

`referenceIds` 的数组顺序即权威。Toonflow 侧的实际顺序由 `data.referenceOrder`（键为 `encodeURIComponent(JSON.stringify([source, sourceHandle]))`）+ 入边顺序决定，**必须逐一核对**，不能假定连线手势等于数组顺序（V15）。

**编号规则**：作者直接写官方参考标记 `<Picture N>` / `<Video N>` / `<Audio N>`；每个类型的 `N` 独立从 1 起编号，位次取自该类型资产在 `referenceIds` 数组中的先后（同类型去重后按出现顺序）。引擎下发时不再换算、不再替换，正文里的标记原样进入六段文本，最终由 `buildPrompt`（`packages/nodeShared/src/mtrack/mediaDispatch.ts`）拼装、由 `composeClipRequest` 校验越界与旧占位符：

```text
referenceIds: ["C01", "C03", "C05", "SC02"]   ← 全是图片卡
              ↓      ↓      ↓      ↓
        <Picture 1> <Picture 2> <Picture 3> <Picture 4>
```

混入视频 / 音频卡时，各类型编号互不干扰，同类型内部按位次连续编号：

```text
referenceIds: ["SC01(IMAGE)", "C01(IMAGE)", "V01(VIDEO)", "S01(AUDIO)"]
              ↓           ↓          ↓          ↓
         <Picture 1> <Picture 2> <Video 1> <Audio 1>
```

同一资产在多处引用时始终用同一个标记；同一类型的位次在正文里可以反复出现（不要求每种位次都出现，缺席该位次不报错，该资产仍留在 `referenceIds` 里才会送进引擎）。**V7 现行规则翻转**：官方尖括号标记视为合法正文，旧的「双花括号 ref 占位符」一律 error。

### 六段由作者直接写，引擎不再代写

官方 ref2va 六段一一对应 `clips[].prompt` 的六个驼峰字段；段首标签（`subject_definitions:` 等）由作者在本字段首行书写，段名本身不再由引擎代拼：

| 段 | 段首标签 | 写入字段 | 写什么 |
|---|---|---|---|
| 资产定义段 | `subject_definitions:` | `prompt.subjectDefinitions` | 每个参考资产一行 `<Subject N>`，写出该资产的外貌 / 空间结构 / 形制特征；若资产来自图片 / 视频 / 音频，在同一行的定义中显式引用 `<Picture N>` / `<Video N>` / `<Audio N>` 作为来源（官方规范 §2） |
| 摘要段 | `summary:` | `prompt.summary` | 一段英文，句首是方括号任务类型（`[reference generation]` / `[keyframe completion]` / `[video editing + audio reuse]` …），随后总结主体与主要参考关系 |
| 参考保持分析段 | `retention_analysis:` | `prompt.retentionAnalysis` | 每个 `<Subject N>` / `<Picture N>` 一行，用官方关系标记 `fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`（音频对应 `fully_copy` / `partially_copy` / `reference` / `weak_reference`） |
| 画面正文段 | `detailed_description:` | `prompt.detailedDescription` | `[Shot 1]` 起的分镜动作与环境；被引用资产首次出现处写「被引用特征 + 画面位置 + 当前动作」，用 `<Picture N>` / `<Video N>` / `<Audio N>` 指位；对白包 `<d>[语言]…</d>` |
| 环境声段 | `overall_soundscape:` | `prompt.overallSoundscape` | 环境声与动作声（含段名） |
| 配乐段 | `non_diegetic_music:` | `prompt.nonDiegeticMusic` | 配乐（含段名） |

**硬要求**：有参考的片段，`subjectDefinitions` 的第一行必须是 `subject_definitions:`（段首标签）；`summary` / `retentionAnalysis` / `detailedDescription` / `overallSoundscape` / `nonDiegeticMusic` 同理。留空该字段则该段整体不下发；六个字段全空等于无提示词，V11 拒绝。

可直接照抄的完整示例（沿用 §一 骨架的 S001；正文按 §〇 口径用英文，资产名可写中文卡名）：

```jsonc
"prompt": {
  "subjectDefinitions": "subject_definitions:\n<Subject 1> is the young man in <Picture 1>, wearing a grey short jacket with an old jade pendant at his waist and a wooden hairpin.",
  "summary": "summary:\n[reference generation] A two-shot dusk drinking scene under an old locust tree; <Subject 1> raises the bowl and the camera pushes in to a close shot of it.",
  "retentionAnalysis": "retention_analysis:\n<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - grey short jacket, jade pendant, and wooden hairpin all match <Picture 1>.",
  "detailedDescription": "detailed_description:\nThe scene is lit by dusk under an old locust tree south of the Guangling mansion, cinematic realism. [Shot 1] <Subject 1> (from <Picture 1>) stands at a stone table under the tree and lifts a ceramic bowl to his lips, drinking; another figure leans in to refill it. The tree canopy and the stone table from the same reference frame the foreground shadow. [Shot 2] At 00:04.500, the camera cuts to a close shot of the bowl tilting, a drop of wine running down its rim.",
  "overallSoundscape": "overall_soundscape:\nCicadas, wind through locust leaves, the clink of the ceramic bowl, wine pouring.",
  "nonDiegeticMusic": "non_diegetic_music:\nA low guzheng and xiao motif, sparse."
}
```

下发到引擎时，`buildPromptText`（`packages/nodeShared/src/mtrack/mediaDispatch.ts`）按六段顺序（`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`）把非空字段用空行分隔拼成一段；退化到无参考（三主段缺失）时只下发 `detailed_description` + `overall_soundscape` + `non_diegetic_music` 三段；有 `referenceIds` 时会额外注入首帧指令 `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`。最终 wire 文本示意：

```text
subject_definitions:
<Subject 1> is the young man in <Picture 1>, ...

summary:
[reference generation] A two-shot dusk drinking scene ...

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - ...

detailed_description:
The scene is lit by dusk ... [Shot 1] ... [Shot 2] At 00:04.500, ...

overall_soundscape:
Cicadas, wind through locust leaves, the clink of the ceramic bowl, wine pouring.

non_diegetic_music:
A low guzheng and xiao motif, sparse.
```

`global.style` / `global.systemPrompt` **不进视频提示词**：六段文本不含这两项，派工链路（`composeClipRequest` → `buildPromptText`）也不注入它们——这两项只在资产出图时由导入节点逐张拼进卡提示词。要求 wire 提示词严格以 `subject_definitions:` 开头（或退化时以 `detailed_description:` 开头）的场合不用担心它们占位，但风格词与全片硬约束的视频侧一致性由写稿人逐镜写进六段本体（见 `freevideoMultitrack` 技能阶段门 1–2 的写入义务），不会有任何机制替你补。

- 没有参考的片段只写画面正文段（`detailedDescription`），其余五段可留空；下发时是退化的三段（`detailed_description:` + `overall_soundscape:` + `non_diegetic_music:`）。
- 画布参考区把资产插进镜头时，mention chip 写入的也是官方 `<Picture N>` / `<Video N>` / `<Audio N>`（N 按类型位次），与手写同一套口径，画布链路不需要额外处理。
- `subject_definitions` 里的「用途」跟卡类别走：`character` / `scene` / `prop` / `sound`——`plan/assetIndex.json` 的 `kind` 只认这四个值（`packages/nodes/assetImportNode/src/assetImport.ts:15` 的 `AssetKind`）；`KF` 构图卡不进 `assetIndex`，用途可写 `composition`，但**它不是 `kind` 的取值**，写进索引会被当非法。
- 每改一次 `referenceIds` 或连线，都要重新核对正文里的 `<Picture N>` / `<Video N>` / `<Audio N>` 位次（按类型分组独立编号）并重新 `setPrompt`（R9：编号漂移）。

### 参考形貌规则

挂了参考的资产，**正文仍要写清它的形貌**——这是 MiniMax H3 官方 full-reference（ref2va）规范的硬要求，不是可选项：

- `subject_definitions` 里定义 `<Subject N>` 时要列出该资产的特征（外貌 / 空间结构 / 形制），并显式引用 `<Picture N>` / `<Video N>` / `<Audio N>` 作为来源（同一段的多个 Subject 可以共享同一个 Picture 来源）。
- `retention_analysis` 里用官方关系标记写清保留了哪些特征（见 [生成工作手册](generationRunbook.md) §十一）。
- `detailed_description` 里该资产首次出现时，要同时写「被引用的特征 + 画面位置 + 当前动作」，环境与光照照常写；`[Shot 1]` 前允许用一两句英文定下风格。
- 担心模型把第 1 张图当精确首帧时，可在 `detailed_description` 末尾自己补一句「图片仅作参考，不自动作为精确首帧。」——本仓库无 latent 续接，这是可选句子，引擎不再自动追加（但有 `referenceIds` 时 `buildPromptText` 会额外注入 `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.` 首帧指令，与这句可选句子不冲突）。

「因为挂了参考图所以正文不能描述」是错的：官方 `ref-en.txt` §0 明确要求 detailed_description 尽可能详细，§5.3 要求在参考主体首次出现时描述其被引用特征；官方完整示例里同一处咖啡店砖墙、沙发、霓虹灯在 `subject_definitions`、`retention_analysis`、`detailed_description` 三处都写了一遍。正文只留一个 `<Picture 1>` 而不写特征，模型就只能靠一张图去猜，这才是画面跑偏的常见原因。

需要换装、换状态时，改的是**参考卡的编号**（换 `C03`），不是把参考图里没有的新外貌写成另一套；描述要与参考图一致。

---

## 五、编辑纪律（写者必须遵守）

| 项 | 规则 |
|---|---|
| **单一写者** | 同一时刻只有一个写者持有该文件：编辑器在编辑态写，工具只在 `build` 时写。两个编辑器同时打开同一工程视为非法 |
| **保存时机** | 字段失焦即 `files.writeJson` 落盘，并显示「已保存 · <时间>」；存在未保存改动时标题加 `*` |
| **`updatedAt` 冲突** | 每次保存前重新读一次磁盘上的 `updatedAt`，与本次编辑前读到的不一致 → 中止写入，提示「文件已被其他操作修改，请重新加载」，**不静默覆盖** |
| **快照提示** | 编辑器与生成界面固定展示：「生成任务按提交时的快照运行，此处修改只影响下次生成。」 |
| **空值与追加** | `assetPath` 在生成成功/失败时落值，也是历史版本的身份；`nodeId` 只有画布节点通道的镜才有值，媒体任务通道恒为 `null`；**两个例外**：切换默认版本（编辑器把 `nodeId`/`assetPath` 指向某个历史 `succeeded` 版本，不改 `status`、不追加 `attempts`）与**删除版本**（编辑器 `deleteClipVersion` / `deleteAllClipVersions` 按 `versionKeyOf` 删掉对应条目并删物理文件，删默认版本后 `assetPath` 回落到剩余最新一条、删空则置 `null`）。除这两种情形外，`attempts` 只追加、不改写已有历史项——删除是**整条删除**，不就地改写 |
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
| 参考标记 `<Picture N>` / `<Video N>` / `<Audio N>` 按媒质（IMAGE/VIDEO/AUDIO）分组**各自独立查越界**（`N` 必须在 `1..同类型参考张数` 内）；正文出现「双花括号 ref 占位符」一律 error | V7 |
| 参考数超过节点实际匹配模式上限 | V8 / V10 |
| 续接镜（`context`）参考合计 ≤3、时长 ≥10 秒（引擎限制） | V16 |

`validate` 对工程文件**零写入**；只有 `build` 落盘派生文件。
