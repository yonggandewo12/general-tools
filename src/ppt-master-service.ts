import { promises as fs } from 'fs';
import * as path from 'path';
import { PythonScriptRunner } from './python-runner.js';
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
const MARKDOWN_DEPS = ['fitz', 'mammoth', 'markdownify', 'openpyxl', 'pptx', 'PIL', 'requests', 'bs4'];

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
      await this.runner.checkPython();
      const missing = await this.runner.checkPackages(MARKDOWN_DEPS);
      if (missing.length > 0) {
        throw new Error(this.runner.formatMissingPackages(missing));
      }

      const sourceType = options.sourceType ?? this.detectSourceType(options.source);
      const outputPath = await this.resolveMarkdownOutputPath(options, sourceType);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      let script: string;
      let args: string[];

      switch (sourceType) {
        case 'pdf':
          script = 'source_to_md/pdf_to_md.py';
          args = [path.resolve(options.source), '-o', outputPath];
          if (options.pdfImages) args.push('--images', options.pdfImages);
          if (options.renderVectorFigures) args.push('--render-vector-figures');
          if (options.vectorFigureDpi) args.push('--vector-figure-dpi', String(options.vectorFigureDpi));
          break;
        case 'doc':
          script = 'source_to_md/doc_to_md.py';
          args = [path.resolve(options.source), '-o', outputPath];
          break;
        case 'excel':
          script = 'source_to_md/excel_to_md.py';
          args = [path.resolve(options.source), '-o', outputPath];
          if (options.maxRows !== undefined) args.push('--max-rows', String(options.maxRows));
          if (options.maxCols !== undefined) args.push('--max-cols', String(options.maxCols));
          break;
        case 'ppt':
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
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start, sourceType: options.sourceType ?? 'auto' },
      };
    }
  }

  private detectSourceType(source: string): MarkdownSourceType {
    if (/^https?:\/\//i.test(source)) return 'web';
    const ext = path.extname(source).toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (['.docx', '.doc', '.odt', '.rtf', '.epub', '.html', '.htm', '.ipynb', '.tex', '.latex', '.rst', '.org', '.typ'].includes(ext)) {
      return 'doc';
    }
    if (['.xlsx', '.xlsm'].includes(ext)) return 'excel';
    if (['.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm'].includes(ext)) return 'ppt';
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

  private async locateAssetsDir(markdownPath: string): Promise<string | undefined> {
    const candidate = markdownPath.replace(/\.md$/i, '_files');
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // no companion assets
    }
    return undefined;
  }
}
