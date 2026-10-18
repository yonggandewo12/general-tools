import { promises as fs } from 'fs';
import * as path from 'path';
import type { Format } from '@firecrawl/anydoc';
import { PythonScriptRunner } from './python-runner.js';
import { extractMarkdown, classifyPdf, processPdfWithOcrFor } from './pdf-inspector-service.js';
import type { NormalizedPdfDocument } from './pdf-inspector-types.js';
import {
  GeneratePresentationOptions,
  GeneratePresentationResult,
  ConvertToMarkdownOptions,
  ConvertToMarkdownResult,
  MarkdownSourceType,
} from './types.js';

const PRESENTATION_DEPS = ['pptx', 'svglib', 'reportlab', 'PIL'];
const MARKDOWN_DEPS = ['mammoth', 'markdownify', 'openpyxl', 'pptx', 'PIL', 'requests', 'bs4'];

// anydoc 通过 napi-rs 加载 native binary，若系统库缺失或平台不支持，
// 加载会抛异常。要求整个 MCP server 启动时仍可用，因此改为按需动态 import。
// 加载失败时强制走 Python fallback（详见 README "安装" 段）。
/** anydoc 文档模型里我们关心的部分：资产二进制 + 用于定位图片位置的块树。 */
type AnydocDocument = {
  assets: Array<{ id: number; mediaType: string; data: Buffer; originPart?: string }>;
  blocks?: unknown[];
  notes?: unknown[];
};
type AnydocApi = {
  formatFromExtension: (ext: string) => Format | null;
  toDocument: (bytes: Uint8Array, format: Format) => Promise<AnydocDocument>;
  toMarkdownBytes: (bytes: Uint8Array, format: Format) => Promise<string>;
};
let anydocApi: AnydocApi | null = null;
let anydocLoadError: Error | null = null;
async function loadAnydoc(): Promise<AnydocApi | null> {
  if (anydocApi) return anydocApi;
  if (anydocLoadError) return null;
  try {
    const mod = await import('@firecrawl/anydoc');
    anydocApi = {
      formatFromExtension: mod.formatFromExtension as AnydocApi['formatFromExtension'],
      toDocument: mod.toDocument as AnydocApi['toDocument'],
      toMarkdownBytes: mod.toMarkdownBytes as AnydocApi['toMarkdownBytes'],
    };
    return anydocApi;
  } catch (error) {
    anydocLoadError = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

/** anydoc 的 native 解析不可取消：超时只能让调用方尽早脱身，解析仍在后台跑完。 */
function abandonAfter<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  if (!(ms > 0)) return work;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} did not finish within ${ms}ms and was abandoned; ` +
            'the native anydoc parse cannot be cancelled and keeps running in the background.',
        ),
      );
    }, ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type AnydocImageRef = {
  alt: string;
  assetId: number;
  /** 该图片在 Markdown 段落组序列里的位置；无法定位（行内/嵌套/非段落）时为 null。 */
  paragraphIndex: number | null;
};

/** 把内联节点拉平成渲染文本：图片内联贡献它的 alt，锚点等不产出可见文本的为 ''。 */
function inlineRenderText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(inlineRenderText).join('');
  const record = node as { kind?: string; text?: string; alt?: string; content?: unknown };
  switch (record.kind) {
    case 'text':
      return typeof record.text === 'string' ? record.text : '';
    case 'image':
      return typeof record.alt === 'string' ? record.alt : '';
    case 'anchor':
      return '';
    default:
      return Object.values(record).map(inlineRenderText).join('');
  }
}

function assetImagesIn(node: unknown, into: Array<{ alt: string; assetId: number }>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) assetImagesIn(item, into);
    return;
  }
  const record = node as { kind?: string; alt?: string; source?: { kind?: string; assetId?: number } };
  if (
    record.kind === 'image' &&
    record.source?.kind === 'asset' &&
    typeof record.source.assetId === 'number'
  ) {
    into.push({ alt: typeof record.alt === 'string' ? record.alt : '', assetId: record.source.assetId });
    return;
  }
  for (const value of Object.values(record)) assetImagesIn(value, into);
}

/**
 * 块树里的块与 Markdown 段落组（连续非空行算一组）按顺序一一对应，但纯文本块
 * （paragraph / heading）在没有可见文本时整段消失、不占组；其余块即使内容为空也
 * 会渲染出一行（`- `、代码围栏、`---`、`$$…$$`），必须照样占一组，否则后面的图片
 * 全部错位。实测 epub 的空 `<li>` 渲染成 `- `、空白 `<p>` 整段消失。
 */
const TEXT_ONLY_BLOCK_KINDS = new Set(['paragraph', 'heading']);

/**
 * 按文档顺序收集指向资产的图片节点，并给出每张图片在 Markdown 段落组序列中的位置。
 * anydoc 的 Markdown 渲染器不输出图片链接：独立成段的图片只剩 alt 文本、行内图片只剩
 * 句中的 alt、空 alt 图片整段消失。只有"整个块就是这一张图片"的段落能确定位置
 * （实测 epub/docx/pptx 的可渲染块与 Markdown 段落组一一对应，含备注的 pptx 也对齐）。
 */
function collectAssetImages(document: AnydocDocument): AnydocImageRef[] {
  const found: AnydocImageRef[] = [];
  let groupIndex = 0;
  for (const block of document.blocks ?? []) {
    const blockImages: Array<{ alt: string; assetId: number }> = [];
    assetImagesIn(block, blockImages);
    const kind = (block as { kind?: string }).kind;
    const rendered = inlineRenderText(block);
    const visible =
      kind === undefined || TEXT_ONLY_BLOCK_KINDS.has(kind) ? rendered.trim() !== '' : true;
    // 不可见的块（只剩一个锚点、或空 alt 图片）不占 Markdown 段落组
    const occupies = visible ? groupIndex++ : -1;
    const standalone =
      occupies !== -1 && kind === 'paragraph' && blockImages.length === 1;
    for (const image of blockImages) {
      found.push({
        ...image,
        paragraphIndex: standalone && rendered.trim() === image.alt.trim() ? occupies : null,
      });
    }
  }
  // 备注等非正文块里的图片仍要落盘，但没有可靠的行位置，只登记不锚定
  const notesImages: Array<{ alt: string; assetId: number }> = [];
  assetImagesIn(document.notes, notesImages);
  for (const image of notesImages) found.push({ ...image, paragraphIndex: null });
  return found;
}

/** 去掉 anydoc 写回文本时加的 Markdown 反斜杠转义，用于与原始 alt 比较。 */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!>~|$])/g, '$1');
}

/**
 * Markdown 的裸链接目标不接受空格、尖括号、未配对括号等字符，而 Office 文件名里
 * 空格和括号极其常见（`Q3 Report (final).docx`）。不编码的话图片渲染成一行字面文本，
 * 静默失效。百分号编码后渲染器会解回真实文件名，磁盘上的文件名本身不动。
 */
function markdownLinkDestination(target: string): string {
  return target.replace(/[ \t<>()%#?`\\]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/**
 * 链接文本里未配对的方括号会提前截断图片语法，整行退化成字面文本（实测 markdown-it
 * 对 `![A \[test] \ back](f.png)` 不产出 image token）。所以 alt 取块树里的原文，
 * 只按链接文本的规则转义反斜杠与方括号，不沿用渲染器那份"转义了 [ 却没转义 ]"的写法。
 */
function markdownLinkText(text: string): string {
  return text.replace(/[\\\[\]]/g, (char) => '\\' + char);
}

/**
 * 把图片链接写回 Markdown：按块顺序定位到"这张图片自己那一段"，并核对该段确实
 * 只剩 alt 文本才替换。早先按 alt 全文搜索的写法会把图片前面同名的正文段落当成
 * 图片占位（实测 `<p>Cat logo</p><p><img alt="Cat logo"></p>` 会错位），
 * 定位失败一律按未锚定处理——宁可少一个链接，也不改错用户的正文。
 * 链接里的 alt 沿用该行自己的文本，保住 anydoc 已经加好的转义。
 */
function anchorImagesInMarkdown(
  markdown: string,
  images: AnydocImageRef[],
  fileNameFor: (assetId: number) => string,
  assetDirName: string,
): { markdown: string; anchored: number[]; unanchored: AnydocImageRef[] } {
  if (images.length === 0) return { markdown, anchored: [], unanchored: [] };
  const lines = markdown.split('\n');
  // 段落组 = 连续的非空行；列表和表格各占一组（多行），组与可渲染块一一对应
  const groupLines: number[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const previous = i > 0 ? lines[i - 1].trim() : '';
    if (i === 0 || previous === '') groupLines.push([]);
    groupLines[groupLines.length - 1].push(i);
  }

  const anchored: number[] = [];
  const unanchored: AnydocImageRef[] = [];
  for (const [index, image] of images.entries()) {
    const group = image.paragraphIndex === null ? undefined : groupLines[image.paragraphIndex];
    const line = group?.length === 1 ? group[0] : undefined;
    const text = line === undefined ? '' : lines[line].trim();
    if (
      line === undefined ||
      text === '' ||
      unescapeMarkdown(text) !== unescapeMarkdown(image.alt)
    ) {
      unanchored.push(image);
      continue;
    }
    lines[line] =
      `![${markdownLinkText(image.alt)}](${markdownLinkDestination(`${assetDirName}/${fileNameFor(image.assetId)}`)})` +
      (lines[line].endsWith('\r') ? '\r' : '');
    anchored.push(index);
  }
  return { markdown: lines.join('\n'), anchored, unanchored };
}

/**
 * 汇总"OCR 已做过但结果仍疑似不完整"的页（含退化护栏命中的页），给出面向调用方
 * 的一条通知；无此类页时返回 `undefined`。
 *
 * 页码为 1-indexed（与 `pdfOcr` 相关告警、NAPI 保持一致）。
 */
function hostedRecommendedNotice(doc: NormalizedPdfDocument): string | undefined {
  const hostedPages = doc.pages
    .filter((p) => p.ocrProvenance?.hostedRecommended)
    .map((p) => p.pageIndex + 1);
  if (hostedPages.length === 0) return undefined;
  return (
    `${hostedPages.length} page(s) look incomplete after local OCR ` +
    `(1-indexed: ${hostedPages.join(', ')}); consider a hosted parser.`
  );
}

export class PptMasterService {
  private runner: PythonScriptRunner;

  constructor(runner?: PythonScriptRunner) {
    this.runner = runner ?? new PythonScriptRunner();
  }

  // ------------------------------------------------------------------
  // generate_presentation
  // ------------------------------------------------------------------

  async generatePresentation(options: GeneratePresentationOptions): Promise<GeneratePresentationResult> {
    const start = Date.now();

    try {
      await this.runner.checkPython();
      const missing = await this.runner.checkPackages(PRESENTATION_DEPS);
      if (missing.length > 0) {
        throw new Error(this.runner.formatMissingPackages(missing));
      }

      // Export mode: projectDir is provided
      if (options.projectDir) {
        return await this.exportPresentation(options, start);
      }

      // Prepare mode: create a project and import sources
      return await this.preparePresentation(options, start);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start },
      };
    }
  }

  private async exportPresentation(options: GeneratePresentationOptions, start: number): Promise<GeneratePresentationResult> {
    const projectDir = path.resolve(options.projectDir!);
    await fs.access(projectDir);

    const svgOutput = path.join(projectDir, 'svg_output');
    const svgFiles = (await fs.readdir(svgOutput).catch(() => [])).filter((f) => f.endsWith('.svg'));
    if (svgFiles.length === 0) {
      return {
        success: false,
        error: `No SVG files found in ${svgOutput}. Generate SVGs first (AI step) before exporting.`,
        details: { processingTime: Date.now() - start },
      };
    }

    // Run finalize_svg
    const finalizeResult = await this.runner.run('finalize_svg.py', [projectDir, '--quiet'], {
      timeoutMs: options.timeout ?? 120000,
    });
    if (finalizeResult.exitCode !== 0) {
      throw new Error(`finalize_svg failed:\n${finalizeResult.stdout}\n${finalizeResult.stderr}`);
    }

    // Run svg_to_pptx
    const pptxArgs = [projectDir];
    if (options.outputPath) pptxArgs.push('-o', path.resolve(options.outputPath));
    if (options.svgSource) pptxArgs.push('-s', options.svgSource);
    if (options.transition) pptxArgs.push('-t', options.transition);
    if (options.animation) pptxArgs.push('-a', options.animation);

    const pptxResult = await this.runner.run('svg_to_pptx.py', pptxArgs, {
      timeoutMs: options.timeout ?? 120000,
    });
    if (pptxResult.exitCode !== 0) {
      throw new Error(`svg_to_pptx failed:\n${pptxResult.stdout}\n${pptxResult.stderr}`);
    }

    // Determine output path
    let outputPath: string;
    if (options.outputPath) {
      outputPath = path.resolve(options.outputPath);
    } else {
      const match = pptxResult.stdout.match(/Output file:\s*(.+)/);
      if (match?.[1]) {
        outputPath = path.resolve(match[1].trim());
      } else {
        // Fallback: look for the most recent .pptx in exports/
        // （readdir 是字典序，必须按 mtime 取“最新”，否则会报告错误文件）
        const exportsDir = path.join(projectDir, 'exports');
        const pptxFiles = (await fs.readdir(exportsDir).catch(() => [])).filter((f) => f.endsWith('.pptx'));
        if (pptxFiles.length === 0) {
          throw new Error('svg_to_pptx succeeded but output path could not be determined');
        }
        let newest = pptxFiles[0]!;
        let newestMtime = -1;
        for (const f of pptxFiles) {
          const st = await fs.stat(path.join(exportsDir, f)).catch(() => null);
          if (st && st.mtimeMs > newestMtime) {
            newestMtime = st.mtimeMs;
            newest = f;
          }
        }
        outputPath = path.join(exportsDir, newest);
      }
    }

    return {
      success: true,
      projectDir,
      outputPath,
      message: `Exported ${svgFiles.length} slide(s) to ${outputPath}`,
      details: { processingTime: Date.now() - start, exported: true, svgCount: svgFiles.length },
    };
  }

  private async preparePresentation(options: GeneratePresentationOptions, start: number): Promise<GeneratePresentationResult> {
    const source = this.pickPrepareSource(options);
    if (!source) {
      return {
        success: false,
        error: 'Provide projectDir (export) or one of markdownContent/markdownPath/sourceUrl/sourceFile (prepare).',
        details: { processingTime: Date.now() - start },
      };
    }

    const projectDir = await this.runInitProject(options);
    await this.importSourceIntoProject(projectDir, source, options);

    return {
      success: true,
      projectDir,
      message: `Project prepared at ${projectDir}. Populate svg_output/ with SVGs, then call generate_presentation again with projectDir to export.`,
      details: { processingTime: Date.now() - start, exported: false },
    };
  }

  private pickPrepareSource(options: GeneratePresentationOptions):
    | { kind: 'markdown-content'; content: string }
    | { kind: 'markdown-path'; path: string }
    | { kind: 'url'; url: string }
    | { kind: 'file'; path: string }
    | null {
    if (options.markdownContent) return { kind: 'markdown-content', content: options.markdownContent };
    if (options.markdownPath) return { kind: 'markdown-path', path: options.markdownPath };
    if (options.sourceUrl) return { kind: 'url', url: options.sourceUrl };
    if (options.sourceFile) return { kind: 'file', path: options.sourceFile };
    return null;
  }

  private async runInitProject(options: GeneratePresentationOptions): Promise<string> {
    const baseDir = options.outputDir ? path.resolve(options.outputDir) : process.cwd();
    await fs.mkdir(baseDir, { recursive: true });

    const projectName =
      options.projectName ??
      (options.sourceFile
        ? path.basename(options.sourceFile, path.extname(options.sourceFile))
        : options.sourceUrl
          ? 'web_source'
          : 'presentation');

    const result = await this.runner.run(
      'project_manager.py',
      ['init', projectName, '--format', options.canvasFormat ?? 'ppt169', '--dir', baseDir],
      { timeoutMs: options.timeout ?? 120000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(`project_manager init failed:\n${result.stdout}\n${result.stderr}`);
    }

    // Parse project directory from output
    const match = result.stdout.match(/Project created:\s*(.+)/);
    if (match?.[1]) {
      return path.resolve(match[1].trim());
    }

    // Fallback: project_manager uses <name>_<format>_<date> naming
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return path.join(baseDir, `${projectName}_${options.canvasFormat ?? 'ppt169'}_${dateStr}`);
  }

  private async importSourceIntoProject(
    projectDir: string,
    source:
      | { kind: 'markdown-content'; content: string }
      | { kind: 'markdown-path'; path: string }
      | { kind: 'url'; url: string }
      | { kind: 'file'; path: string },
    options: GeneratePresentationOptions
  ): Promise<void> {
    let sourcePath: string;
    if (source.kind === 'markdown-content') {
      sourcePath = path.join(projectDir, 'sources', `imported_${Date.now()}.md`);
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, source.content, 'utf-8');
    } else if (source.kind === 'url') {
      sourcePath = source.url;
    } else {
      sourcePath = path.resolve(source.path);
      await fs.access(sourcePath);
    }

    const args = ['import-sources', projectDir, sourcePath, '--copy'];
    const result = await this.runner.run('project_manager.py', args, {
      timeoutMs: options.timeout ?? 120000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`project_manager import-sources failed:\n${result.stdout}\n${result.stderr}`);
    }
  }

  // ------------------------------------------------------------------
  // convert_to_markdown
  // ------------------------------------------------------------------

  async convertToMarkdown(options: ConvertToMarkdownOptions): Promise<ConvertToMarkdownResult> {
    const start = Date.now();
    // renderVectorFigures/vectorFigureDpi 需 @napi-rs/canvas，目前未实现；
    // 在 MCP schema 中暴露但未消费会让调用方误以为生效。stderr 供 server 日志，
    // warnings 随结果回传，让 MCP 调用方能感知参数被忽略。
    const notices: string[] = [];
    if (options.renderVectorFigures || options.vectorFigureDpi !== undefined) {
      const message =
        'renderVectorFigures/vectorFigureDpi are accepted but not implemented; ' +
        'PDF vector figure rendering requires @napi-rs/canvas and will be silently ignored.';
      console.warn(`[convert_to_markdown] ${message}`);
      notices.push(message);
    }

    const result = await this.convertToMarkdownInner(options, start);
    if (result.success) {
      const merged = [...notices, ...(result.warnings ?? [])];
      if (merged.length > 0) return { ...result, warnings: merged };
    }
    return result;
  }

  private async convertToMarkdownInner(
    options: ConvertToMarkdownOptions,
    start: number,
  ): Promise<ConvertToMarkdownResult> {
    try {
      const sourceType = options.sourceType && options.sourceType !== 'auto'
        ? options.sourceType
        : this.detectSourceType(options.source);

      // PDF 分支走纯 JS 引擎，不依赖 Python
      if (sourceType === 'pdf') {
        const outputPath = await this.resolveMarkdownOutputPath(options, sourceType);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        return await this.convertPdfToMarkdown(options, outputPath, start);
      }

      const outputPath = await this.resolveMarkdownOutputPath(options, sourceType);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Office 文档优先走 anydoc 纯 Rust 内核（免 Python/pandoc、毫秒级）。
      // 仅在文档本身无法转换（加密/不支持/损坏）时回退 Python 脚本。
      // 三个不回 anydoc 的分支：
      //   a) URL 源码（会 fs.readFile 一个不存在的路径）→ 强制 web/回退分支；
      //   b) Excel 指定 maxRows/maxCols（anydoc 无截断能力）→ 走 Python excel_to_md.py；
      //   c) anydoc 库加载失败（napi binary）→ 强制 Python fallback，server 仍可用。
      const limitedExcel =
        sourceType === 'excel' && (options.maxRows !== undefined || options.maxCols !== undefined);
      const anydocFormat =
        limitedExcel || sourceType === 'web' || /^https?:\/\//i.test(options.source)
          ? undefined
          : await this.anyDocFormat(options.source);
      if (anydocFormat) {
        try {
          return await this.convertOfficeToMarkdown(options, outputPath, start, anydocFormat, sourceType);
        } catch (error) {
          if (!this.isAnydocConversionError(error)) {
            throw error;
          }
          // 文档级转换失败（encrypted/unsupported/malformed 等）→ 尝试 Python 分支
        }
      }

      return await this.convertViaPython(options, sourceType, outputPath, start);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start, sourceType: options.sourceType ?? 'auto' },
      };
    }
  }

  /** anydoc 能直接转换该扩展名（PDF 除外，PDF 走自有引擎）。返回 undefined 时回退 Python。 */
  private async anyDocFormat(source: string): Promise<Format | undefined> {
    const api = await loadAnydoc();
    if (!api) return undefined;
    try {
      const fmt = api.formatFromExtension(path.extname(source).toLowerCase());
      return fmt === null || fmt === 'pdf' ? undefined : fmt;
    } catch {
      return undefined;
    }
  }

  private isAnydocConversionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    switch ((error as { code?: string }).code) {
      case 'unsupported':
      case 'malformed':
      case 'encrypted':
      case 'resourceLimit':
      case 'missingPart':
        return true;
      default:
        return false;
    }
  }

  /** 用 anydoc 把 Office 文档转换为 Markdown，并把内嵌资产（图片/嵌入对象）落盘到 <md>_files/。 */
  private async convertOfficeToMarkdown(
    options: ConvertToMarkdownOptions,
    outputPath: string,
    start: number,
    format: Format,
    sourceType: MarkdownSourceType,
  ): Promise<ConvertToMarkdownResult> {
    const api = await loadAnydoc();
    if (!api) {
      // 顶层 anyDocFormat 已确认可用，此处仅作类型守卫
      throw new Error('Anydoc unexpectedly unavailable');
    }

    const sourcePath = path.resolve(options.source);
    const bytes = await fs.readFile(sourcePath);

    // Node 绑定没有"从文档模型渲染 Markdown"的入口（0.2.4 依然如此），所以只能
    // 解析两次。并行只缓解、并不掩盖第二阶段的开销——实测 30k 行 xlsx：
    // 单跑 Markdown 329ms、单跑 toDocument 692ms、并行两者 783ms（串行求和 1021ms）。
    const [document, rawMarkdown] = await abandonAfter(
      Promise.all([api.toDocument(bytes, format), api.toMarkdownBytes(bytes, format)]),
      options.timeout ?? 120000,
      'anydoc conversion',
    );

    const stem = path.basename(outputPath, path.extname(outputPath));
    const fileNameFor = (assetId: number): string => {
      const mediaType = document.assets.find((asset) => asset.id === assetId)?.mediaType ?? '';
      return `${stem}-${assetId}.${this.assetExtension(mediaType)}`;
    };
    // 图片块只会引用已存在的资产，所以没有资产时不必遍历整棵块树：30k 行工作表上
    // 这次遍历要拉平约 24 万个单元格文本，实测省下来 200ms 左右。
    const images = document.assets.length === 0 ? [] : collectAssetImages(document);
    const anchoredImages = anchorImagesInMarkdown(
      rawMarkdown,
      images,
      fileNameFor,
      path.basename(this.deriveAssetDir(outputPath)),
    );

    // 先写 Markdown，成功后再落盘 assets，避免 md 写失败时留下孤立 _files/ 目录
    await fs.writeFile(outputPath, anchoredImages.markdown, 'utf-8');

    let assetsDir: string | undefined;
    let assetCount: number | undefined;
    if (document.assets.length > 0) {
      const dir = this.deriveAssetDir(outputPath);
      assetsDir = dir;
      await fs.mkdir(dir, { recursive: true });
      // 清掉上一轮残留的资产，否则旧图会混进新结果。只删上一轮
      // `image_manifest.json` 点名过的文件——那是我们自己写过的清单；按文件名模式猜会
      // 误伤用户放进这个目录的同形文件（`report-2024.png`）。
      const stale = await this.previousManifestFilenames(dir);
      await Promise.all(
        stale.map((name) => fs.rm(path.join(dir, name), { force: true })),
      );
      await Promise.all(
        document.assets.map((asset) =>
          fs.writeFile(path.join(dir, fileNameFor(asset.id)), asset.data)
        )
      );
      assetCount = document.assets.length;
      const manifest = this.buildImageManifest(document, images, fileNameFor, anchoredImages.anchored);
      await fs.writeFile(
        path.join(dir, 'image_manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        'utf-8',
      );
    }

    const warnings: string[] = [];
    if (anchoredImages.unanchored.length > 0) {
      warnings.push(
        `${anchoredImages.unanchored.length} embedded image(s) could not be linked into the Markdown ` +
          '(inline image or empty alt text); the files are in ' +
          `${assetsDir ?? 'the document (no assets extracted)'} and listed in image_manifest.json.`,
      );
    }

    return {
      success: true,
      markdownPath: outputPath,
      assetsDir,
      warnings: warnings.length > 0 ? warnings : undefined,
      details: {
        processingTime: Date.now() - start,
        sourceType,
        assetCount,
      },
    };
  }

  /**
   * `image_manifest.json`，与 Python 转换路径同名同字段风格。anydoc 的 Markdown
   * 不带图片链接，这份清单是调用方把正文位置对回文件的唯一依据。
   */
  private buildImageManifest(
    document: AnydocDocument,
    images: AnydocImageRef[],
    fileNameFor: (assetId: number) => string,
    anchoredIndexes: number[],
  ): Array<Record<string, unknown>> {
    const anchored = new Set(anchoredIndexes);
    const byAsset = new Map<number, Array<Record<string, unknown>>>();
    images.forEach((image, index) => {
      const occurrences = byAsset.get(image.assetId) ?? [];
      occurrences.push({
        occurrence_index: occurrences.length + 1,
        document_order: index + 1,
        alt: image.alt,
        linked_in_markdown: anchored.has(index),
      });
      byAsset.set(image.assetId, occurrences);
    });

    return document.assets.map((asset, position) => {
      const filename = fileNameFor(asset.id);
      const occurrences = byAsset.get(asset.id) ?? [];
      return {
        index: position + 1,
        filename,
        // 包内出处（如 word/media/image12.png）比我们的生成名更有信息量；
        // 没有任何块引用它时才是 0，别把"未使用"谎报成"用过一次"
        original_filename: asset.originPart ? path.basename(asset.originPart) : filename,
        asset_id: asset.id,
        source_kind: 'anydoc',
        source_ext: `.${this.assetExtension(asset.mediaType)}`,
        media_type: asset.mediaType,
        byte_size: asset.data.length,
        occurrences,
        usage_count: occurrences.length,
      };
    });
  }

  /** 上一轮 `image_manifest.json` 里记录的、本轮可以安全覆盖/删除的文件名。 */
  private async previousManifestFilenames(dir: string): Promise<string[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, 'image_manifest.json'), 'utf-8'));
    } catch {
      return [];  // 目录还没有清单，或清单不是我们写的格式：什么都不删
    }
    if (!Array.isArray(parsed)) return [];
    const names = new Set<string>();
    for (const entry of parsed) {
      const filename = (entry as { filename?: unknown })?.filename;
      // 清单里的名字只当本目录内的裸文件名处理，不接受路径分隔符
      if (typeof filename === 'string' && filename !== '.' && filename !== '..' && path.basename(filename) === filename) {
        names.add(filename);
      }
    }
    return [...names];
  }

  private assetExtension(mediaType: string): string {
    // mediaType 可带参数（image/png;charset=...），先截掉再取子类型
    const [kind, subtype] = mediaType.split(';')[0].trim().split('/');
    // 防御非标准 mediaType（如无 '/' 的裸类型名）与大小写不一的类型头
    if (kind?.toLowerCase() === 'image' && subtype) {
      const ext = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase();
      return ext || 'bin';
    }
    return 'bin';
  }

  /** Python 脚本回退：web 页（anydoc 不支持）与 anydoc 无法处理的文档格式。 */
  private async convertViaPython(
    options: ConvertToMarkdownOptions,
    sourceType: MarkdownSourceType,
    outputPath: string,
    start: number,
  ): Promise<ConvertToMarkdownResult> {
    await this.runner.checkPython();
    const missing = await this.runner.checkPackages(MARKDOWN_DEPS);
    if (missing.length > 0) {
      throw new Error(this.runner.formatMissingPackages(missing));
    }

    let script: string;
    let args: string[];
    switch (sourceType) {
      case 'doc':
        script = 'source_to_md/doc_to_md.py';
        args = [path.resolve(options.source), '-o', outputPath];
        break;
      case 'excel':
        // Python excel_to_md.py 仅支持 .xlsx/.xlsm；.xls/.xlsb/.ods/.csv 只有 anydoc 认。
        // 能走到这里必然是 maxRows/maxCols 触发了回退，报错要点名这个根因，
        // 否则用户以为是文件本身坏了。
        if (/\.(xls|xlsb|ods|csv)$/i.test(options.source)) {
          const ext = path.extname(options.source).toLowerCase();
          throw new Error(
            `maxRows/maxCols is not supported for ${ext} by the Python fallback ` +
              `${ext === '.xls' ? '(legacy binary workbook; openpyxl needs .xlsx)' : '(anydoc-only format)'}. ` +
              'Remove maxRows/maxCols to convert it with anydoc, or resave as .xlsx to truncate.'
          );
        }
        script = 'source_to_md/excel_to_md.py';
        args = [path.resolve(options.source), '-o', outputPath];
        if (options.maxRows !== undefined) args.push('--max-rows', String(options.maxRows));
        if (options.maxCols !== undefined) args.push('--max-cols', String(options.maxCols));
        break;
      case 'ppt':
        // .potx/.potm 是 PowerPoint Template 格式，anydoc 不识别（from_extension=null），
        // python-pptx 表面 SUPPORTED_FORMATS 包含但实际应作为模板由调用方先导出 .pptx。
        if (/\.(potx|potm)$/i.test(options.source)) {
          throw new Error(
            'PowerPoint template formats (.potx/.potm) are not supported by either conversion engine. Export to .pptx first.'
          );
        }
        // .ppt/.pps/.pot/.odp 是 anydoc 独享格式，python-pptx 真正不支持。
        if (/\.(ppt|pps|pot|odp)$/i.test(options.source)) {
          throw new Error(
            `PowerPoint fallback (python-pptx) does not support ${path.extname(options.source).toLowerCase()}. ` +
              'The anydoc engine should have handled this; if you reached this branch, the source file is unsupported.'
          );
        }
        script = 'source_to_md/ppt_to_md.py';
        args = [path.resolve(options.source), '-o', outputPath];
        break;
      case 'web':
        script = 'source_to_md/web_to_md.py';
        args = [options.source, '-o', outputPath];
        break;
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }

    const result = await this.runner.run(script, args, { timeoutMs: options.timeout ?? 120000 });
    if (result.exitCode !== 0) {
      throw new Error(`source_to_md failed:\n${result.stdout}\n${result.stderr}`);
    }

    const assetsDir = await this.locateAssetsDir(outputPath);
    const assetCount = assetsDir
      ? (await fs.readdir(assetsDir).catch(() => [])).filter((e) => !e.endsWith('manifest.json')).length
      : undefined;

    const warnings: string[] = [];
    if (
      sourceType === 'excel' &&
      (options.maxRows !== undefined || options.maxCols !== undefined)
    ) {
      warnings.push(
        'Excel truncation runs the Python engine, which ignores cell number formats: ' +
          'percentages, currency and thousands separators come out as raw numbers (anydoc applies them).'
      );
    }

    return {
      success: true,
      markdownPath: outputPath,
      assetsDir,
      warnings: warnings.length > 0 ? warnings : undefined,
      details: { processingTime: Date.now() - start, sourceType, assetCount },
    };
  }

  private detectSourceType(source: string): MarkdownSourceType {
    if (/^https?:\/\//i.test(source)) return 'web';
    const ext = path.extname(source).toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (['.docx', '.doc', '.docm', '.odt', '.rtf', '.epub', '.html', '.htm', '.ipynb', '.tex', '.latex', '.rst', '.org', '.typ'].includes(ext)) {
      return 'doc';
    }
    if (['.xlsx', '.xlsm', '.xls', '.xlsb', '.ods', '.csv'].includes(ext)) return 'excel';
    if (['.pptx', '.pptm', '.ppsx', '.ppsm', '.ppt', '.pps', '.pot', '.odp'].includes(ext)) return 'ppt';
    throw new Error(`Cannot detect source type for ${source}. Provide sourceType explicitly.`);
  }

  private async resolveMarkdownOutputPath(options: ConvertToMarkdownOptions, sourceType: MarkdownSourceType): Promise<string> {
    if (options.outputPath) return path.resolve(options.outputPath);
    if (sourceType === 'web') {
      return path.join(process.cwd(), `web_${Date.now()}.md`);
    }
    const sourcePath = path.resolve(options.source);
    const parsed = path.parse(sourcePath);
    return path.join(parsed.dir, `${parsed.name}.md`);
  }

  private deriveAssetDir(markdownPath: string): string {
    return markdownPath.replace(/\.md$/i, '_files');
  }

  private async locateAssetsDir(markdownPath: string): Promise<string | undefined> {
    const candidate = this.deriveAssetDir(markdownPath);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // no companion assets
    }
    return undefined;
  }

  private async convertPdfToMarkdown(
    options: ConvertToMarkdownOptions,
    outputPath: string,
    start: number,
  ): Promise<ConvertToMarkdownResult> {
    const pdfPath = path.resolve(options.source);
    const imageOutput = options.pdfImages ?? 'filtered';

    if (imageOutput !== 'none') {
      console.warn(
        '[convert_to_markdown] pdfImages=' + imageOutput + ' is a no-op for PDF: ' +
        '@firecrawl/pdf-inspector does not return raw image bytes. Use screenshot_pdf for page images.',
      );
    }

    const { markdown, notices } = await this.extractPdfMarkdownWithOcr(
      pdfPath,
      options.pdfOcr ?? 'auto',
    );

    await fs.writeFile(outputPath, markdown, 'utf-8');

    return {
      success: true,
      markdownPath: outputPath,
      warnings: notices.length > 0 ? notices : undefined,
      details: { processingTime: Date.now() - start, sourceType: 'pdf' },
    };
  }

  /**
   * PDF→markdown 提取，按 pdfOcr 语义路由：
   * - 'auto'（默认）：先轻量分类；纯文本页走原生提取（零 OCR 开销），存在需 OCR
   *   页时本地 PP-OCRv6 选择性 OCR。OCR 运行时缺失/模型获取失败 → 回退原生提取
   *   （扫描页文本可能不完整）并告警，绝不因 OCR 失败整体失败。
   * - 'force'：跳过分类直接全页 OCR；失败直接抛错（显式请求不给静默降级）。
   * - 'off'：仅原生提取（历史行为）。
   *
   * `notices` 同时写 stderr 和随结果回传：生成的 .md 内容保持原样（不改写产物），
   * 但调用方必须能在结果里看到"某页不可采信/已降级"的信号——MCP client 与普通
   * 调用方看不到 stderr，只写日志等于静默降级。
   */
  private async extractPdfMarkdownWithOcr(
    pdfPath: string,
    pdfOcr: 'off' | 'auto' | 'force',
  ): Promise<{ markdown: string; notices: string[] }> {
    const nativeMarkdown = async (): Promise<{ markdown: string; notices: string[] }> => ({
      markdown: (await extractMarkdown(pdfPath)).markdown,
      notices: [],
    });
    if (pdfOcr === 'off') {
      return nativeMarkdown();
    }

    // hostedRecommended 页面告警：OCR 已完成但结果仍疑似不完整
    const markdownFrom = (doc: NormalizedPdfDocument): { markdown: string; notices: string[] } => {
      const notice = hostedRecommendedNotice(doc);
      if (notice) console.warn(`[convert_to_markdown] ${notice}`);
      return {
        markdown: doc.pages.map((p) => p.markdown).join('\n\n'),
        notices: notice ? [notice] : [],
      };
    };

    if (pdfOcr === 'auto') {
      // 分类失败（损坏/加密等）→ 直接原生提取，由原生路径给出真实错误，
      // 不误报为 OCR 运行时问题，也不重复执行提取。
      let pagesNeedingOcr: number[];
      try {
        ({ pagesNeedingOcr } = await classifyPdf(pdfPath));
      } catch {
        return nativeMarkdown();
      }
      if (pagesNeedingOcr.length === 0) {
        return nativeMarkdown();
      }
      console.warn(
        `[convert_to_markdown] PDF has ${pagesNeedingOcr.length} page(s) needing OCR ` +
          `(1-indexed: ${pagesNeedingOcr.map((p) => p + 1).join(', ')}); running local PP-OCRv6.`,
      );
      try {
        const doc = await processPdfWithOcrFor(pdfPath, { mode: 'Auto' });
        return markdownFrom(doc);
      } catch (err) {
        const message =
          `Local OCR unavailable (${err instanceof Error ? err.message : String(err)}); ` +
          'falling back to native extraction, scanned-page text may be incomplete.';
        console.warn(`[convert_to_markdown] ${message}`);
        const { markdown } = await extractMarkdown(pdfPath);
        return { markdown, notices: [message] };
      }
    }

    // force：显式请求不给静默降级，失败直接抛错。
    const doc = await processPdfWithOcrFor(pdfPath, { mode: 'Force' });
    return markdownFrom(doc);
  }
}
