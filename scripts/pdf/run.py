#!/usr/bin/env python3
"""PDF MCP 统一入口脚本。

被 src/pdf-service.ts 通过子进程调用（encrypt/decrypt 走 PyMuPDF/fitz）。
协议与 scripts/excel/run.py 一致：
  python run.py --action <name> --params '<json>'
  python run.py --list          # 列出所有 action
  python run.py --check         # 自检依赖
  python run.py --action <name> # params 从 stdin 读 JSON

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
from typing import Any, Callable

# 确保本脚本所在目录在 sys.path 最前，便于 `import pdf_ops`
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

# 保护 stdout 的单行 JSON 协议：真实 stdout 复制到 _PROTOCOL_FD 专供协议输出，
# fd 1 重定向到 stderr，库层杂散 print/写入全部落到 stderr，避免 BAD_OUTPUT
#（与 ppt_mcp/run.py 相同机制）。
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

logger = logging.getLogger("pdf_mcp.run")

# 重量级依赖（pdf_ops → PyMuPDF）必须惰性导入：顶层 import 在缺依赖时直接
# 抛 ModuleNotFoundError traceback，使 --check 永远无法输出 DEP_MISSING JSON，
# Node 侧 checkDeps 会把原始 traceback 当错误文本上抛。
_ACTION_NAMES = ("encrypt", "decrypt")


def _get_action(name: str) -> Callable[..., Any] | None:
    if name not in _ACTION_NAMES:
        return None
    from pdf_ops import decrypt_pdf, encrypt_pdf  # noqa: F401
    return {"encrypt": encrypt_pdf, "decrypt": decrypt_pdf}[name]


def _emit(obj: dict[str, Any]) -> None:
    payload = json.dumps(obj, ensure_ascii=False) + "\n"
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
    _emit({"success": False, "error": str(err), "code": "PDF_ERROR", "error_type": err.__class__.__name__})


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


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    parser = argparse.ArgumentParser(description="PDF MCP entry")
    parser.add_argument("--action", help="action name")
    parser.add_argument("--params", help="JSON params (default: read from stdin)")
    parser.add_argument("--list", action="store_true", help="list all actions")
    parser.add_argument("--check", action="store_true", help="self-check dependencies")
    args = parser.parse_args()

    if args.list:
        _emit({"success": True, "data": {"actions": sorted(_ACTION_NAMES)}})
        return 0

    if args.check:
        # 用 pymupdf 新命名空间而非 fitz 别名，避免向 stdout 打印弃用警告污染单行 JSON
        try:
            import pymupdf
            _emit({"success": True, "data": {"PyMuPDF": pymupdf.__version__, "python": sys.version.split()[0]}})
            return 0
        except Exception as e:
            _emit({"success": False, "error": f"PyMuPDF not available: {e}", "code": "DEP_MISSING"})
            return 1

    if not args.action:
        _emit({"success": False, "error": "No --action provided", "code": "MISSING_ACTION"})
        return 1

    try:
        fn = _get_action(args.action)
    except Exception as e:
        _emit({"success": False, "error": f"dependencies not available: {e}", "code": "DEP_MISSING", "error_type": e.__class__.__name__})
        return 1
    if fn is None:
        _emit({"success": False, "error": f"Unknown action: {args.action}", "code": "UNKNOWN_ACTION", "available": sorted(_ACTION_NAMES)})
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
    except Exception as e:
        logger.error("action %s crashed: %s\n%s", args.action, e, traceback.format_exc())
        _fail(e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
