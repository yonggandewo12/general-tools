# PDF 文本提取 MCP Tool 设计文档

**日期**: 2026-06-25
**状态**: 待实现

## 目标

在 `general-tools` MCP server 中新增 PDF 文本提取和截图功能，基于 `@llamaindex/liteparse` npm 包，封装为 2 个 MCP tool。

## 背景

当前 `general-tools` 已有 5 个 tool（HTML→PDF、HTML→Image、MD→HTML、MD→PDF、OCR 文字识别）。项目根目录下有 `liteparse/` 子目录，是 liteparse 的源码仓库（独立 git repo）。本次需求是引用 liteparse 的 npm 包作为依赖，封装 MCP tool，而非修改 liteparse 源码。

## 依赖方式

在 `package.json` 中添加 `@llamaindex/liteparse` 作为 npm 依赖，直接 import 调用。不通过 CLI 调用。

## 新增 Tool

### 1. `extract_pdf_text` — PDF 文本提取

**参数**:

| 参数 | 类型 | 必选 | 默认值 | 说明 |
|------|------|------|--------|------|
| pdfPath | string | 是 | - | 本地 PDF 文件路径 |
| outputFormat | string | 否 | "text" | 输出格式：text / json / markdown |
| targetPages | string | 否 | - | 页码范围，如 "1-5,10,15-20" |
| ocrEnabled | boolean | 否 | false | 是否启用 OCR |
| ocrLanguage | string | 否 | "eng" | OCR 语言（Tesseract 格式） |
| ocrServerUrl | string | 否 | - | HTTP OCR 服务地址 |
| maxPages | number | 否 | 1000 | 最大解析页数 |
| dpi | number | 否 | 150 | 渲染 DPI |
| imageMode | string | 否 | "off" | Markdown 图片处理：off / placeholder / embed |
| password | string | 否 | - | 加密 PDF 密码 |

**返回值**:

```json
{
  "success": true,
  "text": "提取的全文",
  "pages": [
    { "pageNum": 1, "width": 595, "height": 842, "text": "第1页文本..." }
  ],
  "pageCount": 5,
  "processingTime": "123ms"
}
```

### 2. `screenshot_pdf` — PDF 页面截图

**参数**:

| 参数 | 类型 | 必选 | 默认值 | 说明 |
|------|------|------|--------|------|
| pdfPath | string | 是 | - | 本地 PDF 文件路径 |
| targetPages | string | 否 | - | 页码范围，如 "1,3,5" |
| dpi | number | 否 | 150 | 渲染 DPI |
| outputDir | string | 否 | 当前目录 | 截图输出目录 |
| password | string | 否 | - | 加密 PDF 密码 |

**返回值**:

```json
{
  "success": true,
  "screenshots": [
    { "pageNum": 1, "width": 1240, "height": 1754, "outputPath": "/path/to/screenshot_p1.png" }
  ],
  "processingTime": "456ms"
}
```

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `package.json` | 修改 | 添加 `@llamaindex/liteparse` 依赖 |
| `src/types.ts` | 修改 | 新增 PdfExtractOptions / PdfExtractResult / PdfScreenshotOptions / PdfScreenshotResult 类型 |
| `src/pdf-extractor.ts` | 新增 | 封装 liteparse 调用逻辑 |
| `src/index.ts` | 修改 | 注册 2 个新 tool 定义和调用处理 |

## 实现细节

### pdf-extractor.ts

封装 `PdfExtractor` 类，类似现有 `OcrService` 模式：

- `extract(options)`: 创建 LiteParse 实例 → parse → 格式化结果
- `screenshot(options)`: 创建 LiteParse 实例 → screenshot → 写入文件 → 返回路径

关键点：
- LiteParse 实例按需创建（每次调用新建，因为 config 不同）
- OCR 默认关闭（`ocrEnabled: false`），纯文本提取场景更常见
- `targetPages` 字符串直接传给 liteparse，由其解析
- 截图结果写入 `outputDir` 目录，文件名格式 `screenshot_p{pageNum}.png`

### 错误处理

- 文件不存在：`success: false` + 错误信息
- PDF 加载失败：`success: false` + 错误信息
- liteparse 原生模块加载失败：在 tool 调用时捕获，返回安装提示

## 关于 liteparse/ 目录

`liteparse/` 是独立的 git 仓库源码目录，本次只需引用其 npm 包，不需要修改源码。该目录是否删除由用户决定。
