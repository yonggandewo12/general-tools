import { promises as fs } from 'fs';
import * as path from 'path';
import { parseDocument } from './pdf-engine/index.js';
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

      const result = await parseDocument(pdfFilePath, {
        outputFormat: options.outputFormat ?? 'text',
        targetPages: options.targetPages ? parsePages(options.targetPages) : undefined,
        maxPages: options.maxPages,
        password: options.password,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          details: { processingTime: Date.now() - start },
        };
      }

      return {
        success: true,
        text: result.text ?? result.markdown ?? (result.json ? JSON.stringify(result.json) : ''),
        pageCount: result.pageCount,
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

function parsePages(spec: string): number[] {
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`Invalid page range: "${spec}"`);
    if (trimmed.includes('-')) {
      const dash = trimmed.indexOf('-');
      const startRaw = trimmed.slice(0, dash);
      const endRaw = trimmed.slice(dash + 1);
      if (!startRaw || !endRaw) throw new Error(`Invalid page range: "${spec}"`);
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
        throw new Error(`Invalid page range: "${spec}"`);
      }
      if (start > end) throw new Error(`Invalid page range (start > end): "${spec}"`);
      for (let i = start; i <= end; i++) {
        if (!seen.has(i)) {
          seen.add(i);
          pages.push(i);
        }
      }
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid page range: "${spec}"`);
      if (!seen.has(n)) {
        seen.add(n);
        pages.push(n);
      }
    }
  }
  return pages;
}
