import { deflateSync } from 'zlib';

// pdfjs ImageKind 常量（与 pdfjs-dist 一致）
export const ImageKind = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
} as const;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * 将 pdfjs 解码后的像素数据编码为 PNG（RGBA 输出）。
 * kind 取值见 ImageKind：1=1bpp 灰度、2=RGB24、3=RGBA32。
 * 返回 null 表示数据不完整，调用方应跳过该图。
 */
export function encodePng(
  width: number,
  height: number,
  kind: number,
  data: Uint8Array | Uint8ClampedArray,
): Uint8Array | null {
  if (width <= 0 || height <= 0 || data.length === 0) return null;

  const expectedBytes =
    kind === ImageKind.GRAYSCALE_1BPP
      ? Math.ceil((width * height) / 8)
      : kind === ImageKind.RGB_24BPP
        ? width * height * 3
        : kind === ImageKind.RGBA_32BPP
          ? width * height * 4
          : 0;
  if (expectedBytes === 0 || data.length < expectedBytes) return null;

  // 每行前置 1 字节滤波器（none），像素统一转 RGBA
  const rgba = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rgba[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const dst = rowStart + 1 + x * 4;
      if (kind === ImageKind.RGBA_32BPP) {
        const src = (y * width + x) * 4;
        rgba[dst] = data[src];
        rgba[dst + 1] = data[src + 1];
        rgba[dst + 2] = data[src + 2];
        rgba[dst + 3] = data[src + 3];
      } else if (kind === ImageKind.RGB_24BPP) {
        const src = (y * width + x) * 3;
        rgba[dst] = data[src];
        rgba[dst + 1] = data[src + 1];
        rgba[dst + 2] = data[src + 2];
        rgba[dst + 3] = 255;
      } else {
        // 1bpp：每行按字节对齐，字节内高位先出
        const rowStride = (width + 7) >> 3;
        const byte = data[y * rowStride + (x >> 3)];
        const v = ((byte >> (7 - (x & 7))) & 1) ? 255 : 0;
        rgba[dst] = v;
        rgba[dst + 1] = v;
        rgba[dst + 2] = v;
        rgba[dst + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const idat = deflateSync(rgba, { level: 6 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
  );
}
