# 镜头创作工作台：字段映射与浮窗几何持久化契约

> 本文是「LSC native-h3-scene 镜头创作工作台 + 独立项目与成片浮窗」改版的数据层唯一真源。
> 界面参照：`docs/lscMultitrackUiSpec.md`（Easy-Media 骨架，已废弃为参照）、`docs/multitrackGapAudit.md` / `docs/mtrackLscAlignment.md`（native-h3-scene 流程缺口与对齐口径）。
> **数据层协议**：`.mtrack` 工程 schema（`packages/nodeShared/src/mtrack/mtrackProject.ts`）、派工（`directDispatch.ts` / `mediaDispatch.ts`）、续接（`continuity` / `continueFrom`）、版本（`attempts` / `clipVersions` / `clipStates` / `deleteClipVersion` / `deleteAllClipVersions`）、合成（`planOperator/composite.ts`）沿用现状；工作台只是把这些既有字段换一种排布呈现。
> **t6 修订（纯 additive）**：协议新增两个可选字段——顶层 `project.name?: string`（项目显示名，`normalizeProject` 白名单透传，缺失不猜、不从 `projectId` 迁移）与 `clips[].systemPromptOverride?: string`（本镜系统提示词覆盖位，派工经 `effectiveGlobal` 替换 `global.systemPrompt` 下发；`clip.notes` 回归纯备注、一律不再当提示词读，消除 agent 写入口带来的提示词注入隐患）。`projectId` 语义纠偏为跨文件对账标识（`mtrack-<时间戳>`，见 `multitrackTemplate.md:68`），界面不再借用它显示项目名。老工程照常加载，已有字段语义不变。
> 每条约定都给出「现有代码在哪」的引用（path:line），实现组件时**不得新增第二套字段、状态或校验**。

---

## 1. 镜头页签条（clip tabs）

工作台顶部的镜头页签，每个页签对应工程 `clips[]` 里的一条 `MtrackClip`，**一一对应、不建独立页签模型**。

| 页签元素 | 数据来源 | 现有代码 |
| --- | --- | --- |
| 编号 | `clip.clipId`（`^S\d{3}$`，新建走 `nextClipId`） | `mtrackProject.ts:67`（字段）、`mtrackEdit.ts:23`（模式校验）、`mtrackProject.ts:247-254`（编号分配） |
| 标题 | `clip.title`（空串时前端显示占位「未命名」，不回写） | `mtrackProject.ts:68`；占位文案先例 `batchPanel.vue:177` |
| 时长 | `clip.seconds`（2–60 整数，续接 ≥10） | `mtrackProject.ts:70`；区间校验 `mtrackEdit.ts:45-47`、续接下限 `mtrackEdit.ts:68-72` |
| 状态徽标 | `clip.status` 五态 + `clipStatusLabels` 文案 | `mtrackProject.ts:3`（枚举）、`mtrackProject.ts:139-145`（文案：待生成/生成中/已生成/已验收/失败） |
| 起止累计秒 | **前端推导，不落字段**：`start = Σ seconds[0..i-1]`、`end = start + seconds[i]` | 现实现 `components/shotTabs.vue:39-45`（页签条 start/end 推导），**不新增工程字段** |
| 页签顺序 | 即 `project.clips` 数组顺序（改序走既有 `move` op） | `mtrackEdit.ts:14`（move 操作）、`mtrackProject.ts:276-278`（`totalSeconds`） |

约定：页签条只读展示 + 点选切换「当前镜」；不复制 clip、不派生新对象，编辑仍走 `onPatch → EditOp` 一条链（`mtrackEdit.ts:10-16`），避免双真源。

## 2. 参考素材勾选网格（reference grid）

工作台「参考素材」区块是资产卡勾选网格，勾选结果**直接读写 `clip.referenceIds`（cardId 字符串数组）**，不引入第二套选区状态。

[HISTORICAL] - **顺序即图N 编号**：`referenceIds` 数组位次就是提示词里 `{{ref N}}` 的 N；下发时按 dataType 换算成 `<Picture N>` / `<Video N>` / `<Audio N>`（各自独立编号、同源复用首个编号）。现有实现：网格序号 `components/referencePicker.vue:27`（`图${orderOf+1}` 角标）、`:59-61`（orderOf）、`:71-80`（toggle：点满 4 个不再加）；换算 `mediaDispatch.ts:55-81`（`referenceTags`）；下发顺序严格按 `referenceIds` `mediaDispatch.ts:124-129`；顺序一致性由校验器 V15 兜底 `planValidator.ts:273-285`。卡片上展示的「图N」= 下标 + 1。
- **mode 三档沿用现契约**：`ClipMode = "ref" | "image" | "text"`（`mtrackProject.ts:25-40`，含缺省推断 `resolveClipMode`），UI 呈现参考模式选择器现实现 `referencePicker.vue:4-9`（使用方式下拉）。这是 LSC `task_mode` 的开放子集，产品收敛理由见 `mtrackLscAlignment.md:21-30`，**不新增第四态**。
- **上限沿用 mtrackEdit.ts / planValidator 现有校验，不新增第二套**：
  - 独立镜头图片参考 ≤4：`mtrackEdit.ts:57-59`（编辑期拦截）、`planValidator.ts:80`/`:250-260`（V8，`MAX_IMAGE_REFERENCES = 4`）；网格端「点满 4 个不再加」的现实现 `referencePicker.vue:11`（计数 `N/4`）、`:78`（上限拦截）。
  - 续接（`continuity === "context"`）图片参考 ≤3：`mtrackEdit.ts:63-67`（编辑期）、`planValidator.ts:168-169`（V16）、`mediaDispatch.ts:157-171`（派工期最后防线，超 3 直接报错不静默降级）。
  - 视频 / 音频参考各 ≤1：`planValidator.ts:81-82`（`MAX_VIDEO_REFERENCES = 1` / `MAX_AUDIO_REFERENCES = 1`）、V8 计数按卡 kind 分流 `planValidator.ts:252-253` 与 `directDispatch.ts:219-225`（`kind === "sound"` 计音频，其余计图片）；下发模式声明 `imageReference:4 / videoReference:1 / audioReference:1` 见 `mediaDispatch.ts:196-200`。
  - 重复勾选拦截：`mtrackEdit.ts:54-56`（集合含重复项即报错）。
- 网格数据源仍是 `plan/assetIndex.json` 的 `cards[]`（`mtrackProject.ts:100-111`），缩略图经画布桥反查（`referencePicker.vue:45-46` 的 `thumbnails` prop 口径），只换排布，不换取数链。

## 3. 生成范围与合并语义

### 3.1 start / count（-1 = 到最后一镜）

工作台「生成范围」两个数字 = **1 基起始镜号 `start` + 生成镜数 `count`，`count = -1` 表示从起始镜一直生成到最后一镜**——与批量面板完全同一语义，复用同一换算，不新增第二套范围状态。

- 现有实现：真源数字对 `multitrackEditor.vue:568-569`（`rangeStart`/`rangeCount`），范围换算 `:583-591`（`rangeClips`：`count<0 → total-from+1`，再 `slice` 成 clipId 清单）与 `:593-601`（范围文案含缺提示词提示）；批量面板同语义输入 `batchPanel.vue:17`（`:min="1"`）、`:21`（`:min="-1"`）、`:121-126`（`clampRange`）、`:143-148`（`rangeClips`）。
- 发起路径唯一：范围换算出的 `clipId[]` 交给 `launchDispatch(clipIds, { includeFinished })`（`multitrackEditor.vue:1324`；「生成视频」按钮共用同一换算 `:1489-1507`），与逐镜面板同一条直连链路（选段校验 `pickDispatchTargets` `:1263-1273`）。
- 「包含已生成」复选框语义不变：勾上才把 `generated`/`accepted` 纳入范围（`multitrackEditor.vue:1268-1269`）。
- LSC 对照：`native-h3-scene.js` 的 `v.start / v.count`（`multitrackGapAudit.md:29`、`multitrackBatchPanelDesign.md:76-78` 已核对三档 preset 同形）。

### 3.2 「完成后自动合并」「合并时带上前面已完成镜头」→ 现有合成成片

LSC 的两个合并开关**不引入新字段、新状态**。Toonflow 的合成清单是 `accepted` 镜按工程顺序拼接（`planComposite`：`packages/tools/planOperator/src/composite.ts:180-192` 过滤 `status === "accepted"`、V14 顺序连续复核 `:185-191`；服务端入口 `apps/server/src/routes/mtrack/composite.ts:46-88`；UI 入口：工作台高级设置「合成成片」按钮 `multitrackEditor.vue:182` + `handleComposite` `:938`）。映射约定：

| LSC 控件 | Toonflow 映射 | 依据 |
| --- | --- | --- |
| 「用于合并」逐镜勾选 | **= `clip.status` 在 `generated ⇄ accepted` 间切换**：工作台验收 `acceptClip`（`multitrackEditor.vue:1138-1144`，只允许 `generated→accepted` 和 `accepted→generated`，其他状态不可勾）；浮窗「用于合并」勾选走 `toggleClipAccept`（`:1146-1149`，同口径按 clipId 翻转）。勾上 = accepted，取消 = generated，不新增 `mergeIn` 之类布尔字段 | `mtrackProject.ts:3`（ClipStatus 五态不动）、`composite.ts:180`（accepted 即入清单） |
| 「合并时带上前面已完成镜头」 | 「已完成」= 已验收（accepted）。清单顺序即工程顺序，前面 accepted 的镜**天然被带上**——用户把想带的镜勾为 accepted 即可；断点（中间有未 accepted 的镜）由 V14 报错明示，与现行为一致 | `planValidator.ts:262-271`（V14 连续性）、`composite.ts:185-191`（复核文案） |
| 「完成后自动合并」 | footer 复选框，**纯 UI 会话态**（默认关，不持久化进工程）：批次以成功收尾且 `hasAccepted`（`multitrackEditor.vue:919`）时，自动按现有两步流程执行——先 `execute=false` 拿清单做确认信息，再 `execute=true` 真拼。失败/取消/暂停不触发；不做「自动验收」，验收永远人工 | `multitrackEditor.vue:922-960`（`postComposite`/`handleComposite` 原样复用） |

> ACT: 与 LSC 的差异如实声明——LSC 支持勾选任意段、任意顺序合并（`multitrackGapAudit.md:92`），Toonflow 合成清单只含 accepted 且必须按工程顺序连续（V14），这是数据层协议，本次改版不动它。footer 文案不得暗示能合并非连续/未验收镜。

## 4. 版本（历史视频）

- **版本身份 = 产物文件路径，不再依赖画布 nodeId**：现成函数 `clipVersions(clip)` 返回 `ClipVersion[]`（`mtrackProject.ts`，形状 `{ key, nodeId, assetPath }`）。遍历 `attempts` 里 `status === "succeeded"` 的条目，`key = attempt.assetPath || attempt.nodeId || ""`，按 `key` 去重、保持旧→新顺序（attempts 数组序天然旧→新，追加写入）；末尾若 `clip.assetPath` 不在列表里则补一条 `{ key: clip.assetPath, nodeId: clip.nodeId, assetPath: clip.assetPath }`。对齐 LSC 的 `resultVersions`（按 `file.url` 去重）：产物落盘名带随机后缀，路径天然唯一；旧工程的 attempt 只有 nodeId 时回退用它作键。
- **服务端媒体任务通道现在也产生版本**：该通道（`POST /api/ai/media/generate` + taskId 轮询）不建画布节点，attempts 的 `nodeId` 恒为 `null`；`writeClipRun` 在 `attempt.status === "succeeded"` 且本次 patch 带 `assetPath` 时把产物路径自动写进这条 attempt 的 `assetPath`（调用点无需再传字段），所以它生成的成片**同样出现在历史版本里**。`ClipAttempt` 因此新增可选字段 `assetPath?: string`，`readAttempts` 白名单已加透传。
- **追加版本 = 每次成功生成产出新文件**：产物按 `assets/<clipId>/` 落盘、文件名带随机后缀，不覆盖旧文件；成功后 `attempts` 追加一条 `succeeded`（含 `jobId` 供续接、`assetPath` 作版本身份）。旧工程里画布节点版次仍留在历史 attempts 中，按 nodeId 回退作键。
- **「预览版本 / 选择视频版本」下拉 = 现有 statusPanel 版本行**：选项键与「默认」标记取 `entry.key`，label = `版本 N · <文件 basename>`，`key === clip.assetPath` 那条打「· 默认」（`statusPanel.vue` 的 `versionOptions`）；浮窗的逐镜版本菜单 `versionMenu.vue`（`VersionMenuItem.key`，「用于合并」= `generated⇄accepted` 切换、「设为默认」、「删除」，另在折叠头提供「全部删除」）。预览切换：条目自带 `assetPath` 时直接 `acquireUrl` 取文件，旧工程只有 nodeId 的条目才经画布桥 `acquireNodeVideo` 反查节点产物（`statusPanel.vue` 的 `activeVersion` watch、`resultsOverlay.vue` 的 `previewVersion` watch，均以 `previewJob` 丢弃过期结果）。工作台与浮窗共用同一数据源（`clipVersions`），**不换来源**。
- **「设为默认 / 切版本」= `setDefaultVersion(version)`**：版本键即产物路径，从 `clipVersions` 找到条目后直接 `onPatch({ nodeId, assetPath: path })`；只有旧工程的 nodeId 条目（无 `assetPath`）才经 `acquireNodeVideo` 反查画布节点产物，反查不到就报错不写，`await` 期间用户换了选中镜也放弃写入；成功提示显示文件名。**不改 status、不追加 attempts**（切换不是一次生成尝试）；生成中禁用（`statusPanel.vue` 的 `defaultLocked`）。浮窗入口 `setClipDefaultVersion(clipId, version)` 先把选中镜切到目标镜再走同一实现。合成链路自动生效：合成取 accepted 镜的 `assetPath`（`composite.ts` 的 `planComposite`），即该镜当前默认版本，写回即生效。

### 4.1 待更新（stale）派生：`clipStates`

工作台与「项目与成片」浮窗共用一份 `clipStates(project)`（`mtrackProject.ts`），返回 `Record<clipId, ClipState>`——**不各自遍历**，一次算完供 `:stale`（工作台 `statusPanel` 的 `selectedStale` 徽标）与 `:states`（浮窗逐镜 `versionMenu` 的 `stale` 徽标「待更新」）两处消费。

`ClipState` 形状：`{ signature, recordSignature, recordIndex: number | null, recordParentJobId, stale }`。

- **`signature`** = 键排序 JSON 规范化串（`stableJson`：`JSON.stringify` 前递归排键，**不用哈希、零依赖**）。内容 = 项目级 `global{ratio,style,systemPrompt,model}` + 本镜 `{clipId,title,seconds,ratio,resolution,generateAudio,prompt,continuity,mode,systemPromptOverride}` + `referenceIds` +（`continuity === "context"` 时把**上一镜的 signature** 作为续接链带进来）。
- **`recordSignature` / `recordIndex`** = 该镜 attempts 里**最后一条 `status === "succeeded"`** 记录落盘时的签名与时间线位置——新字段 `ClipAttempt.signature` / `ClipAttempt.index`，由 `multitrackEditor.vue` 的 `writeClipRun` 在成功时写入（同时写 `parentJobId = continuationJobId(上一镜)`）。
- **`stale`** = 记录存在（`clip.assetPath && attempt?.signature`）且以下任一成立：`recordSignature !== 当前 signature`；`recordIndex !== 当前时间线位置`（夹位即改序，也算过）；`continuity === "context"` 且续接来源 `parentJobId` 与上一镜当前 `continuationJobId` 不一致。

对齐 LSC `signatures()` / `public()` 里的 `record['signature'] != current[s['id']] or record['index'] != index or not context_ok(...)`，三条件逐条对应。

**已知限制（必须写明）**：`referenceIds` 只带卡片编号，**参考素材内容变更（同一个 id 重画、换图）检测不到**——签名只覆盖参考集合的增删改序，卡片换内容不算 stale。另外旧工程的 succeeded 记录没有 `signature` 字段（`attempt?.signature` 为空），一律视为不 stale，直到重新生成一次把签名落盘；没有成片时 `stale` 恒 `false`。

### 4.2 `ClipAttempt` 字段（9 字段）

`ClipAttempt` 现为 9 个键，旧工程只有前 6 个，新增三个全可选：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `at` | string | 尝试时间戳（ISO） |
| `nodeId` | string \| null | 画布节点 id；媒体任务通道恒 `null` |
| `status` | string | `succeeded` / `failed` / `cancelled` / `generating` |
| `error?` | string | 报错原文，或批次标记 `batch:<uuid> task:<taskId>` |
| `jobId?` | string | 供应商任务号，续接（`continue_from.from_job`）与 `continuationJobId` 靠它 |
| `assetPath?` | string | 本次尝试的产物路径，历史版本的**身份** |
| `signature?` | string | 落盘时的设置签名，`clipStates` 据此判待更新 |
| `index?` | number | 落盘时的时间线位置，改序即判 stale |
| `parentJobId?` | string | 续接来源：生成时上一镜的 `continuationJobId`；独立镜为空串 |

`readAttempts` 白名单已加透传 `signature` / `index` / `parentJobId`，旧工程不带这三个键照常加载。

### 4.3 删除版本

编辑器提供单版本删除与整镜全部删除两个动作，`mtrackProject.ts` 各有一个纯函数落点：`deleteClipVersion(clip, key)` 返回 `{ clip, paths }`，`deleteAllClipVersions(clip)` 返回同形（`paths` 为待删产物路径清单，供宿主删物理文件用）。

- **单版本删除不弹确认**（对齐 LSC：`scope === 'version'` 直接 delete，无 `scope === 'all'` 才 `window.confirm` 的分流）。
- **整镜全部删除走 `ElMessageBox.confirm`**：danger 按钮，标题 `永久删除「镜头标题」的全部版本？`，正文 `将永久删除 N 个视频版本，不可撤销。镜头脚本与其他镜头保留；依赖被删版本的续接镜头需要重新生成。`（`clip.title` 空时回落 `clip.clipId`；`N` 取 `clipVersions(clip).length`，为 0 直接 return 不弹窗）。
- **删除会同时删物理文件**：`EditorFiles` 新增可选能力 `remove?(path: string): Promise<void>`（`mtrackProject.ts`），两个宿主都已实现——画布宿主 `packages/nodes/multitrackNode/src/index.vue` 接 `workspaceFiles.remove`，扩展宿主 `packages/ext/multitrack/src/index.vue` 接 `extFiles.remove`。宿主不提供删除能力时**只清记录、不报文件失败**；文件本身已不存在也不算失败（`deleteVersionFiles` 按 `/404|not found|ENOENT|不存在/i` 判定为不存在），其余异常计入失败并在成功文案里报「有 N 个文件删除失败」。
- **删除后当前默认版本回落到剩余版本里最新的一条**：`deleteClipVersion` 删掉的恰是当前默认（`key === clip.assetPath || clip.nodeId`）时，取剩余 `succeeded` 的最后一条作新的 `assetPath`/`nodeId`，否则两者不动。`deleteAllClipVersions` 把 `assetPath` 与 `nodeId` 置 `null`、attempts 只留非 `succeeded` 的记录。
- **删除不改 `clip.status`**：生成状态与版本簿记是两回事，对齐 LSC 的 `mergeDeletedResultDraft`（只更新结果簿记，不覆盖用户未保存的编辑字段）。删完成片仍在合成清单里的镜保持 `accepted`，只是取不到默认版本文件。
- **生成中的镜头禁止删除**：`clip.status === "generating"` 时直接 `ElMessage.warning("该镜头正在生成，请等生成结束再删除版本")` 并 return（对齐 LSC 的 `locked()` 检查）。

**UI 入口**（两处入口，两套组件，同一个数据落点）：

- **浮窗「项目与成片」**：`resultsOverlay.vue` 内嵌两处 `versionMenu.vue`（大预览版本组 + 逐镜版本组）——每行一个「删除」按钮（`emit('deleteVersion', item.key)`，`title="永久删除这个版本"`）+ 折叠头一个「全部删除」按钮（`emit('deleteAllVersions')`，`title="永久删除本镜全部版本"`），组头在 `stale` 为真时显示「待更新」徽标。两个事件由 `resultsOverlay.vue` 带上 `clipId` 转发给编辑器。
- **工作台「生成结果 · 校验」**：`statusPanel.vue` 用自己的版本下拉（`versionOptions`），「删除当前版本」（`emit('deleteVersion', activeVersion)`）与「删除全部版本」（`emit('deleteAllVersions')`）两个按钮直接发给编辑器；`stale && clip?.assetPath` 时另显示黄条「当前成片已落后于最新设置，建议重新生成」。

两条路都在 `multitrackEditor.vue` 统一落到 `deleteVersionInClip` / `deleteAllVersionsInClip`（先 `deleteClipVersion`/`deleteAllClipVersions` 算出 `paths`，再 `deleteVersionFiles` 删文件，最后 `dirtyVersion += 1` 触发防抖写盘）。两个入口的按钮在该镜 `generating` 或无成片时禁用。删除后的成功文案：`已删除版本 <basename>，默认已回落到剩余版本` / `已删除版本 <basename>，该镜头已无成片` / `已删除 N 个视频版本`。

### 4.4 与 LSC 差异（写明，本轮不做）

以下几项**不跟进**，理由如下：

- **`result_mode` append/replace**：LSC 里它只影响「把结果挂到画布节点」这个动作（append 新建画布节点、replace 复用旧节点）；Toonflow 的服务端媒体任务通道**不建画布结果节点**（`nodeId` 恒为 `null`），没有对应动作，做它等于假开关。
- **`save_policy` keep/overwrite + 回收站**：属于 LSC 的 local-media 项目归档子系统（`/api/local-media/projects`），与多轨编辑器正交。
- **context latent 上下文缓存文件校验**：Toonflow 用 jobId 续接（`continuationJobId` → `continue_from.from_job`），不用 latent 文件，没有可校验的产物。
- **`result_clips`（删镜头后视频仍可见）**：Toonflow 的 `remove` op 只删 clip 记录不删文件，视频已留在磁盘但当前没有入口可见；这需要 project schema 变更，本轮不做。
- **删除版本入口不放在画布节点工具栏**：本轮只在多轨编辑器 UI 里加（`versionMenu` / `statusPanel` / `resultsOverlay`），画布侧不加。

### 4.5 顺序连播

浮窗大预览支持「顺序连播已完成片段」：当前片段播完后自动跳到 `completedClips` 里的下一段并继续播放，直到最后一段播完停止（对齐 LSC 的 `data-result-autoplay` checkbox，默认勾选）。

- **开关默认勾选**（`resultsOverlay.vue` 的 `continuousPlay` ref）：只门控 `@ended` 后的自动推进——用户手动换片段（上一段 / 下一段 / 选择预览片段下拉 / 点版本菜单行）不受开关控制，仍然自动播放（同 LSC：`previewResult(v, id, true)` 恒带 play，checkbox 只门控播完推进）。
- **手动暂停即中断连播**：暂停不触发 `ended`，连播自然停（等价 LSC 的 `pause` 事件停 timeline）。
- **播放意图票号**：`requestPreview(clip, version)` 在用户主动换片段与连播推进时各 `playTicket += 1`，`previewUrl` 落地后只有最新一票真正调 `video.play()`（与 `previewJob` 丢过期同口径）；工作台→浮窗同步（`selectedClipId` prop）与初始修位（`completedClips` watch）走 `setPreview` 本体不加票——那两处是被动跟随，此时自动播放会被浏览器拦。
- **自动播放被拦时如实提示**：`video.play()` 抛出非 `AbortError` 时，位置指示栏显示「浏览器暂停了自动播放，点击视频播放键继续。」（同 LSC :567 文案）；`AbortError` 是换源/卸载打断的正常结果，不提示；用户手动点播放（`@play`）时清提示。
- **位置指示**：`N / M · 标题`（`previewIndex + 1 / completedClips.length / clip.title`，`clip.title` 空时回落「未命名」），对齐 LSC `data-result-position` 文案口径。
- **末段播完就停**：`nextClip` 为 `undefined` 时不再推进。

**不在本轮做**：LSC 的双缓冲预载（`.nh-result-preview` + `.nh-result-buffer` 两个 video 元素，切换时预加载下一段）——Toonflow 用单个 `<video v-if="previewUrl">`，每次换 URL 元素销毁重建，天然无换源卡顿，不需要双缓冲。LSC 的 RAF 轮询（`startResultTimeline` 轮询 `currentTime >= duration - 0.0005`）也不跟进——Toonflow 用原生 `controls`、无自定义播放条/时间轴/音频队列，`@ended` 事件足够且更简单。

## 5. 项目与成片浮窗几何（resultsUi）

浮窗是画布**世界层**浮窗：teleport 到 `.vue-flow__transformationpane`，容器带 `nopan nozoom`（先例：节点内浮层类名用法 `packages/nodes/multitrackNode/src/index.vue:15`、`:29`），随画布平移/缩放一起变换。几何持久化**进多轨节点 `node.data.resultsUi`**，与 cardWidth/cardHeight 同一套「写节点 data、随画布自动保存」的落盘方式（`packages/nodes/multitrackNode/src/index.vue:113-120` 读卡片尺寸先例、`:185-192` resultsUi 读写、`:155-157` 写 cardWidth 先例）；**不进 `.mtrack` 工程文件**（normalizeProject 不感知它）。浮窗头部的项目名显示走正式字段 `project.name`（缺失显示「未命名项目」，`components/resultsOverlay.vue:23`）。

类型与默认值已导出在 `packages/nodeShared/src/mtrack/mtrackProject.ts`：

| 导出 | 内容 | 位置 |
| --- | --- | --- |
| `ResultsUiGeometry` | `{ x, y, width, height, collapsed }`；x/y 为**画布世界坐标**（flow 坐标），浮窗左上角 | `mtrackProject.ts:349-360` |
| `ResultsUiAnchor` | 节点锚点 `{ x, y, width }`（宿主取 `node.computedPosition` + 卡片宽，先例 `multitrackNode/src/index.vue:185-188`） | `mtrackProject.ts:363-367` |
| 常量 | `resultsUiDefaultOffsetX = 64`、`resultsUiDefaultWidth = 1360`、`resultsUiDefaultHeight = 1480`；夹取区间宽 `[540, 2400]`、高 `[540, 2200]`；收起高 `resultsUiCollapsedHeight = 70` | `mtrackProject.ts:370-378` |
| `defaultResultsUi(anchor)` | 缺省几何：`x = 节点右缘 + 64`、`y = 节点 y`、`w×h = 1360×1480`、展开 | `mtrackProject.ts:385-396` |
| `normalizeResultsUi(value, anchor)` | 读 `data.resultsUi` 容错归一：非法/缺失回落缺省；`width`、`height` 一律夹取到上下限；`collapsed` 缺省 false。与 `normalizeProject` 同口径——只做兜底不做语义 | `mtrackProject.ts:402-412` |
| `resultsUiShownHeight(ui)` | 渲染高度：`collapsed ? 70 : height`。**折叠不改持久化 height**，height 永远保留展开尺寸，还原时用 | `mtrackProject.ts:415-417` |

宿主接线约定（t3/t4 实现时遵守）：

1. 读取：`(node.data as { resultsUi?: unknown }).resultsUi` 经 `normalizeResultsUi(raw, anchor)` 得到初始几何；anchor 用当时的节点位置与卡宽（缺 cardWidth 时按卡片实际宽，同 `:142` 的取法）。
2. 写回：拖动结束、缩放结束、收起/展开切换时把几何整值写回 `node.data.resultsUi`（写时即经 `normalizeResultsUi` 夹取后再落，避免脏值出画布）。x/y 不夹取（世界坐标没有越界语义），只夹 width/height。
3. 拖动/缩放的指针换算一律 `flow.screenToFlowCoordinate` 先转世界坐标再改 x/y/width/height，与既有 resize 实现同法（`multitrackNode/src/index.vue:141`、`:150-154`）。
4. 浮窗本体 teleport 目标 `.vue-flow__transformationpane`、根元素 `nopan nozoom`；宿主画布未打开（无文档面板/画布扩展形态，即 `multitrackEditor` 的 `nodeId` prop 为空的独立编辑器场景，`multitrackEditor.vue:288-290`）时浮窗整块不渲染（`multitrackEditor.vue:231-232` `v-if="nodeId"`），仅内存态。

## 6. 项目显示名与本镜系统提示词（t6 新增 additive 字段）

| 字段 | 语义 | 协议与归一 | 界面绑定 | 下发/消费链 |
| --- | --- | --- | --- | --- |
| `project.name?: string` | 项目显示名（工作台「项目名称」+ 浮窗头部副标题） | `mtrackProject.ts:93-94`（类型）、`:213-214`（normalizeProject 白名单透传，非字符串不带键） | `multitrackEditor.vue:137-141`（编辑位）、`onProjectNameInput` 写 `project.name`（`:609-613`）；浮窗 `resultsOverlay.vue:23`（缺失显示「未命名项目」） | 仅展示，不参与提示词拼装与合成 |
| `clips[].systemPromptOverride?: string` | 本镜系统提示词：非空时替换 `global.systemPrompt` 下发，留空沿用全片 | `mtrackProject.ts:85-86`（类型）、`:241`（normalizeProject 白名单透传） | `multitrackEditor.vue:154-159`（textarea 绑定 + `onPatch({ systemPromptOverride })`） | `effectiveGlobal`（`multitrackEditor.vue:1310-1315`）换算有效 global → `composeClipRequest` 前拼 |

迁移兜底（定稿口径）：

- **不从 `projectId` 猜名字**：旧工程里被借用作项目名的 `projectId` 值原样保留（该字段仍参与跨文件对账），`name` 缺失时界面显示空、浮窗显示「未命名项目」；不做一次性改写，避免把对账标识改掉或把时间戳当名字。
- **`clip.notes` 一律不再当提示词读**：notes 恢复「自由备注」本义（`multitrackTemplate.md` 字段表已纠偏）。旧工程 notes 里的覆盖文本不迁移——notes 有 agent 写入口（`planOperator/src/index.ts:52` 的 clipSchema、`multitrackNode/src/index.vue:368` 的 clipPatchSchema），把备注当系统提示词下发是提示词注入隐患；用户需要的覆盖在新字段里重填一次即可。
- agent 写入路径不收这两个新字段：`mtrackUpdate` 的 strict `clipUpdateSchema`（`planOperator/src/index.ts:105-114`）与 `node:editProject` 的 strict `clipPatchSchema`（`multitrackNode/src/index.vue:346-369`）都不含 `systemPromptOverride`——本镜覆盖只由用户在界面写，agent 不能注入；`name` 同理不在 agent 补丁面内。读取路径（validate 的 loose `clipSchema:53`/`mtrackSchema:59`）已补 optional，老文件与新文件都能过校验。
- 纯 additive：两字段全可选，老工程照常加载（normalize 不带键 ≠ 报错），已有字段语义不变；`imageGridSplit.vue:165` 建工程处继续写 `projectId: mtrack-<时间戳>`，不新增。

---

## 验收自查

- 五条约定逐条给出 path:line，且每条都指向**现存实现**（无「计划中」引用）；改版组件按本文接字段，不新增第二套状态/校验/合并标记。
- `mtrackProject.ts` 新增：`ResultsUiGeometry`、`ResultsUiAnchor`、7 个常量、`defaultResultsUi`、`normalizeResultsUi`、`resultsUiShownHeight`；版本侧新增 `ClipState`、`stableJson` / `globalSignature` / `clipSignature`、`clipStates`、`deleteClipVersion`、`deleteAllClipVersions`、`VersionDeletion`，`EditorFiles` 加可选 `remove?`，`ClipAttempt` 扩为 9 字段（`signature` / `index` / `parentJobId`）；历史版本函数已按 §4 改为 `clipVersions` / `ClipVersion[]`。
- 本文引用的 `multitrackEditor.vue` / `versionMenu.vue` 等 `.vue` 行号会随编辑漂移，核实时以函数名 grep 为准。
- `packages/nodeShared`：`bun run typecheck`（vue-tsc --noEmit）通过（2026-10-23 实测 exit 0）。