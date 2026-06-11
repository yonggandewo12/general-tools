# 通用场景文字识别（OCR）功能设计

## 概述

在现有 `general-tools` 项目中新增基于百度智能云 OCR 的通用文字识别能力，作为第 5 个 MCP Tool 暴露给 AI 代理使用。采用百度 OCR 高精度版通用文字识别接口（`accurate_basic`），支持中英文识别。

## 决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| OCR 接口 | 通用文字识别（高精度版） | 精度更高，适合通用场景 |
| 输入格式 | 本地图片 + URL + Base64 | 覆盖主流使用方式 |
| 认证方式 | 工具参数传入 API Key/Secret Key | 灵活，用户按需传入 |
| 集成方式 | 融入现有项目 | 保持项目统一，减少部署复杂度 |
| 实现方案 | 直接 HTTP 调用百度 REST API | 零外部依赖，轻量，与现有架构风格一致 |

## 架构设计

### 文件结构

```
新增:
  src/ocr-service.ts    — 百度 OCR API 封装（token 管理 + 识别调用）

修改:
  src/types.ts          — 新增 OcrOptions、OcrResult、OcrWordItem 等类型
  src/index.ts          — 注册第 5 个 MCP tool: recognize_text
```

### 模块关系

```
index.ts (MCP Server)
  ├── recognize_text       →  OcrService.recognize()
  │                            ├── getAccessToken()     — API Key/Secret → access_token
  │                            ├── imageToBase64()      — 本地文件 → base64
  │                            ├── fetchUrlImage()      — URL → base64
  │                            └── callBaiduOcrApi()    — 调用百度 REST API
  ├── convert_html_to_pdf    →  PdfConverter
  ├── convert_html_to_image  →  PdfConverter
  ├── convert_md_to_html     →  MdConverter
  └── convert_md_to_pdf      →  MdConverter
```

`OcrService` 是独立模块，不依赖 `PdfConverter` 或 `MdConverter`，与现有组件平行。

## MCP Tool 定义

### 工具名称

`recognize_text` — Extract text from images using Baidu OCR API (supports Chinese and English)

### 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `apiKey` | string | 是 | - | 百度智能云 API Key |
| `secretKey` | string | 是 | - | 百度智能云 Secret Key |
| `imagePath` | string | 否 | - | 本地图片文件路径（三选一） |
| `imageUrl` | string | 否 | - | 网络图片 URL（三选一） |
| `imageBase64` | string | 否 | - | Base64 编码图片数据（三选一） |
| `detectLanguage` | boolean | 否 | true | 是否检测语言 |
| `detectDirection` | boolean | 否 | true | 是否检测图像朝向 |
| `paragraph` | boolean | 否 | false | 是否输出段落信息 |
| `probability` | boolean | 否 | true | 是否返回置信度 |

**输入校验**：`imagePath` / `imageUrl` / `imageBase64` 三选一，必须提供其中一个。

### 输出结构

成功时：

```json
{
  "success": true,
  "text": "识别出的完整文本",
  "language": "CHN_ENG",
  "direction": 0,
  "wordsResult": [
    {
      "words": "每行的文字",
      "location": { "left": 10, "top": 20, "width": 100, "height": 30 },
      "probability": { "average": 0.98, "min": 0.95, "variance": 0.01 }
    }
  ],
  "wordsResultNum": 5,
  "processingTime": "1234ms"
}
```

失败时：

```json
{
  "success": false,
  "error": "错误描述",
  "processingTime": "1234ms"
}
```

## OcrService 实现细节

### Access Token 管理

- 获取地址：`https://aip.baidubce.com/oauth/2.0/token`
- 请求参数：`grant_type=client_credentials&client_id={apiKey}&client_secret={secretKey}`
- 缓存策略：基于 `apiKey + secretKey` 组合缓存 token
  - 有效期 30 天，在过期前 1 天自动刷新
  - 使用内存缓存（`Map<string, {token: string, expiresAt: number}>`）
  - MCP Server 是长连接进程，内存缓存足够

### 图片预处理流程

```
输入 → 判断类型
  imagePath  → fs.readFile → Buffer → base64 字符串
  imageUrl   → fetch(url)  → Buffer → base64 字符串
  imageBase64 → 去掉 data:image/xxx;base64, 前缀（如有）→ 直接使用
→ 调用百度 OCR API
```

### 百度 OCR API 调用

- 接口：`https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic`
- 请求方式：POST
- Content-Type：`application/x-www-form-urlencoded`
- 参数：
  - `image`：base64 编码图片（URL safe，不带 data URI 前缀）
  - `detect_language`：true/false
  - `detect_direction`：true/false
  - `paragraph`：true/false
  - `probability`：true/false
- access_token 通过 URL query 参数传递：`?access_token=xxx`

### 结果组装

- `text`：将 `words_result` 中每项的 `words` 拼接为完整文本（换行分隔）
- `language`：从 API 响应的 `language` 字段获取
- `direction`：从 API 响应的 `direction` 字段获取（0-正常, 1-逆时针90度, 2-逆时针180度, 3-逆时针270度）
- `wordsResult`：保留每行的 `words`、`location`、`probability` 信息
- `wordsResultNum`：识别行数

### 错误处理

| 场景 | 处理方式 |
|------|---------|
| API Key/Secret Key 无效 | 返回 "百度 OCR 认证失败，请检查 API Key 和 Secret Key" |
| 图片格式不支持 | 返回 "不支持的图片格式，支持 PNG/JPG/JPEG/BMP" |
| 三种输入均未提供 | 返回 "必须提供 imagePath、imageUrl 或 imageBase64 其中之一" |
| 多种输入同时提供 | 优先级：imagePath > imageUrl > imageBase64 |
| 网络超时 | 30s 超时，返回 "百度 OCR 请求超时" |
| 百度 API error_code | 翻译为中文错误描述（覆盖常见错误码） |
| 图片文件不存在 | 返回 "图片文件不存在: {path}" |

## 类型定义

```typescript
export interface OcrOptions {
  apiKey: string;
  secretKey: string;
  imagePath?: string;
  imageUrl?: string;
  imageBase64?: string;
  detectLanguage?: boolean;
  detectDirection?: boolean;
  paragraph?: boolean;
  probability?: boolean;
}

export interface OcrWordItem {
  words: string;
  location?: { left: number; top: number; width: number; height: number };
  probability?: { average: number; min: number; variance: number };
}

export interface OcrResult {
  success: boolean;
  text?: string;
  language?: string;
  direction?: number;
  wordsResult?: OcrWordItem[];
  wordsResultNum?: number;
  error?: string;
  details?: { processingTime: number };
}
```

## 测试策略

- 单元测试：使用 vitest 测试 `OcrService` 的核心逻辑
  - token 缓存和刷新
  - 图片预处理（本地文件、URL、Base64）
  - 结果组装
  - 错误处理
- 集成测试：使用真实百度 OCR API Key 进行端到端验证（手动触发，不纳入 CI）
