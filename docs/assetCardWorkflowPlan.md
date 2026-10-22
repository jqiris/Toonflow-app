# 资产卡工作流落地方案（LocalStoryCanvas → Toonflow）

> 任务：t3（[planDoc]）。依据 [LocalStoryCanvas 机制解剖](localStoryCanvasStudy.md)（下称 LSC 报告）与 [Toonflow 能力盘点](toonflowIntegrationSurvey.md)（下称 Toonflow 报告）。
> 本文件是**唯一交付物**：不修改任何业务代码、不修改配置文件、不修改锁定文件。
> 结论先行：移植的是 **确定性骨架**（编号、接线解析、拓扑顺序、出图前核对），不是生成引擎。所有新增物都落在「技能目录 / 独立工具包 / 独立扩展包」中，卸载即复原。

---

## 0. 一页结论

### 0.1 移植哪 5 个核心思路，各自落在哪个容器

| # | LSC 思路（出处） | Toonflow 容器（确切路径） | 为什么这样选 |
|---|---|---|---|
| K1 | **资产卡编号体系**：`C/SC/P/KF/S` + 字母状态后缀，重复编号拒收（LSC 报告 §1.1） | 工作区文档 `assets/assetCards.md`（Markdown，程序可解析的标题行 `### C01 · 名称`） | Toonflow 节点没有 `assetId` 字段，编号只能存在于文件里；Markdown 是 Agent 可读、程序可解析、`useWorkspaceFiles` 与 `@toonflow/file` 都能写的最小载体，且不碰画布 JSON |
| K2 | **声明式参考接线**：显式字段 > 派生散文 > 正则兜底 + 四道守卫（§2） | 技能 `packages/skills/assetCard/` 内约定 + 工作区索引 `plan/assetIndex.json` | 接线最终仍要落成 `connectNodes` 与 `setPrompt`；约定放技能、结果落索引文件，Agent 每轮可读回，可被 P2 工具确定性校验 |
| K3 | **程序硬校验**：重复编号、目标存在、backwards-only、`{{ref N}}` 与入边一一对应（§3、§5.3） | 新工具包所在目录 `packages/tools/` 下（包与文件名见 §3.3，名称不得超过 32 字符），构建产物 `build/tools/<name>.tool.js` → 运行时 `data/tools/<name>.tool.js` | 唯一「一等」的确定性通道（Zod `parseAsync` + Draft-7 schema），是运行时业务校验而非测试代码；独立包，卸载即失效 |
| K4 | **分镜/参考图角色分离**：`C*/SC*/P*` 母版、`KF*` 构图卡、分镜格只做动作依据（§6.1） | 技能内的角色分离表 + 资产卡模板；节点侧分别建图片生成节点（母版）与视频生成节点（片段） | 不新增节点类型即可表达；`nodeScaffold` 只放通用能力，业务语义放技能 |
| K5 | **分镜头 → 视频节点映射**：一段 = 一个视频节点，按编号定位重生成（§6.2/§6.3） | `plan/segmentMap.json`（`segmentId → nodeId`）+ 技能中的命名约定 | Toonflow 无专用重生成路由，重生成 = 再调该节点 `node:generateVideo`；有了映射表才能按段定位 |

> 一句话：**K1/K2/K4 是文本契约（P0/P1），K3 是代码 guard（P2），K5 是映射表（P1 写入、P2 校验；P3 展示默认不做）。**
>
> **交付范围（captain 裁定）**：P0 → P1 → P2 为本轮目标；P3 默认不做（审阅 Y1，YAGNI），需要时另行立项。方案行数超出原定 450 行上限经裁定**不返工**：超出部分全部是审阅 A1–A4/C1–C3/D1–D3 修订带来的数据契约与可执行命令，裁掉会削弱契约完整性（三种行数统计口径不一致，以实际内容完整性为准）。

### 0.2 复用优先、最小 diff

- **P0/P1 零代码**：只新增技能目录与文档，构建、类型检查、运行时加载全部复用既有链路（`packages/skills` → `build/skills` → `data/skills`，`apps/server/src/app.ts` 首次安装只补缺失）。
- **P2 只新增一个工具包**：结构、脚本、构建方式照抄 `packages/tools/skillOperator`（最小工具包样板）；文件读写走宿主注入的 `context.files`（内部即 `@toonflow/file` + 工作区边界），工具自身**不 import 任何文件 API**，因此 diff 局限在一个新目录。
- **P3 默认不做**（captain 裁定，采纳审阅 Y1）：`assetCardView` 扩展只能读 `plan/*.json`，信息量不高于直接读 `plan/assetReport.json`，属 YAGNI。仅当用户明确要求「在画布节点里看资产卡」时再按 §3.4 立项。
- **不改宿主**：不改 `apps/server/src/router.ts`（无新路由）、不改节点源码（K2 的「出图前核对」先做成工具 action，节点侧 guard 列为待授权可选项，见 §4.3）。

---

## 1. 协议与数据契约（全部期次的共同基础）

### 1.1 工作区目录边界

| 路径（工作区内相对） | 写者 | 读者 | 说明 |
|---|---|---|---|
| `assets/assetCards.md` | 用户 / Agent（`skillOperator` 或 `workspace` 工具） | Agent、P2 工具、P3 扩展 | 资产卡唯一真源（K1） |
| `plan/assetIndex.json` | Agent（派生，不手改） | Agent、P2 工具 | 接线与顺序索引（K2） |
| `plan/segmentMap.json` | Agent（派生） | Agent、P2 工具 | 片段 → 节点映射（K5） |
| `plan/assetReport.json` | P2 工具的 `validate` / `build` 输出 | Agent、P3 扩展 | 体检报告（只读产物） |
| `assets/<nodeId>/` | 节点生成（`outputDirectory: assets/${id}`，既有行为） | 画布 | 出图落点，**协议不写这里** |

- 路径一律用工作区相对路径、`/` 分隔；写入统一经 `context.files` / `useWorkspaceFiles`，**不直接调用 `node:fs`/`Bun.write`**（AGENTS.md「统一文件操作入口」）。
- **不改画布 JSON**：接线只通过 `connectNodes` / `nodeTools`，与 `packages/skills/canvas/SKILL.md` 的既有约束一致。
- 新增目录与文件一律小驼峰：`packages/tools/planOperator/`、`packages/ext/assetCardView/`、`packages/skills/assetCard/`、`assetCardTemplate.md`、`videoProduction.md`。
- **工作区产物文件是用户数据，不是仓库文件**：Host 侧以 `workspaceFiles` 为前置词、用复数全小写（`canvasFiles.ts` 是导出别名，不是文件）；技能侧 `assets.md`、`assets/` 是全仓既有惯例（`packages/skills/workflow/references/assets.md`、`canvas` 技能 `assets/` 落图路径）。因此工作区用 `assets/assetCards.md`、`plan/*.json`（`assetIndex` / `segmentMap` / `assetReport` 均为小驼峰单数），**不写 `assetCards` 这类驼峰目录名**。

### 1.2 资产卡 Markdown 语法

```markdown
# 资产卡（项目名）

## 全局设置
- 风格统一词：电影感写实，柔和自然光
- 统一人物质感词：皮肤有细微毛孔，布料有纤维纹理
- 统一时代设定：民国初年
- 统一排除项：文字、水印、畸形手指

## 人物资产卡
### C01 · 淳于棼
- 建议画幅：2:3
- 提示词：中年男子，青衫，束发，正面全身，中性表情
- 负面提示词：现代服装, 眼镜
- 结构参考：C01-A（同一张脸，仅更换服装）

## 场景资产卡（SC01–SC12，16:9 横屏）
### SC01 · 古槐树下
- 提示词：无人的古槐树下，黄昏，空镜
- 文本类：空镜，不出现人物

## 道具资产卡
### P01 · 青瓷枕
- 提示词：白底，单个青瓷枕，无人手，正交视角

## 关键帧/构图卡
### KF01 · 入梦（引用 C01、SC01、P01）
- 提示词：9:16 竖构图，C01 躺下，SC01 背景，P01 放在床头
```

**标题行（机器可读，唯一权威）**：`### <ID> · <名称>`。`ID` 正则：

```text
^(?:C|SC|P|KF)\d{2,3}(?:-[A-Z])?$  或  ^S\d{2,3}(?:-[A-Z])?$
```

- `·` 前后各一个空格（U+00B7 或全角「·」均接受，解析时统一）。不用表格、不用列表项承载编号，避免格式漂移；解析器只认 `ID` 标题行，节标题里出现的 `SC01–SC12` 范围不算卡片。
- **状态后缀属身份**：`C01-A` 与 `C01` 是两张卡；`C01` 未声明时，`C01-A/B/Y` 默认继承 `C01`，回落目标按**源文件出现次序**取第一张（修正 LSC 报告的 `dict` 插入序缺陷，LSC §2.2）。
- **对位 LSC 的放宽**：LSC `CARD` 正则为 `((?:SC|KF|C|P)\d+(?:-[A-Za-z])?|S\d+)`，数字位数不限、后缀大小写均可。本方案保留源文件的宽口径，只在 `assetIndex.json` 里**规范化**：数字补足 2 位不截断（`C1`→`C01`）、后缀统一大写、`SC` 先于 `C` 匹配（否则 `SC01` 会被 `C` 前缀吃掉）。
- **重复编号即拒收**：同一文件内 `ID` 重复必须报错并指出两处行号，不静默合并。
- 节标题可声明整类画幅：`## 场景资产卡（SC01–SC12，16:9 横屏）`；单卡 `建议画幅` 优先级更高。

**字段别名链**（照搬 LSC §1.2 的宽容度，减少用户迁移成本）：

| 字段 | 接受的别名 | 必填 |
|---|---|---|
| 提示词 | `提示词` / `人物提示词` / `场景提示词` / `资产提示词` | 是（`文本类` 卡除外） |
| 负面提示词 | `负面提示词` / `可选负面提示词` | 否 |
| 建议画幅 | `建议画幅` / `画幅`（无则用节标题、再用前缀默认值） | 否 |
| 身份参考（C） | `身份参考` / `参考` | 否 |
| 结构参考（SC） | `结构参考` / `空间参考` | 否 |
| 道具参考（P） | `道具参考` / `器物参考` | 否 |
| 派生指令 | `参考派生` / `参考派生说明` / `派生参考` | 否（K2 二级） |
| 文本类 | `文本类` / `仅文字记录` / `不引用独立图片` | 否（置位则不出图） |

### 1.3 参考接线声明（`plan/assetIndex.json`）

```jsonc
{
  "version": 1,
  "source": "assets/assetCards.md",
  "cards": [
    {
      "id": "C01",
      "name": "淳于棼",
      "kind": "character",            // character | scene | prop | keyframe | sound
      "textOnly": false,
      "ratio": "2:3",
      "refs": ["C01-A"],              // 解析后的上游 ID，顺序 = 生成时参考图顺序
      "refSource": "explicit",        // explicit | directive | fallback | none
      "order": 3,                     // 卡片在源文件中的出现序号，backwards-only 以此比较
      "nodeId": "9f3a…"               // 可选：该卡的图片生成节点（P1 由 Agent 回填）
    }
  ],
  "warnings": [{ "card": "C01-B", "code": "identityConflict", "message": "…" }]
}
```

- `refs` 顺序即 `Picture` 编号来源：接线后按 `data.referenceOrder[handleId]`（键为 `encodeURIComponent(JSON.stringify([source, sourceHandle]))`）+ 入边顺序计算，未列入的按入边顺序追加（`packages/nodeShared/src/useNodeReferences.ts`）。
- 卡片按声明顺序生成时 `order` 升序执行；**构图卡 `kind: "keyframe"` 永远排在同批最后**，且依赖来自提示词正文里的编号（LSC §3.1 的 `ASSET_ID.findall`）。
- **参考上限按节点实际匹配模式计算，不按单一供应商写死**：以现有声明计，视频节点上 `MiniMax-H3` 的参考模式为图 4 / 视频 1 / 音频 1（`startFrameOptional` 模式只有 2 图，且第 1、2 张会变成首帧/尾帧，见 `packages/nodes/videoGenerationNode/src/index.vue` 的 `generationInput`），`freevideo-image` 的 `multiReference` 为 4 图。所以 P2 的阈值来自「当前所选模型 + 实际参考计数」，见 V8。

### 1.4 片段映射（`plan/segmentMap.json`）与提示词模板

```jsonc
{
  "version": 1,
  "canvasId": "画布1.json",
  "segments": [
    {
      "segmentId": "S001",
      "label": "场01·片段01·视频",
      "nodeId": "b71c…",
      "seconds": 8,
      "ratio": "9:16",
      "shotIds": ["SHOT_0001", "SHOT_0002"],
      "references": [
        { "cardId": "C01", "kind": "character" },
        { "cardId": "SC01", "kind": "scene" }
      ],
      "systemRules": "identity"        // identity | location | object | composition
    }
  ]
}
```

- 节点 `label` 固定模板：`场<场景号>·片段<片段号>·视频`；资产节点：`资产·<卡ID>·<类型>`。`renameNodes` 的 `label` 限 1–200 字符。
- **片段提示词模板**（写进 `node:setPrompt`，顺序即权威）：

> 旧口径注记（已过时，仅作历史记录）：多轨片段提示词现按 MiniMax H3 官方 ref2va 六段由写作者直接书写，首行不再是「参考顺序：…」声明行，引擎也不再代写资产定义段 / 摘要段 / 参考保持分析段与此类声明行；旧工程带 `{{ref N}}` 的片段属迁移对象。

```text
【片段 S001｜8秒】参考顺序：{{ref 1}}=C01、{{ref 2}}=SC01
<一句话正向接线说明：只锁身份/空间/形制，不锁动作与构图>

C01（本人）：<状态刻画>
SC01（空间）：<空间刻画>
动作与镜头：<逐镜或段内节拍>
声音：<台词/音效>
约束：<本段禁止项>
```

- 身份/结构/道具三类约束文案（LSC §3.4 的 `identity_clause` 文案契约，纯文本、与模型无关）：

| 类别 | 模板句（英文原文保留，便于多语言模型稳定理解） |
|---|---|
| identity | `IDENTITY REFERENCE: Image 1 is this character in an earlier state and is the face identity authority. Only clothing, hair, age state and expression may change.` |
| location | `IDENTITY REFERENCE: Image 1 is the same location rendered earlier. Use it ONLY for spatial structure and layout; keep the environment empty of people.` |
| object | `OBJECT IDENTITY REFERENCE: Preserve its exact form, proportions, construction, materials and fittings; do not redesign.` |
| composition | `COMPOSITION REFERENCE: Image N is a composition/framing card built from labeled source references; it is not a standalone master asset.` |

---

## 2. 五项核心思路的具体设计

### K1 资产卡编号与卡面（P0）

- **目标行为**：任何资产有唯一 ID；编号在资产卡文件里可检索、可对账；改名/移动节点不会让编号漂移。
- **容器与路径**：`packages/skills/assetCard/SKILL.md` + `packages/skills/assetCard/references/assetCardTemplate.md`（模板全文）。
- **数据契约**：§1.2。
- **实现步骤**：写模板 → 写 `SKILL.md`（何时读模板、何时新建卡片、编号分配规则、`textOnly` 与 `requests_prop_cards` 判据） → **不改** `canvas` 技能正文（理由见 §4.2）；与 `videoProduction.md` 的关系走「同名技能优先」机制：在用户工作区建 `skill/canvas/`（经 `skillOperator` 的 `workspace` 范围），用同名技能覆盖全局版本文本，见 §3.1。
- **验收**：用模板造一份 5 张卡的小样，人工检查 ID 唯一、字段可被 P1 的解析规则逐条读出。
- **失败回退**：删 `packages/skills/assetCard/` 即回到现状（`data/skills` 会残留一份，见 §3.6 清理步骤）。

### K2 声明式参考接线（P0 约定 + P1 索引）

- **目标行为**：作者写 `结构参考：SC01`，Agent 就只按声明接线，不再自由判断；解析顺序与守卫固定可复现。
- **优先级**（照搬 LSC §2.1，去掉无法在 API 模型侧起作用的环节）：
  1. **显式**：`身份参考/结构参考/道具参考` 字段值里取编号；**前缀与卡类型必须匹配**（人物卡写 `身份参考：SC01` 视为未声明）。
  2. **派生散文**：`参考派生：` 必须命中正向短语（`同一角色/同一空间/同一器物/绑定为本卡参考图/保持脸部结构`）**且**不命中否定词（`两名|两人|区分|混同|不是|并非|不与…共用|独立设卡`）。
  3. **正则锚点兜底**：按类型三套锚点窗口搜索（人物 `同一张脸/保持同一身份锚点`、场景 `同一空间/同一布局`、道具 `同一器物/同一形制`），窗口 ±40 字，否定在**同一子句**（`\n。；;` 切分）内判定。
  4. 都没有 → 不接线。
- **四道守卫**（全部保留，并补 LSC 已知缺口）：
  - 前缀/存在性：目标卡必须存在于同一份资产卡文件。
  - 否定：人物侧**必须补否定守卫**（LSC §2.2 自认缺失，`与 C01 以服装区分` 会被误接）。
  - backwards-only：`order` 大于本卡的参考一律拒绝并记 `warning`（前向引用会导致生成顺序死锁，LSC §3.2）——**显式声明同样拦截**。
  - 群像/闪回：带后缀卡正文命中 `少年/闪回/回忆/年轻时` → 不自动接线；基卡名含 `群/众/同式` 不自动接线；显式声明仍接线但要写 `identityConflict` 警告。
  - 后缀回落：`C03-B` 未声明时继承 `C03`；两兄弟都有后缀时取**源文件第一张**。
- **容器与路径**：`plan/assetIndex.json`（工作区，§1.3）；解析规则写进 `SKILL.md`，**P1 不做写入型工具**，由 Agent 按规则产出索引。
- **实现步骤**：`SKILL.md` 写规则与三个样例（显式/派生/兜底各一） → Agent 生成索引 → `validate`（P2）对账。
- **验收**：同一样例在两次不同会话里产出**字节级相同**的 `assetIndex.json`（除 `nodeId` 外）；违反守卫的样例全部出现在 `warnings`。
- **失败回退**：索引文件可整份删除再生成；不影响画布。

### K3 确定性校验（P2）

- **目标行为**：把「编号唯一、参考合法、顺序正确、提示词与入边一致」从提示词纪律升级为**会抛中文错误的运行时校验**。
- **容器与路径**：`packages/tools/planOperator/`。**名称约束**：`bun run dev:plugins` 按 `./packages/tools/*` 过滤 workspace 名，工具名须满足 `/^[a-z][a-zA-Z0-9]*$/`、≤32 字符；`planOperator` 合法。
- **校验器与执行分离**（本方案的关键结构约束）：

```text
packages/tools/planOperator/
  package.json            # @toonflow/tool-planOperator；version 必填（构建期写入元数据）；deps 仅 zod
  tsconfig.json           # 照抄 skillOperator
  build.ts                # createToolConfig({ name: "planOperator", configRules: [...] }, import.meta.url)
  readme.md               # 构建期嵌入元数据
  src/
    index.ts              # ToolPlugin：只做 Zod 参数校验 + 分发，不含业务规则
    assetCardParser.ts    # Markdown → 卡数组（纯函数，输入字符串）
    referenceResolver.ts  # 三级优先级 + 四道守卫（纯函数）
    planValidator.ts      # 索引/映射/画布快照 → findings（纯函数，不读磁盘）
    indexStore.ts         # 工作区读写：context.files（唯一触碰 IO 的模块）
```

- **动作（action）**：`parse`（卡文件 → 卡数组与 warnings）、`resolve`（卡数组 → `assetIndex.json`）、`validate`（索引 + 画布快照 → 问题清单，**只读**）、`build`（validate 通过后一次性写 `assetIndex.json` + `segmentMap.json` + `assetReport.json`）。
- **校验规则清单**：

| 编号 | 规则 | 失败语义 |
|---|---|---|
| V1 | 资产卡内 ID 唯一、符合 ID 规则、名称非空 | 报错，列出重复两处行号 |
| V2 | `refs` 目标存在且前缀匹配 | 报错 |
| V3 | backwards-only：`refs[].order < card.order` | 报错（显式声明同样拦） |
| V4 | 构图卡不参与派生、必须至少一个母版参考 | 报错 |
| V5 | `segmentMap` 中每个 `nodeId` 必须出现在画布快照中、类型为生成节点 | 报错 |
| V6 | 节点入边数 = `references.length`，且按 `referenceOrder` 排序后与 `references` 顺序一致 | 报错（防「改方案没保存就出图」，LSC §5.3） |
| V7 | 视频提示词中的官方标记 `<Picture N>`/`<Video N>`/`<Audio N>` 只查越界（上限按类型计数） | 报错；旧 `{{ref N}}` 只报迁移 warning（原「每个 N 至少出现一次」要求已取消） |
| V8 | 参考条数超过当前节点**实际匹配模式**的上限（空镜参考集非空或含 VIDEO/AUDIO 时，`MiniMax-H3` 只能落 `startFrameOptional` 的 2 图；图像节点 `multiReference` 4 图） | 报错，指明应改用拼板或改用模式 |
| V9 | `textOnly` 卡不得有 `nodeId`、不得被引用为图片参考 | 警告 |
| V10 | 节点的 `data.mode` 必须仍是快照时该模型「匹配模式集合」的成员（防止连线后 Vue Flow 的同步 `watch` 悄悄把模式切走，见 `videoGenerationNode` 第 190–197 行） | 报错 |

> V8 的上限来自「所选模型 + 画布快照里的参考计数」，**不写死在提示词里，也不另建配置项**：`configRules` 只保留开关类项（如 `allowBuild`）。理由：`data/settings.json` 的 `toolConfigs` 是同一条宿主配置，另存一份供应商上限就是第二套真相。
>
> **契约变更（相对 LSC）**：V10 与 V8 的触发点是 `data.mode`，检查对象是「当前参考集合能否在所选模型下成立」；LSC 侧靠 `getMatchingModes` 运行时兜底，Toonflow 侧要在 `setPrompt` 之前拦住，因为模式切换是静默发生的。
>
> **画布快照来源**：工具不自己调画布工具；由 Agent 先用 `getCanvasNodes`（`fields: ["label","type","ports","data"]`、`dataKeys: ["referenceOrder","mode","model"]`）与 `getCanvasEdges`（`direction: "incoming"`）读取，作为 `snapshot` 参数传进来；**快照必须完整**：`getCanvasNodes` 有分页/截断，`total`/`truncated` 不完整时工具直接报错并要求重新读取，不拿半份快照出结论。
- **实现步骤**：`extScaffold` 生成器只服务扩展，工具包手动建目录（照抄 skillOperator 的 4 个文件）→ 先写 `assetCardParser`/`referenceResolver`/`planValidator` 三个纯函数 → `index.ts` 组装 → `readme.md` 写使用说明 → `NODE_ENV=dev bun run dev:plugins` → `data/tools/planOperator.tool.js`。
- **验收**：`bun run dev:plugins` 成功产出 `build/tools/planOperator.tool.js`；`bun run typecheck` 通过；在 Agent 会话里对样例卡执行 `validate`，V1–V10 各有一次**确定的**命中——其中 V9 按上表是**警告**、`validate` 仍返回成功（`ok: true` + 警告项），其余为抛错。这些是**运行时业务校验**（AGENTS.md 明令保留），**不得**改成 `.test.ts`/`check*.ts` 自检文件。
- **失败回退**：卸载 `data/tools/planOperator.tool.js`（设置 → 插件市场 → 卸载），P0/P1 的文本契约继续可用。

### K4 分镜/参考图角色分离（P0 文档）

- **目标行为**：母版只锚身份/空间/形制；构图卡只给构图；分镜格只给动作依据；视频段只吃母版。杜绝「拿一张风格图代替资产」「把三视图连成三个角色」。
- **容器与路径**：`SKILL.md` 的角色分离表 + 模板里的「引用用途」一栏。
- **数据契约**：

| 角色 | 来源 | 进入视频节点的方式 |
|---|---|---|
| 人物母版 `C*` | 图片生成节点（多视图/正脸） | `in` 端口参考，`{{ref N}}` = 身份 |
| 场景空镜 `SC*` | 图片生成节点（无人） | 同端口，只锁空间 |
| 道具母版 `P*` | 图片生成节点（白底、无人手） | 同端口，只锁形制 |
| 构图卡 `KF*` | 图片生成节点（引用母版拼板） | 构图参考，**不自动当首帧** |
| 分镜格 | 图片生成节点 | 动作依据；**未经人工验收不得回流为参考** |
| 视频段 | 视频生成节点 | 一段一节点，`segmentMap` 定位 |

- **能力降级标注**（必须写在技能里，不能假装等价）：Toonflow 走供应商 HTTP，**没有** VAE identity 通道、**没有**原生上下文 latent、**无法**控制调度器/LoRA/二采。替代手段：多图参考 + 强约束文案 + `firstFrame` 首帧续接。体检报告里固定出现 `capabilityDegraded: ["vaeIdentity", "contextLatent", "samplerControl"]`。
- **验收**：小样中每张卡的「用途」列与角色分离表一致；任何 `KF` 卡出现在视频参考里都会被人工标记为「构图参考」而非母版。
- **失败回退**：纯文档，删除即回退。

### K5 分镜头 → 视频节点映射（P1 写入 / P2 校验 / P3 展示）

- **目标行为**：给定 `segmentId`，能唯一找到视频生成节点并重生成；给定节点，能反查它属于哪一段、吃哪些卡片。
- **容器与路径**：`plan/segmentMap.json`；节点 `label` 模板；P2 `V5` 保证映射不悬空。
- **与 `canvas` 技能不冲突**：`canvas` 技能把「场次号/片段号写在名称、位置或说明中」作为剪辑顺序的唯一记录方式（`references/videoProduction.md` 第 3 节），本方案的 label 模板正是该写法的**具体化**，不引入第二套命名规则。
- **数据契约**：§1.4。
- **实现步骤**：Agent 建节点时 `renameNodes` 用固定 label → 回填 `segmentMap` → `validate` 对账 → 重生成时按 `segmentId` 取 `nodeId` 后调用该节点的 `node:generateVideo`（参数由 `getNodeTools` 返回的 schema 决定，不假设字段名）。
- **验收**：改一个 `label` 后 `validate` 报 V5 或序号冲突；按 `segmentId` 能一次命中唯一节点。
- **失败回退**：映射文件可整份重建（它只是派生数据）。

---

## 3. 分期、改动范围与风险

### 3.1 P0：文档化约定 + 资产卡模板（零代码）

| 项 | 内容 |
|---|---|
| 新增文件 | `packages/skills/assetCard/SKILL.md`、`packages/skills/assetCard/references/assetCardTemplate.md` |
| 改动文件 | 无（**不改** `packages/skills/canvas/**`，理由见 §4.2） |
| 可选叠加 | 若需让 `canvas` 技能正文里多一句指向：再建工作区 `skill/canvas/`（`skillOperator` 的 `scope: "workspace"`），同名技能在运行时优先于 `data/skills/canvas`（`apps/server/src/agent/skills/index.ts` 的 `loadAgentSkills`）；这属于**用户工作区数据**，不修改仓库里的 `canvas` 技能，也不受「首次安装不覆盖」限制 |
| 改动边界 | 只新增目录；`SKILL.md` frontmatter 必须含 `name: assetCard` 与非空 `description`（`apps/server/src/agent/skills/index.ts` 的校验） |
| 风险 | 技能无代码约束，规则会漂移；用户不读技能就直接建节点 |
| 回退 | 删目录（`SKILL.md` 是技能识别入口，`assetCard` 会被整体过滤）；若已建工作区覆盖，再删 `<ws>/skill/canvas/` 即恢复全局 `canvas`。宿主另有 `disabledSkills` 开关（`utils/skills/files.ts` 的 `setEnabled`），技能正文里没有此开关，不要写进技能 |

### 3.2 P1：声明式参考接线协议 + 工作区索引

| 项 | 内容 |
|---|---|
| 新增文件 | `packages/skills/assetCard/references/referenceResolution.md`（三级优先级 + 守卫 + 样例）、`plan/assetIndex.json`、`plan/segmentMap.json`（工作区产物，随项目走，不入库） |
| 改动文件 | `packages/skills/assetCard/SKILL.md` 增加索引产出步骤 |
| 改动边界 | Agent 只按规则产索引；**不下发 `connectNodes` 的工具**（权限过大，接线仍由 Agent 显式执行） |
| 风险 | Agent 漏产出索引或顺序写错；索引与画布漂移（`nodeId` 失效） |
| 回退 | 删除 `plan/*.json`；技能继续可用，只是退化为 P0 的纯文字约定 |

### 3.3 P2：确定性校验工具（校验器与执行分离）

| 项 | 内容 |
|---|---|
| 新增文件 | `packages/tools/planOperator/{package.json,tsconfig.json,build.ts,readme.md}`、`src/{index.ts,assetCardParser.ts,referenceResolver.ts,planValidator.ts,indexStore.ts}` |
| 前置动作 | 新增 workspace 包后先 `bun install`（由人工显式执行，**不挂**到开发/构建命令上），否则 `bun run typecheck` 与构建都找不到该包 |
| 改动文件 | 无宿主改动 |
| 改动边界 | 只用 `context.files`；不 import `node:fs`、`Bun.file`；不新增路由（**不碰 `apps/server/src/router.ts`**）；不新增测试文件 |
| 风险 | 工具不是沙箱，Agent 仍可用 `workspace`/`write` 等宿主工具直写绕过（`packages/tools/workspace` 自带 read/edit/write/ls，`downloadImage` 另走 `importImage`）；规则更新需重装 `.tool.js` |
| 回退 | 插件市场卸载；`toolConfigs` 残留无害 |

### 3.4 P3：画布资产卡展示扩展（可选）

| 项 | 内容 |
|---|---|
| 新增文件 | `bun run create:ext assetCardView`（`package.json` 的 `create:ext` → `bun packages/extScaffold/create.ts`）生成 `packages/ext/assetCardView/{package.json,tsconfig.json,viteConfig.ts,readme.md,src/{metadata.ts,index.ts,index.vue}}` |
| 生成后必改 | 生成器的 `metadata.ts` 默认是 `resourceKind: "file"`、`extensions: ["assetcardview"]`、`text: true`；必须改成 `resourceKind: "canvasNode"`、`extensions: []`（`extScaffold/src/runtime.ts` 的 `defineExt` 只对 `file` 校验后缀非空），并删掉默认的 `fontSize` 配置与 `<textarea>` 演示内容 |
| 改动文件 | 无 |
| 改动边界 | `resourceKind: "canvasNode"`；只读；不承担校验权威；**不 import `apps/web/src`** |
| 关键实现事实 | `canvasNode` 扩展**没有节点数据读写通道**：`ExtContext.resource` 只给 `{kind,directory,path,nodeId,label}`，`files` 只能读 `directory` 下的工作区文件。因此面板必须建立 **`directory` 来自 `resource.directory`、`label` 与卡片快照对账** 的公共快照：先读 `plan/assetIndex.json`、`plan/segmentMap.json`、`plan/assetReport.json` 自渲染；找到同 `nodeId` 的媒体节点时，再用 `context.mountNode(element)` 把原节点视图挂进面板（同 `packages/ext/canvasNode/src/index.vue` 的做法） |
| 命名注意 | 生成器只在下发 `<name>` 时检查小驼峰；`assetCardView` 合规。`defineExt` 对 `id` 要求 `ext-<小驼峰>`，生成结果 `ext-assetCardView` 合规 |
| 风险 | 无 node 数据通道 → 面板只能展示「索引里已有的内容」，画布改动后需 Agent 重新 `build`；扩展与工具规则不一致会产生两套真相 |
| 回退 | 卸载 `data/ext/ext-assetCardView.umd.js`；`data/ext/bundled.json` 里对应条目由 `initializeExt` 维护，手工删除后重新构建会补回（回滚脚本见 §3.6） |

### 3.5 可选（需单独授权，不在本期）

- **节点侧 guard**：在 `videoGenerationNode` 的 `node:setPrompt` / `node:generateVideo` 里前置调用同一套 `planValidator`（经 `packages/nodeShared` 导出），从「工具级校验」升级为「生成前强制」。会改节点源码，并在 `bun run dev:plugins` 时打包 UMD，须单独任务与单独回滚。

### 3.6 期次完成后的清理动作（回滚到零）

```powershell
# 0) 先确认目标落在预期目录
Resolve-Path packages/skills/assetCard, packages/tools/planOperator, packages/ext/assetCardView, data/skills/assetCard
# 1) 仓库侧：删除新增包与技能
Remove-Item -Recurse -Force packages/skills/assetCard
Remove-Item -Recurse -Force packages/tools/planOperator
Remove-Item -Recurse -Force packages/ext/assetCardView
# 2) 运行时侧：删除已同步的插件（应用内「插件市场 → 卸载」等效）
Remove-Item -Recurse -Force data/skills/assetCard
Remove-Item data/tools/planOperator.tool.js -Force
Remove-Item data/ext/ext-assetCardView.umd.js -Force
# 3) 产物（tools/ext 的 build 目录是整目录重建，下次构建自然消失）
Remove-Item build/tools/planOperator.tool.js, build/ext/ext-assetCardView.umd.js -Force -ErrorAction SilentlyContinue
# 4) 删除 workspace 包后重新链接：bun install（人工执行）
# 5) 工作区内的 plan/ 与 assets/assetCards.md 由用户决定是否保留（不影响任何宿主功能）
```

> `bun install` 由人工显式执行，不挂在开发/构建命令上（AGENTS.md）。技能同步目录 `data/skills` 只有首次安装才复制、不覆盖用户改动，所以删仓库目录后**必须**同时删 `data/skills/assetCard`，否则技能仍在。

---

## 4. 判定「不移植」的部分

### 4.1 强依赖本地 ComfyUI / VAE / 工作流（LSC 报告 §8 全表）

| LSC 机制 | 不移植理由 |
|---|---|
| VAE identity 注入（`attach_identity_reference`、KSampler 二路 latent） | API 模型只能收「参考图 + 文本」，没有可注入的中间 latent；**改用多图参考 + identity_clause 文案** |
| ComfyUI 图节点改写（`configure_graph` / `configure_encoder`：`TextEncodeQwenImage21`、`EmptyLatentImage`、`images.N`、`negative_prompt`、`resolution`） | Toonflow 不感知 ComfyUI，供应商侧无节点可改；负向词只能并进提示词，空镜清空只能靠「不传图」 |
| 多轨工作流模板（`easy multitrackProject`、`graph_for` 写 `track_data`/调度器/LoRA/`upscale_by`） | `freevideo.ts` 只暴露 prompt + 参考 + 时长 + 分辨率 + 比例；调度器/LoRA/二采不可控 |
| 原生上下文续接（`context_latent`、`context_ok`） | 供应商无 latent；**退化为 `firstFrame` 首帧续接或视频参考**，并在体检里标 `capabilityDegraded` |
| 24fps 帧数格点 `output_frames(s)` | API 侧是秒数枚举（MiniMax-H3 2–60 秒），重做时长量化（向下取整到供应商允许的秒数） |
| ComfyUI 队列/幂等（`/prompt`、`/history`、`/queue`、`SERIAL`/`LOCK`） | 供应商契约是 `POST /jobs` + `GET /jobs/{id}?wait=25`；Toonflow 侧已是该形态，不重造 |
| `preflight` `GET /object_info/<class>` | 无节点概念；用供应商 `mode`/`durationResolutionMap` 声明代替（已存在） |
| 像素预算 `apply_quality`（MP → EmptyLatentImage） | 无 latent 尺寸可改；`megapixels ← resolution`（1K/1.5/2.0）已是唯一入口 |
| KSR 角色卡版面契约（第三格高斯模糊、影棚冷灰底） | 针对 Qwen Image 2.1 的模板，换模型必须重写；本方案只保留「版面要求写进提示词」的通用形态 |
| 本地模型路由（q6/q8、`LOCAL_AGENT_ROUTE`、9B→27B 降级） | 宿主已有模型设置，多模型编排是另一个需求 |

### 4.2 架构与文档层面的不移植

| 对象 | 理由 |
|---|---|
| 巨型 `main.py`（883 KB，路由 + 启动器 + 编排耦合） | 与 AGENTS.md「一接口一文件、`createApp` 装配、`utils/<业务>`」冲突；Toonflow 已有 Express 分层 |
| `native_h3_project` 全量数据形状（`assets[]`/`segments[]`/`signatures()`/`records`） | 画布 JSON 由 Vue Flow + 节点自行持有，复制一分等于造第二套真相；只借它的两个**语义**（参考顺序 = Picture 号、段级 `system_prompt` 拼接） |
| 修改 `packages/skills/canvas/**` 的既有正文 | 该技能已在 `data/skills/canvas` 安装，首次安装后宿主**只补缺失文件不覆盖**（`apps/server/src/utils/plugins/initialize.ts`）；仓库里改了正文，既有用户的 `data/skills/canvas` 不会更新，会造成「仓库文档」与「实际运行文档」不一致。**新约定一律放新技能 `assetCard`**，跨技能引用按 `available_skills` 的 `location` 定位 |
| 改 `apps/server/src/app.ts` / `index.ts` 去注册新目录 | `initializePlugins` 已按 `build/*` → `data/*` 通用同步，新增包无需改宿主 |
| 新增 `apps/server/src/routes/**` 与 MCP 管理操作 | 无必要；校验走工具，展示走扩展，避免 `bun run routes` 与 `router.ts` 变更 |
| 新增测试文件与测试脚本 | AGENTS.md 明令禁止；验收全部用手动 + 既有 `typecheck`/`build` |

### 4.3 明确列为「本期不做」的能力

- 自动生成 `{{ref N}}` 的写入型 nodeTools（当前 `referenceOrder` 只能读，Agent 靠连线顺序影响排序）。
- 拼板（`pack_composition_references`）的自动实现：P2 只在 V8 触发时**提示**用户改用拼板或降参考数，不做图像合成（那需要图像库与 `@toonflow/file` 之外的路径）。
- 空图/纯色拒收（`director_image_health`）：P3 扩展可读取产物并**提示**，但不阻断生成。

---

## 5. 验证命令与手动验收清单

### 5.1 命令（按仓库实际脚本）

```powershell
# 0) 新增/修改 workspace 包后，人工执行一次（根 package.json 已声明 workspaces 通配）
bun install

# 全仓类型检查（根 package.json: bun run --filter '@toonflow/*' typecheck）
bun run typecheck

# 单包：包内脚本是 "typecheck": "tsc"，没有 build 脚本时用根脚本驱动
bun run --cwd packages/tools/planOperator typecheck
bun run --cwd packages/ext/assetCardView typecheck

# 构建并同步到 data/（NODE_ENV=dev 才会写 data/tools、data/ext、data/nodes）
# 根脚本已带 NODE_ENV=dev；Windows 下若直接跑包内构建，须显式设环境变量
$env:NODE_ENV = "dev"; bun run dev:plugins

# 只构建全部工具（清空 build/tools，不写 data/）
bun run build:tools

# 生产构建（含 tools/ext/web/server）
bun run build
```

- **P0/P1**：无代码，只需 `git status --short` 确认仅新增 `packages/skills/assetCard/**`（以及可选的 `docs/`）。
- **P2**：`bun run dev:plugins`（`NODE_ENV=dev`）→ 产物 `build/tools/planOperator.tool.js` 且 `data/tools/planOperator.tool.js` 出现；`bun run typecheck` 通过。
- **P3**：`bun run dev:plugins` → `build/ext/ext-assetCardView.umd.js` 与 `data/ext/ext-assetCardView.umd.js`；`bun run --cwd packages/ext/assetCardView typecheck` 通过。
- **不含测试**：不新增任何 `.test.ts`/`.spec.ts`/`check*.ts`，`package.json` 不新增测试脚本。
- **本方案的验证状态**：以上命令**均未在本方案编写期执行**（P0–P3 尚未实现，本文件与审阅任务只做文档）。已核对的只是命令形态与脚本名（根 `package.json`、各包 `package.json` 的 `scripts`）。实现期必须逐条真跑并如实记录，不得把「构建通过」说成「行为已验证」。

### 5.2 手动验收清单（每期各自勾选）

**P0**
- [ ] 技能出现在 Agent 的 `available_skills`（`skillOperator(action=list)`），`description` 非空。
- [ ] 用模板建 5 张卡（C01、C01-A、SC01、P01、KF01），编号唯一、字段别名可读。
- [ ] 混入 `C1`、`c01-b` 这类非补零/小写卡号时，索引按 `C01`、`C01-B` 规范化，且不与 `C01` 重复报错。
- [ ] 触发「新建资产卡」任务时，Agent 先读模板再落盘，未自造格式。

**P1**
- [ ] 同一份卡两次生成 `plan/assetIndex.json`，除 `nodeId` 外一致。
- [ ] 构造四类反例：`身份参考：SC01`（前缀错）、`与 C01 以服装区分`（人物否定）、前向引用、`少年`/群像卡，均**不接线**且写入 `warnings`。
- [ ] `C03-B` 无声明时回落到源文件第一张同前缀卡。
- [ ] 构图卡排在 bases 之后，依赖来自提示词正文编号。
- [ ] 按段重生成：用 `segmentId` 从 `segmentMap.json` 找到唯一 `nodeId`，成功调用 `node:generateVideo`。

**P2**
- [ ] `validate` 对 V1–V10 各报一次中文错误，错误文案含卡片 ID 与字段名。
- [ ] `validate` 零写入：执行前后 `Get-ChildItem plan` 的 `LastWriteTime` 不变。
- [ ] 对「已接线但 `referenceOrder` 被手动打乱」的节点，V6 报警并指出期望顺序与实际顺序。
- [ ] `{{ref 3}}` 超出参考数时报 V7；空镜参考集非空（或混入 VIDEO/AUDIO）且参考图 3 张时 V8 触发（`MiniMax-H3` 只剩 `startFrameOptional` 的 2 图）。
- [ ] 连第 3 张图后节点 `data.mode` 被自动切成 `startFrameOptional` 时，V10 报错并提示恢复 `imageReference` 模式。
- [ ] `configRules` 中的开关项出现在设置面板，改值后下一轮消息生效。

**P3**
- [ ] 在文档标签页打开画布节点，出现「资产卡」视图；`active` 切换时挂载/卸载不泄漏（`mountNode` 释放）。
- [ ] 无 `plan/assetIndex.json` 时给出空状态提示而不是报错。
- [ ] 卸载扩展后画布节点显示与行为完全恢复。

---

## 6. 风险表与回滚策略

| # | 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | **模型差异**：`freevideo`（MiniMax-H3）与 LSC 的 Qwen Image 2.1/H3 本地链路能力不同 | identity 保真度下降，构图卡可能被当首帧 | 技能内固定写 `capabilityDegraded`；母版优先、构图卡默认不连视频节点 | 关闭约定即回退到现有 `videoProduction.md` 流程 |
| R2 | **LLM 不守 JSON**：Agent 手写 `assetIndex.json` 可能格式错、顺序错 | 接线错乱 | P1 用严格模板 + 示例；P2 `parse/validate` 立即报错；`build` 用 `context.files.writeFile`（内部 `writeWorkspaceFile`，非 `exclusive` 即整文件覆盖、带工作区文件锁）写三份快照，任一规则未过就不写 | 删除 `plan/*.json` 重新生成 |
| R3 | **工作区路径边界**：`plan/` 与 `assets/` 都在工作区内，`resolveWorkspacePath` 会拦越界（`isAbsolute`、任一段为 `..`、含 `<>:"\|?*` 与控制字符均拒） | 工具读写路径写错会直接抛错 | 工具只接受相对路径，全部经 `context.files`；符号链接越界由宿主 `resolveWorkspacePath` 实际路径判定承担，不在工具里重复实现 | 卸载工具 |
| R4 | **插件市场发布**：`.tool.js` 头部元数据（`name` 必须 `^[a-z][a-zA-Z0-9]*$`）、版本号必填、`readme` 嵌入、`configRules` 纯 JSON、单文件 ≤20 MB | 安装被拒或降级被 `Bun.semver.order` 拒绝 | 用 `skillOperator` 的样板；版本从 `package.json` 读；不在 `build.ts` 重复配置 | 保留上一版 `.tool.js` 文件直接重装 |
| R5 | **同步语义（三类插件各不相同）**：tools 目录以 `pluginRevision` 标记同步（开发态为 `"dev"`，`bun run dev:plugins` 会覆盖同名 `.tool.js`）；ext 目录看版本号与内容哈希；`data/skills` **只补缺失、不覆盖** | 升级后行为不一致 | 工具靠 `dev:plugins` 重同步；**技能改动必须手工同步到 `data/skills/assetCard` 或删掉后重启补齐**；变更规则时提升 `package.json.version` | 删 `data/tools/*.tool.js` / `data/skills/assetCard` 后重启 |
| R6 | **工具不是沙箱**：Agent 可绕过工具用宿主自带 `read`/`write`/`edit` 直写工作区 | 校验被绕过 | 文档明确「工具是检查器不是闸门」；要强约束时再上节点侧 guard（§3.5） | 回退到 P1 文本约定 |
| R7 | **扩展无节点数据通道**：`ExtContext` 不提供节点 `data` | P3 面板内容可能滞后于画布 | 面板只认 `plan/*.json` 快照，并在头部显示 `generatedAt`；不宣称实时 | 卸载扩展 |
| R8 | **双份真相**：资产卡 Markdown 与画布节点并存 | 改一处忘另一处 | `assetCards.md` 是唯一权威，节点只回填 `nodeId`；`validate` 对悬浮引用报 V5 | — |
| R9 | **`{{ref N}}` 编号漂移**：增删连线后排序变化，且**连线变化会让节点 `watch` 自动改写 `data.mode`** | 提示词指向错误素材；参考图悄悄变成首帧 | 每次接线/删边后重新 `setPrompt`（`canvas` 技能既有要求）+ V6/V7/V10 校验；出图前由人确认模式 | 重新走一遍接线 |
| R10 | **成本与并发**：一次校验/生成消耗供应商额度；多 Agent 同改一画布 | 计费与覆盖 | 生成前由用户确认；同一画布同一时刻只允许一个 Agent（沿用 `canvas` 技能约束） | 取消生成（节点已有 `cancelGeneration`） |

**全局回滚原则**：所有新增物都在「独立技能目录 + 独立包 + 独立工作区文件」三层里，宿主代码零改动；任一层删除都不影响其余层，最坏情况回到今天的手工接线流程（`packages/skills/canvas/references/videoProduction.md` 第 3 节）。

---

## 7. 附：关键文件索引（实现时照读）

- 技能：`packages/skills/canvas/SKILL.md`（frontmatter、跨技能定位约定）、`packages/skills/canvas/references/videoProduction.md` 第 3–4 节（接线与核对现状）
- 技能加载：`apps/server/src/agent/skills/index.ts`（工作区 `skill/` 优先、`SKILL.md` 校验）
- 工具样板：`packages/tools/skillOperator/{build.ts,package.json,src/index.ts}`、`packages/tools/canvas/src/runtime.ts`（画布读取/接线 schema）、`packages/toolScaffold/index.ts`（`createToolConfig`：版本、`readme` 嵌入、`NODE_ENV=dev` 同步 `data/tools`）
- 工具宿主：`packages/toolScaffold/src/runtime.ts`（`ToolPlugin`、`ToolContext.files`、`toolNameSchema`）、`apps/server/src/agent/tools/index.ts`（`files` 的工作区边界与锁）、`apps/server/src/utils/plugins/tools.ts`（元数据解析）、`apps/server/src/utils/plugins/initialize.ts`（`build/*` → `data/*` 同步）
- 节点契约：`packages/nodeScaffold/readme.md`（`nodeTools.register`、`{{ref N}}`）、`packages/nodeShared/src/useNodeReferences.ts`（`referenceOrder` 键与排序）、`packages/nodes/videoGenerationNode/src/index.vue`（`setPrompt`/`generateVideo`/模式匹配）
- 扩展：`packages/extScaffold/src/runtime.ts`（`ExtContext`/`ExtDefinition`）、`packages/extScaffold/create.ts`（生成器）、`packages/ext/canvasNode/src/index.vue`（`mountNode` 用法）
- 媒体：`packages/providers/src/media/freevideo.ts`（模式与时长/分辨率声明）
