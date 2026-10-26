# 分镜图提示词与首帧知识

用于首帧路线或用户确认需要分镜图的制作单元。输入是确认分镜及已采用资产图；这是把同一画面转成模型可执行描述，不是第二次创作剧情。先读本文件，涉及风格时只读 [视觉风格](visualStyles.md) 中已确认条目；角色/场景资产设计缺项回 [资产设计](assetDesign.md) 及资产阶段。

权威提示词格式与参考标记口径：现行视频生成仅支持 MiniMax-H3（H3 官方六段格式 subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music，参考标记 <Picture N> / <Video N> / <Audio N> 各媒质独立编号），权威口径见 docs/h3PromptAlignment.md；本文件保留 v1.1.8 时代的画面→单帧转换方法学，示例中的参考占位一律采用 H3 现行口径。

## 输入与模型边界

当前节点按 schema 支持图像输入；参考图通过 [画布执行](../canvasOperations.md) 的素材节点与连线实际传入。不再使用旧的双花括号 ref 占位符；提示词内参考标记一律写 <Picture N> / <Video N> / <Audio N>，N 按当前节点真实输入顺序与媒质独立编号。下面示例均采用 H3 现行口径。

## 从分镜到单帧

完整保留画面中的主体、关键物件、空间层次、关系与情绪；时序只取这一帧能表达的状态，后续动作仍留在视频说明中。词数紧张时先减修饰词，不能删掉信件、指示物、接触关系等叙事信息。

| 输入性质 | 单帧处理 | 视频说明保留什么 |
|---|---|---|
| 静态瞬间：停步仰望、站立凝视、冷笑、伏案书写 | 直接保留该状态，不改成"即将" | 后续有变化时才写动作演进 |
| 连续过程：走过长廊、挥剑斩下、转身离去 | 取已确认动作的真实起始凝固态，不画结果态或抽象预备姿势 | 完整路径、速度、结束状态与时序 |
| 景别变化：远景→中景、近景→特写 | 精确取左侧起始景别；远景不能擅自升级成大远景 | 全部运镜路径与落幅 |
| 黑场淡入、叠化 | 区分转场与首张可用内容图；模型需要可辨识参考时不把全黑图当稳定身份参考 | 已确认转场的发生位置；能力冲突时询问处理方案 |
| 已确定末帧 | 使用该单元确认结束状态，与首帧保持身份/空间一致 | 首尾之间真正发生的变化 |

只有分镜确实描述"剑已举至头顶随后劈下"，首帧才选举剑状态；不能凭"挥剑"自行发明错误握法、剑尖朝向或攻击目标。转换不是把所有动词都退回尚未开始。

### 字段映射

| 分镜信息 | 图像提示词落点 |
|---|---|
| 场景、主体、物件与画面描述 | 画面主段 / scene_and_framing + subject_and_action，逐项保留 |
| 景别、角度 | 明确构图、裁切范围、观察方向；词汇见 [镜头知识](shotCraft.md) |
| 动作、姿态、朝向、空间 | 依首帧判断保留该瞬间状态，并写谁在左/右、看谁、持有什么 |
| 情绪 | 已确认的表情、眼线、肌肉或姿态，不换成另一情绪 |
| 已采用场景光照与风格 | 从真实参考继承，不另造相冲突的文字方案 |
| 运镜、台词、音效 | 留在本集视频说明，不写成图上字幕、运动拼贴或声音文字 |
| 资产来源 | 真实媒体输入与用途对应，画布文本记录源节点/版本/本集引用节点 |

默认光影由已采用场景图承担；仅当用户/确认分镜明确需要文字约束且与参考一致时补充，不凭空引入旧光影字段。

## 位置与身份

从确认分镜读取本场基准与变化点，继承左右、前后、朝向和道具归属。缺乏明确方向时可参照互动对象提出方案，不能在每张图独立随机决定；影响连续性的缺项先回分镜确认。

两个角色对话可以写"<Picture 1> 位于左前，3/4 正面朝右看向 <Picture 2>；<Picture 2> 位于右后，面朝左"；不能只写"双人对话"让模型自行交换身份。过肩镜须说明哪位是前景肩背，哪位在焦点位置。人物转向只能发生在分镜已有变化点，之后沿用新状态。

为不同角色保留各自来源和稳定辨识特征；避免同款分身，但不得删除剧情明确需要的相似角色。镜面或水面中的形象仍属于原角色，遵守 [空间与连续性](shotCraft.md#空间与连续性)，不凭"镜像"增加一个真人，也不机械翻转所有反射。

## 参考图提示词模板（H3 口径）

只为当前一镜填写一个版本，所有编号、主体和内容须替换为已验证输入。下面为提示词正文模板，不是 API 参数；参考标记一律 <Picture N>，N 为当前节点真实输入序列内该媒质的独立编号。

```text
<Picture 1> 为角色A参考，<Picture 2> 为角色B参考，<Picture 3> 为本场景参考。

【画面】在 <Picture 3> 的已确认空间内，[起始景别及角度]。
<Picture 1> 位于[明确位置]，面朝[方向/对象]，[该瞬间动作与表情]；
<Picture 2> 位于[明确位置]，[状态与互动关系]。
[分镜中其他关键物件、空间层次和可见信息，不删不添]。

【风格与一致性】[当前确认风格的必要短锚点]。
保持各参考角色的面部、发型、服饰与既定状态；沿用场景参考的空间和既定光照。
主体清晰，[符合当前画风的线条/材质质量要求]；无额外画外字幕、水印或界面覆盖文字。
```

正文中的主体通过相应真实引用标记与名称明确对应，不能只在开头列参考，正文却写含糊"他/她"。不再追加一份英文复述造成不同画面。若当前节点 schema 只暴露单一 prompt 字符串，把必要排除项写进正文，不发明 negativePrompt 参数。

## 结构化参考提示词（H3 口径）

这是传给 prompt 的结构化文本；JSON 字段是写作组织方式，不代表当前模型 API 实际存在这些参数。参考图片仍需真实连接，不能仅把 URL 写进 JSON；参考标记一律 <Picture N>。

```json
{
  "role": "Create the confirmed storyboard frame while preserving the identities and spatial continuity of the supplied references.",
  "character_reference": [
    {
      "image": 1,
      "ref": "<Picture 1>",
      "description": "Two or three verified identity and wardrobe features of character A."
    }
  ],
  "continuity_rules": [
    "Preserve the confirmed face, hairstyle, wardrobe and prop ownership.",
    "Keep the adopted environment and its established lighting.",
    "Change only the framing, pose and expression specified by this shot.",
    "Do not introduce additional characters."
  ],
  "shot": {
    "scene_and_framing": "Verified scene reference, starting shot size, camera angle and visible spatial layers.",
    "subject_and_action": "Every confirmed visible subject and object; exact starting or static state, screen position, facing direction, eye line and expression.",
    "style": "Only the approved style anchors and appropriate image quality description."
  },
  "negative": "Unrequested subtitles, watermark, UI overlays, identity drift, extra characters, incorrect prop ownership."
}
```

角色参考可以有多项，编号保持真实全体输入序列，不能把全局第 3 个输入重编号为"角色1"。场景/道具引用在 shot 中明确指向实际编号，不冒充角色。确需已确认的光照文字约束时可加 lighting 字段；没有该需求便不为填满模板额外设计。negative 仅为提示词文字中的排除项，是否支持独立负向参数仍以节点 schema 为准。

## 单帧转换示例（H3 口径）

确认分镜为："站厅出口，右侧指示牌；角色A 背着包停步仰望，手攥车票，左前位、3/4 正面朝右；全景固定；紧张但已作决定。"真实输入为人物、背包、车票、站厅四张参考。

可写：

```text
<Picture 1> 为角色A，<Picture 2> 为背包，<Picture 3> 为车票，<Picture 4> 为站厅。
【画面】<Picture 4> 出口的全景构图，右侧保留确认的指示牌。<Picture 1> 在左前位置停步，身体3/4正面朝右，仰望右侧指示牌，背着 <Picture 2>，手中攥着 <Picture 3>；眼神紧张但稳定。保留站厅前后空间关系。
【风格与一致性】沿用已确认风格及参考形象、场景状态；主体清晰，无额外字幕、水印和界面覆盖。
```

不能把"停步仰望"改为"正要抬头"，不能漏车票，不能为了画面好看添花瓣，也不能把未确认的人群、灯色写成事实。视频里的台词和车站环境音另留在视频说明，不出现在单帧提示词中。

## 质量与忠实性检查

- 逐项回溯分镜：主体/关键物件是否齐全，场景是否同一地点，起始景别/角度是否正确，动作语义与情绪是否一致，朝向是否沿基准。
- 风格与画质词是辅助；避免堆词覆盖画面主体。用户确认胶片颗粒、空气透视或风格性柔化时保留意图，并明确主体/关键细节应清楚，不能把风格本身判成错误。
- 景深可写 background bokeh, subject in sharp focus，不把背景虚化扩散成全图失焦；雾、烟和反射扭曲只在分镜确有需要时出现。
- 默认排除画外字幕、水印、UI；故事世界中的牌匾、信件、短信屏幕和道具文字若是确认信息，原文和存在方式必须保留，不能用"no text"一并删除。文字生成不可靠时记录需用户核对的内容。
- 同场批量逐镜处理，不跳行、不合并；身份/场景锚点保持一致，表情、动作、构图依各镜变化；模型/模式变更需检查原确认是否仍覆盖。

## 写入本集画布

每个实际需图单元保留：分镜来源与版本、首帧/末帧选择理由、起始景别与状态、当前模板/模型、完整执行提示词、真实参考映射。提示词通过节点函数写入，结构化说明写本集已有文本节点；节点字段以 schema 为准。

在"图像转换检查"记录逐项结果和未解决项，回读生成节点 prompt 与引用。生成成功后还要实际看图，确认身份、手部、接触关系、位置朝向及关键文字，不能以提示词检查替代图片验收。没有图像查看能力时保留待用户预览状态。

依据 v1.1.8（cd3e7c4）的 production_skills/storyboard_prompt_techniques.md 与 production_execution_storyboard_panel.md；旧模型参数与旧占位符已全量迁移为 H3 现行口径，权威口径见 docs/h3PromptAlignment.md。
