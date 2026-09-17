import { describe, it, expect } from 'vitest';
import { getDocxService } from '../src/docx-service.js';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';

/**
 * DOCX 编辑端到端验证：TS → python-docx 子进程 → 编辑已有 .docx。
 * 覆盖读结构 / 改段落 / 追加段落 / 插图片 / 插表格 / 改样式。
 */
describe('docx edit e2e', () => {
  it('runs the full docx edit workflow', async () => {
    const svc = getDocxService();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-e2e-'));
    const x = path.join(tmp, 'demo.docx');

    const expectOk = async (
      label: string,
      result: { success: boolean; error?: string }
    ): Promise<void> => {
      expect(result.success, `${label} failed: ${result.error ?? 'unknown'}`).toBe(true);
    };

    // 先创建一份 docx（纯 JS）
    await svc.createDocument(
      '<h1>原始标题</h1><p>第一段</p><p>第二段</p>',
      x,
      { title: 'demo' },
    );

    // 1. 读结构
    const r1 = await svc.editDocument('read_document', { path: x });
    await expectOk('read', r1);
    const texts = (r1.data as { paragraphs?: { text: string }[] })?.paragraphs?.map((p) => p.text);
    expect(texts).toEqual(expect.arrayContaining(['原始标题', '第一段', '第二段']));

    // 2. 改段落
    await expectOk('edit', await svc.editDocument('edit_paragraph', {
      path: x, index: 1, text: '修改后的第一段',
    }));

    // 3. 追加段落
    await expectOk('add', await svc.editDocument('add_paragraph', {
      path: x, text: '追加段落', bold: true,
    }));

    // 4. 插图片（用任意小 PNG 验证）
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const img = path.join(tmp, 'logo.png');
    await fs.writeFile(img, png);
    await expectOk('image', await svc.editDocument('insert_image', {
      path: x, image_path: img,
    }));

    // 5. 插表格
    await expectOk('table', await svc.editDocument('insert_table', {
      path: x, data: [['列1', '列2'], ['a', 'b']],
    }));

    // 6. 读回验证
    const r6 = await svc.editDocument('read_document', { path: x });
    await expectOk('read-back', r6);
    const d6 = r6.data as { paragraph_count?: number; table_count?: number; inline_shapes?: number };
    expect((d6.table_count ?? 0) >= 1).toBe(true);

    // 7. markdown → docx 结构保留验证（标题样式 + 真表格）
    //    回归防护：MdConverter 输出包在 div.layout 里，若解析只看 body 直接子节点，
    //    所有结构会被拍平成纯文本。
    const md = path.join(tmp, 'from-md.docx');
    const r7c = await svc.convertMdToDocx(
      '# MD 标题\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n',
      undefined,
      md,
      {},
    );
    await expectOk('md-create', r7c);
    const r7 = await svc.editDocument('read_document', { path: md });
    await expectOk('md-read', r7);
    const d7 = r7.data as { paragraphs?: { style: string | null }[]; table_count?: number };
    const hasHeading = (d7.paragraphs ?? []).some((p) => p.style === 'Heading 1');
    expect(hasHeading, 'markdown Heading 1 must be preserved').toBe(true);
    expect((d7.table_count ?? 0) >= 1, 'markdown table must be preserved').toBe(true);
  }, 60000);
});