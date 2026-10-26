# 多轨编辑器：LSC 对齐状态与能力边界

> 本文记录 Toonflow 多轨编辑器对齐 LSC 的真实状态。
> **界面参照物（2026-10 改版起）**：LocalStoryCanvas 的 `native-h3-scene` 镜头创作工作台 + 独立「项目与成片」浮窗（`native-h3-scene.js:1330-1351`）。
> **数据层参照物（不变）**：原 ComfyUI Easy-Media 多轨编辑器的参数契约（一、二节），协议未动，沿用旧口径。
> **能对齐的写清楚，对不齐的写清楚原因**，不留「名义对齐、实际没实现」的模糊地带。

---

## 一、已对齐：参数契约

| 字段 | LSC | Toonflow | 状态 |
|---|---|---|---|
| `continuity` | `shot` / `context`（默认 shot） | 同名同值，首镜强制 shot | ✅ |
| 旧值兼容 | — | `start`/`cut` → `shot`，`continue` → `context` | ✅ 自动归一 |
| `task_mode` | `default` / `ref` / `edit` / `l2v` | `ref` / `image` / `text` | ⚠️ 子集（见下） |
| 参考图上限 | 独立 4 张 / 续接 3 张 | 同 | ✅ 校验器 V8/V16 拦截 |
| 续接时长下限 | 10 秒 | 同 | ✅ 校验器 V16 拦截 |
 | 参考顺序 | `images[]` 顺序决定 Picture 编号 | `referenceIds` 顺序决定，`「双花括号 ref 占位符」` 换算 | ✅ |
| 帧率 | 24 | 24 | ✅ |
| 时长网格 | 17n+5 | 由引擎侧处理，协议层透传秒数 | ✅ |

### `task_mode` 为什么只开放三态

LSC 的 `default` / `edit` / `l2v` 分别对应：
- `default`：不指定，由引擎按媒体推导
- `edit`：视频编辑（`v2v` / `vi2v`）
- `l2v`：尾帧生视频（`l2v`）

这三个都需要在**参考轨道**里放视频/尾帧素材，而 Toonflow 的产品口径是「资产卡 + 多图参考」，视频参考上限 1 条。所以只开放 `ref`（多模态参考）、`image`（单图首帧）、`text`（纯文生）三种最常用形态。

**这是有意的产品收敛，不是实现缺失。** 需要 `edit`/`l2v` 时应先补参考轨产品设计。

---

## 二、已对齐：续接机制

### 实现路径

```jsonc
{
  "kind": "generate",
  "prompt": "...",
  "media": { "references": ["<上传后的素材路径>", ...] },  // 多参考图照常
  "continue_from": { "from_job": "j<12位hex>" },            // 续接走任务级字段
  "quality": "light"                                         // two-pass
}
```

### 关键点：续接与多参考图并存

FreeVideo 引擎契约（`freevideo_engine/agent/schema.py:1184-1186`）：

```python
if value.get('continue_from') and media has (first | last):
    bad('media', 'only references when continue_from is supplied')
```

**顺序反过来读：`continue_from` 搭配 `media` 时，只有 `references` 合法。** 这是官方设计的并存组合。

官方说明（`agent/guide.py:103-104`）：

> Their only media is media.references with **at most 3 pictures**, which every continuing part also sees (keeps the same people); first_frame_reference then gives way to them.

### 与 LSC 的机制差异

| | LSC（ComfyUI 节点内） | Toonflow（agent API） |
|---|---|---|
| 上下文载体 | 磁盘上的 `context_latent` 文件 | 引擎内部，由 `from_job` 引用 |
| 注入方式 | `easy MiniMaxH3MotionContextHard` 节点把上一段 latent 拼到本段 latent 开头，`context_length=22` | 引擎侧等价处理（`continue_from`） |
| 额外帧处理 | 多生成 34 帧，解码后用 `easy h3ContextMediaTrim` 裁掉，成片时长不变 | 引擎侧处理 |
| 上下文失效判定 | `context_ok()` 递归校验 generation 链 + latent 文件存在 | **拿不到**，只能靠 `jobId` 是否存在判断 |
| 首帧锚点 | `first_frame_reference` 可选减少漂移 | 同名字段透传 |

**根本差异**：LSC 直连 ComfyUI，能读写 `context_latent` 与 `manifest.json`；Toonflow 走 agent API，只能引用 job。所以「父段重新生成 → 子段上下文失效」这类**文件级**判定我们做不到，只能判定「上一镜有没有成功的 jobId」。

---

## 三、已对齐：界面结构（2026-10 改版：镜头创作工作台 + 项目与成片浮窗）

改版前本编辑器按 Easy-Media `MultiTrackWidget`（预览区 / 工具栏 / 时间线三段式）对齐；2026-10 起整体改为 LSC `native-h3-scene` 的「镜头创作工作台」参照：**时间线视图删除**，预览与项目管理移交画布世界层的「项目与成片」浮窗。数据层（`.mtrack` 工程、派工/续接/版本/合成协议）未动，一、二节口径继续成立。

### 工作台纵向结构（`multitrackEditor.vue`，逐区块对齐 `native-h3-scene.js:1330-1351`）

| LSC 区块 | Toonflow 实现 | 状态 |
|---|---|---|
| `nh-editor-heading`（:1330 标题 + 项目/预览位） | 头部「镜头创作」+ 镜数/总秒数/工程路径行；预览与项目管理移交浮窗 | ✅ |
| `nh-quick-settings`（:1332 画幅/模型/分辨率） | 快捷设置行：画幅下拉 + 视频模型下拉 + 「W × H · 24fps」估算文本（与 freevideo 下发口径同源） | ✅ |
| `nh-section-heading` 01 + `nh-tabs`（:1333 镜头页签条） | 「01 选择镜头」+ `shotTabs.vue` 页签条（标题/起止累计秒/状态）；批量调整 details + 「＋ 添加镜头」 | ✅ |
 | `nh-workspace`（:1334-1338 左镜头编辑 + 右参考素材） | 「02 镜头内容」`shotEditorPane.vue`（名称/时长/画幅/分辨率/声音/提示词大框/衔接） + `referencePicker.vue` 参考素材勾选网格（位次即 `「双花括号 ref 占位符」`） | ✅ |
| `details('results')`（:1340 合并勾选镜头） | 「生成结果 · 校验」折叠区（statusPanel）；**合并勾选在浮窗版本菜单**（见下） | ✅ 位置偏离 |
| 高级设置（:1342-1348 项目设置/约束/范围） | 「高级设置」details：项目名称、全片风格、系统提示词（全片 + 本镜覆盖）、生成范围（从第 N 镜 + 镜数，-1 = 到最后） | ✅（采样/LoRA 不暴露，见下） |
| `nh-run-footer`（:1351 03 生成视频） | `runFooter.vue`：错误行 + 范围提示 + 保存/生成视频/暂停/继续/结束本批 + 状态行（`aria-live`） | ✅ |

### 「项目与成片」浮窗（`resultsOverlay.vue` + `versionMenu.vue`）

| LSC 做法 | Toonflow 实现 | 状态 |
|---|---|---|
| 独立的「项目与成片」窗口：大预览 + 片段播放条 + 逐镜版本菜单 + 完成片段网格 | `resultsOverlay.vue` 同构：保存方式说明行、大预览 video、上一段/片段下拉/下一段/顺序连播开关/打开视频/位置指示、`versionMenu.vue` 逐镜版本行（观看/设为默认 + 最新/正在观看标记）、完成片段网格 | ✅ |
| 片段播放条（`data-result-prev`/`data-result-next`/`data-result-pick`） | 「上一段」/「下一段」按钮 +「选择预览片段」下拉，按 `completedClips` 顺序跳转（`previewIndex ± 1`） | ✅ |
| 顺序连播已完成片段（`data-result-autoplay` checkbox，默认勾选） | 同名 checkbox 默认勾选；当前片段 `@ended` 且开关开着 → 换到下一段并自动播，末段播完停。手动暂停不触发 `ended`，连播自然中断（等价 LSC 的 `pause` 停 timeline） | ✅ |
| 位置指示（`data-result-position`：`N / M · 标题`） | 同文案口径，`previewIndex + 1 / completedClips.length · 标题`；自动播放被浏览器拦时同一位置显示「浏览器暂停了自动播放，点击视频播放键继续。」（同 LSC :567） | ✅ |
| 浏览器独立窗口 | **画布世界层浮窗**：teleport 到 `.vue-flow__transformationpane`（`nopan nozoom`），随画布缩放平移 | 有意偏离（见第七节） |
| 窗口拖动/缩放/收起 | 标题栏拖动 + 右下 resize handle + 收起高 70px；位移按 `rect.width/offsetWidth` 反推缩放系数换算；宽高实时夹取 [540,2400]×[540,2200]；方向键 10/Shift 50 | ✅ |
| 几何持久化 | `node.data.resultsUi`（`ResultsUiGeometry`，`mtrackProject.ts` 的 `defaultResultsUi`/`normalizeResultsUi`/`resultsUiShownHeight`），随画布 JSON 自动保存，重载后位置不丢；缺省贴节点右缘外 64px、1360×1480 | ✅ |
| 「镜头编辑」按钮回工作台 | emit `focusEditor` → `flow.setCenter` 聚焦本节点（zoom 0.9） | ✅ |
| 预览与时间线联动 | 浮窗大预览换镜 ↔ 工作台页签选中双向联动（`selectedClipId` prop / `previewSelect` 事件） | ✅ |
| 合并勾选（= `accepted`） | `versionMenu` 勾选 emit `toggleAccept` → 编辑器按 clipId 直接翻 `generated ⇄ accepted`，与工作台「验收」按钮同一状态 | ✅ 映射偏离（见第七节） |
| 工作台「查看成片」 | 高级设置行按钮 → `setCenter` 移到浮窗中心（zoom 0.6）；浮窗即成片的查看入口 | ✅ |

### 有意不暴露的 LSC 控件

| LSC 控件 | 为什么不做 |
|---|---|
| 种子 / 采样步数 / LoRA 权重 / 一采二采 | FreeVideo agent API 没有这些参数（`/api/ai/media/generate` 请求体不收；`quality: light` 已固定 two-pass）；暴露了也只是摆设。升级路径：API 补参数后加进快捷设置行 |
| ~~删除版本入口~~ | **已补齐**：`versionMenu` 逐行「删除」+ 折叠头「全部删除」+ `statusPanel` 版本行删除按钮；单删不弹确认（对齐 LSC `scope:'version'`），整镜走 `ElMessageBox.confirm` danger 确认；`EditorFiles.remove` 删物理文件，`/404\|not found\|ENOENT\|不存在/i` 不算失败；删当前默认后默认回落到剩余版本里最新一条；不改 `clip.status`（对齐 LSC `mergeDeletedResultDraft` 只动结果簿记）；生成中的镜拦截 |
| 双缓冲预载（`.nh-result-preview` + `.nh-result-buffer` 两个 video 元素，切换时预加载下一段） | Toonflow 用单个 `<video v-if="previewUrl">`：每次换 URL 元素销毁重建，天然无换源卡顿，不需要双缓冲 |
| ~~项目名称独立字段 / 本镜系统提示词独立字段~~ | **已补齐（t6）**：协议新增可选字段 `project.name`（界面「项目名称」编辑位，缺失显示「未命名项目」，不从 `projectId` 猜）与 `clip.systemPromptOverride`（派工经 `effectiveGlobal` 替换 `global.systemPrompt`）；`projectId` 回归跨文件对账标识、`clip.notes` 回归纯备注（不再当提示词读，消除 agent 写入口的提示词注入隐患），均为 additive 可选字段，老工程照常加载 |


---

## 四、做不到的事（能力边界，如实告知）

| 项 | 原因 |
|---|---|
| `context_latent` 文件读写 | agent API 不暴露引擎内部产物 |
| 父段 generation 级失效判定 | 同上；只能判 jobId 有无 |
| 三路视频轨 / 三路音频轨 | 产品口径是资产卡（图 ≤4 或续接 ≤3、视频 ≤1、音频 ≤1） |
| 副字幕轨（subtitle） | 未纳入当前产品范围 |
| LoRA / 调度器 / 二采参数 | agent API 不暴露（`quality: light` 已固定 two-pass） |
| 撤销/重做工程编辑 | 只保留删除后的一次撤销快照 |

---

## 五、参考容量对照

| | LSC | Toonflow | 说明 |
|---|---|---|---|
| 引擎能力 | 图 9 / 音 3 / 视 3 | 引擎侧图 32、实际按协议 | 引擎本身更宽 |
| 产品限制 | 同引擎 | 图 4（续接 3）/ 音 1 / 视 1 | Toonflow 更保守 |
| ≥30 秒分块 | 图 3 | 图 3 | 引擎硬限制，一致 |

---

## 六、验证记录

| 项 | 结果 |
|---|---|
| 独立镜头生成（S004，shot，1 参考） | ✅ `generated`，`jobId=j2d1340151295` |
| 续接镜头生成（S005，context，2 参考，10 秒） | ✅ `generated`，`jobId=j071576f68ead` |
| 画面承接验证 | ✅ S004 末帧 vs S005 首帧亮度平均差 **1.86/255（0.7%）**，机位/姿态/光线一致 |
| 续接 + 多参考并存 | ✅ 2 张参考图与 `continue_from` 同时生效 |
| 引擎限制拦截 | ✅ 5 秒续接被拒（`Each continued part must be at least 10 seconds`），已写入校验 |

---

## 七、刻意偏离 LSC 的几处（附理由）

| 偏离点 | LSC 做法 | 我们的做法 | 为什么 |
|---|---|---|---|
| 片段衔接标记 | 无任何标记，continuity 只在参数下拉里 | **加「承接」说明块 + 超限时错误级警告**（工作台 02 区） | 用户明确要求「续接分镜在内部引导所有地方写清楚」；LSC 这块过于隐晦，用户容易误以为没生效 |
| 首镜衔接约束 | 只在多选批量改时静默强制 shot，UI 无提示 | **下拉禁用 + 写明「首镜必须独立起拍」+ 校验器 V11 拦** | 静默强制等于埋坑；首镜设成 context 必然失败，提前说清 |
| 续接参数提示 | 只有 Tooltip，无告警 | **面板常驻说明块 + 10 秒/3 张超限时错误级警告** | 这两条是引擎硬限制，用户不看文档不会知道 |
| 预览播放静音 | 强制 muted，声音走独立 Playback 组件 | **保留声音**（当前片段的音轨） | 我们是逐镜成片自带音轨，没有独立混音轨；静音会让用户以为没生成声音 |
| 「项目与成片」是独立浏览器窗口 | `window.open` 级独立窗口 | **画布世界层浮窗**：teleport 到 `.vue-flow__transformationpane`，随画布缩放平移，几何持久化 `node.data.resultsUi` | 我们的宿主是画布卡片，独立弹窗会脱离画布坐标与主题；世界层浮窗保留「和镜头同处一张画布」的空间感，位置还能随工程画布一起存 |
| 「用于合并」是独立合并标记 | 独立 `merge` 勾选集 | **映射 `clip.status` 的 `generated ⇄ accepted`**（勾选 = 验收，契约 §3.2） | 合成清单真源一直是 accepted（V14 连续性复核），另造布尔字段就是双真源；浮窗勾选与工作台「验收」按钮改的是同一个值 |
| 种子 / 采样步数 / LoRA / 一采二采控件 | 高级设置里逐项可调 | **不暴露** | FreeVideo agent API 没有这些参数，暴露了只是摆设；`quality: light` 已固定 two-pass |
| 删除版本入口 | 版本行可删 | **不开放** | 历史版本是画布上的真实节点与磁盘产物，删除牵涉节点生命周期与文件回收；协议里没有「删一次 attempts」语义（见三节表与 §15.9 纪律） |
| 合并可任意勾选、任意顺序 | `merge_files` 收任意勾选段 | 只含 accepted 且必须按工程顺序连续 | 数据层协议，本次改版不动；footer 文案不暗示能合并非连续/未验收镜 |
