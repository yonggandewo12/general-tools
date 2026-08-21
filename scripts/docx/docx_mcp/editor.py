"""DOCX 编辑模块：打开已有 .docx，执行修改动作后保存。

基于 python-docx（MIT），被 run.py 通过 --action 分发调用。
每个动作函数接收 kwargs 参数字典，返回 dict/list/str 类型结果。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from docx import Document
from docx.document import Document as DocumentObj
from docx.shared import Inches, Pt, RGBColor


class DocxMCPError(Exception):
    """DOCX 操作业务错误。"""

    def __init__(self, message: str, code: str = "DOCX_ERROR") -> None:
        super().__init__(message)
        self.code = code


class NotFoundError(DocxMCPError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="NOT_FOUND")


def _open(path: str) -> DocumentObj:
    """打开已有 docx，文件不存在则抛 NotFoundError。"""
    p = Path(path)
    if not p.exists():
        raise NotFoundError(f"File not found: {path}")
    if not p.suffix.lower() == ".docx":
        raise DocxMCPError(f"Not a .docx file: {path}", code="BAD_EXT")
    return Document(str(p))


def _save(doc: DocumentObj, path: str) -> None:
    """保存文档，确保父目录存在。"""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(p))


def _style_name(name: str | None) -> str | None:
    """返回段落样式名（如 'Heading 1'、'Normal'）；None 表示未设置。"""
    if not name:
        return None
    return name


def _align_name(para) -> str | None:
    """段落对齐方式的字符串名；None 表示未设置。"""
    try:
        return str(para.alignment) if para.alignment is not None else None
    except Exception:
        return None


def _get_style(doc: DocumentObj, style: str):
    """按名取样式，不存在时抛 NotFoundError（统一友好报错）。"""
    try:
        return doc.styles[style]
    except KeyError:
        raise NotFoundError(f"Style not found: {style}. Available: {[s.name for s in doc.styles]}")


# ────────────────────────── 查询动作 ──────────────────────────

def read_document(path: str) -> dict[str, Any]:
    """读取 docx 的段落文本与结构概览。"""
    doc = _open(path)
    paragraphs = []
    for i, para in enumerate(doc.paragraphs):
        try:
            style = _style_name(para.style.name) if para.style is not None else None
        except Exception:
            style = None
        paragraphs.append({
            "index": i,
            "text": para.text,
            "style": style,
            "alignment": _align_name(para),
        })
    return {
        "path": path,
        "paragraph_count": len(doc.paragraphs),
        "table_count": len(doc.tables),
        "inline_shapes": len(doc.inline_shapes),
        "sections": len(doc.sections),
        "paragraphs": paragraphs,
    }


def list_tables(path: str) -> dict[str, Any]:
    """列出文档中所有表格的尺寸与首行内容。"""
    doc = _open(path)
    tables = []
    for i, table in enumerate(doc.tables):
        rows = []
        for row in table.rows[:5]:
            rows.append([cell.text for cell in row.cells])
        tables.append({
            "index": i,
            "rows": len(table.rows),
            "cols": len(table.columns),
            "preview": rows,
        })
    return {"path": path, "table_count": len(tables), "tables": tables}


# ────────────────────────── 编辑动作 ──────────────────────────

def edit_paragraph(path: str, index: int, text: str, style: str | None = None) -> dict[str, Any]:
    """修改指定段落文字（可选改样式）。"""
    doc = _open(path)
    if index < 0 or index >= len(doc.paragraphs):
        raise NotFoundError(f"Paragraph index {index} out of range (0-{len(doc.paragraphs)-1})")
    para = doc.paragraphs[index]
    # 保留首个 run 的字体格式，其余 run 清除后重建
    if para.runs:
        para.runs[0].text = text
        for run in para.runs[1:]:
            run.text = ""
    else:
        para.add_run(text)
    if style:
        para.style = _get_style(doc, style)
    _save(doc, path)
    return {"path": path, "updated_paragraph": index, "text": text, "style": style}


def add_paragraph(path: str, text: str, style: str | None = None,
                  bold: bool = False, italic: bool = False,
                  font_size: int | None = None, alignment: str | None = None) -> dict[str, Any]:
    """在文档末尾追加段落。"""
    doc = _open(path)
    para = doc.add_paragraph()
    run = para.add_run(text)
    run.bold = bold
    run.italic = italic
    if font_size:
        run.font.size = Pt(font_size)
    if style:
        para.style = _get_style(doc, style)
    if alignment:
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        align_map = {
            "left": WD_ALIGN_PARAGRAPH.LEFT,
            "center": WD_ALIGN_PARAGRAPH.CENTER,
            "right": WD_ALIGN_PARAGRAPH.RIGHT,
            "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
        }
        para.alignment = align_map.get(alignment.lower())
    _save(doc, path)
    return {"path": path, "added_paragraph_index": len(doc.paragraphs) - 1, "text": text}


def insert_image(path: str, image_path: str, index: int | None = None,
                 width_inches: float | None = None, height_inches: float | None = None) -> dict[str, Any]:
    """在指定段落后插入图片；index 省略则追加到文档末尾。

    宽度/高度以英寸为单位。两者均省略时使用图片原始尺寸。
    """
    doc = _open(path)
    img = Path(image_path)
    if not img.exists():
        raise NotFoundError(f"Image not found: {image_path}")

    width = Inches(width_inches) if width_inches else None
    height = Inches(height_inches) if height_inches else None

    if index is not None:
        if index < 0 or index >= len(doc.paragraphs):
            raise NotFoundError(f"Paragraph index {index} out of range (0-{len(doc.paragraphs)-1})")
        # 在指定段落之后插入一个新段落，图片放入新段落（不动原段落内容）
        if index + 1 < len(doc.paragraphs):
            para = doc.paragraphs[index + 1].insert_paragraph_before()
        else:
            para = doc.add_paragraph()
        run = para.add_run()
        run.add_picture(str(img), width=width, height=height)
        inserted_at = index + 1
    else:
        doc.add_picture(str(img), width=width, height=height)
        inserted_at = len(doc.paragraphs) - 1

    _save(doc, path)
    return {"path": path, "image": image_path, "inserted_at_paragraph": inserted_at}


def insert_table(path: str, data: list[list[Any]] | None = None,
                 rows: int | None = None, cols: int | None = None,
                 header_row: bool = True) -> dict[str, Any]:
    """在文档末尾插入表格。data 为二维数组（提供时忽略 rows/cols）；
    否则用 rows/cols 生成空网格（缺省 2×2），header_row 控制首行表头。"""
    doc = _open(path)
    if data:
        n_rows = len(data)
        n_cols = max(len(r) for r in data) if data else (cols or 1)
        table = doc.add_table(rows=n_rows, cols=n_cols)
        for i, row in enumerate(data):
            for j, val in enumerate(row):
                table.cell(i, j).text = str(val)
    else:
        n_rows = rows or 2
        n_cols = cols or 2
        table = doc.add_table(rows=n_rows, cols=n_cols)
        if header_row and n_rows > 0:
            for j in range(n_cols):
                table.cell(0, j).text = f"Column {j+1}"

    # 表格套用内置网格样式（python-docx 默认样式名取决于文档是否含该样式；
    # 读取操作不保证 `Table Grid` 存在，不存在时跳过样式设置）。
    try:
        table.style = doc.styles["Table Grid"]
    except KeyError:
        pass

    _save(doc, path)
    return {
        "path": path,
        "table_index": len(doc.tables) - 1,
        "rows": len(table.rows),
        "cols": len(table.columns),
    }


def change_style(path: str, index: int, style: str) -> dict[str, Any]:
    """修改段落样式（如 Heading 1、Title、Normal）。"""
    doc = _open(path)
    if index < 0 or index >= len(doc.paragraphs):
        raise NotFoundError(f"Paragraph index {index} out of range")
    doc.paragraphs[index].style = _get_style(doc, style)
    _save(doc, path)
    return {"path": path, "updated_paragraph": index, "style": style}


def set_document_title(path: str, title: str) -> dict[str, Any]:
    """设置文档核心属性标题。"""
    doc = _open(path)
    doc.core_properties.title = title
    _save(doc, path)
    return {"path": path, "title": title}


def available_styles(path: str) -> dict[str, Any]:
    """列出文档可用样式名。"""
    doc = _open(path)
    styles = [s.name for s in doc.styles]
    return {"path": path, "styles": styles}


# ────────────────────────── action 注册表 ──────────────────────────

ACTIONS: dict[str, Any] = {
    "read_document": read_document,
    "list_tables": list_tables,
    "edit_paragraph": edit_paragraph,
    "add_paragraph": add_paragraph,
    "insert_image": insert_image,
    "insert_table": insert_table,
    "change_style": change_style,
    "set_document_title": set_document_title,
    "available_styles": available_styles,
}
