---
name: art_scene_derivative
description: 场景衍生资产生成 · 约束手册
metaData: art_skills
---

# 场景衍生资产生成 · 约束手册

---

## 一、衍生原则

1. **空间一致** — 建筑结构/布局/材质在所有变体中保持一致
2. **景别驱动** — 同一场景通过不同景别展示不同叙事功能
3. **时段切换** — 同一空间在不同时间段呈现不同光影atmosphere
4. **weather变化** — 同一空间在不同天气下呈现不同情绪
5. **3D为锚** — 所有变体必须保持3D渲染质感，拒绝平面贴图/CG 动画感；保留volumetric lighting、环境光遮蔽、景深虚化

---

## 二、景别变体

### 景别定义

| 景别 | 范围 | 叙事功能 | 提示词 |
|---|---|---|---|
| 大全景 | 场景全貌 + 周围环境 | 建立空间感、定位 | extreme wide shot、大全景 |
| 全景 | 场景完整呈现 | 展示空间结构 | wide shot、全景 |
| middle ground | 场景局部区域 | 聚焦功能区 | medium shot、middle ground |
| 近景 | 场景细部 | 材质/atmosphere道具特写 | close shot、近景 |
| 特写 | 极局部细节 | 材质纹理/关键道具 | extreme closeup、特写 |

### 景别衍生规范

| 从基准图衍生 | 保持不变 | 允许变化 |
|---|---|---|
| 大全景 → 全景 | 建筑外观、整体布局 | 视角收窄、foreground增加 |
| 全景 → middle ground | 材质、color、光线 | 裁切聚焦、景深变化 |
| middle ground → 近景 | 材质、color | 景深浅、背景虚化 |
| 近景 → 特写 | 材质纹理 | 极浅景深、微距感 |

---

## 三、时段变体

### 时段定义

| 时段 | 视觉特征 | 提示词 |
|---|---|---|
| 清晨 | 薄雾柔光、color偏冷暖交织 | 晨光微熹、清晨薄雾 |
| 正午 | 明亮、阴影短、色彩鲜明 | 正午阳光、光线明亮 |
| 黄昏 | 金色color、长影、天空渐变 | 暮色金辉、golden hour |
| 夜间（月光） | 冷蓝color、幽静清冷 | 月光清辉、moonlight |
| 夜间（灯火） | 暖黄点缀、明暗对比 | 灯火阑珊、烛光点点 |

### 时段衍生规范

| 从基准时段衍生 | 保持不变 | 变化项 |
|---|---|---|
| 日间 → 黄昏 | 建筑/布局/材质 | 天空color暖化、影子拉长 |
| 日间 → 夜间 | 建筑/布局/材质 | 整体变暗、增加灯火/月色atmosphere |
| 室内日间 → 室内夜间 | 空间结构、家具 | 整体color暖化、增加烛火/灯笼元素 |

---

## 四、weather变体

### weather定义

| weather | 视觉特征 | 提示词 |
|---|---|---|
| 晴天 | 明亮、阴影清晰 | 晴空万里、阳光明媚 |
| 阴天 | 光线均匀、无硬影 | 阴天柔光、overcast |
| 薄雾 | 能见度降低、空气朦胧 | 薄雾弥漫、雾气缭绕 |
| 细雨 | 水珠、湿润反光、雨丝 | 细雨如丝、雨幕轻纱 |
| 飞雪 | 白色覆盖、雪花飘落 | 飞雪纷纷、银装素裹 |

### weather衍生规范

| 从基准weather衍生 | 保持不变 | 变化项 |
|---|---|---|
| 晴 → 薄雾 | 建筑/布局 | 增加雾气层、远景模糊、饱和度降低 |
| 晴 → 细雨 | 建筑/布局 | 增加雨丝、地面反光、color偏冷 |
| 晴 → 飞雪 | 建筑/布局 | 增加积雪、雪花、color偏白 |
| 植被需随weather逻辑适配 | — | 雨中花瓣湿润、雪中枯枝挂霜 |

---

## 五、角度变体

### 角度定义

> 衍生图相对参考图，可在以下角度维度上进行切换。调用方会传入参考图 + 目标角度描述，本文件只定义角度语汇与一致性约束。

| 角度 | 描述 | 提示词 |
|---|---|---|
| 正面/前视 | 与参考图相比，视线朝向场景正面 | front view、eye level |
| 侧面（左/右） | 朝场景左/右侧 90° 平视 | left side view / right side view |
| 背面/后视 | 朝场景背面 180° | back view |
| 俯视 | 高位俯瞰，呈现整体布局 | high angle、bird's eye view |
| 仰视 | 低位仰望，强调高大主体 | low angle、worm's eye view |
| 近景推进 | 同方向但镜头推进，聚焦局部 | push-in、closer angle |
| 自由角度 | 调用方自定义的任意角度描述 | 按 `{目标角度}` 注入 |

### 角度衍生规范

| 项目 | 约束 |
|---|---|
| 参考一致性 | 建筑结构/布局/材质/color/光线/季节/weather必须与参考图一致 |
| 视点 | 同一场景中心点，仅角度切换；视线高度可随角度调整 |
| 光照逻辑 | 参考图光源方向不变，角度切换后光影投射方向需同步重算（保持物理合理） |
| 布局 | 单画面（非拼图、非多视图、非分屏） |
| 人物 | **严禁出现任何人物、人影、人体轮廓** |
| 画面比例 | 默认 16:9（或按调用方设定） |

---

## 六、提示词模板

Ancient-style derivative scene image, based on reference image,
3D rendering style, high-precision modeling, PBR materials, Chinese-style 3D, cinematic lighting,
3D rendered, volumetric lighting,
depth of field, natural lens vignette, subtle chromatic aberration, bokeh,
3D rendered quality, volumetric light, natural lighting, physical light and shadow,
scene derivative design sheet, environment concept art, no people, no characters, no human figures,
Maintain scene spatial structure consistency,
{target angle (if any)}, {shot angle (if any)}, {time period description (if any)}, {weather description (if any)},
{Foreground}, {Midground}, {Background},
{color tone description}, {depth of field description (if any)}, {sky color change (if any)}, {atmosphere adjustment (if any)},
{weather visual features (if any)}, {material surface changes (if any)}, {vegetation adaptation description (if any)},
Natural material wear traces, aged patina, moss weathering, natural fabric draping,
Volumetric light, ambient occlusion, natural light diffusion, soft light and shadow,
atmospheric perspective, ultra-clear texture details,
Single frame composition, consistent with reference image in architecture structure/material/color tone/lighting, only switch viewpoint per target angle,
No people in image
No text in image

> **使用说明**：根据用户提供的信息自行判断需要应用的变化维度（角度/景别/时段/weather），未提及的维度对应字段留空省略即可。无需为每种变体单独生成模板。

---

## 七、约束规则

### 必守

| 编号 | 规则 |
|---|---|
| R1 | 场景空间结构在所有变体中保持一致 |
| R2 | 时段变体必须调整天空color与atmosphere |
| R3 | weather变体必须适配植被/材质表面 |
| R4 | 衍生图必须为「单画面」，不得拼接多视图/网格/分屏 |
| R5 | 衍生图必须与参考图保持建筑结构/材质/color/光线一致，仅按指定角度切换视点 |
| R6 | 场景图中**严禁出现任何人物** |
| R7 | 根据用户提供的信息自行判断变化维度（角度/景别/时段/weather），未提及维度留空省略 |
| R8 | 必须包含3D渲染关键词（3D rendered / volumetric lighting / PBR materials） |
| R9 | 必须包含镜头光学特征（depth of field / lens vignette / bokeh 至少一项） |
| R10 | 材质必须带有自然磨损/岁月痕迹，禁止全新无瑕的"CG 感" |

### 严禁

| 编号 | 严禁 |
|---|---|
| X1 | 变体间建筑结构/布局不一致 |
| X2 | weather与季节矛盾（夏天飞雪等） |
| X3 | 变体间材质/风格突变 |
| X4 | 出现任何人物、人影、人体剪影或人体轮廓 |
| X5 | 画面被拼接成多视图/网格/分屏布局 |
| X6 | 低精度建模/粗糙贴图/塑料质感（禁用 low-poly、rough modeling 等词） |
| X7 | 材质过于干净完美、无任何使用痕迹与岁月感（避免"塑料感"） |
| X8 | 光照过于均匀平坦、无景深虚化、无镜头光学特征 |
