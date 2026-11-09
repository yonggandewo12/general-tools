/**
 * 二维码服务：qrcode_generate 工具的实现后端。
 *
 * 基于 qrcode（纯 JS，零原生依赖）。支持：
 * - 输出 PNG 文件 / SVG 文件 / base64 Data URL；
 * - 自定义宽度、容错等级、边距与前景/背景色；
 * - UTF-8 内容（含中文）自动使用字节模式编码。
 *
 * 与 pdf_add_qrcode 互补：后者只能把已有二维码图片嵌入 PDF，本工具负责从零生成。
 *
 * @author Liang.Xu
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import qrcode from 'qrcode';

export interface QrcodeOptions {
  text: string;
  outputPath?: string;
  /** png / svg / dataURL（默认按 outputPath 扩展名，否则 png）。 */
  format?: 'png' | 'svg' | 'dataURL';
  width?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
  /** 前景色，如 '#000000'（三种输出格式均生效）。 */
  colorDark?: string;
  /** 背景色，如 '#FFFFFF'（三种输出格式均生效）。 */
  colorLight?: string;
}

export interface QrcodeResult {
  success: boolean;
  outputPath?: string;
  format?: string;
  width?: number;
  /** 写入磁盘的文件字节数（仅文件输出）。 */
  fileSize?: number;
  dataURL?: string;
  error?: string;
  details?: { processingTime: number };
}

/**
 * 决定实际输出格式。
 *
 * qrcode 库只能产出 PNG 与 SVG 两种文件格式；此前实现把「非 .svg/.png 一律按
 * png 渲染」，于是 `out.jpg` 里装着 PNG 字节，扩展名与内容不符。这里改为：
 * - 显式 format 优先；扩展名存在且指向不同格式时报冲突（空扩展名不参与
 *   冲突比对——此时扩展名不承载意图，按显式 format 写入即可）；
 * - 未指定 format 时按扩展名推导，空扩展名默认 png；
 * - 扩展名无法由本库产出（.jpg/.webp 等）时显式报错，而不是静默写错格式。
 */
function resolveFormat(
  format: QrcodeOptions['format'],
  outputPath: string | undefined,
): 'png' | 'svg' | 'dataURL' {
  const ext = outputPath ? path.extname(outputPath).toLowerCase() : '';
  const extFormat = ext === '.svg' ? 'svg' : ext === '.png' ? 'png' : ext === '' ? null : 'invalid';

  if (format) {
    if (format === 'dataURL') {
      if (outputPath) {
        throw new Error('format="dataURL" 不写文件，不能同时提供 outputPath。');
      }
      return format;
    }
    // extFormat: 匹配的格式 / null（无扩展名，按 format 写）/ 'invalid'（无法产出的扩展名）
    if (extFormat === 'invalid') {
      throw new Error(
        `不支持的二维码输出扩展名 "${ext}"；qrcode 仅能生成 .png / .svg。`,
      );
    }
    if (extFormat !== null && extFormat !== format) {
      throw new Error(
        `输出扩展名 "${ext}" 与 format="${format}" 不一致；请改用匹配的扩展名或不传 format。`,
      );
    }
    return format;
  }

  if (extFormat === null) {
    // 无扩展名且未显式指定 format：默认 png（与空扩展名可按 png 读取的旧行为一致）
    return 'png';
  }
  if (extFormat === 'invalid') {
    throw new Error(
      `不支持的二维码输出扩展名 "${ext}"；qrcode 仅能生成 .png / .svg。`,
    );
  }
  return extFormat;
}

export async function generateQrcode(options: QrcodeOptions): Promise<QrcodeResult> {
  const start = Date.now();
  const details = () => ({ processingTime: Date.now() - start });
  try {
    if (!options.text) {
      throw new Error('text 不能为空');
    }
    const text = typeof options.text === 'string' ? options.text : JSON.stringify(options.text);

    const format = resolveFormat(options.format, options.outputPath);

    // 三种输出共享的渲染参数；仅显式指定颜色时传 color，避免覆盖库默认值
    const commonOptions = {
      errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
      margin: options.margin ?? 2,
      ...(options.colorDark || options.colorLight
        ? {
            color: {
              dark: options.colorDark ?? '#000000',
              light: options.colorLight ?? '#FFFFFF',
            },
          }
        : {}),
    };

    if (format === 'dataURL') {
      const dataUrl = await qrcode.toDataURL(text, {
        ...commonOptions,
        width: options.width ?? 300,
      });
      return { success: true, format: 'dataURL', dataURL: dataUrl, details: details() };
    }

    if (!options.outputPath) {
      throw new Error('输出 png/svg 时必须提供 outputPath');
    }
    const resolvedOutput = path.resolve(options.outputPath);
    await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });

    if (format === 'svg') {
      const svg = await qrcode.toString(text, { ...commonOptions, type: 'svg' });
      await fs.writeFile(resolvedOutput, svg);
    } else {
      await qrcode.toFile(resolvedOutput, text, {
        ...commonOptions,
        width: options.width ?? 300,
      });
    }

    const fileSize = (await fs.stat(resolvedOutput)).size;
    return {
      success: true,
      outputPath: resolvedOutput,
      format,
      width: options.width ?? 300,
      fileSize,
      details: details(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      details: details(),
    };
  }
}
