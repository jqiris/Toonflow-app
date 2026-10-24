# 链路审计 A：planOperator 动作端到端实跑记录（2026-10-24）

> 审计方式：临时工作区 `%TEMP%\mtrackFlowProbe\`（探针脚本直接 `import packages/tools/planOperator/src/index.ts` 的 `plugin.createTools({ allowBuild:true })` 出口，`ToolFiles` 用 node:fs stub 指向临时目录），逐动作实跑并记录原文输出；跑完即删，仓库零改动（`git status` 已复核）。未碰 `C:\workspace\film-maker\video-creator\南柯一梦` 与 `data/`。
> 输入：2 卡资产稿（人物 C01 + 场景 SC02，含缺失目标变体）+ 2 镜工程（referenceIds / continuity(shot+context) / mode / prompt 三段全）。
> `composite execute=true`（ffmpeg）与 `dispatch 真实生成` 不在本审计范围（任务只要求 execute=false 与出清单）。

## 一、结果总表

| 阶段 | 动作 | 结果 | 证据（入口 + 输出摘要） | 失败/缺口根因（path:line）与归属 |
| --- | --- | --- | --- | --- |
| 卡解析 | `parse`（传 markdown） | ✅ 通过 | 2 卡字段齐全：`id=C01/SC02, kind=character/scene, ratio=9:16(段标题继承), order=1/2, prompt 非空, line=3/7`，warnings=[]，duplicates=[] | — |
| 参考结算 | `resolve`（读盘 path） | ⚠️ 通过但**告警不进 content** | 合规文件出 assetIndex-v1 结构；坏卡（KF03 声明 `结构参考：C99`）→ content 与 details 均无告警；真缺失同前缀目标（SC02 声明 `空间参考：SC99`）→ `details.resolved.warnings=[{code:"missingTarget",…SC99…}]`，**content 文本不含**（`index.ts:215-223`：content 只序列化 index，warnings 只在 details） | 缺口 F1：MCP/模型通道只见 content → 结算告警对 agent 隐形。归属：代码（content 尾附 warnings 一行）或文档（runbook 明写「resolve 后必须读 details.warnings」）；另 前缀不符声明被 `referenceResolver.ts:75-79 explicitCandidates` 静默丢弃、零告警（F2a，同属结算层可见性） |
| 校验 | `validate`（合规盘） | ✅ 通过 | `{errors:0,warnings:0,mtrackClips:2}` | — |
| 校验（违规） | `validate`（内联造违规） | ✅ 拦截，报错可读 | 7 条 error：`[V8] 图片参考 5 个，超过上限 4`、`[V13] 引用了不存在的资产：C03/C04/C05`、`[V14] 合成清单不连续：S002 之后是 S004`、`[V13] S004 标为 accepted 却无 nodeId/assetPath`——文案含定位与修法，agent 可直接处置 | — |
| 校验（盲区） | `validate`（resolve 被丢声明的坏卡） | ❌ **工具问题 F2**：漏报 | SC02 声明不存在的 SC99：`validate`+该卡文件 → `{errors:0,warnings:0}`，`build` 静默通过落盘（探针 5） | 根因：validate 只取 `resolved.cards` 的 refs（`index.ts:228-236 → parsedToLite/resolvedToLite`），`resolveReferences` 把 missingTarget/前缀不符**从 refs 里丢掉**（`referenceResolver.ts:144-146/:75-79`），resolved 里不再存在 → V2（`planValidator.ts:105-112`）查不到；warnings 也未并入 findings。归属：**代码**——建议 build/validate 把 `resolved.warnings` 并入 findings（missingTarget 至少 error 级，否则 build 门形同虚设） |
| 校验（死规则） | `validate`（首镜 continuity=context） | ❌ **工具问题 F4**：V11 首镜规则永不触发 | 内联 `mtrack.clips[0].continuity="context"` → 不报「首镜不得承接」，因为 `loadMultitrack` 先过 `normalizeProject`（`index.ts:585`），归一强制 `index===0 → "shot"`（`planOperator/mtrackProject.ts:128`），`planValidator.ts:164-165` 拿到的是已被改好的值，探针里改出的只有 V7 越界 | 行为本身安全（归一兜底与编辑器同口径），但校验文案成死码、agent 误以为被检查过。归属：**文档**（写明「首镜 context 由归一兜底，不经 V11 报错」）或代码（校验用未归一输入） |
| 建工程 | `build` | ✅ 通过 | 落 `plan/assetIndex.json`（assetIndex-v1，nodeId 全 null——契约如此，回填在画布装配侧）+ `plan/assetReport.json`；有 error 时拒绝并逐行列出（V4 案例：`build 被拒绝：仍有 1 条 error 级发现 [V4] 构图卡 KF03 没有任何母版参考`） | — |
| 工程读 | `mtrackRead` | ⚠️ 通过但**丢 mode**（F3） | 范围读正常、missing 尾行不整体报错；t6 新字段 `name`/`systemPromptOverride` 回读正常；但工程里写了 `mode:"ref"` 的 S001，返回键清单无 `mode` | 根因：planOperator 镜像 normalize 未透传 mode（`planOperator/mtrackProject.ts:113-134` 无 mode 白名单；nodeShared 版有 `mtrackProject.ts:235`）——两份镜像漂移。归属：**代码**（补一行 `...(item.mode==="ref"||…) ? {mode}`）。仅影响读视图：`mtrackUpdate` 原地 patch 磁盘原文，mode 不落盘丢失（探针 4 实测 patch 后磁盘 mode/systemPromptOverride 原样保留） |
| 状态回写 | `mtrackUpdate`（错误 updatedAt） | ✅ CAS 拒绝 | `mtrackUpdate 冲突：多轨工程已被其他操作修改（expected 1970-…，实际 ），请重新读取后重派`——expected/actual 都带上，可直接处置 | — |
| 状态回写 | `mtrackUpdate`（合法） | ✅ 通过 | `{updated:["S001"],missing:[]}`，新 `updatedAt` 落盘；未命中 `S900` → `{updated:[],missing:["S900"]}` + 尾行「未命中分镜：S900」不硬失败 | — |
| 写保护 | `mtrackUpdate`（status=accepted） | ✅ 拒收 | `ZodError … invalid_value … expected one of "pending"|"generating"|"generated"|"failed"`（strict enum `index.ts:110`）——agent 无法代写验收，契约防线实装 | — |
| 派工清单 | `dispatch`（from+to） | ✅ 通过 | 逐镜清单：prompt 三字段、referencePlan（name/kind/textOnly/nodeId，build 后的 index 全部命中）、generationParams 占位「待 node:getConfig 决定」（不写死模型，纪律内建）；indexPath 指向缺失文件 → 尾行 `参考结算缺 C01（建议先跑 resolve/build）` 可读 | 备注：`nodeId:null` 是 planOperator 从不回填的既有契约（`directDispatch.ts:325-328` 注释），由装配侧补，非缺陷 |
| 合成清单 | `composite`（无 accepted） | ✅ 必须报错——确实抛错 | `没有 accepted 片段可合成：请先在多轨编辑器里把要合成的片段验收为 accepted`（`composite.ts:181-183`） | — |
| 合成清单 | `composite`（execute=false，2 镜 accepted + 假产物文件） | ✅ 通过 | 返回 `{manifestPath:"plan/composite.json",output:"plan/composite.mp4",executed:false,segments:[S001,S002]}`；清单落盘内容与返回一致（version:1、executed:false、两段 assetPath 可读校验通过——假文件存在即过，真实 ffprobe 在 execute=true 路径） | — |

## 二、区分

- **我造的输入不合规（工具按预期拦截，非缺陷）**：validate 违规轮（V8/V13/V14 三处故意造坏）、build 拒绝轮（KF03 无参考）、CAS 拒绝轮、accepted 写拒轮、composite 无 accepted 轮。
- **工具自身问题（本审计发现）**：
  - **F1（可见性）**：`resolve` 的 missingTarget/backwardsOnly/identityConflict 告警只在 `details`，content 文本不含——走 MCP 文本通道的 agent 看不到。轻修：content 尾附告警行（dispatch/composite 已有尾行先例，`index.ts:412-414/:527-528`）。
  - **F2（校验盲区，最重）**：资产卡声明了不存在的目标（同前缀）时，resolve 丢声明 → validate `0 errors` → **build 静默通过**。参考接线类错误能带病落盘 assetIndex。根因 `referenceResolver.ts:144-146` + `index.ts:228-236`（resolved.warnings 未进 findings）。
  - **F2a**：前缀不符的声明（KF 卡写 `结构参考：C99`）连告警都没有，被 `explicitCandidates` 过滤器静默吞掉。
  - **F3（镜像漂移）**：planOperator `normalizeProject` 丢 `mode` 字段透传（nodeShared 有），`mtrackRead` 返回不完整 clip（磁盘原文不受影响）。一行修。
  - **F4（死文案）**：V11「首镜不得承接」经 normalize 兜底后永不触发，validate 文案给 agent「查过了」的错觉（行为安全，文档需纠偏）。

## 三、总判

**这条 agent 编排链路在当前字节上能走通**：parse → resolve → validate → build → mtrackRead → mtrackUpdate（含 CAS/写保护）→ dispatch → composite 九个动作全部实跑成功，报错文案可处置、防线（build error 门、accepted 禁写、V14 断点、无 accepted 拒合）真实生效；断点不在「跑不动」，而在**告警可见性与校验盲区**——按技能包走会让「参考目标写错」的资产稿静默过 build（F2），并可能漏读 resolve 告警（F1）。修复优先级：F2（一行把 resolved.warnings 并进 findings）> F1（content 尾附告警）> F3（mode 透传补镜像）> F4（文档写明归一兜底）。
