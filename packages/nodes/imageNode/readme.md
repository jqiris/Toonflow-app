# 图片节点

在画布中展示图片，可作为角色、场景、道具或分镜参考。

## 输入与输出

- 导入本地图片文件，单个文件不能为空且不超过 100 MB。
- 输出当前图片素材，可连接图片生成、视频生成等支持图片输入的节点。

## 使用方法

1. 点击上传按钮，选择图片文件。
2. 上传完成后，节点按图片比例显示预览。
3. 将图片输出连接到需要参考图的节点。
4. 选中节点后，使用顶部工具栏下载、预览或替换图片。

## 全局 Agent（nodeTools）

节点注册三个全局 Agent 工具，供上层 Agent 编排画布工作流时调用；工具复用本节点的图片全景组件，agent 截图走离屏舞台，不会弹出手动弹窗。

- `createPanorama`：参数 `mode`（`sphere`/`cylinder`，默认 `sphere`）。基于当前节点图片创建 720° 全景图或 360° 环绕图子节点（对应 2:1 或 4:1 比例的 generateImage 任务）。返回 `{ nodeId, label, mode, hint }`；需要配合 `node:generateImage` 启动生成。
- `capturePanorama`：参数 `mode`、`yaw`、`pitch`、`fov`、`count`（1/4/12）、`layout`（`combined`/`separate`）。自动启用图片节点插件，在离屏舞台打开全景预览，按指定角度截图并成组连线。返回 `{ nodeIds, groupId, mode, hint }`。
- `generateMultiAngle`：参数 `preset`（front/back/leftFront/rightFront/left/right/leftBack/rightBack/high/low）、`azimuth`、`elevation`、`distance`、`lens`（`standard`/`wide`），可选 `providerId` 与 `modelId`（须同时提供）。自动启用图片生成节点插件并创建多角度子节点、预热配置后启动生成；图片节点调用时未提供 `ai` 上下文则沿用节点当前 multiAngle 模型设置。返回 `{ nodeId, status, hint }`，通过 `node:getGenerationStatus` 查询进度。
