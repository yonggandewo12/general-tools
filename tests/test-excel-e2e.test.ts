import { describe, it, expect } from 'vitest';
import { ExcelService } from '../src/excel-service.js';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';

/**
 * Excel 服务端到端验证：TS → Python 子进程 → openpyxl → xlsx。
 * 覆盖创建/写/读/格式化/公式/图表/透视/元数据/合并/范围校验。
 */
describe('excel e2e', () => {
  it('runs the full excel workflow', async () => {
    const svc = new ExcelService();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-e2e-'));
    const x = path.join(tmp, 'demo.xlsx');

    const expectOk = async (
      label: string,
      result: { success: boolean; error?: string }
    ): Promise<void> => {
      expect(result.success, `${label} failed: ${result.error ?? 'unknown'}`).toBe(true);
    };

    await expectOk('create', await svc.call('create_workbook', { filepath: x }));
    await expectOk('write', await svc.call('write_data', {
      filepath: x, sheet_name: 'Sheet1',
      data: [['Region', 'Q1', 'Q2'], ['East', 100, 120], ['West', 80, 90], ['East', 60, 70]],
    }));
    await expectOk('read', await svc.call('read_data', { filepath: x, sheet_name: 'Sheet1' }));
    await expectOk('format', await svc.call('format_range', {
      filepath: x, sheet_name: 'Sheet1', start_cell: 'A1', end_cell: 'C1',
      bold: true, bg_color: '4472C4', font_color: 'FFFFFF',
    }));
    await expectOk('formula', await svc.call('apply_formula', {
      filepath: x, sheet_name: 'Sheet1', cell: 'D2', formula: '=B2+C2',
    }));
    await expectOk('chart', await svc.call('create_chart', {
      filepath: x, sheet_name: 'Sheet1', data_range: 'A1:C4',
      chart_type: 'bar', target_cell: 'F2', title: 'Quarterly',
    }));
    await expectOk('pivot', await svc.call('create_pivot_table', {
      filepath: x, sheet_name: 'Sheet1', data_range: 'A1:C4',
      rows: ['Region'], values: ['Q1', 'Q2'], agg_func: 'sum',
    }));
    await expectOk('meta', await svc.call('get_workbook_metadata', {
      filepath: x, include_ranges: true,
    }));
    await expectOk('merge', await svc.call('merge_cells', {
      filepath: x, sheet_name: 'Sheet1', start_cell: 'A6', end_cell: 'C6',
    }));
    await expectOk('validate', await svc.call('validate_excel_range', {
      filepath: x, sheet_name: 'Sheet1', start_cell: 'A1', end_cell: 'C4',
    }));
    await expectOk('preview', await svc.call('read_data', {
      filepath: x, sheet_name: 'Sheet1', preview_only: true,
    }));
  }, 60000);
});