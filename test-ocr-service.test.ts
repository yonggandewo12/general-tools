import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OcrService } from './src/ocr-service.js';

describe('OcrService', () => {
  let ocrService: OcrService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    ocrService = new OcrService();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('recognize', () => {
    it('should return error when apiKey is missing and env var not set', async () => {
      const result = await ocrService.recognize({
        apiKey: '',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('BAIDU_OCR_API_KEY');
    });

    it('should return error when secretKey is missing and env var not set', async () => {
      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: '',
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('BAIDU_OCR_SECRET_KEY');
    });

    it('should return error when no image input is provided', async () => {
      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ofdPath');
    });

    it('should return error when image file does not exist', async () => {
      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imagePath: '/nonexistent/path/image.png',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('图片文件不存在');
    });

    it('should use env vars when apiKey/secretKey not provided', async () => {
      process.env.BAIDU_OCR_API_KEY = 'env-api-key';
      process.env.BAIDU_OCR_SECRET_KEY = 'env-secret-key';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Env Var Test' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Env Var Test');

      delete process.env.BAIDU_OCR_API_KEY;
      delete process.env.BAIDU_OCR_SECRET_KEY;
    });

    it('should return error when both accurate_basic and general_basic fail', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        // Both OCR endpoints fail
        if (urlStr.includes('accurate_basic') || urlStr.includes('general_basic')) {
          return {
            ok: true,
            json: async () => ({
              error_code: 110,
              error_msg: 'Access token invalid',
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'invalid-key',
        secretKey: 'invalid-secret',
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('认证失败');
    });

    it('should return success with accurate_basic and apiUsed field', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          return {
            ok: true,
            json: async () => ({
              words_result: [
                { words: 'Hello World', location: { left: 10, top: 20, width: 100, height: 30 }, probability: { average: 0.98, min: 0.95, variance: 0.01 } },
                { words: '你好世界', location: { left: 10, top: 60, width: 100, height: 30 }, probability: { average: 0.97, min: 0.93, variance: 0.02 } },
              ],
              words_result_num: 2,
              language: 'CHN_ENG',
              direction: 0,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello World\n你好世界');
      expect(result.language).toBe('CHN_ENG');
      expect(result.direction).toBe(0);
      expect(result.wordsResultNum).toBe(2);
      expect(result.wordsResult).toHaveLength(2);
      expect(result.wordsResult![0].words).toBe('Hello World');
      expect(result.apiUsed).toBe('accurate_basic');
    });

    it('should fall back to general_basic when accurate_basic fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          return {
            ok: true,
            json: async () => ({
              error_code: 282801,
              error_msg: 'accurate_basic not activated',
            }),
          } as Response;
        }
        if (urlStr.includes('general_basic')) {
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Fallback Text' }],
              words_result_num: 1,
              language: 'CHN_ENG',
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Fallback Text');
      expect(result.apiUsed).toBe('general_basic (fallback)');
    });

    it('should handle detectLanguage=false and probability=false', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Test' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
        detectLanguage: false,
        probability: false,
      });

      expect(result.success).toBe(true);
    });

    it('should strip data URI prefix from imageBase64', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Test' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'data:image/png;base64,dGVzdA==',
      });

      expect(result.success).toBe(true);
    });

    it('should prioritize image over pdf when both provided', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Image Priority' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
        pdfPath: '/some/file.pdf',
      });

      expect(result.success).toBe(true);
      expect(capturedBody).toContain('image=');
      expect(capturedBody).not.toContain('pdf_file=');
    });

    it('should send pdf_file parameter when pdfPath is provided', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'PDF Text' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        pdfPath: '/Users/admin/Documents/project/md2pdf/sample.pdf',
        pdfFileNum: 2,
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('PDF Text');
      expect(capturedBody).toContain('pdf_file=');
      expect(capturedBody).toContain('pdf_file_num=2');
      expect(capturedBody).not.toContain('image=');
    });

    it('should send ofd_file parameter when ofdPath is provided', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'OFD Text' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      // Create a temp OFD-like file for the test
      const tmpOfdPath = '/tmp/test-ocr-sample.ofd';
      const { writeFileSync, unlinkSync, existsSync } = await import('fs');
      writeFileSync(tmpOfdPath, Buffer.from('OFD test content'));

      try {
        const result = await ocrService.recognize({
          apiKey: 'test-key',
          secretKey: 'test-secret',
          ofdPath: tmpOfdPath,
          ofdFileNum: 3,
        });

        expect(result.success).toBe(true);
        expect(result.text).toBe('OFD Text');
        expect(capturedBody).toContain('ofd_file=');
        expect(capturedBody).toContain('ofd_file_num=3');
        expect(capturedBody).not.toContain('image=');
        expect(capturedBody).not.toContain('pdf_file=');
      } finally {
        if (existsSync(tmpOfdPath)) unlinkSync(tmpOfdPath);
      }
    });

    it('should prioritize pdf over ofd when both provided', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'PDF Priority' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        pdfPath: '/Users/admin/Documents/project/md2pdf/sample.pdf',
        ofdPath: '/tmp/test-ocr-sample.ofd',
      });

      expect(result.success).toBe(true);
      expect(capturedBody).toContain('pdf_file=');
      expect(capturedBody).not.toContain('ofd_file=');
    });

    it('should send language_type parameter when provided', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'JAP Text' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
        languageType: 'JAP',
      });

      expect(result.success).toBe(true);
      expect(capturedBody).toContain('language_type=JAP');
    });

    it('should send multidirectional_recognize when set to true', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Multi-dir' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
        multidirectionalRecognize: true,
      });

      expect(result.success).toBe(true);
      expect(capturedBody).toContain('multidirectional_recognize=true');
    });

    it('should not send detect_direction by default', async () => {
      let capturedBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth/2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-token',
              expires_in: 2592000,
            }),
          } as Response;
        }
        if (urlStr.includes('accurate_basic')) {
          capturedBody = init?.body as string || '';
          return {
            ok: true,
            json: async () => ({
              words_result: [{ words: 'Test' }],
              words_result_num: 1,
            }),
          } as Response;
        }
        return { ok: false, status: 500 } as Response;
      });

      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        imageBase64: 'dGVzdA==',
      });

      expect(result.success).toBe(true);
      expect(capturedBody).not.toContain('detect_direction');
    });

    it('should return error when PDF file does not exist', async () => {
      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        pdfPath: '/nonexistent/path/document.pdf',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PDF 文件不存在');
    });

    it('should return error when OFD file does not exist', async () => {
      const result = await ocrService.recognize({
        apiKey: 'test-key',
        secretKey: 'test-secret',
        ofdPath: '/nonexistent/path/document.ofd',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('OFD 文件不存在');
    });
  });
});
