# 生产管线 Agent 架构

> 文档目标：描述生产管线（Production Pipeline）中 Agent 编排、衍生资产（Derivative Assets）与分镜（Storyboard）的完整数据流，覆盖多角色/多场景/多道具三类衍生场景。

---

## 1. 整体架构

生产管线由 **productionAgent** 统一编排，内部包含 7 个子 Agent，通过 socket.io 与前端通信，所有图像生成均通过前端中转（无直接 HTTP 调用）。

### 1.1 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| Production Agent (编排) | `src/agents/productionAgent/index.ts` | 运行决策 Agent → 按 6 阶段顺序派发给各子 Agent |
| 决策 Agent Skill | `data/skills/production_agent_decision.md` | 6 阶段管线定义，Stage 2 必须严格遵循 Stage 1 的衍生预列表 |
| Agent 工具 | `src/agents/productionAgent/tools.ts` | `add_deriveAsset` / `generate_deriveAsset` / `generate_storyboard` / `get_flowData` |
| 衍生图片生成 | `src/routes/production/assets/batchGenerateAssetsImage.ts` | 单参考图生成（依赖父资产图片） |
| 分镜图片生成 | `src/routes/production/storyboard/batchGenerateImage.ts` | 多参考图生成（通过关联表 o_assets2Storyboard） |
| 衍生资产 Skill | `data/skills/production_execution_derive_assets.md` | 衍生资产创建规则与典型衍生列表 |
| 生成资产 Skill | `data/skills/production_execution_generate_assets.md` | 调用 generate_assets_images |
| 分镜生成 Skill | `data/skills/production_execution_storyboard_gen.md` | 调用 generate_storyboard_images |
| Socket 路由 | `src/socket/routes/productionAgent.ts` | 仅管理 chat/abort 生命周期 |

### 1.2 子 Agent 列表

1. **deriveAssetsAgent** — 创建衍生资产记录
2. **generateAssetsAgent** — 生成衍生资产图片
3. **directorPlanAgent** — 导演分镜计划
4. **storyboardGenAgent** — 生成分镜图片
5. **storyboardPanelAgent** — 分镜面板管理
6. **storyboardTableAgent** — 分镜表格管理
7. **supervisionAgent** — 质量监督（Stage 1 和 Stage 4 后自动触发）

---

## 2. 完整数据流

```
脚本 → 父资产提取 → Stage 1: 导演计划（6 维度 + 衍生预列表）
                             ↓
                 Stage 2: 创建衍生资产（o_assets，assetsId=父资产ID）
                             ↓
                 Stage 3: 生成衍生图片（单参考图，fire-and-forget）
                             ↓
                 Stage 4: 分镜面板（关联 assetsId → o_assets2Storyboard）
                             ↓
                 Stage 5: 生成分镜图片（多参考图，fire-and-forget）
                             ↓
                 Stage 6: 视频生成
```

### 2.1 Stage 1 — 导演计划

决策 Agent 读取脚本与父资产，生成 6 维度创意方案：

1. **主题与基调** — 故事主题、情感基调
2. **角色演绎** — 各角色动作/表情/情绪演变
3. **场景呈现** — 场景变化与镜头分布
4. **镜头设计** — 景别、角度、运镜方式
5. **视觉风格** — 配色、光影、材质
6. **节奏与时长** — 分镜时长、情绪节奏

**产出**：衍生预列表（Stage 2 必须严格遵循）+ 分镜表

### 2.2 Stage 2 — 创建衍生资产

deriveAssetsAgent 读取 flowData，调用 `add_deriveAsset` 工具为每个衍生项创建 `o_assets` 记录。

**衍生资产定义**：视觉状态变体（Visual State Variant），每个衍生资产通过 `assetsId` 指向其父资产。

| 类型 | 典型衍生项 |
|------|-----------|
| 角色（character） | 不同角度（正面/侧面/背面）、不同表情（开心/愤怒/悲伤）、不同动作（站立/奔跑/跳跃）、不同服装 |
| 场景（scene） | 不同角度（远景/中景/特写）、不同时间（白天/黄昏/夜晚）、不同天气（晴天/雨天/雪天） |
| 道具（prop） | 不同使用状态（打开/关闭/激活） |

**数据模型**：`o_assets` 表中 `assetsId` 指向父资产 ID，`type` 表示资产类型，`imageUrl` 为生成的图片地址。

### 2.3 Stage 3 — 生成衍生图片

generateAssetsAgent 调用 `generate_deriveAsset` 工具（socket emit，fire-and-forget，无结果轮询）。

后端路由 `batchGenerateAssetsImage.ts`：

1. 根据 `assetsId` 查找父资产图片
2. 将父图片加载为 base64
3. 构造单元素 `referenceList: [base64Image]`
4. 根据衍生类型选择 prompt 模板：
   - `art_character_derivative` — 不含场景/他人
   - `art_scene_derivative` — 不含人物
   - `art_prop_derivative` — 单个道具
5. 调用 AI 图像接口生成

> **注意**：此阶段为 fire-and-forget，不等待生成结果即进入下一阶段。

### 2.4 Stage 4 — 分镜面板

storyboardPanelAgent 构建分镜面板，生成包含 `associateAssetsIds`（资产 ID 数组）的 XML 标记。

**写入途径**（非 Agent 直接写入）：

```
Agent 生成 XML → 前端解析 → POST /production/storyboard/batchAddStoryboardInfo
  → 插入 o_storyboard 行
  → 遍历 associateAssetsIds 插入 o_assets2Storyboard 关联行
```

**关联模型**：`o_assets2Storyboard` 是多对多关联表，每条记录包含 `storyboardId` 和 `assetId`，按 `rowid` 排序。该表由前端 REST 端点 `batchAddStoryboardInfo.ts` 填充，Agent 工具仅生成数据不直接写入。

### 2.5 Stage 5 — 生成分镜图片

storyboardGenAgent 调用 `generate_storyboard` 工具（socket emit，fire-and-forget）。

后端路由 `batchGenerateImage.ts`：

1. 读取 `o_assets2Storyboard` 关联表，按 `rowid` 排序
2. 收集所有关联资产图片
3. 将所有图片加载为 base64 数组
4. 构造多元素 `referenceList: [base64Image1, base64Image2, ...]`
5. 使用分镜 prompt 模板调用 AI 图像接口

> **关键区别**：分镜图片生成使用多参考图（衍生图片生成使用单参考图）。

### 2.6 Stage 6 — 视频生成

基于分镜图片序列生成最终视频（当前阶段暂不展开）。

---

## 3. 三种衍生场景分析

### 场景 A：角色衍生（一对多）

```
父角色资产（角色 A 基础形象）
  ├── 角色 A 正面（添加 assetsId=角色 A）
  ├── 角色 A 侧面（添加 assetsId=角色 A）
  ├── 角色 A 奔跑（添加 assetsId=角色 A）
  └── 角色 A 愤怒（添加 assetsId=角色 A）
```

- 每个衍生资产引用同一张父参考图
- 分镜中需要角色 A 出现时，关联对应衍生资产的 `assetsId`

### 场景 B：场景衍生（一对多）

```
父场景资产（场景基础形象）
  ├── 场景远景（添加 assetsId=父场景）
  ├── 场景中景（添加 assetsId=父场景）
  └── 场景特写（添加 assetsId=父场景）
```

- 场景角度衍生会增加预热成本（多角度场景）
- prompt 模板不含人物，保证场景干净

### 场景 C：组合分镜（多参考图）

```
分镜画面 = 场景远景参考 + 角色 A 奔跑参考 + 道具 B 打开参考
                  ↓
    通过 o_assets2Storyboard 关联三个 assetsId
                  ↓
    batchGenerateImage.ts 加载三个参考图 → 多元素 referenceList
```

- 当父资产与其衍生资产同时关联到同一分镜时，会引入冲突参考（当前无去重逻辑）

---

## 4. 当前架构注意事项

### P1 — Fire-and-forget 无结果轮询

Stage 3（衍生图片生成）和 Stage 5（分镜图片生成）均为 socket emit 后立即返回，不等待 AI 生成完成。生成结果由前端通过 socket 事件接收并更新数据库。

**影响**：后续阶段无法依赖此阶段的生成结果来调整参数。

### P2 — 参考图冲突

当父资产和其衍生资产同时被关联到同一分镜时，`o_assets2Storyboard` 中会包含多个指向同一角色的不同 `assetsId`，但参考图可能是同一张或相似图片，导致风格/构图冲突。

**建议**：在加入 `o_assets2Storyboard` 时按 `type` 去重，或优先使用衍生资产而非父资产作为参考。

### P3 — 场景角度预热成本

场景角度衍生（远景/中景/特写）需要在 Stage 3 逐一生成，增加整体管线耗时。

### P4 — 通信依赖

所有 Agent 工具依赖前端 socket 连接（emit + callback 模式），不提供直接 HTTP 接口。前端断开时管线无法继续。

具体通信模式：
- `get_flowData` / `add_deriveAsset` / `del_deriveAsset`：socket emit，等待前端响应回调
- `generate_deriveAsset` / `generate_storyboard`：socket emit 后立即返回（fire-and-forget），实际图片生成由前端触发后端路由

---

## 5. 数据模型关系

```
o_assets (资产表)
  ├── id: 唯一标识
  ├── projectId: 项目 ID
  ├── type: 'character' | 'scene' | 'prop'
  ├── assetsId: 父资产 ID（衍生资产指向父资产）
  ├── imageUrl: 生成图片地址
  └── ...

o_assets2Storyboard (资产-分镜关联表)
  ├── id: 唯一标识
  ├── storyboardId: 分镜 ID
  ├── assetsId: 资产 ID
  ├── rowid: 排序字段
  └── ...

o_storyboard (分镜表)
  ├── id: 唯一标识
  ├── projectId: 项目 ID
  ├── prompt: 分镜 prompt
  ├── imageUrl: 生成图片地址
  └── ...
```

---

## 6. 关键代码入口

| 目的 | 路径 |
|------|------|
| 管线主编排 | `src/agents/productionAgent/index.ts` |
| Agent 工具定义 | `src/agents/productionAgent/tools.ts` |
| 衍生图片生成路由 | `src/routes/production/assets/batchGenerateAssetsImage.ts` |
| 分镜图片生成路由 | `src/routes/production/storyboard/batchGenerateImage.ts` |
| 决策 Agent Skill | `data/skills/production_agent_decision.md` |
| 衍生资产 Skill | `data/skills/production_execution_derive_assets.md` |
| 生成资产 Skill | `data/skills/production_execution_generate_assets.md` |
| 分镜生成 Skill | `data/skills/production_execution_storyboard_gen.md` |
| Socket 生命周期 | `src/socket/routes/productionAgent.ts` |
