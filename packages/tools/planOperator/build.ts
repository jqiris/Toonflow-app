import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "planOperator",
  displayName: "资产卡与多轨校验",
  description: "解析资产卡、结算参考接线，对资产索引、多轨工程与画布快照执行 V1–V16 确定性校验，并支持多轨工程范围读写、逐镜派工清单、画布装配计划与合成清单导出。",
  prompt: `资产卡、参考接线、多轨工程与派工单一律经 planOperator 校验，不靠模型自觉。
parse 把资产卡 Markdown 解析成卡数组；resolve 结算三级参考接线并产出 plan/assetIndex.json 的结构；validate 只读、零写入，返回 findings。
快照必须完整：getCanvasNodes 有分页与截断，total/truncated 不完整时工具直接报错，不拿半份快照出结论。
build 只在 validate 的 error 清零后写入 plan/assetIndex.json 与 plan/assetReport.json。
mtrackRead 按 from/to 范围读 plan/story.mtrack（含端点，missing 不整体报错）；mtrackUpdate 只回写 status/nodeId/assetPath/attempts 四个生成侧字段，并原子替换整份文件，seconds/prompt/referenceIds/continuity 等真源字段归多轨编辑器与对话所有、工具禁写；回写前用 mtrackRead 的 updatedAt 作 expectedUpdatedAt 做乐观并发。
dispatch 按起止分镜号返回逐镜派工清单（提示词、参考计划、生成参数待 node:getConfig 决定、当前状态）；assemble 返回画布装配计划（资产节点分层 + 参考连线 + 片段节点 + connectOrder）。
composite 取 plan/story.mtrack 中 status 为 accepted 的片段（按文件内原始顺序，即合成顺序），复核 V14 只含 accepted 且连续无空洞，并逐段校验 assetPath 真实可读；默认（execute=false）只返回清单不落盘，execute=true 才经宿主 ffmpeg 执行 concat 拼接成 plan/composite.mp4，成功后写 plan/composite.json（executed:true）。执行前逐段 ffprobe 实测尺寸/帧率/像素格式/音轨参数，任一段与首段不一致直接报错挡在编码之前（concat 滤镜要求全段一致，否则必然失败或成片错乱）；声明 seconds 与实测时长相差超过 1s 记规格提示、不拦执行。输出目录需已存在，本工具不创建目录；输出文件已存在时报错，不自动重命名、不覆盖。composite 需要宿主 ffmpeg 已就绪（插件市场已配置 ffmpeg 工具）。
状态查询纪律：node:getGenerationStatus 的 idle 只表示本次打开节点后未发起生成，idle 不表示没有历史输出；跨轮或换会话前必须先用 getCanvasNodes({ fields: ["outputs"] }) 读该节点已产出的媒体，不能用 idle 推断未生成。
本工具只做解析、结算、校验、多轨回写与计划产出：dispatch 只出清单、assemble 只出装配计划、composite 默认只出合成清单，生成与画布落盘由 agent 走画布工具（addNodes/connectNodes）与 nodeTools 执行；工具自身不执行生成、不连接画布节点、不调用供应商。`,
  author: "Toonflow",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  configRules: [
    { type: "switch", field: "allowBuild", title: "允许写入派生文件与多轨回写", value: true, info: "允许在 validate 的 error 清零后写入 plan/assetIndex.json 与 plan/assetReport.json，并允许 mtrackUpdate 回写多轨工程、composite 写 plan/composite.json 与执行合成；关闭后只剩 parse、resolve、validate、mtrackRead、dispatch、assemble 六个只读动作。" },
  ],
}, import.meta.url);
