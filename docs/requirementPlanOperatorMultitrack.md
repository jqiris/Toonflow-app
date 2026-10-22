# planOperator 多轨全权能力契约（需求冻结稿）

> 状态：**冻结**。本文是 `packages/tools/planOperator` 对多轨工程（`plan/story.mtrack`）读写与派工能力的可执行规格。下游实现按本文逐条落地，本文不含实现代码（z schema 与 rule 表为契约形状，非实现）。
>
> 冻结范围：`docs/requirementPlanOperatorMultitrack.md`。禁止改动 `packages/`、`apps/`。

## 0. 现状盘点（契约的约束来源）

| 现状 | 位置 | 对契约的约束 |
|---|---|---|
| `action: z.enum(["parse","resolve","validate","build"])` | `packages/tools/planOperator/src/index.ts:66` | 新增 4 个 action 并入同一枚举 |
| `requestSchema` 为 `.strict()` | `index.ts:75` | 新增字段只能「可选追加」，不能改变既有字段语义 |
| `mtrackSchema` 是 `.strict()` 且只含 `global{ratio,resolution}` + `clips`（clipSchema 缺 `title/sourceRange/attempts/notes`，global 缺 `style/systemPrompt/model`，顶层缺 `version/projectId/updatedAt`） | `index.ts:12-33` | 真实编辑器写出的 `story.mtrack` 会被现有 `mtrackSchema` 拒绝；新 action 必须改用 `mtrackProject.ts` 的全量容错归一，见 §3 |
| `indexStore.writeText` 用 `files.writeFile`（**非原子**） | `packages/tools/planOperator/src/indexStore.ts:20-22` | `mtrackUpdate` 必须新增 `writeAtomic` 写入路径，不得复用 `writeText` |
| `promptGuidelines` 明写「本工具…不连接画布节点、不调用供应商」 | `index.ts:106` | `assemble` 因此定为「产出计划、由 agent 执行」，见 §6 |
| `executionMode: "sequential"` | `index.ts:109` | 工具内同步循环必然超时，`dispatch` 只出清单不执行生成，见 §5 |
| 校验器只实现 V1/V2/V4/V8/V9/V11/V12/V13/V14/V15，**全文无任何 `{{ref` 匹配** | `packages/tools/planOperator/src/planValidator.ts`（全文 242 行） | V7 未实现，需按 §7 定死语义 |
| readme 把 V7 标为「—（`{{ref N}}` 在 1..refs 范围内且每个 N 至少出现一次，由画布快照核对）」 | `packages/tools/planOperator/readme.md:43` | V7 的权威口径 |
| 多轨字段与枚举全量定义 | `packages/ext/multitrack/src/mtrackProject.ts` | 所有字段名、枚举值以该文件为准 |
| 首镜实跑 738.5s（15s 单块 / RTX 3090 / quality light） | `packages/skills/assetCard/references/generationRunbook.md:186` | `dispatch` 只出清单的硬事实依据 |

## 1. 总原则（为什么这样切）

1. **planOperator 只做「算」与「派生文件/工程回写」，不做「生成」与「画布落盘」**。生成归画布 `nodeTools`（`node:generateVideo`），画布节点增删归画布工具（`addNodes/connectNodes`）。planOperator 的边界来自 `index.ts:106` 的既有约束，不打破。
2. **读要容错，写要严格**：读（`mtrackRead/dispatch/assemble`）用 `mtrackProject.ts:130 normalizeProject` 的容错口径，真实文件缺字段也能读；写（`mtrackUpdate`）只允许补丁四个生成回写字段，其余字段「逐字保留」，不允许经过会丢字段的 schema 重序列化。
3. **单一写入者 + 乐观并发**：`story.mtrack` 的真源字段归多轨编辑器/对话所有；planOperator 只回写生成侧四个字段，且用 `updatedAt` 做 compare-and-swap（CAS），避免与编辑器互覆。规则见 §4.3。
4. **新 action 命名不缩写、语义单一**：`mtrackRead`（读）/ `mtrackUpdate`（原子回写）/ `dispatch`（出派工清单）/ `assemble`（出装配计划）。「读」与「派工」分开，因为读是范围查询、派工是逐镜展开成可执行清单。

## 2. 新增 action 枚举

```
action: z.enum(["parse","resolve","validate","build","mtrackRead","mtrackUpdate","dispatch","assemble"])
```

- `mtrackRead` / `dispatch` / `assemble`：只读，不受 `allowBuild` 限制。
- `mtrackUpdate`：写入工程文件，受 `allowBuild` 限制；`allowBuild=false` 时报错「mtrackUpdate 不可用：allowBuild 已关闭」。

`requestSchema` 保持 `.strict()`，新增字段全部 `optional`（既有 parse/resolve/validate/build 调用不传新字段仍通过；`.strict()` 只拒绝未知键，不拒绝缺失键）。各 action 的必填性由运行时显式校验（与现状 `index.ts:118` 的 `parse 需要 markdown` 同风格），错误文案见各节。

---

## 3. `mtrackRead` 契约

### 3.1 action 名与参数形状

```
{
  action: z.literal("mtrackRead"),
  path: z.string().default("plan/story.mtrack").describe("工作区相对路径"),
  from: z.string().regex(/^S\d{3}$/).describe("起始 clipId，含端点，如 S001"),
  to:   z.string().regex(/^S\d{3}$/).describe("结束 clipId，含端点，如 S003"),
}
```

- 范围写法为**含端点**的 `[from, to]`，按文件内 `clips` 的**出现顺序**截取，不做编号排序（保持磁盘原始顺序，避免隐式重排破坏编辑器的 order 语义）。
- `from`/`to` 只允许 `S001`..`S999` 三段式编号（与 `mtrackProject.ts:166 nextClipId` 与 V11 的 `S\d{3}` 一致）。
- 缺省 `from`/`to`：`from` 默认 `S001`，`to` 默认取最后一个 clip 的 clipId（即「读全部」）。仅传 `from` 不传 `to` 时 `to=from`（读单镜）。

### 3.2 返回形状

```
{
  path: string,                 // 实际读取的路径
  updatedAt: string,            // 工程 updatedAt（ISO），供 dispatch/mtrackUpdate 做 CAS 参照
  version: number | undefined,
  projectId: string | undefined,
  global: { ratio?, style?, systemPrompt?, model? },
  clips: MtrackClip[],          // [from,to] 范围内、含端点，按文件顺序；每项为 mtrackProject.ts 全量字段
  missing: string[],            // 范围内在文件中不存在的 clipId（未命中清单）
}
```

`clips[]` 每项返回 `mtrackProject.ts:23-39 MtrackClip` 全量字段：`clipId, title, sourceRange?, seconds, ratio, resolution, generateAudio, prompt{integratedMultimodalDescription, overallSoundscape, nonDiegeticMusic}, referenceIds, continuity, status, nodeId, assetPath, attempts[{at,nodeId,status,error?}], notes?`。不裁剪字段（clip 体积小，裁剪引入的不确定性大于收益）。

### 3.3 错误触发条件与文案要点

| 触发条件 | 行为 | 文案要点 |
|---|---|---|
| 文件不存在 | 抛错 | `mtrackRead 失败：多轨工程不存在（{path}）` |
| 文件损坏 / JSON 解析失败 | 抛错 | `mtrackRead 失败：多轨工程不是合法 JSON（{path}）：{parse 原因}` |
| `from`/`to` 格式非法 | z 校验拒绝 | 沿用 z 的 regex 报错（`from/to 需为 S001 形式`） |
| `from` 的编号 > `to` 的编号 | 抛错 | `mtrackRead 失败：起始分镜号 {from} 不得晚于结束分镜号 {to}` |
| `from`/`to` 之一不存在 | **不整体报错** | 命中部分正常返回，未命中的 clipId 进 `missing[]`；`missing` 非空时在 `content` 文本里附一行 `未命中分镜：{...}`（agent 据此区分「文件坏」与「某镜缺失」，不把它当硬失败） |

### 3.4 为什么这样切

- 读用 `normalizeProject` 容错、写严格——因为读取面向「残缺但可用的工程」（编辑器可能还没写完某镜的某字段），而写入的破坏性要求「不许丢字段」。
- `missing` 数组而非抛错——范围查询常见「目标镜还没建」，这是可恢复的缺数据，不是文件错误；让 agent 自行决定是否补建。

---

## 4. `mtrackUpdate` 契约

### 4.1 action 名与参数形状

```
{
  action: z.literal("mtrackUpdate"),
  path: z.string().default("plan/story.mtrack"),
  expectedUpdatedAt: z.string().optional().describe(
    "乐观并发基线：调用方上次读到的工程 updatedAt。提供时执行 CAS；不提供则跳过冲突检查（仍原子写）。"),
  updates: z.array(
    z.object({
      clipId: z.string().regex(/^S\d{3}$/),
      status: z.enum(["pending","generating","generated","accepted","failed"]).optional(),
      nodeId: z.string().nullable().optional(),
      assetPath: z.string().nullable().optional(),
      attempts: z.array(
        z.object({
          at: z.string().describe("ISO 8601 时间戳"),
          nodeId: z.string().nullable(),
          status: z.string().describe("ClipStatus 取值或 \"cancelled\""),
          error: z.string().optional(),
        })
      ).optional(),
    }).strict()
  ).min(1).max(500),
}
```

### 4.2 可写字段 / 禁写字段（必须明确）

**可写（生成回写四字段，仅此四者）**：`status`、`nodeId`、`assetPath`、`attempts`。

**禁写（真源字段，schema 内不出现、实现不得触碰）**：`clipId`（仅作定位键，不可改）、`title`、`sourceRange`、`seconds`、`ratio`、`resolution`、`generateAudio`、`prompt`（含 `integratedMultimodalDescription`/`overallSoundscape`/`nonDiegeticMusic` 三个子字段）、`referenceIds`、`continuity`、`notes`，以及顶层 `global`、`version`、`projectId`、`updatedAt`（`updatedAt` 仅由写入方统一刷新，不作为补丁字段）。

判定理由：`seconds/prompt/referenceIds/continuity/ratio/resolution/generateAudio` 是「一镜拍什么、怎么拍」的真源，归对话（分镜总稿）与多轨编辑器所有；生成回写只能更新「生成执行结果」——状态、产物路径、生成节点、尝试记录。若放开 `seconds/prompt/referenceIds` 可写，agent 就会在回写阶段改写真源，与编辑器/对话产生二义性冲突，也破坏 V11/V12/V13 的「真源完整性」校验前提。

`attempts` 整数组替换（不是追加合并）：调用方给的就是该 clip 新的完整 attempts 序列，避免「部分合并」引入的删除歧义。`attempts[].status` 用 `z.string()`（对齐 `mtrackProject.ts:19` 的 `status: string`），允许 `"cancelled"`（批量取消记账需要，见桥契约）。

### 4.3 原子性与并发规则（谁赢）

**原子性**：写入必须走 `writeAtomic` 语义（覆盖保存完整工程 JSON，符合 AGENTS.md「覆盖保存 JSON…显式使用 `writeAtomic`」）。现状 `indexStore.ts:20-22` 的 `files.writeFile` 是裸写，`mtrackUpdate` **不得复用**，须新增经 `@toonflow/file` 的 `writeAtomic` 路径。

**并发事实（两套写路径）**：

1. 多轨编辑器（`packages/ext/multitrack/src/index.vue`）：字段改动 → `dirty` → 800ms 防抖（`:250-253`）→ `saveProject`（`:142-164`），其内部做 **read-compare-write on `updatedAt`**：读盘 `updatedAt` 与内存 `lastSaved.updatedAt` 不一致就中止并置冲突提示，不覆盖。
2. 宿主文档会话 `documentSession.ts:44` 的 400ms 防抖走 `updateText` → `writeTextSnapshot`（revision + 409 `ESTALE`）。**多轨 ext 不走这条**——它在 `index.vue:255` 用 `props.context.flushSave = saveProject` 覆盖了 flush 钩子。故 400ms 防抖对 `story.mtrack` 不生效，真正生效的是多轨自己的 800ms 防抖 + `updatedAt` CAS。

**胜出规则（两者统一到 `updatedAt` 乐观并发）**：

- 任何一方写入前都执行：读盘当前 `updatedAt`，与「自己上次读取/保存时基于的 `updatedAt`」比对。
- 不一致 → **禁止盲覆盖**：编辑器弹冲突（不写）；`mtrackUpdate` 抛错 `mtrackUpdate 冲突：多轨工程已被其他操作修改（expected {a}，实际 {b}），请重新读取后重派`。
- 一致 → 写 `updatedAt = now` 后原子落盘。
- 结论：**last-writer-wins-on-version；版本过期者重读重试，不得用旧快照整体覆盖新内容**。

**mtrackUpdate 的冲突面最小化**：实现必须「读全量工程 → 仅 patch 命中 clip 的四字段 → 刷新 `updatedAt` → CAS → `writeAtomic`」。因为只 patch 四字段且先读最新盘，即使与编辑器并发，也不会抹掉编辑器对 `prompt/seconds/referenceIds` 的修改（只要 CAS 通过）。CAS 失败即整体不写，让 agent 重读重派，代价是重试而非数据损坏。

**边界**：`expectedUpdatedAt` 缺省时不做 CAS（仍原子写，但不防并发）。契约要求调用方（agent）**总是**从 `mtrackRead` 的返回值携带 `updatedAt` 作为 `expectedUpdatedAt`，把它变成强制纪律而非可选。

### 4.4 返回形状

```
{
  path: string,
  updatedAt: string,             // 写入后新的 updatedAt
  updated: string[],             // 成功更新的 clipId 列表（按 updates 顺序）
  missing: string[],             // updates 中在文件里不存在的 clipId（未写入，不整体失败）
}
```

### 4.5 错误触发条件与文案要点

| 触发条件 | 行为 | 文案要点 |
|---|---|---|
| `allowBuild=false` | 抛错 | `mtrackUpdate 不可用：allowBuild 已关闭` |
| 文件不存在 | 抛错 | `mtrackUpdate 失败：多轨工程不存在（{path}）` |
| 文件损坏 | 抛错 | `mtrackUpdate 失败：多轨工程不是合法 JSON（{path}）` |
| `updates` 为空 | z 校验拒绝 | `updates 至少 1 条` |
| `clipId` 格式非法 | z 校验拒绝 | `clipId 需为 S001 形式` |
| `status` 非法 | z 校验拒绝 | 枚举值错误（pending/generating/generated/accepted/failed） |
| 某 `clipId` 不存在 | **部分成功** | 未命中的进 `missing[]`，命中的照写；不整体回滚 |
| `expectedUpdatedAt` 与盘上不一致 | 抛错（不写） | 见 §4.3 冲突文案 |

---

## 5. `dispatch` 契约（只出清单，不执行生成）

### 5.1 action 名与参数形状

```
{
  action: z.literal("dispatch"),
  path: z.string().default("plan/story.mtrack"),
  from: z.string().regex(/^S\d{3}$/),
  to:   z.string().regex(/^S\d{3}$/),
  assetCardsPath: z.string().default("assets/assetCards.md").describe("资产卡 Markdown，用于补参考集合的 name/kind/prompt"),
  indexPath: z.string().default("plan/assetIndex.json").describe("referenceResolver 结算结果，用于参考集合与 nodeId"),
}
```

### 5.2 返回形状（每镜完整执行清单）

```
{
  path, from, to,
  generatedAt: string,          // ISO
  updatedAt: string,            // 工程 updatedAt（供 mtrackUpdate 做 expectedUpdatedAt）
  clips: [{
    clipId, seconds, ratio, resolution, generateAudio, continuity,
    status, nodeId, assetPath,
    prompt: { integratedMultimodalDescription, overallSoundscape, nonDiegeticMusic },
    referencePlan: [            // 按 clip.referenceIds 顺序展开
      { refId, kind, name, textOnly, nodeId }   // nodeId 来自 assetIndex（referenceResolver 结算的 card.nodeId）
    ],
    generationParams: {         // 生成参数要点（确定性部分）
      duration: seconds,        // 必须 = seconds，2–60 整数
      resolution, ratio, generateAudio,
      providerId: "待 node:getConfig 决定",
      modelId:    "待 node:getConfig 决定",
      mode:       "待 node:getConfig 读 matchingModes 决定（不得写死）"
    },
    promptEssentials: [         // 提示词要点
      "integratedMultimodalDescription 为画面主体（含 {{ref N}} 引用位）",
      "overallSoundscape 为环境声",
      "nonDiegeticMusic 为配乐",
      "段尾须附参考顺序声明（与 referenceIds 顺序一致）"
    ],
    currentState: {
      status, nodeId, assetPath,
      lastAttempt: { at, nodeId, status, error? } | null   // attempts 末条
    }
  }]
}
```

### 5.3 只出清单、不执行生成（硬理由）

- **实跑证明同步循环必然超时**：`generationRunbook.md:186` 记录首镜实跑提交时长 **738.5s（12.3 min）**（15s 单块 / RTX 3090 / quality light）。而 planOperator 是 `executionMode: "sequential"`（`index.ts:109`）的同步工具，若在工具内逐镜 `node:generateVideo` 同步等终态，1 镜即超时，2 镜必然失败。
- 且 `index.ts:106` 已明写「不执行任何生成」。`dispatch` 维持该边界：**只算清单、不写文件、不触发生成**。真正的生成由 agent 逐镜走画布 `nodeTools`（`node:setPrompt` → `node:setConfig` → `node:generateVideo` → `node:getGenerationStatus`），状态回写走 `mtrackUpdate`。

### 5.4 错误触发条件与文案要点

| 触发条件 | 行为 | 文案要点 |
|---|---|---|
| 文件不存在 / 损坏 | 抛错 | 同 `mtrackRead` 文案 |
| `from`/`to` 格式非法、倒序 | 抛错 | 同 `mtrackRead` 文案 |
| 范围内某 clipId 不存在 | 只出现在 `content` 的提示里，不产 clip 项 | `范围内未命中：{clipId}`（不整体失败） |
| 某 clip 的 `referenceIds` 引用在 assetIndex 缺失 | 在 `referencePlan` 该项标 `{ refId, kind:"未知", textOnly:false, nodeId:null }`，并在 content 附 warning | `参考结算缺 {refId}（建议先跑 resolve/build）` |

---

## 6. `assemble` 契约（产出装配计划，不直接操作画布）

### 6.1 action 名与参数形状

```
{
  action: z.literal("assemble"),
  path: z.string().default("plan/story.mtrack"),
  assetCardsPath: z.string().default("assets/assetCards.md"),
  indexPath: z.string().default("plan/assetIndex.json"),
  from: z.string().regex(/^S\d{3}$/).optional().describe("缺省 = 全部 clips"),
  to:   z.string().regex(/^S\d{3}$/).optional(),
}
```

### 6.2 决策：`assemble` 产出**计划**，不直接操作画布（理由）

1. `index.ts:106` 明写「本工具…不连接画布节点」。打破它必须有压倒性收益，而这里没有：装配计划的真正执行方是画布工具（`addNodes/connectNodes`）+ 节点 `nodeTools`，planOperator 即便拿到画布句柄也只是「转发」，白白把纯函数工具变成有副作用工具。
2. `ToolContext.canvas` 是**可选字段**（`packages/toolScaffold/src/runtime.ts:201`）。planOperator 在无画布上下文的会话（MCP/API/换会话）中运行时拿不到画布句柄，不能把「操作画布」写进 action 语义——否则该 action 在部分会话里必然空转。
3. 维持单一职责与可测试性：解析/结算/校验/计划全在 planOperator（纯算，可离线验证），画布落盘在 `nodeTools`（`generationRunbook.md` 的 SOP 路径）。装配计划的 node 类型映射与 `data` 字段由本文定死，agent 照单执行即可，无需 planOperator 感知画布运行时。

### 6.3 返回形状（装配计划）

```
{
  generatedAt: string,
  updatedAt: string,           // 工程 updatedAt
  layers: [                    // 拓扑分层：层号小的先装配；同层无相互依赖
    { layer: 0, items: [{ cardId, kind }] },
    ...
  ],
  assetNodes: [                // 每张资产卡一个画布节点计划，按层号+order 排序
    {
      cardId, kind, name, ratio, textOnly,
      layer: number,           // = 1 + max(其 refs 的层号)；无 ref 的卡 layer=0
      nodeType: string,        // 见 §6.4 映射表
      data: { label, prompt, ratio, ... },   // 见 §6.5 字段映射
      refs: [cardId],          // 本卡引用（referenceResolver 结算结果，backwards-only）
      edges: [ { fromNode: cardId, fromHandle, toNode: cardId(本卡), toHandle } ]
    }
  ],
  clipNodes: [                 // 每镜一个视频节点计划，clip 形成最末层
    {
      clipId, nodeType: "videoGenerationNode",
      data: { label, duration, resolution, ratio, generateAudio, ... },
      references: [cardId],    // = clip.referenceIds（保持顺序）
      edges: [ { fromNode, fromHandle, toNode: clipId, toHandle } ]  // 连线顺序 = referenceIds 顺序
    }
  ],
  connectOrder: string[]       // 全局连线顺序（先卡后 clip，卡内按 refs 顺序，clip 内按 referenceIds 顺序）
}
```

### 6.4 卡 kind → 画布节点类型映射

| 卡 kind（`assetCardParser.ts:8`） | 画布节点类型（`vite.config.ts` 的 `name`） |
|---|---|
| `character`（C） | `imageGenerationNode` |
| `scene`（SC） | `imageGenerationNode` |
| `prop`（P） | `imageGenerationNode` |
| `keyframe`（KF） | `imageGenerationNode` |
| `sound`（S） | `audioGenerationNode` |
| clip（每镜） | `videoGenerationNode` |

### 6.5 `data` 字段映射（只种确定性字段，模型/模式交给 `nodeTools`）

| 节点 | `data` 种子字段 | 来源 | 留给 `nodeTools` 的字段 |
|---|---|---|---|
| `imageGenerationNode` | `label`=name、`prompt`=AssetCard.prompt、`ratio`=AssetCard.ratio | `assetCardParser.ts:10-25` | `model`（`node:getConfig` 读能力后 `node:setConfig` 定，不写死）、`size` |
| `audioGenerationNode` | `label`=name、`prompt`=AssetCard.prompt（textOnly 卡以 `text` 承载文本） | 同上 | `model` |
| `videoGenerationNode` | `label`=clipId、`duration`=seconds、`resolution`、`ratio`、`generateAudio` | `mtrackProject.ts:23-39` | `model`、`mode`（必须 `node:getConfig` 读 `matchingModes` 后定，**不得写死「4 图就是多参考」**） |

连线顺序：卡内按 `card.refs` 顺序、clip 内按 `clip.referenceIds` 顺序；`{{ref N}}` 的 N 与该顺序一一对应（V7/V15 据此核对）。装配计划本身不写盘（纯算内联返回）；如需落盘由 agent 决定，路径建议 `plan/assemblePlan.json`，但不属于本 action 职责。

### 6.6 错误触发条件与文案要点

| 触发条件 | 行为 | 文案要点 |
|---|---|---|
| 文件不存在 / 损坏 | 抛错 | 同 `mtrackRead` 文案 |
| 资产卡解析出 `error` 级发现 | 抛错 | `assemble 被拒绝：资产卡仍有 error 级发现（{n} 条），先跑 validate 清零` |
| 某 clip 引用在 assetIndex 缺失 | 该引用在 `references` 标 `缺失`，不产 edge | `参考结算缺 {refId}` |
| `from`/`to` 倒序 | 抛错 | 同 `mtrackRead` 文案 |

---

## 7. V7 真正实现契约（补进 `validate`，非新 action）

### 7.1 现状为何判定为「未实现」

`planValidator.ts` 全文（242 行）只实现 V1/V2/V4/V8/V9/V11/V12/V13/V14/V15，**不存在任何匹配 `{{ref` 或 `ref \d+` 的正则/字符串代码**（V15 只比对 `referenceIds` 数组与画布 `referenceOrder` 的**顺序**，不解析提示词文本）。`readme.md:43` 把 V7 标为「—」，属「定义了但没实现」。故 V7 以未实现处理，实现时按本节语义落地。

### 7.2 扫描字段

V7 只扫 `MtrackClip.prompt` 的**三个子字段**文本（即分镜三字段，`multitrackTemplate.md` 的提示词载体）：

- `prompt.integratedMultimodalDescription`
- `prompt.overallSoundscape`
- `prompt.nonDiegeticMusic`

匹配模式：`/\{\{\s*ref\s+(\d+)\s*\}\}/gi`（大小写不敏感，容忍空白；`{{ref 2}}`、`{{ ref2 }}` 均命中）。三字段**合并**后的匹配集合参与判定（不区分 N 出现在哪个字段）。

### 7.3 N 上界来源与不一致行为

- **N 上界 = `clip.referenceIds.length`**（`{{ref N}}` 是对 `referenceIds` 的第 N 个元素的索引引用）。
- `snapshot.referenceOrder[nodeId]` **不参与定上界**，只承担「画布位次核对」职责；`referenceOrder` 缺失（节点尚未接线）时，V7 的文本范围校验仍可执行，画布核对部分跳过。
- `snapshot.referenceOrder` 与 `clip.referenceIds` 不一致（长度或顺序）时：**V7 不新增规则**，由既有 **V15**（`planValidator.ts:222-233`）报 `error`「referenceIds 顺序与画布节点实际参考顺序不一致」。V7 与 V15 的分工：V7 管「提示词里写了哪些 `{{ref N}}`」，V15 管「数组顺序与画布接线顺序是否一致」。

### 7.4 判定规则（rule 编号与 level）

| 规则 | level | 触发 | 文案要点 |
|---|---|---|---|
| **V7** | `error` | 存在 `{{ref N}}` 且 `N < 1` 或 `N > referenceIds.length`（越界） | `片段 {clipId} 提示词含越界引用 {{ref {N}}}，参考范围为 1..{refs.length}` |
| **V7** | `error` | 存在 `k ∈ [1..referenceIds.length]`，在三个字段的 `{{ref N}}` 集合中**一次都未出现**（缺失） | `片段 {clipId} 提示词未声明第 {k} 个参考 {{ref {k}}}（参考总数 {refs.length}）` |

**「每个 N 至少出现一次」≠「恰好每个」**：同一 N 允许重复出现（如多次强调同一素材），不违规；只查「上界内每个 N ≥ 1 次」且「不出现上界外 N」。

### 7.5 边界

- `referenceIds.length === 0` 的 clip：无 N 可查，若三字段仍出现 `{{ref N}}` 则按越界报 error（`参考范围为 1..0`），否则跳过 V7。
- `nodeId` 为空且 `status ∈ {generated, accepted}`：V13 已报 error（缺 nodeId），V7 的画布核对部分跳过，文本范围校验仍执行。
