import { PythonScriptService } from './python-script-service.js';

/**
 * Excel 操作服务：通过子进程调用 scripts/excel/run.py，复用项目既有 Python 集成模式。
 * 与 PptService / PdfService / ImageService 一致，继承 PythonScriptService 基类，
 * 复用依赖自检缓存、stdin JSON 协议调用与输出解析（error_type → errorType 归一化）。
 */
export class ExcelService extends PythonScriptService {
  constructor() {
    super(
      'scripts/excel/run.py',
      'scripts/excel',
      'Excel',
      'openpyxl (pip install -r scripts/excel/requirements.txt)',
    );
  }
}
