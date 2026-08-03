# 二次元道具衍生状态生成 · 约束手册

---

## 一、衍生原则

1. **造型锚定** — 道具核心造型/轮廓在所有状态中可识别
2. **状态可读** — 状态差异必须一目了然，观众能立即区分
3. **叙事服务** — 每种状态变体服务于特定剧情节点
4. **渐进退化** — 损伤/老化状态应有合理的物理逻辑
5. **纯道具独立展示** — 画面中只能出现道具本身，严禁出现任何人物、手部、肢体，道具不可处于被持有/佩戴/握持状态，必须以静物陈列方式独立呈现

---

## 二、状态类型

### 2.1 使用状态

| 状态 | 描述 | 适用道具 | 提示词 |
|---|---|---|---|
| 崭新 | 完好无损、光泽如新 | 所有道具 | 崭新、完好无损、光泽如新 |
| 日常使用 | 微磨损、自然包浆 | 办公用品/器具/个人物品 | 日常使用痕迹、自然磨损 |
| 陈旧 | 明显年代感、色泽暗淡 | 生活器物/个人物品 | 古旧斑驳、年代感、色泽暗沉 |

### 2.2 损伤状态

| 状态 | 描述 | 适用道具 | 提示词 |
|---|---|---|---|
| 微损 | 小裂纹/小缺口/轻微磨损 | 玻璃杯/手机屏幕/笔记本 | 细微裂纹、轻微缺口 |
| 破损 | 明显裂缝/断裂/破碎 | 玻璃/陶瓷/塑料 | 裂缝明显、碎裂、断裂 |
| 残片 | 仅剩部分/碎片 | 玻璃/陶瓷/信物 | 残片、碎片、仅存半块 |

### 2.3 特殊状态

| 状态 | 描述 | 适用道具 | 提示词 |
|---|---|---|---|
| 污渍 | 污渍附着/液体残留 | 杯子/衣物/纸张 | 污渍残留、液体痕迹 |
| 指纹 | 手指印、使用痕迹 | 手机屏幕/玻璃杯/金属表面 | 指纹清晰、使用痕迹 |
| 磨损 | 边角磨损、掉漆 | 电子设备/家具/饰品 | 边角磨损、掉漆痕迹 |
| 折叠 | 书卷/纸张折叠痕迹 | 书本/纸张/信物 | 折叠痕迹、折痕明显 |
| 水渍 | 水渍、湿润反光 | 纸张/衣物/布料 | 水渍残留、湿润反光 |

---

## 三、状态变体画面规范

### 单状态图

| 项目 | 约束 |
|---|---|
| 背景 | 纯净中性灰 `#E8E8E8`（与设定图一致） |
| 光线 | 均匀照明，no hard shadows |
| 角度 | 与原设定图front view一致 |
| 比例 | 道具占画面主体 70%+ |

### 状态对比图

| 项目 | 约束 |
|---|---|
| 布局 | 同一画面并排展示 2-3 种状态 |
| 标注 | 每种状态下方标注state name |
| 一致性 | 角度/光线/背景完全一致，仅状态不同 |

---

## 四、材质状态变化规则

| 材质 | 崭新 → 日常 | 日常 → 陈旧 | 损伤表现 |
|---|---|---|---|
| 金属 | 亮光泽 → 微划痕 | 划痕 → 氧化斑点 | 缺口/卷边/断裂 |
| 玻璃 | 通透清晰 → 微划痕 | 划痕 → 裂纹/碎裂 | 裂纹/碎裂/缺口 |
| 木材 | 新木纹理 → 自然包浆 | 包浆 → 色泽暗沉 | 开裂/虫蛀/磨损 |
| 塑料 | 崭新平整 → 微划痕 | 划痕 → 老化变色 | 裂纹/变形/褪色 |
| 纸张 | 崭新平整 → 微折痕 | 折痕 → 发黄变脆 | 撕裂/焦损/污渍 |
| 陶瓷 | 釉面光泽 → 微划痕 | 划痕 → 釉面暗淡 | 裂纹/碎裂/缺口 |

---

## 五、提示词模板

### 单状态变体

Based on {prop name} character sheet,
anime style, cel shading, modern urban style,
cinematic composition, ultra detailed, 8K, high quality,
shallow depth of field, film grain texture, lens vignette,
cel-shaded anime style, modern urban aesthetic, dramatic low-key lighting,
prop derivative design sheet, item concept art, no people, no characters, no human figures,
{prop type}, {material description},
Current state: {state name}, {state visual description},
{material surface change description},
Pure prop still life display, prop displayed independently, no person holding, no person wearing,
Same frame four-panel (2x2): top-left front view(front view)+top-right side view(side view)+bottom-left back view(back view)+bottom-right detail closeup(detail closeup),
Pure neutral gray background, even soft light, no hard shadows,
Ultra-clear material texture, cel-shaded quality, state details discernible
No text in image,
No people, hands, fingers, or limbs in image, prop cannot be in held or worn state

---

## 六、约束规则

### 必守

| 编号 | 规则 |
|---|---|
| R1 | 道具核心造型/轮廓在所有状态中可识别 |
| R2 | 状态变化须符合物理逻辑 |
| R3 | 必须使用2x2 grid（2×2）布局：左上front view+右上side view+左下back view+右下detail closeup |
| R4 | 必须指定「pure neutral gray background」，even soft light，no hard shadows |
| R5 | 必须包含「二次元动画风格」关键词（anime style / cel shading） |
| R6 | 必须包含景深特征（shallow depth of field / vignette 至少一项），保持动画赛璐璐风格 |

### 严禁

| 编号 | 严禁 |
|---|---|
| X1 | 状态变化后道具不可识别 |
| X2 | 违反物理逻辑的损伤（金属生锈等不符合材质的变化） |
| X3 | 过度血腥/恐怖的损伤描绘 |
| X4 | 出现任何人物形象，包括全身、半身、局部（手、手指、手臂等肢体） |
| X5 | 道具处于被持有、握持、佩戴、使用中的状态 |
| X6 | 出现暗示人物存在的元素（如手持痕迹、佩戴视角、使用姿态） |
| X7 | 使用human realistic/摄影/3D渲染相关词 |
| X8 | 高饱和荧光色/霓虹色 |