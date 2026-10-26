> **DEPRECATED (H3 迁移后作废)**：本文档描述老双花括号 ref 占位符与三字段提示词格式，已随 MiniMax H3 官方六段（subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music）与 `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记口径全量迁移后**作废**；权威口径见 `docs/h3PromptAlignment.md`，文件保留不删除，仅作历史追溯。

# 提示词兼容最终推荐方案（t8）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 输入：t1 基线、t2 差异、t3 freevideo 格式、t4 非 freevideo 格式、t5 单字段化与分流、t6 风险、t7 红队。本文只设计与推荐，不实施。
> 文档关系：**存储形状随本稿；freevideo 的内容格式随 `promptCompatFreevideo.md`；其他供应商随 `promptCompatNonFree.md`；分流随 `promptCompatRouter.md`；三者冲突以本稿 §1.9 的收敛表为准。**
> 术语先校准：**基础三段** = MiniMax H3 非 ref2va 任务的 `integrated_multimodal_description` + 两个声音段；**Seedance 三段式** = Seedance 2.0 的「素材定义 / 顺序镜头 / 风格约束」外壳。两者不得再共用「三段式」这个名字。

## 0. 一句话结论

**默认只回答「没人点名时用谁」——视频与图片都走本地 freevideo；格式永远回答「这个模型要求怎么写」——按 `modelId` 定格式族、按 `(providerId, modelId)` 条目定能力、按 `providerId` 定标记换算；多轨提示词收成一个字符串，读时兼容、写时不双写、首次写回前自动备份；非 freevideo 的外壳与模板原样保留，多轨允许切过去但只做影响评估、不改写存量；引导层每类事实只有一个真源，代码、仓库技能、运行时技能、DSH 技能包同批更新。**

推荐组合：**t5 的单串存储 + t7 修正后的三键路由 + t3 的 freevideo 格式 + t4 的非 freevideo 保留清单 + t6 的 P0 止血**。D4（单串 / M0）不替用户决定，成本对比与推荐理由见 §5。

---

## 1. 判定与分流

### 1.1 三个键，各回答一个问题

| 键 | 回答 | 取值 | 来源 |
| --- | --- | --- | --- |
| **格式族** | 写成什么样 | `h3-ref2va` / `h3-basic` / `seedance-2.0` / `seedance-2.5` / `seedream` / `nanobanana` / `wan-2.6` / `generic-image` | `modelId` → 一张映射表（唯一处） |
| **能力** | 能不能这么写 | mode 集合、参考上限、时长、语言、音频支持 | `(providerId, modelId)` 模型条目 + 节点 `getConfig` |
| **传输** | 标记怎么到引擎 | 换算 / 原样透传 | `providerId`（本轮只有 freevideo 换算） |

三条硬规则：

1. **同一 `modelId` 由多家提供时，格式族相同、能力不同。** MiniMax-H3 在 freevideo、metaso、apiMart、compshare、tfRouter 五家都有（`packages/providers/src/media/freevideo.ts:216`、`metaso.ts:70`、`apiMart.ts:191`、`compshare.ts:1762`、`tfRouter.ts:170`），但 `mode` 不同：freevideo 是 `imageReference:4 + video:1 + audio:1`（`freevideo.ts:220`），metaso / apiMart / compshare 是 image 9 + video 3 + audio 3，tfRouter 无 video 参考。所以既不能按 `providerId` 判格式，也不能只按 `modelId` 判能力。
2. **判定点按形态固定为一个。** 单镜视频 = 该节点 `node:getConfig`（`videoGenerationNode/src/index.vue:385-399`）；资产图 / 首帧图 = 图片节点 `getConfig`（`imageGenerationNode/src/index.vue:407-417`）；多轨 = 工程 `global.model` 声明 + 派工后回读 `getConfig`（声明值可被 UI 改写并经 `configureNode` 真下发，`directDispatch.ts:364-384`，所以不能单独作权威）。
3. **权威降序：节点 `getConfig` > 用户点名 > 工程 `global.model` 声明 > 默认。** 两者不一致时停止并报告，不猜、不静默修正。

三个禁止：**禁止按形态判格式**（多轨不等于 H3，`multitrackEditor.vue:665-671` 允许切模型）；**禁止按「有没有挂参考」判六段**（判据是实际任务是否 ref2va，见 §1.3）；**禁止按名称猜供应商能力**（`tfRouter` 的 H3 不享受 freevideo 的换算）。

### 1.2 媒体分流表（成品，可直接粘贴进 `canvas/references/videoProduction.md` §0.1）

| 媒体 / 任务 | 默认（未点名） | 用户点名后 | 判定字段 | 格式真源 | 写进哪 |
| --- | --- | --- | --- | --- | --- |
| 资产图（角色 / 场景 / 道具卡） | freevideo 图像模型 | 按其指定模型 | 图片节点 `getConfig` 的 `providerId` / `modelId` | `assetCard/references/imagePrompt.md` 内容要素清单（无固定格式） | 图片节点提示词 |
| 分镜首帧图 | 同上 | 同上 | 同上 | `imagePrompt.md` 首帧图一节（本轮补写） | 图片节点提示词 |
| 多轨视频片段 | freevideo / MiniMax-H3 | 按其指定模型 | `global.model` 声明 + 派工 `getConfig` | H3：`multitrackTemplate.md` §四；其他：格式卡 | `clips[].prompt`（单字符串） |
| 单镜视频节点 | freevideo / MiniMax-H3 | 按其指定模型 | 视频节点 `getConfig` | H3：同 §四（内容同构）；其他：格式卡 | 节点 `data.prompt` |

表下面必须跟一句判定句（不是默认值）：

> 未点名模型时按本表执行，不询问模型；本表模型不可用时先查实际可用能力，说明后确认替代，不静默换成节点默认值。用户点名其他模型时按其指定执行。工程 `global.model` 只是声明值，派工以目标节点实时配置为准；两者不一致时停止并报告。

### 1.3 格式族判据

| 格式族 | 判据 |
| --- | --- |
| `h3-ref2va`（六段） | `modelId` 为 MiniMax-H3，且实际任务吃参考（`mode` 不是 `startFrameOptional`，参考集非空） |
| `h3-basic`（基础三段） | 同上，但纯文生、或首帧驱动（`startFrameOptional`）、或参考集为空 |
| `seedance-2.0` | `modelId` 为 Seedance 2.0；三链外壳见 t4 卡 1 |
| `seedance-2.5` | `modelId` 为 Seedance 2.5；A9.2 九字段白名单 |
| `seedream` / `nanobanana` / `wan-2.6` | 按 `modelId` 直接映射 |
| 未知 | 不猜；列节点可用模型让用户选 |

关键分界是**实际下发的任务是不是 ref2va**，不是「有没有挂图」。多轨在派工前拿不到 `mode` 时，按参考集与工程声明先写，派工后用 `getConfig` 回读；不一致就停下重写（见 §1.7）。

### 1.4 freevideo 沿用什么

**视频 = 格式规范。** 六段顺序固定：`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`；基础三段是 `integrated_multimodal_description` + 两个声音段。多轨与单镜的**内容完全同构**，只差三件事：文本放哪（`clips[].prompt` 还是节点 `data.prompt`）、风格从哪来（工程 `global.style` 由 wire 拼前缀，还是写进 `[Shot 1]` 定语）、参考顺序谁定（多轨由编辑器参考区，单镜由节点连线）。

单字段化后，六段**全部写进同一个字符串**；两个声音段不再有独立字段，但仍保留官方段首名，便于人读与模型识别。

编号规则：`<Picture N>` / `<Audio N>` / `<Video N>` 按类型各自从 1，互不占用；`referenceIds` 的位次不等于 Picture 序号（声音卡占位会错位，`generationRunbook.md:112` 的例子仍成立）。文本参考由 wire 以「参考 N」追加在正文末尾（`index.vue:232-237`），这不属于六段；需要严格六段时，把文本参考的内容并入 `detailed_description`，不要依赖追加位置。

**图片 = 内容规范，不是格式。** freevideo 图像只读提示词（`freevideo.ts:236-263`），没有段首协议、没有 negative 通道；写五要素（主体与版面、形貌锚点、状态与视角、背景与光、排除项）。「4 张」是 Toonflow 的提交前校验（`freevideo.ts:219` 注释、`:207` readme），不是引擎能力，不得写成模型上限。

**风格的作用域必须一次说清：** `global.style` / `global.systemPrompt` 是工程级前言，由 wire 拼在正文最前（`directDispatch.ts:101-105`）；「正文第一行必须是 `subject_definitions:`」只约束**正文**，不约束 wire 文本。`global.style` 保持可选、默认空；填了就会出现「全片风格：」前缀，这是预期行为，不再作为「首行违规」处理。

**换算只发生在 freevideo**（`videoGenerationNode/src/index.vue:228`）。tfRouter / metaso / apiMart / compshare 的 H3 收到的是原样标记：引导层必须要求直接写官方标记，不得承诺「以后会换算」。

### 1.5 非 freevideo 保留什么

六张格式卡原样保留（`promptCompatNonFree.md` §二）：Seedance 2.0 三链三外壳、Seedance 2.5 A9.2 九字段白名单、Seedream 中文段落、Nanobanana JSON、Wan 2.6 英文单首帧、附录 gpt-image。原样保留清单 R1–R6、D1、M1–M4、C1–C3、V1–V2 全部有效，重点包括：

- A9 路由行与 A9.2 九字段硬门（`workflow/SKILL.md:802-803`、`:871-882`）不改写；
- 真实句柄原样引用、每段自包含（`:237-238`、`:978`）；
- 语言分支（`:199-202`）与时长表（`:384-385`）；
- `imagePromptCraft.md:97`「编号保持真实全体输入序列」；
- `workflow/SKILL.md:806`「外壳服从执行」；
- 旧REF占位标记在非 freevideo 下是**内容**，不是传输编码；写作者必须按该模型格式卡书写。

v118workflow 的 11 种画风与四套模板是**能力域**，全部保留；只做两件事：删掉把模板定性为不可用于新项目的时间叙事句（`v118workflow/SKILL.md:13`、`assetCard/references/imagePrompt.md:21`、`:296`），以及把 `videoPromptCraft.md:14` 的「版本不能冒称已验证」改成条件句（「当用户点名该模型时，按其格式卡执行；模板未覆盖的模型先查真实能力」）。

多轨硬隔离（`workflow/SKILL.md:45`）必须改写成条件句：**多轨产物格式跟随工程所选模型**；H3 写六段 / 基础三段，其他模型写其格式卡；A9.1 / A9.2 字段只在对应模型路由下使用，不再按「是不是多轨」一刀切。

### 1.6 多轨单字段化怎么落（细节见 `promptCompatBlueprint.md`）

- `clips[].prompt` 的最终类型是 `string`；`readPrompt` 是唯一兼容点：字符串直读，三字段对象合成一段；合成**必须复刻改造前 `buildPrompt` 的补段首规则**（见下条规则 3），否则「老工程派工内容不变」不成立。
- 写入口只有一个：`prompt: next`。**禁止对象展开、禁止 `Object.assign`**；`clipEditor.vue:96-124` 三处、`mtrackEdit.ts:34-37` 全部按单串改写。
- 不双写、不写格式版本位。首次写回前自动备份，备份失败就不保存。
- `buildPrompt` 退化为「工程前言 + 正文」的纯透传，不再补段首、不再拼声音尾段、不再按 `referenceIds.length` 分支。
- 校验器只判断「有没有内容」与「形状对不对」；格式检查按格式族开闸，只提示不代写。
- `rewriteShot` 请求体收成 `prompt: string`，与 schema、校验器同批改。

### 1.7 多轨非 freevideo 怎么处理

**推荐：允许切，格式随 `global.model`，切换只做影响评估，不改写存量（t5 方案 B + C）。**

理由三条：

1. UI 本来就可选（`multitrackEditor.vue:665-671`），`configureNode` 也会把声明值真下发（`directDispatch.ts:379-382`）；禁止切换只会在引导层制造「正确格式被明令禁止」的死角。
2. H3 由五家提供，禁止多轨切非 freevideo 会连带挡住 tfRouter / metaso 的 H3，这是把「供应商」误当「模型」。
3. 单字段之后，切模型不需要改数据结构，成本几乎为零；真正需要的是**让用户知道自己在切什么**。

切换对话框（成品文案，可直接粘贴）：

> 即将把本工程的视频模型从「{当前}」切换为「{目标}」。
> 受影响的非空提示词镜头：{N} 个；只读扫描结果：疑似 H3 六段 {a} 个、疑似 Seedance 三段式 {b} 个、未知 {c} 个。
> 切换只修改工程声明，**不会改写已有提示词**。已有提示词将按切换前模型的格式原样下发给新模型，可能不被识别；请按新模型格式卡重写后再派工。
> [取消] [仅切换，不改写]

派工侧只保留一个动作：`configureNode` 写入后回读 `getConfig`，确认节点实际模型与声明一致；不一致停止并报告。**不要再做「声明 vs 节点」的事前比对**——在设置之前节点没有目标值，这个预检是自证循环（t7 R-02）。

### 1.8 条件句模板（成品，可直接粘贴到技能）

1. **默认**：未点名模型时，视频用本地 freevideo / MiniMax-H3，图片用 freevideo 图像模型；该模型不可用时，先查实际可用能力，说明后确认替代，不静默换成节点默认值。
2. **点名**：用户点名供应商或模型时，外壳、标记、编号、语言切到该模型的格式卡；形态只决定写进哪个字段，不决定格式。
3. **多轨**：多轨片段提示词写在 `clips[].prompt` 这一个字段里；工程模型为 H3 时按六段或基础三段书写，其他模型按其格式卡书写。
4. **单镜**：单镜视频节点有参考且任务为参考驱动时，同样写六段；纯文生或首帧驱动写基础三段。
5. **标记**：参考标记按该模型要求的写法书写；标记换算只发生在 freevideo 的 wire 层，其他供应商收到的是原样文本。
6. **风格**：风格与约束写在工程级字段，由引擎拼在正文前；正文首行规则只约束正文，不约束 wire 文本。
7. **文本参考**：文本参考由 wire 追加在正文末尾；需要严格六段时，把文本参考内容并入详细描述。
8. **切换**：切换视频模型只改工程声明，不改写已有提示词；按新模型格式重写后再派工。
9. **校验**：校验器只判断有没有内容、形状对不对；格式由模型格式卡负责，H3 任务额外提示段首与段数。
10. **运行时**：技能内容以 `data/skills` 为准；仓库技能更新后必须同步运行时副本，否则 agent 读到的仍是未同步的内容。

### 1.9 三稿互斥点的收敛

| 编号 | t3 | t4 | t5 | 本稿裁决 |
| --- | --- | --- | --- | --- |
| X-1 单镜段数 | 有参考即六段（`:157-171`） | 单镜写「直连三段式内容」（`:94`、`:268`） | 未表态 | **六段**；把 t4 两格改成「六段（基础三段仅纯文生 / 首帧驱动）」，并拆开「三段式」术语 |
| X-2 路由键 | `providerId` 优先（`:23-25`） | 模型名唯一（`:257`） | 二元组但分工 | **`modelId` 定格式族 + `(providerId, modelId)` 定能力 + `providerId` 定换算** |
| X-3 style / 首行 | 写作层与 wire 层混写 | 未展开 | 可选、默认空 | 一处规则、两个作用域：正文首行归写作层，前缀归 wire 层 |
| X-4 存储 vs 内容 | 三字段落位 | 各格式卡 | 单串 | 存储随本稿，格式内容随 t3 / t4 |
| X-5 换算范围 | 只 freevideo | 只 freevideo、其他是内容 | 建议扩到五家 | 本轮只 freevideo；引导层不得承诺扩展 |
| P-1～P-6 | — | — | 迁移文本、校验器、文案、工具描述、DSH、双真源 | 全部列入 `promptCompatBlueprint.md` 的 P0 / P1，不留到下一轮 |

---

## 2. 单字段化数据结构设计（字段级）

### 2.1 最终形态

```ts
// packages/nodeShared/src/mtrack/mtrackProject.ts
export type ClipPrompt = string;

export interface MtrackClip {
  // ...既有字段不变
  prompt: ClipPrompt;     // 空串合法；上限 20000 字符；不再有三字段对象
  referenceIds: string[];
}
```

- `prompt` **不是可选字段**，默认 `""`；建镜时就写空串（`mtrackProject.ts:199` 的现有行为保留）。
- 不在类型上保留三字段兼容形状；兼容只发生在读取函数里，不进入数据模型。
- 不新增 `promptFormat`、`promptVersion` 一类版本位。

### 2.2 读：唯一兼容点 `readPrompt`

签名改为同时接收参考集（补段首规则需要它）：

```ts
function readPrompt(value: unknown, referenceIds: string[]): string
```

算法（按顺序）：

1. `typeof value === "string"` → 原样返回（幂等，新数据走这一支）。
2. `value` 是对象 → 取 `integratedMultimodalDescription` 并 `trim()` 作为正文；正文为空则不补段首。
3. **补段首（必须复刻改造前 `directDispatch.ts:106` 的行为）**：正文不以五个官方段首之一开头时，`referenceIds.length > 0` 补 `detailed_description: `，否则补 `integrated_multimodal_description: `。**这一步不能省**：改造前 `buildPrompt` 在派工时补，单字段化后派工是纯透传，若读归一不补，老工程的下发文本就与改造前不一致，而 t5 声称的「逐字对齐」也不成立。
4. 声音段：`overallSoundscape` 非空 → 追加一段 `overall_soundscape: ` + 内容；`nonDiegeticMusic` 非空 → 追加 `non_diegetic_music: ` + 内容；段间一个空行，空段整段省略。
5. 其他形状（数字、数组）→ 返回空串，并由校验器报形状错误。

「官方段首」用共享常量（`officialSectionPattern`），与派工、校验器同源，不在三处各写一份正则。

### 2.3 写：唯一入口与禁令

- 允许的写法只有一种：`onPatch({ prompt: nextString })`。
- **禁止** `{ ...clip.prompt }`、`{ ...value }`、`Object.assign({}, clip.prompt, ...)`。对字符串展开会得到 40 个字符索引键（t6 实测），而 `readPrompt` 只取三个具名字段，声音内容会**静默、不可逆丢失**（红队 R-03）。
- 需要「在原文后追加」时，用 `clip.prompt + "\n\n" + addition`，不要走对象合并。
- `mergePatch` 对 `prompt` 做特判：`patch.prompt !== undefined` 时整串替换，不进入对象浅合并。

### 2.4 老工程迁移规则

| 项 | 规则 |
| --- | --- |
| 识别 | `typeof clip.prompt === "object"`（含三键全空的对象） |
| 读入 | 任何入口先 `normalizeProject`，内存中已是单串；磁盘不动 |
| 首次写回 | 保存前检查原文件是否存在对象形状；有则备份，再写单串 |
| 备份位置 | 工程同目录 `backup/story.<yyyyMMdd-HHmmss>.mtrack`；同名已存在则不覆盖（保留最早一份） |
| 备份失败 | **中止保存并报错**，不允许「先迁移再补备份」 |
| 迁移方向 | 单向；不做双写；不保留改造前代码可读的降级形状 |
| 提示 | 首次迁移后显示一次横幅：「本工程提示词已转为单字段；原始文件备份在 …」，不阻塞操作 |
| 200 镜工程 | 三字段全空 → 迁移后仍是 200 个空串；错误面不变，不产生内容损失 |

### 2.5 回退路径

1. 用备份文件覆盖 `story.mtrack`，回退到改造前的构建；这是唯一受支持的整工程回退。
2. 新文件被改造前构建读取时，`readPrompt` 取不到三个具名字段，显示为空、再保存会清空——**发布说明与迁移横幅必须写明「不要用改造前构建打开新工程」**。
3. 分支自测需要来回切时，先复制一份 `.mtrack` 到工作区外，不依赖任何自动降级。

### 2.6 两处 `mtrackProject.ts` 的同步策略

**只接受「加依赖、删副本」：**

1. `packages/tools/planOperator/package.json` 增加 `@toonflow/node-shared` 依赖（该子路径已在包的 `exports` 中，且 `mtrackProject` 不引 Vue，可被服务端与工具复用）。
2. 删除 `packages/tools/planOperator/src/mtrackProject.ts`；`index.ts`、`planValidator.ts` 改从 `@toonflow/node-shared/mtrack/mtrackProject` 导入。
3. 用编译器证明收敛：把共享的 `ClipPrompt` 临时改成 `number`，`planOperator` 必须报错；不报错就是还有副本。
4. **不接受**「保留副本 + 注释同步」：两份类型不同名（`ClipPrompt` vs `MtrackClipPrompt`）、互不导入，编译器抓不住，而这次改的正是类型形状。

### 2.7 `clipEditor` 单框 UI

- 三个输入框改一个 `textarea rows="12"`，直接绑定 `clip.prompt`。
- 标签：`本镜提示词`。
- 占位（成品，不绑供应商）：`按工程当前视频模型的官方格式书写本镜；参考用该模型要求的标记写法指位。`
- 辅助行只读显示：`当前模型：{providerId} / {modelId}`；不显示段名列表、不显示标记示例、不预览合成结果、不校验、不自动补前缀。
- 参考区标签改成中立的「参考顺序（序号由模型标记决定）」，不再暗示某一种标记语法（`clipEditor.vue:85` 的现文案要改）。

### 2.8 `buildPrompt` 是否退化为纯透传

**是，退化为纯透传。**

```ts
const preface = [
  clip.style ? `全片风格：${clip.style}` : "",
  clip.systemPrompt ? `全片约束：${clip.systemPrompt}` : "",
].filter(Boolean).join("\n\n");

const body = prompt.trim();
if (!body) return "";   // 空正文不发，避免「只有风格」的请求
return [preface, body].join("\n\n");
```

- 删除：自动补段首、两个声音尾段、按 `referenceIds.length` 分支。
- 保留：工程级风格 / 约束前言。
- 空正文：`buildPrompt` 直接返回空串（即使有风格 / 约束前言），由派工跳过；不允许「只有风格」也发出去。
- `prompt` 为空时，`dispatchClips` 直接报「本镜提示词为空」，不再生成。

### 2.9 校验器新规则

| 规则 | 改法 |
| --- | --- |
| V11 | 从「三字段 + 两个声音 warning」收成一条：`prompt.trim() === ""` → error「本镜提示词为空」；删除声音字段检查 |
| 形状断言 | `prompt` 既不是 string、也不是三键对象 → error「提示词形状未归一，请重新打开并保存工程」；三字段对象在归一后不应出现，出现即说明有入口绕过了 `normalizeProject` |
| V7 字段 | 只查 `prompt`；旧REF占位标记保留提示级，文案按供应商条件句（freevideo → 会被换算；其他 → 原样透传，需按格式卡改写） |
| 官方标记边界 | 只在格式族为 `h3-ref2va` / `h3-basic` 时执行；其他模型跳过，不用 H3 的编号上限误报；上限优先取 `(providerId, modelId)` 条目，取不到时只查「正整数、同类型不重号」 |
| H3 段级提示（保留的那一条） | 格式族为 `h3-ref2va`、正文非空、且缺少 `overall_soundscape:` / `non_diegetic_music:` 或首行不是官方段首时，给 warning；只提示，不代写 |
| 禁 autofix | 任何校验结果不回写正文 |

**600 → 200 的逐规则增减（真实 200 镜工程）**：

| 规则 | 改造前 | 改造后 | 说明 |
| --- | --- | --- | --- |
| V11 空提示词 error | 200 | 200 | 200 个空串仍是错误 |
| V11 两声音字段 warning | 400 | 0 | 字段不存在了，检查删除 |
| V7 形状 error | 0 | 0 | 全部可直接归一 |
| V7 旧REF占位标记 warning | 0 | 0 | 该工程无标记 |
| V7 官方标记边界 | 0 | 0 | 正文为空，跳过 |
| H3 段级 warning | 0 | 0 | 正文为空，不评估；有内容的 H3 工程才会出现 |
| **合计** | **600** | **200** | **不是「工程变干净」**：减少的 400 条是检查被删除，不是问题被修复；有内容的工程由新的段级 warning 接住信号 |

### 2.10 `rewriteShot` 请求体

```ts
prompt: z.string().max(20000)
// refine: value.prompt.trim().length > 0，错误文案「请先填写本镜提示词再整理」
```

- 请求、响应、回写全部是单串；`requiresReview` 语义不变。
- 发给文本模型的内容：模型身份 + 参考清单（位置 + 卡片 id）+ 正文；**不预生成任何标记**，删掉现有的 `<Picture N>` 映射。
- 与 schema、校验器、编辑器**同一提交**；否则会出现「编辑器出单串、整理接口 400」的窗口。

---

## 3. 与 master 基线对账

对照 `promptCompatBaseline.md` 的清单逐项确认。结论：**能力全部保留；两项默认值按用户要求替换；一项入口条件随默认值收窄。没有任何格式、模板、外壳、兜底或校验能力被删除。**

| 基线项 | 出处 | 本稿状态 | 说明 |
| --- | --- | --- | --- |
| canvas 三段式 + 旧REF占位标记 | `promptCompatBaseline.md:28` | **保留** | 非 freevideo 路径原样可用；freevideo 路径按 H3 六段写，标记由 wire 换算 |
| canvas 图片默认 gpt-image | `:28`、`:106` | **默认替换，能力保留** | 默认改 freevideo 图像（约束 c）；freevideo 不可用时按实际能力选，gpt-image 在可用清单里就优先它（恢复 NF-1 的兜底） |
| canvas 视频默认 Seedance 2.0/2.5 多参 | `:28` | **默认替换，能力保留** | 默认改 H3；点名 Seedance 或其工程模型为 Seedance 时，三段式与多参规则原样执行 |
| workflow A0–A12、A9.1、A9.2 | `:42` | **全部保留** | 九字段白名单、硬门、「不得交付」句均不改写 |
| PART A 无条件进入、未指定模型时问 2.0/2.5 | `:42`、`:91` | **入口收窄，内容保留** | 入口改为「A0 选定 Seedance 时」；点名 Seedance 或工程模型为 Seedance 时，行为与 master 一致，仍会问 2.0 / 2.5 |
| v118 11 画风 + 四套模板 | `:61` | **全部保留** | 定位为能力域；只删时间叙事与「不可用于新项目」的定性句 |
| 参考标记三套语义（身份句柄 / 真实节点句柄 / 画布传输编号） | `:76` | **保留** | 继续分离；换算只在 freevideo |
| 六种多供应商共存手法 | `:131-163` | **保留并强化** | 分层隔离、单点路由、条件句、内容 / 传输分离、身份 / 参数解耦、语言分支全部沿用 |
| 五条值得继承的设计 | `:170-196` | **全部落地** | 见下表 |
| 基线弱点：默认口径分散三处 | `:203` | **收敛** | 真源一处（`videoProduction.md` §0.1），其余改指针 |
| `script` 技能悬空引用 | `:203` | **不新增、不修** | master 树本来就没有该技能，保留现有降级规则，不在本轮造文件 |

五条继承设计的落地位置：

| 继承项 | 落地 |
| --- | --- |
| 模型 = 唯一路由键 + 可判定外壳 | §1.1 三键；格式族表只认 `modelId` |
| 路由先于执行，执行层不反写 | §1.7；`buildPrompt` 纯透传；`configureNode` 只写配置、不改文本 |
| 同一事实只写一处 + 单向校验 | §1.8 / Blueprint 的真源表与 grep 验收；校验不回写 |
| 内容与传输标记分离，编号来自现场 | §1.4；换算契约；编号按类型各自从 1 |
| 跨技能依赖显式声明 + 缺失降级 | `assetCard` 指针显式化；`script` 缺失降级保留 |

**必须说清的三个变化（都是用户约束的直接结果，不是能力丢失）：**

1. 视频默认从 Seedance 改为本地 freevideo / MiniMax-H3。
2. 图片默认从 gpt-image 改为 freevideo 图像模型；同时保留「不可用时按真实能力选、gpt-image 优先」的兜底。
3. PART A 的入口从「无条件」改为「A0 选定 Seedance」；十步内容、2.0/2.5 询问、九字段硬门全部保留。

---

## 4. 与用户约束对账

| 约束 | 状态 | 证据 / 落点 |
| --- | --- | --- |
| (a) 不使用版本叙事 | **本稿满足；技能层待修** | 本稿不含时间性定语；待修句：`v118workflow/SKILL.md:13`、`assetCard/references/imagePrompt.md:21`、`:296`、`videoPromptCraft.md:14`；统一改成条件句，见 Blueprint P2 |
| (b) 非 freevideo 模板不被并掉、不被改写成 freevideo 口径 | **满足** | §1.5 六张卡 + 原样保留清单；换算只发生在 freevideo；v118 模板保留为能力域 |
| (c) 默认路径是本地 freevideo | **满足** | §1.2 表：视频 H3、图片 freevideo 图像；不可用时按能力兜底并说明 |
| (d) 多轨默认 freevideo | **满足** | `multitrackTemplate.md:74` 的 `global.model` 默认保持 freevideo / MiniMax-H3；分流表同 |
| (e) 多轨提示词单字段、格式不绑定供应商 | **存储 / UI / 校验满足；引导层同批修** | §2 全节；占位不绑供应商；DSH 9 文件列入 P0 |

**术语校准（必须写进最终方案的序言）**：「格式不绑定供应商」只能理解为「字段与 UI 不绑定供应商」；**内容格式必须随供应商变**。若被读成「所有供应商共用一种格式」，就会与 (b) 和格式卡直接冲突。正确读法：一个字段，多种格式；格式由 `modelId` 决定。

---

## 5. 需要用户拍板的点

### D4：单串存储（推荐）还是 M0 三字段冻结

| 维度 | 单串（t5） | M0（t7 反提案） |
| --- | --- | --- |
| 做法 | `prompt: string`；读归一；删三字段 | 保留三字段存储；UI 单框只写第一字段；两个声音字段冻结为空；校验器降级；`rewriteShot` 收单串 |
| 改动面 | 约 35 文件（代码 12：服务端 1、nodeShared 6 含新建 1、planOperator 4、节点 1；DSH 9；技能约 14） | 约 6–8 文件 |
| 可逆性 | 不可逆；靠自动备份整工程回退 | 完全可逆；不改磁盘形状 |
| 是否满足约束 (e) | 是（存储层不再含 H3 语义） | **否**：存储仍编码 H3 的两个声音字段，消费者必须知道「哪两个字段是死的」 |
| 真相源 | 一个 | 两个（冻结字段 + 正文），迟早漂移 |
| 改造前工程派工一致性 | 读归一可做到逐字一致（需补段首，见 §2.2） | 一致（`buildPrompt` 仍读三字段） |
| 长期成本 | 一次迁移 + 备份 | 永久保留死字段与「不要写这两个字段」的口头契约 |

**正面回答 t7 的质询：为什么「冻结两字段」不可接受，而「不可逆迁移」可接受？**

- 冻结两字段并没有把 H3 语义从存储里去掉，只是把它们标成「别写」；于是每个消费者（编辑器、校验器、`buildPrompt`、`rewriteShot`、DSH、MCP 工具描述）都必须同时理解「三字段的形状」和「只有第一个字段有效的规则」。这正是本轮要消灭的「同一事实两处描述」，而且它永远不会收敛。
- 不可逆迁移的风险是**数据丢失**，这个风险可以用「写前自动备份 + 备份失败即中止 + 一次性提示 + 回退演练」压到可控；而冻结方案的风险是**规则永久分叉**，没有任何自动手段能发现漂移。
- 因此：**若用户更看重可逆性，选 M0 也成立**，但必须同时接受「存储层继续绑 H3、约束 (e) 只在 UI 层成立」，并把两个声音字段标注为保留字段、禁止写入。**推荐单串**，因为本轮的目标就是把格式从数据结构里拿出来。

### D6：多轨是否允许切非 freevideo（推荐允许）

推荐允许（§1.7），配套「切换影响评估 + 不改写 + 回读校验」。若用户要求锁死为 H3，则必须同时接受：tfRouter / metaso 的 H3 被误伤、用户点名 Seedance 时无合法落点；这两条要在产品层明确接受，不能只在引导层写「禁止」。

### D7：图片默认是「只 freevideo」还是「freevideo 优先 + 能力兜底」（推荐后者）

推荐后者：默认 freevideo 图像；不可用时先查实际可用模型，gpt-image 在清单里就优先它，并说明替代原因。这样既满足「默认本地 freevideo」，也不删除 master 的能力兜底。

---

## 6. 为什么不是其他方案

| 未采纳 | 理由 |
| --- | --- |
| A：引导层禁止多轨切非 freevideo | 与 UI 可选、`configureNode` 真下发直接冲突；误伤四家 H3；用户点名 Seedance 时正确格式被明令禁止 |
| D：UI 限死只能 H3 | 同上，且把「模型能力」问题错误地做成「产品限制」 |
| 双写三字段 + 单串 | 两份真相，写哪份、读哪份都要再定一次规则；漂移不可检测 |
| 加格式版本位 | 只会在下一个版本再问一次「这个位还准不准」；本轮没有灰度需求 |
| 把换算扩到五家 | 代码只对 freevideo 换算；本轮扩会同时改 wire、providers、校验器，超出「兼容规范」范围，另立需求 |
| 只按 `providerId` 判格式 | 五家共用一个 H3，会把同一模型判成五种格式；t3 的理由倒置 |
| 只按 `modelId` 判能力 | 五家的参考上限、mode、时长不同；会写出该供应商不支持的参数 |
| 保留两份 `mtrackProject` + 注释同步 | 编译器抓不住；本次改的正是类型形状 |
| 继续三字段 + 三框 UI | 与「单字段、格式不绑供应商」直接冲突；且每加一个供应商就多一组字段语义 |

---

## 7. 验收与自检（供实施后核对）

1. **单源**：`subject_definitions` 只出现在 H3 格式卡与 DSH 的 H3 格式卡；`integratedMultimodalDescription` 只出现在读兼容函数与三字段数据说明；默认模型口径只在 `videoProduction.md` §0.1 有一张表，其余是指针。
2. **无双花括号字面量**：用脚本匹配连续两个左花括号字符（码位 123、123），全仓 0 处；正文用「旧REF占位标记」指代。
3. **无时间叙事**：技能与 DSH 文本不出现以版本先后为轴的措辞（清单见 `promptCompatDelta.md` 的 C 类）；需要表达先后时用条件句（「当工程模型为 X 时」）。
4. **数据形状**：真实 200 镜工程迁移后 `prompt` 为 string、无字符索引键、声音段在正文内、备份存在；改造前构建读新文件为空的行为已知并写进发布说明。
5. **派工一致性**：抽 3 个非空改造前工程镜头，比较改造前 `buildPrompt` 输出与改造后「读归一 + 纯透传」输出，逐字一致。
6. **校验器口径**：600 → 200 的逐规则表随发布说明给出；有内容的 H3 工程能看到段级 warning。
7. **运行时**：`data/skills` 与仓库技能 sha256 一致；DSH 9 文件与仓库 H3 卡同源；MCP 工具描述已是单串。
