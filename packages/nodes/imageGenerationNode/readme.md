# 图片生成节点

根据提示词生成图片，也可使用已有图片和文本作为参考，制作角色、场景或分镜图。

## 输入与输出

- 输入支持图片和文本；连接的文本会作为生成要求的一部分。
- 输出一张生成图片，可继续用作图片或视频生成的参考。

## 使用方法

1. 选中节点，在下方选择图片模型；没有模型时先在设置中添加图片模型。
2. 输入画面要求，按需连接图片或文本参考，并在提示词中引用它们。
3. 点击比例与分辨率区域，选择当前模型提供的选项。
4. 点击“生成图片”；生成过程中可点击“停止生成”。
5. 完成后在节点内查看结果，选中节点可从上方下载或放大预览。

参考素材可在输入区调整顺序或移除。连接的节点需要已有内容，修改提示词或设置后需再次点击生成才会产生新图片。

## 全局 Agent（nodeTools）

节点注册三个全局 Agent 工具，供上层 Agent 编排画布工作流时调用；工具复用本节点的图片全景组件，agent 截图走离屏舞台，不会弹出手动弹窗。

- `createPanorama`：参数 `mode`（`sphere`/`cylinder`，默认 `sphere`）。基于当前节点图片创建 720° 全景图或 360° 环绕图子节点（对应 2:1 或 4:1 比例的 generateImage 任务）。返回 `{ nodeId, label, mode, hint }`；需要配合 `node:generateImage` 启动生成。
- `capturePanorama`：参数 `mode`、`yaw`、`pitch`、`fov`、`count`（1/4/12）、`layout`（`combined`/`separate`）。自动启用图片节点插件，在离屏舞台打开全景预览，按指定角度截图并成组连线。返回 `{ nodeIds, groupId, mode, hint }`。
- `generateMultiAngle`：参数 `preset`（front/back/leftFront/rightFront/left/right/leftBack/rightBack/high/low）、`azimuth`、`elevation`、`distance`、`lens`（`standard`/`wide`），可选 `providerId` 与 `modelId`（须同时提供）。自动启用图片生成节点插件并创建多角度子节点、预热配置后启动生成；图片生成节点提供了 `ai` 上下文，可查询模型列表校验 providerId/modelId。返回 `{ nodeId, status, hint }`，通过 `node:getGenerationStatus` 查询进度。
