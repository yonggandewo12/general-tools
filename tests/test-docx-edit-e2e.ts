import { getDocxService } from '../src/docx-service.js';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';

/**
 * DOCX 编辑端到端验证：TS → python-docx 子进程 → 编辑已有 .docx。
 * 覆盖读结构 / 改段落 / 追加段落 / 插图片 / 插表格 / 改样式。
 * 运行: npx tsx test-docx-edit-e2e.ts
 */
async function main() {
  const svc = getDocxService();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-e2e-'));
  const x = path.join(tmp, 'demo.docx');
  const log = (label: string, r: { success: boolean; error?: string }) =>
    console.log(label, r.success ? 'OK' : 'FAIL', r.success ? '' : r.error);

  // 先创建一份 docx（纯 JS）
  await svc.createDocument(
    '<h1>原始标题</h1><p>第一段</p><p>第二段</p>',
    x,
    { title: 'demo' },
  );

  // 1. 读结构
  const r1 = await svc.editDocument('read_document', { path: x });
  log('1.read', r1);
  if (r1.success) {
    const texts = (r1.data as { paragraphs?: { text: string }[] })?.paragraphs?.map((p) => p.text);
    console.log('   paragraphs:', JSON.stringify(texts));
  }

  // 2. 改段落
  await log('2.edit', await svc.editDocument('edit_paragraph', { path: x, index: 1, text: '修改后的第一段' }));

  // 3. 追加段落
  await log('3.add', await svc.editDocument('add_paragraph', { path: x, text: '追加段落', bold: true }));

  // 4. 插图片（用任意小 PNG 验证）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const img = path.join(tmp, 'logo.png');
  await fs.writeFile(img, png);
  await log('4.image', await svc.editDocument('insert_image', { path: x, image_path: img }));

  // 5. 插表格
  await log('5.table', await svc.editDocument('insert_table', { path: x, data: [['列1', '列2'], ['a', 'b']] }));

  // 6. 读回验证
  const r6 = await svc.editDocument('read_document', { path: x });
  log('6.read-back', r6);
  if (r6.success) {
    const d = r6.data as { paragraph_count?: number; table_count?: number; inline_shapes?: number };
    console.log('   count:', JSON.stringify(d));
  }

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
  log('7.md-create', r7c);
  const r7 = await svc.editDocument('read_document', { path: md });
  log('7.md-read', r7);
  if (r7.success) {
    const d = r7.data as { paragraphs?: { style: string | null }[]; table_count?: number };
    const hasHeading = (d.paragraphs ?? []).some((p) => p.style === 'Heading 1');
    console.log('   md heading preserved:', hasHeading, '| tables:', d.table_count);
    if (!hasHeading || (d.table_count ?? 0) < 1) {
      console.error('FAIL: markdown structure lost in docx conversion');
      process.exit(1);
    }
  }

  console.log('ALL DONE →', x);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
