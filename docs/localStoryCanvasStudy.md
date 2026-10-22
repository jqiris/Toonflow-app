# LocalStoryCanvas 核心制作机制解剖报告

> 任务：t1（[lscStudy]）。只读研究 `C:\workspace\super-ai\LocalStoryCanvas`，未修改任何业务代码，也未改动被研究仓库。
> 核对基线：`release-status.json`（版本 20261004.2，本机 RTX 4070 Ti 12GB / 32GB 内存）、`更新说明_20261001.2/20261002.1/20261004.2`、`guide.html`、`资产卡格式规范.md`、`app/*.py`、`app/static/js/*.js`、`app/data/native_h3_projects/*.json`。
> 每条机制尽量标出「文件 · 函数」。⚠ 标记的是**代码与文档/自述不一致**或**只能依赖开发机文件才能确认**的地方。

---

## 0. 结论速览

1. **编号即身份**：`C/SC/P/KF/S` + 字母状态后缀构成全局唯一 ID；ID 是资产、参考接线、分镜引用、视频节点的唯一连接键，任何环节重复编号都直接报错，不覆盖、不重新分配（`canvas_source_cards.authored_cards`、`h3_asset_bundle.parse_bundle`）。
2. **接线是三段式降级**：显式字段 → `参考派生` 散文指令 → 正则锚点兜底；另有 4 道守卫（前缀校验、否定子句、backwards-only、字母后缀回落/群像闪回排除）。解析在后端（`canvas_source_cards`）与执行前（`canvas_import_support`）各做一次，后者才是最终生效点。
3. **执行链是「拓扑排序 + 严格串行 + 引用即屏障」**：`build_asset_steps` 把 bases 排在 compositions 前并给构图卡生成 `refs=['step:IMPORT_xxx']`；执行器遇到依赖未完成即抛错暂停，绝不退化成无参考出图。
4. **结构化规划 = 模型只填数据，程序写模板**：说话人、对白编号、`integrated_multimodal_description` 三字段、时间片秒数全部由代码生成；模型输出经 `valid_*` / `validate_*` 逐级硬校验，失败只重试当前批、已验证批次保留。
5. **连续性是显式合同**：`connection{mode,scene_key,…}` + `continue` 逐字继承上一段 `continuity_after`；H3 原生上下文（context latent）缺失时拒绝提交续接段，而不是拿尾帧冒充。
6. **最值得移植的是「确定性骨架」**：编号、参考解析、拓扑执行、JSON 校验、体检报告、空图拒收——全部与具体模型无关；**只有像素级 VAE identity、ComfyUI 节点/工作流拼接、原生上下文 latent 这三类强依赖本地链路**（见第 8 节）。

---

## 1. 资产卡编号体系与卡面字段

### 1.1 编号（`资产卡格式规范.md` §一；`canvas_source_cards.CARD`）

| 前缀 | 类型 | 默认画幅 | 生成图片 |
|---|---|---|---|
| `C\d+` | 人物角色卡 | 2:3 | 是 |
| `SC\d+` | 场景空镜卡 | 16:9 | 是 |
| `P\d+` | 道具卡 | 1:1 | 仅在明确要求时 |
| `KF\d+` | 关键帧/构图卡 | 9:16 | 是（引用基础资产） |
| `S\d+` | 声音资产 | — | 否，仅文字记录 |

- 状态后缀 `-A/-B/-Y`（如 `C01-A`、`P01-B`、`C01-Y`）是**身份的一部分**，不得与基卡合并；`CARD` 正则 `((?:SC|KF|C|P)\d+(?:-[A-Za-z])?|S\d+)` 显式保留后缀。
- 重复编号：`authored_cards` 发现重复即 `raise ValueError('原稿图片资产卡存在重复编号…')`；清单体格式（无 `###`）则规范化为 `IMPORT_001` 或加 `_2` 后缀并写 notes（`canvas_asset_import.authored_assets`）。
- 兜底提取路径另起编号空间 `CHAR_/LOC_/PROP_\d+`（`h3_three_step.compile_plan`、`canvas_asset_import.extract_designs`），模型给的编号视为“临时”，真实分配由程序 `allocate_unique` 决定，且先预留整批编号再合并（避免修复 `PROP_09` 抢走 `PROP_10`）。

### 1.2 卡面字段（`canvas_source_cards.read_cards` / `markdown_asset_cards`）

- 提示词：`PROMPT` 正则接受 `提示词 / 人物提示词 / 场景提示词 / 详细文生图提示词 / 资产提示词` 等别名；无标签时依次回落 `行内反引号` → 围栏代码块 → `card_description()` 正文段落。
- 负面词：`可选负面提示词 / 负面提示词`，合并去重后进入 encoder 的 `negative_prompt`（`scene_asset_render.configure_encoder`、`h3_asset_bundle.configure_graph`）。
- 建议画幅：卡标题 → `建议画幅/画幅` 字段 → 提示词正文，三档搜索；**节标题可声明整类画幅**（`section_declared_ratios`，如「无人场景资产卡（SC01–SC38，16:9 横屏）」），优先级最高。
- 参考字段：`身份参考(C)`、`结构参考/空间参考(SC)`、`道具参考/器物参考(P)`、`参考派生/参考派生说明/派生参考`（见第 2 节）。
- 参考派生：仅当对应显式字段为空时生效（`markdown_asset_cards` 第 312–320 行、`authored_assets` 第 113–120 行），且 KF 卡不参与派生。
- 全局设置（概览区、首卡之前）：`风格统一词`（含 F01–F23 代码兜底）、`统一人物质感词`（只追加给人物卡）、`统一时代设定`、`统一排除项`；后两者被拼进每张卡的 `style`，因为“每张卡单独送 encoder，不拼就看不到”（`authored_cards.header_setting`）。
- 文本类排除：`文字记录|不引用独立图片|仅声音资产` → `text_only`，不生成图片；`requests_prop_cards` 要求“提及道具 ≠ 同意单独出道具图”（否定子句、`道具仅文字记录`、显式要求动词三选一）。

---

## 2. 参考关系解析：三级优先级 + 四道守卫

### 2.1 三级优先级

1. **显式声明**——`explicit_reference_id(value, prefix)`：字段值里任意「注释」随写，只取编号；**前缀写错（人物卡写 `身份参考：SC01`）视为未声明**，回落下一级，避免接出无意义连线。
2. **参考派生散文指令**——`directive_reference_id(text, prefix, self_id)`：必须命中正向短语表 `DIRECTIVE_PHRASES`（`为同一角色/同一空间/同一器物…` 或 `绑定为本卡参考图`/`保持脸部结构`），且**不命中** `DIRECTIVE_NEGATIVE`（`两名|两人|同装同使命|区分|混同|不是|并非|不与…共用|独立设卡`）；只取同前缀、非自身的第一个编号。
3. **正则锚点兜底**——在 `canvas_import_support` 中按类型分三套：
   - 人物 `identity_reference_for`：锚点 `IDENTITY_ANCHORS`（`同一张脸/同一人脸/保持同一身份锚点/延续…面部骨相`），窗口 ±(16,24) 字内取候选；靠锚点左侧最近的 C 编号优先。
   - 场景 `location_reference_for`：锚点 `LOCATION_ANCHORS`（`同一(棵古槐|棵树|空间|布局…)`、`与 SC16 是同一…`、`须与 SC22 一致`），窗口 ±40 字。
   - 道具 `prop_reference_for`：锚点 `PROP_ANCHORS`，窗口 ±40 字；否定在**同一子句**内判定（以 `\n。；;` 切子句）。
4. 都没有 → 不接线，按原文独立生成。

### 2.2 四道守卫

- **前缀/存在性守卫**：显式值必须 `fullmatch(r'C\d+(?:-[A-Za-z])?')` 等；目标必须存在于 `known`。
- **否定守卫**：`PROP_NEGATIVE`/`LOCATION_NEGATIVE` 子句级、`DIRECTIVE_NEGATIVE` 全文级。⚠ **人物侧没有否定守卫**（`资产卡格式规范.md` §五已自认“已知局限”），`与 C01 以服装区分` 这类文字理论上可被人物锚点误接。
- **Backwards-only 守卫**（`build_asset_steps` 第 241–273 行）：用 `order_pos` 比较拓扑顺序，目标在本卡之后/不存在即跳过并写 notes；**显式声明也会被拦**——因为前向引用会让 `step_refs` 依赖未完成资产而卡死。文档把它称为“避免死锁”。
- **字母后缀回落**：`C03-B` 无显式声明时继承 `C03`；若两个状态都带后缀（`C05-A 完整 / C05-B 拆开`），回落“第一个同前缀兄弟卡”。
  - ⚠ 实现在 `siblings = [k for k in known if k.startswith(plain + '-')]; return siblings[0]`，**依赖字典插入顺序**而非声明顺序；`资产卡格式规范.md` 写的是“第一张”，代码未按卡片文档顺序排序，建议移植时显式按源文件出现次序排序。
- **群像/闪回排除**：`identity_reference_for` 中，带后缀卡的正文命中 `少年|闪回|回忆|年轻时|弱冠` → 不接线；基卡名含 `群|同式|众`（群像卡）→ 不接线。**显式声明仍接线，但追加人工确认警告**（“该状态通常应为不同面容”）。
- **迁移兼容**：`migrate_import_job` 用 `IMPORT_VERSION` 分段升级，只重置“被新接线的卡”，历史版本留存（`archive()`），不丢弃已有图片。

---

## 3. 执行链路：拓扑排序 → 引用串行 → 三类 identity_clause

1. **计划期拓扑排序**（`canvas_import_support.build_asset_steps`）：
   - `bases = [a for a in assets if not a.get('composition_reference')]`，`compositions` 为 KF 卡，直接排在 bases 之后；
   - KF 依赖来自**提示词正文里的编号**（`ASSET_ID.findall(prompt)`，即 `9:16 竖构图（C01、SC01、P01）`）；若无 SC 引用但提示词出现 `同一/同场/沿用/same`，则沿用上一张 KF 的显式场景或唯一场景（`last_scene`）；
   - `while remaining:` 反复挑出“依赖已全部就绪”的构图卡，否则整批追加（防环）。
2. **步骤与依赖编码**：`step_ids = {asset: f'IMPORT_{i:03d}'}`；每步 `refs=['step:'+step_ids[ref]]`；构图卡若缺前置或根本没有引用，写 `dependency_error`，**不退回无参考出图**。
3. **执行期严格串行**（`local_canvas_agent.worker`）：`for step in job['steps']` 逐个 `status='running'` → 执行 → `'done'`；`step_refs()` 遇到依赖 `asset` 为空直接 `raise ValueError('依赖资产未完成：…')`，遇到依赖 `review_required/stale_sources` 则要求先确认版本。最大串行上限 5 张参考图（非构图卡），构图卡走 `pack_composition_references` 拼板（详见 3.4）。
4. **三类 identity_clause**（`canvas_import_support.identity_clause`）：
   - 人物：`IDENTITY REFERENCE: Image 1 is this character in an earlier state and is the face identity authority…`（只允许改本卡描述的服装/发型/年龄态/表情）；
   - 场景：`IDENTITY REFERENCE: Image 1 is the same location rendered earlier. Use it ONLY for spatial structure…keep the environment empty of people`（空镜对空镜，人不可能经由图像条件被召回）；
   - 道具：`OBJECT IDENTITY REFERENCE: … Preserve its exact form, proportions, construction, materials, fittings and engraved details…`。
   - 拼装：`spec['reference_bindings'] = identity_clause(asset) + f' Image 1: {anchor}.'`，同时写 `identity_reference/location_reference/prop_reference` 供 encoder 阶段再次确认。
5. **encoder 阶段保真**（`art_asset_policy.configure_graph` / `scene_asset_render.configure_encoder` / `h3_asset_bundle.configure_graph`）：
   - 人物/道具带参考 → `attach_identity_reference` 把 **VAE 链接**塞回 `TextEncodeQwenImage21.inputs['vae']`，并把 KSampler 的 `latent_image` 指向 encoder 输出第 2 路、`denoise=1.0`（Qwen Image Edit 原生路径，见第 8 节）；
   - 场景有 `location_reference` → 只保留第 1 张图，否则**清空所有 images 与 vae**（“空镜默认纯文生”防人物倒灌），并追加 `LOCATION_STRUCTURE_RULE`；
   - 道具无参考时主动剥离全部 `images.*` 键（对旧任务做纵深防御）。
6. **构图卡多参考打包**（`pack_composition_references`）：≤5 张直接编号；>5 张按 `ceil(n/5)` 分组成 768×1064 拼板，板上写资产编号，`reference_bindings` 写 `Image N contains labeled references, left to right then top to bottom: …`——**任何源图都不裁切、不丢弃**。

---

## 4. 结构化 JSON 规划：schema、逐级校验、outline guard、检查点

### 4.1 `h3_three_step.py`（原文 → 模板提示词，单任务单文档）

- **校验式 schema 工厂**：`object_schema(props)` 深拷贝每个属性并强制 `required=全部`、`additionalProperties=False`；`ASSET_SCHEMA`、`SEGMENT_SCHEMA`（`beats` 2–4 片、`continuity∈{shot,context}`、`source_ids`、`start_state/end_state`）分批复用。
- **容错解析但不猜值**：`response_object(raw)` 用括号栈只补齐“未闭合尾部容器”，遇到引号未闭合或括号错配即报错（“不能猜测补齐”）。
- **原句台账**：`dialogue_ledger(source)` 只认引号内容与 `说话人：台词` 行，过滤时间码、拟声词、屏显文字；编号 `D001…`。这是“程序逐字填回、模型不许改写台词”的依据。
- **两阶段设计**：先锁定 `title/style/speakers/assets`（`design_system`），再按 `source_units` 逐组产出 segments；`source_units(source)` 是**原文连续摘录**（`max(220, len/22)` 切组，`U001…`），不是模型自拟梗概。
- **逐级硬校验**（`compile_structured` → `compile_plan`）：
  - 原文覆盖：`actual_units != expected_units` → 报错并列出应为/实际，禁止跳头跳尾；
  - 说话人必须有独立 character，不能借用主角；
  - 每段 2–4 beats；`action` 禁止换行/`<d>/<Picture>/{{`/“字幕/旁白/内心独白”等；
  - **时长由代码算**：`minimum = speech/4.2 + 0.5`，不足 30 秒上限，超出要求拆段而非缩写台词；
  - 模板字符串由代码拼（`integrated_multimodal_description/overall_soundscape/non_diegetic_music` 三字段），`{{D001}}` 占位由 `render_segments` 逐字替换成 `<d>[Chinese] …</d>`。
- **检查点/暂停**：每批 `save_progress()` 落 `job['h3_generation']`（含 `source_hash` 指纹），`stop_requested` → 返回 `_planning_paused`；模型输出不合格重试 2 次后 `raise ValueError('本批模板未完成…已完成部分保留')`。`unit_limit` 支持“短批次试跑”（`summary` 明确声明“不代表整章完成”）。
- **段间连续性体检**：`CONTINUITY_RULES` 复用同一 `ask()`，只报硬断点（同场无过渡坐变站、物件无故换手/消失、已完成动作重演、end_state 与末片相反）；`ok!=true` 时走**只改 action、不改台词**的定向修复，修复后仍不过即抛错。

### 4.2 `adaptive_script_planner.py`（用户闸门式剧本开发）

- 常量：`POLICY='adaptive-script-v1'`、`OUTLINE_GUARD=3`、`ROUTES={faithful,polish,structure,rewrite}`、`FORMATS`、`DIAGNOSIS_SCHEMA`（`additionalProperties:False` + `enum` + 长度上限）。
- 阶段机：`diagnosing → route → outlining → outline_review → drafting → draft_review → accepted`，`plan()` 最多循环 10 次。
- **outline guard**：`plan_stage` 在 `outlining` 入口比较 `p['outline_guard'] != OUTLINE_GUARD`，不一致则把旧大纲整批压入 `history` 并清空重建（版本化失效，结果可复现升级）。
- **逐级校验**：`valid_notes`（诊断必须覆盖本批全部 unit）→ `valid_diagnosis`（必填、枚举、`report` 与外层字段冲突即报错）→ `validate_structure`（每批 ≤48 场、`source_ids` 有序去重、`origin∈{source,staging,new}` 且 `new` 需授权、`reference_only` 与 scenes 不得交叠、**必须完整覆盖本批**）→ `valid_outline_check`（核对项必须引用真实 unit、定位到具体 `field`，`source_quote` 由程序回填而非模型抄写）→ `validate_draft`（正文逐场对齐已确认大纲、人物不得新增、`preserve_dialogue` 时台词必须逐字出现在原文）。
- **两轮核对**：`checked_outline` 生成 + 独立 review，有 `blocking` 则把被拒候选存入 `outline_rejected`（带 `review_signature`，签名未变可复用），复测一次仍不过即抛错，不进入正文。
- **检查点 waiting**：`waiting(job, phase, msg)` 写 `job['script_gate']` 并返回 `_script_wait`；`plan_stage` 在 `route/outline_review/draft_review` 直接返回 waiting，“请在剧本策划确认区审读后继续，不会自动跳过”。`script_automatic` 模式（非 discuss）才由 `advance_automatically` 自动推进，且 `draft_review` 有 blocking 时最多自动修 2 轮。
- **预算与降级**：`ask()` 请求体 >36 000 抛错（不截断），最多 3 次重试并回填上次错误；本地 9B 输出异常 → 自动切换 27B 重试一次。

### 4.3 `director_story_pipeline.py`（分镜编排，六阶段之一）

- `STORY_SYSTEM` / `COMPACT_STORY_SYSTEM` 输出 `{"title","global_style","characters":[…],"clips":[{"source_ids","character_names","scene","action","camera","dialogue_ids","sound","continuity_before","continuity_after","suggested_seconds","props","motion","connection"}],"notes":[]}`。
- `compile_storyboard` 逐镜：`validate_single_shot`（`camera` 含 `切至/蒙太奇/→` 即失败）→ 时长有限数校验 → 生成 `SHOT_0001…`，对白拼 `【说话人】台词`，`source_evidence` 由 `units[i-1]` 回填；有 `motion` 则 `prepare_shot` + `attach` 写 continuity 合同。
- 资产绑定：`annotate_assets` 用名称匹配填 `spec['shot_ids']`，**没有任何镜头使用的道具卡被剔除**（“命名≠生产资产”）；`export_shots` 用 `shared_references` 决定每镜参考顺序（人物组最多 2 张：四视图/主图优先 + 脸部参考，然后场景、道具、本镜分镜图），>9 张直接报错而不是静默丢参考。

---

## 5. 连续性与失败模式防护

### 5.1 `director_continuity.py`：显式连接合同

- `connection` 字段：`{version, mode∈{start,continue,cut}, scene_key, reason, axis, camera, sound, props, completed_actions[], next_action}`；`clean_connection` 逐字段非空且 ≤1200 字，`completed_actions` ≤16 项去重。
- `validate_plan` 关键不变量：
  - `continuity_after` **只能**取末片 `state_after`（不一致时把模型自写的摘要存进 `reported_continuity_after` 备查）；
  - `continue` 的 `continuity_before` **逐字继承**上一段 `continuity_after`；
  - 首段必须 `start`，已有前段不得再 `start`；
  - `continue` 不得更换 `scene_key`（换场必须用 `cut`）。
- `attach()`：把合同写成 `shot.start_state/end_state`，`continue → continuity='context'`、其余 `'shot'`；`connection_lines()` 把合同渲染成人类可读的“承接状态/轴线/持物/已完成不重演/声音交接”。
- `prop_continuity()`：持物缺失时写“持物信息未明确；沿用…不新增、清空、换手或重置道具”——**未知不等于空手**。
- `shared_references()`：参考排序、>9 张报错（“不会静默丢掉人物参考”）。

### 5.2 `h3_prompt_audit.py`：段内切镜体检 + 机械拆段

- 识别 `internal_cut`：`CUT_POINT`（`At 00:06.000, cut to…`、`[Shot 2] At…`、`6—8秒：[Shot 2] At…`）且必须由 `[Shot N]`/`cut`/`切` 佐证；`CUT_WORD` 无时间码 → medium。
- 其它体检项：`beat_overload`（动作动词计拍 ≥5 高危、≥3 提示）、`static_tail`（段尾入睡/静止）、`continuation_open`（写“继续上一段”）、`negative_prop`（否定句削弱道具交互）、`meta_narration`（“如原文所述”）、`prop_without_asset`（提到车厢/信/剑等但本段无对应道具卡）、`context_pose_conflict`（context 硬接却写转身/穿越）、`reference_pending`。
- `split_segment`：在切点机械拆段，改写 `【第N段｜X秒】` 与标题秒数、平移 `At mm:ss.mmm` 时间码、切点句改写为 `Open on/Return to…`；**每段 ≥2 秒、最多 3 段、`0.0-3.0秒` 时间片一律不拆**；拆完仍过不了 `validator`（如 `h3_user_template.validate`）则记为 `split_blocked`。`BLOCKING_CODES=('internal_cut','split_blocked')` 才是“接多轨前必须处理”，其余只提示。

### 5.3 `storyboard_reference_guard.py`：分镜格参考身份互斥

- `check_manifest`：先为每张参考资产判定 `people∈{present,none,unknown}` 与 `characters` 集合；逐格检查：本镜未填人物（空镜要写“无人”）、参考 >5 张、含本镜未出场人物 → 记 `removed` 并在 `remove_invalid` 时物理移除；含人物但归属不明 → 拦；本镜出场人物没有任何可确认参考 → 拦。
- `assert_generation_references`：每次出图前重新校验，并把 `step.refs` 与已保存方案的 `input:N` 序列**逐位比对**，防止“改方案没保存就出图”。
- 结合 `local_canvas_agent.step_refs` 的硬规则：分镜格**永远不会**把未验收的生成帧当参考（`FRAME_` 链接被跳过）。

### 5.4 `director_image_health.py`：空图/纯色/损坏拒收

- `_problem`（`lru_cache` 按 文件名+mtime+size 缓存）：`min(size)<64`、全透明、RGB 三通道 `extrema` 全部 `high-low<=1` → 判“blank or solid color”；`require_image` 抛 `InvalidGeneratedImage`。
- `audit_job`：对 `director_asset` 的已完成步骤复检，失败即 `clear_failed_render`（清 prompt_id/asset/files，`output_revision+1`）+ `status='error'` + `image_invalid=True`，并从审批表移除；若用 Q8 出废图则自动降级 Q6 重试。
- 出图链路内直接调用：`local_canvas_agent.execute_step` 对 `asset_spec`/`director_asset` 步骤在落盘后立即 `require_image`；“生图流程没有返回图片”同样不标记完成。

### 5.5 `asset_render_quality.py`：显式像素预算

- `apply_quality`：只接受 `0.25–2.0 MP`（bool 直接拒绝）；找到 KSampler 的 `latent_image → EmptyLatentImage` 链接，按原宽高比重算并 16 对齐；同时把 encoder `resolution` 上限压到 `min(current, cap)`（草稿输出降低参考图成本，但**从不上采样参考图**）；找不到 EmptyLatentImage（如 VAEEncode 型工作流）就跳过并如实不写分辨率。
- ⚠ 该文件实际是**分辨率/像素预算**而非“质量评分”：只有 `h3_asset_bundle.configure_graph` 铺的是 `EmptyLatentImage`，凡走 `attach_identity_reference` 的 VAE identity 路径都不会被此函数改尺寸。

---

## 6. 分镜/参考图分离与 `native_h3_project` 数据形状

### 6.1 角色分离原则（多文件同源表述）

| 角色 | 谁提供 | 进入视频节点的方式 |
|---|---|---|
| 人物母版（四视图/主图/脸部） | 资产卡 `C*` | `reference_ids` → `<Picture N>`，`mode='reference'`（全能参考） |
| 场景母版（空镜） | `SC*` | 同上，只锁空间 |
| 道具母版 | `P*` | 同上，只锁形制 |
| 构图卡 | `KF*` | 构图参考/首帧参考，**不替代母版、不自动锁首帧** |
| 分镜/动作图 | 分镜格 | `storyboard_asset_id`，“动作/构图依据” |
| 视频段 | `segments[]` | 一次生成一段，`continuity` 决定是否吃原生上下文 |

`canvas_source_cards.resolve_references` 负责把作者写的 `引用资产：图1 + C01、SC02` 解析成 `asset_ids`，并按 `aliases`（卡片编号↔提取资产编号）映射；`S\d+` 只有明确标“画外/声音”且非场景时才跳过。

### 6.2 `native_h3_project` 形状（`native_h3_scene.py`，实例 `app/data/native_h3_projects/c4ba62….json`）

```jsonc
{
  "name": "…", "source_job_id": "…", "node_id": "…",
  "assets": [{"id":"h3_asset_0","source_asset_id":"C01","source_job_id","source_step_id":"IMPORT_001",
              "source_node_id","url":"/assets/input/universal/<sha>.png","name":"C01 · 淳于棼…",
              "kind":"image","reference_role":"image","source_revision":0,"source_version_asset_id"}],
  "segments": [{"id":"<32 hex>","title":"第001段｜8秒","seconds":8,
                "prompt":"【第001段｜8秒】\n引用资产：C01…\nintegrated_multimodal_description: …\noverall_soundscape: …\nnon_diegetic_music: …",
                "continuity":"shot|context","mode":"reference|image|text",
                "reference_ids":["h3_asset_0","h3_asset_2","h3_asset_4","h3_asset_15"],
                "system_prompt":"<H3 v3 模板全文>\n本段图片引用顺序：<Picture 1> = C01（…）；…",
                "rewritten":"","use_rewritten":false,"rewrite_basis":""}],
  "ratio":"9:16","quality":"native","seed":1,"seed_mode":"fixed","result_mode":"append","auto_merge":true,
  "common_prompt":"","sampling_mode":"single","disable_2nd_noise":true,"steps":8,"second_steps":4,
  "second_denoise":0.22,"upscale_by":1.25,"scheduler":"beta","low_vram_attention":true,
  "chunk_feed_forward":true,"loras":[{"node_id","name","strength","enabled":false}],
  "system_prompt":"<h3_timeline_system.txt>","template":{…工作流模板…},
  "records":{},"runs":[],"revision":0,"run":null
}
```

- **`assets[].source_asset_id`**：把运行期哈希 ID（`h3_asset_<n>` / `sha1[:20]`）反查回作者编号，`native_h3_input_bridge.reference_prompt` 用它把提示词里的 `C01`/`图1` 改写成 `<Picture N>`（保护 `_PROTECTED` 内的台词与引号文本），并在没有原生标签时在正文前插入 `Picture N: 名称` 绑定表；`static/js/native-h3-scene.js` 也用它把资产与 `step.h3_asset_id` 关联。
- **`segments[].reference_ids`**：视频参考的**唯一**真源，顺序即 Picture 序号；`validated()` 校验：≤15（去重）、按类型 ≤9 图 / ≤3 音 / ≤3 视频、`mode='image'` 必须恰好 1 张图且 `continuity!='context'`。
- **`system_prompt`**：项目级 = `h3_timeline_system.txt`；段级 = `段自带 system_prompt`（导入时由 `render_bundle_segments` 生成的“本段图片引用顺序…图片仅作参考，不自动作为精确首帧…”）拼在段级之后；`native_h3_scene.tracks()` 最终写 `(段.system_prompt or 项目.system_prompt) + '\n' + H3_RULES` 到任务段。
- **帧对齐**：`output_frames(s) = 5 + 17*floor((round(24s)-5)/17+0.5)`；`tracks()` 按 24fps 排放 `start_frame/end_frame`，`task_type` 由 `refs?r2v : images?i2v : t2v` 推导。
- **版本失效**：`signatures()` 对每段做 `sha256(全局配置, 段, 上一段签名(仅context), 参考图URL列表)`；`stale = 签名变 / 序号变 / context_ok 失败`，`context_ok` 会逐级回溯父段并要求上下文 latent 文件在场。

### 6.3 节点级映射（`tracks()` → `Original_01_H3_Multitrack.json`）

- `easy multitrackProject.track_data`（JSON）承载 task 轨道与 3×video / 3×audio 参考轨；`easy multiTrackEditor` 承载画幅/画质。
- `graph_for(p,index,…)` **每次只放一段**（`segment_start_number=index+1, segment_count=1`），保证“一段一提交、串行、可单独重做”；`segment_XXX.workflow.json` 落盘便于审计。

---

## 7. 机制清单（按可搬运度）

| # | 机制 | 出处 | 与模型无关 | 可直接移植 |
|---|---|---|---|---|
| M1 | 全局唯一编号 + 状态后缀 + 重复即拒 | `canvas_source_cards`、`h3_asset_bundle` | ✅ | ✅ |
| M2 | 显式→派生→正则三级参考解析 | `explicit_reference_id`、`directive_reference_id`、`*_reference_for` | ✅ | ✅（建议补人物否定守卫） |
| M3 | 否定/backwards-only/后缀回落/群像闪回守卫 | `canvas_import_support.build_asset_steps` | ✅ | ✅（兄弟排序改为文档顺序） |
| M4 | bases 先 compositions 后的拓扑排序 + 引用屏障 | `build_asset_steps`、`local_canvas_agent.worker` | ✅ | ✅ |
| M5 | 三类 identity_clause 文案契约 | `identity_clause`、`OBJECT_REFERENCE_RULE`、`LOCATION_STRUCTURE_RULE` | ✅（纯文本） | ✅ 文案可换 API 模型 |
| M6 | JSON schema 工厂 + 括号栈恢复 + 逐级 `valid_*/validate_*` | `h3_three_step`、`adaptive_script_planner` | ✅ | ✅ |
| M7 | 原句台账 + `{{D001}}` 程序回填 + 时长=字数/语速 | `dialogue_ledger`、`compile_structured` | ✅ | ✅ |
| M8 | 覆盖性校验（source_units 不跳不漏）+ outline guard 版本失效 | `compile_structured`、`plan_stage` | ✅ | ✅ |
| M9 | waiting/gate 检查点 + 分批保存 + 失败只重试当前批 | `waiting()`、`save_progress` | ✅ | ✅ |
| M10 | connection 合同（start/continue/cut、scene_key、state_after 唯一来源） | `director_continuity` | ✅ | ✅ |
| M11 | 段内切镜体检 + 机械拆段（不改台词与总时长） | `h3_prompt_audit` | ✅ | ✅ |
| M12 | 分镜格参考身份互斥 + 出图前逐位比对 | `storyboard_reference_guard` | ✅ | ✅ |
| M13 | 空图/纯色/损坏拒收 + 失败清标记 | `director_image_health` | ✅（Pillow 本地） | ✅ |
| M14 | 构图卡多参考拼板 + 编号说明 | `pack_composition_references` | ⚠ 需要本地 Pillow/上传路径 | 搬到云端可保留算法，换对象存储 |
| M15 | 参考快照与下游失效传播 | `art_asset_review.reference_snapshot/mark_downstream` | ✅ | ✅ |
| M16 | 逐段提交 + 签名失效 + 版本留存 | `native_h3_scene.signatures/import_artifact` | ⚠ 签名逻辑可留，提交对象换成 API 任务 | ✅ |

---

## 8. 依赖本地 ComfyUI / VAE / 工作流、移植到 API 模型会失效的机制

> 判据：要么直接读写 ComfyUI 图节点（`class_type`/链接数组），要么依赖本地模型能力（identity VAE、上下文 latent、LoRA/调度器/首末段帧数），要么依赖文件系统上的 ComfyUI 输出。**API 模型（图片/视频供应商 HTTP）无法满足的，全部列在下面。**

1. **VAE identity 参考机制**（`character_sheet_render.attach_identity_reference` + `art_asset_policy.configure_graph`）：把 `TextEncodeQwenImage21.inputs['vae']` 指向图像 VAE 链接，并让 KSampler 以 `TextEncodeQwenImage21` 的第 2 路输出为 `latent_image`（Qwen Image 2.1 原生 edit 路径）。API 模型通常只接受“上传参考图 + 文字提示”，**没有中间 latent 可注入**，无法做到“只锁身份、denoise=1.0 重绘”。落地时只能用多图参考 + 强约束文案替代。
2. **ComfyUI 工作流类型判定与改写**：`configure_graph` 要求图里**恰好一个 `TextEncodeQwenImage21` + 一个 `KSampler`**，否则抛“需要本地 Qwen Image 2.1 单采样工作流”；`h3_asset_bundle.configure_graph`、`scene_asset_render.configure_encoder`、`asset_render_quality.apply_quality` 都直接增删节点（`EmptyLatentImage`、`images.N`、`vae`、`negative_prompt`、`resolution`）。API 侧无节点可改，这些“参考降级/空镜清空/负向词合并”的**强制手段全部失效**，只能落成提示词约定。
3. **工作流模板拼装（多轨）**：`native_h3_scene.template()` 校验 `easy multitrackProject`/`easy multiTrackEditor` 唯一且连线正确；`graph_for` 写 `track_data`、`resolution.*`、`BasicScheduler` 的 steps/denoise/scheduler、`LoraLoaderModelOnly` 强度与开关、`project_name/segment_start_number/segment_count/seed`。API 视频端点通常只暴露 prompt + 参考图 + 时长 + 分辨率，**调度器、LoRA、二采 denoise、upscale_by 全部不可控**。
4. **原生上下文续接（context latent）**：`execute_segment` 要求同场续接段存在上一段的 `context_latent(.low)` 文件（`context_ok`），否则报“旧版尾帧视频不能冒充上下文”。这是本地多轨节点把上一段的**latent 状态**喂回下一段；API 视频接口一般只支持“首帧图/参考图/上一段视频”，需要退化为首帧续接或视频参考，衔接质量不可等价。
5. **首末帧/输出帧数约束**：`output_frames(s)=5+17*floor(...)`、24fps 帧对齐、`mode='image'` 只接收一张首帧——这些都是本地 H3 节点的帧数格点；API 侧通常是“秒数/分辨率枚举”，需重做时长量化表。
6. **逐段执行闸门与队列独占**：`native_h3_scene.idle()` 检查 `media.SERIAL`、`studio.LOCK`、`studio.PIPELINE_BUSY` 与 ComfyUI `/queue`；`execute_segment` 用 `/prompt`、`/history/<pid>`、`/queue` 轮询并在“提交结果不明”时**拒绝自动重发**，超时 2 小时。API 侧需要换成“任务 ID + 回调/轮询 + 幂等键”，语义可保留但实现须重写。
7. **`preflight` 节点能力探测**：`GET /object_info/<class>` 校验每个选项/模型是否安装。API 模型无此概念，只能换成“模型能力声明表”。
8. **资产像素预算与参考分辨率上限**：`apply_quality` 依赖 `EmptyLatentImage` 与 `encoder.resolution`；API 侧通常有固定尺寸枚举，预算模型需要重新定义（如按供应商允许的 size 档位映射）。
9. **角色四视图/群像/影棚冷灰等版面契约**：`ksr_character_cards.layout_rules`、`negative_prompt`、`import_character_cards.prompt_for_card` 是针对 Qwen Image 2.1 的 prompt 模板（第三格整脸高斯模糊、影棚冷灰背景等）；换 API 图片模型需整套重写，否则版面会被模型自由发挥。
10. **场景空镜的清空手段**：`configure_encoder` 直接 `pop` 掉 `images.*` 与 `vae`；API 侧只能“不传图”。这在逻辑上可行，但“空镜守卫”的**强制力**从代码级降为提示词级。
11. **图片落盘与源文件路径**：`media.INPUT/OUTPUT`、`/assets/input/universal/<hash>.png`、`archive.bounded()` 路径约束、`copytree` 导入；移植到 Toonflow 需换成工作区文件入口（`@toonflow/file`）与素材库 ID。
12. **本地模型编排**：`q6/q8`（`director_assets.MODELS`）、本地 Ollama 规划路由（`LOCAL_AGENT_ROUTE=draft/review`、9B→27B 降级）都属于本机栈；API 侧应改为“一个模型 + 结构化输出 + 程序校验”，第 4 节校验逻辑可原样保留。

---

## 9. 对 Toonflow 落地的直接启示（供 t3 方案引用）

1. **先搬确定性层**：M1–M3、M6–M9、M11–M13、M15 与模型无关，可在 Toonflow 的 tool（`packages/tools/<name>`）+ node guard（`nodeTools.register`）中实现，**不碰节点源码也能覆盖大部分**。
2. **`segments[].reference_ids` 的顺序语义必须等价复刻**：Toonflow 视频节点的 `data.referenceOrder[portId]` + 入边顺序就是 Picture 序号；移植时要把“参考顺序 = Picture 编号”写进接线契约，并要求出图前逐位比对（M12）。
3. **`system_prompt` 拼接顺序照搬**：项目级模板 + 段级“本段图片引用顺序”说明 + 平台规则，三者顺序决定模型是“按素材还原”还是“照文字重画”。
4. **必须显式降级的三处**：VAE identity（第 8 节 1）、原生上下文（第 8 节 4）、像素/LoRA/调度器控制（第 8 节 2/3）。方案里应写明“API 模型下用多图参考 + 首帧续接 + 提示词免责声明替代，并在体检清单中标注能力降级项”。

---

## 10. 待确认 / 风险项

- ⚠ `更新说明_20261002.1` 称“兼容旧资产缺少素材用途”，`guide.html` 与 `release-status.json` 的验收范围限于 512×512 图、512×288 约 2.33 秒单段视频、多轨单段；**32 镜长片、高分辨率、其他 GPU 明确未验证**。
- ⚠ 兄弟卡回落按 `dict` 插入顺序（第 2.2 节），与文档“第一张”措辞不完全一致。
- ⚠ `director_image_health` 只判“空白/纯色/透明/过小/损坏”，**不判人物是否错脸、道具是否错形**——质量仍需人工验收（`art_asset_review`）。
- ⚠ 本报告未执行任何生成/导入流程；对 `main.py`（883 KB，Web 路由与启动器耦合层）只做了索引级检索，未逐行核对。
