# H3 提示词对齐契约（MiniMax H3 官方格式 · 唯一权威口径）

> 本文件是全套（多轨编辑器 / 资产卡 / Agent 引导 / 技能文档 / 服务端）提示词格式的唯一权威口径。
> 本文件是**冻结的契约**，不是设计方案：所有实现与文档任务以本文件为准，与本文件冲突的旧记录一律作废。
> 无向后兼容。用户已明确「不要兼容老格式，以后所有视频生成都用 minimax-h3」。本工作流视频生成仅支持 MiniMax-H3（H3 官方六段格式 + `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记）；不接受其他视频模型或旧格式占位符。

- **权威依据**：`C:\workspace\film-maker\video-skills\MiniMax-H3\skills\h3-prompt-writing\references\ref-en.txt`（有参考 · 六段）与 `base-en.txt`（无参考退化 · 三段）。两份均为 MiniMax H3 官方指南原文。
- **冻结时间**：2026-10-26。
- **工作区**：`C:\workspace\super-ai\Toonflow-app.mtrack-official`（分支 `mtrack-official-prompt`）是唯一工作区。

---

## 1. 总则：两条不可变约束

[HISTORICAL] 1. **无向后兼容，无转换层**。严禁引入任何「双花括号 ref 占位符（`{{ref N}}`）→ `<Picture N>`」的自动转换层。旧占位符不再是合法输入，不解析、不换算、不降级提示；出现即报 error 并要求改写。
2. **参考标记由写作者直接书写**，形态为 `<Picture N>` / `<Video N>` / `<Audio N>`。这是最终下发给引擎的原文，不再由任何 wire 层生成。

## 2. ClipPrompt 六段字段（有参考 · 权威结构）

段名与顺序**逐字照抄** `ref-en.txt` §1「Overall Structure」的表格，顺序不得调整、不得增减、不得改名。

| # | 段名（逐字） | ref-en.txt 原文用途说明 |
|---|---|---|
| 1 | `subject_definitions` | Defines referenced content and its reference labels |
| 2 | `summary` | Summarizes the task type, target video, and main reference relationships |
| 3 | `retention_analysis` | Describes how referenced content is preserved, transferred, or reused |
| 4 | `detailed_description` | Describes visuals, actions, shots, sound, and dialogue in playback order |
| 5 | `overall_soundscape` | Summarizes ambience and physical sounds |
| 6 | `non_diegetic_music` | Describes background music audible only to the audience |

**段名逐字一致性核对（对照 ref-en.txt）**：

- ref-en.txt L17 `subject_definitions` ✅；L18 `summary` ✅；L19 `retention_analysis` ✅；L20 `detailed_description` ✅；L21 `overall_soundscape` ✅；L22 `non_diegetic_music` ✅。
- ref-en.txt L311–L338 的完整示例依次输出 `subject_definitions:` → `summary:` → `retention_analysis:` → `detailed_description:` → `overall_soundscape:` → `non_diegetic_music:`，段序与本契约完全一致 ✅。
- 段分隔形态：每个段名后跟半角冒号 + 半角空格，段之间一个空行（见 ref-en.txt L311–L339）。

**正文形态**（六段全部为英文正文）：

```text
subject_definitions:
<Subject 1> is the young woman in <Picture 1>, with long dark hair and a blue cardigan.

summary:
[reference generation] The target video shows <Subject 1> ...

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - ...

detailed_description:
The target video uses a cinematic style with warm lighting.
[Shot 1] A medium shot establishes <Subject 1> ...

overall_soundscape:
Quiet indoor room tone continues throughout the video.

non_diegetic_music:
N/A
```

**保留的官方枚举值**（逐字英文，属固定格式值，不得改写）：

- retention 视觉关系标记：`fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`（ref-en.txt L165–L168）。
- retention 音频关系标记：`fully_copy` / `partially_copy` / `reference` / `weak_reference`（ref-en.txt L194–L197）。
- 任务类型前缀（`summary` 段首方括号）：`keyframe completion` / `reference generation` / `video editing` / `video continuation` / `audio reuse` / `audio reference`，多类型用 ` + ` 连接（ref-en.txt L134–L139、L141）。
- 镜头/时间/对白标记：`[Shot 1]`（无时间戳）→ `[Shot 2] At MM:SS.mmm, ...`；说话人 `(S1)`、`(S2)`；对白 `<d>[Language] ...</d>`；跨镜 `<scenetrans>`、截断 `<cutoff>`（ref-en.txt L218–L221）。
- 无声音乐占位：`N/A`（ref-en.txt L338）。

## 3. 参考标记正则（权威）

### 3.1 四类标签与编号规则

| 标签 | 含义（ref-en.txt L26–L33 原文） |
|---|---|
| `<Subject N>` | Visible content abstracted from reference assets that can be reused or modified in the target video |
| `<Picture N>` | A reference image used as a concrete target frame or shot-planning anchor |
| `<Video N>` | A reference video that provides an editing source, continuation starting point, or whole-video temporal structure |
| `<Audio N>` | An audio signal that is copied or referenced |

**各媒质独立编号**：`<Picture 1>` / `<Video 1>` / `<Audio 1>` 各自从 1 起连续编号，编号只表示该标签在本类别内的次序，不编码类别之间的配对关系（ref-en.txt L110 原文：`<Video 1>` 与 `<Audio 2>` 可来自同一素材文件，索引不同不构成配对）。`<Subject N>` 单独编号。

**同一标签跨段同义**：一个参考标签一旦分配，在 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description` 与音频段中保持同一含义（ref-en.txt L35）。

### 3.2 参考标记正则（权威定义）

```
参考标记：<Subject N> / <Picture N> / <Video N> / <Audio N>
正则    ：<\s*(Subject|Picture|Video|Audio)\s+(\d+)\s*>      （大小写敏感，官方形态为大写首字母）
          ^  ^              ^   ^   ^        ^  ^
          │  │              │   │   │        │  └─ 整数编号，从 1 起，各媒质独立
          │  │              │   │   └─────────┘  媒质名，四种之一
          │  └──────────────┘  │
          │                    └─ 允许空格容差（校验用），书写时按官方原文写单空格
          └─ 尖括号，半角，不得用中文角括号「」或全角 ＜＞
```

配套的官方内联标记（同属合法格式，不是参考标记）：`<d>...</d>`、`<scenetrans>`、`<cutoff>`。

### 3.3 校验口径（取代现行 V7）

参考标记是**合法且唯一**的写法，因此：

1. `<Picture N>` / `<Video N>` / `<Audio N>` 出现 → **合法**，不再报 error。（现行实现把它当非法报 error，必须翻转。）
[HISTORICAL] 2. `{{ref N}}` 出现 → **报 error**，提示改用 `<Picture N>` / `<Video N>` / `<Audio N>`。不提供任何换算、降级或透传通道。
3. 编号合法性：某媒质内出现 `N` 时，本镜该媒质的参考素材必须至少有 `N` 个；超出即报 error（越界）。
4. 不查重号、不要求每个编号都出现（与官方一致：正文用不上某张参考可以不引用它，但它仍留在参考集合里送进引擎）。
[HISTORICAL] 5. 编号基准是 `referenceIds` 中**同媒质的过滤位次**：图片按 `referenceIds` 里图片卡的位次连续编号 → `<Picture 1>`…`<Picture k>`；音频卡位次 → `<Audio 1>`…；视频卡位次 → `<Video 1>`…。这与现行 `mediaDispatch.referenceTags` 的分桶计数逻辑同形，只需去掉 `{{ref N}}` 的中间层。

## 4. 首帧模式：首行指令原文

首帧模式（`mode === "image"`，对应官方 I2VA）下，最终提示词**第一行必须是这句指令，逐字不改**，其后空一行再接六段：

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

出处：`base-en.txt` L16–L20（**I2VA** always uses），逐字一致 ✅。

**硬性约束**：

- 该句是**静态原文**，不代入变量、不改写措辞、不翻译、不换行。
- `0.00` 秒与 `[Shot 1]` 固定不变——首帧就是 0.00 秒的第一镜（ref-en.txt L62 亦要求 `<Picture N>` 作首帧锚点时对应到具体 shot）。
- 首帧模式只有**一张图**，必然是 `<Picture 1>`。
- 该指令行**不算作六段之一**，不参与段名校验，也不重复出现在 `detailed_description` 里。

**其他首/尾帧模式的官方指令形态**（供完整参考；本轮只落地 I2VA 首帧，其余保留官方原文备查）：

| 官方模式 | 首行指令原文（base-en.txt） |
|---|---|
| T2VA（纯文本） | 无指令行，直接从三段核心字段开始（L14） |
| I2VA（首帧） | `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`（L19） |
| FL2VA（首尾帧） | `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`（L25） |
| L2VA（尾帧） | `How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.`（L31） |

其中 `N` 是实际最后一镜的序号，`S.SS` 是有效视频时长并格式化为**恰好两位小数**；指令必须是最终提示词的第一行，其后空一行再接核心字段（base-en.txt L34）。

## 5. 无参考时的退化规则（三段，主字段用 detailed_description）

无参考素材时，六段退化为官方的三段结构，字段名取 `base-en.txt` §2.2「Part Two Contains the Three Core Fields」的三段：

```text
detailed_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

**关键决定：退化时主字段用 `detailed_description`，不是 `integrated_multimodal_description`。**

- `base-en.txt` L39 的字面写法是 `integrated_multimodal_description: [Shot 1] ...`，但那是官方老指南沿用 T2VA 的命名。
- 本套一律以 H3 的 `detailed_description` 为主字段：ref-en.txt L229 明确记载两种模式的主字段对比为「T2VA `integrated_multimodal_description` ↔ Full-reference mode `detailed_description`」；`integrated_multimodal_description` 属于旧体系，见 §6 处置。
- 退化时省略 `subject_definitions` / `summary` / `retention_analysis` 三段（无参考则无参考对象可定义、无关系可总结、无保留度可分析）。
- 三段之间的空行与冒号空格形态与六段完全一致。
- `overall_soundscape` 与 `non_diegetic_music` 的写法、`N/A` 占位规则在两种模式下完全相同（base-en.txt §4.6 / §4.7；ref-en.txt §6）。

**判定退化**：本镜 `referenceIds` 为空（或 `mode === "text"`）→ 三段；否则 → 六段。

## 6. 旧字段处置

| 旧项 | 处置 |
|---|---|
[HISTORICAL] | `integratedMultimodalDescription`（JS 驼峰） | **直接忽略**：不再作为 `ClipPrompt` 的字段，不读取、不序列化、不做映射。 |
| `integrated_multimodal_description`（老提示词段名） | **直接忽略**：不再作为合法段名，不下发、不校验、不兼容。 |
[HISTORICAL] | `{{ref N}}` / `{{refN}}` / `{{ ref N }}` 占位符 | **直接忽略**：不解析、不换算、不降级提示；出现即报 error。 |
| `formatFamily` / 多供应商提示词形状开关 | **直接忽略**：提示词只有 H3 一种形状，无兼容分支。 |
| 老 `.mtrack` 工程里的旧字段 | **不做迁移**：无向后兼容层。 |

**忽略的实现含义**：

[HISTORICAL] - `readPrompt` 不再产出 `integratedMultimodalDescription`；旧工程读盘时该字段随未知键被丢弃（不报错、不提示、不写回）。
- 不建立任何「读老字段 → 写新字段」的迁移函数。
- 不建立任何「老占位符 → 新标记」的转换函数。

## 7. V7 翻转规则（现行 → 目标）

[HISTORICAL] 现行 V7（`packages/tools/planOperator/src/planValidator.ts:224–259`）是「`{{ref N}}` 合法、尖括号非法」，与本契约**完全相反**。翻转后：

| 现行（作废） | 目标（本契约） |
|---|---|
[HISTORICAL] | `{{ref N}}` 是合法写法，只查越界（N ∈ `1..referenceIds.length`），不查重号 | `{{ref N}}` 一律报 error，提示改用 `<Picture N>` / `<Video N>` / `<Audio N>` |
| 正文出现 `<Picture N>` / `<Video N>` / `<Audio N>` 判 error | 尖括号标记为唯一合法写法 |
| 编号基准：`referenceIds` 的整体位次（图/音/视混排连续编号） | 编号基准：`referenceIds` 中**同媒质过滤后**的位次（各媒质独立编号） |
[HISTORICAL] | 提示语：`参考标记统一写 {{ref N}}，N 为参考顺序里的序号` | 提示语：参考标记写 `<Picture N>` / `<Video N>` / `<Audio N>`，各媒质独立编号 |
[HISTORICAL] | 字段枚举：`integratedMultimodalDescription` / `overallSoundscape` / `nonDiegeticMusic` | 字段枚举：六段新字段名 |

**V7 目标语义（逐条）**：

1. 扫描本镜提示词全字段（六段 / 退化的三段）文本。
[HISTORICAL] 2. 命中 `{{\s*ref\s*(\d+)\s*}}` → `error`，message 指明「参考标记已改为 `<Picture N>` / `<Video N>` / `<Audio N>`，本镜已不使用 `{{ref N}}`」。
3. 命中 `<\s*(Picture|Video|Audio)\s+(\d+)\s*>` → 校验该媒质编号不超过本镜该媒质参考数；越界报 `error`。
4. 不查重号、不要求编号全覆盖。
5. 不因为旧占位符而做静默替换、静默删除或降级。

**V7 之外不受本次翻转影响**：V1/V2/V4/V8/V9/V11–V16 的其余语义按各自契约保持；本次只翻 V7 的标记方向。

## 8. 参考上限口径（四层，各层职责不同，不得混用）

| 层 | 阈值 | 依据 / 位置 | 说明 |
|---|---|---|---|
| 校验器 V8（引擎上限） | 图片 ≤ 9、音频 ≤ 1（视频参考与图片同桶计数） | `packages/tools/planOperator/src/planValidator.ts:83` `MAX_IMAGE_REFERENCES = 9`；`:261–270` | 独立镜头（`continuity === "shot"`）。这是 MiniMax H3 Ref2VA 独立镜的引擎上限。 |
| 续接镜（引擎 continue_from 契约） | 参考合计 ≤ 3，时长 ≥ 10 秒 | `planValidator.ts` V16；`mtrackEdit.ts:66–73` | `continuity === "context"` 时比独立镜更紧；不占用媒体槽但引擎契约按 references 总数算。 |
| 供应商单请求 | 参考图 ≤ 4 | `packages/providers/src/media/freevideo.ts` 的 `maxImageReferences = 4`（`freevideo.ts:250` 超限报错） | 比 V8 的 9 更严，供应商层拦截。 |
| 多轨界面勾选 | 4（承接镜 3） | `packages/nodeShared/src/mtrack/components/referencePicker.vue:11`、`:114` | 产品口径，网格端点满不再加。 |

**必须写清的三个易混点**：

1. **V8 = 9 与 界面 = 4 不是同一个数**：校验器阈值是引擎上限（9），界面硬编码是产品口径（4）。文档里两处必须同时写明，不得只写一个。
2. **V8 不校验视频参考**：卡片体系（`CardKind`）没有 `video` 类型，视频参考当前并入图片桶计数，`MAX_VIDEO_REFERENCES = 1` 常量暂无引用（`planValidator.ts:84–85`）。
3. **续接镜更紧**：≤3 且 ≥10 秒，两处校验（`planValidator` V16 与 `mtrackEdit.ts`）同阈值。

## 9. 段名逐字一致性结论

对照 `ref-en.txt` 与 `base-en.txt` 逐段核对结果：

| 字段 | ref-en.txt | base-en.txt | 本契约 | 结论 |
|---|---|---|---|---|
| `subject_definitions` | ✅ L17 | — | 同 | 逐字一致 |
| `summary` | ✅ L18 | — | 同 | 逐字一致 |
| `retention_analysis` | ✅ L19 | — | 同 | 逐字一致 |
| `detailed_description` | ✅ L20 | ✅ L229（作为 full-reference 主字段对照） | 同 | 逐字一致，且为无参考退化主字段 |
| `overall_soundscape` | ✅ L21 | ✅ L41、L152 | 同 | 逐字一致 |
| `non_diegetic_music` | ✅ L22 | ✅ L43、L162 | 同 | 逐字一致 |
| `integrated_multimodal_description` | L229（标记为 T2VA 老主字段） | ✅ L39（老指南主字段） | **不采用** | 属旧体系，直接忽略 |
| 首帧指令 | — | ✅ L19 | 逐字照抄 | 逐字一致 |

结论：**六段字段名与顺序、首帧指令原文、退化三段结构均与官方指南逐字一致**；唯一有意的偏离是退化时主字段用 `detailed_description` 而非 `integrated_multimodal_description`，这是本套「只用 H3、不留老格式」的决定，依据是 ref-en.txt L229 自身把后者归为 T2VA 旧主字段。

## 10. 改动覆盖范围（文件与模块清单）

以下为本契约落地涉及的**全部**文件与模块，按层归组。任何实现任务不得在此范围外另建提示词形状。

### 10.1 类型与内核（packages/nodeShared）

| 文件 | 影响点 |
|---|---|
| `packages/nodeShared/src/mtrack/mtrackProject.ts` | `ClipPrompt` 接口改为六段新字段；`readPrompt`、`createClip`、`promptToText`、`textToPrompt`、`hasPrompt` 全部改口径；`soundscapeHeading`/`musicHeading` 段名常量保留；新增 `subject_definitions` / `summary` / `retention_analysis` 三个段名常量 |
| `packages/nodeShared/src/mtrack/mtrackEdit.ts` | `validateClip` 的提示词相关校验随字段改名；参考上限文案保持 V8 = 9 / 续接 3 的口径 |
[HISTORICAL] | `packages/nodeShared/src/mtrack/mediaDispatch.ts` | `buildPromptText` 改为六段拼装 + 无参考退化 + 首帧首行指令注入；`composeClipRequest` **删除** `{{ref N}}` → `<Picture N>` 换算层（L190–L204）；`referenceTags` 只保留「同媒质过滤位次」计数供提示词书写参考 |
| `packages/nodeShared/src/mtrack/directDispatch.ts` | 派工链路按新标记口径检查；与 `mediaDispatch` 同桶计数一致（`:148`） |
| `packages/nodeShared/src/mtrack/components/shotEditorPane.vue` | 提示词编辑框：六段合成/拆分、段名提示、校验提示语 |
| `packages/nodeShared/src/mtrack/components/referencePicker.vue` | 勾选网格显示编号口径改为「按媒质独立编号」；`N/4` 摘要与上限拦截保持 |
| `packages/nodeShared/src/mtrack/components/referencePicker.vue` / `multitrackEditor.vue` / `mtrackProject.ts` | 旧字段引用清零 |

### 10.2 校验器与工具（packages/tools）

| 文件 | 影响点 |
|---|---|
[HISTORICAL] | `packages/tools/planOperator/src/planValidator.ts` | V7 翻转（L224–259）：字段枚举改六段；`{{ref N}}` 改判 error；尖括号标记改判合法 + 同媒质越界检查 |
| `packages/tools/planOperator/src/mtrackProject.ts` | 与 nodeShared 类型同口径；`ClipPrompt` 相关读写 |
| `packages/tools/planOperator/src/index.ts` | 工具描述与示例文案去旧占位符 |
| `packages/tools/planOperator/src/planValidator.ts` | V8 阈值常量不变；V7 之外的规则不动 |
| `packages/tools/planOperator/readme.md` | V7 规则表、`validate` 说明 |

### 10.3 服务端（apps/server）

| 文件 | 影响点 |
|---|---|
[HISTORICAL] | `apps/server/src/routes/mtrack/rewriteShot.ts` | `promptSchema`（L10–L14）改六段；`refine`（L23–L24）字段名同步；`hardDiscipline`（L38–L42）第 2 条由「禁尖括号、只保留 `{{ref N}}`」翻转为「写 `<Picture N>` / `<Video N>` / `<Audio N>`」；`sections`（L82–L87）段名与参考位次提示改写；`referenceIds` `.max(4)` 口径保持 |
| `apps/server/src/routes/mtrack/composite.ts` | 无提示词格式依赖，仅确认引用链无旧字段 |
| `apps/server/src/routes/ai/media/generate.ts` | 若含提示词透传校验，按新字段名核对 |
| `apps/server/src/agent/runtime/prompt.ts` | Agent 提示词注入处若引用旧段名需同步 |

### 10.4 节点（packages/nodes）

| 文件 | 影响点 |
|---|---|
| `packages/nodes/multitrackNode/src/index.vue` | 编辑器接线：提示词读写、校验提示 |
| `packages/nodes/multitrackNode/readme.md` | 说明文档 |
[HISTORICAL] | `packages/nodes/videoGenerationNode/src/index.vue` | `videoGenerationNode:241` / `:264–265` / `:355–358` 处的 `{{ref N}}` → 标记换算逻辑删除；`configRules` 上限声明（图 4 / 视频 1 / 音频 1）按 §8 第 3 层写清 |
| `packages/nodes/assetImportNode/src/assetImport.ts` | `maxImageReferences = 9`（`:82`）、`maxContextReferences = 3`（`:84`）保持；导入抽取提示词如含旧段名需同步 |
| `packages/nodes/assetImportNode/readme.md` | 说明文档 |

### 10.5 技能与文档（packages/skills、packages/mcp、docs）

| 文件 | 影响点 |
|---|---|
| `packages/skills/assetCard/SKILL.md` | 提示词段名与参考标记口径 |
| `packages/skills/assetCard/references/multitrackTemplate.md` | §四 ref2va 六段模板、§2.2 参考上限、V7 编号说明、§四「写作者写什么」 |
| `packages/skills/assetCard/references/generationRunbook.md` | §四、§十五 派工与校验步骤、§八 的 V7/V8 表述 |
| `packages/skills/assetCard/references/referenceResolution.md` | 参考顺序对账口径 |
| `packages/skills/assetCard/references/imagePrompt.md` | 图片侧引用上限表述 |
| `packages/skills/assetCard/references/assetDesign.md` | 「参考图 ≤4（界面口径）」表述 |
[HISTORICAL] | `packages/skills/freevideoMultitrack/SKILL.md` | 参考上限三层、V7 表述、`{{ref N}}` 口径 |
| `packages/skills/workflow/SKILL.md` | 提示词形状引用 |
| `packages/skills/workflow/references/assets.md`、`canvasExecution.md` | 提示词与派工说明 |
| `packages/skills/canvas/SKILL.md`、`packages/skills/canvas/references/videoProduction.md` | 画布技能里的提示词写法 |
| `packages/skills/v118workflow/SKILL.md`、`references/videoProduction.md`、`references/knowledge/videoPromptCraft.md`、`references/knowledge/imagePromptCraft.md` | 工作流技能里的提示词段落 |
| `packages/mcp/skills/toonflow/SKILL.md` | MCP 对外技能说明 |

[HISTORICAL] | `docs/assetCardWorkflowPlan.md`、`docs/assetCardWorkflowPlanReview.md`、`docs/multitrackProductionPlan.md`、`docs/multitrackQualityReview.md`、`docs/multitrackGapAudit.md`、`docs/mtrackWorkbenchContract.md`、`docs/mtrackLscAlignment.md`、`docs/requirementPlanOperatorMultitrack.md`、`docs/requirementMultitrackAgentBridge.md`、`docs/requirementRevisionNodeMultitrack.md`、`docs/assetToMtrackAudit.md`、`docs/agentGuideAudit.md`、`docs/localStoryCanvasStudy.md`、`docs/localStoryCanvasMultitrackStudy.md` | 各文档中的「参考顺序即编号」「`{{ref N}}` 是写作者唯一写法」等已反转口径段落，需按本契约改写并标注旧口径作废 |
| `docs/h3PromptAlignment.md` | 本文件，权威契约 |

### 10.6 供应商与 provider 声明（packages/providers）

| 文件 | 影响点 |
|---|---|
| `packages/providers/src/media/freevideo.ts` | `maxImageReferences = 4` 保持；模式声明（`imageReference:4` / `videoReference:1` / `audioReference:1`）作为 §8 第 3 层口径的真相源 |
| `packages/providers/src/media/compshare.ts`、`metaso.ts` | 提示词透传链路确认不含旧占位符换算 |

## 11. 工作区约束

- **唯一工作区**：`C:\workspace\super-ai\Toonflow-app.mtrack-official`（分支 `mtrack-official-prompt`）。
- **禁止改动主分支**：`C:\workspace\super-ai\Toonflow-app` 是主分支工作树，本套改动一律不得落在该目录下。
- 所有 §10 列出的路径均以 `.mtrack-official` 工作区为准；实现任务不得跨工作区复制改动。

## 12. 契约检查清单（验收用）

1. 段名逐字：`subject_definitions` / `summary` / `retention_analysis` / `detailed_description` / `overall_soundscape` / `non_diegetic_music`，顺序固定。
2. 参考标记正则 `<\s*(Picture|Video|Audio)\s+(\d+)\s*>` 各媒质独立编号。
3. 首帧模式首行逐字：`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`
4. 无参考退化：`detailed_description` / `overall_soundscape` / `non_diegetic_music` 三段，主字段是 `detailed_description`。
[HISTORICAL] 5. `integratedMultimodalDescription` 直接忽略，无任何迁移。
[HISTORICAL] 6. V7 翻转：`{{ref N}}` 报 error，尖括号标记合法。
7. 参考上限四层写清：V8 = 9 图 / 1 音（视频并入图片桶）；续接 ≤3 且 ≥10 秒；供应商 ≤4；界面勾选 4（续接 3）。
[HISTORICAL] 8. 全仓无 `{{ref N}}` 占位符与 `integratedMultimodalDescription` 残留（除历史文档中明确标注「作废」的记录）。
9. 工作区只有 `.mtrack-official` 被改动。