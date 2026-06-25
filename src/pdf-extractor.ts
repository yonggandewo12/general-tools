import { promises as fs } from 'fs';
import * as path from 'path';
import {
  PdfExtractOptions,
  PdfExtractResult,
  PdfScreenshotOptions,
  PdfScreenshotResult,
} from './types.js';

let LiteParseClass: typeof import('@llamaindex/liteparse').LiteParse | null = null;

async function getLiteParse(): Promise<typeof import('@llamaindex/liteparse').LiteParse> {
  if (!LiteParseClass) {
    try {
      const mod = await import('@llamaindex/liteparse');
      LiteParseClass = mod.LiteParse;
    } catch (err) {
      throw new Error(
        'Failed to load @llamaindex/liteparse. Please ensure it is installed: npm install @llamaindex/liteparse'
      );
    }
  }
  return LiteParseClass!;
}

export class PdfExtractor {
  async extract(options: PdfExtractOptions): Promise<PdfExtractResult> {
    const start = Date.now();

    try {
      const pdfFilePath = path.resolve(options.pdfPath);
      await fs.access(pdfFilePath);

      const LiteParse = await getLiteParse();
      const parser = new LiteParse({
        outputFormat: options.outputFormat ?? 'text',
        targetPages: options.targetPages,
        ocrEnabled: options.ocrEnabled ?? false,
        ocrLanguage: options.ocrLanguage,
        ocrServerUrl: options.ocrServerUrl,
        maxPages: options.maxPages,
        dpi: options.dpi,
        imageMode: options.imageMode ?? 'off',
        password: options.password,
        quiet: true,
      });

      const result = await parser.parse(pdfFilePath);

      return {
        success: true,
        text: result.text,
        pages: result.pages.map((p) => ({
          pageNum: p.pageNum,
          width: p.width,
          height: p.height,
          text: p.text,
        })),
        pageCount: result.pages.length,
        details: { processingTime: Date.now() - start },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start },
      };
    }
  }

  async screenshot(options: PdfScreenshotOptions): Promise<PdfScreenshotResult> {
    const start = Date.now();

    try {
      const pdfFilePath = path.resolve(options.pdfPath);
      await fs.access(pdfFilePath);

      const outputDir = options.outputDir
        ? path.resolve(options.outputDir)
        : process.cwd();
      await fs.mkdir(outputDir, { recursive: true });

      const LiteParse = await getLiteParse();
      const parser = new LiteParse({
        dpi: options.dpi ?? 150,
        password: options.password,
        quiet: true,
      });

      let pageNumbers: number[] | undefined;
      if (options.targetPages) {
        pageNumbers = this.parseTargetPages(options.targetPages);
      }

      const results = await parser.screenshot(pdfFilePath, pageNumbers);

      const screenshots = [];
      for (const r of results) {
        const outputPath = path.join(outputDir, `screenshot_p${r.pageNum}.png`);
        await fs.writeFile(outputPath, r.imageBuffer);
        screenshots.push({
          pageNum: r.pageNum,
          width: r.width,
          height: r.height,
          outputPath,
        });
      }

      return {
        success: true,
        screenshots,
        details: { processingTime: Date.now() - start },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start },
      };
    }
  }

  private parseTargetPages(targetPages: string): number[] {
    const pages: number[] = [];
    for (const part of targetPages.split(',')) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(Number);
        for (let i = start; i <= end; i++) {
          pages.push(i);
        }
      } else {
        pages.push(Number(trimmed));
      }
    }
    return pages;
  }
}
