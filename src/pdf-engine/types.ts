// 坐标约定：y 轴向下，原点为页面左上角（pdfjs 底部原点 → 翻转）。

export interface PdfRawItem {
  str: string;
  x: number;          // 左边缘 x
  y: number;          // 顶部 y（已翻转，向下递增）
  width: number;
  height: number;
  fontSize: number;   // 近似字号
  fontName: string;
  isBold: boolean;
  hasEOL: boolean;
}

export interface PdfRawImage {
  x: number;   // 页面内摆放位置（设备坐标，top-down）
  y: number;
  width: number;
  height: number;
  pixelWidth: number;   // 原始像素宽
  pixelHeight: number;  // 原始像素高
  kind: number;         // pdfjs ImageKind：1=1bpp灰度 2=RGB24 3=RGBA32
  data: Uint8Array;     // 解码后像素（布局按 kind 解释）
  format: string;       // 'png'（可编码为 PNG）
}

export interface RawPage {
  pageNum: number;
  width: number;
  height: number;
  items: PdfRawItem[];
  images: PdfRawImage[];
}

export interface TextLine {
  x: number;          // 最左 x
  y: number;          // 平均基线 y（top-down）
  width: number;      // 文本总宽
  height: number;     // 行高（字号）
  text: string;
  fontSize: number;   // 行内主要字号（众数）
  isBold: boolean;
  fontName: string;
  /** 组成该行的原始文本项（带坐标），供表格列切分使用（可选，无则整行归首列） */
  items?: PdfRawItem[];
}

export type BlockType =
  | 'heading' | 'paragraph' | 'list-item' | 'table'
  | 'image' | 'header' | 'footer' | 'code' | 'unknown';

export interface TableCell {
  text: string;
}

export interface Table {
  rows: TableCell[][];
}

export interface TextBlock {
  type: BlockType;
  headingLevel?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: TextLine[];
  text: string;       // 拼接文本（用于分类/渲染）
  listMarker?: string;
  table?: Table;
  image?: PdfRawImage;
}

export interface PdfPage {
  pageNum: number;
  width: number;
  height: number;
  blocks: TextBlock[];   // 已按阅读顺序排序
  scanPage: boolean;     // 无文本层的纯图页
}

export interface PdfDocument {
  pageCount: number;
  pages: PdfPage[];
  /** @internal 原始页数据，供布局管线消费，门面组装后置空 */
  _raw?: RawPage[];
}
