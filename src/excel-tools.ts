import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Excel MCP 工具定义与 action 映射。
 * 每个 MCP 工具名映射到 scripts/excel/run.py 中的一个 action（多数同名）。
 * 新增工具只需在此追加 schema 与映射，index.ts 自动生效 —— 可扩展性集中体现。
 */

export const EXCEL_ACTION_MAP: Record<string, string> = {
  excel_create_workbook: 'create_workbook',
  excel_create_worksheet: 'create_worksheet',
  excel_get_workbook_metadata: 'get_workbook_metadata',
  excel_write_data: 'write_data',
  excel_read_data: 'read_data',
  excel_apply_formula: 'apply_formula',
  excel_validate_formula: 'validate_formula_syntax',
  excel_format_range: 'format_range',
  excel_merge_cells: 'merge_cells',
  excel_unmerge_cells: 'unmerge_cells',
  excel_get_merged_cells: 'get_merged_cells',
  excel_create_chart: 'create_chart',
  excel_create_pivot_table: 'create_pivot_table',
  excel_create_table: 'create_table',
  excel_copy_worksheet: 'copy_worksheet',
  excel_delete_worksheet: 'delete_worksheet',
  excel_rename_worksheet: 'rename_worksheet',
  excel_copy_range: 'copy_range',
  excel_delete_range: 'delete_range',
  excel_validate_range: 'validate_excel_range',
  excel_get_data_validation: 'get_data_validation_info',
  excel_insert_rows: 'insert_rows',
  excel_insert_columns: 'insert_columns',
  excel_delete_rows: 'delete_sheet_rows',
  excel_delete_columns: 'delete_sheet_columns',
};

const filepathProp = {
  type: 'string',
  description: 'Path to the Excel .xlsx file (absolute or relative to cwd)',
};
const sheetNameProp = {
  type: 'string',
  description: 'Worksheet name',
};

export const EXCEL_TOOLS: Tool[] = [
  {
    name: 'excel_create_workbook',
    description: 'Create a new empty Excel workbook (.xlsx) with a default sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: { type: 'string', description: 'Name of the default sheet (default: Sheet1)' },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'excel_create_worksheet',
    description: 'Create a new worksheet in an existing workbook.',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, sheet_name: sheetNameProp },
      required: ['filepath', 'sheet_name'],
    },
  },
  {
    name: 'excel_get_workbook_metadata',
    description: 'Get workbook metadata: sheet names, file size, modified time, optional used ranges per sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        include_ranges: { type: 'boolean', description: 'Include used range per sheet (default: false)' },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'excel_write_data',
    description: 'Write a 2D array of data into a worksheet starting at a cell (default A1). Creates the sheet if missing.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: { type: 'string', description: 'Target worksheet (default: active sheet)' },
        data: {
          type: 'array',
          description: 'Array of rows; each row is an array of cell values',
          items: { type: 'array', items: {} },
        },
        start_cell: { type: 'string', description: 'Starting cell (default: A1)' },
      },
      required: ['filepath', 'data'],
    },
  },
  {
    name: 'excel_read_data',
    description: 'Read data from a worksheet range with per-cell metadata (address, value, row, col, validation). End cell optional (auto-expands to used range).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_cell: { type: 'string', description: 'Starting cell (default: A1)' },
        end_cell: { type: 'string', description: 'Ending cell (optional, auto-expands if omitted)' },
        preview_only: { type: 'boolean', description: 'Return only first 10 rows (default: false)' },
      },
      required: ['filepath', 'sheet_name'],
    },
  },
  {
    name: 'excel_apply_formula',
    description: 'Apply an Excel formula to a cell. Validates syntax and rejects unsafe functions (INDIRECT, HYPERLINK, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        cell: { type: 'string', description: 'Target cell, e.g. A1' },
        formula: { type: 'string', description: 'Excel formula, with or without leading =' },
      },
      required: ['filepath', 'sheet_name', 'cell', 'formula'],
    },
  },
  {
    name: 'excel_validate_formula',
    description: 'Validate formula syntax and compare with the cell\'s current formula, without writing.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        cell: { type: 'string' },
        formula: { type: 'string' },
      },
      required: ['filepath', 'sheet_name', 'cell', 'formula'],
    },
  },
  {
    name: 'excel_format_range',
    description: 'Apply formatting to a cell range: font (bold/italic/underline/size/color), fill, border, number format, alignment, wrap, merge, protection, conditional formatting.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_cell: { type: 'string' },
        end_cell: { type: 'string' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        underline: { type: 'boolean' },
        font_size: { type: 'number' },
        font_color: { type: 'string', description: 'Hex color, e.g. FF0000 or FFFF0000' },
        bg_color: { type: 'string' },
        border_style: { type: 'string', enum: ['thin', 'medium', 'thick', 'double', 'dotted', 'dashed'] },
        border_color: { type: 'string' },
        number_format: { type: 'string' },
        alignment: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
        wrap_text: { type: 'boolean' },
        merge_cells: { type: 'boolean' },
        protection: { type: 'object' },
        conditional_format: { type: 'object' },
      },
      required: ['filepath', 'sheet_name', 'start_cell'],
    },
  },
  {
    name: 'excel_merge_cells',
    description: 'Merge a range of cells.',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, sheet_name: sheetNameProp, start_cell: { type: 'string' }, end_cell: { type: 'string' } },
      required: ['filepath', 'sheet_name', 'start_cell', 'end_cell'],
    },
  },
  {
    name: 'excel_unmerge_cells',
    description: 'Unmerge a previously merged range.',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, sheet_name: sheetNameProp, start_cell: { type: 'string' }, end_cell: { type: 'string' } },
      required: ['filepath', 'sheet_name', 'start_cell', 'end_cell'],
    },
  },
  {
    name: 'excel_get_merged_cells',
    description: 'List all merged ranges in a worksheet.',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, sheet_name: sheetNameProp },
      required: ['filepath', 'sheet_name'],
    },
  },
  {
    name: 'excel_create_chart',
    description: 'Create a chart (line/bar/pie/scatter/area) from a data range and anchor it at a target cell.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        data_range: { type: 'string', description: 'e.g. A1:C4 or Sheet2!A1:C4' },
        chart_type: { type: 'string', enum: ['line', 'bar', 'pie', 'scatter', 'area'] },
        target_cell: { type: 'string', description: 'Anchor cell, e.g. E2' },
        title: { type: 'string' },
        x_axis: { type: 'string' },
        y_axis: { type: 'string' },
        style: { type: 'object' },
      },
      required: ['filepath', 'sheet_name', 'data_range', 'chart_type', 'target_cell'],
    },
  },
  {
    name: 'excel_create_pivot_table',
    description: 'Create a summary (pivot) table from source data into a new <sheet>_pivot worksheet, with aggregation (sum/average/count/min/max).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        data_range: { type: 'string' },
        rows: { type: 'array', items: { type: 'string' }, description: 'Fields for row labels' },
        values: { type: 'array', items: { type: 'string' }, description: 'Fields to aggregate' },
        columns: { type: 'array', items: { type: 'string' } },
        agg_func: { type: 'string', enum: ['sum', 'average', 'count', 'min', 'max'], description: 'default: sum' },
      },
      required: ['filepath', 'sheet_name', 'data_range', 'rows', 'values'],
    },
  },
  {
    name: 'excel_create_table',
    description: 'Create a native Excel Table (with style) over a data range.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        data_range: { type: 'string' },
        table_name: { type: 'string' },
        table_style: { type: 'string', description: 'default: TableStyleMedium9' },
      },
      required: ['filepath', 'sheet_name', 'data_range'],
    },
  },
  {
    name: 'excel_copy_worksheet',
    description: 'Copy a worksheet within a workbook.',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, source_sheet: { type: 'string' }, target_sheet: { type: 'string' } },
      required: ['filepath', 'source_sheet', 'target_sheet'],
    },
  },
  {
    name: 'excel_delete_worksheet',
    description: 'Delete a worksheet (refuses the last sheet).',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, sheet_name: sheetNameProp },
      required: ['filepath', 'sheet_name'],
    },
  },
  {
    name: 'excel_rename_worksheet',
    description: 'Rename a worksheet.',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, old_name: { type: 'string' }, new_name: { type: 'string' } },
      required: ['filepath', 'old_name', 'new_name'],
    },
  },
  {
    name: 'excel_copy_range',
    description: 'Copy a cell range to another location (optionally another sheet), preserving values and styles.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        source_start: { type: 'string' },
        source_end: { type: 'string' },
        target_start: { type: 'string' },
        target_sheet: { type: 'string' },
      },
      required: ['filepath', 'sheet_name', 'source_start', 'source_end', 'target_start'],
    },
  },
  {
    name: 'excel_delete_range',
    description: 'Delete a cell range and shift remaining cells up or left.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_cell: { type: 'string' },
        end_cell: { type: 'string' },
        shift_direction: { type: 'string', enum: ['up', 'left'], description: 'default: up' },
      },
      required: ['filepath', 'sheet_name', 'start_cell'],
    },
  },
  {
    name: 'excel_validate_range',
    description: 'Validate that a range is within the worksheet data bounds; returns data dimensions.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_cell: { type: 'string' },
        end_cell: { type: 'string' },
      },
      required: ['filepath', 'sheet_name', 'start_cell'],
    },
  },
  {
    name: 'excel_get_data_validation',
    description: 'List all data validation rules in a worksheet (type, operator, allowed values, ranges).',
    inputSchema: {
      type: 'object',
      properties: { filepath: filepathProp, sheet_name: sheetNameProp },
      required: ['filepath', 'sheet_name'],
    },
  },
  {
    name: 'excel_insert_rows',
    description: 'Insert one or more rows at a position (1-based).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_row: { type: 'number' },
        count: { type: 'number', description: 'default: 1' },
      },
      required: ['filepath', 'sheet_name', 'start_row'],
    },
  },
  {
    name: 'excel_insert_columns',
    description: 'Insert one or more columns at a position (1-based).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_col: { type: 'number' },
        count: { type: 'number', description: 'default: 1' },
      },
      required: ['filepath', 'sheet_name', 'start_col'],
    },
  },
  {
    name: 'excel_delete_rows',
    description: 'Delete one or more rows starting at a position (1-based).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_row: { type: 'number' },
        count: { type: 'number', description: 'default: 1' },
      },
      required: ['filepath', 'sheet_name', 'start_row'],
    },
  },
  {
    name: 'excel_delete_columns',
    description: 'Delete one or more columns starting at a position (1-based).',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: filepathProp,
        sheet_name: sheetNameProp,
        start_col: { type: 'number' },
        count: { type: 'number', description: 'default: 1' },
      },
      required: ['filepath', 'sheet_name', 'start_col'],
    },
  },
];
