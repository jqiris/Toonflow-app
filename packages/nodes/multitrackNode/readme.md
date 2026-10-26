# 多轨编辑器节点

> **H3 口径声明**：本工作流视频生成仅支持 MiniMax-H3（H3 官方六段格式 + `<Picture N>` / `<Video N>` / `<Audio N>` 参考标记）；不接受其他视频模型或旧格式占位符。

在画布上直接打开多轨制作工程，查看分镜摘要并进入镜头创作工作台（预览与项目管理在独立的「项目与成片」浮窗）。

## 在流程里的位置

本节点是制作流程的**最后一步**，不要一开始就建它：先在画布上用「导入资产与分镜」节点把剧本抽成资产卡与分镜（写出 `plan/assetIndex.json` 与 `plan/story.mtrack`），资产图节点出图后连到本节点的参考输入端口，再回到本节点绑定该工程、在「参考素材」里**从连线上的资产卡中打勾**（勾选位次就是官方 `<Picture N>` / `<Video N>` / `<Audio N>` 的编号基数），最后逐镜派工、验收、合成。参考网格不会预先摆出还没连过线的素材。

## 功能

- 卡片内直接展开镜头创作工作台：镜头页签条、镜头内容（提示词大框 + 衔接校验）、参考素材勾选网格、生成范围与「03 生成视频」footer（保存 / 生成视频 / 本镜结束后暂停 / 继续·重试 / 结束本批），与文件面板中的多轨编辑器同源。
- 「项目与成片」浮窗：在画布世界层（teleport 到变换层，根元素 `nopan nozoom`）渲染，随画布一起平移缩放；标题栏拖动、右下角缩放、收起/展开，预览大窗与逐镜版本菜单（「用于合并」勾选 = 验收 accepted，「设为默认」切版本）。浮窗几何（位置/尺寸/收起态）写进节点 `data.resultsUi`，与卡片尺寸同一套画布自动保存链路，刷新后位置不丢（缺省在节点右缘外 64px、1360×1480）。
- 派工由编辑器逐镜组装请求交给服务端媒体任务通道（取参考路径 → 拼提示词 → `/api/ai/media/generate` 提交 → 轮询 `tasks/status`），
  不经对话模型；状态与产物由编辑器直接回写多轨工程。
- 对话 Agent 可经 16 个节点函数直接操作本节点：14 个由节点自身注册——`node:getStatus` 探针、`node:bindProject` 绑定工程、`node:readClips` 读镜头（读前对账磁盘）、`node:readReferenceMap` 一次读全参考映射链（镜 → 资产卡 → 画布节点 → 官方参考位次，直接给出 `unconnectedCardIds` / `orphanSources`，映射断在哪一步一眼可见）、`node:editProject` 整批原子批量编辑、`node:saveProject` 强制保存、`node:reloadProject` 重载、`node:dispatchGenerate` 发起派工（等价 footer「生成视频」按范围派工，立即返回批次号）、`node:cancelBatch` 按批次取消、`node:pauseBatch` 请求暂停（等价「本镜结束后暂停」的软闸门，不中断在跑镜头，本镜结束后不再开始下一镜）、`node:resumeBatch` 沿用同一 `batchId` 续跑剩余镜头（等价「继续生成」，须传 `clips`）、`node:retryClip` 只重试单镜（生成成功后作为新版本追加，生成进行中被拒）、`node:rewritePrompt` 整理单镜提示词（只调文本模型返回 `{ text, requiresReview }`，不改工程；用户确认后由 agent 用 `node:editProject` 写回）、`node:refreshOutput` 重读合成成片；另外 2 个引用函数由 `useNodeReferences()` 自动注册（`packages/nodeShared/src/useNodeReferences.ts`）——`node:getReferenceOrder`（查询端口当前生效的参考顺序，返回 references 与画布 mention chip 的 referenceMentions 文本）、`node:setReferenceOrder`（按给定 sources 顺序重写 referenceOrder 与参考编号）。函数语义与调用纪律见 assetCard 技能 runbook 的「对话 Agent 直接操作画布多轨节点」节。
- 镜头视频版本机制：重新生成（镜头操作里的「重新生成本镜」、单镜重试、按范围重派勾「包含已生成」）不覆盖旧视频——每次成功生成都是媒体通道落盘的新产物文件（`assets/<分镜号>/` 下），新产物自动成为该镜默认版本，旧文件保留；`attempts` 里 `succeeded` 的历史记录即该镜版本台账（旧→新，其中旧画布节点版次按 `nodeId` 去重可在「历史版本」里预览/切回）。「生成结果 · 校验」折叠区与「项目与成片」浮窗的版本菜单都可预览各版本、「设为默认」切回旧版本；agent 侧则以 `node:editProject` 的 `patch` 写回该镜 `nodeId`/`assetPath` 完成同一件事（生成中不可切；删除版本入口不开放）。合成成片取 `accepted` 镜的当前默认 `assetPath`。
- 卡片右下角可拖拽改尺寸，尺寸随画布保存，刷新后保留。

## 提示词格式（MiniMax H3 官方 ref2va 六段）

镜头提示词由写作者直接按官方六段书写，引擎不代写参考内容：

- 六个官方段各自落 `clips[].prompt` 的六个驼峰字段：`subject_definitions` → `subjectDefinitions`、`summary` → `summary`、`retention_analysis` → `retentionAnalysis`、`detailed_description` → `detailedDescription`、`overall_soundscape` → `overallSoundscape`、`non_diegetic_music` → `nonDiegeticMusic`；每段字段首行必须写官方段名（如 `subject_definitions:`）。
- 参考标记统一写官方 `<Picture N>` / `<Video N>` / `<Audio N>`，每个类型的 `N` 独立从 1 起，位次取自该类型资产在 `referenceIds` 数组中的先后（同类型去重后按出现顺序）——例如 `referenceIds: ["C01(IMAGE)", "A01(AUDIO)", "C03(IMAGE)"]` 对应 `<Picture 1>` / `<Audio 1>` / `<Picture 2>`，同类型内部不跳号，类型之间互不干扰。
- 需要复用身份、场景、道具时在 `subject_definitions` 里用 `<Subject N>` 定义，并写明它来自哪张参考（`<Picture N>` / `<Video N>` / `<Audio N>`）。
- `node:setPrompt`（画布视频节点的提示词函数，派工下发都经过它）收到什么正文就发什么正文：`buildPromptText`（`packages/nodeShared/src/mtrack/mediaDispatch.ts`）只做两件事——按六段固定顺序把非空字段用空行拼成一段、并按需注入首帧指令 `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`（有 `referenceIds` 时）；退化到无参考时只下发 `detailed_description` / `overall_soundscape` / `non_diegetic_music` 三段。旧「全片风格 / 全片约束」前缀与旧「双花括号 ref 占位符」到 `<Picture N>` 的换算层均已删除，正文出现旧双花括号 ref 占位符会被 `composeClipRequest` 判 error。
- 引擎不代写任何一段内容；正文漏写官方段首时，该字段整段不下发。


## 使用方法

1. 画布右键「添加节点」选择「多轨编辑器」。
2. 新节点不自动继承工作区已有的工程：没绑定时卡片先给出「新建空白工程 / 打开现有工程」两个选择。新建会从 `plan/story.mtrack` 起找第一个未占用的路径（如 `plan/story-2.mtrack`），绝不覆盖已有工程；多个节点可以共用同一份工程。
3. 编辑与派工操作自动保存（800 毫秒防抖），关闭弹窗前会强制落盘；磁盘文件被其他操作修改时会提示重新加载。

编辑器内核位于 `@toonflow/node-shared/mtrack`，与文档面板的多轨扩展共用同一份实现。
