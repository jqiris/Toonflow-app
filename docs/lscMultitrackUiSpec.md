# LSC 多轨编辑器界面规格与交互契约

> 只读源码依据（下称基目录）：`LocalStoryCanvas/runtime/ComfyUI/custom_nodes/ComfyUI-Easy-Media/frontend/`
> 引用简写：`W`=`src/components/widgets/MultiTrackWidget.tsx`、`PA`=`.../widgets/multitrack/PreviewArea.tsx`、`TSE`=`.../TaskSegmentEditor.tsx`、`TA`=`.../TrackArea.tsx`、`TB`=`.../MultiTrackToolbar.tsx`、`RU`=`.../MultiTrackRuler.tsx`、`SB`=`.../MultiTrackSegmentBlock.tsx`、`VT/AT/ST`=`.../VideoTrack.tsx|AudioTrack.tsx|SubtitleTrack.tsx`、`PFT`=`.../PreviewFloatingToolbar.tsx`、`VP`=`.../VideoPreview.tsx`、`UT`=`src/lib/multitrack-utils.ts`、`STY`=`src/lib/multitrack-segment-style.ts`、`CSS`=`src/styles/globals.css`。
> 本文只描述「LSC 是什么样」，不含实现建议；映射表一节明确标注为「建议」。

---

## 1. 整体骨架

### 1.1 区域顺序与弹性（事实）

根节点是 `flex h-full w-full flex-col overflow-hidden rounded text-foreground text-xs select-none`（W:1366-1369），自上而下三个直接子节点：

1. `PreviewArea`：`flex min-h-24 w-full min-w-0 flex-1 overflow-hidden rounded-sm`（PA:1246-1249 为 task 分支；PA:1282-1285 为其他分支，背景 `bg-black`），即**吸收剩余高度**。
2. `MultiTrackToolbar`：`grid h-9 min-h-9 shrink-0 grid-cols-[1fr_auto_1fr] border-b border-border text-[10px]`（TB:86），**固定 36px**。
3. 时间线面板：`grid shrink-0 transition-[grid-template-rows] duration-300 ease-in-out`，未折叠为 `grid-rows-[1fr]`、折叠为 `grid-rows-[0fr]`，并带 `aria-hidden={timelineCollapsed}`（W:1421-1424）。内部横向滚动容器 `no-scrollbar shrink-0 overflow-x-auto overflow-y-hidden`，内容层 `style={{ width: 容器宽×zoom, minWidth:'100%' }}`（W:1426-1428）。

```text
MultiTrackWidget（flex-col，h-full）
├─ PreviewArea ................ flex-1, min-h-24（吸收剩余高度）
│   ├─ 选中 task → TaskSegmentEditor 整块铺满
│   └─ 其它/未选中 → [任务参考图竖栏 80/128px] [VideoPreview 舞台 aspect=W:H]
│                    + 底部提示词条（bg-black/70）
│                    + 右侧浮动工具条（音频 / 帧率）
├─ MultiTrackToolbar ......... h-9 = 36px，固定
│   ├─ 左：撤销 重做 分割 左裁 右裁 删除 任务标记
│   └─ 右：任务轨概览 磁吸 折叠 缩放滑杆
└─ 时间线面板 ................ grid-rows-[1fr] ⇄ [0fr]，300ms
    ├─ MultiTrackRuler ........ h-6 = 24px（左槽 28px / 右预留 48px）
    │   ├─ 刻度 + 时间码标签 mm:ss:ff
    │   ├─ 任务标记（可拖、右键删）
    │   └─ 播放头竖线（bg-destructive）
    └─ TrackArea .............. 高 = Σ轨道高 + 24px 添加轨道行
        ├─ task      30px（taskOverview 开 → 64px）
        ├─ video     64px
        ├─ audio     64px
        ├─ subtitle  30px
        └─ 添加轨道行 24px（视频 / 音频 / 字幕 各一个 + 按钮）
```

### 1.2 各轨道高度（事实）

- `getMultiTrackTrackHeight`：task 轨 `taskOverview ? 64 : 30`，subtitle `30`，video/audio `64`（UT:30-34）。
- 轨道区内「添加轨道」行固定 `addTrackHeight = 24`（TA:231-233）；轨道总高 = Σ轨道高 + 24（TA:232-233）。
- 标尺固定 `h-6`（`h-6 shrink-0 ... border-b`，RU:164），左槽 `MULTITRACK_LEFT_GUTTER = 28`、右预留 `MULTITRACK_RIGHT_RESERVE = 48`（RU:6-7）。
- 高度变化会同步改画布节点高度（W:189-194 → `adjustMultiTrackEditorNodeHeight`，`timeline-node-size.ts:68-77`）；该节点默认尺寸 800×700（`timeline-node-size.ts:5-8`）。

### 1.3 折叠与遮罩（事实）

- 折叠只作用于时间线面板，预览区与工具栏保留（W:1421-1424）。
- 两个全屏遮罩：智能分割 `bg-background/80 z-50`（W:1490-1502）、字幕识别 `bg-background/80 z-50`（W:1503-1515）；模型缺失弹窗 `bg-background/90 z-[60]`（W:1525-1586），`aria-modal`。
- 根节点 `aria-busy` 绑定 `isSmartSplitting || isRecognizingSubtitles`（W:1368）。

---

## 2. 预览区（PreviewArea）

### 2.1 按选中片段的轨道类型分流（事实）

| 选中片段的 track 类型 | 渲染 | 依据 |
| --- | --- | --- |
| `task` | 整块替换为 `TaskSegmentEditor`（或放大图查看器） | PA:1244-1279 |
| `video` | VideoPreview 只播选中的那一段 | PA:296-298、UT:1012-1022 |
| `audio` | 等价于「未选中」（`previewSelectedSegment = null`） | PA:295 |
| `subtitle` | 视频舞台 + 右侧字幕设置面板（宽 35%/最小 18rem） | PA:1375-1392、`SubtitleSettingsPanel.tsx:231-236` |
| 未选中 / 多选 | 播放头所在任务片段负责参考图与提示词条；有其他片段时显示视频舞台 | PA:300-301、PA:1304-1394 |

补充事实：
- 未选中且无任何片段时显示空态引导（四个轨道说明 + 两个功能说明），`<dl>` 网格（PA:1123-1174）。
- 未选中且分辨率模式为 `megapixels` 时，右上角显示「当前分辨率 W × H」Badge（PA:1290-1303）。
- 音频选中被刻意降级为「未选中」，因此音频片段没有专属参数面板（PA:295）。

### 2.2 task 片段的参数面板（TaskSegmentEditor）

布局（事实）：外层 `flex h-full flex-col p-4`，左「参考图区」`aspect-square h-full shrink-0`（TSE:494-501），右「提示词面板」`flex-1 border border-border rounded-md bg-muted/30`（TSE:682-684），底部工具行 `border-t border-dashed p-2`（TSE:803）。

字段与控件顺序（自上→下 / 自左→右）：

| 位置 | 字段 | 控件 | 取值 / 默认 | 依据 |
| --- | --- | --- | --- | --- |
| 左区 | 参考图（最多 9 张） | 拖放区 / 3 列（≤3 张时 2 列）网格；空态为上传卡片 | `MAX_TASK_IMAGES = 9`；角标序号从 `imageIndexOffset` 起算（MiniMax 为 1） | TSE:467、TSE:515-662、TSE:644、PA:1264、`lib/task-image-utils.ts` |
| 右上 | 用户提示词 / 系统提示词 | 两个按钮组成的分段切换（`bg-card` 内嵌） | 默认「用户提示词」 | TSE:687-711 |
| 右上（仅用户页） | 提示词变体 A / B | Tabs（A、B） | 默认 `a` | TSE:712-734、TSE:241、PA:1002 |
| 右上（仅系统页） | 重置系统提示词 | Ghost 图标按钮 | 仅在已自定义时出现 | TSE:735-751 |
| 主体 | 提示词正文 | 富文本编辑器（`@图片n`/`@音频n`/`@视频n` 引用 chip） | MiniMax 使用专用占位文案 | TSE:754-799、TSE:130-166、zh.json:127 |
| 底部左 | 逐段编辑 / 整体编辑 | Tabs | 默认「逐段编辑」；容器宽 <600px 时整组隐藏 | TSE:804-809、TSE:472-486 |
| 底部中 | 片段序号 + 时长（`mm:ss:ff`） | 文本 + 铅笔按钮 → 单行输入 | 时长格式 `mm:ss:ff`，回车/失焦提交 | TSE:833-851、UT:139-161 |
| 底部右 | 衔接模式 | Select（`h-8 w-20`） | `shot`/`context`，默认 `shot` | TSE:855-882、UT:20-21 |
| 底部右 | 参考图像尺寸 | Select（`h-8 w-20`） | `match`/`max`，默认 `match`；仅 `format==='MiniMax'` 且 mode∈{ref,edit} | TSE:883-908、UT:22-23 |
| 底部右 | 任务模式 | Select（`h-8 w-24`） | `default/ref/edit/l2v`，默认 `default` | TSE:909-931、UT:18-19 |

控件类型汇总：**下拉 3 个（衔接/参考尺寸/任务模式）、Tabs 2 组（提示词页、A/B、编辑模式）、输入 1 个（时长）、图标按钮 3 个（重置系统提示词、编辑时长、放大预览）；无滑杆、无开关**（TSE:488-936）。

任务模式选项文案不是固定四词，而是按「图像数量 + 范围内是否有视频」映射到 `multitrackTaskModes.*`（TSE:926、UT:101-113、zh.json:92-105）：
`t2v` 文生视频 / `i2v` 图生视频 / `fl2v` 首尾生视频 / `fmlf2v` 多帧生视频 / `r2v` 参考生视频 / `rv2v` 参考视频生视频 / `vi2v` 图像视频编辑 / `v2v` 视频生视频 / `l2v` 尾帧 / `default` 文图。

### 2.3 视频播放器

- 舞台 `flex h-full ... overflow-hidden bg-black`，`aspectRatio = resolution.width / resolution.height`（VP:87-95）。
- `objectFit` 由 `resize_method` 决定：`stretch→fill`、`crop→cover`、其余 `→contain`（VP:17-21、VP:105）。
- 无视频 URL 时渲染黑帧占位 `bg-black`（VP:107-109）。
- 预览区在播放时**强制静音**：`muted` 与 `volume={0}` 硬编码（PA:1363-1364）；声音由独立的 `PreviewAudioPlayback` 承担（PA:1396）。
- 分辨率来源优先级：节点 `resolution*` 组件值 + 首个视频元数据，解析为 `fixed/custom/auto/longest/shortest/megapixels` 六种模式，缺省 544×960（UT:1277-1280、UT:1433-1519）。

`activeVideo` 的选择规则（事实，UT:1005-1037）：
1. 若当前选中片段属于 video 轨：**只在选中片段内查找**；播放头不在其中即返回 `null`（不回落其他片段）。
2. 否则按轨道顺序，取第一条 video 轨中「`media_type === 'video'` 且 `start_frame ≤ 当前帧 < end_frame`」的第一个片段。
3. 局部播放时间 = `frameToSeconds(当前帧 - origin_start_frame ?? start_frame)`（UT:1001-1003、UT:1019）。
4. 预览帧取整：`currentFrame === total_length` 时回退到 `total_length - 1`，以保留末端可选中（UT:995-999）。
5. 选中 task 片段时 `activeVideo` 被强制置空（PA:296-297）。

`isPlaying` / `playbackNonce` 的作用（VP:65-85）：
- `isPlaying=false` 时只做 seek（差值 >0.001s 才写 `currentTime`），不播放。
- `isPlaying=true` 时先 seek 到 `activeVideo.localTime` 再 `play()`；`play()` 的 promise 拒绝只 console.error。
- `playbackNonce` 是 effect 依赖之一：**同一段视频重播时不换源也要重新触发 seek+play**，配合「循环回到 0」与外部 `__easyMediaSyncPlay` 使用（W:347-362、W:391-398）。

### 2.4 参考图缩略图栏（未选中/非 task 选中时）

- 位置：视频舞台**左侧**竖栏，标题「任务 N」（`multitrack.previewTaskLabel`，PA:1337-1339）。
- 尺寸：均衡模式 `w-20 flex-[0_0_5rem]`（80px）；「放大任务图片区」模式 `w-32 flex-[0_0_8rem]`（128px）；切换按钮在提示词条内（`PanelLeft`/`PanelRight`，PA:339-344、PA:945-965）。
- 缩略图为 `aspect-square w-full`、`object-contain`、`bg-black`、`rounded-sm`；当前预览项边框 `border-primary`，其余 `border-border`（PA:636-684）。
- 点击：设为「当前预览图」（PA:670），与舞台不联动切视频。
- 拖拽排序：HTML5 draggable，拖入目标位置即 `moveTaskImage`（PA:108-121、PA:653-661）。
- 悬停控件（`opacity-0 group-hover:opacity-100`）：左上「预览」（放大查看器），右上「删除」（`text-destructive`）（PA:857-929）。
- 增图入口：末尾虚线「+」按钮，`MAX_TASK_IMAGES` 未满时显示（PA:591-634）。
- 无视频时改为「图片流」布局：`flex-wrap` 中平铺，每张 `h-40 w-fit`，加号 `h-40 w-40`（PA:1307-1331）。
- 放大查看器：整块 `bg-black p-3 pt-12`，左上「返回预览」、右上缩放百分比；滚轮以指针为中心缩放，范围 1–6、步长 1.15；Esc 关闭（PA:1176-1242、PA:57-59）。

### 2.5 预览区工具栏按钮清单与禁用逻辑

底部提示词条（`bg-black/70`，仅未选中且有片段时；PA:931-1121、PA:1394）：

| 控件 | 出现条件 | 依据 |
| --- | --- | --- |
| 布局切换（PanelLeft/Right） | `usesTaskImageOnlyPreview === false` | PA:945-965 |
| 提示词文本 / 双击进入 Textarea | 恒有；空文本用 `text-muted-foreground` 占位 | PA:966-1009 |
| 分隔符 `\|` | 恒有 | PA:1010 |
| 衔接模式 Select（`h-5 w-16`） | `format === 'MiniMax'` 且片段序号 > 0 | PA:1011-1047 |
| 参考图像尺寸 Select（`h-5 w-16`） | `format === 'MiniMax'` 且 mode∈{ref,edit} | PA:1048-1084 |
| 任务模式 Select（`h-5 w-12`） | 恒有；`onTrackSegmentsContentChange` 缺失时 disabled | PA:1085-1118 |

右侧浮动工具条（`absolute top-1/2 -translate-y-1/2`，`rounded-lg border bg-popover/90 backdrop-blur`，PA:1397-1414、PFT:105-109）：
- 「音频」竖按钮（`h-12 w-10`）：图标在 `Volume2`/`VolumeX` 间切换，Popover 内为 静音/取消静音 按钮、`-20..6 dB`（步 0.1）数字输入 + 滑杆（PFT:110-161、UT:24-26）。
- 「帧率」竖按钮：Popover 内为帧率滑杆（档位 `16/20/24/25/30/50/60`，带刻度标签，默认 24）+ 时长输入（`mm:ss:ff`，仅选中视频/音频片段时出现）（PFT:163-217、UT:28）。
- 右侧内缩值：字幕面板打开时为 `calc(max(35%, 18rem) + 12px)`，否则 12px（PA:56、PA:1408-1410）。

---

## 3. 时间线（TrackArea + MultiTrackRuler）

### 3.1 帧级标尺

- 可用宽度：`playableWidth = width - 28 - 48`，末尾 48px 为遮罩区（`bg-black/30`，RU:169-172）；刻度与播放头都按 `playableWidth` 换算（RU:86-91）。
- 刻度策略（RU:25-69）：
  - `pixelsPerFrame >= 6` 时逐帧出刻度，仅每 `frameLabelStep` 帧、以及末端帧（且标签间距达标）出标签；`frameLabelStep` 取 `frameRate/8` 的整数倍向上取整（RU:42-56）。
  - 否则从 `[1,2,5,10,15,30,60,120,300]` 秒档位里选第一个使像素间距 ≥56px 的步长（RU:8-9、RU:59-64）。
  - 大刻度 `h-3 w-px`、小刻度 `h-1.5 w-px`，颜色均为 `bg-border`；标签 `text-[8px] text-muted-foreground`，位置 `top-1`（RU:179-180）。
- 时间码格式（UT:163-193）：`mm:ss:ff`，小时 >0 时升级为 `hh:mm:ss:ff`；标尺与工具栏均带帧位。时长另用 `mm:ss:ff` 且无小时段（UT:139-147）。
- 任务标记（`task_markers`）：图标按钮宽 20px 高 24px、水平居中于帧位置、颜色 `var(--highlight)`；Tooltip 显示「片段 NN」+ 时间码；右键删除；拖动时抓取光标并实时移动（`MultiTrackTaskMarker.tsx:39-91`）。

### 3.2 轨道类型顺序与头部布局

事实：轨道顺序即 `data.tracks` 数组顺序，默认数据只有 `task`(Task 0) + `video`(Video 0) 两条（UT:1617-1651）；新轨道一律**追加到末尾**（W:577-588）。拖拽可交换顺序，但 task 轨不可拖动、也不能作为落点（W:605-622、TA:415-438）。

头部（左侧 `width: 28px` 的竖栏）：

| 轨道类型 | 头部内容 | 依据 |
| --- | --- | --- |
| task | 仅类型图标（`ListTree`），无名称/静音/独奏/锁定 | TA:677-682 |
| video | 拖拽手柄包住的 `Clapperboard` 图标 + `M`/`S` 小按钮（`h-3 w-3 text-[8px]`） | VT:104-115、`TrackAudioControls.tsx:14-61` |
| audio | 同上，图标 `Music2` | AT:121-131 |
| subtitle | 拖拽手柄包住的 `Captions` 图标；可见性 Eye/EyeOff 按钮在内容区左端 | ST:65-72、ST:147-167 |

要点：
- **轨道名称不出现在头部**，只出现在 `aria-label` 与 tooltip（如「静音{name}」），zh.json:191-196。
- 静音 `M`：开启时 `text-destructive`；独奏 `S`：开启时 `text-highlight`；aria-pressed 同步（TrackAudioControls:26-53）。
- 独奏是「互斥」行为：开启某轨独奏会把其他视频/音频轨静音，关闭时反向复位（W:634-656）。
- **头部没有音量控件**：音量按「片段级 `content.volume_db`」与「全局/总音量」两处设置，入口都在预览区浮动工具条（W:1021-1037、PFT:70-77）。
- 字幕轨可见性 `visible !== false` 时显示 EyeOff（点后隐藏），否则 Eye（ST:58、ST:147-167）。

### 3.3 片段块

- 宽度换算（SB:68-73）：`left = start_frame / max(total_length,1) * areaWidth`，`width = max(2, (end-start)/max(total_length,1) * areaWidth)`；`areaWidth` 即 `playableWidth`（TA:580、TA:615、TA:649、TA:692）。片段块绝对定位，`top-1 bottom-1`（SB:397）。
- 内容排布：
  - task 轨：标题行 `h-3.5` 显示「片段 N 模式」或仅模式（`showTaskIndex = task_markers.length === 0`，TA:695）+ 时长；字号 `text-[8px]`（SB:464-474、STY:47）。
  - video 轨：标题行 + `h-8` 视频封面条（`background-repeat: repeat-x`、`background-size:auto 32px`，取片头帧，SB:475-485）。
  - audio 轨：标题行（带 `--multitrack-audio-title-bg` 底色）+ 波形区，顶部叠一条 `h-0.5 bg-warning`（SB:486-510、STY:29-40）。
  - subtitle 轨：仅标题行，文字为字幕内容（SB:164-166）。
- 选中态：`zIndex: 30`，边框改用该轨道 `presentation.borderColor`，左右各 0.5px 手柄高亮（`isResizing || selected` 时显色，SB:191-212、SB:514-521）；未选中时边框弱化为 `backgroundColorStrong`。
- 拖拽移动：位移超过 4px 才进入拖拽（`DRAG_START_DISTANCE`，SB:26、SB:323）；拖拽中 `zIndex 9999` + `box-shadow 0 8px 24px`，落点位置显示 `bg-muted/60` 虚线框占位（TA:826-831），并把目标轨其余片段按落点重排预览（TA:498-531）。
- 裁剪手柄：左右各一个 `w-0.5 cursor-ew-resize` 的透明热区条，命中宽度 = 未选中 8px / 选中 12px（SB:23-24、SB:263-265、SB:516-521）；裁剪中边框变 `var(--warning)`（SB:191-192）。
- 悬停控件：
  - video/audio 片段**没有 hover-only 控件**；audio 轨在 `format === 'MiniMax'` 时，右上常驻两个 `h-5 w-5` 按钮：`right-8` 说话人复用（`Speech`，激活 `text-highlight`）与 `right-2` 音频锁（`Lock`/`Unlock`，激活 `text-highlight`）（SB:522-579、TA:637）。
  - 预览区参考图缩略图与任务图网格才有 `opacity-0 → group-hover:opacity-100` 的 hover 控件（PA:867-870、TSE:610）。
- 右键菜单（SB:582-626）：video 有「智能分割」「智能分割（仅任务）」「识别字幕」子菜单（Whisper Large V3 / Qwen3-ASR）；task 有「均分片段」「克隆片段」「拆分片段」；所有类型都有「删除片段」。
- 键盘：Enter 选中（带 Ctrl/Meta 为 toggle、Shift 为 add），Delete/Backspace 删除（SB:427-430）。
- 双击：video/audio 打开「重选素材」Popover 并定位到指针处（VT:142-150、AT:166-174）；subtitle 进入就地编辑并选中（ST:95-98）。

### 3.4 `taskOverview` 开关的作用

- 关闭（默认 `false`）：task 轨高 30px，片段块显示「片段 N 模式 + 时长」的紧凑条（UT:1617-1623、STY:47）。
- 打开：task 轨高 **64px**；片段块改为「参考图铺满 + 底部黑条文案」：把该片段参考图列表 **循环平铺 24 遍**（`Array.from({length:24})`）作为横向图带，底栏显示提示词（无提示词则显示标签）（SB:179-184、SB:433-461）。
- 工具栏按钮为 `aria-pressed` 的 Outline/Ghost 切换，开启时 `text-highlight`（TB:244-259）；空态引导文案也提到它用于「展开任务轨，查看各片段的提示词和参考图片」（PA:1130-1133、zh.json:180-181）。

### 3.5 播放头与 seek

- 渲染两条：标尺内 `absolute top-0 h-full w-px bg-destructive`（RU:203），轨道区内 `absolute top-0 z-20 w-px bg-destructive`，高度为轨道总高（TA:568）。
- 位置：`28 + (currentTime / max(total_length,1)) * playableWidth`（RU:90、TA:228）——播放头**不进入右侧 48px 预留区**。
- 拖动 seek：在标尺上 `mousedown` 即 seek，并监听全局 `mousemove` 连续 seek、`mouseup` 解绑；换算 `x = (clientX - rect.left)/scale - 28`，再 `ratio * total_length` 取整并 clamp（RU:100-123）。
- 光标样式：标尺默认 `cursor-col-resize`，拖动任务标记时 `cursor-grabbing`（RU:164）。
- seek 写入前统一走 `snapTimeToFrame`，其实现为 `Math.round` 并 clamp ≥0（W:215-219、UT:195-198）。

---

## 4. 交互契约

### 4.1 播放如何驱动 `currentTime`，与预览播放器如何同步

事实链路：
1. `isPlaying` 由工具栏播放键翻转（W:1399）。
2. 播放 effect 用 `requestAnimationFrame` 累加：`startedAt = performance.now()`、`startTime = currentTimeRef`，每帧 `next = startTime + secondsToFrame(elapsed)`，再 `snapTimeToFrame` 取整；到达 `total_length` 时**回到 0 并 `syncPlayNonce++`**，形成循环（W:378-409）。
3. `currentTime` 同时写入 state 与 `currentTimeRef`（W:400-403、W:327-329），ref 供拖动/裁剪切帧逻辑读取。
4. `currentTime` 下传 PreviewArea；`isPlaying` + `playbackNonce` 下传 VideoPreview 与 PreviewAudioPlayback。
5. 视频/音频只做「seek 到 localTime + play/pause」；**时间轴是唯一时钟**，播放中不对媒体做逐帧校正（VP:65-85、`PreviewAudioPlayback.tsx:70-99`）。
6. 外部同步播放入口：节点上挂 `__easyMediaSyncPlay()`，行为是「归零 → 置为播放 → nonce++」，供宿主触发（W:347-362）。
7. 任何阻塞型长任务（智能分割、字幕识别、朗读生成）开始前会先 `setIsPlaying(false)`（W:1112、W:1159、W:1193、W:1226）。

### 4.2 `snapEnabled` 与 `zoom` 的实际作用

- `snapEnabled`（默认 `true`，工具栏 Magnet 按钮切换，TB:260-275）只影响**移动/裁剪的目标帧**：
  - 关闭 → 目标帧直接 `snapTimeToFrame`（仅取整）（W:985-987、TA:492-496）。
  - 开启 → 调用吸附函数：把目标帧吸到候选集合 `{0, total_length, 当前播放头, 其他片段的所有 start_frame/end_frame}` 中最近的一个；吸附半径以「8px 折算成帧数」计算（`RESIZE_SNAP_DISTANCE`、SB:25、SB:279-281、TA:488-490、UT:200-290）。
  - 裁剪时额外约束：禁止越到对面边缘之外；移动时可同时吸「片段头」与「片段尾」（UT:229-241、UT:273-287）。
- `zoom`（滑杆 min 1 / max 6 / step 0.25 / 默认 1，TB:300-310）只影响**时间线横向显示宽度**：内容宽 = 容器宽 × zoom，超出即横向滚动，标尺与轨道区共用同一 `scaledTimelineWidth`（W:162-163、W:1428、W:1429-1485）。它不影响 `frame ↔ 帧号` 的数据换算，仅改变像素比例；片段块内部再用 `rect.width / width` 反推实际缩放（SB:267-272、RU:93-98）。

### 4.3 多选语义（shift / ctrl）

- 片段 `mousedown` 的修饰键映射（SB:299）：`Ctrl`/`Meta` → `toggle`，`Shift`（或该片段已选中）→ `add`，否则 `replace`。同一片段键盘 Enter 同样遵循此规则（SB:428）。
- `replace` 只保留该片段；`add` 追加并把它设为「主选中」；`toggle` 再次点击则取消，并把主选中退回到集合中任意剩余项（W:221-247）。
- 多选后：`selectedSegment` 变 `null`（主面板只按单选用），`previewSelectedSegment` 仅在「选中的全是 task 片段」时回落为单主选中，以便预览区仍能进 TaskSegmentEditor（W:166-183、PA:1244-1279）。
- 多选拖动：`handleMoveSegment` 在 `selectedSegmentIds.has(segmentId)` 时走「整组同轨平移」`moveSelectedSegments`（W:1009-1019、UT:854-867）。
- 删除：若被删片段在多选集合内，则删整个集合（W:857-863）。
- 框选：轨道区空白处按住左键拖出 `border-primary bg-primary/10` 矩形，命中片段全部选中；位移 ≤3px 视为点击并清空选择（TA:305-371、TA:832-837）。
- 清空选择：点空白（TA:552-563）、或调用 `handleClearSelection`；同时清掉任务标记选中（W:256-259）。

---

## 5. 配色 token

### 5.1 LSC 实际使用的语义 token（事实）

变量定义见 `CSS:13-76`（`@theme inline` 映射）与 `CSS:82-184`（`:root` 与 `.dark-theme` 两套值）；轨道专属色见 `CSS:105-124`。

| token | 该界面里的用途 | 视觉层级 | 依据 |
| --- | --- | --- | --- |
| `bg-background` | 预览区 task 分支底色、工具栏底、遮罩 `bg-background/80/90/95` | 最底层画布 | PA:1248、W:1492、W:1527、CSS:86 |
| `text-foreground` | 主要文字（标题、按钮字、时长、列表项名） | 一级文字 | 出现 49 次，如 TB:212、PA:1150 |
| `text-muted-foreground` | 次要说明、占位、未激活图标 | 二级文字 | 出现 100 次，如 PA:1140、TB:93 |
| `border-border` | 所有分隔线、轨道行下边线、片段描边、输入框 | 结构线 | 出现 68 次，如 TA:674、RU:164 |
| `bg-card` | 内嵌按钮组/分段的「浅层容器」（提示词页切换、A/B、编辑模式、Select 触发器、M/S 小按钮） | 比底略高的卡面 | TSE:688、TSE:723、`TrackAudioControls.tsx:26`、CSS:88 |
| `bg-muted` / `bg-muted/30` / `bg-muted/20` | 提示词面板底、图片网格底、拖拽占位 `bg-muted/60` | 低对比填充 | TSE:684、TSE:501、TA:828 |
| `bg-popover` / `bg-popover/90` | 浮动工具条、Tooltip、下拉层 | 悬浮层 | PFT:107、`MultiTrackTaskMarker.tsx:79` |
| `primary` | 选中边框、播放头强调、激活文字、播放进度条、虚线加号 hover | 主操作/选中 | SB:194、PA:652、PA:844 |
| `highlight` | 「已开启」的开关态（静音/独奏/吸附/概览/音频锁/说话人）、任务标记图标、播放键渐变终点 | 强调（黄色调） | `TrackAudioControls.tsx:45`、TB:249、TB:265、`MultiTrackTaskMarker.tsx:54`、TB:220 |
| `secondary` / `text-secondary` | 播放键底、提示词条里的 `\|` 分隔符 | 次强操作 | TB:210、PA:1010 |
| `destructive` | 删除按钮、静音中的 M、播放头竖线、错误文案 | 破坏性/时间指示 | PA:899、TA:753、RU:203 |
| `warning` | 裁剪中边框、音频片段顶部 0.5px 高亮条 | 进行中状态 | SB:192、SB:493 |
| `accent` / `bg-accent/20` | 拖拽悬停底、字幕轨色 | 交互反馈 | PA:606、UT:91 |
| `ring-ring` / `ring-primary` | 输入/Select 的 focus-visible 环、选中字幕框的 1px 环 | 焦点 | PA:1027、PA:786 |

轨道色板（片段块底色，与上面语义色并行，是独立一套 CSS 变量，`STY:16-66`、`CSS:105-124`）：
`--multitrack-video-bg`（青 oklch .42 .08 195）、`--multitrack-audio-bg`（深蓝 #0E3058）、`--multitrack-task-bg`（紫 #744A82）、`--multitrack-subtitle-bg`（砖红 #9D4937），各自另有 `-strong / -border / -text / -waveform` 变体；**浅色与深色主题下这四组值完全相同**（`CSS:105-124` 与 `CSS:161-180` 一致）。

播放键用渐变描边：`linear-gradient(var(--primary) → var(--highlight))`（TB:217-236、`CSS:217-222` 的 `.text-gradient`）。

### 5.2 LSC 语义 → 建议 `--el-*` 映射（设计建议，非源码事实）

| LSC token | 建议 Element Plus 变量 | 理由 / 注意 |
| --- | --- | --- |
| `--background` | `--el-bg-color` | 画布底层 |
| `--card` | `--el-bg-color-overlay` | 内嵌卡面 |
| `--popover` | `--el-bg-color-overlay` + `box-shadow: var(--el-box-shadow-light)` | 悬浮层 |
| `--foreground` | `--el-text-color-primary` | 一级文字 |
| `--muted-foreground` | `--el-text-color-regular`（更弱处用 `--el-text-color-secondary`） | 二级文字 |
| `--muted` / `muted/30` | `--el-fill-color-light` / `--el-fill-color-lighter` | 低对比填充 |
| `--border` | `--el-border-color`（细分隔线用 `--el-border-color-lighter`） | 结构线 |
| `--primary` | `--el-color-primary` | 主操作、选中 |
| `--primary-foreground` | `--el-color-white`（或在深色主题用 `--el-color-primary-dark-2` 反差） | 主色上的文字 |
| `--destructive` | `--el-color-danger` | 删除/错误 |
| `--warning` | `--el-color-warning` | 进行中 |
| `--accent` | `--el-fill-color` + `--el-color-primary-light-9` | hover 反馈 |
| `--ring` | `--el-color-primary-light-5` | 焦点环 |
| `--highlight` | **无对应**；建议建项目别名 `--tf-accent-highlight`（否则用 `--el-color-warning`） | LSC 里它是「开关已开启」的统一强调色，el 没有同义项 |
| `--multitrack-*-bg/-border/-text` | **建议不要映射到 `--el-*`**，直接建项目级 `--tf-track-task-bg` 等 | 4 组轨道色是领域色板，与主题无关 |

---

## 6. 续接（continuity）在界面上的呈现

### 6.1 参数面板中的位置与文案

- 字段：`continuity_mode`，类型 `'shot' | 'context'`，默认 `'shot'`（UT:20-21、`types/multitrack.ts:5`）。
- 两处入口，都只在 `format === 'MiniMax'` 时出现：
  1. **TaskSegmentEditor 底部右侧第一个下拉**（`h-8 w-20`，位于参考图像尺寸与任务模式左侧）（TSE:855-882）。
  2. **预览区提示词条内联下拉**（`h-5 w-16`，位于提示词文本与任务模式之间）（PA:1011-1047）。
- 显示条件：
  - TSE 版：`format === 'MiniMax' && (taskIndex > 0 || hasSelectedContinuityTargets)`（TSE:855），即**首段不显示**；但多选时只要选中集合里有非首段片段就显示（TSE:237-240）。
  - PA 版：`format === 'MiniMax' && activeTaskPrompt.index > 0`（PA:1011），同样首段不显示。
- 选项文案（zh）：`shot` = 「分镜」、`context` = 「上下文」（`messages/zh.json:276-279`）；选项渲染用 `multitrackContinuityModes.${mode}`（TSE:877、PA:1040）。
- 提示：只有 Tooltip，内容「选择当前片段开启新镜头，或承接上一片段的上下文。」（zh.json:157；TSE:862-872、PA:1021-1036）。**没有额外图标、没有说明块、没有必填标记、没有红/黄警示**——源码未体现任何视觉告警。
- 继承：新增 task 片段时 `continuity_mode` 从「起始帧更早的前一个片段」继承，取不到则用默认 `shot`（UT:346-362、W:762）。

### 6.2 片段块上有没有衔接标记

**没有。** 全部轨道组件与片段块组件中不存在衔接相关的连线、箭头、徽标或差异化配色：片段块样式仅由 `trackType` 决定（`STY:68-73`），片段的 `color` 也取自轨道色（W:759）；`continuity_mode` 除两处 Select 外没有任何渲染消费者（全仓检索仅命中 `types/multitrack.ts`、`PreviewArea`、`TaskSegmentEditor`、`UT` 与 `ProjectVideoCombineWidget`）。→ 此项**源码未体现**（可作为缺口记录）。

唯一的相邻提示是 task 片段标题里的「模式」二字（如「片段 2 参考生视频」），且标记数 >0 时连序号都省略（SB:157-163、TA:695）。

### 6.3 `TaskSegmentEditor.tsx:457` 首段强制 shot 的界面表现

- 代码事实：`handleDropdownContentChange` 在多选（`selectedSegments.length > 1`）时批量写 patch；若 patch 带 `continuity_mode`，则**对「起始帧最小的那个片段」把 `continuity_mode` 覆写回 `MULTITRACK_DEFAULT_CONTINUITY_MODE`（`shot`）**，其余片段按原值写入（TSE:449-461，`firstTaskSegmentId` 定义见 TSE:237-239）。
- 界面表现（事实）：
  1. 单段编辑：`handleDropdownContentChange` 因 `selectedSegments.length <= 1` 只调 `onContentChange`，**不做首段覆写**（TSE:450-453）。但该下拉在首段本就不渲染（TSE:855），所以单段时首段没有入口。
  2. 多选编辑：下拉出现（只要选中有非首段），改值后所有被选片段一起变；**首段仍停留在 `shot`**。界面上没有提示、没有禁用项、没有「首段不可改」的灰态——用户看到的是「我选了 X，但首段还是分镜」，下拉值回读为 `shot`（TSE:227、TSE:857）。
  3. 该约束只在「多选批量改」这条路径上生效；源码未体现对持久化数据的强制归一化（`normalizeContinuityMode` 只做合法值兜底，UT:336-338）。
- 生成侧语义（供对照，不在本文件范围内）：zh 提示词「衔接模式」在 UI 上只表达「新镜头 / 承接上一片段上下文」，无更多解释。

---

## 7. 源码未体现 / 缺口清单

- 轨道头部无「名称」文本、无「锁定」按钮、无「音量」滑杆；锁定仅存在于音频片段的 `audio_locked`（SB:551-578）。
- 片段块上无 continuity 视觉标记（见 6.2）。
- 无「未选中但有多个候选视频」的切换控件：`activeVideo` 只按轨道顺序取第一个命中片段（UT:1025-1036）。
- 无独立播放速率控制（倍速）：`content.speed` 字段存在（`types/multitrack.ts:55`），但多轨 UI 中没有渲染入口。
