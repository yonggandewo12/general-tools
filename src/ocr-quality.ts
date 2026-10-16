/**
 * OCR 退化输出检测：识别推理引擎"静默失败"产生的伪文本。
 *
 * 契约：
 * - 纯函数，不触碰原生模块，可离线单测。
 * - 检测对象仅为经过推理引擎的页（source ≠ Native）；原生文本层不经过引擎，
 *   不存在退化签名。
 * - 判定是**告警级**而非错误级：退化检测无法区分"引擎失败"与"页面本来就没字"，
 *   因此调用方应当标注可疑并建议改用其他解析途径，而不应据此丢弃内容。
 * - 与引擎自身告警的去重（`empty` 命中但引擎已就空页告警时不重复追加）由调用方
 *   决定；本模块只负责识别签名。
 * - 阈值刻意保守（见 `ZERO_FILL_MIN` / `REPETITIVE_*`）：宁可漏报也不误伤
 *   合法的短页、纯符号页与数字表格页。
 *
 * @author Liang.Xu
 */

/**
 * 参与统计的字符集为 Unicode 字母与数字（汉字属 `\p{L}`）。
 * 空白、标点与 markdown 结构符（`|` `#` `-` `*` 等）不计入：表格页可能由大量
 * 结构符与空白构成，计入会把合法版面误判为退化。
 */
const NON_CONTENT = /[^\p{L}\p{N}]/gu;

/** 全零判定的最小字符数：低于此长度的 "0000" 更可能是真实内容（如年份、编号）。 */
const ZERO_FILL_MIN = 8;

/**
 * 单字符支配判定的最小字符数与支配阈值。已知静默失败签名：部分 CPU 推理后端
 * 对中文返回全零或单一重复字符（PaddleOCR issue #18057）。
 */
const REPETITIVE_MIN = 12;
const REPETITIVE_MAX_DISTINCT = 2;
const REPETITIVE_MIN_RATIO = 0.8;

export type DegeneracyKind = 'empty' | 'zeroFill' | 'repetitive';

export interface DegeneracyReport {
  kind: DegeneracyKind;
  /** 面向调用方的告警文案，追加到该页 `warnings`。 */
  message: string;
}

/**
 * 长度与占比一律按 **Unicode 码点** 计数，不用 `string.length`：后者数的是 UTF-16
 * 代码单元，而中日韩扩展 B/C/D 区的罕用汉字（古籍、人名、地名用字，属 `\p{L}`）各占
 * 2 个单元。按代码单元算会把这类页的支配字符占比压低一半，正好漏掉单字符重复签名。
 * （emoji 是符号，已被 `NON_CONTENT` 剔除，不参与此计算。）
 */
function dominantChar(chars: string[]): { char: string; ratio: number; distinct: number } {
  const counts = new Map<string, number>();
  for (const ch of chars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let char = '';
  let max = 0;
  for (const [c, n] of counts) {
    if (n > max) {
      char = c;
      max = n;
    }
  }
  return { char, ratio: max / chars.length, distinct: counts.size };
}

/**
 * 判断一段 OCR 输出是否呈现引擎退化签名。
 *
 * @param rawText 该页 OCR/markdown 文本（可含结构与标点，内部会剔除后统计）
 * @returns 退化报告；内容正常时 `undefined`
 */
export function detectDegeneracy(rawText: string): DegeneracyReport | undefined {
  const chars = [...(rawText ?? '').replace(NON_CONTENT, '')];
  const total = chars.length;

  if (total === 0) {
    return {
      kind: 'empty',
      message:
        'OCR output contains no letters or digits — the page may be blank, or the OCR backend ' +
        'failed silently. Treat this page as unrecognized.',
    };
  }

  if (total >= ZERO_FILL_MIN && chars.every((c) => c === '0')) {
    return {
      kind: 'zeroFill',
      message:
        `OCR output collapsed to ${total} zero characters — a page that really is a long run of ` +
        'zeros matches this, but so does a known silent-failure signature of some CPU inference ' +
        'backends for Chinese text. Treat this page as unrecognized.',
    };
  }

  if (total >= REPETITIVE_MIN) {
    const { char, ratio, distinct } = dominantChar(chars);
    if (distinct <= REPETITIVE_MAX_DISTINCT && ratio >= REPETITIVE_MIN_RATIO) {
      return {
        kind: 'repetitive',
        message:
          `OCR output is dominated by a single repeated character "${char}" ` +
          `(${Math.round(ratio * 100)}% of ${total} recognized characters) — likely a ` +
          'backend failure rather than real content. Treat this page as unrecognized.',
      };
    }
  }

  return undefined;
}
