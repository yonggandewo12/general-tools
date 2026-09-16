import { PythonScriptService } from './python-script-service.js';

/**
 * 图片处理服务：通过子进程调用
 * scripts/ppt-master/scripts/image_mcp/run.py（Pillow 实现）。
 */
export class ImageService extends PythonScriptService {
  constructor() {
    super(
      'scripts/ppt-master/scripts/image_mcp/run.py',
      'scripts/ppt-master/scripts/image_mcp',
      'Image',
      'Pillow',
    );
  }
}
