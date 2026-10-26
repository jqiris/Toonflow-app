# LocalStoryCanvas 多轨界面与分镜接入契约

> 任务：t5（重试版）。调研对象 `C:\workspace\super-ai\LocalStoryCanvas`。
> 说明：原任务由 sourceAnalyst 执行，因模型侧 429 连续中断，改由 captain 直接完成并落盘。本文所引均为源码与真实工程数据的**实测内容**，带文件与行号。

---

## 一、多轨界面结构（可直接复刻）

界面实现见 `app/static/js/video-timeline.js:63-77`，是一条横向的「分镜时间线」：

| 区域 | 实际实现 |
|---|---|
| 标题栏 | `N 镜 / X 秒` + 「＋ 添加10秒分镜」 |
| 轨道容器 | `.vt-track { display:flex; gap:6px; overflow-x:auto; padding:12px 0 }` |
| 片段块 | `.vt-clip`，**宽度按时长正比**：`flex-basis: max(100, seconds*13)px` |
| 片段内容 | `<b>序号. 标题</b>` + `<span>起-止秒</span>` |
| 选中态 | `.vt-clip.active { background:#286d62; color:white }` |
| 交互动作 | `select` / `add` / `copy` / `left`（前移）/ `right`（后移）/ `remove` / `undo` |

片段编辑字段（选中的那一个）：

| 字段 | 控件 | 约束 |
|---|---|---|
| 镜头名称 | input | maxlength 120，默认「分镜N」 |
| 本镜时长 | number | **1–15 秒**，step any |
| 衔接方式 | select | `承接上一镜尾帧` / `独立镜头 / 使用公共素材` |
| 本镜提示词 | textarea | maxlength 20000，留空则沿用公共提示词 |

附加能力：
- 全项目系统提示词 + 仅本镜覆盖（maxlength 30000）；
- 「整理本镜提示词」调用 Agent 重写，**保留原文、结果默认不采用**，需勾选才生效；
- 一键「读取内置模板与本机 LoRA」（LSC 专属，Toonflow 不移植）。

关键提示语（值得抄进 Toonflow 的文案）：
> 「当前任务按提交时的快照运行。此处修改仅影响下次生成。」

---

## 二、数据形状（真实工程实例）

来源：`app/data/native_h3_projects/c4ba624640204198a2f4fb6948d0fa7c.json`，67 段。

```jsonc
{
  "id": "156dbb87...",
  "title": "第001段｜8秒",
  "seconds": 8,
  "prompt": "【第001段｜8秒】\n引用资产：C01（淳于棼·人间游侠）；C03（周弁·人间酒友）；...\ndetailed_description: ...\noverall_soundscape: ...\nnon_diegetic_music: ...",
  "continuity": "shot",                 // shot | context
  "mode": "reference",
  "reference_ids": ["h3_asset_0", "h3_asset_2", "h3_asset_4", "h3_asset_15"],
  "system_prompt": "多段视频生成提示词模板 (MiniMax H3 适配版 v3) ... 本段图片引用顺序：<Picture 1> = C01..."
}
```

要点：

1. **提示词六段**（H3 官方口径，LSC 侧历史为三字段变体，本仓库采用六段）：
   - `subject_definitions`：资产定义（被引用主体的身份特征）；
   - `summary`：一段摘要；
   - `retention_analysis`：参考保持分析；
   - `detailed_description`：画面、动作、对白（对白包在 `<d>[Chinese]…</d>`）；
   - `overall_soundscape`：环境声与动作声；
   - `non_diegetic_music`：配乐 / `N/A`。
2. **参考顺序即协议**：`reference_ids` 的数组顺序 = `<Picture 1..N>`，LSC 侧还会在段尾追加一句「本段图片引用顺序：<Picture 1> = C01（…，用途：character）；…」（**LSC 自有写法，本仓库已不采用**：段尾参考顺序声明行已取消，改由写作者按官方六段直接书写正文）。
3. **素材排他**：写了 `<Picture N>` 的资产，正文**禁止**再详细描述其外貌，否则模型会混淆（**LSC 口径**；本仓库不采用——官方 `ref-en.txt` §0/§5.3 要求写出被引用特征，见 assetCard runbook §四）。
4. **说话人 ID**：`(S1)`、`(S2)` 全片唯一，对白必须 `<d>[语言] 内容</d>`。

 > **Toonflow 侧对应（现行口径）**：本仓库多轨工程的参考顺序即 `<Picture N>` / `<Video N>` / `<Audio N>` 的编号来源（同媒质各自从 1 起，取自 `clip.referenceIds` 的过滤位次），对应本仓库侧的 `clip.referenceIds` 顺序与画布 `data.referenceOrder` + 入边顺序；本仓库正文直接书写尖括号标记，不存在旧的双花括号 ref 占位符写法，也没有 wire 层换算通道。

---

## 三、从「资产 + 分镜」到「多轨可生成」

| 步骤 | LSC 做法 | 可复刻性 |
|---|---|---|
| ① 资产定稿 | 资产卡 `C/SC/P/KF/S` + 状态后缀，卡片正文写提示词、参考关系、画幅 | ✅ 已在 `assetCardWorkflowPlan.md` 的 P0/P1 覆盖 |
| ② 分镜定稿 | 分镜稿按 `【第N段｜X秒】` 切段，段内 2–3 片时间切片 | ✅ 纯文本契约 |
| ③ 接入多轨 | 每段 → 一个视频段落节点，秒数、提示词、引用资产一并写入 | ✅ 对应 Toonflow 的「一段一个视频节点」 |
| ④ 参考绑定 | `reference_ids` 顺序 = `<Picture N>`，由程序绑定，正文里不写 Picture 号 | ✅ 对应 `referenceOrder` |
| ⑤ 未完成资产拦截 | 缺前置写 `dependency_error`，不回退成无参考出图 | ✅ 已列为 V4 |
| ⑥ 提交生成 | `duration='timeline'`、`method='segments'`，一次性提交全部段 | ⚠️ Toonflow 逐节点调用，需工具批量编排 |

段内的「时间切片」写法（值得保留）：

| 段长 | 推荐切法 |
|---|---|
| 4 秒 | 0-1.5 / 1.5-3 / 3-4 |
| 5 秒 | 0-2 / 2-4 / 4-5 |
| 8 秒 | 0-3 / 3-6 / 6-8 |
| 10 秒 | 0-3 / 3-7 / 7-10 |

最多 3–4 片；每片只装一个变化；首片定场，末片停在可被接住的中间态。

---

## 四、任务模型与合成

- **提交**：`applyBody` 把 `timelineShots` 转成 `{id, frames, title, prompt, follow_previous}`，配合 `durationResolutionMap` 换算帧数；
- **快照语义**：任务按提交时的数据运行，编辑只影响下次生成；
- **导出**：`MiniMaxTimelineClip { url, name, start, end, duration }` → `export_minimax_timeline` 用 ffmpeg 按 `start/end` 拼成 mp4（`main.py:3064-3073`、`11725+`）；
- **队列**：走 ComfyUI 的 `/queue`，单轨串行，不支持多任务并行采样。

---

## 五、三类划分

| 类别 | 内容 |
|---|---|
| **界面层可直接复刻** | 横向轨道 + 宽度正比片段、选中态、增删排序、每镜时长/衔接/prompt、快照提示文案 |
| **业务规则可复刻** | 段头语法、三字段提示词、参考顺序即协议、素材排他、说话人 ID、时间切片建议、缺前置拦截 |
| **依赖 ComfyUI 不可复刻** | LoRA 选择、调度器、帧数格点 `5+17k`、`object_info` 预检、队列串行语义、`<Picture>` 与 VAE 的绑定方式 |

---

## 六、Toonflow 适配的差异点

| 项 | LSC | Toonflow（FreeVideo / MiniMax-H3） |
|---|---|---|
| 单段时长 | 1–15 秒（节点限制），推荐 4–6 | **2–60 秒逐秒**，更宽 |
| 参考数量 | 由工作流决定 | 图 ≤4 / 视频 ≤1 / 音频 ≤1，超限会被逼到首尾帧模式 |
| 首尾帧续接 | 尾帧续写（latent） | `startFrameOptional`：1 张作尾帧，2 张按序首/尾 |
 | 提示词标记 | `<Picture N>` | `「双花括号 ref 占位符」` |
| 合成 | ffmpeg concat | 同样可 ffmpeg concat，但需统一规格 |

