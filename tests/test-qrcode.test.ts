import { describe, expect, it } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { generateQrcode } from '../src/qrcode-service.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'qrcode-test-'));

describe('generateQrcode 输出格式与元数据', () => {
  it('.jpg 输出被显式拒绝（qrcode 只能写 png/svg）', async () => {
    const dir = await tmp();
    const r = await generateQrcode({ text: 'hello', outputPath: path.join(dir, 'code.jpg') });
    expect(r.success).toBe(false);
    expect(r.error).toContain('.jpg');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('.png 输出真实 PNG 字节且返回 fileSize', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'code.png');
    const r = await generateQrcode({ text: 'hello', outputPath: out });
    expect(r.success).toBe(true);
    expect(r.format).toBe('png');
    expect(typeof r.fileSize).toBe('number');
    expect(r.fileSize).toBeGreaterThan(0);
    const head = (await fs.readFile(out)).subarray(0, 8);
    expect([...head.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(r.fileSize).toBe((await fs.stat(out)).size);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('.svg 输出为 SVG 文本', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'code.svg');
    const r = await generateQrcode({ text: 'hello', outputPath: out });
    expect(r.success).toBe(true);
    expect(r.format).toBe('svg');
    expect(await fs.readFile(out, 'utf-8')).toMatch(/^<\?xml|<svg/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('format 与扩展名冲突时报错', async () => {
    const dir = await tmp();
    const r = await generateQrcode({
      text: 'hello',
      outputPath: path.join(dir, 'code.svg'),
      format: 'png',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('不一致');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('无扩展名路径 + 显式 format 按该格式写入，不误报冲突', async () => {
    const dir = await tmp();
    const svg = await generateQrcode({ text: 'hello', outputPath: path.join(dir, 'out'), format: 'svg' });
    expect(svg.success).toBe(true);
    expect(svg.format).toBe('svg');
    expect(await fs.readFile(path.join(dir, 'out'), 'utf-8')).toMatch(/^<\?xml|<svg/);
    const png = await generateQrcode({ text: 'hello', outputPath: path.join(dir, 'out2'), format: 'png' });
    expect(png.success).toBe(true);
    expect([...(await fs.readFile(path.join(dir, 'out2'))).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('dataURL 不写文件，提供 outputPath 时报错', async () => {
    const dir = await tmp();
    const ok = await generateQrcode({ text: 'hello', format: 'dataURL' });
    expect(ok.success).toBe(true);
    expect(ok.dataURL).toMatch(/^data:image\/png;base64,/);
    const bad = await generateQrcode({
      text: 'hello',
      format: 'dataURL',
      outputPath: path.join(dir, 'x.png'),
    });
    expect(bad.success).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
