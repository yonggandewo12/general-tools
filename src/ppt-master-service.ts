import { promises as fs } from 'fs';
import * as path from 'path';
import type { Format } from '@firecrawl/anydoc';
import { PythonScriptRunner } from './python-runner.js';
import { extractMarkdown } from './pdf-inspector-service.js';
import {
  GeneratePresentationOptions,
  GeneratePresentationResult,
  GenerateImageOptions,
  GenerateImageResult,
  ConvertToMarkdownOptions,
  ConvertToMarkdownResult,
  MarkdownSourceType,
} from './types.js';

const PRESENTATION_DEPS = ['pptx', 'svglib', 'reportlab', 'PIL'];
const MARKDOWN_DEPS = ['mammoth', 'markdownify', 'openpyxl', 'pptx', 'PIL', 'requests', 'bs4'];

// anydoc 通过 napi-rs 加载 native binary，若系统库缺失或平台不支持，
// 加载会抛异常。要求整个 MCP server 启动时仍可用，因此改为按需动态 import。
// 加载失败时强制走 Python fallback（详见 README "安装" 段）。
type AnydocApi = {
  formatFromExtension: (ext: string) => Format | null;
  toDocument: (bytes: Uint8Array, format: Format) => Promise<{ assets: Array<{ id: number; mediaType: string; data: Buffer }> }>;
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
        const exportsDir = path.join(projectDir, 'exports');
        const pptxFiles = (await fs.readdir(exportsDir).catch(() => [])).filter((f) => f.endsWith('.pptx'));
        if (pptxFiles.length === 0) {
          throw new Error('svg_to_pptx succeeded but output path could not be determined');
        }
        outputPath = path.join(exportsDir, pptxFiles[pptxFiles.length - 1]);
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
  // generate_image
  // ------------------------------------------------------------------

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    const start = Date.now();
    try {
      await this.runner.checkPython();

      const outputDir = options.outputDir ? path.resolve(options.outputDir) : process.cwd();
      await fs.mkdir(outputDir, { recursive: true });

      const filename = options.filename ?? `img_${Date.now()}`;
      const env: Record<string, string | undefined> = {};
      if (options.backend) {
        env.IMAGE_BACKEND = options.backend;
      }

      const args = [
        options.prompt,
        '--aspect_ratio', options.aspectRatio ?? '16:9',
        '--image_size', options.imageSize ?? '1K',
        '-o', outputDir,
        '-f', filename,
      ];
      if (options.model) args.push('-m', options.model);
      if (options.referenceImage) args.push('--reference_image', options.referenceImage);

      const before = await this.listImageFiles(outputDir);
      const result = await this.runner.run('image_gen.py', args, {
        env,
        timeoutMs: options.timeout ?? 120000,
      });
      if (result.exitCode !== 0) {
        throw new Error(`image_gen failed:\n${result.stdout}\n${result.stderr}`);
      }

      const after = await this.listImageFiles(outputDir);
      const newFiles = after.filter((f) => !before.includes(f));
      const imagePath = newFiles.length === 1
        ? path.join(outputDir, newFiles[0])
        : await this.findGeneratedFile(outputDir, filename);

      return {
        success: true,
        imagePath,
        details: { processingTime: Date.now() - start, backend: options.backend },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start },
      };
    }
  }

  private async listImageFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir).catch(() => []);
    return entries.filter((e) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(e));
  }

  private async findGeneratedFile(dir: string, stem: string): Promise<string> {
    const entries = await fs.readdir(dir);
    const matches = entries.filter((e) => e.startsWith(stem) && /\.(png|jpe?g|gif|webp|bmp)$/i.test(e));
    if (matches.length === 0) {
      throw new Error(`Could not locate generated image in ${dir}`);
    }
    const stats = await Promise.all(
      matches.map(async (m) => ({ name: m, mtime: (await fs.stat(path.join(dir, m))).mtime }))
    );
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return path.join(dir, stats[0].name);
  }

  // ------------------------------------------------------------------
  // convert_to_markdown
  // ------------------------------------------------------------------

  async convertToMarkdown(options: ConvertToMarkdownOptions): Promise<ConvertToMarkdownResult> {
    const start = Date.now();
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

    // anydoc 0.1.9 没有 from-document API，必须独立解析两次。
    // 两次都是 CPU 密集（parse + render），并发可掩盖第二阶段的延迟。
    const [document, markdown] = await Promise.all([
      api.toDocument(bytes, format),
      api.toMarkdownBytes(bytes, format),
    ]);

    // 先写 Markdown，成功后再落盘 assets，避免 md 写失败时留下孤立 _files/ 目录
    await fs.writeFile(outputPath, markdown, 'utf-8');

    let assetsDir: string | undefined;
    let assetCount: number | undefined;
    if (document.assets.length > 0) {
      const dir = this.deriveAssetDir(outputPath);
      assetsDir = dir;
      await fs.mkdir(dir, { recursive: true });
      const stem = path.basename(outputPath, path.extname(outputPath));
      await Promise.all(
        document.assets.map((asset) =>
          fs.writeFile(
            path.join(dir, `${stem}-${asset.id}.${this.assetExtension(asset.mediaType)}`),
            asset.data,
          )
        )
      );
      assetCount = document.assets.length;
    }

    return {
      success: true,
      markdownPath: outputPath,
      assetsDir,
      details: {
        processingTime: Date.now() - start,
        sourceType,
        assetCount,
      },
    };
  }

  private assetExtension(mediaType: string): string {
    const [kind, subtype] = mediaType.split('/');
    // 防御非标准 mediaType（如无 '/' 的裸类型名）
    if (kind === 'image' && subtype) {
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
        // Python excel_to_md.py 仅支持 .xlsx/.xlsm。其他扩展名（.xls/.xlsb/.ods/.csv）
        // 是 anydoc 独享格式，maxRows 截断本身不适用；用户想要截断请先另存为 .xlsx。
        if (/\.(xlsb|ods|csv)$/i.test(options.source)) {
          throw new Error(
            `maxRows/maxCols is not supported for ${path.extname(options.source).toLowerCase()} (anydoc-only). ` +
              'Resave as .xlsx first, or omit maxRows/maxCols to use the anydoc engine.'
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

    return {
      success: true,
      markdownPath: outputPath,
      assetsDir,
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

    const { markdown, pagesNeedingOcr } = await extractMarkdown(pdfPath);

    if (pagesNeedingOcr.length > 0) {
      console.warn(
        `[convert_to_markdown] PDF has ${pagesNeedingOcr.length} page(s) flagged for OCR: ` +
          pagesNeedingOcr.map((p) => p + 1).join(', ') +
          '. Native text may be incomplete.',
      );
    }

    await fs.writeFile(outputPath, markdown, 'utf-8');

    return {
      success: true,
      markdownPath: outputPath,
      details: { processingTime: Date.now() - start, sourceType: 'pdf' },
    };
  }
}
