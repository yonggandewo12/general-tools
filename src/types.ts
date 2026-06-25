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

export type OcrLanguageType =
  | 'auto_detect'
  | 'CHN_ENG'
  | 'ENG'
  | 'JAP'
  | 'KOR'
  | 'FRE'
  | 'SPA'
  | 'POR'
  | 'GER'
  | 'ITA'
  | 'RUS'
  | 'DAN'
  | 'DUT'
  | 'MAL'
  | 'SWE'
  | 'IND'
  | 'POL'
  | 'ROM'
  | 'TUR'
  | 'GRE'
  | 'HUN'
  | 'THA'
  | 'VIE'
  | 'ARA'
  | 'HIN';

export interface OcrOptions {
  /** 百度智能云 API Key（可选，优先从环境变量 BAIDU_OCR_API_KEY 读取） */
  apiKey?: string;
  /** 百度智能云 Secret Key（可选，优先从环境变量 BAIDU_OCR_SECRET_KEY 读取） */
  secretKey?: string;
  /** 本地图片文件路径（图片三选一） */
  imagePath?: string;
  /** 网络图片 URL（图片三选一） */
  imageUrl?: string;
  /** Base64 编码图片数据（图片三选一） */
  imageBase64?: string;
  /** 本地 PDF 文件路径（与图片输入互斥，优先级高于图片） */
  pdfPath?: string;
  /** PDF 识别页码，从 1 开始（默认 1，仅 pdfPath 时有效） */
  pdfFileNum?: number;
  /** 本地 OFD 文件路径（与图片/PDF 输入互斥） */
  ofdPath?: string;
  /** OFD 识别页码，从 1 开始（默认 1，仅 ofdPath 时有效） */
  ofdFileNum?: number;
  /** 识别语言类型（默认 CHN_ENG） */
  languageType?: OcrLanguageType;
  /** 是否检测语言（默认 true） */
  detectLanguage?: boolean;
  /** 是否检测图像朝向（默认 false） */
  detectDirection?: boolean;
  /** 是否输出段落信息（默认 false） */
  paragraph?: boolean;
  /** 是否返回识别结果中每一行的置信度（默认 true） */
  probability?: boolean;
  /** 是否开启行级别多方向文字识别（默认 false，图内有不同方向文字时建议 true） */
  multidirectionalRecognize?: boolean;
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

// === PDF Text Extraction (LiteParse) ===

export type PdfOutputFormat = 'text' | 'json' | 'markdown';
export type PdfImageMode = 'off' | 'placeholder' | 'embed';

export interface PdfExtractOptions {
  /** 本地 PDF 文件路径（必选） */
  pdfPath: string;
  /** 输出格式：text / json / markdown（默认 text） */
  outputFormat?: PdfOutputFormat;
  /** 页码范围，如 "1-5,10,15-20" */
  targetPages?: string;
  /** 是否启用 OCR（默认 false） */
  ocrEnabled?: boolean;
  /** OCR 语言，Tesseract 格式（默认 eng） */
  ocrLanguage?: string;
  /** HTTP OCR 服务地址（可选） */
  ocrServerUrl?: string;
  /** 最大解析页数（默认 1000） */
  maxPages?: number;
  /** 渲染 DPI（默认 150） */
  dpi?: number;
  /** Markdown 图片处理模式（默认 off） */
  imageMode?: PdfImageMode;
  /** 加密 PDF 密码（可选） */
  password?: string;
}

export interface PdfExtractPage {
  pageNum: number;
  width: number;
  height: number;
  text: string;
}

export interface PdfExtractResult {
  success: boolean;
  text?: string;
  pages?: PdfExtractPage[];
  pageCount?: number;
  error?: string;
  details?: { processingTime: number };
}

// === PDF Screenshot (LiteParse) ===

export interface PdfScreenshotOptions {
  /** 本地 PDF 文件路径（必选） */
  pdfPath: string;
  /** 页码范围，如 "1,3,5"（可选，默认全部） */
  targetPages?: string;
  /** 渲染 DPI（默认 150） */
  dpi?: number;
  /** 截图输出目录（默认当前目录） */
  outputDir?: string;
  /** 加密 PDF 密码（可选） */
  password?: string;
}

export interface PdfScreenshotPage {
  pageNum: number;
  width: number;
  height: number;
  outputPath: string;
}

export interface PdfScreenshotResult {
  success: boolean;
  screenshots?: PdfScreenshotPage[];
  error?: string;
  details?: { processingTime: number };
}
