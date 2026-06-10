# HTML/Markdown 转 PDF — MCP Server

基于 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 的服务器，提供 HTML 和 Markdown 转 PDF 的能力。底层使用 Puppeteer（无头 Chrome）进行浏览器级渲染，确保输出与浏览器表现一致。

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
- **OCR 文字识别** — 基于百度智能云 OCR，支持中英文图片文字提取

---

## 快速开始

### 安装

```bash
npm install
npm run build
```

### MCP 配置

在 MCP 客户端配置文件中添加：

```json
{
  "mcpServers": {
    "md2pdf": {
      "command": "node",
      "args": ["/你的绝对路径/md2pdf/dist/index.js"],
      "description": "HTML/Markdown 转 PDF/图片"
    }
  }
}
```

**配置文件位置：**
- **Claude Code（用户级）：** `~/.claude.json`
- **Claude Code（项目级）：** `.claude.json`
- **Claude Desktop：** `~/Library/Application Support/Claude/claude_desktop_config.json`

> **提示：** 也可用 CLI 一键添加：
> ```bash
> claude mcp add --transport stdio --env BAIDU_OCR_API_KEY=<你的BAIDU_OCR_API_KEY> --envBAIDU_OCR_SECRET_KEY=<你的BAIDU_OCR_SECRET_KE> --scope user md2pdf -- node $(pwd)/dist/index.js
> ```

配置后重启 Claude，即可使用。

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

基于百度智能云 OCR API，从图片中提取文字，支持中文和英文。

```
Claude，识别 /path/to/image.png 中的文字
```

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `imagePath` | string | 本地图片文件路径（三选一） | - |
| `imageUrl` | string | 网络图片 URL（三选一） | - |
| `imageBase64` | string | Base64 编码图片数据（三选一） | - |
| `apiKey` | string | 百度智能云 API Key（可选，优先读环境变量 `BAIDU_OCR_API_KEY`） | - |
| `secretKey` | string | 百度智能云 Secret Key（可选，优先读环境变量 `BAIDU_OCR_SECRET_KEY`） | - |
| `detectLanguage` | boolean | 检测图片中的语言 | true |
| `detectDirection` | boolean | 检测图像朝向 | true |
| `paragraph` | boolean | 输出段落信息 | false |
| `probability` | boolean | 返回置信度分数 | true |

> **认证方式：** 优先使用工具参数 `apiKey`/`secretKey`，未提供时从环境变量 `BAIDU_OCR_API_KEY`/`BAIDU_OCR_SECRET_KEY` 读取。MCP 配置时可通过 `--env` 传入：
> ```bash
> claude mcp add --env BAIDU_OCR_API_KEY=<你的Key> --env BAIDU_OCR_SECRET_KEY=<你的Secret> ...
> ```
>
> **识别策略：** 优先调用高精度接口 `accurate_basic`，失败时自动降级到 `general_basic`。

---

## 架构

```
md2pdf/
├── src/
│   ├── index.ts           # MCP 服务入口（工具注册、请求处理）
│   ├── md-converter.ts    # Markdown → HTML 渲染管线
│   ├── ocr-service.ts     # 百度 OCR 文字识别服务
│   ├── pdf-converter.ts   # Puppeteer PDF 转换核心
│   └── types.ts           # TypeScript 类型定义
├── sample.html            # 示例 HTML（中韩双语 + Chart.js）
├── sample.pdf             # 示例 PDF 输出
├── test-md-conversion.ts  # 端到端测试脚本
└── dist/                  # 编译产物
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
  - Token 缓存：access_token 有效期 30 天，提前 1 天自动刷新
  - 降级策略：高精度接口失败时自动降级到通用接口
  - 错误映射：百度 OCR 错误码自动翻译为中文提示

---

## License

MIT
