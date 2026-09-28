/**
 * PDF screenshot via LiteParse (page → PNG).
 *
 * Text/markdown/json extraction moved to `pdf-extract-adapter.ts` (uses @firecrawl/pdf-inspector).
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import type { PdfScreenshotOptions, PdfScreenshotResult } from './types.js';
import { parsePages } from './pdf-extract-adapter.js';

let LiteParseClass: typeof import('@llamaindex/liteparse').LiteParse | null = null;

async function getLiteParse(): Promise<typeof import('@llamaindex/liteparse').LiteParse> {
  if (!LiteParseClass) {
    try {
      const mod = await import('@llamaindex/liteparse');
      LiteParseClass = mod.LiteParse;
    } catch (err) {
      throw new Error(
        'Failed to load @llamaindex/liteparse. Please ensure it is installed: npm install @llamaindex/liteparse',
      );
    }
  }
  return LiteParseClass!;
}

export class PdfExtractor {
  async screenshot(options: PdfScreenshotOptions): Promise<PdfScreenshotResult> {
    const start = Date.now();

    try {
      const pdfFilePath = path.resolve(options.pdfPath);
      await fs.access(pdfFilePath);

      // 未指定目录时落到带时间戳的子目录，避免多次调用在 cwd 里互相覆盖
      // screenshot_p<N>.png（显式指定 outputDir 时保持文件名可预期，由调用方管冲突）。
      const outputDir = options.outputDir
        ? path.resolve(options.outputDir)
        : path.join(process.cwd(), `pdf-screenshots-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      await fs.mkdir(outputDir, { recursive: true });

      const LiteParse = await getLiteParse();
      const parser = new LiteParse({
        dpi: options.dpi ?? 150,
        password: options.password,
        quiet: true,
      });

      let pageNumbers: number[] | undefined;
      if (options.targetPages) {
        pageNumbers = parsePages(options.targetPages);
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
}
