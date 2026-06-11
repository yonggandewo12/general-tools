import { promises as fs } from 'fs';
import * as path from 'path';
import { OcrOptions, OcrResult, OcrWordItem } from './types.js';

// Token cache: key = apiKey:secretKey, value = { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Baidu OCR API error codes → Chinese messages
const ERROR_CODE_MAP: Record<number, string> = {
  110: '百度 OCR 认证失败，请检查 API Key 和 Secret Key',
  111: '百度 OCR access_token 过期',
  216201: '图片格式不支持，支持 PNG/JPG/JPEG/BMP',
  216202: '图片大小过大，请压缩后重试',
  216203: '图片中没有检测到文字',
  216204: '图片识别失败，请更换图片重试',
  216205: '图片模糊，请提供更清晰的图片',
  282000: '百度 OCR 服务器内部错误，请稍后重试',
  282001: '百度 OCR 服务器繁忙，请稍后重试',
  282003: '百度 OCR 请求参数缺失',
  282004: '百度 OCR 请求参数不合法',
  282100: '百度 OCR 并发超限，请稍后重试',
  282101: '百度 OCR 识别量超限，请检查配额',
  282102: '百度 OCR 识别量超限，请检查配额',
  282800: '百度 OCR 控制台配置错误',
  282801: '百度 OCR 识别类型未开通',
};

export class OcrService {
  /**
   * Get Baidu OCR access_token, with in-memory cache.
   * Token is valid for 30 days; refresh 1 day before expiry.
   */
  private async getAccessToken(apiKey: string, secretKey: string): Promise<string> {
    const cacheKey = `${apiKey}:${secretKey}`;
    const cached = tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;

    const response = await fetch(url, { method: 'POST' });

    if (!response.ok) {
      throw new Error(`百度 OCR 认证请求失败: HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if (data.error) {
      throw new Error(`百度 OCR 认证失败: ${data.error_description || data.error}`);
    }

    const token = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 2592000; // 30 days default

    // Cache token, refresh 1 day before expiry
    const expiresAt = Date.now() + (expiresIn - 86400) * 1000;
    tokenCache.set(cacheKey, { token, expiresAt });

    return token;
  }

  /**
   * Read local image file and convert to base64 string.
   */
  private async imageToBase64(imagePath: string): Promise<string> {
    const resolved = path.resolve(imagePath);

    try {
      await fs.access(resolved);
    } catch {
      throw new Error(`图片文件不存在: ${resolved}`);
    }

    const buffer = await fs.readFile(resolved);
    return buffer.toString('base64');
  }

  /**
   * Fetch remote image by URL and convert to base64 string.
   */
  private async fetchUrlImage(imageUrl: string): Promise<string> {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`下载图片失败: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  }

  /**
   * Strip data URI prefix from base64 string if present.
   * e.g. "data:image/png;base64,abc123" → "abc123"
   */
  private stripDataUriPrefix(base64: string): string {
    const match = base64.match(/^data:image\/[^;]+;base64,(.+)$/s);
    return match ? match[1] : base64;
  }

  /**
   * Resolve input to base64 and input type.
   * Priority per Baidu OCR: image > url > pdf_file > ofd_file
   */
  private async resolveInput(options: OcrOptions): Promise<{ base64: string; inputType: 'image' | 'pdf' | 'ofd' }> {
    // Image inputs take highest priority (per Baidu OCR spec: image > url > pdf_file > ofd_file)
    if (options.imagePath || options.imageUrl || options.imageBase64) {
      const imageBase64 = await this.resolveImageBase64(options);
      return { base64: imageBase64, inputType: 'image' };
    }

    // PDF input (priority over OFD)
    if (options.pdfPath) {
      const resolved = path.resolve(options.pdfPath);
      try {
        await fs.access(resolved);
      } catch {
        throw new Error(`PDF 文件不存在: ${resolved}`);
      }
      const buffer = await fs.readFile(resolved);
      return { base64: buffer.toString('base64'), inputType: 'pdf' };
    }

    // OFD input
    if (options.ofdPath) {
      const resolved = path.resolve(options.ofdPath);
      try {
        await fs.access(resolved);
      } catch {
        throw new Error(`OFD 文件不存在: ${resolved}`);
      }
      const buffer = await fs.readFile(resolved);
      return { base64: buffer.toString('base64'), inputType: 'ofd' };
    }

    throw new Error('必须提供 imagePath、imageUrl、imageBase64、pdfPath 或 ofdPath 其中之一');
  }

  /**
   * Resolve image input to base64 string.
   * Priority: imagePath > imageUrl > imageBase64
   */
  private async resolveImageBase64(options: OcrOptions): Promise<string> {
    if (options.imagePath) {
      return this.imageToBase64(options.imagePath);
    }

    if (options.imageUrl) {
      return this.fetchUrlImage(options.imageUrl);
    }

    if (options.imageBase64) {
      return this.stripDataUriPrefix(options.imageBase64);
    }

    throw new Error('必须提供 imagePath、imageUrl 或 imageBase64 其中之一');
  }

  /**
   * Translate Baidu OCR error code to Chinese message.
   */
  private translateError(errorCode: number, errorMsg: string): string {
    return ERROR_CODE_MAP[errorCode] || `百度 OCR 错误 (${errorCode}): ${errorMsg}`;
  }

  /**
   * Call a Baidu OCR API endpoint with the given input and options.
   */
  private async callOcrApi(
    endpoint: string,
    accessToken: string,
    input: { base64: string; inputType: 'image' | 'pdf' | 'ofd' },
    options: OcrOptions,
  ): Promise<OcrResult> {
    const url = `${endpoint}?access_token=${encodeURIComponent(accessToken)}`;

    const params = new URLSearchParams();

    if (input.inputType === 'pdf') {
      params.append('pdf_file', input.base64);
      if (options.pdfFileNum && options.pdfFileNum > 1) {
        params.append('pdf_file_num', String(options.pdfFileNum));
      }
    } else if (input.inputType === 'ofd') {
      params.append('ofd_file', input.base64);
      if (options.ofdFileNum && options.ofdFileNum > 1) {
        params.append('ofd_file_num', String(options.ofdFileNum));
      }
    } else {
      params.append('image', input.base64);
    }

    if (options.detectLanguage !== false) {
      params.append('detect_language', 'true');
    }
    if (options.detectDirection) {
      params.append('detect_direction', 'true');
    }
    if (options.languageType) {
      params.append('language_type', options.languageType);
    }
    if (options.paragraph) {
      params.append('paragraph', 'true');
    }
    if (options.probability !== false) {
      params.append('probability', 'true');
    }
    if (options.multidirectionalRecognize) {
      params.append('multidirectional_recognize', 'true');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`百度 OCR 请求失败: HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if (data.error_code) {
      throw new Error(
        this.translateError(data.error_code as number, (data.error_msg as string) || '')
      );
    }

    const wordsResult = (data.words_result || []) as OcrWordItem[];
    const text = wordsResult.map((item) => item.words).join('\n');

    return {
      success: true,
      text,
      language: data.language as string | undefined,
      direction: data.direction as number | undefined,
      wordsResult,
      wordsResultNum: (data.words_result_num as number) || wordsResult.length,
    };
  }

  /**
   * Recognize text from image using Baidu OCR.
   * Tries accurate_basic first; on failure, falls back to general_basic.
   */
  async recognize(options: OcrOptions): Promise<OcrResult> {
    const startTime = Date.now();

    try {
      const apiKey = options.apiKey || process.env.BAIDU_OCR_API_KEY;
      const secretKey = options.secretKey || process.env.BAIDU_OCR_SECRET_KEY;

      if (!apiKey || !secretKey) {
        throw new Error('百度 OCR 认证失败，请通过工具参数 apiKey/secretKey 或环境变量 BAIDU_OCR_API_KEY/BAIDU_OCR_SECRET_KEY 提供密钥');
      }

      const input = await this.resolveInput(options);
      const accessToken = await this.getAccessToken(apiKey, secretKey);

      const ACCURATE_BASIC = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';
      const GENERAL_BASIC = 'https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic';

      // Try accurate_basic first
      try {
        const result = await this.callOcrApi(ACCURATE_BASIC, accessToken, input, options);
        return {
          ...result,
          apiUsed: 'accurate_basic',
          details: { processingTime: Date.now() - startTime },
        };
      } catch (accurateError) {
        // Fall back to general_basic
        const result = await this.callOcrApi(GENERAL_BASIC, accessToken, input, options);
        return {
          ...result,
          apiUsed: 'general_basic (fallback)',
          details: { processingTime: Date.now() - startTime },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - startTime },
      };
    }
  }
}
