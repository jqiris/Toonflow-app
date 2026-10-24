# 多轨提示词「单字段化」兼容设计（数据结构决策稿）

> **状态：过程稿，方案未采纳（2026-10-23）。** 本轮最终落地的是「保留三字段存储 + 参考标记统一 `{{ref N}}`」，未做单串改造。本文档保留作为 master 基线与风险评估记录，文中的「单串」实现清单不作为执行依据；现行口径见 `packages/skills/assetCard/references/multitrackTemplate.md` §四 与 `generationRunbook.md` §四。


> 状态：设计稿，**不实施**。本文只回答「数据结构怎么改、连带改哪里、老工程怎么读」，不修改任何业务代码或技能文档。
> 上游：[基线盘点](promptCompatBaseline.md)（master 兼容结构）、[差异盘点](promptCompatDelta.md)（58 处改动与三处断点）、[freevideo 路径规范](promptCompatFreevideo.md)（六段/三段的真实分界）、[非 freevideo 格式](promptCompatNonFree.md)（格式卡与误伤清单）。
> 主方案：[条件分流与多轨兼容方案](promptCompatRouter.md)。本文是它的数据结构分册。
>
> 写作约束：全文不出现双花括号模板字面量，旧REF占位标记一律以文字指代。

---

## 0. 一页结论

1. **选 a：`clips[].prompt` 收敛为一个字符串**。三字段不是「内容模型」，而是某一供应商段结构的物化；把它留在类型里，任何新写作者都会继续以为它有意义。
2. **读时兼容，写时不双写**。`readPrompt` 在归一阶段把老工程三字段合成一段；合成算法与现行 `buildPrompt` 的下发结果逐字对齐，所以老工程第一次读入后派工内容不变。
3. **`buildPrompt` 退化为「工程前缀 + 正文原样透传」**，删除自动补段首与自动追加两个声音段。这两件事本来是执行层在替写作者补格式，正是「格式随供应商切换」要消灭的东西。
4. **校验器只校验「有没有内容」，不校验「像不像某家格式」**。V11 从三条（1 error + 2 warning）收成一条；V7 的官方标记边界校验只在工程模型确为 MiniMax-H3 时执行。
5. **不承诺降级读取**。`packages/nodeShared/src/mtrack/` 在本分支才出现，master 树中不存在（`git cat-file -e master:packages/nodeShared/src/mtrack/mtrackProject.ts` 失败），即三字段从未随任何已发布版本触达用户，没有需要兼容的历史磁盘数据。所谓「老工程」只指本分支自测生成的工作区文件。
6. **两处 `mtrackProject.ts` 副本收敛**：`packages/nodeShared/src/mtrack/mtrackProject.ts` 为唯一真源，`packages/tools/planOperator/src/mtrackProject.ts` 改为包依赖复用；顺带消除已存在的 `updatedAt` 默认值漂移。

---

## 1. 现状契约点全景

三字段目前被 **9 类、18 个契约点**消费，任何一类漏改都会造成「写进去读不出」或「校验通过但派工为空」：

| # | 契约点 | 位置 | 现在 | 单字段后 |
|---|---|---|---|---|
| 1 | 类型定义（真源） | `packages/nodeShared/src/mtrack/mtrackProject.ts:10-14` | `ClipPrompt` 三字段全必填 | `prompt: string` |
| 2 | 类型定义（副本） | `packages/tools/planOperator/src/mtrackProject.ts:10-14` | `MtrackClipPrompt` 复制 | 删除，改为 type-only 引用 |
| 3 | 读归一（真源） | `mtrackProject.ts:126-133` | `readPrompt` 三字段逐个 `readString` | 字符串直读；对象走合成 |
| 4 | 读归一（副本） | `planOperator/src/mtrackProject.ts:67-74` | 同上，且 `:94` 的 `updatedAt` 默认值与真源不一致 | 删除，复用真源 |
| 5 | 工程归一 | `mtrackProject.ts:145-179` / 副本 `:86-129` | `normalizeProject` 调各自 `readPrompt` | 只保留真源一份 |
| 6 | 空判定 | `mtrackProject.ts:213-217` `hasPrompt` | 三字段任一非空 | `!!prompt.trim()` |
| 7 | 建镜 | `mtrackProject.ts:199` | 三字段全空串 | `prompt: ""` |
| 8 | 补丁合并 | `packages/nodeShared/src/mtrack/mtrackEdit.ts:34-37` | 对 `prompt` 做三字段浅合并 | 整串替换 |
| 9 | 节点补丁 schema | `packages/nodes/multitrackNode/src/index.vue:336-340` | `z.strictObject` 三字段 `z.string()` 必填 | `prompt: z.string()` |
| 10 | 计划侧 schema | `packages/tools/planOperator/src/index.ts:24-28` | `z.looseObject` 三字段 optional | `z.string()` |
| 11 | 结构校验 V11 | `packages/tools/planOperator/src/planValidator.ts:151-153` | 首字段空→error，两声音字段空→warning | 单字段空→error |
| 12 | 标记校验 V7 | `planValidator.ts:204-208` | 三字段枚举为 `fields` | `fields = [prompt]` |
| 13 | 编辑器三框 | `packages/nodeShared/src/mtrack/components/clipEditor.vue:96-124` | 画面 5 行 + 环境声/配乐各 2 行 | 单框 12 行 |
| 14 | 整理可用性 | `clipEditor.vue:217-219`、`:226-228` | 三字段任一非空；守卫比 `integrated` | `prompt.trim()`；守卫比 `prompt` |
| 15 | 派工拼装 | `packages/nodeShared/src/mtrack/directDispatch.ts:97-114` | 前缀 + 自动段首 + 两声段尾 | 前缀 + 正文 |
| 16 | 整理接口 | `apps/server/src/routes/mtrack/rewriteShot.ts:10-14`、`:23-24`、`:75-80` | 三字段入参、三段拼给模型 | 单串入参、单串提示 |
| 17 | 重置/采用 | `packages/nodeShared/src/mtrack/multitrackEditor.vue:830-851`、`:866-877`、`:890-896` | 只回写 `integrated` | 整串回写 |
| 18 | 工具描述与引导 | `planOperator/src/index.ts:391-396`、`mtrackNode:531`、`generationRunbook.md:514`、`:596` 等 | 按三字段描述 | 按单串描述（见 §7） |

不在此表但同样受影响的是 **wire 层**：`packages/nodes/videoGenerationNode/src/index.vue:225-238` 只读 `data.prompt`，与多轨数据形状无关，所以单字段化对 wire 零影响——这也说明「三字段」从头到尾只是多轨编辑器的私有约定，没有渗进节点契约。

---

## 2. 三方案评估

| 判据 | a 单字符串 | b 三字段留壳、UI 只写第一个 | c 联合类型兼容 |
|---|---|---|---|
| 老工程读取 | 归一阶段合成，天然兼容 | 不需要迁移，但另两个字段永远悬空 | 需要判别器，老数据无判别器 |
| 换非 H3 供应商 | 字段切分消失，格式完全由正文承载 | 仍要回答「另两个字段放什么」 | 仍需为每供应商定一个变体 |
| UI 成本 | 三框→一框，删两处绑定 | 一框 + 两隐藏字段，最省 | 一框 + 类型分支 |
| 校验器 | V11 一条、V7 单字段 | V11 仍要解释为何隐藏字段可空 | 每个变体一套校验 |
| 派工 | `buildPrompt` 只剩前缀 | 仍要决定是否拼隐藏字段 | 仍要按变体拼装 |
| 文档改写量 | 6 处规则改写法，4 处工具描述改措辞 | 几乎不改，但文档要长期解释「为什么有三个字段」 | 与 a 接近，另加类型说明 |
| 回退 | 文件保存后旧代码读不出（无历史数据，可接受） | 读写都可回退 | 半回退 |
| 长期漂移 | 最低：只有一个真相 | **最高**：字段存在即接口 | 中：两套形状长期并存 |

**推荐 a。** 理由是 b 的隐性代价最大：只要类型上还留着三个字段，`buildPrompt`、`rewriteShot`、`planValidator` 就永远要回答「另两个字段算不算内容」；而这个问题在有非 H3 供应商参与时**没有正确答案**——H3 的两个声音段在 Seedance 里应该并进镜头描述，在 Wan 里根本不存在对应段落。字段在、语义不在，就是漂移源。这正是 [差异盘点](promptCompatDelta.md) 所说的「按 H3 段结构切的字段，换供应商必然不合规」。

c（联合类型）看起来最严谨，但需要一个判别器，而工程里唯一稳定的判别信息是 `global.model`——它只是声明值，可以被 UI 改写（`multitrackEditor.vue:665-671`），派工时才由 `configureNode` 真下发（`directDispatch.ts:364-384`）。把磁盘结构挂在一个「可被改写的声明」上，等于把不稳定性写进类型。

---

## 3. 单字段化的完整规格

### 3.1 新类型

```
MtrackClip.prompt: string
MtrackProject.global: { ratio?; style?; systemPrompt?; model?: VideoModel }
VideoModel: { providerId?: string; modelId?: string }
```

- `ClipPrompt` 类型整体删除，不做别名保留（保留别名等于 b）。
- `createClip` 写 `prompt: ""`；`hasPrompt` 只看 `prompt.trim()`；`cloneClips` 深拷贝退化为值拷贝。
- `global` 三个可选字段不变：`style` / `systemPrompt` 仍是工程级前言，`model` 仍是声明值。

### 3.2 读：`readPrompt` 的兼容算法

输入 `unknown`，输出 `string`：

1. 是字符串 → 原样返回（不 `trim`，`trim` 留给写作者与派工）。
2. 是对象 → 按「画面正文 → 环境声 → 非叙事音乐」顺序合成：
   - 画面对应 `integratedMultimodalDescription`，**不加字段名**（它内部本来就承载 H3 的多个段首）。
   - 环境声对应 `overallSoundscape`，非空时写成「`overall_soundscape: ` + 内容」。
   - 非叙事音乐对应 `nonDiegeticMusic`，非空时写成「`non_diegetic_music: ` + 内容」。
   - 段间用 **一个空行**（两个换行）分隔；空段整段省略，不产生前导/尾随空行。
3. 其余类型 → 空串。

**为什么用官方字段名而不是裸文本**：旧 `buildPrompt` 拼出来的尾段就是这两个字段名（`directDispatch.ts:107-112`），沿用同一写法可让「迁移前后下发内容一致」；同时声音内容离开字段后，只有字段名能告诉后续读者「这段是声音，不是画面」。

**与旧 `buildPrompt` 的差异只有一处**：旧逻辑在正文不以官方段首开头时，会按 `referenceIds.length` 自动补一个 `detailed_description: ` 或 `integrated_multimodal_description: ` 前缀（`directDispatch.ts:106`）。合成不做这件事。原因：

- 这个补全按「有没有挂参考」猜任务类型，本身就是错的（`startFrameOptional` 任务挂了参考图但不是 ref2va，见 [freevideo 规范](promptCompatFreevideo.md) D5）。
- 补全把 H3 的段名写进执行层，换供应商后就是污染。
- 代价可控：合成后正文若缺段首，由 V7 给一条**提示级**警告（§6.2），不回写、不代写。

若团队评估后认为这条差异不可接受，唯一保形方案是「读时补段首」——但那等于把 H3 段名固化进归一函数，和本轮目标相反，**不建议**。

### 3.3 写：唯一写入口

| 写入路径 | 位置 | 规则 |
|---|---|---|
| 编辑器补丁 | `multitrackEditor.vue:890-896` → `mtrackEdit.ts:34-37` | `prompt` 整串替换，不再做字段浅合并 |
| 节点编辑 | `multitrackNode/src/index.vue:336-340`、`:407-418` | `prompt: z.string()`，`strictObject` 保留（旧形状直接拒绝，避免半迁移） |
| 整理采用 | `multitrackEditor.vue:866-877` | 整串回写 |
| 计划侧读 | `planOperator/src/index.ts:91-92`、`:191` | 继续禁写 `prompt`（真源由编辑器/技能写），不变 |
| 建镜 | `mtrackProject.ts:199` | `prompt: ""` |

**不做双写，不写 `promptFormat` 版本位**。理由：三字段从未发布；加一个版本位只会在下一个版本再问一次「这个位还准不准」。

### 3.4 老工程读取与迁移

- **读取时机**：任何入口都先过 `normalizeProject`。命中的有：编辑器加载、`node:editProject` 的读改写、`planOperator` 的 `mtrackRead/validate/build`。三字段对象读出来就是单串，使用方无感。
- **迁移时机**：下一次保存。保存是整文件原子写，写出的就是单串，旧字段自然消失。不需要一次性迁移脚本。
- **不保存也不会坏**：每次读都能重新合成。
- **回退**：旧代码读新文件时，`readPrompt` 拿不到三个字段，全部补空串（`mtrackProject.ts:126-133` 的逐字段 `readString` 行为），编辑器显示空、再保存会把提示词清空。**明确不支持降级读取**；分支自测场景如需保留，切换分支前复制工作区 `.mtrack` 文件即可。
- **风险登记**：任何一次无关编辑（改比例、改状态）触发的保存都会完成迁移，此后旧代码不可读。这是「读时归一 + 单一形状」的必然代价，已由 §0.5 的无历史数据结论覆盖。

### 3.5 两处副本收敛

现状：`packages/tools/planOperator/src/mtrackProject.ts:1-8` 的头注释写「字段与枚举以 `packages/ext/multitrack/src/mtrackProject.ts` 为准」——**这个路径在现仓不存在**，说明副本从诞生起就没有可校验的真源声明。已经发生的漂移：副本 `:94` 用 `new Date(0).toISOString()` 作 `updatedAt` 默认值，真源 `:154` 用 `""`（页头「尚未保存」与 CAS 语义依赖后者）。

方案（按推荐序）：

1. **加包依赖复用**（推荐）：`packages/tools/planOperator/package.json` 的 `dependencies` 增加 `@toonflow/node-shared`（workspace 协议），从 `@toonflow/node-shared/mtrack/mtrackProject` 引类型与 `readProject/normalizeProject`。该子路径已在 `nodeShared/package.json` 的 exports 中（`./mtrack/mtrackProject`），且模块本身不引 Vue/Element Plus，不会把前端依赖拖进工具包。planOperator 只保留自己的薄包装（读文件、CAS、路径解析）。
2. **若部署链路不允许新增运行时依赖**：保留副本，但必须（a）头注释改为指向真源、（b）拷贝的函数加上「同步自 `<真源路径>`，改动需同步」标记、（c）先修掉 `updatedAt` 漂移。这是下策，漂移只是被标注而非消除。

无论选哪条，`packages/nodeShared/src/mtrack/mtrackProject.ts` 是唯一真源，这一条要写进文件头注释。

### 3.6 三处 zod schema

- `planOperator/src/index.ts:24-28`：`clipPromptSchema` 改 `z.string()`。原 `z.looseObject` 的宽松语义要保留吗？不保留——多轨提示词不接受额外键，否则 agent 会传 `{ integratedMultimodalDescription: ... }` 而被静默吞掉。
- `multitrackNode/src/index.vue:336-340`：`prompt: z.string()`，外层 `strictObject` 不变。
- `rewriteShot.ts:10-14`：`prompt: z.string().max(20000)`（与现有整理上限一致），删除三字段对象。

三处都不加 `min(1)`：空串是合法的「待填写」状态，由 V11 与 UI 的「整理可用性」判断，不在 schema 层拒绝。

---

## 4. UI 与 `buildPrompt` 的连带改法

### 4.1 `clipEditor.vue`：三框换一框

- 删除 `:105-124` 的两框并排布局，`:96-104` 的原「画面/动作/对白」框扩为 `rows=12` 的「本镜提示词」。
- 绑定 `clip.prompt`；`@input` 走既有 `onPatch`，整串替换。
- 顶部 `:84-95` 的参考顺序区保留，但标签与说明改为供应商中立：
  - 标签：「参考顺序（位置从 1 起）」
  - 说明：「写进提示词时的编号规则由工程所选视频模型决定，编号写法以该模型的格式卡为准。」
  - 列表项只显示位置 + 卡片 id + 卡片名，**不显示任何 `<Picture N>` 之类的标记**——标记是模型的写法，不是编辑器的概念。
- 占位提示（**不得绑定供应商**）：「按工程当前视频模型的官方格式书写本镜；参考用该模型要求的标记写法指位。」
- 辅助行（动态读 `project.global.model`，不是写死文案）：
  - 有声明：「当前模型：`{providerId}` / `{modelId}`（工程声明；派工以节点实时配置为准）」
  - 无声明：「工程未声明模型，派工前按目标节点实时配置确认。」
  这一行只是把数据摆出来，不解释格式。
- 「整理规则」`details`（`:125-134`）保留，输入内容原样传给 `rewriteShot` 的 `rules`。
- 「待采用」区块（`:135-167`）保留，`basis.text` 改为 `prompt`。
- `rewriteEligible`（`:217-219`）改 `!!clip.prompt.trim()`；守卫（`:226-228`）比较 `basis.text` 与当前 `prompt`。
- **UI 明确不做三件事**：不渲染「合成后的最终文本」预览、不做段首/结构校验、不自动补任何前缀。原因：一旦 UI 会预览合成结果，它就成了第二套格式实现。

### 4.2 `buildPrompt`：退化为「前言 + 正文」

新契约（`directDispatch.ts:97-114` 范围内）：

```
constraint = [style && "全片风格：" + style, systemPrompt && "全片约束：" + systemPrompt].join("\n")
return [constraint, prompt.trim()].filter(Boolean).join("\n")
```

删除三件事：

1. `officialSection` 自动段首（`:95`、`:106`）。
2. 两个声音字段的尾段拼装（`:107-112`）。
3. 依 `referenceIds.length` 判六段/三段的分支（随 1 一起消失，D5 直接消解）。

保留一件事：工程级前言。理由：它是**工程配置**，不是格式；丢掉会让已填 `style` 的工程失去约束，而塞进 `[Shot 1]` 定语属于执行层改内容，违反「执行层只搬运」。

结论：`buildPrompt` 从「拼装器」退化为「前缀器」，这也是单字段化带来的最大简化——它与供应商彻底解耦。

### 4.3 老工程的两个声音字段在派工时不会丢

证明链：

1. 读取：`normalizeProject` → `readPrompt` 把两个声音字段带字段名合成进 `prompt`。
2. 派工：`beginDirectDispatch`（`multitrackEditor.vue:1070-1077`）传的是整份 `project`；`dispatchClips`（`directDispatch.ts:407-446`）只读 `clip.prompt`。
3. 写入节点：`node:setPrompt`（`videoGenerationNode/src/index.vue:453-463`）写 `data.prompt` 整串。
4. wire：`generationPrompt`（`:225-238`）只做标记换算与文本参考追加。

只要第 1 步的合成包含两个声音字段，后续任何一环都不需要知道它们曾经是独立字段。

### 4.4 D3（风格前言 vs 首行必须是 `subject_definitions`）

单字段化后，这个问题从「拼装顺序」变成「文档口径」：

- 若 `global.style` 为空（建议默认），正文首行就是写作者写的第一行，官方六段要求可满足。
- 若 `global.style` 非空，首行变成「全片风格：…」，与「首行必须是 subject_definitions:」字面冲突。

三种处理见主方案 §8 Q2。本文只给数据结构侧结论：**`style` 保持可选、不给默认值**；`multitrackTemplate.md:72` 的「必填」标记取消。这样单字段化的默认行为是「正文第一行由写作者决定」，形式最干净。

### 4.5 D4（文本参考追加在正文末尾）

`generationPrompt` 在 `non_diegetic_music` 之后追加「参考 N：正文」（`:232-237`）。单字段化不改变这一行为；六段顺序会被破坏的问题仍然存在，属于 wire 层待决项（主方案 §8 Q5），本文不设计。

---

## 5. 校验器与 `rewriteShot`

### 5.1 V11：从三条到一条

| 现在（`planValidator.ts:151-153`） | 单字段后 |
|---|---|
| `integratedMultimodalDescription` 空 → error | `prompt` 空 → error（文案：「本镜提示词为空」） |
| `overallSoundscape` 空 → warning | 删除 |
| `nonDiegeticMusic` 空 → warning | 删除 |

新增一条提示级：`prompt.length > 20000` → warning「超过整理接口上限，整理功能将不可用」。这不是格式约束，是接口事实。

### 5.2 V7：字段枚举收缩 + 边界校验按模型启用

- `fields`（`:204-208`）改为 `[prompt]`。
- 旧REF占位标记命中（`:227-235`）：保留为提示级，文案去掉「迁移」类版本叙事，改为条件句——「正文含旧REF占位标记：工程模型为 freevideo 时由 wire 换算，其他供应商下原样透传，需按该模型格式卡书写」。
- 官方尖括号标记越界（`:236-247`）：**仅在工程声明模型为 MiniMax-H3 时执行**（`global.model.modelId` 匹配 `MiniMax-H3`）。理由：`boundOf`（`:219-222`）的边界是 H3 的（图 4 / 视频 1 / 音频 1），而 Seedance 的 `<主体1>` 类标记有自己的编号体系，按 H3 边界校验会误报。模型未声明时跳过，不猜。
- V8（`:251-261`）与 V15（`:274-286`）不动。

### 5.3 段名规范性校验：不做

- **不做 error**。段名是模型格式的一部分：H3 是六个固定段名，Seedance 是三段中文标题，Wan 没有段名。硬编码任何一套都会在换供应商时误伤，这正是上一轮「同一规则散落 5–7 处」的同一类错误。
- **有条件做 warning**：仅当工程模型为 MiniMax-H3，且正文首行不以官方段首之一开头时，提示「H3 任务建议以段首字段名开头」。只提示，不代写。
- 判据来自模型声明，不来自路径形态，也不来自「有没有挂参考图」。

### 5.4 `mergePatch` 与 `validateClip`

- `mtrackEdit.ts:34-37`：`prompt` 整串赋值。
- `mtrackEdit.ts:40-64`：现状完全不校验 `prompt`，保持——内容校验在 planValidator 与 UI，编辑器不该做格式判断。

### 5.5 `rewriteShot` 契约

**请求体**

| 字段 | 现在 | 改后 |
|---|---|---|
| `providerId` / `modelId` | 必填 | 不变（模型身份必须显式，不从工程猜） |
| `prompt` | 三字段对象 | 单个字符串，≤20000 字 |
| `referenceIds` | `string[]`，≤4 | 不变 |
| `rules` | 可选，覆盖内置 | 不变 |

`refine`（`:23-24`）改为 `prompt.trim().length > 0`，错误文案「请先填写本镜提示词再整理」。

**发给文本模型的内容**（`:75-80` 重写）

1. 模型身份：`providerId` / `modelId`。
2. 参考清单：位置 + 卡片 id，**不预生成任何标记**（删掉 `:80` 的 `<Picture N>` 映射）。原因：服务端没有供应商能力表，不知道目标模型用哪套标记；预生成 H3 标记再交给 Seedance 就是污染。
3. 原文：整串。
4. 规则：用户 `rules` 优先，空则内置。

**内置规则改写**（`:26-35`）

| 现在 | 改后 |
|---|---|
| 只整理不新增剧情 | 保留 |
| 保留画面事实 | 保留 |
| 英文输出 | **保持原文语言**（英文规则只对 H3 多轨成立，对 Seedance 中文提示词是错的） |
| 不输出解释 | 保留 |
| MiniMax H3 官方标记原样保留 | 改为「原文中的段首字段名、参考标记与编号原样保留，不改写、不重排、不新增」 |

**返回**：`{ text, requiresReview: true }` 不变；前端只把 `text` 放进「待采用」，由用户确认后整串回写。

### 5.6 实施顺序（供后续实施任务，本轮不做）

1. 先改读：两处 `readPrompt` 合成（此时磁盘仍是旧形状，可回退）。
2. 再改写：schema、编辑器、`mergePatch`、`rewriteShot` 单串化。
3. 再改派工：`buildPrompt` 退化；同时上线 V7 提示级告警。
4. 最后改文档与工具描述（§7）。顺序反过来会造成「文档已改、代码还在拼三段」的中间态。

---

## 6. 兼容矩阵

| 场景 | 结果 | 说明 |
|---|---|---|
| 新工程新建 | ✅ | `prompt: ""`，写作者按模型格式卡书写 |
| 本分支旧工程（三字段）读取 | ✅ | 合成，声音段带官方字段名 |
| 本分支旧工程保存 | ✅ 单向 | 保存即迁移为单串；无关编辑也会触发 |
| 旧代码读新文件 | ❌ | 三字段全空；无已发布历史数据，接受 |
| 正文缺 H3 段首的旧工程 | ⚠️ | 不再自动补 `detailed_description:`；V7 提示级告警 |
| 多轨切非 freevideo | ✅ | 正文原样，格式由写作者按该模型卡负责（主方案 §5） |
| 单镜视频节点 | ✅ 不变 | 节点只认 `data.prompt`，与本次改动无关 |
| 文本参考追加 | ⚠️ 不变 | 仍在正文末尾，D4 未解，见主方案 §8 Q5 |

---

## 7. 需要同步改口径的文档与工具描述

只列位置与改法，不在本轮执行。

| 位置 | 现文要点 | 改法 |
|---|---|---|
| `workflow/SKILL.md:45` | 多轨产物格式硬隔离、禁 A9 字段 | 改为条件句：多轨产物格式 = 工程所选模型的格式；禁的是「格式与模型不符」 |
| `workflow/SKILL.md:54`、`:804` | 「落三字段」「按三字段写」 | 改「落本镜提示词单字段」 |
| `canvas/SKILL.md:26`、`:107` | 直连旧REF标记 / 多轨六段 | 保留「形态决定写哪里」，格式改为指针 |
| `canvas/references/videoProduction.md:45`、`:49` | 六段 + 声音两字段 + 换算通则 | 六段规则改为指向 `multitrackTemplate.md` §四；换算改条件句 |
| `assetCard/references/multitrackTemplate.md:88-90`、`:152-163` | 三字段字段表与落位表 | 改为单字段 + 「段落怎么写」表（段序与段首仍在此，仍是唯一真源） |
| `assetCard/references/generationRunbook.md:514`、`:596` | 三字段示例 / 三字段整组提交 | 单串示例 / 整串提交 |
| `assetCard/SKILL.md:85` | 写回 `prompt.integratedMultimodalDescription` | 写回 `prompt` |
| `planOperator/src/index.ts:391-396` | 四条按三字段描述 | 按单串 + 指向路由表 |
| `multitrackNode/src/index.vue:531` | agent 写回三字段之一 | 写回 `prompt` |
| `generationRunbook.md:108` | buildPrompt 现状说明（含「仅 freevideo 换算」） | 与 §4.2 新契约一致；换算条件句保留 |

---

## 8. 交给主方案与用户的结论

- **数据结构**：a，单字符串，读时合成、写时不双写。
- **UI**：一框，占位与说明供应商中立，辅助行只显示模型数据。
- **派工**：`buildPrompt` = 前言 + 正文，删除自动段首与声音尾段。
- **校验**：V11 一条；V7 字段收缩、边界校验按 H3 启用；段名不做硬校验。
- **接口**：`rewriteShot` 单串进出，规则去供应商绑定，参考清单不预生成标记。
- **副本**：nodeShared 为真源，planOperator 加依赖复用。

需要在主方案中与用户拍板的连带项：Q2（风格前言与首行的口径）、Q4（分镜首帧图的归位）、Q5（文本参考追加顺序）、Q6（是否保留旧代码可读的降级形状）。本文 §3.4 已给出 Q6 的建议答案：不保留。
