# LSC 多轨编辑器（native_h3_scene.py，原始版本 806 行）核心实现流程

> 源码依据：`C:\workspace\super-ai\LocalStoryCanvas\app\native_h3_scene.py`（2026-10-11，MD5 `369576DF…`）
> 配套：`native_h3_run_range.py`、`native_h3_input_bridge.py`、`templates/Original_01_H3_Multitrack.json`

---

## 一、一句话定位

**它不是「逐镜调视频节点」，而是「把整条时间线作为 `track_data` 交给一个 ComfyUI 多轨编辑器节点，由该节点自己按 `continuity_mode` 去加载上一段的 `context_latent` 产物」。**

文件头注释就是它的设计宣言：

> Each queued segment executes the original project node and loads the previous native AV context artifact.
> **No last-frame substitute and no forced retiming.**
> （每段执行原版项目节点，加载上一段的原生音视频上下文产物。**不用尾帧替代，不强行变速。**）

---

## 二、主流程图

```mermaid
flowchart TD
    A[画布：多轨编辑器节点<br/>连接分镜图 / 资产] --> B[defaults / 导入<br/>建项目 p]
    B --> C{p.segments<br/>每镜字段}
    C --> C1[continuity: shot ｜ context<br/>首镜强制 shot]
    C --> C2[mode: reference ｜ image ｜ text]
    C --> C3[reference_ids: ≤9图 / ≤3音 / ≤3视]
    C --> C4[prompt + system_prompt]

    C1 --> D[validated 校验]
    C2 --> D
    C3 --> D
    C4 --> D

    D --> E[plan_run_range<br/>圈定本批 indices]
    E --> E1[start_mode: auto ｜ shot ｜ context<br/>auto=上下文无效则自动改为独立起拍<br/>context=严格续接，缺上下文直接报错]
    E1 --> F[worker 批次循环<br/>逐段串行，不并发]

    F --> G[execute_segment<br/>第 index 段]
    G --> G1{continuity == context<br/>且 index > 0 ?}
    G1 -- 是 --> G2[context_ok 前置校验<br/>父段有有效 context_latent?]
    G2 -- 否 --> G2E[报错：需要上一段原生上下文<br/>旧版尾帧视频不能冒充上下文]
    G2 -- 是 --> H
    G1 -- 否 --> H

    H[tracks 组装整条时间线<br/>track_data JSON] --> H1[tasks 轨：每镜一个 task segment<br/>task_mode / task_type / continuity_mode<br/>images / user_prompt]
    H1 --> H2[video_0..2 / audio_0..2 参考轨<br/>按 start_frame 对齐]

    H2 --> I[graph_for<br/>把 track_data 灌进模板图<br/>segment_start_number=index+1, segment_count=1]
    I --> J[preflight<br/>校验节点/模型/选项都已安装]
    J --> K[POST /prompt 提交 ComfyUI]
    K --> L[轮询 /history/{prompt_id}]
    L --> M{完成?}
    M -- 否 --> L
    M -- 报错 --> M1[标记 failed，保留 prompt_id，不自动重发]
    M -- 是 --> N[import_artifact<br/>必须同时有 video + context_latent<br/>否则不标记完成]
    N --> O[写 records<br/>generation / signature / context_parent / complete]
    O --> P{还有下一段?}
    P -- 是 --> F
    P -- 否 --> Q{auto_merge?}
    Q -- 是 --> R[merge_files<br/>无损 concat，校验帧数一致]
    Q -- 否 --> S[结束，素材保留]

    R --> S
```

---

## 三、四层核心机制（逐层对应源码）

### 第 1 层：`tracks()` —— 时间线就是载荷（`:294-330`）

每镜变成 `tasks` 轨上的一个 **task segment**：

```python
{'id': s['id'], 'start_frame': offset, 'end_frame': offset + frames,
 'content': {
    'type': 'task',
    'task_mode': 'ref' if mode=='reference' else 'default',
    'task_type': 'r2v' if refs and mode=='reference' else 'i2v' if images else 't2v',
    'continuity_mode': s['continuity'],        # ← 'shot' ｜ 'context'
    'images': images,                          # ← 该镜勾选的全部参考图
    'user_prompt': prompt,
    'system_prompt': system + H3_RULES}}
```

**决定性的设计**：`continuity_mode` 是 task 的**属性字段**，`images` 是**另一个独立字段**。
两者不在同一个槽位上 → **续接与多参考图天然并存**。

参考视频/音频走独立的三条 slot 轨（`video_0..2`、`audio_0..2`），按帧位对齐到镜头区间。

### 第 2 层：`graph_for()` —— 一次只灌一段（`:333-394`）

```python
inputs.update(format='MiniMax', track_data=json.dumps(tracks(p, uploaded)))
cfg.update(segment_start_number=index+1, segment_count=1, seed=seed, ...)
```

整条时间线全量传入，但 `segment_count=1`：**每段单独一次 ComfyUI 提交**，由节点按序号只执行当前段。

### 第 3 层：`context_ok()` —— 续接的真实判据（`:409-432`）

这是整个实现最关键的部分：

```python
keys = ['context_latent'] + (['context_latent_low'] if sampling_mode=='dual' else [])
if not all(边界校验.is_file() for key in keys): return False   # ① latent 文件必须真实存在
if index == 0: return False                                     # ② 首镜不能 context
previous = p['records'].get(parent['id'])
if record.get('context_parent') != {'id': parent['id'],
                                    'generation': previous['generation']}:
    return False                                                # ③ 父段 generation 必须对得上
index -= 1                                                      # ④ 递归向前校验整条链
```

**四点含义**：

1. 续接依赖磁盘上的 `context_latent` 文件，不是尾帧图
2. 首镜永远不能续接
3. 父段重新生成（generation 变化）→ 子段上下文立即失效
4. **递归**校验整条前置链，任一环断了就整体不可用

### 第 4 层：`plan_run_range()` —— 三种起始方式（`native_h3_run_range.py`）

| `start_mode` | 行为 |
|---|---|
| `auto` | 上下文有效就续接，无效就**自动改为独立起拍**（不报错） |
| `shot` | 强制独立起拍（`reset_start=True`） |
| `context` | **严格续接**，上下文缺失直接报错，不降级 |

这让用户可以从中间任意一段开始生成，不必重跑前面全部镜头。

---

## 四、与我们（Toonflow 多轨编辑器）的对照

| 维度 | LSC | 我们（当前） | 差距 |
|---|---|---|---|
| 生成载体 | ComfyUI 多轨编辑器节点，整条时间线作 `track_data` | 服务端 `/api/ai/media/generate` 任务，逐镜提交 | 已对齐（都是整镜一份请求） |
| 续接字段 | `continuity: shot｜context`，task 属性 | `continuity: start｜continue｜cut` | **命名与语义都要改** |
| 续接机制 | 加载 `context_latent` 文件 | `media.first`（尾帧截图） | **机制根本不同** |
| 续接 + 多参考 | ✅ 天然并存（不同字段） | ❌ 互斥（`first` 与 `references` schema 冲突） | **必须改成任务级续接** |
| 上下文失效判定 | generation + 递归链校验 | 无 | **缺失** |
| 起始方式 | auto / shot / context 三态 | 无 | **缺失** |
| 参考容量 | 9 图 / 3 音 / 3 视 | 4 图 / 1 音 / 1 视（产品层限制） | 引擎可到 9 |
| 合并成片 | 无损 concat + 帧数校验 | ffprobe 规格校验 + concat | 基本对齐 |

---

## 五、结论：我们能对齐到哪一层

| LSC 能力 | 能否对齐 | 原因 |
|---|---|---|
| `continuity: shot｜context` 语义与命名 | ✅ | 纯字段改造 |
| 续接与多参考图并存 | ✅ | 用 `continue_from: {from_job}`（任务级），不占媒体槽 |
| 起始方式 auto/shot/context | ✅ | 派工范围逻辑 |
| 首镜强制 shot | ✅ | 校验器 |
| `context_latent` 文件级校验 | ❌ | agent API 不暴露引擎内部产物 |
| 父段 generation 失效判定 | ⚠️ 部分 | 我们能记 job id，但拿不到 latent 文件 |
| 递归链校验 | ⚠️ 部分 | 能校验 job 链，不能校验 latent 存在性 |

**核心待办**：把续接从「`media.first` 尾帧」改成「`continue_from.from_job` 任务级引用」，并把 `continuity` 改名为 `shot｜context`。这样续接与多参考图就能并存——**与 LSC 行为一致**。

前提：需要确认 provider 能回传引擎 `job id`（格式 `j` + 12 hex），否则 `from_job` 无从引用。
