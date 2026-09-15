/**
 * PPTX 读取/编辑工具单元测试（python-pptx 子进程）。
 * 依赖嵌入运行时（PPT_MASTER_PYTHON 可指定）。
 * 测试夹具：在 setup 中用嵌入 python-pptx 生成 2 页演示文稿。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import { PptService } from '../src/ppt-service.js';
import { PythonScriptRunner } from '../src/python-runner.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'pptx-ops-test-'));

const svc = new PptService();
// 复用与 service 相同的解释器解析（嵌入运行时），保证夹具生成与子进程调用一致。
const py = new PythonScriptRunner().pythonExecutable;

/** 生成 2 页的测试 pptx（标题 + 项目符号）。 */
async function makeDeck(dir: string, name = 'deck.pptx'): Promise<string> {
  const out = path.join(dir, name);
  const code = `
from pptx import Presentation
prs = Presentation()
s1 = prs.slides.add_slide(prs.slide_layouts[0])
s1.shapes.title.text = 'Fixture Title'
s1.placeholders[1].text = 'Bullet one'
s2 = prs.slides.add_slide(prs.slide_layouts[1])
s2.shapes.title.text = 'Second Slide'
s2.placeholders[1].text = 'Item A\\nItem B'
prs.save(${JSON.stringify(out)})
`;
  const r = spawnSync(py, ['-c', code], { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`Cannot create fixture pptx: ${r.stderr}`);
  }
  return out;
}

let deckPath: string;
let dir: string;

beforeAll(async () => {
  dir = await tmp();
  deckPath = await makeDeck(dir);
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('PPTX 读取', () => {
  it('pptx_read_presentation 返回页数与标题', async () => {
    const r = await svc.call('read_presentation', { pptxPath: deckPath });
    expect(r.success).toBe(true);
    expect(r.data!.slideCount).toBe(2);
    const titles = (r.data!.slides as { title: string }[]).map((s) => s.title);
    expect(titles).toContain('Fixture Title');
  });

  it('pptx_read_slide_details 返回 shapes', async () => {
    const r = await svc.call('read_slide_details', { pptxPath: deckPath, slideIndex: 1 });
    expect(r.success).toBe(true);
    const shapes = r.data!.shapes as { text: string }[];
    expect(shapes.some((s) => s.text === 'Fixture Title')).toBe(true);
  });

  it('pptx_extract_text 生成 markdown', async () => {
    const out = path.join(dir, 'deck.md');
    const r = await svc.call('extract_text', { pptxPath: deckPath, outputPath: out });
    expect(r.success).toBe(true);
    expect(r.data!.markdown).toContain('Fixture Title');
    await fs.access(out); // 文件确实写出
  });

  it('pptx_to_images 渲染每页为图片', async () => {
    const outDir = path.join(dir, 'imgs');
    const r = await svc.call('to_images', { pptxPath: deckPath, outputDir: outDir, dpi: 72 });
    expect(r.success).toBe(true);
    expect((r.data!.files as unknown[]).length).toBe(2);
    for (const f of r.data!.files as { path: string }[]) {
      await fs.access(f.path);
    }
  });

  it('pptx_to_images 的 dpi 对应真实像素尺寸（10in 宽 → dpi×10）', async () => {
    const outDir = path.join(dir, 'imgs-dpi');
    const r = await svc.call('to_images', { pptxPath: deckPath, outputDir: outDir, dpi: 144 });
    expect(r.success).toBe(true);
    const files = r.data!.files as { width: number; height: number }[];
    // 夹具为 10×7.5 英寸；SVG 画布按 96px/英寸生成，缩放基准必须是 96 而非 72。
    expect(files[0].width).toBe(1440);
    expect(files[0].height).toBe(1080);
  });

  it('pptx_to_images 把幻灯片内嵌图片渲染进输出（非空白）', async () => {
    const seed = path.join(dir, 'seed.png');
    const picDeck = path.join(dir, 'pic.pptx');
    const code = `
from PIL import Image
from pptx import Presentation
from pptx.util import Inches
Image.new('RGB', (200, 120), (220, 30, 30)).save(${JSON.stringify(seed)})
prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.add_picture(${JSON.stringify(seed)}, Inches(1), Inches(2), width=Inches(3))
prs.save(${JSON.stringify(picDeck)})
`;
    const made = spawnSync(py, ['-c', code], { encoding: 'utf-8' });
    expect(made.status).toBe(0);

    const outDir = path.join(dir, 'imgs-pic');
    const r = await svc.call('to_images', { pptxPath: picDeck, outputDir: outDir, dpi: 96 });
    expect(r.success).toBe(true);

    // 统计红色像素：外部 href 无法被 pymupdf 解析，只有内联 data URI 才有红色。
    const check = spawnSync(
      py,
      [
        '-c',
        `
from PIL import Image
im = Image.open(${JSON.stringify(path.join(outDir, 'slide_001.png'))}).convert('RGB')
red = sum(1 for p in im.get_flattened_data() if p[0] > 150 and p[1] < 100 and p[2] < 100)
print(red)
`,
      ],
      { encoding: 'utf-8' },
    );
    expect(check.status).toBe(0);
    expect(Number(check.stdout.trim())).toBeGreaterThan(1000);
  });

  it('读取不存在的文件返回失败', async () => {
    const r = await svc.call('read_presentation', { pptxPath: path.join(dir, 'no.pptx') });
    expect(r.success).toBe(false);
  });
});

describe('单行 JSON 协议健壮性', () => {
  // 库层（如 PyMuPDF 的 C 代码）会绕过 sys.stdout 直接写 fd 1，既污染协议
  // 也无法被 redirect_stdout 捕获。run.py 应把这类杂散输出转到 stderr。
  it('库层直接写 fd 1 的杂散输出不会污染协议', async () => {
    const runPy = path.join(process.cwd(), 'scripts', 'ppt-master', 'scripts', 'ppt_mcp', 'run.py');
    const driver = `
import importlib.util, os, sys
sys.argv = ['run.py', '--action', 'read_presentation', '--params', ${JSON.stringify(
      JSON.stringify({ pptxPath: deckPath }),
    )}]
spec = importlib.util.spec_from_file_location('ppt_run', ${JSON.stringify(runPy)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
os.write(1, b"svg: ignoring external image '../assets/image2.png'\\n")
print('stray print line')
sys.exit(mod.main())
`;
    const r = spawnSync(py, ['-c', driver], { encoding: 'utf-8', cwd: process.cwd() });

    // stdout 必须仍是可解析的单行 JSON
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { success: boolean; data: { slideCount: number } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.slideCount).toBe(2);

    // 杂散输出被改道到 stderr
    expect(r.stderr).toContain('ignoring external image');
    expect(r.stderr).toContain('stray print line');
  });
});

describe('PPTX 编辑', () => {
  it('pptx_replace_text 替换指定页文字', async () => {
    const out = path.join(dir, 'edit1.pptx');
    const r = await svc.call('replace_text', {
      pptxPath: deckPath,
      outputPath: out,
      sourceSlide: 1,
      replacements: [{ shape_id: 2, text: 'Edited Title' }],
    });
    expect(r.success).toBe(true);
    // 用读取工具回读验证
    const read = await svc.call('read_presentation', { pptxPath: out });
    const titles = (read.data!.slides as { title: string }[]).map((s) => s.title);
    expect(titles).toContain('Edited Title');
    // 页数保持 2（apply_plan 只输出 plan 列出的页）
    expect(read.data!.slideCount).toBe(2);
  });

  it('pptx_duplicate_slide 复制页并保留原页', async () => {
    const out = path.join(dir, 'edit2.pptx');
    const r = await svc.call('duplicate_slide', {
      pptxPath: deckPath,
      outputPath: out,
      slideIndex: 1,
      count: 1,
    });
    expect(r.success).toBe(true);
    const read = await svc.call('read_presentation', { pptxPath: out });
    expect(read.data!.slideCount).toBe(3);
  });

  it('pptx_add_notes 添加演讲者备注', async () => {
    const out = path.join(dir, 'edit3.pptx');
    const r = await svc.call('add_notes', {
      pptxPath: deckPath,
      outputPath: out,
      notes: [{ slideIndex: 1, text: 'Speak slowly' }],
    });
    expect(r.success).toBe(true);
    // 用 python 读回 notes 验证
    const code = `
from pptx import Presentation
p = Presentation(${JSON.stringify(out)})
print(p.slides[0].has_notes_slide and p.slides[0].notes_slide.notes_text_frame.text or '')
`;
    const rv = spawnSync(py, ['-c', code], { encoding: 'utf-8' });
    expect(rv.stdout.trim()).toContain('Speak slowly');
  });

  it('pptx_set_transitions 设置转场不崩溃', async () => {
    const out = path.join(dir, 'edit4.pptx');
    const r = await svc.call('set_transitions', {
      pptxPath: deckPath,
      outputPath: out,
      transition: 'fade',
      duration: 1.0,
    });
    expect(r.success).toBe(true);
    const read = await svc.call('read_presentation', { pptxPath: out });
    expect(read.data!.slideCount).toBe(2);
  });
});
