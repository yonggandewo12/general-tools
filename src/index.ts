#!/usr/bin/env node

import { promises as fs } from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { PdfConverter } from './pdf-converter.js';
import { MdConverter } from './md-converter.js';
import { ConvertOptions, MdToPdfOptions, ConvertImageOptions, OcrOptions } from './types.js';
import { OcrService } from './ocr-service.js';

const converter = new PdfConverter();
const mdConverter = new MdConverter();
const ocrService = new OcrService();

const CONVERT_HTML_TO_PDF_TOOL: Tool = {
  name: 'convert_html_to_pdf',
  description: 'Convert HTML file or HTML content to PDF with browser rendering. Supports CSS, JavaScript, and external resources.',
  inputSchema: {
    type: 'object',
    properties: {
      htmlPath: {
        type: 'string',
        description: 'Path to HTML file to convert (absolute or relative to current working directory)'
      },
      htmlContent: {
        type: 'string',
        description: 'HTML content string to convert (alternative to htmlPath)'
      },
      outputPath: {
        type: 'string',
        description: 'Output PDF file path (default: auto-generated with timestamp in current directory)'
      },
      format: {
        type: 'string',
        enum: ['A4', 'A3', 'Letter', 'Legal', 'Tabloid'],
        description: 'Paper format (default: A4)'
      },
      landscape: {
        type: 'boolean',
        description: 'Use landscape orientation (default: false)'
      },
      printBackground: {
        type: 'boolean',
        description: 'Print background graphics (default: true)'
      },
      scale: {
        type: 'number',
        description: 'Scale of the webpage rendering (default: 1, range: 0.1 to 2)'
      },
      marginTop: {
        type: 'string',
        description: 'Top margin (default: 10mm, accepts px, cm, in, mm)'
      },
      marginBottom: {
        type: 'string',
        description: 'Bottom margin (default: 10mm)'
      },
      marginLeft: {
        type: 'string',
        description: 'Left margin (default: 10mm)'
      },
      marginRight: {
        type: 'string',
        description: 'Right margin (default: 10mm)'
      },
      displayHeaderFooter: {
        type: 'boolean',
        description: 'Display header and footer (default: false)'
      },
      headerTemplate: {
        type: 'string',
        description: 'HTML template for header'
      },
      footerTemplate: {
        type: 'string',
        description: 'HTML template for footer'
      },
      waitForNetworkIdle: {
        type: 'boolean',
        description: 'Wait for network to be idle before generating PDF (default: false)'
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait for page load in milliseconds (default: 30000)'
      }
    }
  }
};

const CONVERT_HTML_TO_IMAGE_TOOL: Tool = {
  name: 'convert_html_to_image',
  description: 'Convert HTML file or HTML content to an image (PNG/JPEG) with browser rendering. Supports full-page or viewport screenshots.',
  inputSchema: {
    type: 'object',
    properties: {
      htmlPath: {
        type: 'string',
        description: 'Path to HTML file to convert (absolute or relative to current working directory)'
      },
      htmlContent: {
        type: 'string',
        description: 'HTML content string to convert (alternative to htmlPath)'
      },
      outputPath: {
        type: 'string',
        description: 'Output image file path (default: auto-generated with timestamp in current directory)'
      },
      imageFormat: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Output image format (default: png)'
      },
      quality: {
        type: 'number',
        description: 'JPEG quality (default: 90, range: 0-100)'
      },
      fullPage: {
        type: 'boolean',
        description: 'Capture full page height (default: false, captures only viewport)'
      },
      imageScale: {
        type: 'number',
        description: 'Screenshot scale / device scale factor (default: 1, range: 0.1 to 2)'
      },
      waitForNetworkIdle: {
        type: 'boolean',
        description: 'Wait for network to be idle before capturing (default: false)'
      },
      waitForMermaid: {
        type: 'boolean',
        description: 'Wait for Mermaid diagrams to finish rendering (default: false)'
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait for page load in milliseconds (default: 30000)'
      }
    }
  }
};

const CONVERT_MD_TO_HTML_TOOL: Tool = {
  name: 'convert_md_to_html',
  description: 'Convert Markdown file or Markdown content to a standalone, professionally styled HTML report. Features include responsive tables, Mermaid diagram rendering, and local image embedding. The HTML is fully self-contained (no external dependencies).',
  inputSchema: {
    type: 'object',
    properties: {
      mdPath: {
        type: 'string',
        description: 'Path to Markdown file to convert (absolute or relative to current working directory)'
      },
      mdContent: {
        type: 'string',
        description: 'Markdown content string to convert (alternative to mdPath)'
      },
      outputPath: {
        type: 'string',
        description: 'Output HTML file path (default: auto-generated with timestamp in current directory)'
      },
      embedImages: {
        type: 'boolean',
        description: 'Embed local images as base64 data URIs (default: true)'
      },
      keepInlineToc: {
        type: 'boolean',
        description: 'Keep existing Markdown inline TOC in the article body (default: false, removes it during conversion)'
      },
      withJs: {
        type: 'boolean',
        description: 'Add interactive JS for scroll progress and back-to-top button (default: false)'
      },
      mermaidSource: {
        type: 'string',
        enum: ['auto', 'cdn', 'local', 'none'],
        description: 'Source for Mermaid diagram rendering. "auto": CDN if needed, "cdn": always CDN, "local": local mermaid.min.js, "none": skip Mermaid (default: auto)'
      }
    }
  }
};

const CONVERT_MD_TO_PDF_TOOL: Tool = {
  name: 'convert_md_to_pdf',
  description: 'Convert Markdown file or Markdown content to PDF. Renders Markdown to a professionally styled HTML report (with responsive tables, Mermaid diagrams, image embedding) then converts to PDF via browser rendering.',
  inputSchema: {
    type: 'object',
    properties: {
      mdPath: {
        type: 'string',
        description: 'Path to Markdown file to convert (absolute or relative to current working directory)'
      },
      mdContent: {
        type: 'string',
        description: 'Markdown content string to convert (alternative to mdPath)'
      },
      outputPath: {
        type: 'string',
        description: 'Output PDF file path (default: auto-generated with timestamp in current directory)'
      },
      embedImages: {
        type: 'boolean',
        description: 'Embed local images as base64 data URIs (default: true)'
      },
      keepInlineToc: {
        type: 'boolean',
        description: 'Keep existing Markdown inline TOC in the article body (default: false, removes it during conversion)'
      },
      withJs: {
        type: 'boolean',
        description: 'Add interactive JS for scroll progress and back-to-top button (default: false)'
      },
      mermaidSource: {
        type: 'string',
        enum: ['auto', 'cdn', 'local', 'none'],
        description: 'Source for Mermaid diagram rendering. "auto": CDN if needed, "cdn": always CDN, "local": local mermaid.min.js, "none": skip Mermaid (default: auto)'
      },
      format: {
        type: 'string',
        enum: ['A4', 'A3', 'Letter', 'Legal', 'Tabloid'],
        description: 'Paper format (default: A4)'
      },
      landscape: {
        type: 'boolean',
        description: 'Use landscape orientation (default: false)'
      },
      printBackground: {
        type: 'boolean',
        description: 'Print background graphics (default: true)'
      },
      scale: {
        type: 'number',
        description: 'Scale of the webpage rendering (default: 1, range: 0.1 to 2)'
      },
      marginTop: {
        type: 'string',
        description: 'Top margin (default: 10mm, accepts px, cm, in, mm)'
      },
      marginBottom: {
        type: 'string',
        description: 'Bottom margin (default: 10mm)'
      },
      marginLeft: {
        type: 'string',
        description: 'Left margin (default: 10mm)'
      },
      marginRight: {
        type: 'string',
        description: 'Right margin (default: 10mm)'
      },
      displayHeaderFooter: {
        type: 'boolean',
        description: 'Display header and footer (default: false)'
      },
      headerTemplate: {
        type: 'string',
        description: 'HTML template for header'
      },
      footerTemplate: {
        type: 'string',
        description: 'HTML template for footer'
      },
      waitForNetworkIdle: {
        type: 'boolean',
        description: 'Wait for network to be idle before generating PDF (default: false)'
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait for page load in milliseconds (default: 30000)'
      }
    }
  }
};

const RECOGNIZE_TEXT_TOOL: Tool = {
  name: 'recognize_text',
  description: 'Extract text from images or PDF files using Baidu OCR API (supports Chinese and English)',
  inputSchema: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        description: 'Baidu Cloud API Key (optional if BAIDU_OCR_API_KEY env var is set)'
      },
      secretKey: {
        type: 'string',
        description: 'Baidu Cloud Secret Key (optional if BAIDU_OCR_SECRET_KEY env var is set)'
      },
      imagePath: {
        type: 'string',
        description: 'Local image file path (one of imagePath, imageUrl, imageBase64, pdfPath)'
      },
      imageUrl: {
        type: 'string',
        description: 'Image URL (one of imagePath, imageUrl, imageBase64, pdfPath)'
      },
      imageBase64: {
        type: 'string',
        description: 'Base64 encoded image data (one of imagePath, imageUrl, imageBase64, pdfPath)'
      },
      pdfPath: {
        type: 'string',
        description: 'Local PDF file path (one of imagePath, imageUrl, imageBase64, pdfPath, ofdPath). Priority: image > url > pdf_file > ofd_file'
      },
      pdfFileNum: {
        type: 'number',
        description: 'PDF page number to recognize, starting from 1 (default: 1, only effective with pdfPath)'
      },
      ofdPath: {
        type: 'string',
        description: 'Local OFD file path (one of imagePath, imageUrl, imageBase64, pdfPath, ofdPath). Priority: image > url > pdf_file > ofd_file'
      },
      ofdFileNum: {
        type: 'number',
        description: 'OFD page number to recognize, starting from 1 (default: 1, only effective with ofdPath)'
      },
      languageType: {
        type: 'string',
        enum: ['auto_detect', 'CHN_ENG', 'ENG', 'JAP', 'KOR', 'FRE', 'SPA', 'POR', 'GER', 'ITA', 'RUS', 'DAN', 'DUT', 'MAL', 'SWE', 'IND', 'POL', 'ROM', 'TUR', 'GRE', 'HUN', 'THA', 'VIE', 'ARA', 'HIN'],
        description: 'Language type for recognition (default: CHN_ENG)'
      },
      detectLanguage: {
        type: 'boolean',
        description: 'Detect language in the image (default: true)'
      },
      detectDirection: {
        type: 'boolean',
        description: 'Detect image orientation (default: false)'
      },
      paragraph: {
        type: 'boolean',
        description: 'Output paragraph information (default: false)'
      },
      probability: {
        type: 'boolean',
        description: 'Return confidence scores per line (default: true)'
      },
      multidirectionalRecognize: {
        type: 'boolean',
        description: 'Enable line-level multi-direction text recognition (default: false, set true when image has text in different directions)'
      }
    }
  }
};

class Md2PdfServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'general-tools-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    const handleSignal = async () => {
      await converter.cleanup();
      process.exit(0);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [CONVERT_HTML_TO_PDF_TOOL, CONVERT_HTML_TO_IMAGE_TOOL, CONVERT_MD_TO_HTML_TOOL, CONVERT_MD_TO_PDF_TOOL, RECOGNIZE_TEXT_TOOL]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'convert_html_to_pdf') {
        try {
          const options = args as ConvertOptions;
          const result = await converter.convertToPdf(options);

          if (result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'PDF generated successfully',
                    outputPath: result.outputPath,
                    processingTime: `${result.details?.processingTime}ms`,
                    fileSize: result.details?.fileSize
                      ? `${(result.details.fileSize / 1024).toFixed(2)} KB`
                      : 'unknown'
                  }, null, 2)
                }
              ]
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: result.error,
                    processingTime: `${result.details?.processingTime}ms`
                  }, null, 2)
                }
              ],
              isError: true
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error)
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }

      if (name === 'convert_html_to_image') {
        try {
          const options = args as ConvertImageOptions;
          const result = await converter.convertToImage(options);

          if (result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Image generated successfully',
                    outputPath: result.outputPath,
                    processingTime: `${result.details?.processingTime}ms`,
                    fileSize: result.details?.fileSize
                      ? `${(result.details.fileSize / 1024).toFixed(2)} KB`
                      : 'unknown',
                    dimensions: result.details?.width && result.details?.height
                      ? `${result.details.width} × ${result.details.height}px`
                      : 'unknown'
                  }, null, 2)
                }
              ]
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: result.error,
                    processingTime: `${result.details?.processingTime}ms`
                  }, null, 2)
                }
              ],
              isError: true
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error)
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }

      if (name === 'convert_md_to_html') {
        try {
          const {
            mdPath: mdPathArg,
            mdContent,
            outputPath,
            embedImages,
            keepInlineToc,
            withJs,
            mermaidSource,
          } = args as Record<string, unknown>;

          if (!mdPathArg && !mdContent) {
            throw new Error('Either mdPath or mdContent must be provided');
          }

          let mdText: string;
          let baseDir: string | undefined;

          if (mdPathArg) {
            const mdFilePath = path.resolve(mdPathArg as string);
            await fs.access(mdFilePath);
            mdText = await fs.readFile(mdFilePath, 'utf-8');
            baseDir = path.dirname(mdFilePath);
          } else {
            mdText = mdContent as string;
            baseDir = undefined;
          }

          const { html, stats } = await mdConverter.convertMdToHtml(mdText, {
            embedImages: embedImages as boolean | undefined,
            keepInlineToc: keepInlineToc as boolean | undefined,
            withJs: withJs as boolean | undefined,
            mermaidSource: mermaidSource as 'auto' | 'cdn' | 'local' | 'none' | undefined,
          }, baseDir);

          // Determine output path
          let htmlOutputPath = outputPath as string | undefined;
          if (!htmlOutputPath) {
            if (mdPathArg) {
              const parsed = path.parse(mdPathArg as string);
              htmlOutputPath = path.join(parsed.dir, `${parsed.name}.html`);
            } else {
              const timestamp = Date.now();
              htmlOutputPath = `md-report-${timestamp}.html`;
            }
          }
          htmlOutputPath = path.resolve(htmlOutputPath);

          await fs.writeFile(htmlOutputPath, html, 'utf-8');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Markdown converted to HTML successfully',
                  outputPath: htmlOutputPath,
                  stats,
                }, null, 2)
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error)
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }

      if (name === 'convert_md_to_pdf') {
        try {
          const options = args as MdToPdfOptions;
          const result = await mdConverter.convertMdToPdf(options, converter);

          if (result.success) {
            const response: Record<string, unknown> = {
              success: true,
              message: 'Markdown converted to PDF successfully',
              outputPath: result.outputPath,
              processingTime: `${result.details?.processingTime}ms`,
              fileSize: result.details?.fileSize
                ? `${(result.details.fileSize / 1024).toFixed(2)} KB`
                : 'unknown',
            };
            if (result.details?.stats) {
              response.stats = result.details.stats;
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response, null, 2)
                }
              ]
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: result.error,
                    processingTime: `${result.details?.processingTime}ms`
                  }, null, 2)
                }
              ],
              isError: true
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error)
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }

      if (name === 'recognize_text') {
        try {
          const options = args as unknown as OcrOptions;
          const result = await ocrService.recognize(options);

          if (result.success) {
            const response: Record<string, unknown> = {
              success: true,
              text: result.text,
              wordsResultNum: result.wordsResultNum,
              processingTime: `${result.details?.processingTime}ms`,
            };
            if (result.language) {
              response.language = result.language;
            }
            if (result.direction !== undefined) {
              response.direction = result.direction;
            }
            if (result.wordsResult && result.wordsResult.length > 0) {
              response.wordsResult = result.wordsResult;
            }
            if (result.apiUsed) {
              response.apiUsed = result.apiUsed;
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response, null, 2)
                }
              ]
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: result.error,
                    processingTime: `${result.details?.processingTime}ms`
                  }, null, 2)
                }
              ],
              isError: true
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error)
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('General Tools MCP Server running on stdio');

    // Exit when parent closes stdin (EOF), so the process doesn't hang
    process.stdin.on('end', async () => {
      await converter.cleanup();
      process.exit(0);
    });
    process.stdin.resume(); // Ensure stdin stays open so we can detect EOF
  }
}

const server = new Md2PdfServer();
server.run().catch(console.error);
