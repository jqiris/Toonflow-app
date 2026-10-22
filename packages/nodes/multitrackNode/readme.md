# 多轨编辑器节点

在画布上直接打开多轨制作工程，查看分镜摘要并进入完整的多轨编辑器。

## 功能

- 卡片内直接展开多轨编辑器：轨道、分镜编辑、状态面板与批量派工，与文件面板中的多轨编辑器同源。
- 派工由编辑器经画布桥直接调用节点工具逐镜生成视频（缺节点时建节点 → 配模型 → 写提示词 → 发起生成 → 轮询状态），
  不经对话模型；状态与产物由编辑器直接回写多轨工程。
- 对话 Agent 可经 11 个节点函数直接操作本节点：9 个由节点自身注册——`node:getStatus` 探针、`node:bindProject` 绑定工程、`node:readClips` 读镜头（读前对账磁盘）、`node:editProject` 整批原子批量编辑、`node:saveProject` 强制保存、`node:reloadProject` 重载、`node:dispatchGenerate` 发起派工（等价「生成选中段」，立即返回批次号）、`node:cancelBatch` 按批次取消、`node:refreshOutput` 重读合成成片；另外 2 个引用函数由 `useNodeReferences()` 自动注册（`packages/nodeShared/src/useNodeReferences.ts`）——`node:getReferenceOrder`（查询端口当前生效的参考顺序，返回 references 与 `{{ref N}}` 的 referenceMentions 文本）、`node:setReferenceOrder`（按给定 sources 顺序重写 referenceOrder 与参考编号）。函数语义与调用纪律见 assetCard 技能 runbook 的「对话 Agent 直接操作画布多轨节点」节。
- 卡片右下角可拖拽改尺寸，尺寸随画布保存，刷新后保留。

## 使用方法

1. 画布右键「添加节点」选择「多轨编辑器」。
2. 新节点不自动继承工作区已有的工程：没绑定时卡片先给出「新建空白工程 / 打开现有工程」两个选择。新建会从 `plan/story.mtrack` 起找第一个未占用的路径（如 `plan/story-2.mtrack`），绝不覆盖已有工程；多个节点可以共用同一份工程。
3. 编辑与派工操作自动保存（800 毫秒防抖），关闭弹窗前会强制落盘；磁盘文件被其他操作修改时会提示重新加载。

编辑器内核位于 `@toonflow/node-shared/mtrack`，与文档面板的多轨扩展共用同一份实现。
