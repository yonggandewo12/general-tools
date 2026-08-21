/**
 * PDF 后处理：水印 / 二维码 / 后处理编排。
 *
 * 纯 pdf-lib 实现（MIT），无外部进程。能力借鉴自 doc-ops-mcp（MIT 许可）：
 * - addWatermark：文字水印斜向平铺（-30°），支持中文（fontkit 懒加载 + 系统中文字体），
 *   或图片水印按 6 种锚点位置放置。
 * - addQrCode：在 PDF 末页嵌入二维码图片 + 可选说明文字。
 * - processPostConversion：复制源 PDF → 依次加水印/二维码 → 清理临时文件。
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { existsSync } from 'fs';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

export interface WatermarkOptions {
  watermarkText?: string;
  watermarkImage?: string;
  watermarkImageScale?: number;
  watermarkImageOpacity?: number;
  watermarkImagePosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'fullscreen';
  watermarkFontSize?: number;
  watermarkTextOpacity?: number;
}

export interface QrCodeOptions {
  qrScale?: number;
  qrOpacity?: number;
  qrPosition?:
    | 'top-left'
    | 'top-right'
    | 'top-center'
    | 'bottom-left'
    | 'bottom-right'
    | 'bottom-center'
    | 'center';
  addText?: boolean;
  customText?: string;
  textSize?: number;
  textColor?: string;
}

export interface PostProcessOptions extends WatermarkOptions {
  addWatermark?: boolean;
  addQrCode?: boolean;
  qrCodePath?: string;
  qrScale?: number;
  qrOpacity?: number;
  qrPosition?: QrCodeOptions['qrPosition'];
  addText?: boolean;
  customText?: string;
  textSize?: number;
  textColor?: string;
}

export interface PdfPostProcessResult {
  success: boolean;
  message?: string;
  error?: string;
  outputPath?: string;
  details?: { processingTime: number };
}

// 跨平台中文字体候选。优先级：真实 TTF/OTF（pdf-lib 的 embedFont 只接受单字体文件，
// TTC 集合需 fontkit.create(buffer, name) 提取单个字体后才能嵌入——而 pdf-lib 1.17
// 的 embedFont 不接受已打开的 fontkit 字体对象，所以优先列单字体文件，TTC 兜底）。
const CHINESE_FONT_CANDIDATES = [
  // macOS
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Songti.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  // Linux
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  // Windows
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\simsun.ttc',
  'C:\\Windows\\Fonts\\simhei.ttf',
];

/** 检测文字是否含 CJK 字符。 */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/** 将 #RRGGBB（或 #RGB）hex 颜色转成 pdf-lib rgb 对象；非法输入回退黑色。 */
function hexToRgb(hex: string): import('pdf-lib').Color {
  let value = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) {
    return rgb(0, 0, 0);
  }
  if (value.length === 3) {
    value = value.split('').map((c) => c + c).join('');
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * 注册 fontkit 并嵌入第一个可用的中文字体。
 * 返回嵌入的字体；失败返回 null（调用方回退 Helvetica）。
 */
async function embedChineseFont(
  pdfDoc: PDFDocument,
): Promise<import('pdf-lib').PDFFont | null> {
  try {
    const fontkit = (await import('fontkit')) as unknown as { default: unknown };
    pdfDoc.registerFontkit((fontkit.default ?? fontkit) as Parameters<PDFDocument['registerFontkit']>[0]);
    for (const fp of CHINESE_FONT_CANDIDATES) {
      if (!existsSync(fp)) continue;
      try {
        const fontBytes = await fs.readFile(fp);
        return await pdfDoc.embedFont(fontBytes, { subset: true });
      } catch {
        // 该字体无法嵌入（如 TTC collection），尝试下一个候选
      }
    }
  } catch {
    // 无可用中文字体
  }
  return null;
}

/**
 * 对角线平铺文字水印的绘制逻辑（doc-ops-mcp 移植）。
 * font 由调用方预嵌入并缓存，避免多页文档每页重复嵌入字体（性能）。
 */
async function drawTextWatermark(
  page: import('pdf-lib').PDFPage,
  watermarkText: string,
  fontSize: number,
  opacity: number,
  font: import('pdf-lib').PDFFont,
): Promise<void> {
  const { width, height } = page.getSize();
  const angle = -30;
  const spacingX = fontSize * 8;
  const spacingY = fontSize * 7;
  const textWidth = watermarkText.length * fontSize * 0.6;
  const textHeight = fontSize;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidth = textWidth * cos + textHeight * sin;
  const rotatedHeight = textWidth * sin + textHeight * cos;
  const startX = -rotatedWidth;
  const startY = height + rotatedHeight;

  for (let x = startX; x < width + rotatedWidth * 2; x += spacingX) {
    for (let y = startY; y > -rotatedHeight * 2; y -= spacingY) {
      page.drawText(watermarkText, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0.92, 0.92, 0.92),
        opacity,
        rotate: degrees(angle),
      });
    }
  }
}

/**
 * 为文字水印预嵌入字体：含中文时嵌入中文字体（失败回退 Helvetica），
 * 否则用 Helvetica。结果应缓存并复用于所有页面。
 */
async function resolveWatermarkFont(
  watermarkText: string,
  pdfDoc: PDFDocument,
): Promise<import('pdf-lib').PDFFont> {
  if (hasChinese(watermarkText)) {
    return (await embedChineseFont(pdfDoc)) ?? (await pdfDoc.embedFont(StandardFonts.Helvetica));
  }
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

/** 图片水印按锚点位置放置（doc-ops-mcp 移植）。
 * image 由调用方预嵌入并复用，避免多页文档每页重复嵌入同一图片。 */
async function drawImageWatermark(
  page: import('pdf-lib').PDFPage,
  image: import('pdf-lib').PDFImage,
  opts: WatermarkOptions,
): Promise<void> {
  const { width, height } = page.getSize();
  const scale = opts.watermarkImageScale ?? 0.25;
  const opacity = opts.watermarkImageOpacity ?? 0.3;
  const position = opts.watermarkImagePosition ?? 'top-right';

  let x = 0;
  let y = 0;

  if (position === 'fullscreen') {
    const imageAspectRatio = image.width / image.height;
    const pageAspectRatio = width / height;
    let newWidth: number;
    let newHeight: number;
    if (imageAspectRatio > pageAspectRatio) {
      newWidth = width * 0.6;
      newHeight = newWidth / imageAspectRatio;
    } else {
      newHeight = height * 0.6;
      newWidth = newHeight * imageAspectRatio;
    }
    x = (width - newWidth) / 2;
    y = (height - newHeight) / 2;
    page.drawImage(image, { x, y, width: newWidth, height: newHeight, opacity: opacity * 0.15 });
    return;
  }

  switch (position) {
    case 'top-left':
      x = 20;
      y = height - image.height * scale - 20;
      break;
    case 'top-right':
      x = width - image.width * scale - 20;
      y = height - image.height * scale - 20;
      break;
    case 'bottom-left':
      x = 20;
      y = 20;
      break;
    case 'bottom-right':
      x = width - image.width * scale - 20;
      y = 20;
      break;
    case 'center':
      x = (width - image.width * scale) / 2;
      y = (height - image.height * scale) / 2;
      break;
  }
  page.drawImage(image, { x, y, width: image.width * scale, height: image.height * scale, opacity });
}

/** 计算二维码锚点坐标（doc-ops-mcp 移植）。 */
function calculateQrPosition(
  position: QrCodeOptions['qrPosition'],
  width: number,
  height: number,
  qrWidth: number,
  qrHeight: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  switch (position) {
    case 'top-left':
      x = 20;
      y = height - qrHeight - 20;
      break;
    case 'top-right':
      x = width - qrWidth - 20;
      y = height - qrHeight - 20;
      break;
    case 'top-center':
      x = (width - qrWidth) / 2;
      y = height - qrHeight - 20;
      break;
    case 'bottom-left':
      x = 20;
      y = 20;
      break;
    case 'bottom-right':
      x = width - qrWidth - 20;
      y = 20;
      break;
    case 'center':
      x = (width - qrWidth) / 2;
      y = (height - qrHeight) / 2;
      break;
    case 'bottom-center':
    default:
      x = (width - qrWidth) / 2;
      y = 20;
      break;
  }
  return { x, y };
}

export class PdfPostProcessor {
  /**
   * 给 PDF 添加水印。优先级：用户文字 > 用户图片 > 默认文字。
   * 原地覆盖 pdfPath。返回 `{ success, message }`。
   */
  async addWatermark(pdfPath: string, opts: WatermarkOptions = {}): Promise<PdfPostProcessResult> {
    const start = Date.now();
    try {
      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();

      // 预嵌入文字水印字体（仅一次，多页复用）；仅文字水印需要。
      const usesImageWatermark = !opts.watermarkText && !!opts.watermarkImage;
      if (usesImageWatermark && !existsSync(opts.watermarkImage as string)) {
        return { success: false, error: `Watermark image not found: ${opts.watermarkImage}` };
      }
      const watermarkText = opts.watermarkText || 'CONFIDENTIAL';
      const font = usesImageWatermark
        ? null
        : await resolveWatermarkFont(watermarkText, pdfDoc);
      // 图片水印同样只读一次、嵌入一次，多页复用（pdf-lib 的 embedPng 不去重）
      const watermarkImage = usesImageWatermark
        ? await pdfDoc.embedPng(await fs.readFile(opts.watermarkImage as string))
        : null;

      for (const page of pages) {
        if (opts.watermarkText) {
          await drawTextWatermark(page, opts.watermarkText, opts.watermarkFontSize ?? 8, opts.watermarkTextOpacity ?? 0.3, font as import('pdf-lib').PDFFont);
        } else if (usesImageWatermark) {
          await drawImageWatermark(page, watermarkImage as import('pdf-lib').PDFImage, opts);
        } else {
          await drawTextWatermark(page, 'CONFIDENTIAL', opts.watermarkFontSize ?? 8, opts.watermarkTextOpacity ?? 0.3, font as import('pdf-lib').PDFFont);
        }
      }

      const modifiedPdfBytes = await pdfDoc.save();
      await fs.writeFile(pdfPath, modifiedPdfBytes);

      return {
        success: true,
        message: `Watermark added to ${pdfPath}`,
        details: { processingTime: Date.now() - start },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 在 PDF 末页嵌入二维码图片 + 可选说明文字。原地覆盖 pdfPath。
   */
  async addQrCode(pdfPath: string, qrCodePath: string, opts: QrCodeOptions = {}): Promise<PdfPostProcessResult> {
    const start = Date.now();
    try {
      if (!existsSync(qrCodePath)) {
        return { success: false, error: `QR code image not found: ${qrCodePath}` };
      }
      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      const qrImageBytes = await fs.readFile(qrCodePath);
      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      if (pages.length > 0) {
        const lastPage = pages[pages.length - 1];
        const { width, height } = lastPage.getSize();
        const scale = opts.qrScale ?? 0.15;
        const opacity = opts.qrOpacity ?? 1.0;
        const qrWidth = qrImage.width * scale;
        const qrHeight = qrImage.height * scale;
        const { x, y } = calculateQrPosition(opts.qrPosition ?? 'bottom-center', width, height, qrWidth, qrHeight);

        lastPage.drawImage(qrImage, { x, y, width: qrWidth, height: qrHeight, opacity });

        if (opts.addText !== false) {
          const text = opts.customText ?? 'Scan QR code for more information';
          const textSize = opts.textSize ?? 8;
          // 含中文时需嵌入中文字体，否则 WinAnsi 编码失败
          const font = hasChinese(text)
            ? ((await embedChineseFont(pdfDoc)) ?? (await pdfDoc.embedFont(StandardFonts.Helvetica)))
            : await pdfDoc.embedFont(StandardFonts.Helvetica);
          lastPage.drawText(text, {
            x: x + (qrWidth - text.length * textSize * 0.6) / 2,
            y: y - 15,
            size: textSize,
            font,
            color: hexToRgb(opts.textColor ?? '#000000'),
          });
        }
      }

      const modifiedPdfBytes = await pdfDoc.save();
      await fs.writeFile(pdfPath, modifiedPdfBytes);

      return {
        success: true,
        message: `QR code added to ${pdfPath}`,
        details: { processingTime: Date.now() - start },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * PDF 后处理编排：复制源 PDF 到目标位置，依次加可选水印/二维码，清理临时文件。
   * 不依赖 playwright，源文件可为任意 PDF 路径。
   */
  async processPostConversion(sourcePdfPath: string, targetPath?: string, opts: PostProcessOptions = {}): Promise<PdfPostProcessResult> {
    const start = Date.now();
    try {
      const finalPath = this.resolveTargetPath(sourcePdfPath, targetPath);
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.copyFile(sourcePdfPath, finalPath);

      const results: { success: boolean; message?: string; error?: string }[] = [];

      const shouldAddWatermark = opts.addWatermark || opts.watermarkText || (opts.watermarkImage && existsSync(opts.watermarkImage));
      if (shouldAddWatermark) {
        const wmText = opts.watermarkText ?? (opts.watermarkImage ? undefined : 'CONFIDENTIAL');
        const r = await this.addWatermark(finalPath, {
          watermarkText: wmText,
          watermarkImage: wmText ? undefined : opts.watermarkImage,
          watermarkImageScale: opts.watermarkImageScale,
          watermarkImageOpacity: opts.watermarkImageOpacity,
          watermarkImagePosition: opts.watermarkImagePosition,
        });
        results.push(r);
      }

      if (opts.addQrCode) {
        const qrPath = opts.qrCodePath;
        if (!qrPath) {
          results.push({ success: false, error: 'QR code image path not provided.' });
        } else {
          const r = await this.addQrCode(finalPath, qrPath, {
            qrScale: opts.qrScale,
            qrOpacity: opts.qrOpacity,
            qrPosition: opts.qrPosition,
            addText: opts.addText,
            customText: opts.customText,
            textSize: opts.textSize,
            textColor: opts.textColor,
          });
          results.push(r);
        }
      }

      // 源与目标不同才清理临时源文件
      if (sourcePdfPath !== finalPath && existsSync(sourcePdfPath)) {
        await fs.unlink(sourcePdfPath).catch(() => {});
      }

      // 汇总结果：若任一子步骤失败，整体标记为错误
      const failures = results.filter((r) => !r.success);
      const allSuccess = failures.length === 0;

      return {
        success: allSuccess,
        outputPath: finalPath,
        message: allSuccess
          ? `Post-processing done → ${finalPath}`
          : `Post-processing completed with ${failures.length} error(s) → ${finalPath}`,
        details: {
          processingTime: Date.now() - start,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private resolveTargetPath(sourcePdfPath: string, targetPath?: string): string {
    if (!targetPath) {
      const base = path.basename(sourcePdfPath, path.extname(sourcePdfPath)).replace(/^\d{4}-\d{2}-\d{2}T[^.]+Z-/, '');
      return path.join(path.dirname(sourcePdfPath), `${base}.pdf`);
    }
    if (!path.isAbsolute(targetPath)) {
      const joined = path.join(path.dirname(sourcePdfPath), targetPath);
      return joined.toLowerCase().endsWith('.pdf') ? joined : `${joined}.pdf`;
    }
    return targetPath.toLowerCase().endsWith('.pdf') ? targetPath : `${targetPath}.pdf`;
  }
}

export const pdfPostProcessor = new PdfPostProcessor();
