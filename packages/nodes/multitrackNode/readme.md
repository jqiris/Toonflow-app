# 多轨编辑器节点

在画布上直接打开多轨制作工程，查看分镜摘要并进入完整的多轨编辑器。

## 功能

- 卡片内直接展开多轨编辑器：轨道、分镜编辑、状态面板与批量派工，与文件面板中的多轨编辑器同源。
- 派工由编辑器经画布桥直接调用节点工具逐镜生成视频（缺节点时建节点 → 配模型 → 写提示词 → 发起生成 → 轮询状态），
  不经对话模型；状态与产物由编辑器直接回写多轨工程。
- 对话 Agent 可经 15 个节点函数直接操作本节点：13 个由节点自身注册——`node:getStatus` 探针、`node:bindProject` 绑定工程、`node:readClips` 读镜头（读前对账磁盘）、`node:editProject` 整批原子批量编辑、`node:saveProject` 强制保存、`node:reloadProject` 重载、`node:dispatchGenerate` 发起派工（等价「生成选中段」，立即返回批次号）、`node:cancelBatch` 按批次取消、`node:pauseBatch` 请求暂停（等价「本镜结束后暂停」的软闸门，不中断在跑镜头，本镜结束后不再开始下一镜）、`node:resumeBatch` 沿用同一 `batchId` 续跑剩余镜头（等价「继续生成」，须传 `clips`）、`node:retryClip` 只重试单镜（生成成功后作为新版本追加，生成进行中被拒）、`node:rewritePrompt` 整理单镜提示词（只调文本模型返回 `{ text, requiresReview }`，不改工程；用户确认后由 agent 用 `node:editProject` 写回）、`node:refreshOutput` 重读合成成片；另外 2 个引用函数由 `useNodeReferences()` 自动注册（`packages/nodeShared/src/useNodeReferences.ts`）——`node:getReferenceOrder`（查询端口当前生效的参考顺序，返回 references 与 `{{ref N}}`（画布 mention chip）的 referenceMentions 文本）、`node:setReferenceOrder`（按给定 sources 顺序重写 referenceOrder 与参考编号）。函数语义与调用纪律见 assetCard 技能 runbook 的「对话 Agent 直接操作画布多轨节点」节。
- 镜头视频版本机制：重新生成（重新生成本镜、单镜重试、生成选中段勾「包含已生成」）不覆盖旧视频，而是为同一分镜新建一个视频节点追加版本，旧节点与旧视频保留在画布上；`attempts` 里状态为 `succeeded` 的记录按 `nodeId` 去重即该镜的版本历史（旧→新），新视频生成完成自动成为该镜默认版本。状态面板的「历史版本」可预览各版本，「设为默认」即可切回旧版本；agent 侧则以 `node:editProject` 的 `patch` 写回该镜 `nodeId`/`assetPath` 完成同一件事（生成中不可切）。合成成片取 `accepted` 镜的当前默认 `assetPath`。
- 卡片右下角可拖拽改尺寸，尺寸随画布保存，刷新后保留。

## 提示词格式（MiniMax H3 官方 ref2va 六段）

镜头提示词由写作者直接按官方六段书写，引擎不代写参考内容：

- `subject_definitions`、`summary`、`retention_analysis`、`detailed_description` 四段写进 `clips[].prompt.integratedMultimodalDescription`；`overall_soundscape`、`non_diegetic_music` 各自落 `overallSoundscape` / `nonDiegeticMusic` 字段。
- 参考一律写官方 `<Picture N>`；官方标记按类型各自从 1 编号——正文写 `<Picture 1>`、`<Picture 2>`，编号只在图片参考里数，音频写 `<Audio 1>`、视频写 `<Video 1>`，三者各自从 1 起。挂了 2 张图 + 1 段音频时正确是 `<Picture 1>`、`<Picture 2>`、`<Audio 1>`，把音频写成 `<Picture 3>` 是错的。
- 旧 `{{ref N}}` 是含图片/视频/音频/文本的全局序号，与官方标记编号基数不同，不存在「`<Picture N>` = `{{ref N}}`」的等号映射；它只作为旧工程兼容说明出现——生成时由 wire 层（`packages/nodes/videoGenerationNode/src/index.vue:212-224` 的 `referenceTags`）按 `dataType` 逐项换算，不是写作者的写法。
- 需要复用身份、场景、道具时在 `subject_definitions` 里用 `<Subject N>` 定义，并写明它来自哪张 `<Picture N>`。
- `node:setPrompt`（画布视频节点的提示词函数，逐镜直连与派工下发都经过它）只接受这套官方标记：写 `<Picture N>`，不写旧 `{{ref N}}` 占位标记。`{{ref N}}` 是画布 mention chip（`packages/nodeShared/src/useNodeReferences.ts`），节点在 wire 层按引用类型把 `{{ref N}}` 换算成对应的 `<Picture N>` / `<Video N>` / `<Audio N>`（`packages/nodes/videoGenerationNode/src/index.vue:212-231`，仅 MiniMax H3/freevideo 路径生效）；旧工程里已写下的 `{{ref N}}` **不由引擎改写**（`packages/nodeShared/src/mtrack/directDispatch.ts:97-106` 的 `buildPrompt` 原样透传正文），而是由 wire 层按参考类型换算兼容，不是新写法。
- 引擎只补「全片风格 / 全片约束」前缀，不代写资产定义段、镜头摘要段、参考保持分析段与「本段参考顺序」声明行。

## 使用方法

1. 画布右键「添加节点」选择「多轨编辑器」。
2. 新节点不自动继承工作区已有的工程：没绑定时卡片先给出「新建空白工程 / 打开现有工程」两个选择。新建会从 `plan/story.mtrack` 起找第一个未占用的路径（如 `plan/story-2.mtrack`），绝不覆盖已有工程；多个节点可以共用同一份工程。
3. 编辑与派工操作自动保存（800 毫秒防抖），关闭弹窗前会强制落盘；磁盘文件被其他操作修改时会提示重新加载。

编辑器内核位于 `@toonflow/node-shared/mtrack`，与文档面板的多轨扩展共用同一份实现。
