"""公式应用与校验。"""

from __future__ import annotations

import logging
from typing import Any

from ._utils import edit_workbook, get_or_create_workbook, require_sheet, validate_cell_ref
from .exceptions import CalculationError, ValidationError
from .validation import validate_formula

logger = logging.getLogger(__name__)


def apply_formula(filepath: str, sheet_name: str, cell: str, formula: str) -> dict[str, Any]:
    """将公式写入指定单元格。自动补 '=' 前缀并校验语法。"""
    try:
        if not validate_cell_ref(cell):
            raise ValidationError(f"Invalid cell reference: {cell}")
        if not formula.startswith("="):
            formula = f"={formula}"
        is_valid, message = validate_formula(formula)
        if not is_valid:
            raise CalculationError(f"Invalid formula syntax: {message}")

        wb = get_or_create_workbook(filepath)
        try:
            if sheet_name not in wb.sheetnames:
                raise ValidationError(f"Sheet {sheet_name!r} not found")
            wb[sheet_name][cell] = formula
            wb.save(filepath)
        finally:
            try:
                wb.close()
            except Exception:
                pass
        return {"message": f"Applied formula {formula!r} to cell {cell}", "cell": cell, "formula": formula}
    except (ValidationError, CalculationError):
        raise
    except Exception as e:
        logger.error("Failed to apply formula: %s", e)
        raise CalculationError(str(e)) from e
