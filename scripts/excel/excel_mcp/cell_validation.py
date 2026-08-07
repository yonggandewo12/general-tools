"""读取 Excel 数据验证（Data Validation）元数据。

为单元格/工作表提供验证规则的结构化描述，供 read_data 等工具附带返回。
"""

from __future__ import annotations

import logging
from typing import Any

from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
from openpyxl.worksheet.worksheet import Worksheet

from ._utils import to_json_safe

logger = logging.getLogger(__name__)


def _iter_data_validations(ws: Worksheet):
    """兼容不同 openpyxl 版本地遍历 DataValidation。"""
    dvs = getattr(ws, "data_validations", None)
    if dvs is None:
        return
    seq = getattr(dvs, "dataValidation", None)
    if seq is None:
        return
    for dv in seq:
        yield dv


def get_data_validation_for_cell(ws: Worksheet, cell_address: str) -> dict[str, Any] | None:
    """获取某单元格的验证规则元数据，无则返回 None。"""
    try:
        col_letter, row = coordinate_from_string(cell_address)
        col_idx = column_index_from_string(col_letter)
        for dv in _iter_data_validations(ws):
            if _cell_in_validation_range(row, col_idx, dv):
                return _extract_validation_metadata(dv, cell_address, ws)
        return None
    except Exception as e:
        logger.warning("Failed to get validation for cell %s: %s", cell_address, e)
        return None


def _cell_in_validation_range(row: int, col: int, dv) -> bool:
    try:
        sqref = getattr(dv, "sqref", None)
        if sqref is None:
            return False
        for cr in sqref.ranges:
            if cr.min_row <= row <= cr.max_row and cr.min_col <= col <= cr.max_col:
                return True
        return False
    except Exception as e:
        logger.warning("Error checking cell (%s,%s) in validation range: %s", row, col, e)
        return False


def _extract_validation_metadata(dv, cell_address: str, ws: Worksheet | None = None) -> dict[str, Any]:
    try:
        info: dict[str, Any] = {
            "cell": cell_address,
            "has_validation": True,
            "validation_type": getattr(dv, "type", None),
            "allow_blank": getattr(dv, "allowBlank", None),
        }
        operator = getattr(dv, "operator", None)
        if operator:
            info["operator"] = operator
        prompt = getattr(dv, "prompt", None)
        if prompt:
            info["prompt"] = prompt
        prompt_title = getattr(dv, "promptTitle", None)
        if prompt_title:
            info["prompt_title"] = prompt_title
        error = getattr(dv, "error", None)
        if error:
            info["error_message"] = error
        error_title = getattr(dv, "errorTitle", None)
        if error_title:
            info["error_title"] = error_title

        dv_type = getattr(dv, "type", None)
        formula1 = getattr(dv, "formula1", None)
        formula2 = getattr(dv, "formula2", None)

        if dv_type == "list" and formula1:
            info["allowed_values"] = _extract_list_values(formula1, ws)
        elif formula1:
            info["formula1"] = to_json_safe(formula1)
            if formula2:
                info["formula2"] = to_json_safe(formula2)
        return info
    except Exception as e:
        logger.warning("Failed to extract validation metadata: %s", e)
        return {"cell": cell_address, "has_validation": True, "validation_type": "unknown", "error": str(e)}


def _extract_list_values(formula: str, ws: Worksheet | None = None) -> list[str]:
    """从 list 验证公式中提取允许值列表。"""
    try:
        formula = formula.strip().strip('"')
        # 逗号分隔的显式列表
        if "," in formula and not (":" in formula or formula.startswith("$")):
            values = [v.strip().strip('"') for v in formula.split(",")]
            return [v for v in values if v]
        # 区域引用
        if (":" in formula or formula.startswith("$")) and ws is not None:
            ref = formula[1:] if formula.startswith("=") else formula
            actual: list[str] = []
            try:
                cells = ws[ref]
            except Exception as e:
                logger.warning("Could not resolve range %r: %s", formula, e)
                return [f"Range: {formula} (resolution error)"]
            if hasattr(cells, "value"):
                if cells.value is not None:
                    actual.append(str(cells.value))
            else:
                for row_cells in cells:
                    if hasattr(row_cells, "value"):
                        if row_cells.value is not None:
                            actual.append(str(row_cells.value))
                    else:
                        for c in row_cells:
                            if c.value is not None:
                                actual.append(str(c.value))
            return actual or [f"Range: {formula} (empty or unresolvable)"]
        if ":" in formula or formula.startswith("$"):
            return [f"Range: {formula}"]
        return [formula]
    except Exception as e:
        logger.warning("Failed to parse list formula %r: %s", formula, e)
        return [formula]


def get_all_validation_ranges(ws: Worksheet) -> list[dict[str, Any]]:
    """获取工作表内所有验证规则。"""
    validations: list[dict[str, Any]] = []
    try:
        for dv in _iter_data_validations(ws):
            info: dict[str, Any] = {
                "ranges": str(getattr(dv, "sqref", "")),
                "validation_type": getattr(dv, "type", None),
                "allow_blank": getattr(dv, "allowBlank", None),
            }
            if getattr(dv, "type", None) == "list" and getattr(dv, "formula1", None):
                info["allowed_values"] = _extract_list_values(dv.formula1, ws)
            validations.append(info)
    except Exception as e:
        logger.warning("Failed to get validation ranges: %s", e)
    return validations
