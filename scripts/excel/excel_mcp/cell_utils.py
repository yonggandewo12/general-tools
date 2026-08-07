"""单元格引用解析（向后兼容封装）。

底层实现已迁移到 _utils.py 以便跨模块复用；本模块保留原公共 API，
避免破坏既有导入: from .cell_utils import parse_cell_range, validate_cell_reference
"""

from __future__ import annotations

from ._utils import (
    col_index_to_letter,
    col_letter_to_index,
    parse_cell_range,
    parse_cell_ref,
    range_to_str,
    validate_cell_ref,
)

__all__ = [
    "parse_cell_range",
    "parse_cell_ref",
    "validate_cell_ref",
    "validate_cell_reference",
    "col_letter_to_index",
    "col_index_to_letter",
    "range_to_str",
]


def validate_cell_reference(cell_ref: str) -> bool:
    """原 API 别名。"""
    return validate_cell_ref(cell_ref)
