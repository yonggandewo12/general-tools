import puppeteer, { Browser, PDFOptions as PuppeteerPDFOptions } from 'puppeteer';
import { promises as fs } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ConvertOptions, ConvertResult, ConvertImageOptions, ImageConvertResult } from './types.js';

export class PdfConverter {
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;

  /**
   * Initialize browser instance with connection pooling
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    try {
      this.browser = await this.browserPromise;
      return this.browser;
    } finally {
      this.browserPromise = null;
    }
  }

  /**
   * Convert HTML to PDF
   */
  async convertToPdf(options: ConvertOptions): Promise<ConvertResult> {
    const startTime = Date.now();
    let page = null;

    try {
      // Validate input
      if (!options.htmlPath && !options.htmlContent) {
        throw new Error('Either htmlPath or htmlContent must be provided');
      }

      // Get or create browser instance
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Set viewport to match paper format for correct Mermaid scaling
      // scaleMermaidDiagrams() uses document.documentElement.clientHeight
      // which must reflect the PDF page height, not the default 600px viewport
      const FORMAT_DIMENSIONS: Record<string, { width: number; height: number }> = {
        A4: { width: 794, height: 1123 },
        A3: { width: 1123, height: 1587 },
        Letter: { width: 816, height: 1055 },
        Legal: { width: 816, height: 1346 },
        Tabloid: { width: 1055, height: 1633 },
      };
      const fmt = options.format || 'A4';
      const dims = FORMAT_DIMENSIONS[fmt] || FORMAT_DIMENSIONS.A4!;
      await page.setViewport(
        options.landscape
          ? { width: dims.height, height: dims.width }
          : { width: dims.width, height: dims.height },
      );

      // Set timeout
      const timeout = options.timeout || 30000;
      page.setDefaultTimeout(timeout);

      // Load HTML content
      if (options.htmlPath) {
        const htmlPath = path.resolve(options.htmlPath);
        await fs.access(htmlPath); // Check file exists
        const fileUrl = pathToFileURL(htmlPath).href;

        const waitUntil = options.waitForNetworkIdle ? 'networkidle0' : 'load';
        await page.goto(fileUrl, {
          waitUntil,
          timeout
        });
      } else if (options.htmlContent) {
        await page.setContent(options.htmlContent, {
          waitUntil: options.waitForNetworkIdle ? 'networkidle0' : 'load',
          timeout
        });
      }

      // Wait a bit for any dynamic content to render
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          // @ts-ignore - document and window are available in browser context
          if (document.readyState === 'complete') {
            resolve();
          } else {
            // @ts-ignore - document and window are available in browser context
            window.addEventListener('load', () => resolve());
          }
        });
      });

      // 等待 Mermaid 渲染完成（如果 HTML 中包含 mermaid 脚本）
      if (options.waitForMermaid) {
        try {
          await page.waitForFunction('window.__mermaidDone === true', { timeout: 30000 });
        } catch (e) {
          // timeout — 继续生成 PDF，不阻塞
        }
      }

      // Prepare PDF options
      const pdfOptions: PuppeteerPDFOptions = {
        format: options.format || 'A4',
        landscape: options.landscape || false,
        printBackground: options.printBackground !== false, // default true
        scale: options.scale || 1,
        displayHeaderFooter: options.displayHeaderFooter || false,
        preferCSSPageSize: options.preferCSSPageSize || false,
        margin: {
          top: options.marginTop || '10mm',
          bottom: options.marginBottom || '10mm',
          left: options.marginLeft || '10mm',
          right: options.marginRight || '10mm'
        }
      };

      if (options.headerTemplate) {
        pdfOptions.headerTemplate = options.headerTemplate;
      }
      if (options.footerTemplate) {
        pdfOptions.footerTemplate = options.footerTemplate;
      }

      // Generate output path if not provided
      let outputPath = options.outputPath;
      if (!outputPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputPath = path.join(process.cwd(), `output-${timestamp}.pdf`);
      } else {
        outputPath = path.resolve(outputPath);
      }

      // Generate PDF
      if (outputPath) {
        pdfOptions.path = outputPath;
      }

      await page.pdf(pdfOptions);

      // Get file size
      let fileSize: number | undefined;
      try {
        const stats = await fs.stat(outputPath);
        fileSize = stats.size;
      } catch (e) {
        // Ignore error
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        outputPath,
        details: {
          processingTime,
          fileSize
        }
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: {
          processingTime
        }
      };
    } finally {
      // Close the page to free resources
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Convert HTML to image (PNG/JPEG)
   */
  async convertToImage(options: ConvertImageOptions): Promise<ImageConvertResult> {
    const startTime = Date.now();
    let page = null;

    try {
      // Validate input
      if (!options.htmlPath && !options.htmlContent) {
        throw new Error('Either htmlPath or htmlContent must be provided');
      }

      const imageFormat = options.imageFormat || 'png';
      const quality = options.quality ?? 90;
      const fullPage = options.fullPage ?? false;
      const imageScale = options.imageScale ?? 1;

      // Get or create browser instance
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Set viewport — use a wide viewport to avoid layout shifts
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: imageScale,
      });

      const timeout = options.timeout || 30000;
      page.setDefaultTimeout(timeout);

      // Load HTML content
      if (options.htmlPath) {
        const htmlPath = path.resolve(options.htmlPath);
        await fs.access(htmlPath);
        const fileUrl = pathToFileURL(htmlPath).href;
        const waitUntil = options.waitForNetworkIdle ? 'networkidle0' : 'load';
        await page.goto(fileUrl, { waitUntil, timeout });
      } else if (options.htmlContent) {
        await page.setContent(options.htmlContent, {
          waitUntil: options.waitForNetworkIdle ? 'networkidle0' : 'load',
          timeout,
        });
      }

      // Wait for dynamic content to render
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          // @ts-ignore - browser context
          if (document.readyState === 'complete') {
            resolve();
          } else {
            // @ts-ignore - browser context
            window.addEventListener('load', () => resolve());
          }
        });
      });

      // Wait for Mermaid if requested
      if (options.waitForMermaid) {
        try {
          await page.waitForFunction('window.__mermaidDone === true', { timeout: 30000 });
        } catch (e) {
          // timeout — continue
        }
      }

      // Prepare screenshot options
      const screenshotOptions: Parameters<typeof page.screenshot>[0] = {
        type: imageFormat === 'jpeg' ? 'jpeg' : 'png',
        quality: imageFormat === 'jpeg' ? quality : undefined,
        fullPage,
      };

      // Determine output path
      let outputPath = options.outputPath;
      if (!outputPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = imageFormat === 'jpeg' ? 'jpg' : 'png';
        outputPath = path.join(process.cwd(), `output-${timestamp}.${ext}`);
      } else {
        outputPath = path.resolve(outputPath);
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(outputPath);
      await fs.mkdir(parentDir, { recursive: true }).catch(() => {});

      // Take screenshot
      await page.screenshot({
        ...screenshotOptions,
        path: outputPath,
      });

      // Get file info
      let fileSize: number | undefined;
      let width: number | undefined;
      let height: number | undefined;
      try {
        const stats = await fs.stat(outputPath);
        fileSize = stats.size;
      } catch (e) {
        // Ignore
      }
      try {
        if (fullPage) {
          const contentSize = await page.evaluate(() => {
            // @ts-ignore - browser context
            const html = document.documentElement;
            return { width: html.scrollWidth, height: html.scrollHeight };
          });
          width = contentSize.width * imageScale;
          height = contentSize.height * imageScale;
        } else {
          const viewport = page.viewport();
          width = (viewport?.width ?? 1920) * imageScale;
          height = (viewport?.height ?? 1080) * imageScale;
        }
      } catch {
        // Ignore
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        outputPath,
        details: {
          processingTime,
          fileSize,
          width,
          height,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: {
          processingTime,
        },
      };
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Close browser and cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
