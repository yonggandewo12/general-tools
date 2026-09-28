/**
 * CJK 字体嵌入共享工具：pdf-lib 的 embedFont 经 fontkit.create 解析字体，
 * TTC/OTC 字体集合会返回 Collection（无 createSubset），导致嵌入抛
 * "createSubset is not a function"。mac/Linux/Windows 的系统 CJK 字体多为
 * TTC（PingFang/Songti/NotoSansCJK/msyh/simsun），必须支持。
 *
 * 方案：包装 fontkit，create 命中集合时返回第一个可用 face，
 * embedFont 公开 API 即可直接嵌入 TTC。
 */
import fontkitBase from '@pdf-lib/fontkit';
import type { PDFDocument } from 'pdf-lib';

const fontkitRaw = fontkitBase as unknown as {
  create: (data: Uint8Array | ArrayBuffer) => unknown;
};

interface FontkitLike {
  create: (data: Uint8Array | ArrayBuffer) => Promise<unknown>;
}

/** 返回把字体集合展开为首个 face 的 fontkit 适配对象。 */
export function collectionAwareFontkit(): FontkitLike {
  return {
    create: async (data) => {
      const font = await fontkitRaw.create(data);
      const collection = font as { fonts?: unknown[] };
      return collection && Array.isArray(collection.fonts) && collection.fonts.length > 0
        ? collection.fonts[0]
        : font;
    },
  };
}

/**
 * 嵌入一个可能为 TTC 集合的字体文件（子集化）。
 * 失败（损坏/无 face）时抛错，由调用方决定回退策略。
 */
export async function embedFontBytesSupportingTtc(
  doc: PDFDocument,
  fontBytes: Uint8Array,
): Promise<Awaited<ReturnType<PDFDocument['embedFont']>>> {
  doc.registerFontkit(collectionAwareFontkit() as unknown as Parameters<PDFDocument['registerFontkit']>[0]);
  return doc.embedFont(new Uint8Array(fontBytes), { subset: true });
}
