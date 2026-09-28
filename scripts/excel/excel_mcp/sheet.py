"""工作表与范围级操作：复制/删除/重命名工作表、合并、范围复制/删除、行列增删。"""

from __future__ import annotations

import logging
from copy import copy
from typing import Any

from openpyxl.utils import column_index_from_string, get_column_letter

from ._utils import (
    edit_workbook,
    open_workbook,
    parse_cell_range,
    parse_cell_ref,
    range_to_str,
    require_sheet,
    validate_cell_ref,
)
from .exceptions import SheetError, ValidationError

logger = logging.getLogger(__name__)


# ────────────────────────────── 工作表 ──────────────────────────────

def copy_sheet(filepath: str, source_sheet: str, target_sheet: str) -> dict[str, Any]:
    try:
        with edit_workbook(filepath) as wb:
            if source_sheet not in wb.sheetnames:
                raise SheetError(f"Source sheet {source_sheet!r} not found")
            if target_sheet in wb.sheetnames:
                raise SheetError(f"Target sheet {target_sheet!r} already exists")
            target = wb.copy_worksheet(wb[source_sheet])
            target.title = target_sheet
        return {"message": f"Sheet {source_sheet!r} copied to {target_sheet!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to copy sheet: %s", e)
        raise SheetError(str(e)) from e


def delete_sheet(filepath: str, sheet_name: str) -> dict[str, Any]:
    try:
        with edit_workbook(filepath) as wb:
            if sheet_name not in wb.sheetnames:
                raise SheetError(f"Sheet {sheet_name!r} not found")
            if len(wb.sheetnames) == 1:
                raise SheetError("Cannot delete the only sheet in workbook")
            del wb[sheet_name]
        return {"message": f"Sheet {sheet_name!r} deleted"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to delete sheet: %s", e)
        raise SheetError(str(e)) from e


def rename_sheet(filepath: str, old_name: str, new_name: str) -> dict[str, Any]:
    try:
        with edit_workbook(filepath) as wb:
            if old_name not in wb.sheetnames:
                raise SheetError(f"Sheet {old_name!r} not found")
            if new_name in wb.sheetnames:
                raise SheetError(f"Sheet {new_name!r} already exists")
            wb[old_name].title = new_name
        return {"message": f"Sheet renamed from {old_name!r} to {new_name!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to rename sheet: %s", e)
        raise SheetError(str(e)) from e


# ────────────────────────────── 合并 ──────────────────────────────

def merge_range(filepath: str, sheet_name: str, start_cell: str, end_cell: str) -> dict[str, Any]:
    try:
        sr, sc, er, ec = parse_cell_range(start_cell, end_cell)
        if er is None or ec is None:
            raise SheetError("Both start and end cells must be specified for merging")
        rng = range_to_str(sr, sc, er, ec)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            ws.merge_cells(rng)
        return {"message": f"Range {rng!r} merged in sheet {sheet_name!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to merge range: %s", e)
        raise SheetError(str(e)) from e


def unmerge_range(filepath: str, sheet_name: str, start_cell: str, end_cell: str) -> dict[str, Any]:
    try:
        sr, sc, er, ec = parse_cell_range(start_cell, end_cell)
        if er is None or ec is None:
            raise SheetError("Both start and end cells must be specified for unmerging")
        rng = range_to_str(sr, sc, er, ec)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            merged = {str(m).upper() for m in ws.merged_cells.ranges}
            if rng.upper() not in merged:
                raise SheetError(f"Range {rng!r} is not merged")
            ws.unmerge_cells(rng)
        return {"message": f"Range {rng!r} unmerged successfully"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to unmerge range: %s", e)
        raise SheetError(str(e)) from e


def get_merged_ranges(filepath: str, sheet_name: str) -> list[str]:
    try:
        with open_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            return [str(m) for m in ws.merged_cells.ranges]
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to get merged cells: %s", e)
        raise SheetError(str(e)) from e


# ────────────────────────────── 范围复制/删除 ──────────────────────────────

def _copy_cell_style(src, dst) -> None:
    """安全复制单元格样式，忽略不支持属性。"""
    try:
        dst.value = src.value
        if src.has_style:
            dst.font = copy(src.font)
            dst.border = copy(src.border)
            dst.fill = copy(src.fill)
            dst.number_format = src.number_format
            dst.alignment = copy(src.alignment)
            dst.protection = copy(src.protection)
    except Exception:
        dst.value = src.value


def copy_range_operation(
    filepath: str,
    sheet_name: str,
    source_start: str,
    source_end: str,
    target_start: str,
    target_sheet: str | None = None,
) -> dict[str, Any]:
    try:
        sr, sc, er, ec = parse_cell_range(source_start, source_end)
        if er is None or ec is None:
            er, ec = sr, sc
        tr, tc = parse_cell_ref(target_start)
        with edit_workbook(filepath) as wb:
            src_ws = require_sheet(wb, sheet_name)
            dst_ws = require_sheet(wb, target_sheet) if target_sheet else src_ws
            row_off = tr - sr
            col_off = tc - sc
            for r in range(sr, er + 1):
                for c in range(sc, ec + 1):
                    _copy_cell_style(src_ws.cell(row=r, column=c), dst_ws.cell(row=r + row_off, column=c + col_off))
        return {"message": "Range copied successfully"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to copy range: %s", e)
        raise SheetError(str(e)) from e


def delete_range_operation(
    filepath: str,
    sheet_name: str,
    start_cell: str,
    end_cell: str | None = None,
    shift_direction: str = "up",
) -> dict[str, Any]:
    try:
        if shift_direction not in ("up", "left"):
            raise ValidationError(f"Invalid shift direction: {shift_direction}. Must be 'up' or 'left'")
        sr, sc, er, ec = parse_cell_range(start_cell, end_cell)
        if er is None or ec is None:
            er, ec = sr, sc
        rng = range_to_str(sr, sc, er, ec)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            # 删除即移除整行/整列并上移，无需先清区：清区会把范围内单元格的
            # alignment 置 None（openpyxl 序列化出空 <alignment/> 样式索引），
            # 且先清后删会误伤与范围无关的既有合并区。
            if shift_direction == "up":
                _row_col_op_preserving_merges(ws, "row", sr, er - sr + 1, inserting=False)
            else:
                _row_col_op_preserving_merges(ws, "col", sc, ec - sc + 1, inserting=False)
        return {"message": f"Range {rng} deleted successfully"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to delete range: %s", e)
        raise SheetError(str(e)) from e


# ────────────────────────────── 行列增删 ──────────────────────────────

def _validate_count(start: int, count: int, *, is_row: bool) -> None:
    if start < 1:
        raise ValidationError(f"Start {'row' if is_row else 'column'} must be 1 or greater")
    if count < 1:
        raise ValidationError("Count must be 1 or greater")


def _transform_interval(lo: int, hi: int, start: int, count: int, inserting: bool) -> tuple[int, int] | None:
    """一维区间在插入/删除后的新位置；None 表示合并区完全落在删除带内、应移除。

    删除的坐标映射：r < start 不动；start <= r <= start+count-1 消失；
    r > start+count-1 上移 count。区间底部伸到删除带下方时整体上移 count，
    不能只减去与本区间的 overlap（那是会算出多余行高的错误）。
    """
    if inserting:
        new_lo = lo + count if lo >= start else lo
        new_hi = hi + count if hi >= start else hi
        return new_lo, new_hi
    end = start + count - 1
    if hi < start:
        return lo, hi  # 完全在删除带上方：不动
    if lo > end:
        return lo - count, hi - count  # 完全在下方：整体上移
    overlap = min(hi, end) - max(lo, start) + 1
    if overlap >= hi - lo + 1:
        return None  # 完全落入删除带
    # 跨越删除带：上方幸存 [lo, start-1]；下方幸存映射到 [start, hi-count]
    new_lo = lo if lo < start else start
    new_hi = (hi - count) if hi > end else (start - 1)
    return new_lo, new_hi


def _row_col_op_preserving_merges(
    ws, kind: str, start: int, count: int, *, inserting: bool
) -> None:
    """openpyxl 的 insert/delete_rows/cols 不会正确维护跨越操作点的
    merged_cells.ranges，保存后产生重叠 merge 条目（Excel 报“已修复记录”）。
    做法：先全部 unmerge 记下矩形，执行行列操作，再按新坐标重新 merge。"""
    rects = [
        (r.min_row, r.min_col, r.max_row, r.max_col)
        for r in list(ws.merged_cells.ranges)
    ]
    for r in list(ws.merged_cells.ranges):
        ws.unmerge_cells(str(r))

    if kind == "row":
        (ws.insert_rows if inserting else ws.delete_rows)(start, count)
    else:
        (ws.insert_cols if inserting else ws.delete_cols)(start, count)

    for min_row, min_col, max_row, max_col in rects:
        if kind == "row":
            t = _transform_interval(min_row, max_row, start, count, inserting=inserting)
            if t is None:
                continue  # 合并区整体被删除
            new_min_row, new_max_row = t
            new_min_col, new_max_col = min_col, max_col
        else:
            t = _transform_interval(min_col, max_col, start, count, inserting=inserting)
            if t is None:
                continue
            new_min_col, new_max_col = t
            new_min_row, new_max_row = min_row, max_row
        if new_max_row > new_min_row or new_max_col > new_min_col:
            ws.merge_cells(
                start_row=new_min_row,
                start_column=new_min_col,
                end_row=new_max_row,
                end_column=new_max_col,
            )


def insert_row(filepath: str, sheet_name: str, start_row: int, count: int = 1) -> dict[str, Any]:
    try:
        _validate_count(start_row, count, is_row=True)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            _row_col_op_preserving_merges(ws, "row", start_row, count, inserting=True)
        return {"message": f"Inserted {count} row(s) starting at row {start_row} in sheet {sheet_name!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to insert rows: %s", e)
        raise SheetError(str(e)) from e


def insert_cols(filepath: str, sheet_name: str, start_col: int, count: int = 1) -> dict[str, Any]:
    try:
        _validate_count(start_col, count, is_row=False)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            _row_col_op_preserving_merges(ws, "col", start_col, count, inserting=True)
        return {"message": f"Inserted {count} column(s) starting at column {start_col} in sheet {sheet_name!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to insert columns: %s", e)
        raise SheetError(str(e)) from e


def delete_rows(filepath: str, sheet_name: str, start_row: int, count: int = 1) -> dict[str, Any]:
    try:
        _validate_count(start_row, count, is_row=True)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            if start_row > ws.max_row:
                raise ValidationError(f"Start row {start_row} exceeds worksheet bounds (max row: {ws.max_row})")
            _row_col_op_preserving_merges(ws, "row", start_row, count, inserting=False)
        return {"message": f"Deleted {count} row(s) starting at row {start_row} in sheet {sheet_name!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to delete rows: %s", e)
        raise SheetError(str(e)) from e


def delete_cols(filepath: str, sheet_name: str, start_col: int, count: int = 1) -> dict[str, Any]:
    try:
        _validate_count(start_col, count, is_row=False)
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            if start_col > ws.max_column:
                raise ValidationError(f"Start column {start_col} exceeds worksheet bounds (max column: {ws.max_column})")
            _row_col_op_preserving_merges(ws, "col", start_col, count, inserting=False)
        return {"message": f"Deleted {count} column(s) starting at column {start_col} in sheet {sheet_name!r}"}
    except (SheetError, ValidationError):
        raise
    except Exception as e:
        logger.error("Failed to delete columns: %s", e)
        raise SheetError(str(e)) from e
