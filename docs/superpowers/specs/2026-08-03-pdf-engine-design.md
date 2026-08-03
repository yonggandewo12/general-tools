# 纯 JS PDF 布局分析引擎设计文档

**日期**: 2026-08-03
**状态**: 待实现

## 目标

用纯 TypeScript/JavaScript 从零实现 PDF 布局分析引擎（参考 opendataloader-pdf 的算法思路），接管 `general-tools` 中所有"PDF 转出"功能，提升 PDF→Markdown 提取质量，且**不引入 Java 运行时依赖**。

## 背景与动机

当前 PDF 转出功能使用两套引擎，质量均低于主流方案：

| 现有工具 | 现实现 | 基准分 | 问题 |
|---|---|---|---|
| `extract_pdf_text` | `@llamaindex/liteparse` (PDFium) | 0.576 | 阅读顺序差、无标题/表格结构 |
| `convert_to_markdown`(PDF分支) | PyMuPDF `pdf_to_md.py` | 0.732 | 结构化输出弱、表格一般 |

对照 opendataloader-pdf（本地模式 0.831，阅读顺序 0.902）存在明显差距。但 opendataloader-pdf 依赖 Java 11+（fat JAR + spawn java），与项目"Node + Python + puppeteer"零 JVM 的轻量特性冲突。

**决策**：用纯 JS 参考其算法思路重写布局分析管线，底层用 Mozilla `pdfjs-dist`（文本层提取**不需要 canvas**，纯 Node 可用）。

## 约束

- 纯 JS/TS 实现，**无 Java、无新增重型运行时依赖**
- 依赖仅新增 `pdfjs-dist`（文本提取无需 canvas；仅图像渲染才需要 canvas）
- 保持现有 MCP 工具签名与返回契约不变
- 不破坏其他工具（不回归）

## 范围

### 接管（由新引擎实现）

| 工具 | 说明 |
|---|---|
| `extract_pdf_text` | 保留 `outputFormat: text/json/markdown` 三档输出，替换内部 liteparse 实现 |
| `convert_to_markdown`(PDF分支) | 替换 PyMuPDF `pdf_to_md.py`，Markdown 结构化输出，含表格、图片 `pdfImages: all/filtered/none` |

### 保留不动

| 工具 | 原因 |
|---|---|
| `screenshot_pdf` | 截图是页面渲染，非布局提取，保留 liteparse 渲染 |
| `recognize_text` | 百度 OCR 云 API，处理扫描件/图片，与 `extract_pdf_text` 互补（数字 PDF 用提取、扫描 PDF 用 OCR），两条独立链路 |

### 非目标（明确不做）

- OCR（扫描 PDF 识别）——由 `recognize_text` 负责
- 公式 LaTeX 提取——本地天花板低，hybrid 才有价值
- 复杂/无边框表格的高保真重建——启发式尽力，不保证
- 生成 Tagged PDF / PDF/UA 无障碍输出

## 功能范围

- 标题层级 H1-H6（字号/粗体启发式）
- 段落文本（保持阅读顺序）
- 有序/无序列表
- 表格（有边框表格结构正确为主，无边框启发式尽力）
- 图片提取（兼容 `pdfImages: all/filtered/none`）
- 代码块（等宽字体启发式）
- 页眉页脚/水印过滤

## 架构

```
src/pdf-engine/
  types.ts                  // 中间数据结构定义
  pdf-source.ts             // pdfjs-dist 适配层：PDF → 每页文本项+坐标/字号/字体、页面尺寸、图片清单
  layout/line-builder.ts    // 文本项 → 文本行（按 y 轴对齐聚类，x 排序，处理跨字距）
  layout/block-builder.ts   // 文本行 → 文本块（样式相似性 + 垂直间隙聚类）
  layout/reading-order.ts   // XY-Cut 递归分割空白 → 全局阅读顺序
  layout/classifier.ts      // 块分类：标题/段落/列表/表格/图片/页眉页脚/扫描页
  layout/table-structure.ts // 表格行列重建：检测表格区域 → 行列划分 → 单元格 → 结构化数据
  markdown-renderer.ts      // 布局元素树 → Markdown 文本
  json-renderer.ts          // → JSON（带 bbox，兼容现有 json 输出结构）
  pdf-engine.ts             // 门面：PDF → { text, json, markdown, pages, pageCount }
  index.ts                  // 导出
```

### 模块职责

**pdf-source.ts**：唯一接触 pdfjs-dist 的地方。加载 PDF（密码/损坏处理），逐页调用 `getTextContent()` 提取文本项（含 transform/x/y/width/height/fontSize/fontName）、`page.getViewport()` 获取尺寸、`page.getAnnotations()` 和图片对象获取位图。输出统一中间结构 `RawPage`，隔离 pdfjs 依赖。

**line-builder.ts**：把同一行（y 相近）的文本项按 x 升序拼成 `TextLine`，处理旋转文本与字距断裂。输入 `RawPage`，输出 `TextLine[]`。

**block-builder.ts**：把相邻行（垂直间隙小、字号/字体/对齐一致）聚类为 `TextBlock`。块是布局分析的基本单元。

**reading-order.ts**：XY-Cut 算法——递归地在块集合的垂直/水平空白带处切割，把多栏、标题、表格等元素排成全局阅读顺序。输出排序后的块列表。

**classifier.ts**：基于块特征（字号、粗体、对齐、位置、等宽字体、内容模式）分类为：heading(n)、paragraph、list-item、table、image、header/footer、scan-page。

**table-structure.ts**：检测表格区域（线条 draw 对象 / 网格间距启发式），划分行列，重建单元格内容。输出 `Table { headers, rows }`。

**markdown-renderer.ts**：按阅读顺序渲染布局元素树为 Markdown（`#`/列表/表格语法/图片引用/代码块/分页分隔）。

**json-renderer.ts**：输出带 bbox 的结构化 JSON，兼容现有 json 输出结构。

**pdf-engine.ts**：门面。入口 `convert(path, { outputFormat, pages, password, maxPages, ... })`，编排上述管线，返回 `{ success, text?, json?, markdown?, pages, pageCount }`，捕获异常返回 `success:false`（保持现有契约）。

## 数据流

```
PDF 文件
  → pdf-source.ts       // pdfjs 解析，RawPage[]（文本项+坐标+尺寸+图片）
  → line-builder.ts     // TextLine[]
  → block-builder.ts    // TextBlock[]
  → classifier.ts       // 分类（含表格/图片区域识别）
  → reading-order.ts    // 全局阅读顺序排序
  → 表格块 → table-structure.ts → Table[]
  → markdown-renderer / json-renderer
  → 输出
```

## 接口契约（保持现有签名）

### extract_pdf_text

- 输入：`pdfPath`、`outputFormat`(text/json/markdown)、`targetPages`、`maxPages`、`password`
- 输出：`{ success, text?, pages[{pageNum,width,height,text}], pageCount, details }`
- 移除不适用参数：`ocrEnabled`/`ocrLanguage`/`ocrServerUrl`/`dpi`/`imageMode`（OCR 与截图不在新引擎范围；json/markdown 结构见 json-renderer/markdown-renderer）

### convert_to_markdown（PDF 分支）

- 输入：`source`、`pdfImages`(all/filtered/none)、`renderVectorFigures`、`vectorFigureDpi`、`timeout`
- 输出：保持现有 `ConvertToMarkdownResult` 结构（输出 Markdown 文件路径 + assets 图片目录）

## 错误处理

| 场景 | 行为 |
|---|---|
| PDF 打开失败（损坏/格式错误） | 门面捕获 → `success:false` + 错误信息（保持契约） |
| 加密 PDF 无密码 / 密码错误 | 同上 |
| 某页无文本层（纯图扫描页） | 该页标注 `scanPage: true`，不中断整体 |
| 单页解析失败 | 跳过该页，继续其他页，结果中标注 |
| 超大 PDF | 受 `maxPages` 限制 |
| 表格结构无法解析 | 该区域按段落文本降级输出 |

## 测试策略

- **fixture 生成**：`pdf-lib` 动态生成受控 PDF（精确控制文本坐标/字号/表格线条/图片占位），避免依赖外部样例文件
- **单元测试**（TDD，逐模块）：
  - line-builder：同行排序、跨列行、旋转文本
  - block-builder：间隙合并、样式分隔
  - reading-order：多栏 Z 型阅读、标题优先
  - classifier：标题/正文/列表/表格/页眉页脚分类
  - table-structure：简单边框表格 → 行列单元格
  - markdown-renderer：表格 → Markdown 语法、标题层级
- **集成测试**：完整 PDF → 最终 Markdown/JSON 断言
- **回归保证**：运行现有 `vitest run` 全绿（screenshot_pdf/recognize_text/其他工具不受影响）

## 代码修改点

1. `src/pdf-extractor.ts`：`extract()` 内部改调 `pdf-engine`；`screenshot()` 保留 liteparse
2. `src/ppt-master-service.ts`：`convertToMarkdown()` 的 `case 'pdf'` 改调 `pdf-engine`（不再调用 `pdf_to_md.py`）
3. `package.json`：新增 `pdfjs-dist` 依赖；`@llamaindex/liteparse` 保留（screenshot 仍在用）
4. `src/pdf-engine/**`：新增模块

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| pdfjs-dist 文本提取质量（嵌入字体/CID、断词） | 坐标/文本可能不准 | **先写 50 行 spike** 验证真实 PDF 的 span 坐标/字号提取质量，再铺开实现 |
| 无边框表格 | 结构差 | 对齐 opendataloader 本地水平（0.489），标注"尽力而为"，不做 hybrid |
| `renderVectorFigures`（矢量图渲染 PNG） | 需要渲染能力 | 先降级为"只提取 PDF 内嵌位图"；矢量图渲染列为可选增强（需 canvas） |
| 阅读顺序 edge case（跨栏标题、浮动元素） | 顺序错 | XY-Cut 递归调优，用 fixture 覆盖常见布局 |
| 性能（pdfjs 解析大 PDF） | 慢 | `maxPages` 限制 + 懒加载页，必要时分页并行 |

## 验收标准

- 实现后：新引擎接管 `extract_pdf_text` + `convert_to_markdown` PDF 分支，旧引擎代码不再被 PDF 转出调用
- 测试：逐模块单测 + 集成断言全绿；现有 `vitest run` 不回归
- 由用户人工验证输出质量（多栏/表格/中文文档）

## 已知局限（v1 实现记录）

1. 复杂/无边框/合并单元格表格结构可能不完整（列对齐启发式，目标对齐本地 0.489 档）
2. 图片提取已实现：通过重放操作符列表跟踪 CTM 计算摆放位置，pdfjs 异步对象解析后编码为 PNG 落盘（`convert_to_markdown` 的 assets 目录，引用为相对路径）；无 canvas，仅内嵌位图，矢量图不渲染
3. 矢量图形渲染为 PNG（renderVectorFigures）未实现，需 canvas
4. pdfjs-dist y 轴为底部原点，翻转取文本顶部坐标，可能有亚像素精度损失
5. 阅读顺序覆盖单栏/双栏/跨栏标题，极端浮动布局不保证
6. pdf-lib 生成的粗体字体名不含 "bold"，isBold 启发式对 pdf-lib fixture 不生效；块切分已用"标题状字号边界"（≥14pt 或粗体切换）兜底，真实 PDF 的粗体判断正常
