import { PdfDocument, TextBlock } from './types.js';

export interface MarkdownRenderOptions {
  pageSeparator?: string;
  imageBasePath?: string;   // 图片引用前缀（如 'xxx_files'）
  imageOutput?: 'off' | 'embedded' | 'external';
  scanPagePlaceholder?: string;
}

export function renderMarkdown(doc: PdfDocument, options: MarkdownRenderOptions = {}): string {
  const parts: string[] = [];
  let imageCount = 0;

  for (let p = 0; p < doc.pages.length; p++) {
    const page = doc.pages[p];
    const pageParts: string[] = [];

    if (page.scanPage) {
      pageParts.push(options.scanPagePlaceholder ?? '_[此页为扫描页，无可提取文本层]_');
    }

    for (const b of page.blocks) {
      const md = renderBlock(b, options, () => ++imageCount);
      if (md) pageParts.push(md);
    }

    if (pageParts.length > 0) {
      parts.push(pageParts.join('\n\n'));
    }
  }

  const sep = options.pageSeparator ?? '\n\n---\n\n';
  return parts.join(sep);
}

function renderBlock(b: TextBlock, options: MarkdownRenderOptions, nextImage: () => number): string {
  switch (b.type) {
    case 'heading': {
      const level = b.headingLevel ?? 1;
      return '#'.repeat(Math.min(level, 6)) + ' ' + b.text;
    }
    case 'paragraph':
      return b.text;
    case 'list-item': {
      const marker = b.listMarker && /^\d+[.)]$/.test(b.listMarker) ? b.listMarker : '-';
      return `${marker} ${b.text.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}`;
    }
    case 'code':
      return '```\n' + b.text + '\n```';
    case 'table': {
      if (!b.table || b.table.rows.length === 0) return '';
      const header = b.table.rows[0];
      const body = b.table.rows.slice(1);
      const cols = Math.max(header.length, ...body.map((r) => r.length));
      const pad = (row: { text: string }[]) => {
        const cells = Array.from({ length: cols }, (_, i) => row[i]?.text ?? '');
        return '| ' + cells.join(' | ') + ' |';
      };
      const sepRow = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
      return [pad(header), sepRow, ...body.map(pad)].join('\n');
    }
    case 'image': {
      if (options.imageOutput === 'off' || !b.image) return '';
      const idx = nextImage();
      const base = options.imageBasePath ?? '';
      const ref = base ? `${base}/img-${idx}.png` : `img-${idx}.png`;
      return `![image](${ref})`;
    }
    case 'header':
    case 'footer':
      return '';
    case 'unknown':
    default:
      return b.text;
  }
}
