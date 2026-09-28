/**
 * 内置 mermaid 运行时定位。
 *
 * mermaid.min.js 来自 npm 依赖 mermaid@10（随包安装），渲染只使用本地文件，
 * 不访问任何 CDN。消费方：md→html 内联脚本、md→pdf / docx 的 addScriptTag。
 */
import { createRequire } from 'module';
import { readFileSync, statSync } from 'fs';

// 真实 mermaid.min.js ~3.3MB；下限用于拦截截断/损坏的安装产物
const MERMAID_MIN_SIZE = 50_000;

let cachedPath: string | null | undefined;

/** 返回内置 mermaid.min.js 的绝对路径；不可用时返回 null（调用方降级跳过渲染）。 */
export function mermaidBundlePath(): string | null {
  if (cachedPath === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const p = require.resolve('mermaid/dist/mermaid.min.js');
      const st = statSync(p);
      // 只缓存成功结果；stat 失败/半下载文件不 latch，允许后续重试
      if (st.isFile() && st.size > MERMAID_MIN_SIZE) cachedPath = p;
    } catch {
      // 解析失败同样不缓存
    }
  }
  return cachedPath ?? null;
}

// 3.3MB 字符串只需读取一次；渲染期间 bundle 文件不会变化。
let cachedSource: string | null | undefined;

/** 返回内置 mermaid.min.js 源码（供 HTML 内联）；不可用时返回 null。 */
export function mermaidBundleSource(): string | null {
  if (cachedSource === undefined) {
    const p = mermaidBundlePath();
    if (p) {
      try {
        cachedSource = readFileSync(p, 'utf8');
      } catch {
        // 读取失败按不可用处理，但不缓存，允许重试
        return null;
      }
    }
  }
  return cachedSource ?? null;
}

/** 内联防护：源码中字面 `</script>` 会提前闭合宿主标签，转义为无效序列。 */
export function escapeInlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script');
}
