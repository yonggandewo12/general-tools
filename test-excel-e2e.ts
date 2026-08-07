import { ExcelService } from './src/excel-service.js';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';

/**
 * Excel 服务端到端验证：TS → Python 子进程 → openpyxl → xlsx。
 * 覆盖创建/写/读/格式化/公式/图表/透视/元数据/合并/范围校验。
 * 运行: PPT_MASTER_PYTHON=<python> npx tsx test-excel-e2e.ts
 */
async function main() {
  const svc = new ExcelService();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-e2e-'));
  const x = path.join(tmp, 'demo.xlsx');
  const log = (label: string, r: { success: boolean; data?: unknown; error?: string }) =>
    console.log(label, r.success ? 'OK' : 'FAIL', r.success ? '' : r.error);

  await log('1.create', await svc.call('create_workbook', { filepath: x }));
  await log('2.write', await svc.call('write_data', {
    filepath: x, sheet_name: 'Sheet1',
    data: [['Region', 'Q1', 'Q2'], ['East', 100, 120], ['West', 80, 90], ['East', 60, 70]],
  }));
  await log('3.read', await svc.call('read_data', { filepath: x, sheet_name: 'Sheet1' }));
  await log('4.format', await svc.call('format_range', { filepath: x, sheet_name: 'Sheet1', start_cell: 'A1', end_cell: 'C1', bold: true, bg_color: '4472C4', font_color: 'FFFFFF' }));
  await log('5.formula', await svc.call('apply_formula', { filepath: x, sheet_name: 'Sheet1', cell: 'D2', formula: '=B2+C2' }));
  await log('6.chart', await svc.call('create_chart', { filepath: x, sheet_name: 'Sheet1', data_range: 'A1:C4', chart_type: 'bar', target_cell: 'F2', title: 'Quarterly' }));
  await log('7.pivot', await svc.call('create_pivot_table', { filepath: x, sheet_name: 'Sheet1', data_range: 'A1:C4', rows: ['Region'], values: ['Q1', 'Q2'], agg_func: 'sum' }));
  await log('8.meta', await svc.call('get_workbook_metadata', { filepath: x, include_ranges: true }));
  await log('9.merge', await svc.call('merge_cells', { filepath: x, sheet_name: 'Sheet1', start_cell: 'A6', end_cell: 'C6' }));
  await log('10.validate', await svc.call('validate_excel_range', { filepath: x, sheet_name: 'Sheet1', start_cell: 'A1', end_cell: 'C4' }));
  await log('11.preview', await svc.call('read_data', { filepath: x, sheet_name: 'Sheet1', preview_only: true }));
  console.log('ALL DONE →', x);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
