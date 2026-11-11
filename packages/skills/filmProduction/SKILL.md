---
name: filmProduction
description: AI 影视九阶段制作总技能：从创意、小说、剧本或已有工程出发，走概念锚定→角色圣经→世界观→分场大纲→正式剧本→剧本压力测试→图像资产→表演设计→镜头与视频提示词，产出资产卡与分镜，接入 Toonflow 多轨（MiniMax-H3）逐镜出片、人工验收、合成成片。用户要做 AI 短片/短剧/长片项目、改编小说、要剧本体检或改稿回退、要角色场景道具资产图、要表演设计或镜头提示词、要建/改/续接多轨工程、要验收合成成片时使用。纯文字闲聊或明确不用 Toonflow 时不启动制作。
metadata:
  version: "1.0.0"
  displayName: 影视九阶段制作
---

# 影视九阶段制作

一个技能管整条生产线。核心原则一句话：**阶段有唯一负责人、成果有状态、下游有依据、花钱有授权**——严格落在"采用与生成"上，不落在"讨论与试写"上。作者点名一张图、一个镜头，可以直接处理，不要求全剧齐备。

## 按本轮目标读对应手册

| 本轮要做的事 | 读 |
|---|---|
| 任何制作任务的第一步：定位阶段、读项目状态 | [项目结构与治理](references/overview.md)（必读）+ 下表对应册 |
| 概念锚定（含 A–E 定位菜单与模板） | [01concept](references/01concept.md) |
| 角色圣经 | [02characters](references/02characters.md) |
| 世界观（可选） | [03worldbuilding](references/03worldbuilding.md) |
| 分场大纲 | [04treatment](references/04treatment.md) |
| 正式剧本 / 小说改编 | [05screenplay](references/05screenplay.md) |
| 剧本压力测试（可选） | [06stresstest](references/06stresstest.md) |
| 资产清单、出图提示词、真实出图 | [07assetsImages](references/07assetsImages.md) |
| 表演档案与场景表演段落 | [08acting](references/08acting.md) |
| 拆镜、镜头表、生成单元 | [09shotPlanning](references/09shotPlanning.md) |
| H3 提示词编译与保真/连续性检查 | [10videoPrompts](references/10videoPrompts.md) |
| 落多轨工程、派工生成 | [11multitrack](references/11multitrack.md) |
| 验收、合成、交付、断点恢复 | [12delivery](references/12delivery.md) |
| 本地知识库检索（可选参考桥：剧本范本/方法书/文化原典/导演风格色卡） | [13knowledgeBase](references/13knowledgeBase.md) |
| 专项增强挂载（导演顾问、打戏、大招、造型、质感等 71 项分支） | [14enhancements](references/14enhancements.md) |
| 任何画布节点操作（读画布、建节点、连线、节点函数、配置） | [15canvasOps](references/15canvasOps.md) |
| 外部剧本接管（B 入口） | [overview.md 第 6 节](references/overview.md) |

## 九阶段一览

| 阶段 | 干什么 | 唯一输出 | 手册 |
|---|---|---|---|
| 01 概念锚定 | 定故事方向、主线、结局、作品定位 A/B/C/D/E | `filmProject/concept/synopsis-vNNN.md` | 01 |
| 02 角色圣经 | 完整文字人物档案与可辨声线（不是生图） | `filmProject/characters/characters-vNNN.md` | 02 |
| 03 世界观（可选） | 只写会改变人物选择的规则与代价 | `filmProject/worldbuilding/worldbuilding-vNNN.md` | 03 |
| 04 分场大纲 | 逐场事件、冲突、场尾结果、时长初估 | `filmProject/treatment/treatment-vNNN.md` | 04 |
| 05 剧本 | 深度融合写可拍剧本 + 成稿时长复核 | `filmProject/screenplay/screenplay-vNNN.md` + `timingAudit-vNNN.md` | 05 |
| 06 压力测试（可选） | 只出诊断报告；改稿须作者授权 | `filmProject/stressTest/report-vNNN.md` | 06 |
| 07 图像资产 | 资产清单→提示词→真实出图并验收，落资产卡 | `assets/assetCards.md` + `filmProject/assets-vNNN.md` + 画布图片节点 | 07 |
| 08 表演设计 | 表演主档案 + 每场的行为、潜台词、节拍、时长依据 | `filmProject/acting/<场次>-acting-vNNN.md` | 08 |
| 09 镜头与提示词 | 镜头表→生成单元→H3 六段提示词→多轨 clips | `filmProject/shots/<场次>/` + `plan/story.mtrack` | 09–11 |

## 入口判定（一轮定方向）

```text
A. 从零创作（01→09 顺序，03/06 可选）
B. 已有完整剧本（先问是否 06 体检；跳过则剧本接管：原稿登记外部提供-已确认，
   只补生产资料，不重跑 01–04）
C. 资料接力（大纲/角色/部分剧本，从对应阶段续，缺什么只报什么）
D. 镜头级优化（只处理点名的资产、表演或镜头，直接出修改草稿）
E. 多轨续接（工作区已有 plan/story.mtrack：先 mtrackRead 读实际进度继续）
```

合作档位一次选定并记入 `filmProject/projectStatus.md`：新手（推荐最短下一步）/ 进阶（可跳步试写）/ 高手（直接处理点名内容）；09 另有拍法档位：快速出片 / 一起打磨 / 自由掌镜。档位只改变讨论深度，**不放松任何采用与生成门禁**。

两个独立可选开关，各只问一次、记录后不重问：**本地知识库**（A 不调用/B 智能匹配/C 只查方法书，见 13 册——新项目第一份创作成果前问）与 **专项增强**（阶段首次进入时给 1–3 项智能推荐+完整菜单入口，见 14 册）。都不选时九阶段照原流程完整工作，不检索、不加载任何分支正文。

## 视频提示词路由锁存（最高优先级入口规则）

同时满足两项时，立即锁定为 **H3 提示词执行态**，不要求用户说出"提示词/H3/Seedance"等任何关键词：①已有可执行的定稿剧本、时间轴、镜头剧情段或已确认片段文本，或用户要求继续已有视频制作；②当前目标是制作/生成/继续/修订视频或为其准备提示词。

锁定后：
- **先走 09→10 册完成分段与提示词规划定稿，再处理画布与工程配置**；不得因为要先 `node:getConfig`、问画幅/分辨率/模式/provider、先读画布、或先做通用分镜而跳过或打断该执行态。执行配置问题属于同一任务的参数补充，回答后继续同一执行态，不解除锁存、不回通用流程重选方法。
- 用户在配置问答中只回"16:9""768P""2.5"这类短答案时，视为当前任务的参数补充，不是新任务，不得因这条回复没有再出现关键词而解除锁存。
- 只有用户明确把任务改成"不要视频提示词，只做资产/剧本/咨询/非视频工作"才解除；锁存期间不套用 07 的设计提案口径改写六段，也不读取已被 10 册取代的旧方法。
- 定稿后若要求写节点、连参考、生成与验收：进入 11/12 册执行层，**只搬运定稿 prompt**，不得重新分段或改写已锁内容；能力冲突报告后回 10 册受影响项。

## 治理底线（细则在 overview.md）

1. 成果七状态：`未开始 / 草稿待确认 / 已确认-当前 / 外部提供-已确认 / 已过期-禁止使用 / 历史已替代 / 缺文件-阻断`；只有"已确认"两种能进下游。
2. 版本各阶段独立 v001→v002 递增，先扫描取号，永不覆盖；成果末尾带版本卡。
3. 确认 ≠ 授权生成 ≠ 采用结果，三类分开记录；"继续"和沉默不构成新生成授权。
4. 交接读确认版原件全文，摘要不代替原件。
5. 只导演不编剧：写进提示词的每个剧情状态变化必须能映射回原文账本 `E##`；AI 自己补的内容不升级成事实，模糊保持模糊，不补前史。
6. `status=accepted` 只能由用户在多轨界面点；没读到真实产出不得写 `generated`；不伪造读图、版本、验收、生成成功。
