# 多轨制作流水线方案（资产/分镜前置 → 统一多轨 → FreeVideo 逐分镜生成）

> 需求原文：「制作流程和 LocalStoryCanvas 一样，前期把所有资产和分镜格式确定下来，然后统一接入多轨，多轨界面可以参考 LocalStoryCanvas，然后里面每一个分镜生成使用 freevideo 来生成。」
>
> 输入：[LSC 多轨契约](localStoryCanvasMultitrackStudy.md)、[Toonflow 多轨可行性](toonflowMultitrackFeasibility.md)、[资产卡方案](assetCardWorkflowPlan.md)（P0–P2 定稿）、[资产卡方案审阅](assetCardWorkflowPlanReview.md)。
>
> **本文件不修改任何业务代码与配置。** 所有引用的仓库路径均已实测存在。
>
> **历史设计，勿作引导**：本文是多轨流水线方案的定稿记录，其中 `agentDispatch.ts`「agent 执行桥」「批量派工」与「派工意图送 agent 会话」等描述**已被直连实现取代**——实际链路是 `packages/nodeShared/src/mtrack/directDispatch.ts` 的 `beginDirectDispatch`，编辑器自己经画布 `nodeTools` 逐镜生成、不经对话模型；文中部分行号与字段口径也已漂移。现行口径只看 `packages/skills/assetCard/references/generationRunbook.md`（§十二、§十五、§十五·五）；本文仅作历史参考，不据此施工。

---

## 0. 一页结论

```
① 资产定稿            ② 分镜定稿           ③ 统一接入多轨        ④ 逐分镜生成        ⑤ 验收/合成
assets/assetCards.md → plan/storyboard.md → plan/story.mtrack → 每镜一个视频节点 → 交付
   C/SC/P/KF 编号        段头+三字段提示词      唯一真源(编辑器可视)     FreeVideo MiniMax-H3
```

| 层 | 容器 | 职责 | 不做什么 |
|---|---|---|---|
| 契约层 | 技能 `packages/skills/assetCard` | 编号规则、接线规则、多轨模板、段头语法 | 不执行任何生成 |
| **编辑器层** | 扩展 `packages/ext/multitrack`（`resourceKind:"file"`，绑定 `.mtrack`） | 轨道渲染、片段增删排序、每镜三字段提示词、参考顺序、状态回显、视频 URL 预览 | **不调节点、不发请求、不合成** |
| 校验/派工层 | 工具 `packages/tools/planOperator` | 解析、校验 V1–V16、输出派工单 | 不自动执行生成 |
| 执行层 | Agent + 画布工具 + 节点函数 | `addNode→connectNodes→setConfig→setPrompt→generateVideo` | 不发明契约 |
| 合成层 | 工具 `planOperator` 的 `composite`（经宿主 ffmpeg；亦可直接用 `ffmpeg` 工具或节点内 `useNodeFfmpeg`） | 按 `story.mtrack` 中 `accepted` 镜的顺序 concat，先写 `plan/composite.json` 清单 | 不做剪辑特效 |

**核心设计**：`plan/story.mtrack` 是**唯一真源**；编辑器改它、工具校验它、Agent 读它执行、状态回写它。节点只是执行载体，画布 JSON 不存业务语义。

> 扩展名说明：宿主按文件名「最后一段点后缀」关联扩展（`path.split(".").at(-1)`），且 `defineExt` 要求后缀不带点。若命名为 `story.mtrack.json`，后缀会被识别为 `json`、与工作区所有 `.json` 文件撞车；因此工程文件定为 `plan/story.mtrack`（内容为 JSON，自定义 `.mtrack` 后缀）。`extensions: ["mtrack"]` 通过 `defineExt` 的 `/^[a-z0-9]+$/` 校验并与宿主匹配链对上。

---

## 1. 端到端流水线

| 阶段 | 产物 | 确认关口 | 失败回退 |
|---|---|---|---|
| 0 需求与简报 | 文本节点：题材/时长/画幅/风格/声音 | 用户确认简报 | 只改文本 |
| 1 完整剧本 | `plan/script.md` | 用户确认剧本 | 只改文本 |
| 2 资产定稿 | `assets/assetCards.md`（C/SC/P/KF/S 编号）+ `plan/assetIndex.json` | 用户确认资产矩阵 | 改卡片，索引重生成 |
| 3 分镜定稿 | `plan/storyboard.md`（段头 + 每段三字段 + 参考编号） | 用户确认分镜表 | 改分镜，多轨重导入 |
| 4 统一接入多轨 | `plan/story.mtrack`（权威） | 用户在编辑器里检查并确认 | 多轨整份重生成 |
| 5 逐分镜生成 | 每个 clip 的 `nodeId` / `assetPath` / `status` | **每次生成前**确认算力 | 单镜重生成，不动其他镜 |
| 6 验收与合成 | `plan/composite.json` + 成片 | 用户验收成片 | 重新合成 |

> **现状更新（2026-10-25）**：阶段 2→4 由画布「导入资产与分镜」节点（`packages/nodes/assetImportNode`）承接——接入剧本文本后抽取资产卡与分镜、批量出资产图并建图片节点、写 `plan/assetIndex.json` 与 `plan/story.mtrack`；随后把资产节点连到多轨节点 `in` 端口，在多轨「参考素材」里只从连线上打勾（同媒质位次即 `<Picture N>` / `<Video N>` / `<Audio N>`，见 `docs/h3PromptAlignment.md`）。下文 `planOperator assemble` 的「资产接入三步」只用于已有工程补接，不再是新项目主入口。

**关口铁律**（继承 LSC 与 Toonflow 既有纪律）：
- 确认简报 ≠ 确认剧本；确认资产 ≠ 验收生成结果；一个小样 ≠ 授权整批。
- 生成前展示：模型、数量、时长、分辨率、参考、费用（FreeVideo 显示「免费 · 本机 GPU」），等明确同意。
- 任务「已提交」≠「已完成」，必须用 `getGenerationStatus` 查终态。

---

## 2. 多轨工程契约（核心）

### 2.1 文件与边界

```text
<workspace>/
├── assets/assetCards.md          # 资产唯一真源（P0/P1）
├── plan/
│   ├── script.md                 # 剧本
│   ├── storyboard.md             # 分镜稿（段头语法）
│   ├── assetIndex.json           # 资产索引（P1）
│   ├── story.mtrack               # ★ 多轨工程，唯一真源（JSON 内容，自定义 mtrack 扩展名）
│   ├── assetReport.json          # 校验报告
│   └── composite.json            # 合成清单
└── assets/<nodeId>/              # 节点生成落点（既有行为）
```

- 写入统一走 `context.files`（工具）或 `ExtFiles`（扩展），不直接调 `node:fs` / `Bun.write`。
- 多轨工程**只由扩展和工具写**，Agent 不手改（人工手改视为草案，下次校验会被指出）。

### 2.2 完整 schema

```jsonc
{
  "version": 1,
  "projectId": "nanKe",
  "updatedAt": "2026-10-19T10:00:00+08:00",
  "global": {
    "ratio": "9:16",
    "style": "写实电影质感，自然光，胶片颗粒",
    "systemPrompt": "…（可选：全片规则，渲染时拼到画面正文开头（段首），不新增段落标题）",
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
        "subjectDefinitions": "<Picture 1> 是角色A（槐下饮酒者），<Picture 2> 是槐树与庭院，<Picture 3> 是酒碗与酒杯",
        "summary": "黄昏，广陵宅南古槐下，角色A与友人围坐饮酒，气氛松弛。",
        "retentionAnalysis": "保留人物面部、酒碗形制与庭院空间结构，允许衣物细节微调。",
        "detailedDescription": "[Shot 1] 黄昏广陵宅南古槐下，<Picture 1> 侧身而坐，手中举着 <Picture 3> 中的酒碗…",
        "overallSoundscape": "蝉鸣、风吹槐叶、酒碗碰撞",
        "nonDiegeticMusic": "低沉古筝与箫声"
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

### 2.3 字段表

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `clipId` | string | ✅ | `^S\d{3}$` 唯一 | 段落 ID，对应 LSC 的段号 |
| `title` | string | ✅ | 1–120 | 显示名 |
| `seconds` | number | ✅ | **整数 2–60** | MiniMax-H3 逐秒支持；超范围报错 |
| `ratio` | string | ✅ | `9:16`/`16:9`/`1:1`/`4:3`/`3:4` | 与 global 不同则覆盖 |
| `resolution` | string | ✅ | `768P`/`2K` | 来自 `durationResolutionMap` |
| `generateAudio` | boolean | ✅ | — | H3 `audio: "optional"`；freevideo 侧只透传不消费，**apiMart / tfRouter / compshare 会消费**（下发为 `generate_audio`） |
| `prompt.subjectDefinitions` | string | ✅ | 非空 | H3 六段第 1 段：主体定义，用 `<Picture N>` / `<Video N>` / `<Audio N>` 标记指位 |
| `prompt.summary` | string | ✅ | 非空 | H3 六段第 2 段：一句话概括全镜 |
| `prompt.retentionAnalysis` | string | ✅ | 非空 | H3 六段第 3 段：分析哪些参考应被保留、哪些可变 |
| `prompt.detailedDescription` | string | ✅ | 非空 | H3 六段第 4 段：详细画面/动作/对白（`[Shot N]` 起，含 `<Picture N>` 指位） |
| `prompt.overallSoundscape` | string | ✅ | 可 `N/A` | H3 六段第 5 段：环境声与动作声 |
| `prompt.nonDiegeticMusic` | string | ✅ | 可 `N/A` | H3 六段第 6 段：配乐 |
| `referenceIds` | string[] | ✅ | **校验器 V8 拦图片 ≤9、音频 ≤1**（常量 `MAX_IMAGE_REFERENCES` / `MAX_AUDIO_REFERENCES`，见 `packages/tools/planOperator/src/planValidator.ts`）——**视频参考与图片同桶计数**，所以「视频 ≤1」只是供应商模式声明，不是校验器拦的；**供应商模式声明与多轨界面勾选还另外都只有 4**（`packages/providers/src/media/freevideo.ts` 的 `imageReference:4`、`packages/nodeShared/src/mtrack/components/referencePicker.vue` 的勾选上限）——超 4 张是产品侧挡下、不是校验器；承接镜（`context`）参考合计 ≤3（V16）；≥30 秒自动分块时引擎实限 3 张；同媒质顺序即 `<Picture N>` / `<Video N>` / `<Audio N>`（见 `docs/h3PromptAlignment.md`） | 资产卡编号 |
| `continuity` | enum | ✅ | `shot`（独立起拍/切镜）/`context`（承接上一镜） | 首段必须 `shot`；`context` 另受 V16 约束（参考合计 ≤3、时长 ≥10 秒）。旧工程的 `start`/`cut` 归一为 `shot`、`continue` 归一为 `context`（`normalizeContinuity`） |
| `status` | enum | ✅ | `pending`/`generating`/`generated`/`accepted`/`failed` | 状态机见 §2.4 |
| `nodeId` | string\|null | ✅ | 画布节点通道生成后必有；服务端媒体任务通道恒为 `null` | 视频节点 ID（媒体任务通道不建节点） |
| `assetPath` | string\|null | ✅ | 工作区相对路径 | 产出视频 |
| `attempts` | object[] | ✅ | 追加写 | `{ at, nodeId, status, error?, jobId?, assetPath?, signature?, index?, parentJobId? }`；`jobId` 只有成功那次尝试才有值（承接镜靠它续接），`assetPath` 是历史版本的身份，后三项为后续新增、旧工程可缺 |

### 2.4 状态机

```
pending ──生成提交──> generating ──成功──> generated ──用户验收──> accepted
   ↑                       │                                        │
   └────失败可重试──────────┴──失败──> failed ──重试──> generating    └─改需求→ pending
```

- `generated` 不等于交付完成；`accepted` 才进入合成清单。
- 重生成：保留旧 `assetPath` 到 `attempts`，`status` 回 `pending`，同一 `clipId` 复用自己的 `nodeId`。

### 2.5 参考顺序 = 编号协议

`referenceIds` 数组顺序即画布引用位次，它决定 MiniMax H3 官方标记的编号基数（`<Picture N>` 只数图片类、`<Audio N>` 只数音频、`<Video N>` 只数视频，各自从 1 起；混入 `kind: "sound"` 音频卡时位次 ≠ Picture 序号）：

```text
referenceIds: ["C01", "C03", "C05", "SC02"]   ← 全是图片时位次恰好等于 Picture 序号
              ↓        ↓        ↓       ↓
        <Picture 1> <Picture 2> <Picture 3> <Picture 4>
```

- Toonflow 侧实际顺序由 `data.referenceOrder`（键 `encodeURIComponent(JSON.stringify([source,sourceHandle]))`）+ 入边顺序决定，**必须逐一核对**；
- **六段由写作者直接写**：接了参考图就按 MiniMax H3 官方 ref2va 六段书写（`subject_definitions:` / `summary:` / `retention_analysis:` / `detailed_description:`），引擎只拼「全片风格 / 全片约束」前缀、正文原样透传，不代写任何一段；参考标记**直接写** `<Picture N>` / `<Video N>` / `<Audio N>`（各媒质独立编号），不再使用旧双花括号占位符，也不再有 wire 层换算通道；
- **参考形貌必写**：官方 `ref-en.txt` §0/§5.3 要求 detailed_description 尽可能详细，被引用资产首次出现处要写「被引用特征 + 画面位置 + 当前动作」（旧版「写了引用就不描述外貌」的素材排他说法已废弃）。
- **H3 对齐权威口径**：六段段名、顺序、退化三段、参考标记写法与 V7 校验规则见 `docs/h3PromptAlignment.md`。

---

## 3. 界面方案（扩展 `ext-multitrack`）

### 3.1 定位（由可行性结论决定）

| 能做 | 不能做 |
|---|---|
| 读 `plan/story.mtrack` 渲染轨道 | 读取/修改画布节点 `data` |
| 增删片段、改时长/提示词/参考/衔接 | 调用 `connectNodes` / `nodeTools` |
| 写回文件（`files.writeJson`） | 直接调用 `/api/ffmpeg/execute` |
| 展示校验报告与生成状态 | 替用户批准算力消耗 |
| 经宿主 `acquireUrl` 预览该镜视频文件 | 触发任何生成 |

### 3.2 布局（参照 LSC，去掉 LSC 专属项）

```text
┌─ 多轨 · 南柯一梦 ──────────────────────────────────┐
│ 12 镜 / 96 秒    [＋ 添加片段]  [校验]  [导出清单]   │
├──────────────────────────────────────────────────┤
│ ▓ S001 槐下饮酒   ▓ S002 入梦  ▓ S003 驸马殿 …     │  ← 宽度 = seconds×系数
│   0.00–8.00秒      8.00–16.0秒                     │
├──────────────────────────────────────────────────┤
│ 选中 S001 · 8 秒 · 768P · 9:16 · 含声音            │
│ 标题 [槐下饮酒          ]  时长 [  8] 秒           │
│ 衔接 [shot ▾]    参考 [C01][C03][C05][SC02] +     │
│ ┌ 画面 / 动作 / 对白 ───────────────────────────┐ │
│ │ [Shot 1] 黄昏广陵宅南古槐下…                   │ │
│ └───────────────────────────────────────────────┘ │
│ ┌ 环境声 ──────────────┐ ┌ 配乐 ─────────────────┐│
│ └──────────────────────┘ └───────────────────────┘│
│ 状态：待生成 · 节点：—        [复制] [前移] [后移] [删除] │
└──────────────────────────────────────────────────┘
```

### 3.3 组件划分

```text
packages/ext/multitrack/
  src/
    metadata.ts        # id: "ext-multitrack", extensions: ["mtrack"], resourceKind: "file"
    index.ts           # defineExt
    index.vue          # 容器：加载工程、保存、分发
    components/
      trackBar.vue     # 轨道与片段条（宽度正比、选中态）
      clipEditor.vue   # 选中片段的字段编辑（三字段提示词）
      referenceList.vue# 参考顺序展示与增删
      statusPanel.vue  # 校验结果 + 生成状态 + 视频预览（acquireUrl）
```

### 3.4 状态与保存

- **单一写者**：只有编辑器写 `story.mtrack`；工具只在 `build` 时写派生文件。
- **保存时机**：字段失焦即 `files.writeJson`，并显示「已保存 · 时间」；`dirty` 时标题加 `*`。
- **冲突**：写入前比对 `updatedAt`，不一致提示「文件已被其他操作修改，请重新加载」，不静默覆盖。
- **快照提示**（照抄 LSC 文案）：「生成任务按提交时的快照运行，此处修改只影响下次生成。」

---

## 4. 生成执行（逐分镜 FreeVideo）

### 4.1 单镜调用序列

```text
1) 校验该镜（V1–V16），失败即停，不创建节点
2) addNode({ type: <视频生成节点类型>, position, label: "场01·片段01·视频" })
3) connectNodes：资产图节点 → 视频节点 in 端口（按 referenceIds 顺序）
4) getCanvasNodes({ fields:["ports"], dataKeys:["referenceOrder","mode","model"] }) 核对顺序
5) node:getConfig  → 确认可用 mode 与 duration
6) node:setConfig({ providerId:"freevideo", modelId:"MiniMax-H3",
                    duration:<seconds>, resolution:<768P|2K>, ratio, generateAudio, mode })
7) node:setPrompt({ prompt: <写作者已写好的官方六段，参考写 <Picture N>/<Video N>/<Audio N>；引擎只拼全片风格/全片约束前缀、正文原样透传> })
8) 展示生成方案并等待用户批准
9) node:generateVideo({})
10) 同一轮内用 node:getGenerationStatus 查终态；**跨轮/换会话前必须先用 getCanvasNodes 读该节点 outputs 确认已产出**，不能凭状态字段判断（见 §4.6）
11) 成功 → 写回 status=generated、nodeId、assetPath；失败 → status=failed、attempts 追加
```

### 4.2 参数规则（来自 `freevideo.ts` 实测）

| 项 | 规则 |
|---|---|
| 模型 | `providerId: "freevideo"`，`modelId: "MiniMax-H3"` |
| 时长 | **整数 2–60 秒**；多轨 `seconds` 必须落在这个集合 |
| 分辨率 | `768P` / `2K` |
| 声音 | `audio: "optional"` → `generateAudio` 可切换；freevideo 只把它透传给引擎，**apiMart / tfRouter / compshare 会消费**（下发为 `generate_audio`，tfRouter 另映射 `sound: "on"/"off"`） |
| 模式 | `text` / `startFrameOptional` / `["imageReference:4","videoReference:1","audioReference:1"]` |
| 参考上限 | **校验器 V8 拦图片 ≤9、音频 ≤1**（视频参考与图片同桶计数）；**供应商模式声明是「图 ≤4、视频 ≤1、音频 ≤1」**（`mode` 里的 `imageReference:4` / `videoReference:1` / `audioReference:1`，见 `packages/providers/src/media/freevideo.ts`），多轨界面勾选也按 4 挡——超 4 张会被逼到 `startFrameOptional`（仅 2 图且变首尾帧）；承接镜（`context`）参考合计 ≤3（V16），≥30 秒自动分块时引擎实限 3 张 |
| 费用 | `getPrice()` = 「免费 · 本机 GPU 生成，无计费」 |

### 4.3 模式判定铁律

不得写死「4 图就是多参考」：必须调 `node:getConfig` 读 `matchingModes`，按**当前实际参考集合**（含文本/空端口）选模式。空镜段或混入视频参考时，模式集合会收缩——这也是 V10 存在的原因。

### 4.4 承接上一镜（`continuity: "context"`）

LSC 用尾帧 latent 续写；本仓库不自己截帧，走引擎官方的续接口径：

- 取上一镜**成功那次尝试的 `jobId`**（续接解析只认最后一条 `succeeded` 且带 `jobId` 的 attempt），随请求下发 `continue_from: { from_job }`（`packages/providers/src/media/freevideo.ts`），由引擎按上一镜的原生上下文续拍；
- 续接时引擎只接受 `media.references`，首/尾帧必须为空（`freevideo.ts` 的 `continuing` 分支）；参考图照常生效，**续接不占媒体槽**（`packages/nodeShared/src/mtrack/mediaDispatch.ts`）；
- 受 V16 约束：参考素材合计 ≤3、时长 ≥10 秒；拿不到上一镜可用 `jobId` 时**直接报错**，不静默降级；
- 首帧模式（`startFrameOptional`）是另一条路径：仅在 `resolveClipMode(clip)` 为 `image`、逐镜 `continuity` 不是 `context`、且只有 1 张图片参考时下发 `firstFrame`（`mediaDispatch.ts`），与 `context` 互斥。

### 4.5 批量执行

- 同一时刻只跑 1–2 个生成任务（本机 GPU 串行更稳）；`node:dispatchGenerate` 按 `clips` 顺序**逐个**执行，上一镜出结果才开始下一镜；
- 每镜独立 `status`；但承接镜依赖上一镜的任务号——上一镜失败时它的 `context` 会报「上一镜没有可用的生成任务号」并跳过，修好上一镜后用 `node:resumeBatch` 续跑该镜；
- 不在生成中改多轨文件（快照语义），改完需重新提交该镜。

### 4.6 状态查询的真实能力（实测修正）

`node:getGenerationStatus` 定义在 `packages/nodeShared/src/useNodeGeneration.ts:11-16`，实测语义：

| status | 含义 | 可否作为交付依据 |
|---|---|---|
| `idle` | 本次打开节点后未发起生成 | **否**（`idle` 不表示没有历史输出） |
| `running` | 生成中 | 否 |
| `succeeded` | 本次生成成功 | 是，仍需读 outputs |
| `failed` | 失败，`error` 给出原因 | 否 |

配套能力：`node:cancelGeneration` 只**请求**停止，不保证供应商撤销或退费。

**由此产生的三条纪律**：
1. **提交 ≠ 完成**：`generateVideo` 立即返回，本轮内用 `getGenerationStatus` 追终态；
2. **换会话/换轮后必须读产物**：用 `getCanvasNodes({ fields:["outputs"] })` 确认该节点已有新媒体，**不能用 `idle` 推断未生成**；
3. **回写状态前必须可读**：`assetPath` 必须指向一个真正可读取的文件，否则该镜只能标 `failed` + `error: 未找到产出`。

---

## 5. 校验规则（V1–V16）

| 编号 | 规则 | 级别 | 归属 |
|---|---|---|---|
| V1–V9 | 资产卡编号/接线既有规则 | 错误/警告 | 复用 `assetCardWorkflowPlan.md` |
| V10 | 节点 `data.mode` 仍属该模型匹配集合 | 错误 | 既有 |
| **V11** | 多轨结构完整：`clipId` 唯一、必填字段齐全、`status` 合法 | 错误 | 新增 |
| **V12** | `seconds` 是 2–60 整数；`resolution` ∈ {768P, 2K}；`ratio` 合法 | 错误 | 新增 |
| **V13** | `referenceIds` 全部存在于 `assetIndex.json` 且资产已出图；`generated`/`accepted` 的镜 `assetPath` 必须存在、`nodeId` 必须存在，但**服务端媒体任务通道例外**（该通道不建画布节点、`nodeId` 恒 `null`，按 `attempts` 里的 `batch:`/`task:` 标记识别） | 错误 | 新增 |
| **V14** | 合成清单只含 `accepted` 镜；顺序连续、无空洞 | 错误 | 新增 |
| **V15** | `referenceIds` 顺序与画布实际 `referenceOrder` + 入边顺序逐一一致 | 错误 | 新增 |
| **V16** | 承接镜（`continuity: "context"`）：参考素材合计 ≤3 且时长 ≥10 秒（引擎 `continue_from` 限制） | 错误 | 新增 |

- 校验器与执行分离：`planOperator` 的 `planValidator.ts` 保持纯函数，读快照由 Agent 传入；
- `validate` **零写入**；`build` 才写派生文件。

---

## 6. 分期

> 本节为原始分期计划。**实际执行状态见 §10.1**：M0–M4 已全部完成，M4 已在真实样本工程（`C:\workspace\film-maker\toonflow`）上跑通成片。

| 期 | 内容 | 新增/改动 | 验收 | 回滚 |
|---|---|---|---|---|
| **M0** | 契约文档 + 资产卡模板 + 多轨模板 + 段头语法 | 新增 `packages/skills/assetCard/` | 人工按模板造 3 镜小样，字段可被解析 | 删目录 + 删 `data/skills/assetCard` |
| **M1** | `planOperator` 工具：解析、V1–V15 校验、派工单、报告 | 新增 `packages/tools/planOperator/` | `bun install` → `bun run typecheck` → `bun run dev:plugins` 产出 `data/tools/planOperator.tool.js`；对样例命中 V11–V15 各一次 | 插件市场卸载 |
| **M2** | 多轨编辑器扩展 | 新增 `packages/ext/multitrack/` | 工程文件用 `plan/story.mtrack`（自定义 mtrack 后缀）→ `resourceKind:"file"`、`extensions:["mtrack"]` → `bun run --cwd packages/ext/multitrack build`；打开 `.mtrack` 可编辑并保存 | 卸载 `data/ext/ext-multitrack.umd.js` |
| **M3** | 逐分镜 FreeVideo 生成闭环 | 技能里写执行 SOP；工具加 `dispatch` action | 对 1 镜跑通全链路，状态正确回写 | 只影响多轨文件 |
| **M4** | 合成导出 | 工具 `planOperator` 的 `composite` action 调宿主 ffmpeg `concat`；写 `composite.json` | 3 镜拼接成片可播放 | 删 `composite.json` |

> M4 实际执行结果（2026-10-19 23:39，样本工程 2 镜实跑）：清单段与 `execute=true` 段均通过真实链路验证，成片 `out/composite.mp4`（11725924 字节，605 帧，25.208s，1376×768@24fps，h264+aac）可播放，ffprobe 核对无缺流；不覆盖守卫生效（重复执行在 `packages/tools/planOperator/src/index.ts:658` 抛错）。详见 §10.1 与 §10.7。

**M2 的前置**：M1 必须先把 `story.mtrack` 契约做扎实——编辑器不产生新语义，只是契约的可视化。

---

## 7. 风险与降级

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | 扩展无节点写通道 | 编辑器点「生成」无法直接执行 | 编辑只改状态标记，生成由 Agent/工具读工程执行 |
| R2 | 能力降级（无 VAE identity / context latent / 调度器） | 跨镜一致性弱于 LSC | 多图参考 + 强约束文案 + `firstFrame` 续接，`assetReport.json` 固定输出 `capabilityDegraded` |
| R3 | `freevideo.ts` 未提交（git `A`） | 断链 | M1 前先提交并锁定版本 |
| R4 | 参考超出该模式上限（供应商声明 4）被逼首尾帧模式 | 生成失败或语义错误 | V8（图片 ≤9、音频 ≤1）与 V16（承接镜 ≤3）在生成前校验拦截，多轨界面在勾选第 5 张时直接挡住 |
| R5 | 长任务（60 秒）超时 | 误判失败 | 只认 `getGenerationStatus` 终态，超时不等于失败 |
| R6 | 合成片段规格不一 | concat 静默产出错乱成片（尺寸不一致会报错，帧率/音轨不一致不会） | `planOperator composite` 的 `execute=true` 段先逐段 ffprobe 实测，规格与首段不一致直接报错挡在编码前（2026-10-20 实装）；声明 `seconds` 与实测时长差 >1s 记规格提示 |
| R7 | 多轨与画布漂移 | 派工单指向不存在的节点 | V13/V15 每次执行前重校验 |
| R8 | 编辑器与工具两套真相 | 状态不一致 | 单一真源 `story.mtrack`，工具只读 |

---

## 8. 待验证清单（实现前逐条实测）

来自 [Toonflow 可行性 §7](toonflowMultitrackFeasibility.md)，每条给出验证方式：

| # | 待验证 | 验证方式 |
|---|---|---|
| 1 | 宿主 `mountNode` 注入是否覆盖 `resourceKind:"file"` 扩展（只读推断 index.vue:311-314 只对 canvasNode 注入） | M2 产物 statusPanel 已按不可用设计，走 `acquireUrl` 预览；若要挂载需启动应用实测 |
| 2 | 4 图 vs 3 图+1 视频的真实 `matchingModes` | M3 对同一节点改参考集合，读 `getConfig` 对比 |
| 3 | 60 秒长任务的完成通知与状态刷新 | 跑 1 条 60 秒，记录轮询间隔与终态时间 |
| 4 | `.mtrack` 扩展关联能否持久 | 重启应用后打开同文件，确认仍用该扩展 |
| 5 | 不同 `resolution` 片段 concat | **已验证（2026-10-20）**：用真实产出造 640×360 / 30fps / 无音轨三种变体与正常段试拼——尺寸不一致报 `Conversion failed!`（不含线索），帧率与音轨不一致则**静默成功**；`composite execute=true` 的探针现会在编码前全部拒绝并列两段实际规格。见 §10.9 |

---

## 9. 与既有方案的关系

| 既有 | 关系 |
|---|---|
| `assetCardWorkflowPlan.md` P0/P1 | **直接复用**：资产卡、编号、接线、`assetIndex.json` |
| `assetCardWorkflowPlan.md` P2 `planOperator` | **扩展**：新增 V11–V15 与 `dispatch`，不推翻既有 V1–V10 |
| `plan/segmentMap.json`（原 K5） | **被取代**：合并进 `story.mtrack` 的 `clips[]`，不再维护第二份映射 |
| P3 `assetCardView` | 仍不做（YAGNI） |

> 注意：`story.mtrack` 取代 `segmentMap.json`，避免两套真相；`assetIndex.json` 保留，因为它是资产层索引而非片段层。

---

## 10. 实施进度（实跑与修正）

> 本节记录方案定稿后的实际落地状态，取代分期表里「计划中」的表述。截至 2026-10-19 23:39，M0–M4 已全部完成：M0–M3 有真实生成样本，M4 已在真实样本工程上跑通成片（ffprobe 实测 25.208s / 605 帧 / 1376×768@24fps / h264+aac）。

### 10.1 分期实际状态

| 期 | 计划内容 | 实际状态 | 证据 |
|---|---|---|---|
| M0 | 契约文档 + 模板 | **已完成** | `packages/skills/assetCard/`（SKILL.md + assetCardTemplate.md / referenceResolution.md / multitrackTemplate.md） |
| M1 | `planOperator` 工具 | **已完成** | `packages/tools/planOperator/`（index.ts 732 行：action 九项 parse/resolve/validate/build/mtrackRead/mtrackUpdate/dispatch/assemble/composite；planValidator.ts V1–V15；mtrackSchema 用 looseObject） |
| M2 | 多轨编辑器扩展 | **已完成** | `packages/ext/multitrack/`（`resourceKind:"file"`、`extensions:["mtrack"]`、轨道/片段/状态面板 + `agentDispatch.ts` agent 执行桥） |
| M3 | 逐分镜生成闭环 + SOP | **已完成** | SOP `packages/skills/assetCard/references/generationRunbook.md`（§一 11+1.5 步单镜序列、§十二～§十九 批量/取消/装配/分层/部署）；`dispatch` action 已在 M1 落地 |
| M4 | 合成导出 | **已完成** | `planOperator` 的 `composite` action（`packages/tools/planOperator/src/composite.ts` + `index.ts:524-560` 分支、`:672-705` 执行段、`:711-728` 探针）：默认只产出合成清单并写 `plan/composite.json`（只取 accepted、复跑 V14、逐段 assetPath 可读校验），`execute=true` 才先逐段 ffprobe 实测规格、再经宿主 ffmpeg 执行 concat。部署已落盘：`data/tools/planOperator.tool.js`（2026-10-20 00:59，116834 字节，revision `1c866797…3b7`，含 readme 探针说明），dev server 启动后 `/api/tools/get` 返回的 `planOperator` revision 与该文件 SHA256 一致、`loadError` 为空。**真实工程已跑通**（2026-10-19 23:39 首拼 + 2026-10-20 规格探针复验，`C:\workspace\film-maker\toonflow` 沙箱 `.simtest`/`.simtest2`，不污染原工程）：两镜 status 由 generated 改 accepted 后，清单段输出 S001/S002 两段，`execute=true` 经宿主 ffmpeg 真实 concat 出 `out/composite.mp4`（605 帧 / 25.208s / 1376×768 / 24fps / h264+aac 双流齐全，时间轴 = 10.13+15.08 = 25.21s 与两段实测时长吻合）；复跑命中不覆盖守卫。规格不一致的三种变体（640×360 / 30fps / 无音轨）全部被探针挡在编码前，见 §10.9 |

### 10.2 真实生成样本（C:\workspace\film-maker\toonflow）

- 工程：`plan/story.mtrack`（S001 开卷 10s generated、S002 入梦 15s generated）；资产卡：`assets/assetCards.md`（C01–C04 / SC01 / P01）。
- 成功任务 `jcf2f42ed8eb5`：1376×768、362 帧 / 15.083s、738.5s 耗时、RTX 3090、seed 1862430706048062、产出 `assets/nankou/clips/video02a-ca8d1176.mp4`。
- 画布 `南柯一梦.json` 视频节点 `4d21e0c9` 的 `outputs.video` 已回写为该 mp4。

### 10.3 实跑发现并已修正的链路问题（均为真实故障，非纸面推演）

> **HISTORICAL（v7 旧口径记录）**：以下 1/2/4 三条描述已作废的 `{{ref N}}` 双花括号占位符与 wire 层 `{{ref N}}` → `<Picture N>` 换算通道；H3 官方格式下写作者直接写 `<Picture N>` / `<Video N>` / `<Audio N>`，不再有任何换算层，权威口径见 `docs/h3PromptAlignment.md`。以下记录仅作历史追溯保留。

[HISTORICAL] 1. **`{{ref N}}` 断链（已作废）**：`{{refN}}` 只是画布 mention chip，引擎不替换。修复位置在节点层——`packages/nodes/videoGenerationNode/src/index.vue` 新增 `referenceTags()`，当选中 provider 为 `freevideo` 时按画布引用列表**全局序号**（`packages/nodeShared/src/useNodeReferences.ts`）把 `{{ref N}}` 转 `<Picture N>`（IMAGE→Picture / VIDEO→Video / AUDIO→Audio / STRING→参考N）。
[HISTORICAL] 2. **provider 层同类修复被回滚（已作废）**：`packages/providers/src/media/freevideo.ts` 拿不到 STRING 参考的全序位置，混入文本/视频时编号整体错位（改动前 `{{refN}}` 原样送引擎是无效但不指错，改动后错指=回归），故 provider 层 diff 已清空，修复只保留在节点层。
3. **FreeVideo API 五条备忘**（已写入 SOP，仍有效）：不接受 width/height 直传（422 `permitted field combination`），用 `megapixels` 档位（1.0→1376×768）；`/media` 返回 201 非 200；轮询用 `?wait=25`；下载带 Bearer。
[HISTORICAL] 4. **V7 正则漏检（已作废）**：原 `ref\s+(\d+)` 要求空白，真实画布里 64 处无空白写法 `{{ref1}}` 全部不命中；t15 修为 `\{\{\s*ref\s*(\d+)\s*\}\}`（`planValidator.ts:207`，注释注明四种写法均命中）。

### 10.4 SOP 冻结前的最后两处断点（t13 评审，t19 已修）

- **断点①**：assemble 前必须先产出 `plan/assetIndex.json`——`index.ts:460` 查不到 refId 时只 `warnings.push("参考结算缺")` 且不建边（:462-463），warnings 只追加在返回文本尾不拦流程（:502-504），缺 index 会让片段→资产图的参考边整批悬空；assemble 返回的 `layers` 只覆盖资产层、一个片段节点都不含（`layerCount` 由 `assetNodes` 推出，:449-453）。SOP §十六 已写死固定顺序 validate → resolve/build → assemble。
- **断点②**：单镜序列必须先读 dispatch 的 `currentState.nodeId`（`index.ts:376`）判定复用/新建分支——非空走复用（不 addNode，只对该 nodeId 做 getConfig/setPrompt/setConfig），空才新建；SOP §一 已将 11 步扩为「11 步 + 步 1.5」，§九/§十二/§十三.2/§十七.2/§十一 同步引用。

### 10.5 提示词格式约束（用户 2026-10-19 要求）

提示词格式以 freevideo-agent 标准为准，已写入 SOP 头部：**正文英文；对白、歌词与屏幕文字保留原文；单块时长须落在 17n+5 秒网格（10 秒 → 10.125 秒）；宽高须为 32 的倍数；质量档位 light（默认 8+3 两遍）/medium/high/max。** 与 §四 拼装规则核对无冲突，冲突时以该 skill 为准。

### 10.6 质量门当前状态（剩余关卡）

| 关卡 | 状态 |
|---|---|
| t20 复审 SOP 两处断点修复 | 进行中（attempt 2；attempt 1 因共享模型 429 瞬时失败，非评审结论） |
| t7 / t8 / t16 复验（3 项） | 待重派，均因 429 瞬时失败挂起 |
| t10 / t11 / t12 实现评审 | 待 t16/t7/t8 通过后进 |
| t14 汇总裁决 | 待 t10/t11/t12/t20 |

> 环境约束：成员模型走 opencode2dsh 免费共享配额，429 限流频繁，只能串行执行 + 冷却重试，不可并行派工。已完成的结论不受限流影响（t6/t9/t13 均已产出实质裁决并闭环）。

### 10.7 遗留待办

1. t20 pass 后依次复验 t7/t8/t16，再进 t10/t11/t12 与 t14 汇总。（属上一轮已解散团队的评审链，任务对象已不存在，未重跑。）
2. ~~M4 合成导出在真实工程上试拼成片~~ **已完成**（2026-10-19 23:39 首拼、2026-10-20 规格探针复验）：在 `C:\workspace\film-maker\toonflow` 沙箱（`.simtest` 首拼 / `.simtest2` 探针复验，原工程文件只读、写入全部落在沙箱内）复现全链路——status 改 accepted → composite 清单段 → `execute=true` 经宿主 ffmpeg concat → ffprobe 核对成片；另造三种规格变体验证探针拦截。结果见 §10.1 M4 行、§10.8、§10.9。
3. `data/skills/assetCard` 需人工同步（技能文档不自动拷贝）。**2026-10-20 已同步并 SHA256 核对一致**：SKILL.md、references/generationRunbook.md 同步后与源码侧 MATCH，multitrackTemplate.md / assetCardTemplate.md / referenceResolution.md 本次未改、两侧原本相同。
4. dev server 为验证临时启动（端口 3000），非常驻；app 内端到端实测前需重新 `bun run dev` 启动。
5. `planOperator` 工具改动后需重新构建并落盘：`bun run --cwd packages/tools/planOperator build` 产出 `build/tools/planOperator.tool.js`，再复制到 `data/tools/planOperator.tool.js`（只有 `NODE_ENV=dev` 时构建脚本才自动 copyFile；readme.md 也嵌入工具元数据，改它同样要重建）。2026-10-20 已同步：`data/tools/planOperator.tool.js` 116834 字节，SHA256 `1c866797…3b7`，`/api/tools/get` 返回的 revision 与之一致。

### 10.8 模拟测试结论（M4 成片试拼）

试拼路径（沙箱 `.simtest`，原工程只读、写入全部落在沙箱内）：

| 步骤 | 动作 | 实测结果 |
|---|---|---|
| 1 | 原样 status=generated 直接 composite | 拒绝：`没有 accepted 片段可合成`（预期路径，先改状态） |
| 2 | `mtrackUpdate` 两镜 generated → accepted | 成功，`expectedUpdatedAt` CAS 生效；**这一步让原工程 `story.mtrack` 失去可回滚快照**（已无 generated 副本） |
| 3 | composite 清单段（默认） | 只取 accepted、复跑 V14、逐段 `assetPath` 存在校验均过；`specWarnings` 为空；写 `plan/composite.json`（segments 2 条，executed=false） |
| 4 | composite `execute=true` | 经宿主 ffmpeg 真实 `concat`（h264+aac 双流同时进 concat 滤镜，重编码 libx264 crf 23）出 `out/composite.mp4`：11725924 字节、605 帧、25.208s、1376×768、24fps |
| 5 | ffprobe 核对成片 | 视频 605 帧 / 25.208s、音频 789 帧 / 25.200s、双流齐全；时间轴 = 10.13s(S001) + 15.08s(S002) = 25.21s，与两段实测时长吻合，无缺段无黑帧 |
| 6 | 复跑 `execute=true` | 命中不覆盖守卫：`合成输出已存在：out/composite.mp4。不自动覆盖，请换一个输出路径或确认后手动删除该文件`（`index.ts:658`） |

与纸面手册（SOP / 计划文档）的偏差，以及 2026-10-20 的修复：

1. ~~**`assetPath` 校验只判存在、不判内容**~~ **已修复（2026-10-20）**：composite 原只做 `store.exists`，不核对真实规格。修复后在 `execute=true` 段先逐段 ffprobe 实测尺寸/帧率/像素格式/音轨参数，任一段与首段不一致直接报错并列两段实际规格，挡在编码之前（`composite.ts` 的 `verifySegmentSpecs` + `index.ts` 的 `probeMedia`）。
2. ~~**seconds 声明值与实测时长未对账**~~ **已修复（2026-10-20）**：现在比对各段实测 `format.duration` 与工程声明的 `seconds`，相差超过 1s 记规格提示（不拦执行）。样本工程 S001 声明 10s / 实测 10.125s，S002 声明 15s / 实测 15.083s，均在容差内。
3. **无 accepted 时 composite 直接拒绝**，状态翻转是编辑器/Agent 的人工职责（与 §三 状态机一致）。「工具侧无回退路径」的说法不成立：`mtrackUpdate` 的 `clipUpdateSchema` 接受全部五个 `status` 值，可把 `accepted` 改回 `generated`/`pending`。
4. 其余链路与手册一致：`mtrackUpdate` 只 patch status/nodeId/assetPath/attempts + updatedAt CAS；`composite` 默认只写清单不调 ffmpeg，`execute=true` 才执行，符合 §5「校验器与执行分离」。

### 10.9 concat 滤镜的真实失败行为（2026-10-20 实测）

用样本工程的真实产出造三种规格变体，各自与正常段试拼（绕过 composite 探针、直接调 fluent-ffmpeg `concat`），确认「规格不一致」到底会不会被 ffmpeg 拦住：

| 变体 | concat 结果 | 产出实际规格 |
|---|---|---|
| 640×360 + 1376×768（尺寸不一致） | ❌ 报错 `ffmpeg exited with code 234 ... Conversion failed!`（**错误信息不含尺寸线索**） | 无产出 |
| 30fps + 24fps（帧率不一致） | ✅ **静默成功** | 输出 30fps / 815 帧 / 30.175s，时间戳按混用帧率铺开 |
| 无音轨 + 有音轨 | ✅ **静默成功** | 输出 24fps / 724 帧 / 30.167s，音频流照常写出 |

结论：**尺寸不一致会报错但信息无用，帧率与音轨不一致则完全静默**——后者正是探针必须挡在前面的理由。加探针后，三种变体全部在编码前被拒，错误里带两段实际规格（`S001 为 1376x768 24fps yuv420p audio aac 32000Hz 2ch，S002 为 1376x768 30fps yuv420p audio aac 32000Hz 2ch`）。

### 10.10 多轨编辑器进画布（multitrackNode，2026-10-20 实装）

应用户要求「多轨应该可以出现在右键菜单上手动添加」，多轨编辑器新增画布节点形态，与文件面板扩展同源：

- **共享内核**：编辑器内核（读写/保存冲突检测/选段/增删改移/批量派工）从 `packages/ext/multitrack/src` 抽到 `@toonflow/node-shared/mtrack`（`multitrackEditor.vue` + `mtrackProject.ts` + `agentDispatch.ts` + 5 个编辑组件），ext 与节点共用同一份实现。ext 的 `index.vue` 降为薄壳（挂载内核 + 透传 `context.files`），原 464 行编辑逻辑全部下沉。
- **新节点** `packages/nodes/multitrackNode`：卡片显示「N 镜 · N 秒」+ 各状态数量摘要（读 `plan/story.mtrack`，缺失时提示）；「编辑」按钮弹窗打开完整多轨编辑器；弹窗关闭与节点保存钩子强制落盘并刷新摘要。工程文件固定为 `plan/story.mtrack`（通用路径约定，不绑定故事）。
- **保存内核加固**（抽离时顺手修正）：dirty 判定从对象身份比较改为 `JSON.stringify` 内容比较（原版存在「保存后仍标记脏」的永久 dirty 缺陷）；`writeJson` 前先做内容快照，写盘期间的新改动不混入本轮文件，落盘后如仍有改动补排下一轮。
- **验证**：三个包 typecheck 全绿；`NODE_ENV=dev` 构建，`data/nodes/multitrackNode.umd.js` 与 `build/` 产物 SHA256 一致；dev server `/api/nodes/get` 返回 multitrackNode（enabled）；bun 模拟宿主全局执行双 UMD 注册成功（需 document 桩——rolldown-vite v8 将 scoped CSS 内联为模块层 `document.createElement("style")`，浏览器宿主无此问题）。浏览器内端到端交互（右键添加→编辑→派工）留待用户实操。
- **通用性**：编辑器与派工逻辑不包含任何故事/角色/场景专有内容；工程路径 `plan/story.mtrack` 是流程约定，换工程即可复用（对应用户「换故事可运行」的要求）。