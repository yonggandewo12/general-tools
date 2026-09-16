import { promises as fs } from 'fs';
import * as path from 'path';

export interface MarkdownSource {
  mdText: string;
  baseDir: string | undefined;
}

/**
 * 读取 Markdown 源：mdPath（本地文件，返回其所在目录供相对资源解析）
 * 或 mdContent（原始字符串）。两者都缺时抛错。
 *
 * index.ts 的 convert_md_to_html / convert_md_to_docx / md_to_epub 与
 * md-converter 的 convertMdToPdf 共用，避免各写一份校验与读取逻辑。
 */
export async function readMarkdownSource(
  mdPath?: string,
  mdContent?: string,
): Promise<MarkdownSource> {
  if (!mdPath && !mdContent) {
    throw new Error('Either mdPath or mdContent must be provided');
  }
  if (mdPath) {
    const mdFilePath = path.resolve(mdPath);
    await fs.access(mdFilePath);
    return { mdText: await fs.readFile(mdFilePath, 'utf-8'), baseDir: path.dirname(mdFilePath) };
  }
  return { mdText: mdContent!, baseDir: undefined };
}
