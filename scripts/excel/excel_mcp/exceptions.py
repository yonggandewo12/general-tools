"""Excel MCP exception hierarchy.

所有 Excel 操作异常的基类是 ExcelMCPError，便于上层统一捕获与序列化。
每个异常都自带 to_dict()，方便 run.py 输出结构化 JSON 错误。
"""

from __future__ import annotations

from typing import Any


class ExcelMCPError(Exception):
    """Base exception for all Excel MCP errors."""

    code: str = "EXCEL_ERROR"

    def to_dict(self) -> dict[str, Any]:
        return {"error": str(self), "error_type": self.__class__.__name__, "code": self.code}


class WorkbookError(ExcelMCPError):
    code = "WORKBOOK_ERROR"


class SheetError(ExcelMCPError):
    code = "SHEET_ERROR"


class DataError(ExcelMCPError):
    code = "DATA_ERROR"


class ValidationError(ExcelMCPError):
    code = "VALIDATION_ERROR"


class FormattingError(ExcelMCPError):
    code = "FORMATTING_ERROR"


class CalculationError(ExcelMCPError):
    code = "CALCULATION_ERROR"


class PivotError(ExcelMCPError):
    code = "PIVOT_ERROR"


class ChartError(ExcelMCPError):
    code = "CHART_ERROR"


class NotFoundError(ExcelMCPError):
    """文件或工作表不存在。"""

    code = "NOT_FOUND"
