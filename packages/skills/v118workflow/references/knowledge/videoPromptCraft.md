# 视频模式、模型模板与声音知识

用于视频准备与验收。先读取已确认分镜、制作单元及真实参考，再只读本文件中本次适用模板；风格使用 [视觉风格](visualStyles.md) 的当前确认条目，镜头、计时与连续性用 [镜头知识](shotCraft.md)。本文件保留 v1.1.8 的内容约束与模板方法学，全部示例已改写为 H3 现行口径（视频生成仅支持 MiniMax-H3，提示词内参考标记一律 <Picture N> / <Video N> / <Audio N>，权威口径见 docs/h3PromptAlignment.md）。

## 先选实际输入模式

| 已确认能力与路线 | 可采用的现行 H3 模板 | 制作单位 |
|---|---|---|
| 多参考输入（角色/场景/道具）| 下文 References/Instruction 多参模板 | 一个确认片段，包含原有全部子镜头 |
| 单图首帧输入 | 下文 I2VA 单首帧模板 | 一个确认镜头及一张首帧 |
| 已确认首帧/首尾帧，要求连续镜头 | 下文 Visual/Motion/Camera/Audio/Narrative 连续镜头模板 | 一个已确认连续动作单元；本流程首帧路线默认每镜一单元 |
| 无媒体输入的纯文本路线 | 下文 T2VA 纯文本模板 | 一个确认片段 |

现行提示词统一按 H3 官方六段格式组织（subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music），首帧路线在 detailed_description 首行逐字写入官方首帧对齐指令；参考标记 <Picture N> / <Video N> / <Audio N> 各媒质独立编号。下表是内容模板选择，不是模型兼容性白名单。先查模型支持的媒体类型/数量、模式、时长、分辨率、声音与当前节点配置。用户明确选择的模板与当前 schema 优先。

## 所有模板共用的内容约束

1. 先列单元来源、原镜号顺序、完整台词、声音、动作起终状态、实际参考及总时长；不重新分组、不合并已确认镜头。
2. 一份提示词只服务当前制作单元。开头或正文的说明要与实际输入一致；资产图负责身份/外观，分镜图负责该镜构图，不把角色三视图说成首帧画面。
3. 图像、视频、音频必须是真的媒体输入，不是 URL 字符串、文件名或虚构编号。统一输入序列与供应商分类型请求的映射按 [画布执行](../canvasOperations.md) 核对；无法证明映射时停在待确认，不自行改编号。
4. 提示词内参考标记一律写 <Picture N> / <Video N> / <Audio N>，N 为当前节点真实输入序列内该媒质的独立编号；不再使用旧的双花括号 ref 占位符与旧 @ 前缀编号等写法，尤其不能沿用旧模板把音频称为"图片"。
5. 说话者与声音归属明确。普通对白有对应口型；OS/VO 不让画面人物跟着张嘴，听者反应镜也不转移说话人。所有台词保持原语言原字句。
6. 动作写可见过程、速度和结束状态，情绪通过姿态/视线/呼吸体现；不添加台词、动机、地点、人物或装饰事件。
7. 继承已采用场景光照和视觉风格；不根据旧英文示例另造黄昏、冷调、服装或风向。光影段仅在确认输入确有相应信息时保留。
8. 默认只用真实环境声、动作声，不自行配乐。画内文字与画外字幕分开；不能为了默认"无文字"删掉剧本中的信件、招牌、屏幕信息或用户明确字幕需求。
9. 时长在画布配置与台词容量中必须明确，即使所选写作模板不在 prompt 正文写秒数，也不能交给模型随意推断。单元上限为本流程 15 秒与实际模型能力较小者；不兼容则回分镜确认。

## 多参参考模板（H3 口径）

沿用三段式：先定义主体/场景/道具，再依原镜号写全部镜头，最后给简短风格与稳定性约束。只适用于本次确认采用该模型及输入模式时；不强制其他模型改成这套语法。

### 填写方法

- 第一段把每个实际参考与两三个核实过的稳定特征绑定，角色用 <主体1>、场景用 <场景1>、道具用 <道具1>；三类标签分别编号。标签是 prompt 内部指代，不是节点 ID。
- 参考标记按媒质独立编号：图片 <Picture N>、视频 <Video N>、音频 <Audio N>；不同媒体类型各自从 1 开始编号，不跨媒质共用。
- 同场已有确认承接说明，原样放在定义之后，作为首镜起始状态。新场首片段不强行写承接；实际上一段输出还未采用时只记规划状态。
- 一镜对应原分镜一条，不跳镜、不调序。每镜按"景别及主要运镜 → 动作/表情 → 位置与朝向 → 台词/音效"组织。
- 一镜使用一个主要运镜；正文用原镜号，不写绝对时间轴；真实时长仍配置在节点并留在单元说明。
- 台词用花括号，音效用尖括号；不把内部资产 ID、工具调用、审核说明塞进执行 prompt。

```text
将 <Picture 1> 中的[已核实的稳定身份特征]定义为 <主体1>（角色A）；
将 <Picture 2> 中的[已确认空间锚点]定义为 <场景1>（场景名）；
将 <Picture 3> 中的[已确认结构特征]定义为 <道具1>（道具名）。

[有则逐字保留：承接上镜的确认说明]

镜头1：[景别 + 一个主要运镜]。<主体1> 在 <场景1> 的[位置]面朝[方向]，
[确认动作及表情的可见演进]，与 <道具1> [真实互动]。
<主体1> 说 {原台词}，音色：[已确认声音特征或真实音频引用 <Audio 1>]。<[具体声源]>。
镜头2：[原分镜的下一镜，沿用身份、道具归属与前镜结束状态]。
[无台词镜只写无台词及实际音效；OS/VO使用对应标注并保持人物不对口型]

[当前已确认风格的必要短标签]；主体身份与脸部稳定，动作连贯，
保持明确的角色差异和空间关系，无无依据分身、水印或画外覆盖文字。
```

音色只在有语音时安排。已有确认音频样本且模型支持该输入时，绑定该角色真实音频 <Audio N>；无样本不强制用户提供。可按"年龄感、音高、清亮/沙哑等质感、厚薄、发音、气息、语速、情绪特征"提出简洁声音方案，未经确认不把旧表按性别/反派身份给出的默认声音当事实。无需九个维度都堆满，也不能给没有声音能力的模型许诺音色控制。

```text
普通对白：<主体1> 说 {原台词}，音色：[确认描述 <Audio 1>]；只有该说话者口型对应。
内心独白：<主体1> 内心OS {原台词}，音色：[确认描述]；嘴部不随声音开合。
画外音：画外音VO {原台词}，[明确声音来源]；画内人物不跟随旁白对口型。
无台词：无台词，<[需要的环境声或动作声]>。
```

约束包只加本单元需要的项。普通多主体场景可明确人数与辨识特征，防止克隆；剧情确有双胞胎不能套"禁止外形相同人物"删角色。不能因多人动态例子写"固定机位"就覆盖用户确认的跟拍。

## I2VA 单图首帧模板（H3 口径）

输入是一张已采用首帧和一个确认镜头。用英文叙事段落：风格基调 → 主体动作和环境 → 摄像机收尾。没有尾帧，不使用参考编号；首帧通过真实图像输入传入，并在 detailed_description 首行逐字写入官方首帧对齐指令：
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

人物只写由首帧核实的少量识别特征，重点放在接下来怎么动。情绪用动作暗示，例如"目光下落、肩膀缓慢沉下"须是确认表演，不能用模板凭空增加。不用 4K、cinematic、high quality 反复堆砌，不靠英文翻译更改台词语言。

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
[A concise sentence expressing the approved visual style.]
[Character name and a few verified identity features] begins in [the exact adopted first-frame state],
then [the confirmed action, pace and emotional progression], ending in [the confirmed end state].
[The verified setting, relevant object and spatial relationship; no invented scenery.]
[Only an already approved and consistent lighting constraint, if necessary.]
"[原语言完整台词]" — [Speaker] (dialogue / inner monologue, OS / voiceover, VO).
[Specific environmental and action sounds, or No dialogue where applicable.]
Captured in [starting shot size and angle], [the confirmed camera movement and endpoint],
as one continuous shot.
```

无台词时删台词行，写 No dialogue；有 OS/VO 时明确人物 silent lips。模板正文不写秒数，节点 duration 仍使用已确认值。

## 通用首帧/首尾帧五段式（H3 口径）

用于用户已确认的连续镜头：首帧给起始状态，尾帧仅在当前模式支持且实际需要时使用。纯文本描述主体，不在正文内编号引用帧；起尾帧位置由真实模式/输入绑定；参考标记一律 <Picture N>。

```text
[Visual]
[Character A]: [verified identity anchors], [starting position and posture], [speaking/silent].
[Character B, if present]: [verified identity anchors], [position], [speaking/silent].
[Confirmed setting, relevant prop and approved style.]

[Motion]
0s-[t1]s: [The first confirmed action and state change].
[t1]s-[total]s: [The subsequent confirmed action ending in the adopted end-frame state if supplied].

[Camera]
[Starting size and angle], [one continuous camera path and final framing],
single continuous take, no cuts.

[Audio]
[Actual planned interval]: "[原语言完整台词]" — [speaker] (dialogue, lip-sync active).
[OS/VO, if present, with silent lips; other characters remain silent].
[Specific environmental and action sounds].

[Narrative]
[The existing dramatic beat and its relation to this confirmed unit; no added event].
```

时间轴只在该模板且真实模式适合时使用，每段至少 1 秒、连续覆盖已确认总时长；秒数需按对白容量和动作分配，不平均切块、不捏造精确控制保证。说话状态可以随区间变化；不同人物各有台词时明确谁何时 speaking，其他时段 silent，不把角色永久标 silent。

首尾帧不得表现无法在给定时长内完成的位移/形变，也不能用"无切镜"把原来两场硬拼成一个空间。若现有确认单元包含真实切镜，回模式/分镜确认，不自行删镜去适配。

## 通用多参 References/Instruction（H3 口径）

适用于其他真实可用多参模式。保留"参考用途清单 + 英文执行说明"，画面身份由实际参考承担；台词保持原文，时长在节点配置中明确。参考标记 <Picture N> / <Video N> / <Audio N> 各媒质独立编号。

```text
[References]
<Picture 1>: [Character A identity reference].
<Picture 2>: [Confirmed scene reference].
<Video 1>: [Optional composition reference from adopted storyboard, if present].
<Only list other real inputs; describe their actual type and purpose with the matching <Picture N>/<Video N>/<Audio N> label.>

[Instruction]
[Approved visual style in a short phrase].
Shot [original number]: [Shot size and camera move].
The character from <Picture 1> [confirmed action and expression],
[explicit screen position, facing direction and interaction],
in the environment of <Picture 2>.
"[原语言完整台词]" — [speaker] (dialogue / inner monologue, OS / voiceover, VO).
[Specific physical sounds; other characters' lip-sync state when needed].
Shot [next original number]: [Next confirmed shot with matching continuity].
[Retain the confirmed ending state and exclude only unrequested overlays or duplicates].
```

如果实际接入了本镜已采用分镜图，可加"Use <Video 1> as the composition reference for shot K"；缺分镜图便不写这句、不分配假编号，资产参考仍然有效。若整单元确实无媒体输入且模型允许，使用已确认的纯文本路线与可读主体名，不假装多参参考存在。

多镜只在当前模型/模式和已确认分组允许时使用，不能从这个模板推出所有多参模型都支持镜头切换。

## 动作、声音与镜头词汇

镜头术语要精确表达画面，而非盲套旧映射。大远景可用 extreme wide shot，远景 wide shot，全景 full shot，中景 medium shot，近景 medium close-up，特写 close-up，大特写 extreme close-up。近景不能一律翻成面部特写，构图部位有歧义时写清裁切。

固定为 static camera；推为 push in/dolly in；拉为 pull back/dolly out；跟拍 tracking shot；摇须说明 pan left/right 或 tilt；升降 crane up/down；环绕 orbit around 并说明方向。空间动词如 holding、standing beside、following behind、sitting in 必须与画面和道具归属一致。handheld、slow motion、Dutch angle 只在确认分镜需要时出现。

英文模板中描述语句可英文，台词原文不翻译。对白时间可跨听者反应镜，声音仍归说话人；OS/VO 的有声信息和无口型关系要同时明确。纯文字信息的语音化、逐行点亮或提示音属于需确认的呈现方案，不因旧模板默认添加。

## 本集记录、执行前核对与验收

在本集已有制作说明/阶段记录中保存：

- 采用模板及理由、当前实际模型/模式、片段或镜头范围、目标时长与规格。
- 全部原镜号对应提示词段落，完整台词与说话人/OS/VO、声音来源和口型要求。
- 实际参考类型、顺序、用途、源资产版本与当前节点；首尾帧注明起终作用，未就绪项不删除后重编号。
- 首镜开始状态、上一片段采用结果或规划依据、结束状态与下一段衔接方式。
- 完整执行 prompt 和用户确认范围；模板正文不混入审核报告，审核意见保存在可读说明。

写入后通过节点函数回读 prompt、配置、连线及输出基线，确认用户批准的是这一实际方案。生成状态遵守 [画布执行](../canvasOperations.md)；"generating"、reload 后 idle 或旧输出不能证明本次成功。

验收时看实际媒体的身份、动作/道具接触、人物左右与视线、镜头顺序、对白完整性、声音来源与口型、末尾是否截断，以及前后片段的实际交界状态。逐项写明已查看的证据与问题位置。当前工具无法播放/理解视频或读取音轨时，由用户预览回报，记录"待用户核验"；文件路径与成功状态不能冒充已经看过、听过。用户采用前，成功视频仍是候选。

依据 v1.1.8（cd3e7c4）中的多模型视频模板方法学；旧占位符与旧模型参数已全量迁移为 H3 现行口径，权威口径见 docs/h3PromptAlignment.md。
