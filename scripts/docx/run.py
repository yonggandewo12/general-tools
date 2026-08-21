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
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

# 确保本脚本所在目录在 sys.path 最前，便于 `import docx_mcp`
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from docx_mcp.editor import ACTIONS, DocxMCPError, NotFoundError  # noqa: E402

logger = logging.getLogger("docx_mcp.run")


# ────────────────────────────── 输出 ──────────────────────────────

def _emit(obj: dict[str, Any]) -> None:
    """单行 JSON 输出到 stdout。"""
    sys.stdout.write(json.dumps(obj, default=str, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _ok(result: Any) -> None:
    if isinstance(result, str):
        _emit({"success": True, "data": {"message": result}})
    else:
        _emit({"success": True, "data": result})


def _fail(err: BaseException) -> None:
    if isinstance(err, DocxMCPError):
        _emit({"success": False, "error": str(err), "code": getattr(err, "code", "DOCX_ERROR"), "error_type": err.__class__.__name__})
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
        _emit({"success": True, "data": {"actions": sorted(ACTIONS.keys())}})
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

    fn = ACTIONS.get(args.action)
    if fn is None:
        _emit({"success": False, "error": f"Unknown action: {args.action}", "code": "UNKNOWN_ACTION", "available": sorted(ACTIONS.keys())})
        return 1

    try:
        params = _load_params(args)
    except json.JSONDecodeError as e:
        _emit({"success": False, "error": f"Invalid JSON params: {e}", "code": "BAD_PARAMS"})
        return 1

    try:
        result = fn(**params)
        _ok(result)
        return 0
    except (DocxMCPError, NotFoundError) as e:
        logger.warning("action %s failed: %s", args.action, e)
        _fail(e)
        return 2
    except Exception as e:
        logger.error("action %s crashed: %s\n%s", args.action, e, traceback.format_exc())
        _fail(e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
