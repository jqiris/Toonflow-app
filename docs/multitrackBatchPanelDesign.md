# 批量生成面板 · 最小可行设计

> 依据：`docs/multitrackGapAudit.md`（t1）§2.2 / §2.3 / §4 第 1 项；参考实现 LocalStoryCanvas（下称 LSC）。
> 性质：设计文档，不含实现代码，不改业务代码。
> 目标：让实现方按本文就能写出面板，不需要自行发挥；同时把「必须一起改的底层」和「明确不做的」钉死。

---

## 0. 一句话方案

在 `dispatchBar.vue` 旁边加一个按钮「批量生成…」，打开新组件 `batchPanel.vue`（Element Plus 对话框）：上半部是**范围（起始分镜 + 生成镜数）+ 开始/暂停/继续/取消**，下半部是**逐镜进度表**（镜号/标题/状态/耗时/错误）。所有生成仍然走 `launchDispatch → beginDirectDispatch` 这条既有链路，**不新增生成路径、不改工程 schema、不落盘队列**；只给 `directDispatch.ts` 加一个「本镜结束后暂停」的闸门和两个钩子。

---

## 1. 面板入口与形态

### 1.1 放哪

| 项 | 决定 |
|---|---|
| 新组件 | `packages/nodeShared/src/mtrack/components/batchPanel.vue`（小驼峰文件名） |
| 挂载位置 | `multitrackEditor.vue` 模板内、`<dispatchBar>` 之后（`multitrackEditor.vue:28-36` 之后），`v-if="bound"` 区间内 |
| 触发 | `dispatchBar.vue` 新增按钮「批量生成…」，`@click="emit('openBatch')"`；由 `multitrackEditor.vue` 用 `batchVisible = ref(false)` 控制 `v-model` |
| 为什么放 nodeShared | 编辑器被两处复用：画布节点（`packages/nodes/multitrackNode/src/index.vue:31` teleport）与文档面板扩展（`packages/ext/multitrack/src/index.vue:2`）。放 nodeShared 两边同时获得，不需要各写一份 |

### 1.2 与现有「生成选中段」的关系：**并列，不替换**

理由（三条都要成立才敢并列）：
1. 「生成选中段」（`dispatchBar.vue:9`）是**零摩擦快路径**，且已被命令式 `node:dispatchGenerate`（`multitrackNode/src/index.vue:370-391`）与 `packages/skills/assetCard/references/generationRunbook.md` §十五 逐字记录。删掉它等于让文档与节点函数失真。
2. 两者的**内核是同一个函数**：面板的「开始」最终也调 `launchDispatch(clipIds)`。面板不是第二条生成路径，只是范围/进度/暂停的外壳。
3. 分工清晰：轨道上已选好就直接点「生成选中段」；要按「从第 N 段起 M 段」跑、要看逐镜进度、要中途暂停，就开面板。

### 1.3 形态

- Element Plus `<el-dialog>`，`width="min(880px, calc(100vw - 32px))"`，`alignCenter`、`appendToBody`、`:closeOnClickModal="false"`（生成中误点遮罩不该关掉面板）。
- **必须 `appendToBody`**：多轨编辑器可能整个被 teleport 进全屏遮罩（`multitrackNode/src/index.vue:49-57`），不 append 会被父级 `overflow: hidden` 裁掉。
- 关闭对话框**不中断生成**：`dispatching` 仍在后台推进，重新打开面板仍能看到进度（数据全部来自 `clips`，不来自对话框自身状态）。
- 生成中关闭时 `:closeOnPressEscape="false"`，只留右上角关闭按钮，避免误关。

### 1.4 组件契约（props / emits 全部小驼峰）

```ts
// batchPanel.vue
defineProps<{
  visible: boolean;                 // v-model:visible
  clips: MtrackClip[];              // 全量工程镜头（进度表按批次过滤，不在这里过滤）
  selectedClipIds: string[];        // 打开时用于预填范围
  batchId: string;                  // activeBatchId，空串 = 没有批次
  running: boolean;                 // dispatching
  paused: boolean;                  // batchPaused
  skippedCount: number;             // 与 dispatchBar 同源
}>();

defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "start", payload: { start: number; count: number; includeFinished: boolean }): void;
  (event: "pause"): void;
  (event: "resume"): void;
  (event: "retry", payload: { clipId: string }): void;
  (event: "cancel"): void;
}>();
```

面板**不持有业务状态**：范围输入、`includeFinished` 是面板内本地 `ref`；批次状态一律由 props 传入（唯一真源在 `multitrackEditor.vue`）。这样关闭再打开、切换面板不会出现两套状态。

> 面板不 import `directDispatch`，不碰画布桥——它只发事件。

---

## 2. 范围选择

### 2.1 控件

| 控件 | 类型 | 约束 | 说明 |
|---|---|---|---|
| 起始分镜 | `el-input-number` | `min=1` `max=clips.length` `precision=0` | **1-based 段号**，与 LSC `native-h3-scene.js:1348`「从第几个镜头开始」一致；内部换算成 `clipId` |
| 生成镜数 | `el-input-number` | `min=-1` `max=clips.length` `precision=0` | `-1` = 到最后一镜（LSC 文案「生成镜头数（-1表示到最后）」） |
| 快捷预设 | 三个 `el-button` | — | 与 LSC `native-h3-scene.js:1144` 同三档：「全部镜头」= `start 1 / count -1`；「当前镜头」= `start 当前选中段号 / count 1`；「从当前到最后」= `start 当前选中段号 / count -1`。三档都只是给上面两个数字赋值（LSC `:1202-1203` 同样如此），不引入第二套范围状态 |
| 包含已生成 | `el-checkbox` | 默认 false | 与 `dispatchBar.vue:6` 同语义，面板内复用一个，两边 `v-model` 指向同一个 `includeFinished` |

### 2.2 与「勾选多选」的优先级（唯一规则）

> **面板打开时，用当前选段预填；之后面板内的「起始 + 镜数」是唯一真源。**

- 打开面板那一刻：若 `selectedClipIds` 非空 → `start = 首选中段序号`、`count = 选中段数`；否则 `start = 1`、`count = -1`。
- 预填**只发生一次**（`watch(visible, 打开瞬间)`），之后用户手动改数字不回写选区，选区变化也不覆盖用户已改的数字。
- 面板内不再读 `selectedClips`。轨道上的勾选只在点「当前镜头 / 从当前到最后」两个快捷预设时才再次进入面板（与 LSC `:1199-1203` 一致：preset 只是给 `v.start/v.count` 赋值）。
- 提交时把 `{start, count}` 换算成 `clipId[]`，交给 `launchDispatch(clipIds)` —— 与勾选路径汇合到同一入口。

这样避免 LSC 没有的歧义（LSC 的 `v.start/v.count` 也是纯数字真源，`native-h3-scene.js:1202-1203` 的 preset 只是给数字赋值，不并行维护选区）。

### 2.3 范围校验（对齐 LSC `native_h3_run_range.py:6-17`）

提交前在 `multitrackEditor.vue` 里做，**只校验范围内**：

1. `1 <= start <= clips.length`，且 `count === -1 || count >= 1` → 否则「起始段或生成段数无效。」（逐字对齐 `native_h3_run_range.py:7-9`；LSC 允许 `-1` 与 `>=1`，`0` 与 `<-1` 一律拒）
2. 范围内缺提示词的镜头：→ 「第 3 段缺少提示词。本次范围以外的镜头无需补填。」（逐字对齐 `:14-17` 的文案）。**差异说明**：LSC 遇到第一个缺失就抛错，只报一个段号；我们一次列出范围内**全部**缺失段号（`第 3、7 段缺少提示词。…`），文案其余部分不变——用户一轮就能补齐，不用反复点。
3. 范围内可派镜头为 0（全 `generated`/`accepted` 且未勾「包含已生成」）→ 沿用既有文案「选段内没有可生成的分镜，可勾选「包含已生成」后再试」
4. 无工作目录 → 沿用「当前没有工作目录，无法发起生成」

第 2 条是**新增能力**：现在 `directDispatch.ts:245` 是在逐镜循环里抛「该镜没有提示词，请先补全画面描述」，被 catch 后只把那一镜标 `failed`、循环继续（`:256-259`）。面板要把它提前成一次可读的范围校验，避免「跑到第 7 镜才发现少一段提示词」。

> 与 LSC 的一处**已知口径差**：LSC 的判据是「本镜 `prompt` 非空 **或** 项目 `common_prompt` 非空」（`native_h3_run_range.py:15-16`）。我们这边 `global.style` / `global.systemPrompt` **目前不参与生成**（audit §2.7），所以回落不成立，判据只能逐镜看三字段。等 P0-4 让 global 真正进 `buildPrompt` 之后，这里要同步改成「逐镜三字段非空 **或** `global.style` 非空」。

实现位置：`packages/nodeShared/src/mtrack/mtrackProject.ts` 新增一个纯函数（6 行，可被面板、编辑器、将来 reconcile 复用）：

```ts
/** 提示词三字段全空即视为缺失：面板范围校验与逐镜派工共用同一判据。 */
export function hasPrompt(clip: MtrackClip): boolean {
   const { detailedDescription, overallSoundscape, nonDiegeticMusic } = clip.prompt;
   return Boolean(detailedDescription.trim() || overallSoundscape.trim() || nonDiegeticMusic.trim());
}
```

> 判据对齐 `directDispatch.buildPrompt`（`:83-96`）：三字段 trim 后全空 → 拼出空串 → 那里才抛错。所以「任一字段非空」= 可生成。

---

## 3. 逐镜进度展示

### 3.1 表格列

| 列 | 数据来源 | 说明 |
|---|---|---|
| 镜号 | `clips` 数组下标 +1，`clip.clipId` | 显示 `3 · S003`，与轨道序号（`trackBar.vue:16`）一致 |
| 标题 | `clip.title` | 空则回落 `clip.clipId` |
| 状态 | `clip.status` + `clipStatusLabels`（`mtrackProject.ts:86-92`） | 五态原样展示：待生成/生成中/已生成/已验收/失败 |
| 耗时 | 见 3.3 | 生成中为实时递增，终态为定格值 |
| 错误 | 本批 `attempts` 里最后一条 `failed` 的 `error`，剥掉 `batch:<id> ` 前缀 | 无错留空；剥前缀用 `error.slice(marker.length).trim()` |

行数据一律从 `clips` 派生（`computed`），**不新建状态容器**——这样面板关掉、编辑器刷新、`mtrackRead` 读盘，看到的都是同一份真源。

### 3.2 批次过滤（关键细节）

批次归属靠 `attempts[].error` 里的标记（`multitrackEditor.vue:621` 的 `marker = "batch:" + batchId`）。**四类写入的形态不同，匹配必须写对**：

| 钩子 | 写入的 `attempts[].error` | 出处 |
|---|---|---|
| onStart | `"batch:<id>"`（等值） | `multitrackEditor.vue:634` |
| onSucceeded | `"batch:<id>"`（等值） | `:637` |
| onFailed | `"batch:<id> <错误原文>"`（前缀 + 空格） | `:640` |
| onCancelled | `"batch:<id>"`（等值） | `:689` |

判据（面板与编辑器共用，建议在 `multitrackEditor.vue` 内抽一个 `attemptsOfBatch(clip, batchId)`）：

```ts
const marker = `batch:${batchId}`;
const mine = clip.attempts.filter(a => a.error === marker || a.error?.startsWith(`${marker} `));
```

**不要用 `includes(marker)`**：`batch:ab` 会误匹配 `batch:abc`。这与 `generationRunbook.md` §十五 记录「源码原文是 `error 等于`，不是包含匹配」同一条纪律。

### 3.3 耗时怎么算（不新增字段）

同一镜同一批次的 attempts 顺序固定为 `generating → succeeded|failed|cancelled`。**注意取最后一条而不是第一条**：暂停→继续沿用同一 `batchId`（§4.1），同一镜可能出现两轮 `generating`：

```ts
const mine = attemptsOfBatch(clip, batchId);          // 见 3.2，已按批次过滤
const startAt = mine.findLast(a => a.status === "generating")?.at;
const endAt   = mine.findLast(a => a.status === "succeeded" || a.status === "failed" || a.status === "cancelled")?.at;
const elapsed = endAt ? Date.parse(endAt) - Date.parse(startAt) : Date.now() - Date.parse(startAt);
```

- `findLast` 需要 ES2023 目标；若 `tsconfig` 的 `lib` 不含它，用 `[...mine].reverse().find(...)` 等价替代（不引依赖）。
- 只在面板打开且 `running || paused` 时启 1s interval 刷新 `now`，`onBeforeUnmount` / `visible=false` 清掉。
- 格式化 `mm:ss`；超过 1 小时显示 `超时`（对应 `directDispatch.ts:26` 的 1 小时上限）。`startAt` 缺失（attempts 里没有 `generating`）时耗时列显示 `—`。

### 3.4 顶部汇总行

`第 i/N 镜 · 正在生成`（LSC `scene_video_jobs.py:299` 文案口径）+ `<el-progress :percentage="done/total*100">` + `本批剩余 K 镜`。

- `i` = 当前 `generating` 的那一镜在批次内的序号；`N` = 批次镜头数。
- `done` = 批次内 `status ∈ {generated, accepted}` 的镜数。
- 暂停态文案：`已在镜头间暂停，已完成镜头保留。`（对齐 `scene_video_jobs.py:294`）。
- 无批次时：`未开始。设置范围后点「开始生成」。`

---

## 4. 五个操作落到哪里

| 操作 | UI 触发 | 落到哪 | 新增/复用 |
|---|---|---|---|
| **开始** | 面板「开始生成」 | `multitrackEditor.vue` 新增 `startBatch(payload)` → 范围校验 → `launchDispatch(clipIds, { includeFinished, batchId? })` | **复用**既有 `launchDispatch`（`:612-657`）与 `beginDirectDispatch` |
| **暂停（本镜结束后停）** | 面板「本镜结束后暂停」；仅在 `running` 时出现 | `multitrackEditor.vue` 新增 `pauseBatch()` → 调 `handle.pause()`（新）→ `batchPaused = true`；`directDispatch` 在**镜头之间**检查闸门后退出循环并回调 `onPaused` | **新增** `DispatchHandle.pause()` + `ClipHooks.onPaused` |
| **继续** | 面板「继续」；仅在 `paused` 时出现 | `multitrackEditor.vue` 新增 `resumeBatch()` → 取本批未终态镜 → `launchDispatch(remaining, { includeFinished: true, batchId })`（**沿用同一 batchId**） | **复用** `launchDispatch`，仅加一个可选 `batchId` 参数 |
| **单镜重试** | 进度表每行右侧「重试」；`running` 或 `paused` 时禁用（见 §4.3 说明） | `launchDispatch([clipId], { includeFinished: true })` → 新批次 | **复用**，零新增 |
| **整批取消** | 面板「取消整批」；`batchId` 非空即可用（含暂停态） | `launchCancel(batchId)` | **复用**（`:663-702`，已含 abort + 逐镜 `node:cancelGeneration` + 回写 `pending`） |

### 4.1 「继续」为什么沿用同一 batchId

- `attempts` 的 marker 不变 → 进度表不用合并两段批次历史，取消也只针对一个 id。
- `activeBatchId` 不变 → 面板重开、`node:getStatus` 的 `batchClipIds` 都还能找回同一批。
- 代价：`launchDispatch` 多一个可选参数（3 行）。比起「暂停=结束旧批 + 继续=开新批」需要合并两条 attempts 流，这个代价更小。

### 4.2 「继续」的剩余集怎么取

```
remaining = 本批范围内、attempts 命中 marker、且 status ∉ {generated, accepted} 的镜
```

- `status === "generating"` 的镜（暂停时正在跑的那一镜已完成，理论上不会有；但进程被杀会残留）→ 纳入，`ensureNode` 会复用同一 `nodeId`（`directDispatch.ts:121`），等于对同一节点再发一次 `node:generateVideo`。
- `failed` 的镜**默认不纳入**继续（失败多是提示词/参数问题，自动重试只会再失败一次）。要重跑走行内「重试」。
- 若 `remaining` 为空 → 提示「本批已没有待生成镜头」并把批次置为完成。

### 4.3 按钮可见性矩阵

| 批次状态 | 开始 | 本镜结束后暂停 | 继续 | 取消整批 | 行内重试 |
|---|---|---|---|---|---|
| 无批次（`!batchId`） | ✅ | — | — | — | ✅ |
| running（`dispatching`） | — | ✅ | — | ✅ | — |
| paused（`batchPaused`） | — | — | ✅ | ✅ | — |
| 已结束（有 `batchId`、非 running、非 paused） | ✅（开新批） | — | — | ✅（清掉残留 id） | ✅ |

> **暂停态为什么禁用行内重试**：`launchDispatch` 只有一个 `activeBatchId`（`multitrackEditor.vue:549`），重试会开新批次并覆盖它 → 暂停中的那一批再也找不回来（`batchClipIds`、取消都指错批）。所以暂停态只能「继续」或「取消整批」；要单镜重试，先继续、或先取消。

> 「已结束仍有 batchId」是既有行为：`finishDispatchRun`（`:580-585`）只复位 `dispatching`，不清 `activeBatchId`；只有 `launchCancel`（`:695`）和 `handle.run.catch`（`:647`）会清。面板把「取消」在该状态下当作「清除残留批次号」，不产生画布调用。

### 4.4 `batchPaused` 的生命周期（唯一真源）

| 事件 | `batchPaused` | 说明 |
|---|---|---|
| `startBatch` | `false` | 开新批必须清掉上一批的暂停态 |
| `onPaused` 回调 | `true` | 由 `directDispatch` 在镜间闸门命中时回调 |
| `resumeBatch` | `false` | 继续即恢复运行态 |
| `launchCancel` 成功 | `false` | 取消后没有「暂停中的批次」 |
| `handle.run` 正常结束（非暂停） | 保持 `false` | 已由 `onPaused` 与 `startBatch` 保证 |
| 组件卸载（`onBeforeUnmount`） | 不处理 | 卸载即 abort（`:885-891`），面板随之销毁 |

**不要**用 `dispatching === false && batchId !== ""` 反推暂停：批次正常跑完也是这个组合。暂停是独立布尔，只能由上述四个事件写。

---

## 5. 与 `directDispatch.ts` 现有能力的差距

### 5.1 现有能力盘点（够用的部分）

| 能力 | 位置 | 面板能否直接用 |
|---|---|---|
| 逐镜串行循环 | `dispatchClips` `:237-260` | ✅ 直接用 |
| 单镜失败不阻断、继续下一镜 | `:256-259` catch → `onFailed` | ✅ 直接用 |
| 立即返回句柄、后台跑 | `beginDirectDispatch` `:264-282` | ✅ 直接用 |
| 取消（abort + 逐镜 cancelGeneration） | `beginDirectCancel` `:285-313` | ✅ 直接用 |
| 四类回写钩子 | `ClipHooks` `:211-215` | ⚠️ 缺 `onPaused` |

结论：**hooks 基本够用，只差「暂停」这一维**。

### 5.2 必须新增的导出/改动（共 3 处，约 25 行）

```ts
// 1) DispatchHandle 增加 pause()
export interface DispatchHandle {
  batchId: string;
  run: Promise<void>;
  abort(): void;
  pause(): void;          // 新增：置「本镜结束后停」标志，不中断在跑镜头
}
// 注意：beginDirectCancel 也返回 DispatchHandle（directDispatch.ts:291-312），
// 它的 pause 必须是空实现（取消流程没有「暂停」语义），否则类型不过。
// 若不想污染取消路径，可把 pause 做成可选 `pause?(): void`，
// 但那样调用方每次都要 `handle.pause?.()`——推荐给取消路径返回 `pause: () => {}`，一行。

// 2) ClipHooks 增加可选 onPaused
export type ClipHooks = {
  onStart(clip: MtrackClip, nodeId: string): Promise<void> | void;
  onSucceeded(clip: MtrackClip, nodeId: string, assetPath: string): Promise<void> | void;
  onFailed(clip: MtrackClip, nodeId: string, error: string): Promise<void> | void;
  onPaused?(): Promise<void> | void;   // 新增：循环因暂停闸门退出时调用一次
};

// 3) beginDirectDispatch 返回的句柄带 pause()
```

`dispatchClips` 内的闸门（**只在镜头之间检查，绝不打断在跑镜头**——对齐 LSC：镜间检查在 `scene_video_jobs.py:293-296` 与 `native_h3_scene.py:595-596`，文案「将在当前镜头完成后暂停，不强行中断模型。」在 `scene_video_jobs.py:394-396`、「当前段完成后暂停，保留原生上下文。」在 `native_h3_scene.py:763`）：

```ts
// 闸门由 beginDirectDispatch 创建并传给 dispatchClips，句柄的 pause 闭包持有同一个对象：
async function dispatchClips(options: { ..., gate: { paused: boolean } }) {
  const { bridge, clips, cards, videoModel, hooks, signal, gate } = options;
  ...
  let stoppedByPause = false;
  for (const [index, clip] of clips.entries()) {
    signal.throwIfAborted();
    if (gate.paused) { stoppedByPause = true; break; }   // 新增：只在镜与镜之间
    ...
  }
  // 只在「被闸门打断」时回调；最后一镜跑的过程中按下暂停 → 循环自然跑完，
  // 批次实际已完成，不能报「已暂停」（否则面板显示暂停但没有可继续的镜头）。
  if (stoppedByPause) await hooks.onPaused?.();
}

export async function beginDirectDispatch(options: {...}): Promise<DispatchHandle> {
  const gate = { paused: false };
  const run = dispatchClips({ ...options, gate, signal: controller.signal });
  run.catch(() => {});
  return { batchId: options.batchId, run, abort: () => controller.abort(), pause: () => { gate.paused = true; } };
}
```

要点：
- `gate` 是**普通对象**，不依赖 signal——暂停不是取消，`run` 正常 resolve（不是 reject），因此 `handle.run.catch(...)` 不会误报错误，`.finally(finishDispatchRun)` 照常复位 `dispatching`。
- 暂停后 `batchPaused` 由 `onPaused` 置 true；面板据此切到「继续 / 取消整批」。
- 暂停时**正在跑的那一镜照常跑完并回写 `generated`**——这是 LSC「不强行中断模型」的语义，也是本设计不引入「半截视频」的原因。
- **不新增** `abortAfterCurrent` / `pauseAfterCurrent` 布尔参数：用一个 `pause()` 方法 + 可变闸门，比在 options 里加标志位更容易在「已经开始跑」之后再按下。

### 5.3 编辑器侧需要新增的东西

| 位置 | 新增 | 说明 |
|---|---|---|
| `multitrackEditor.vue` | `batchPaused = ref(false)`、`batchHandle: DispatchHandle \| undefined` | 记住句柄才能 `pause()`；`batchPaused` 必须在**开始新批 / 继续 / 取消**三处显式置 false，否则面板会一直停在暂停态 |
| `multitrackEditor.vue` | `startBatch(payload)` / `pauseBatch()` / `resumeBatch()` / `retryClip(clipId)` | 见 §4 表 |
| `multitrackEditor.vue` | `launchDispatch` 加可选 `batchId`（`options.batchId ?? crypto.randomUUID()`） | 3 行；`batchId` 目前是硬编码 `crypto.randomUUID()`（`:620`） |
| `multitrackEditor.vue` | `attemptsOfBatch(clip, batchId)` 抽成函数，供面板/`launchCancel` 共用 | `launchCancel:682` 现在内联着同样的判据，顺手统一 |
| `multitrackEditor.vue` | `statusSnapshot()` 增加 `paused` 字段 | `:855-877`，让对话侧知道批次是暂停而不是结束；`batchClipIds` 的判据（`:871`）当前只认 `error === batchMarker`，接上面板后要改成「等值或前缀」以覆盖 failed 镜 |
| `multitrackEditor.vue` | `launchDispatch` 的 `hooks` 增加 `onPaused` | `:632-642` 现有四钩子里补第五个：`onPaused() { batchPaused.value = true; }` |
| `multitrackEditor.vue` | `launchDispatch` 里保存句柄 | `:625` `const handle = await beginDirectDispatch(...)` 之后 `batchHandle = handle`，`finishDispatchRun`（`:580-585`）里清空 |
| `dispatchBar.vue` | 一个按钮 + 一个 `emit("openBatch")` | +8 行 |
| `mtrackProject.ts` | `hasPrompt(clip)` 纯函数 | 见 §2.3 |

### 5.4 明确**不需要**改的

- `mtrackEdit.ts` / `validateClip`：范围校验不属于编辑内核。
- `MtrackProject` / `MtrackClip` schema：**不加 `batchId` 字段**（`generationRunbook.md` §十五 明确：批次号只记在 `attempts[].error`，不许新增字段）。
- `planOperator`：面板不碰工具层。
- `multitrackNode/src/index.vue` 的 node 函数：本设计**一个都不改**（见 §6）。后续需求已追加 `node:pauseBatch`/`node:resumeBatch`/`node:retryClip`/`node:rewritePrompt` 四个函数，现为 13 个自注册函数，见 §6 表对应行的更新注记。

---

## 6. 明确不做（YAGNI）

| 不做 | 为什么 |
|---|---|
| 后端 job 队列 / 服务端批次表（LSC 的 `scene_video_jobs` 那一套） | 我们的生成由画布节点持有，供应商任务本来就挂在节点上；再建一层队列要先解决「谁持有轮询」的宿主级问题（audit P1-1），超出面板范围 |
| 跨进程 / 重启恢复（把 `generating` 降级 `paused`） | 这是 audit 的 **P0-2**，需要 `getCanvasNodes({fields:["outputs"]})` 对账，是独立一项；面板只负责「本次打开期间」的暂停/继续 |
| ~~`node:pauseBatch` / `node:resumeBatch` 节点函数~~ **该 YAGNI 结论已被后续需求推翻（2026-10-22 更新）** | 原结论：暂停是人在环的交互（看进度决定停不停），对话侧要停手用既有的 `node:cancelBatch` 就够；多加两个函数等于给 runbook 加两页文档而没有实际调用方。**现口径**：`packages/nodes/multitrackNode/src/index.vue` 已注册 `node:pauseBatch`（软闸门：不 abort 在跑镜头，本镜结束后不再开始下一镜）、`node:resumeBatch`（沿用同一 `batchId` 续跑剩余镜头）、`node:retryClip`（只重试单镜、强制覆盖旧结果）、`node:rewritePrompt`（只调文本模型返回整理稿，不改工程，用户确认后用 `node:editProject` 写回）四个节点函数；本节点现为 13 个自注册函数 + 2 个引用函数 = 15 个 `node:` 函数，runbook §十五·五 已同步 |
| 给 `dispatchGenerate` 加 `count` 参数 | 它已有 `from`/`to`（`multitrackNode/src/index.vue:373-380`），范围语义已覆盖；`count` 是给人输入的便利，不是新能力 |
| 自动合并开关（LSC「完成后自动合并」） | 依赖 audit P0-3 的合成入口，先做面板会把合并链路的坑带进来 |
| 单镜版本历史（LSC `previous_finals` / `history`） | 我们的 `attempts` 只记状态不记产物；做版本要改 schema，属独立需求 |
| `retry-missing`（区分 lost/unknown 后谨慎重提交） | 需要 provider 侧落 jobId（audit §2.8 第 4 点），当前 `freevideo.ts:187-192` 每次新 ref，做不到「找回原任务」 |
| 并发 > 1 | 本机 GPU 串行是既定裁决（`directDispatch.ts:236` 注释 + `multitrackProductionPlan.md` §4.5） |
| LSC 的 seed / frames / quality / sampling / LoRA 参数 | 我们对应 `seconds` / `resolution`，其余在 freevideo 侧不暴露；面板不加没后端的旋钮 |
| 拖拽调序、时间线设置、整理本镜 | 与批量生成无关，属 audit P1-2 / P1-4 |
| 面板内编辑提示词 | 已有 `clipEditor.vue`；面板只读，避免两处写同一字段 |

---

## 7. 落地顺序（给实现方）

1. `directDispatch.ts`：`DispatchHandle.pause()` + `ClipHooks.onPaused` + 循环闸门（约 25 行，可独立提交，先写先测）。
2. `mtrackProject.ts`：`hasPrompt`（6 行）。
3. `multitrackEditor.vue`：`batchPaused` / `batchHandle` / `startBatch` / `pauseBatch` / `resumeBatch` / `retryClip` / `attemptsOfBatch` / `launchDispatch` 的 `batchId` 参数 / `statusSnapshot.paused`（约 120 行）。
4. `batchPanel.vue`：新建（约 180 行，含模板、范围校验调用、进度表、1s 计时器）。
5. `dispatchBar.vue`：加按钮 + emit（8 行）。

### 验收（实现完成后逐条过）

- [ ] 「从第 3 段起 2 段」只跑 S003/S004；S001/S002 缺提示词不报错（对齐 LSC「范围外无需补填」）
- [ ] 范围里缺提示词时，点开始只弹一条「第 N 段缺少提示词…」，**不发起**任何生成
- [ ] 生成中顶部显示「第 2/3 镜 · 正在生成」且进度条随完成数推进；每行耗时实时递增，终态定格
- [ ] 点「本镜结束后暂停」→ 当前镜跑完才停（不出现半截视频），已完成镜 `assetPath` 已落盘
- [ ] 暂停后点「继续」→ 从第一个非终态镜接着跑，**已完成镜不重跑**，`batchId` 不变
- [ ] 行内「重试」只重跑该镜，`attempts` 追加一条且历史保留
- [ ] 「取消整批」在 running 与 paused 两态都可用，取消后镜头回 `pending`、`attempts` 追加 `cancelled`
- [ ] 关闭面板不中断生成；重新打开仍能看到同一批次进度
- [ ] 面板内不出现任何新的工程字段（`git diff` 检查 `mtrackProject.ts` 只多了 `hasPrompt`）

### 遵守的仓库规范（AGENTS.md）

- 新文件 `batchPanel.vue`（小驼峰）；本地绑定名 `batchPanel`、模板标签 `<batchPanel />`（禁止 `<batch-panel />` 与 `<BatchPanel />`）
- `.vue` 顶层顺序 `<template>` → `<script setup>` → `<style scoped>`
- 所有 props/emit 载荷字段小驼峰（`selectedClipIds`、`skippedCount`、`clipId`）
- DOM 类名小驼峰（`batchPanel`、`rangeRow`、`shotTable`、`shotStatus`），SCSS 按 DOM 嵌套
- 自有函数/变量小驼峰（`startBatch`、`pauseBatch`、`resumeBatch`、`retryClip`、`batchPaused`）
