"""原生 Excel Table 创建。"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from openpyxl.worksheet.table import Table, TableStyleInfo

from ._utils import edit_workbook, require_sheet
from .exceptions import DataError

logger = logging.getLogger(__name__)


def create_excel_table(
    filepath: str,
    sheet_name: str,
    data_range: str,
    table_name: str | None = None,
    table_style: str = "TableStyleMedium9",
) -> dict[str, Any]:
    try:
        if not table_name:
            table_name = f"Table_{uuid.uuid4().hex[:8]}"
        with edit_workbook(filepath) as wb:
            ws = require_sheet(wb, sheet_name)
            existing_tables = getattr(ws, "tables", {}) or {}
            if table_name in existing_tables:
                raise DataError(f"Table name {table_name!r} already exists.")
            tbl = Table(displayName=table_name, ref=data_range)
            tbl.tableStyleInfo = TableStyleInfo(
                name=table_style,
                showFirstColumn=False,
                showLastColumn=False,
                showRowStripes=True,
                showColumnStripes=False,
            )
            ws.add_table(tbl)
        return {
            "message": f"Successfully created table {table_name!r} in sheet {sheet_name!r}.",
            "table_name": table_name,
            "range": data_range,
        }
    except DataError:
        raise
    except Exception as e:
        logger.error("Failed to create table: %s", e)
        raise DataError(str(e)) from e
