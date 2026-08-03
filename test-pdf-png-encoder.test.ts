import { describe, it, expect } from 'vitest';
import { encodePng, ImageKind } from './src/pdf-engine/png-encoder.js';

describe('png-encoder', () => {
  it('encodes RGBA32 data', async () => {
    const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const png = await encodePng(2, 1, ImageKind.RGBA_32BPP, data);
    expect(png).not.toBeNull();
    expect(png!.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('encodes RGB24 data', async () => {
    const data = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const png = await encodePng(2, 1, ImageKind.RGB_24BPP, data);
    expect(png).not.toBeNull();
  });

  it('encodes 1bpp data with row stride', async () => {
    // 9px wide => 2 bytes/row, 2 rows; bit 0 = white (255), bit 1 = black (0)
    const data = new Uint8Array([
      0b10000000, 0b00000000,
      0b01000000, 0b00000000,
    ]);
    const png = await encodePng(9, 2, ImageKind.GRAYSCALE_1BPP, data);
    expect(png).not.toBeNull();
  });

  it('returns null for incomplete data', async () => {
    expect(await encodePng(2, 2, ImageKind.RGBA_32BPP, new Uint8Array(4))).toBeNull();
  });

  it('returns null for zero-size images', async () => {
    expect(await encodePng(0, 1, ImageKind.RGBA_32BPP, new Uint8Array(4))).toBeNull();
  });
});
