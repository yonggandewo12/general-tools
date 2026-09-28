#!/usr/bin/env python3
"""DOCX MCP 统一入口脚本。

被 src/docx-service.ts 通过子进程调用（python-docx 编辑已有文档）。
协议与 scripts/excel/run.py 一致：
  python run.py --action <name> --params '<json>'
  python run.py --list          # 列出所有 action
  python run.py --check         # 自检依赖

输出（stdout）固定为单行 JSON：
  成功: {"success": true, "data": <result>}
  失败: {"success": false, "error": "...", "code": "...", "error_type": "..."}

日志走 stderr，不污染 stdout。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import traceback
from pathlib import Path
from typing import Any

# 确保本脚本所在目录在 sys.path 最前，便于 `import docx_mcp`
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

# 保护 stdout 的单行 JSON 协议（与 ppt_mcp/run.py 相同机制）
try:
    _PROTOCOL_FD: int | None = os.dup(sys.stdout.fileno())
except (OSError, ValueError):
    _PROTOCOL_FD = None
if _PROTOCOL_FD is not None:
    try:
        os.dup2(2, 1)
    except OSError:
        os.close(_PROTOCOL_FD)
        _PROTOCOL_FD = None

logger = logging.getLogger("docx_mcp.run")

# editor 模块顶层 import python-docx；必须惰性加载，否则缺依赖时
# --check/--list 直接以 ModuleNotFoundError traceback 失败（协议失效）。
_ACTION_NAMES = (
    "read_document",
    "list_tables",
    "edit_paragraph",
    "add_paragraph",
    "insert_image",
    "insert_table",
    "change_style",
    "set_document_title",
    "available_styles",
)


def _import_editor() -> Any:
    import docx_mcp.editor  # noqa: F401
    return docx_mcp.editor


def _emit(obj: dict[str, Any]) -> None:
    """单行 JSON 输出到协议 fd。"""
    payload = json.dumps(obj, default=str, ensure_ascii=False) + "\n"
    if _PROTOCOL_FD is None:
        sys.stdout.write(payload)
        sys.stdout.flush()
        return
    view = memoryview(payload.encode("utf-8"))
    while view:
        written = os.write(_PROTOCOL_FD, view)
        if written <= 0:  # 不可达；防御性退出，避免死循环
            raise OSError("stdout closed while writing protocol response")
        view = view[written:]


def _ok(result: Any) -> None:
    if isinstance(result, str):
        _emit({"success": True, "data": {"message": result}})
    else:
        _emit({"success": True, "data": result})


def _fail(err: BaseException) -> None:
    # 领域错误自带 code（DocxMCPError 子类），其余归为 INTERNAL_ERROR。
    # editor 为惰性导入，这里用属性探测代替 isinstance。
    code = getattr(err, "code", None)
    if code:
        _emit({"success": False, "error": str(err), "code": code, "error_type": err.__class__.__name__})
    else:
        _emit({"success": False, "error": str(err), "code": "INTERNAL_ERROR", "error_type": err.__class__.__name__})


# ────────────────────────────── 参数解析 ──────────────────────────────

def _load_params(args: argparse.Namespace) -> dict[str, Any]:
    if args.params is not None:
        if args.params.strip() == "":
            return {}
        return json.loads(args.params)
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            return json.loads(raw)
    return {}


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )


def main() -> int:
    _setup_logging()
    parser = argparse.ArgumentParser(description="DOCX MCP entry")
    parser.add_argument("--action", help="action name")
    parser.add_argument("--params", help="JSON params (default: read from stdin)")
    parser.add_argument("--list", action="store_true", help="list all actions")
    parser.add_argument("--check", action="store_true", help="self-check dependencies")
    args = parser.parse_args()

    if args.list:
        _emit({"success": True, "data": {"actions": sorted(_ACTION_NAMES)}})
        return 0

    if args.check:
        try:
            import docx
            _emit({"success": True, "data": {"python-docx": docx.__version__, "python": sys.version.split()[0]}})
            return 0
        except Exception as e:
            _emit({"success": False, "error": f"python-docx not available: {e}", "code": "DEP_MISSING"})
            return 1

    if not args.action:
        _emit({"success": False, "error": "No --action provided", "code": "MISSING_ACTION"})
        return 1

    if args.action not in _ACTION_NAMES:
        _emit({"success": False, "error": f"Unknown action: {args.action}", "code": "UNKNOWN_ACTION", "available": sorted(_ACTION_NAMES)})
        return 1
    try:
        editor = _import_editor()
    except Exception as e:
        _emit({"success": False, "error": f"dependencies not available: {e}", "code": "DEP_MISSING", "error_type": e.__class__.__name__})
        return 1
    fn = editor.ACTIONS[args.action]

    try:
        params = _load_params(args)
    except json.JSONDecodeError as e:
        _emit({"success": False, "error": f"Invalid JSON params: {e}", "code": "BAD_PARAMS"})
        return 1

    try:
        result = fn(**params)
        _ok(result)
        return 0
    except editor.DocxMCPError as e:  # NotFoundError 是其子类
        logger.warning("action %s failed: %s", args.action, e)
        _fail(e)
        return 2
    except Exception as e:
        logger.error("action %s crashed: %s\n%s", args.action, e, traceback.format_exc())
        _fail(e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
