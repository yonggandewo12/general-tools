export interface PdfOptions {
  format?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  preferCSSPageSize?: boolean;
}

export interface ConvertOptions extends PdfOptions {
  htmlPath?: string;
  htmlContent?: string;
  outputPath?: string;
  waitForNetworkIdle?: boolean;
  waitForMermaid?: boolean;
  timeout?: number;
}

export interface ConvertResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  details?: {
    processingTime: number;
    fileSize?: number;
  };
}

// === HTML → Image ===

export interface ImageFormat {
  /** Output image format (default: 'png') */
  imageFormat?: 'png' | 'jpeg';
  /** Quality for JPEG format (default: 90, range: 0-100) */
  quality?: number;
  /** Whether to capture full page or just viewport (default: false) */
  fullPage?: boolean;
  /** Screenshot scale (default: 1, range: 0.1 to 2) */
  imageScale?: number;
}

export interface ConvertImageOptions extends ImageFormat, ConvertOptions {}

export interface ImageConvertResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  details?: {
    processingTime: number;
    fileSize?: number;
    width?: number;
    height?: number;
  };
}

// === Markdown → HTML / PDF ===

export interface MdToPdfOptions {
  /** Path to markdown file */
  mdPath?: string;
  /** Markdown content string (alternative to mdPath) */
  mdContent?: string;

  // MD → HTML conversion options
  /** Embed local images as base64 data URIs (default: true) */
  embedImages?: boolean;
  /** Keep inline Markdown TOC in the article body (default: false) */
  keepInlineToc?: boolean;
  /** Add interactive JS: scroll progress, active TOC, back-to-top (default: false) */
  withJs?: boolean;
  /** Mermaid diagram rendering source (default: 'auto') */
  mermaidSource?: 'auto' | 'cdn' | 'local' | 'none';

  // PDF output options
  outputPath?: string;
  format?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  waitForNetworkIdle?: boolean;
  timeout?: number;
}

export interface MdConvertStats {
  tables: number;
  images: number;
  embeddedImages: number;
  mermaid: number;
  mermaidSource?: string;
}

export interface ConvertMdResult {
  success: boolean;
  outputPath?: string;
  htmlOutput?: string;
  error?: string;
  details?: {
    processingTime: number;
    fileSize?: number;
    stats?: MdConvertStats;
  };
}

// === OCR (Baidu) ===

export interface OcrOptions {
  /** 百度智能云 API Key（可选，优先从环境变量 BAIDU_OCR_API_KEY 读取） */
  apiKey?: string;
  /** 百度智能云 Secret Key（可选，优先从环境变量 BAIDU_OCR_SECRET_KEY 读取） */
  secretKey?: string;
  /** 本地图片文件路径（三选一） */
  imagePath?: string;
  /** 网络图片 URL（三选一） */
  imageUrl?: string;
  /** Base64 编码图片数据（三选一） */
  imageBase64?: string;
  /** 是否检测语言（默认 true） */
  detectLanguage?: boolean;
  /** 是否检测图像朝向（默认 true） */
  detectDirection?: boolean;
  /** 是否输出段落信息（默认 false） */
  paragraph?: boolean;
  /** 是否返回置信度（默认 true） */
  probability?: boolean;
}

export interface OcrWordItem {
  words: string;
  location?: { left: number; top: number; width: number; height: number };
  probability?: { average: number; min: number; variance: number };
}

export interface OcrResult {
  success: boolean;
  text?: string;
  language?: string;
  direction?: number;
  wordsResult?: OcrWordItem[];
  wordsResultNum?: number;
  apiUsed?: string;
  error?: string;
  details?: { processingTime: number };
}
