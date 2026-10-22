# multitrack

多轨编辑器扩展：编辑 `plan/story.mtrack`（JSON 内容，扩展名 `mtrack`），按 `docs/multitrackProductionPlan.md` §3
实现横向轨道与片段编辑，并把 `planOperator` 的校验报告（`plan/assetReport.json`、
`plan/assetIndex.json`）只读展示在右侧状态面板。

- 读写全部经宿主 `context.files`（`readJson` / `writeJson` / `acquireUrl`），不直接触碰磁盘。
- 保存前比对 `updatedAt`，不一致时提示「文件已被其他操作修改，请重新加载」，不静默覆盖。
- 不直接读改写布节点数据，也不在本扩展内直连供应商：选段后由编辑器经画布 `nodeTools` 完成生成（缺节点时 `addNode` 建视频生成节点，
  再 `node:setConfig` / `node:setPrompt` / `node:generateVideo` / `node:getGenerationStatus` / `node:cancelGeneration`）
  逐镜生成，不经对话模型；状态与产物直接回写多轨工程（`node:dispatchGenerate` 的对话等价能力同样走这条链路）。
- 画布上下文按优先级取宿主 provide：`agentCanvas`（专为文档面板内的派工准备，只判画布实例就绪，不判面板 active）
  → `canvas`（对话输入框用的工厂，画布面板 active 时才返回值）。两者都由宿主注入工厂函数，`inject` 实测可达；
  都取不到时只提示「先打开画布并等待加载完成」，不另起绕过画布的生成路径。
- 面板只预览 `assetPath` 视频，不提供节流与算力控制。
- 保存固定提示：「生成任务按提交时的快照运行，此处修改只影响下次生成。」

从仓库根目录执行：

```sh
bun install
bun run --cwd packages/ext/multitrack typecheck
bun run --cwd packages/ext/multitrack build
```

构建产物：`build/ext/ext-multitrack.umd.js`。文件内包含元数据与组件样式。开发构建同步到 `data/ext/`。接口和宿主接入说明见 `packages/extScaffold/readme.md`。
