# 添加自定义 ComfyUI 工作流到 Toonflow

## 目录

1. [整体架构](#整体架构)
2. [供应商系统核心概念](#供应商系统核心概念)
3. [工作流执行流程](#工作流执行流程)
4. [参考实现分析](#参考实现分析)
5. [添加新工作流的完整步骤](#添加新工作流的完整步骤)
6. [常见问题与注意事项](#常见问题与注意事项)

---

## 整体架构

Toonflow 使用 **Vendor（供应商）适配器系统** 来接入各种 AI 能力（文本、图像、视频、语音）。每个供应商是一个独立的 `.ts` 文件，放在 `data/vendor/` 目录下，遵循固定的模板结构。

```
data/vendor/
├── atlascloud.ts
├── deepseek.ts
├── grsai.ts
├── iflytek.ts
├── klingai.ts
├── minimax.ts
├── null.ts          # 空模板（开发用）
├── openai.ts
├── toonflow.ts
├── vidu.ts
├── volcengine.ts
└── ... (新添加的文件)
```

### 核心文件

| 文件 | 作用 |
|------|------|
| `data/vendor/*.ts` | 供应商适配器代码 |
| `src/lib/vendor.json` | 供应商注册列表（文件名列表） |
| `src/utils/vendor.ts` | 读取/执行供应商代码的工具函数 |
| `src/utils/ai.ts` | AI 执行引擎，调用供应商适配器 |
| `scripts/vendor2json.ts` | 将 `data/vendor/` 下所有 `.ts` 文件打包为 JSON |
| `src/lib/fixDB.ts` | 数据库迁移时自动注册供应商 |

---

## 供应商系统核心概念

### 供应商配置 (`vendor` 对象)

每个供应商文件导出一个 `vendor` 对象，定义供应商的基本信息和能力：

```typescript
const vendor: VendorConfig = {
  id: "comfyui_local_ltx23",      // 唯一ID，作为文件名 / 数据库ID
  version: "3.2",                  // 语义化版本
  name: "本地 ComfyUI LTX 2.3",   // 显示名称
  author: "Toonflow",
  description: "描述（支持Markdown）",
  icon: "",                        // Base64 图标（可选）

  // 用户需要填写的配置项
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true },
  ],

  // 默认配置值
  inputValues: { baseUrl: "http://localhost:8188" },

  // 模型列表
  models: [{
    name: "LTX 2.3 (本地工作流)",
    modelName: "local-ltx-2.3",
    type: "video",                                          // 模型类型
    mode: ["singleImage"],                                  // 支持的模式
    audio: false,                                           // 是否支持音频
    durationResolutionMap: [                                // 时长-分辨率映射
      { duration: [3, 6, 8, 10], resolution: ["480p", "720p", "1080p"] }
    ],
    associationSkills: "描述模型能力"
  }]
};
```

### 视频模型模式 (`VideoMode`)

| 模式 | 说明 |
|------|------|
| `"singleImage"` | 单张首帧参考图 |
| `"startEndRequired"` | 首尾帧（两张都必须提供） |
| `"endFrameOptional"` | 首尾帧（尾帧可选） |
| `"startFrameOptional"` | 首尾帧（首帧可选） |
| `"text"` | 纯文本生成 |
| `["imageReference:9", "videoReference:3"]` | 多模态参考（数字限制数量） |

### 适配器函数

每个供应商必须实现以下四个函数（未实现的保留空实现）：

| 函数 | 参数 | 返回值 |
|------|------|--------|
| `textRequest` | `(model, think, thinkLevel)` | AI SDK 的 chat model 实例 |
| `imageRequest` | `(config: ImageConfig, model: ImageModel)` | 带头 Base64 字符串 |
| `videoRequest` | `(config: VideoConfig, model: VideoModel)` | 带头 Base64 字符串 |
| `ttsRequest` | `(config: TTSConfig, model: TTSModel)` | 带头 Base64 字符串 |

### VideoConfig 结构

```typescript
interface VideoConfig {
  duration: number;                    // 视频时长（秒）
  resolution: string;                  // 分辨率（如 "720p"、"1080p"）
  aspectRatio: "16:9" | "9:16";       // 宽高比
  prompt: string;                      // 提示词
  referenceList?: ReferenceList[];     // 参考资源列表
  audio?: boolean;                     // 是否需要音频
  mode: VideoMode[];                   // 当前激活的模式
}
```

### VideoModel 结构

```typescript
interface VideoModel {
  name: string;                        // 显示名称
  modelName: string;                   // 全局唯一（格式通常为 "供应商ID:模型名"）
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
```

---

## 工作流执行流程

```
┌─ 用户操作 ─────────────────────────────────────────────┐
│  选择模型 → 填写提示词 → 上传参考图 → 点击生成          │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌─ src/utils/ai.ts ──────────────────────────────────────┐
│  AiVideo.run(input: VideoConfig)                        │
│    │                                                    │
│    ├─ resolveModelName(key) → "供应商ID:模型名"         │
│    │                                                    │
│    └─ getVendorTemplateFn("videoRequest", modelName)    │
│         │                                               │
│         ▼                                               │
│       ┌─ src/utils/vendor.ts ──────────────────────┐   │
│       │  1. 读取 data/vendor/{id}.ts               │   │
│       │  2. sucrase 转译 TypeScript → JavaScript    │   │
│       │  3. VM 执行获得 exports                     │   │
│       │  4. 返回 exports.videoRequest 函数          │   │
│       └─────────────────────────────────────────────┘   │
│         │                                               │
│         ▼                                               │
│    const fn = await getVendorTemplateFn("videoRequest")  │
│    await fn(input)  ← 调用适配器函数                     │
│         │                                               │
│         ▼                                               │
│    返回值: 带头 Base64 字符串                            │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─ 视频适配器内部 ────────────────────────────────────────┐
│  videoRequest(config, model) {                          │
│    // 1. 深拷贝工作流 JSON                              │
│    const workflow = JSON.parse(JSON.stringify(WORKFLOW))│
│                                                        │
│    // 2. 替换输入节点                                   │
│    //    LoadImage → easy loadImageBase64               │
│    workflow["98"] = {                                   │
│      class_type: "easy loadImageBase64",               │
│      inputs: { base64_data: rawBase64, ... }            │
│    }                                                    │
│                                                        │
│    // 3. 注入用户参数                                    │
│    workflow["167:164"].inputs.prompt = config.prompt    │
│    workflow["167:146"].inputs.value = frameCount        │
│    workflow["167:102"].inputs.width = width             │
│                                                        │
│    // 4. 提交到 ComfyUI                                  │
│    POST {baseUrl}/prompt  { prompt: workflow }          │
│                                                        │
│    // 5. 轮询结果                                        │
│    pollTask(async () => {                               │
│      GET {baseUrl}/history                              │
│      → 检查输出节点（SaveVideo）的 images               │
│    })                                                   │
│                                                        │
│    // 6. 下载视频 → Base64                               │
│    return await urlToBase64(downloadUrl)                │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 参考实现分析

项目文档中提供了一个完整的 ComfyUI 图生视频参考实现：

**`docs/配置文件+工作流/comfyui-图生视频.ts`** （基于 `video_ltx2_3_i2v(new).json` 工作流）

### 工作流 JSON 结构

工作流 JSON 中的每个节点包含三个部分：

```json
"节点ID": {
  "inputs": {
    "参数名": "值 或 [来源节点ID, 输出索引]"
  },
  "class_type": "节点类型",
  "_meta": { "title": "显示标题" }
}
```

### 关键节点映射

| 工作流节点 | 作用 | 适配器中的处理 |
|------------|------|----------------|
| `98` (LoadImage) | 加载输入图像 | 替换为 `easy loadImageBase64`，传入用户图像 Base64 |
| `167:102` (ResizeImageMaskNode) | 调整分辨率 | 根据 `config.aspectRatio` + `config.resolution` 设置宽高 |
| `167:146` (PrimitiveInt) | 帧数控制 | 根据 `config.duration` 计算：`帧数 = 秒数 × 24 + 1` |
| `167:164` (TextGenerateLTX2Prompt) | 提示词输入 | 直接替换 `prompt` 字段为 `config.prompt` |
| `75` (SaveVideo) | 视频输出 | 轮询时检查此节点的输出结果 |
| `167:136` (CreateVideo) | 创建视频 | 输出节点，与上一节点绑定检查 |

### 核心适配逻辑

```typescript
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  // 1. 准备
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 2. 替换图像输入（LoadImage → easy loadImageBase64）
  workflow["98"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawBase64, image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 3. 注入提示词
  workflow["167:164"]["inputs"]["prompt"] = config.prompt;

  // 4. 计算并设置帧数
  const frameCount = config.duration * 24 + 1;
  workflow["167:146"]["inputs"]["value"] = frameCount;

  // 5. 设置分辨率
  workflow["167:102"]["inputs"]["resize_type.width"] = width;
  workflow["167:102"]["inputs"]["resize_type.height"] = height;

  // 6. 提交到 ComfyUI API
  const submitResp = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  const submitData = await submitResp.json();
  const promptId = submitData.prompt_id;

  // 7. 轮询任务结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) return { completed: true, error: ... };

    const output = run.outputs["75"];
    if (output?.images?.length > 0) return { completed: true, data: output.images[0] };
    return { completed: false };
  }, 3000, 600000);

  // 8. 下载并转换为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${...}&subfolder=${...}&type=${...}`;
  return await urlToBase64(downloadUrl);
};
```

---

## 添加新工作流的完整步骤

### 步骤 1：准备工作流

在 ComfyUI 中搭建好工作流后，导出为 JSON。

**确定需要运行时替换的输入节点：**

| 需要替换的输入 | 对应的节点 |
|---------------|-----------|
| 用户图像 | `LoadImage` 节点 |
| 提示词 | `CLIPTextEncode` 或自定义提示词节点 |
| 帧数/时长 | `PrimitiveInt` 等控制节点 |
| 分辨率 | 缩放/尺寸控制节点 |

**确定输出节点：** 通常是 `SaveVideo` 或 `CreateVideo`，用于检查生成结果。

### 步骤 2：创建供应商文件

在 `data/vendor/` 下创建新 `.ts` 文件（如 `my_workflow.ts`），结构如下：

```typescript
/**
 * Toonflow AI供应商模板 - 我的自定义工作流
 * @version 1.0
 */

// ============================================================
// 类型定义（直接从 comfyui-图生视频.ts 复制，无需修改）
// ============================================================
type VideoMode = "singleImage" | "startEndRequired" | ...;
interface VendorConfig { ... }
interface VideoConfig { ... }
interface VideoModel { ... }
// ... 其他类型定义

// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<...>, interval?: number, timeout?: number) => Promise<...>;
declare const exports: { ... };

// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "my_workflow",           // ← 修改为唯一ID
  version: "1.0",
  name: "我的工作流名称",
  author: "作者",
  description: "描述信息",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "text", required: true, placeholder: "http://localhost:8188" },
  ],
  inputValues: { baseUrl: "http://localhost:8188" },
  models: [{
    name: "显示模型名",
    modelName: "my-model-name",
    type: "video",
    mode: ["singleImage"],     // 根据工作流支持的模式设置
    audio: false,
    durationResolutionMap: [
      { duration: [3, 5, 8, 10], resolution: ["720p", "1080p"] }
    ],
  }],
};

// ============================================================
// 工作流 JSON（替换为你的工作流）
// ============================================================
const WORKFLOW_JSON = {
  // ... 从 ComfyUI 导出的 JSON 粘贴到这里
};

// ============================================================
// 适配器函数
// ============================================================

// 视频转 Base64 辅助函数
const videoToBase64 = async (url: string): Promise<string> => {
  const resp = await axios({ method: 'GET', url, responseType: 'arraybuffer', timeout: 180000 });
  return `data:video/mp4;base64,${Buffer.from(resp.data).toString('base64')}`;
};

const textRequest = (model: TextModel) => { throw new Error("不支持文本生成"); };
const imageRequest = async (config, model) => { return ""; };

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:8188";
  if (!config.prompt) throw new Error("缺少视频生成提示词");

  // 1. 处理参考图
  let rawBase64 = config.referenceList?.[0]?.base64 || "";
  if (rawBase64.includes(',')) rawBase64 = rawBase64.split(',')[1];

  // 2. 深拷贝工作流
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_JSON));

  // 3. 【关键】替换输入节点
  //    将 LoadImage 节点替换为 easy loadImageBase64
  workflow["98"] = {
    class_type: "easy loadImageBase64",
    inputs: { base64_data: rawBase64, image_output: "Preview", save_prefix: "ComfyUI" }
  };

  // 4. 【关键】注入用户参数
  workflow["节点ID"]["inputs"]["prompt"] = config.prompt;       // 提示词
  workflow["节点ID"]["inputs"]["value"] = config.duration * 24 + 1;  // 帧数

  // 5. 设置分辨率
  let width = 1920, height = 1080;
  if (config.resolution === "720p") {
    width = config.aspectRatio === "16:9" ? 1280 : 720;
    height = config.aspectRatio === "16:9" ? 720 : 1280;
  } else if (config.resolution === "1080p") {
    width = config.aspectRatio === "16:9" ? 1920 : 1080;
    height = config.aspectRatio === "16:9" ? 1080 : 1920;
  }
  workflow["节点ID"]["inputs"]["width"] = width;   // 根据实际工作流节点调整
  workflow["节点ID"]["inputs"]["height"] = height;

  // 6. 提交到 ComfyUI API
  const submitResp = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  const submitData = await submitResp.json();
  const promptId = submitData.prompt_id;

  // 7. 轮询结果
  const result = await pollTask(async () => {
    const historyResp = await fetch(`${baseUrl}/history`);
    const history = await historyResp.json();
    const run = history[promptId];
    if (!run) return { completed: false };
    if (run.status?.exec_info?.error) return { completed: true, error: run.status.exec_info.error };

    // 检查输出节点（根据工作流实际的输出节点ID修改）
    const output = run.outputs["75"];             // ← 修改为实际输出节点ID
    if (output?.images?.length > 0) return { completed: true, data: output.images[0] };
    return { completed: false };
  }, 3000, 600000);

  if (result.error) throw new Error(`失败：${result.error}`);
  if (!result.data) throw new Error("未找到视频");

  // 8. 下载视频并转为 Base64
  const fileInfo = result.data;
  const downloadUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder)}&type=${fileInfo.type}`;
  return await urlToBase64(downloadUrl);
};

const ttsRequest = async (config, model) => { return ""; };
const checkForUpdates = async () => ({ hasUpdate: false, latestVersion: "1.0", notice: "" });
const updateVendor = async () => { return ""; };

// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export { };
```

### 步骤 3：注册供应商

编辑 `src/lib/vendor.json`，添加新文件：

```json
{
  "my_workflow.ts": "",
  "atlascloud.ts": "",
  // ... 其他文件保持不变
}
```

### 步骤 4：数据库初始化

重新运行数据库初始化/迁移，系统会在 `o_vendorConfig` 表中自动注册新供应商（参考 `src/lib/fixDB.ts` 中的逻辑）。

或者手动在数据库中插入一条记录：

```sql
INSERT INTO o_vendorConfig (id, inputValues, models, enable)
VALUES ('my_workflow', '{"baseUrl":"http://localhost:8188"}', '[]', 0);
```

### 步骤 5：在 `data/vendor/` 目录下确认文件

确保 `data/vendor/my_workflow.ts` 文件存在，系统启动时会自动读取。

---

## 常见问题与注意事项

### 编码约束

供应商文件运行在沙箱环境中，受以下约束：

| 约束 | 说明 |
|------|------|
| ❌ **禁止 `import/require`** | 不能引入外部包 |
| ✅ **只能使用全局声明** | `axios`, `logger`, `urlToBase64`, `pollTask`, `zipImage` 等 |
| ✅ **可用的 AI SDK 工厂** | `createOpenAI`, `createDeepSeek`, `createGoogleGenerativeAI` 等 |
| ✅ **文件末尾必须 `export {};`** | 确保被视为 ES 模块 |

### 图像输入替换

ComfyUI 的 `LoadImage` 节点默认从文件系统加载图片，在运行时必须替换为接受 Base64 的节点。常见替换方案：

1. **`easy loadImageBase64`** — 来自 ComfyUI-easy-use 插件
2. **`ETN_LoadImageBase64`** — 来自效率节点插件
3. **直接将 Base64 写入临时文件** 后使用 `LoadImage`（需要文件系统权限）

### 输出节点检查

`SaveVideo` 节点在 ComfyUI history 中的输出结构：

```json
{
  "outputs": {
    "75": {                          // 节点ID
      "images": [{
        "filename": "video.mp4",
        "subfolder": "",
        "type": "output"
      }]
    }
  }
}
```

下载 URL 格式：`{baseUrl}/view?filename={filename}&subfolder={subfolder}&type={type}`

### 分辨率计算参考

| 分辨率 | 16:9 | 9:16 |
|--------|------|------|
| 480p | 854×480 | 480×854 |
| 720p | 1280×720 | 720×1280 |
| 1080p | 1920×1080 | 1080×1920 |
| 1536p (LTX 常用) | 1536×… | …×1536 |

### 调试技巧

- 使用 `logger()` 在关键步骤输出日志
- 首次测试时使用较短的 `pollTask` 超时（如 60000ms = 1分钟）
- 检查 ComfyUI 的 `/history` API 返回结果确认输出节点 ID
- 可以使用 `checkForUpdates` 函数返回更新公告

### 文件结构参考

完整实现请参考项目中的参考文件：

- **工作流 JSON**: `docs/配置文件+工作流/video_ltx2_3_i2v(new).json`
- **适配器代码**: `docs/配置文件+工作流/comfyui-图生视频.ts`
- **其他供应商参考**: `data/vendor/klingai.ts`（视频生成）、`data/vendor/volcengine.ts`（多模态）

---

## 参考文件

| 文件 | 说明 |
|------|------|
| `data/vendor/*.ts` | 所有已注册的供应商适配器 |
| `src/lib/vendor.json` | 供应商注册列表 |
| `src/utils/vendor.ts` | 供应商加载/执行工具 |
| `src/utils/ai.ts` | AI 执行引擎 |
| `src/lib/fixDB.ts` | 数据库迁移（自动注册供应商） |
| `docs/配置文件+工作流/comfyui-图生视频.ts` | ComfyUI LTX 2.3 参考实现 |
| `docs/配置文件+工作流/video_ltx2_3_i2v(new).json` | LTX 2.3 工作流 JSON 参考 |
