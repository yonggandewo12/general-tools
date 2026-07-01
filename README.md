# General Tools — MCP Server

基于 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 的通用工具服务器，提供 HTML/Markdown 转 PDF/图片、OCR 文字识别等能力。底层使用 Puppeteer（无头 Chrome）进行浏览器级渲染，确保输出与浏览器表现一致。

---

## 功能特性

- **HTML 转 PDF** — 支持 HTML 文件或 HTML 内容字符串
- **HTML 转图片** — HTML 文件或内容 → PNG/JPEG 截图，支持全页/视口、自定义质量与缩放
- **Markdown 转 PDF** — 内置专业级报告排版，自动生成侧边栏目录
- **完整 CSS/JS 支持** — Chart.js、Mermaid 等动态内容均可渲染
- **丰富的 PDF 参数** — 页面尺寸、边距、缩放、页眉页脚、网络等待等
- **图片自动嵌入** — 本地图片自动转为 base64 嵌入，单文件可离线分享
- **Mermaid 图表** — Markdown 中的 Mermaid 代码块自动渲染
- **侧边栏目录** — 层级嵌套、粘性定位，长文档导航无压力
- **响应式表格** — 宽表可横向滚动，移动端友好
- **交互增强** — 可选 JS 提供滚动进度条、目录高亮、返回顶部
- **打印优化** — 专门的 `@media print` 样式
- **浏览器实例复用** — 首次启动后后续转换只需 ~0.5-1s
- **OCR 文字识别** — 基于百度智能云 OCR，支持图片、PDF、OFD 文字提取，25+ 种语言
- **PPT 生成** — 将 AI 生成的 SVG 幻灯片导出为原生可编辑 PPTX，支持动画与切换效果
- **AI 图片生成** — 对接 17+ 后端（OpenAI、Gemini、Qwen 等），从文字提示生成图片
- **文档转 Markdown** — PDF、DOCX、Excel、PowerPoint、网页 → 结构化 Markdown

---

## 从 0 到 1 完整安装

### 第一步：检查前置依赖

```bash
# Node.js 18+（必需）
node --version

# Python 3.10+（PPT 导出和文档转换功能需要）
python3.12 --version    # 推荐。macOS: brew install python@3.12
# 如果用系统 python3 且版本 >= 3.10 也可以
python3 --version
```

> macOS 默认的 `python3` 通常为 3.9（不支持 3.10+ 语法），建议安装独立版本：
> ```bash
> brew install python@3.12
> ```
> 项目会自动按 `python3.12` → `python3.11` → `python3.10` → `python3` 的顺序查找可用的 Python 3.10+，也可通过环境变量 `PPT_MASTER_PYTHON` 手动指定。

### 第二步：安装项目依赖

```bash
# 进入项目目录
cd /Users/xuliang/Documents/project/general-tools

# 安装 Node.js 依赖
npm install

# 编译 TypeScript → JavaScript
npm run build

# 安装 Python 依赖（PPT/图片生成/文档转换功能需要）
# macOS（PEP 668 保护）需要 --break-system-packages 参数
python3.12 -m pip install --break-system-packages -r scripts/ppt-master/requirements.txt
# 如果系统 python3 已是 3.10+：
# python3 -m pip install --break-system-packages -r scripts/ppt-master/requirements.txt
```

### 第三步：配置 Claude Code MCP

两种方式二选一：

**方式 A — CLI 一键添加（推荐）：**

```bash
# 基础配置（所有 10 个工具可用，但不含 OCR / AI 图片）
claude mcp add general-tools \
  -- node /Users/xuliang/Documents/project/general-tools/dist/index.js
```

**方式 B — 配置文件（`~/.claude.json`）：**

```json
{
  "mcpServers": {
    "general-tools": {
      "command": "node",
      "args": ["/Users/xuliang/Documents/project/general-tools/dist/index.js"]
    }
  }
}
```

> **配置文件位置对照：**
> - **Claude Code（用户级）：** `~/.claude.json`
> - **Claude Code（项目级）：** `.claude.json`
> - **Claude Desktop：** `~/Library/Application Support/Claude/claude_desktop_config.json`

配置后重启 Claude Code，执行 `claude mcp list` 应看到 10 个工具。

### 第四步（可选）：配置扩展功能的环境变量

某些功能需要第三方服务的 API Key。以下均为**可选**，不配置不影响其他工具。

```bash
# 完整配置版（按需添加 -e 参数）
claude mcp add general-tools \
  -e BAIDU_OCR_API_KEY=你的百度OCRKey \
  -e BAIDU_OCR_SECRET_KEY=你的百度OCRSecret \
  -e IMAGE_BACKEND=gemini \
  -e GEMINI_API_KEY=你的GeminiKey \
  -e PPT_MASTER_PYTHON=python3.12 \
  -- node /Users/xuliang/Documents/project/general-tools/dist/index.js
```

**各功能的环境变量说明：**

| 功能 | 涉及工具 | 需要配置的变量 | 如何获取 |
|------|---------|---------------|---------|
| **OCR 文字识别** | `recognize_text` | `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY` | [百度智能云](https://console.bce.baidu.com/ai/#/ai/ocr/overview/index) 创建应用 |
| **AI 图片生成** | `generate_image` | `IMAGE_BACKEND` + 对应后端 API Key（见下方） | 选择一家服务商 |
| **Python 路径** | 后 3 个工具 | `PPT_MASTER_PYTHON`（可选，不设则自动检测） | — |

**AI 图片生成后端选择（`IMAGE_BACKEND` + 对应 Key）：**

| 后端 | 推荐模型 | 需额外配置 | 备注 |
|------|---------|-----------|------|
| `openai` | gpt-image-2 | `OPENAI_API_KEY=sk-xxx` | [OpenAI](https://platform.openai.com/api-keys)，付费 |
| `gemini` | gemini-3.1-flash-image-preview | `GEMINI_API_KEY=xxx` | [Google AI Studio](https://aistudio.google.com/apikey)，免费额度 |
| `qwen` | qwen-image-2.0-pro | `QWEN_API_KEY=xxx` | 阿里通义万相 |
| `zhipu` | glm-image | `ZHIPU_API_KEY=xxx` | 智谱 GLM |
| `volcengine` | doubao-seedream | `VOLCENGINE_API_KEY=xxx` | 火山引擎 |

例如使用 Gemini（免费）：
```bash
claude mcp add general-tools \
  -e IMAGE_BACKEND=gemini \
  -e GEMINI_API_KEY=你的GoogleAPIKey \
  -- node /Users/xuliang/Documents/project/general-tools/dist/index.js
```

### 验证安装

配置后重启 Claude，让它帮你测试：

```
帮我用 convert_to_markdown 把 package.json 转成 Markdown
```

```
claude mcp list
# 应看到: generate_presentation, generate_image, convert_to_markdown 等 10 个工具
```

### 卸载

```bash
claude mcp remove general-tools
```

---

## 使用指南

### 工具 1：`convert_html_to_pdf`

HTML 文件或内容 → PDF。

```
Claude，把 report.html 转成 PDF，A4 格式，80% 缩放
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `htmlPath` | string | HTML 文件路径 | - |
| `htmlContent` | string | HTML 内容字符串（与 htmlPath 二选一） | - |
| `outputPath` | string | 输出 PDF 路径 | 自动生成带时间戳 |
| `format` | enum | 纸张大小 (A4/A3/Letter/Legal/Tabloid) | A4 |
| `landscape` | boolean | 横向 | false |
| `printBackground` | boolean | 打印背景 | true |
| `scale` | number | 缩放 0.1-2.0 | 1 |
| `marginTop/Bottom/Left/Right` | string | 边距 | 10mm |
| `displayHeaderFooter` | boolean | 显示页眉页脚 | false |
| `headerTemplate` | string | 页眉模板 | - |
| `footerTemplate` | string | 页脚模板 | - |
| `waitForNetworkIdle` | boolean | 等待网络空闲 | false |
| `timeout` | number | 超时(ms) | 30000 |

### 工具 2：`convert_html_to_image`

HTML 文件或内容 → 图片（PNG/JPEG）。支持全页截图或视口截图，可自定义输出质量和缩放比例。

```
Claude，把 report.html 转成高清 PNG 图片
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `htmlPath` | string | HTML 文件路径 | - |
| `htmlContent` | string | HTML 内容字符串（与 htmlPath 二选一） | - |
| `outputPath` | string | 输出图片路径 | 自动生成带时间戳 |
| `imageFormat` | enum | 图片格式 (png/jpeg) | png |
| `quality` | number | JPEG 质量 0-100 | 90 |
| `fullPage` | boolean | 捕获全页高度 | false |
| `imageScale` | number | 截图缩放比例 0.1-2.0 | 1 |
| `waitForNetworkIdle` | boolean | 等待网络空闲后再截图 | false |
| `waitForMermaid` | boolean | 等待 Mermaid 图表渲染完成 | false |
| `timeout` | number | 超时(ms) | 30000 |

### 工具 3：`convert_md_to_html`

Markdown 文件或内容 → 独立、可离线打开的 HTML 报告。带侧边栏目录、响应式表格、Mermaid 图表渲染、图片自动嵌入。

```
Claude，把 README.md 转成 HTML 报告，带交互导航
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `mdPath` | string | Markdown 文件路径 | - |
| `mdContent` | string | Markdown 字符串（与 mdPath 二选一） | - |
| `outputPath` | string | 输出 HTML 路径 | 与输入 .md 同名.html |
| `embedImages` | boolean | 本地图片嵌入为 base64 | true |
| `keepInlineToc` | boolean | 保留正文中已有的目录 | false |
| `withJs` | boolean | 添加 JS 交互（进度条/目录高亮/回顶） | false |
| `mermaidSource` | enum | Mermaid 来源 (auto/cdn/local/none) | auto |

### 工具 4：`convert_md_to_pdf`

Markdown 文件或内容 → 排版后的 PDF。（推荐）

```
Claude，把 README.md 转成 PDF，A4 格式，带交互导航
```

**特有参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `mdPath` | string | Markdown 文件路径 | - |
| `mdContent` | string | Markdown 字符串（与 mdPath 二选一） | - |
| `embedImages` | boolean | 本地图片嵌入为 base64 | true |
| `keepInlineToc` | boolean | 保留正文中已有的目录 | false |
| `withJs` | boolean | 添加 JS 交互（进度条/目录高亮/回顶） | false |
| `mermaidSource` | enum | Mermaid 来源 (auto/cdn/local/none) | auto |

其余 PDF 参数（`format`, `landscape`, `scale` 等）与 HTML 工具一致。

### 工具 5：`recognize_text`

基于百度智能云 OCR API，从图片、PDF 或 OFD 文件中提取文字，支持中英文及多种语言。

```
Claude，识别 /path/to/image.png 中的文字
Claude，识别 /path/to/document.pdf 第2页的文字
Claude，识别 /path/to/doc.ofd 中的文字
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `imagePath` | string | 本地图片文件路径（图片三选一） | - |
| `imageUrl` | string | 网络图片 URL（图片三选一） | - |
| `imageBase64` | string | Base64 编码图片数据（图片三选一） | - |
| `pdfPath` | string | 本地 PDF 文件路径 | - |
| `pdfFileNum` | number | PDF 识别页码，从 1 开始 | 1 |
| `ofdPath` | string | 本地 OFD 文件路径 | - |
| `ofdFileNum` | number | OFD 识别页码，从 1 开始 | 1 |
| `apiKey` | string | 百度智能云 API Key（可选，优先读环境变量 `BAIDU_OCR_API_KEY`） | - |
| `secretKey` | string | 百度智能云 Secret Key（可选，优先读环境变量 `BAIDU_OCR_SECRET_KEY`） | - |
| `languageType` | enum | 识别语言类型（见下表） | CHN_ENG |
| `detectLanguage` | boolean | 检测图片中的语言 | true |
| `detectDirection` | boolean | 检测图像朝向 | false |
| `paragraph` | boolean | 输出段落信息 | false |
| `probability` | boolean | 返回每行置信度分数 | true |
| `multidirectionalRecognize` | boolean | 行级别多方向文字识别（图内有不同方向文字时建议开启） | false |

> **输入优先级：** `image > url > pdf_file > ofd_file`，当 image/url 字段存在时，pdf_file/ofd_file 字段失效。

**`languageType` 可选值：**

| 值 | 语言 | 值 | 语言 |
|----|------|----|------|
| `auto_detect` | 自动检测 | `CHN_ENG` | 中英文混合 |
| `ENG` | 英文 | `JAP` | 日语 |
| `KOR` | 韩语 | `FRE` | 法语 |
| `SPA` | 西班牙语 | `POR` | 葡萄牙语 |
| `GER` | 德语 | `ITA` | 意大利语 |
| `RUS` | 俄语 | `DAN` | 丹麦语 |
| `DUT` | 荷兰语 | `MAL` | 马来语 |
| `SWE` | 瑞典语 | `IND` | 印尼语 |
| `POL` | 波兰语 | `ROM` | 罗马尼亚语 |
| `TUR` | 土耳其语 | `GRE` | 希腊语 |
| `HUN` | 匈牙利语 | `THA` | 泰语 |
| `VIE` | 越南语 | `ARA` | 阿拉伯语 |
| `HIN` | 印地语 | | |

> **认证方式：** 优先使用工具参数 `apiKey`/`secretKey`，未提供时从环境变量 `BAIDU_OCR_API_KEY`/`BAIDU_OCR_SECRET_KEY` 读取。MCP 配置时可通过 `--env` 传入：
> ```bash
> claude mcp add --env BAIDU_OCR_API_KEY=<你的Key> --env BAIDU_OCR_SECRET_KEY=<你的Secret> ...
> ```
>
> **识别策略：** 优先调用高精度接口 `accurate_basic`，失败时自动降级到 `general_basic`。

### 工具 6：`generate_presentation`

创建 ppt-master 项目（Prepare 模式）或将已有 SVG 项目导出为 PPTX（Export 模式）。

> **重要：** 本工具只做机械化的项目准备和 PPTX 导出。AI 驱动的 SVG 幻灯片生成（Strategist → Executor 环节）需通过 Claude Code 的 ppt-master SKILL.md 工作流完成。先由 AI 生成 `svg_output/*.svg`，再调此工具导出。

```
Claude，创建一个新 PPT 项目，用这份 Markdown 内容
Claude，把已有的项目 /path/to/project 导出为 PPTX
```

**两阶段使用：**

1. **Prepare 阶段：** 传入 `markdownContent`/`markdownPath`/`sourceUrl`/`sourceFile` → 创建项目目录并导入源文件
2. **Export 阶段：** 在 `svg_output/` 中放入 AI 生成的 SVG → 传入 `projectDir` → 运行 `finalize_svg.py` + `svg_to_pptx.py` → 产出 PPTX

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `projectDir` | string | 已有项目目录（Export 模式） | - |
| `markdownContent` | string | Markdown 内容（Prepare 模式） | - |
| `markdownPath` | string | Markdown 文件路径（Prepare 模式） | - |
| `sourceUrl` | string | 源 URL（Prepare 模式） | - |
| `sourceFile` | string | 源文件路径 pdf/docx/xlsx/pptx（Prepare 模式） | - |
| `projectName` | string | 项目名称 | 自动推断 |
| `outputDir` | string | 项目创建目录 | cwd |
| `canvasFormat` | enum | 画布格式 (ppt169/ppt43/wechat/xiaohongshu/moments/story/banner/a4) | ppt169 |
| `outputPath` | string | 导出 PPTX 路径（Export 模式） | 自动生成 |
| `svgSource` | enum | SVG 源目录 (output/final) | output |
| `transition` | string | 幻灯片切换效果，如 fade | - |
| `animation` | string | 逐元素进入动画，如 auto | - |
| `timeout` | number | 超时(ms) | 120000 |

### 工具 7：`generate_image`

基于 AI 图片生成后端（通过环境变量配置），从文字提示生成图片。支持 17+ 后端：OpenAI、Gemini、Qwen、Zhipu、Volcengine、Stability、BFL 等。

```
Claude，生成一张"日落海滩"的图片，16:9 比例
```

**环境变量配置示例（MCP 配置时传入）：**

```bash
claude mcp add --transport stdio \
  --env IMAGE_BACKEND=openai \
  --env OPENAI_API_KEY=sk-xxx \
  --scope user general-tools -- node $(pwd)/dist/index.js
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `prompt` | string (必填) | 图片生成提示词 | - |
| `aspectRatio` | string | 宽高比 | 16:9 |
| `imageSize` | string | 图片尺寸 (512px/1K/2K/4K) | 1K |
| `backend` | string | 后端覆盖，如 openai/gemini | 环境变量 IMAGE_BACKEND |
| `outputDir` | string | 输出目录 | cwd |
| `filename` | string | 输出文件名（不含扩展名） | 自动生成 |
| `model` | string | 模型覆盖 | 后端默认模型 |
| `timeout` | number | 超时(ms) | 120000 |

### 工具 8：`convert_to_markdown`

将 PDF、DOCX、Excel、PowerPoint、网页 URL 等转换为 Markdown 格式。自动根据文件扩展名或 URL 检测源类型。

```
Claude，把 report.pdf 转成 Markdown
Claude，把 https://example.com 转为 Markdown
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `source` | string (必填) | 源文件路径或 URL | - |
| `sourceType` | enum | 源类型 (auto/pdf/doc/excel/ppt/web) | auto |
| `outputPath` | string | 输出 Markdown 路径 | 输入文件名.md |
| `maxRows` | number | Excel 每表最大行数 | 无限制 |
| `maxCols` | number | Excel 每表最大列数 | 无限制 |
| `pdfImages` | enum | PDF 图片提取 (all/filtered/none) | filtered |
| `renderVectorFigures` | boolean | 渲染 PDF 矢量图为 PNG | false |
| `vectorFigureDpi` | number | 矢量图渲染 DPI | 150 |
| `timeout` | number | 超时(ms) | 120000 |

---

## 架构

```
general-tools/
├── src/
│   ├── index.ts              # MCP 服务入口（工具注册、请求处理）
│   ├── md-converter.ts       # Markdown → HTML 渲染管线
│   ├── ocr-service.ts        # 百度 OCR 文字识别服务
│   ├── pdf-converter.ts      # Puppeteer PDF 转换核心
│   ├── pdf-extractor.ts      # LiteParse PDF 文本/截图提取
│   ├── python-runner.ts      # Python 脚本执行器（PPT 相关工具底层）
│   ├── ppt-master-service.ts # PPT 生成、图片生成、Markdown 转换服务
│   └── types.ts              # TypeScript 类型定义
├── scripts/
│   └── ppt-master/
│       └── scripts/          # ppt-master Python 脚本（svg_to_pptx 等）
├── sample.html
├── e2e-ppt-master.ts
└── dist/                     # 编译产物
```

**转换流程：**

```
Markdown → md-converter.ts → 完整 HTML（含样式/目录/Mermaid）
                                    ↓
                               pdf-converter.ts
                                    ↓
                                   PDF
```

---

## 系统要求

- **Node.js** 18+
- **npm** 9+
- **Python** 3.10+（PPT 相关工具需要，自动检测 python3.12/3.11/3.10）
- **内存** 最低 512MB，推荐 1GB+
- **Chromium** Puppeteer 自动下载

### 中韩文/Emoji 字体（可选）

```bash
# macOS
brew install font-noto-sans-cjk
brew tap homebrew/cask-fonts
brew install font-noto-color-emoji

# Ubuntu / Debian
sudo apt-get install -y fonts-noto-cjk fonts-noto-color-emoji

# Amazon Linux / RHEL
sudo yum install -y google-noto-sans-cjk-kr-fonts google-noto-sans-serif-cjk-kr-fonts
sudo yum install -y google-noto-emoji-color-fonts

# 更新字体缓存
fc-cache -fv
```

---

## 性能参考

| 阶段 | 耗时 |
|------|------|
| 首次 PDF 生成（含浏览器启动） | ~1.5-2s |
| 后续转换（复用浏览器） | ~0.5-1s |
| 浏览器实例内存 | ~100-200MB |

---

## 技术细节

- **浏览器实例池**：单例模式，首次调用时启动 Chrome，后续复用
- **错误处理**：文件校验、超时控制、崩溃恢复、资源清理
- **图片嵌入**：根据 Markdown 所在目录解析相对路径，转为 data:image URI
- **Mermaid**：检测到代码块时自动加载 CDN JS 并渲染
- **OCR 服务**：
  - 输入优先级：image > url > pdf_file > ofd_file
  - 支持 PDF/OFD 文件识别，可指定页码
  - 支持 25+ 种语言识别
  - Token 缓存：access_token 有效期 30 天，提前 1 天自动刷新
  - 降级策略：高精度接口失败时自动降级到通用接口
  - 错误映射：百度 OCR 错误码自动翻译为中文提示

---

## License

MIT
