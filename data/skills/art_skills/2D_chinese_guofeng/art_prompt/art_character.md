---
name: art_character
description: 人物基础形象生成 · 约束手册
metaData: art_skills
---

# 人物基础形象生成 · 约束手册

---

## 一、基础形象原则

1. **造型即灵魂** — 角色造型是核心锚点，国风二次元造型，flowing lines
2. **底模即基础** — 基础打底服装 + 素颜，后续服化均为叠加层
3. **四视图一致** — 面容/体型/发型/基础服装跨视图高度统一
4. **古典气质** — 无妆状态仍需体现角色气质（典雅/温婉/英气）

---

## 二、面容约束

> 不再固定五官特征参数，由角色描述（性别/年龄/性格/气质）驱动 AI 自由生成五官，保证人物间外观差异化。

### 通用要求

| 项目 | 约束 |
|---|---|
| 五官 | 由角色描述自然推导，不预设脸型/眼型/眉型/鼻型/唇型 |
| 风格底色 | 国风二次元、新国潮美学、日式动画渲染、赛璐璐平涂、细腻笔触 |
| 气质 | 必须从角色描述提炼整体气质关键词（如典雅温婉/儒雅英气/侠骨柔情），并写入提示词 |
| 表情 | 中性微表情，符合角色气质 |

---

## 三、肤感约束

### 女性

| 项目 | 约束 | 提示词 |
|---|---|---|
| 肤色 | 粉白基调、全身均匀、白皙透亮 | 粉白基调、白皙透亮、二次元肤色 |
| 光泽 | 赛璐璐平涂、自然光泽、非哑光 | 赛璐璐平涂、自然光泽、柔和质感 |
| 质感 | 细腻线条、色彩均匀、边缘柔和 | 细腻线条、色彩均匀、边缘柔和 |
| 露肤 | 面部/颈部/手部 | 手部细腻、颈部线条柔和 |

### 男性

| 项目 | 约束 | 提示词 |
|---|---|---|
| 肤色 | 白皙基调、全身均匀、健康质感 | 白皙基调、健康质感、二次元肤色 |
| 光泽 | 赛璐璐平涂、自然光泽 | 赛璐璐平涂、自然光泽、柔和质感 |
| 质感 | 细腻线条、干净利落 | 细腻线条、赛璐璐平涂、柔和 |

---

## 四、体型约束

### 女性

| 项目 | 约束 | 提示词 |
|---|---|---|
| 身高 | 由角色设定指定，默认范围 160-170cm | {身高}cm tall、{身高描述如：tall elegant woman} |
| 头身比 | 六头身至七头身，二次元古典比例 | 6-7 heads tall proportion、二次元古典比例 |
| 肩颈 | 天鹅颈、肩颈线优美 | 天鹅颈、肩颈优美 |
| 手部 | 纤长白皙、手指自然 | 纤长白皙、自然手指 |
| 体态 | 古典气质、优雅挺拔 | 体态优雅、身姿挺拔 |

### 男性

| 项目 | 约束 | 提示词 |
|---|---|---|
| 身高 | 由角色设定指定，默认范围 175-185cm | {身高}cm tall、{身高描述如：tall imposing man} |
| 头身比 | 六头身至七头身，二次元古典比例 | 6-7 heads tall proportion、二次元古典比例 |
| 肩颈 | 宽阔肩部、颈部有力 | 宽阔肩部、颈部有力 |
| 手部 | 骨节分明、手指自然 | 骨节分明、自然手指 |
| 体态 | 儒雅英气、挺拔端正 | 体态英气、身姿挺拔 |

---

## 五、基础发型约束

> 仅定义自然发型，发饰在服化衍生环节叠加。

### 女性

| 项目 | 约束 | 提示词 |
|---|---|---|
| 发色 | 墨黑、禁其他颜色 | 墨黑长发、青丝如瀑 |
| 发长 | 长发及腰 | 长发及腰、长发 |
| 发质 | 细腻线条、发丝清晰 | 细腻线条、清晰发丝 |
| 造型 | 自然散发、no hair accessories | 长发自然散落、no hair accessories |

### 男性

| 项目 | 约束 | 提示词 |
|---|---|---|
| 发色 | 墨黑、禁其他颜色 | 墨黑长发、青丝如墨 |
| 发长 | 长发及肩或束发 | 长发及肩、束发 |
| 发质 | 细腻线条、发丝清晰 | 细腻线条、清晰发丝 |
| 造型 | 自然散发或半束、无发冠 | 长发自然散落、半束长发 |

---

## 六、基础服装约束

> 基础服装无特殊约束，女性为素色古装长裙，男性为素色古装长衫。正式服饰在服化衍生环节叠加。

### 女性基础服装

素色古装长裙，颜色以基础色为主，no patterns装饰。

### 男性基础服装

素色古装长衫，颜色以基础色为主，no patterns装饰。

### 着装统一规则

- 服装风格统一，确保后续服饰叠加无色彩干扰
- 除面部/手部/颈部外基本覆盖
- 四视图服装款式完全一致
- 基础服装仅为安全打底，焦点在面容与体态

---

## 七、四视图设定图规范

### 视图定义

| 位置 | 视图 | 角度 | 景别 | 要求 | 提示词 |
|---|---|---|---|---|---|
| 左一 | 人像特写 | 正面平视 | 头顶至锁骨 | 从头顶到锁骨完整展示，面部占60%+，五官清晰 | portrait closeup、face detail |
| 左二 | 正视图 | 正面 0° | 全身立像 | 面对镜头、双臂自然、从头顶到脚底完整展示 | front view、full body |
| 右二 | 侧视图 | 右侧 90° | 全身立像 | 纯侧面轮廓清晰、从头顶到脚底完整展示 | side view、profile、full body |
| 右一 | 后视图 | 后方 180° | 全身立像 | 后脑/背部/发尾/脚部清晰、从头顶到脚底完整展示 | back view、rear view、full body |

### 画面规范

| 项目 | 约束 |
|---|---|
| 布局 | 同一画面从左至右并排四视图 |
| 背景 | 月白纯色 #E8EAF5 |
| 站姿 | natural standing、双脚平行微分、双臂自然下垂 |
| 全身展示 | 全身立像必须从头顶到脚底完整入画，严禁裁切 |
| 特写展示 | 人像特写必须从头顶到锁骨完整入画，严禁裁切 |
| 表情 | 中性微表情，符合角色气质 |
| 光线 | even soft light，前方主光 + 双侧补光，no hard shadows |
| 一致性 | 四视图的肤色/体型/发型/面容/基础服装完全一致 |
| 画面比例 | 建议 4:1 或 3:1 |

---

## 八、提示词模板

{gender} character four-view character sheet, Chinese-style 2D animation, new Chinese aesthetic, Japanese animation rendering, cel-shaded flat coloring, fine brushstrokes,
character design sheet, character turnaround,
{facial features corresponding to character description - naturally derived from character description}, {overall temperament}, bare-faced state, no facial markings, no stains, no blood,
{skin tone}, cel-shaded flat coloring, translucent glowing skin, fine lines, rich light and shadow layers,
{height description, e.g.: 165cm tall, tall elegant woman}, {head-to-body ratio, e.g.: 6.5 heads tall proportion}, {body description}, {posture description},
{hair color}{hair length}, fine hair strands clear, {basic style}, no hair accessories,
(Female: plain ancient-style long dress / Male: plain ancient-style long robe), base colors, no patterned decorations,
Same frame left to right: portrait closeup + front view + side view + back view,
Portrait closeup complete from crown to collarbone, no cropping of crown, head to collarbone complete,
Full body standing pose complete from crown to toe, full body head to toe, no cropping of crown or feet,
Natural standing, pale moonlight solid background, even soft light, no hard shadows,
Four-view consistency, clear Chinese-style 2D character design, fine lines clear,
No text in image

---

## 九、约束规则

### 必守

| 编号 | 规则 |
|---|---|
| R1 | 必须为「bare-faced state」 |
| R2 | 必须声明基础服装（女性：素色古装长裙；男性：素色古装长衫） |
| R3 | 必须声明「no hair accessories、no accessories」 |
| R4 | 必须指定「pale moonlight solid background」 |
| R5 | 必须指定「four-view consistency」 |
| R6 | 全身立像必须从头顶到脚底完整展示，严禁裁切 |
| R7 | 必须声明角色身高并通过头身比换算约束全身比例（女性默认 160-170cm/6-7头身，男性默认 175-185cm/6-7头身） |
| R8 | 人像特写必须从头顶到锁骨完整展示，严禁裁切头顶 |

### 严禁

| 编号 | 严禁 |
|---|---|
| X1 | 基础服装以外的任何服装/配饰/妆容 |
| X2 | 正顶硬光/正底光/冷色光 |
| X3 | 过度美白至无血色 / 肤色发灰 |
| X4 | 复杂场景背景（必须纯色） |
| X5 | 夸张表情/动态姿势 |
| X6 | 全身立像裁切头顶或脚底，必须从头到脚完整入画 |
| X7 | 人像特写裁切头顶，必须从头顶到锁骨完整入画 |
| X8 | 忽略身高和头身比约束，身高必须明确声明并通过头身比换算体现全身比例 |