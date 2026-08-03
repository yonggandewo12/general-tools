import { PdfDocument } from './types.js';

export interface JsonBlock {
  type: string;
  headingLevel?: number;
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  table?: { rows: { text: string }[][] };
  listMarker?: string;
}

export interface JsonPage {
  pageNum: number;
  width: number;
  height: number;
  scanPage: boolean;
  blocks: JsonBlock[];
}

export interface JsonDocument {
  pageCount: number;
  pages: JsonPage[];
}

export function renderJson(doc: PdfDocument): JsonDocument {
  return {
    pageCount: doc.pageCount,
    pages: doc.pages.map((p) => ({
      pageNum: p.pageNum,
      width: p.width,
      height: p.height,
      scanPage: p.scanPage,
      blocks: p.blocks.map((b) => ({
        type: b.type,
        ...(b.headingLevel !== undefined ? { headingLevel: b.headingLevel } : {}),
        ...(b.listMarker !== undefined ? { listMarker: b.listMarker } : {}),
        text: b.text || undefined,
        bbox: { x: b.x, y: b.y, width: b.width, height: b.height },
        ...(b.table ? { table: { rows: b.table.rows } } : {}),
      })),
    })),
  };
}
