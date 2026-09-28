/**
 * HTML → DOCX 转换器（doc-ops-mcp MIT 许可移植）。
 *
 * 用 cheerio 解析 HTML，将 h1-h6 / p / strong / em / u / blockquote / pre /
 * code / ul / ol / table / img 映射为 docx 包的 Paragraph / TextRun / Table /
 * ImageRun，保留内联样式（字号/颜色/加粗/斜体/下划线/对齐）。含 XSS 清洗。
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, UnderlineType, Table, TableRow, TableCell, WidthType, ImageRun, VerticalAlignTable } from 'docx';
import { imageSize } from 'image-size';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

interface StyleMapping {
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  size?: number;
  bold?: boolean;
  italics?: boolean;
  underline?: any;
  color?: string;
  strike?: boolean;
  /** 等宽/专用字体名；由标签（code → Consolas）写入，随嵌套内联继承 */
  fontName?: string;
  highlight?: 'none' | 'black' | 'blue' | 'cyan' | 'darkBlue' | 'darkCyan' | 'darkGray' | 'darkGreen' | 'darkMagenta' | 'darkRed' | 'darkYellow' | 'green' | 'lightGray' | 'magenta' | 'red' | 'white' | 'yellow';
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
}

interface ParsedElement {
  tag: string;
  text: string;
  html: string;
  styles: any;
  src?: string;
}

const FONT_FALLBACK =
  'Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, Microsoft YaHei, SimHei, Arial, sans-serif';

/** A4 纵向、左右页边距 1 英寸时的可用正文宽度（twip）；表格按此宽度定网格与列宽。 */
const TABLE_FULL_WIDTH_DXA = 9360;

/**
 * colspan 上限。HTML 规范下 colspan="999" 会真的撑出 999 列网格，并给其余每行
 * 补齐近千个空格子（文档体积与 Word 渲染都会受影响），故对畸形/超大值统一夹取。
 */
const MAX_TABLE_COLUMNS = 100;

export class HtmlToDocxConverter {
  private styleMap: Map<string, StyleMapping> = new Map();

  constructor() {
    this.initializeStyles();
  }

  /** 清理 HTML 内容，移除危险标签与内联事件/协议。 */
  private sanitizeHtml(html: string): string {
    if (!html || typeof html !== 'string') return '';
    // 先屏蔽 data:image URI：on\w+= 正则会把以 "on<单词>=" 结尾的 base64 当事件属性
    // 误伤（base64 字符集含 "on" 前缀字母），清洗完成后还原，避免破坏内嵌图片。
    // nonce 防止用户正文里的字面量 "__IMG_0__" 在还原时被替换成图片 URI。
    const nonce = Math.random().toString(36).slice(2, 8);
    const placeholders: string[] = [];
    const shielded = html.replace(/data:image\/[a-z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/gi, (uri) => {
      placeholders.push(uri);
      return `__IMG_${nonce}_${placeholders.length - 1}__`;
    });
    const cleaned = shielded
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
      .replace(/<embed[^>]*>/gi, '')
      .replace(/<link[^>]*>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']{0,500}?["']/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      // 仅清除非图片的 data: URI（如 data:text/html 的 XSS 载体），
      // 保留 <img src="data:image/..."> 的内嵌图片。
      .replace(/data:(?!image\/)/gi, '')
      .replace(/<meta[^>]*>/gi, '');
    return cleaned.replace(new RegExp(`__IMG_${nonce}_(\\d+)__`, 'g'), (_m, i) => placeholders[Number(i)] ?? '');
  }

  private initializeStyles(): void {
    this.styleMap.set('h1', { heading: HeadingLevel.HEADING_1, size: 32, bold: true, color: '2F5496' });
    this.styleMap.set('h2', { heading: HeadingLevel.HEADING_2, size: 28, bold: true, color: '2F5496' });
    this.styleMap.set('h3', { heading: HeadingLevel.HEADING_3, size: 24, bold: true, color: '1F3763' });
    this.styleMap.set('h4', { heading: HeadingLevel.HEADING_4, size: 22, bold: true, color: '1F3763' });
    this.styleMap.set('h5', { heading: HeadingLevel.HEADING_5, size: 20, bold: true, color: '1F3763' });
    this.styleMap.set('h6', { heading: HeadingLevel.HEADING_6, size: 18, bold: true, color: '1F3763' });
    this.styleMap.set('p', { size: 22, color: '000000' });
    this.styleMap.set('strong', { bold: true });
    this.styleMap.set('b', { bold: true });
    this.styleMap.set('em', { italics: true });
    this.styleMap.set('i', { italics: true });
    this.styleMap.set('u', { underline: { type: UnderlineType.SINGLE } });
    this.styleMap.set('blockquote', { size: 22, italics: true, color: '666666' });
    this.styleMap.set('pre', { size: 18, color: '000000' });
    this.styleMap.set('code', { size: 18, color: 'd73a49' });
  }

  /** 将 HTML 内容转为 DOCX Buffer。 */
  async convertHtmlToDocx(htmlContent: string): Promise<Buffer> {
    const $ = cheerio.load(htmlContent);
    const docElements: any[] = [];
    const elements = this.parseHtmlElements($);

    for (const element of elements) {
      const docxElement = await this.createDocxElement(element, $);
      if (docxElement) {
        if (Array.isArray(docxElement)) {
          docElements.push(...docxElement);
        } else {
          docElements.push(docxElement);
        }
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: docElements }],
    });
    return await Packer.toBuffer(doc);
  }

  /** 无语义容器标签：递归下钻取其子节点（MdConverter 等工具会包一层 div.layout）。 */
  private static readonly CONTAINER_TAGS = new Set([
    'div', 'main', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'center',
  ]);

  /** 渲染层/元数据标签：不产出 docx 内容（脚本、样式、表单等）。 */
  private static readonly SKIP_TAGS = new Set([
    'script', 'style', 'link', 'meta', 'title', 'head', 'iframe', 'noscript', 'template',
  ]);

  private parseHtmlElements($: any): ParsedElement[] {
    const elements: ParsedElement[] = [];
    const collect = (elem: any): void => {
      const tagName = elem.tagName.toLowerCase();
      if (HtmlToDocxConverter.SKIP_TAGS.has(tagName)) {
        return;
      }
      if (HtmlToDocxConverter.CONTAINER_TAGS.has(tagName)) {
        // 容器无元素子节点但有文本时按普通元素处理（保留容器内联样式），避免内容
        // （如 mermaid 渲染失败后降级保留的 <div class="mermaid"> 源码）被静默丢弃。
        if ($(elem).children('*').length === 0 && $(elem).text().trim()) {
          this.pushElement(elements, $, elem, tagName);
          return;
        }
        // 混合内容容器按文档顺序展开：顶层直接文本节点产出段落（继承容器内联
        // 样式），元素子节点递归。若只按 children() 下钻，这些直接文本会丢失。
        const containerStyles = this.extractStyles($(elem));
        $(elem).contents().each((_i: number, node: any) => {
          if (node.type === 'text') {
            const text = $(node).text();
            if (text.trim()) {
              elements.push({ tag: 'p', text, html: '', styles: containerStyles });
            }
            return;
          }
          if (node.type === 'tag') collect(node);
        });
        return;
      }
      this.pushElement(elements, $, elem, tagName);
    };
    $('body')
      .children()
      .each((_i: number, elem: any) => collect(elem));
    return elements;
  }

  private pushElement(elements: ParsedElement[], $: any, elem: any, tagName: string): void {
    const $elem = $(elem);
    elements.push({
      tag: tagName,
      text: $elem.text(),
      html: $elem.html(),
      styles: this.extractStyles($elem),
      src: tagName === 'img' ? ($elem.attr('src') ?? undefined) : undefined,
    });
  }

  private extractStyles($elem: any): any {
    const styles: any = {};
    const inlineStyle = $elem.attr('style');
    if (inlineStyle) {
      for (const rule of inlineStyle.split(';')) {
        const [property, value] = rule.split(':').map((s: string) => s.trim());
        if (property && value) {
          styles[property] = value;
        }
      }
    }
    const className = $elem.attr('class');
    if (className) {
      styles.className = className;
    }
    return styles;
  }

  private async createDocxElement(element: ParsedElement, $: any): Promise<any> {
    const baseStyle = this.styleMap.get(element.tag) ?? {};
    const customStyle = this.convertCssToDocx(element.styles);
    const finalStyle = { ...baseStyle, ...customStyle };

    switch (element.tag) {
      case 'img':
        return await this.createImageParagraph(element);
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return new Paragraph({
          heading: finalStyle.heading,
          alignment: finalStyle.alignment ?? AlignmentType.LEFT,
          spacing: { before: 360, after: 360, line: 300, lineRule: 'auto' },
          children: [
            new TextRun({
              text: element.text,
              bold: finalStyle.bold !== false,
              size: finalStyle.size,
              color: finalStyle.color ?? '2c3e50',
              italics: finalStyle.italics,
              font: { name: FONT_FALLBACK },
            }),
          ],
        });
      case 'p':
        return new Paragraph({
          alignment: finalStyle.alignment ?? AlignmentType.LEFT,
          spacing: { line: 300, lineRule: 'auto', after: 240, before: 120 },
          children: await this.createTextRuns(element, finalStyle, $),
        });
      case 'pre':
        return this.createCodeBlock(element, $);
      case 'blockquote':
        return new Paragraph({
          alignment: finalStyle.alignment ?? AlignmentType.LEFT,
          spacing: { line: 300, lineRule: 'auto', before: 360, after: 360 },
          indent: { left: 720, right: 360 },
          border: { left: { style: 'single', size: 12, color: '3498db' } },
          children: [
            new TextRun({
              text: element.text,
              italics: true,
              size: finalStyle.size ?? 22,
              color: finalStyle.color ?? '5a6c7d',
              font: { name: FONT_FALLBACK },
            }),
          ],
        });
      case 'ul':
      case 'ol':
        return this.createListElements(element, finalStyle, $);
      case 'table':
        return await this.createTableElements(element, finalStyle, $);
      default:
        if (element.text.trim()) {
          const runOptions: any = {
            text: element.text,
            bold: finalStyle.bold,
            italics: finalStyle.italics,
            size: finalStyle.size,
            color: finalStyle.color,
            font: { name: FONT_FALLBACK },
          };
          if (finalStyle.underline) {
            runOptions.underline = finalStyle.underline;
          }
          return new Paragraph({
            spacing: { line: 300, lineRule: 'auto', after: 240, before: 120 },
            children: [new TextRun(runOptions)],
          });
        }
        return null;
    }
  }

  /** 创建图片段落。支持 data:image URI 和文件路径。失败时返回 null（不崩溃）。 */
  private async createImageParagraph(element: ParsedElement): Promise<any> {
    try {
      const run = await this.createImageRun(element.src);
      if (!run) return null;
      return new Paragraph({
        spacing: { before: 200, after: 200 },
        children: [run],
      });
    } catch {
      return null;
    }
  }

  /** 从 src 创建 docx ImageRun；支持 data:image URI 和文件路径，失败返回 null。 */
  private async createImageRun(src: string | undefined): Promise<ImageRun | null> {
    try {
      if (!src) return null;

      // 解析图片二进制数据
      let imgData: Buffer;
      if (src.startsWith('data:image/')) {
        // data URI → base64 → Buffer
        const headerEnd = src.indexOf(',');
        if (headerEnd === -1) return null;
        imgData = Buffer.from(src.slice(headerEnd + 1), 'base64');
      } else {
        // 文件路径
        const resolved = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
        imgData = await fs.readFile(resolved);
      }

      // 由内容签名探测尺寸与类型（不信任 mime/扩展名，防止伪造后缀的文件
      // 以错误格式嵌入 docx 导致图片损坏）。
      const dims = imageSize(imgData);
      if (!dims || !dims.width || !dims.height) return null;
      const type = dims.type === 'jpeg' ? 'jpg' : dims.type;
      // docx ImageRun 仅支持 png/jpg/gif/bmp；svg/webp 等静默跳过（不崩溃）
      if (type !== 'png' && type !== 'jpg' && type !== 'gif' && type !== 'bmp') return null;

      // 限制最大宽度为 600px（DOCX 页面可读范围），按比例缩放
      const maxW = 600;
      let w = dims.width;
      let h = dims.height;
      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }

      return new ImageRun({
        type,
        data: imgData,
        transformation: { width: w, height: h },
      });
    } catch {
      return null;
    }
  }

  private async createTextRuns(element: ParsedElement, baseStyle: StyleMapping, $: any): Promise<any[]> {
    const runs: any[] = [];
    const { html } = element;
    // 纯文本（无标签）也要走统一换行规则：否则 markdown 软换行会以裸 \n
    // 塞进 <w:t>，Word 可能直接吃掉换行把两行粘成一行
    if (!html) {
      return this.plainTextRuns(element.text, baseStyle);
    }
    const sanitizedHtml = this.sanitizeHtml(html);
    if (!sanitizedHtml.includes('<')) {
      return this.plainTextRuns(element.text, baseStyle);
    }
    const $content = $('<div>' + sanitizedHtml + '</div>');
    if ($content.length === 0) {
      return this.plainTextRuns(element.text, baseStyle);
    }
    for (const node of $content.contents().toArray()) {
      await this.processHtmlNode(node, baseStyle, runs, $);
    }
    return runs.length > 0 ? runs : this.plainTextRuns(element.text, baseStyle);
  }

  /** 无标签文本 → runs（按统一换行规则处理，无兄弟节点）。 */
  private plainTextRuns(text: string, style: StyleMapping): TextRun[] {
    const out: TextRun[] = [];
    this.appendTextWithBreaks(text, style, out, false, false);
    return out.length > 0 ? out : [this.createTextRun('', style)];
  }

  /** 内联文本 → TextRun。
   *
   * 必须返回 TextRun 实例：Paragraph 的 children 若是普通对象，XML 序列化会按
   * 对象的 `text` 字段产出非法 <text> 元素（WordprocessingML 无此标签），Word 会
   * 静默丢弃该段文字，导致段落里的加粗/斜体/行内代码内容整体消失。
   */
  private createTextRun(text: string, style: StyleMapping): TextRun {
    return new TextRun({
      text,
      bold: style.bold,
      italics: style.italics,
      size: style.size,
      color: style.color,
      strike: style.strike,
      highlight: style.highlight,
      underline: style.underline,
      font: { name: style.fontName ?? FONT_FALLBACK },
    });
  }

  private async processHtmlNode(node: any, baseStyle: StyleMapping, runs: any[], $: any): Promise<void> {
    if (node.type === 'text') {
      this.processTextNode(node, baseStyle, runs);
    } else if (node.type === 'tag') {
      await this.processTagNode(node, baseStyle, runs, $);
    }
  }

  private processTextNode(node: any, baseStyle: StyleMapping, runs: any[]): void {
    this.appendTextWithBreaks(node.data ?? '', baseStyle, runs, Boolean(node.prev), Boolean(node.next));
  }

  /**
   * 文本 → runs 的统一换行规则：
   * - 换行仅当两侧紧邻非空白字符时视为 markdown 软换行 → Word 换行
   * - 其余含换行的空白串按 HTML 语义只是词间分隔 → 折叠为单个空格（连续空白只留一个）
   * - 节点首/尾空白仅在确有相邻兄弟内容时补空格，避免 "加粗" 与 "下一行" 粘连
   * 否则 pretty-printed HTML（标签各占一行）会被渲染成一堆空行。
   */
  private appendTextWithBreaks(
    text: string,
    style: StyleMapping,
    runs: any[],
    hasPrev: boolean,
    hasNext: boolean,
  ): void {
    if (!text) return;
    if (!text.includes('\n')) {
      if (text.trim() || text.includes(' ')) runs.push(this.createTextRun(text, style));
      return;
    }
    if (text.trim() === '') {
      if (hasPrev) runs.push(this.createTextRun(' ', style));
      return;
    }
    const parts = text.split('\n');
    let lastWasSpace = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.trim() === '') {
        const needsSpace =
          (i > 0 && i < parts.length - 1) || (i === 0 && hasPrev) || (i === parts.length - 1 && hasNext);
        if (needsSpace && !lastWasSpace) {
          runs.push(this.createTextRun(' ', style));
          lastWasSpace = true;
        }
        continue;
      }
      lastWasSpace = false;
      runs.push(this.createTextRun(part, style));
      const next = parts[i + 1];
      if (next !== undefined && next.trim() !== '') {
        runs.push(new TextRun({ text: '', break: 1 }));
      }
    }
  }

  private async processTagNode(node: any, baseStyle: StyleMapping, runs: any[], $: any): Promise<void> {
    // 行内图片：markdown ![](x) 渲染为 <p><img></p>，需产出 ImageRun
    if (node.name === 'img') {
      const src = $(node).attr('src');
      const run = await this.createImageRun(src);
      if (run) runs.push(run);
      return;
    }
    // <br> 没有文本，按文本处理会被整段丢弃，只留下换行本身
    if (node.name === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
      return;
    }
    const tagStyle = this.applyTagStyles(node, baseStyle, $);
    // 直接读 domhandler 的 children，避免为每个内联标签新建 cheerio 包装
    const children: any[] = node.children ?? [];
    // 含元素子节点时逐子展开：整段取 .text() 会把内层样式（strong 里的 em）压平成
    // 一个 run，只保留外层样式。
    if (children.some((child) => child.type === 'tag')) {
      for (const child of children) {
        await this.processHtmlNode(child, tagStyle, runs, $);
      }
      return;
    }
    // cheerio 的 .text() 已完成 HTML 实体解码，无需再手动 decode
    const text = $(node).text();
    if (text.trim()) {
      runs.push(this.createTextRun(text, tagStyle));
    }
  }

  private applyTagStyles(node: any, baseStyle: StyleMapping, $: any): StyleMapping {
    const tagStyle = { ...baseStyle };
    const $node = $(node);
    this.applyBasicTagStyles(node.name, tagStyle);
    const nodeStyles = this.extractStyles($node);
    const nodeDocxStyle = this.convertCssToDocx(nodeStyles);
    Object.assign(tagStyle, nodeDocxStyle);
    return tagStyle;
  }

  private applyBasicTagStyles(tagName: string, tagStyle: StyleMapping): void {
    switch (tagName) {
      case 'strong':
      case 'b':
        tagStyle.bold = true;
        break;
      case 'em':
      case 'i':
        tagStyle.italics = true;
        break;
      case 'u':
        tagStyle.underline = { type: UnderlineType.SINGLE };
        break;
      case 'del':
      case 's':
      case 'strike':
        tagStyle.strike = true;
        break;
      case 'code':
        tagStyle.size = 18;
        tagStyle.color = 'd73a49';
        tagStyle.fontName = 'Consolas';
        break;
    }
  }

  private async createListElements(element: ParsedElement, baseStyle: StyleMapping, $: any): Promise<any[]> {
    const paragraphs: any[] = [];
    const sanitizedHtml = this.sanitizeHtml(element.html);
    // 用原列表标签包裹（li 在 div 上下文会被 HTML5 解析器丢弃，同 createTableElements）
    const $list = $(`<${element.tag}>${sanitizedHtml}</${element.tag}>`);

    /** 取容器内"最外层"的嵌套列表：遇到列表就收集并停止下钻，避免同一子列表被重复处理。 */
    const collectTopLists = (node: any, acc: any[] = []): any[] => {
      for (const child of $(node).children().toArray()) {
        if (child.type !== 'tag') continue;
        if (child.name === 'ul' || child.name === 'ol') acc.push(child);
        else collectTopLists(child, acc);
      }
      return acc;
    };

    const emitItem = async (li: any, bullet: string, level: number): Promise<void> => {
      const $li = $(li);
      // 任意深度的嵌套列表都从内联内容剥离（否则既内联进父段落、又重复输出自己的段落），
      // 由调用方递归单独成段
      const $inline = $li.clone();
      $inline.find('ul,ol').remove();
      // remove() 不清理兄弟指针，li 末尾原有的换行/缩进空白节点会因此多产出
      // 一个尾随空格 run，这里直接去掉末尾空白子节点
      const inlineChildren: any[] = $inline.toArray()[0]?.children ?? [];
      while (
        inlineChildren.length > 0 &&
        inlineChildren[inlineChildren.length - 1].type === 'text' &&
        !(inlineChildren[inlineChildren.length - 1].data ?? '').trim()
      ) {
        inlineChildren.pop();
      }
      // 复用段落内联链路，保留列表项里的加粗/斜体/行内码样式
      const inlineRuns = await this.createTextRuns(
        { tag: 'li', text: $inline.text(), html: $inline.html(), styles: {} },
        baseStyle,
        $,
      );
      paragraphs.push(
        new Paragraph({
          children: [this.createTextRun(bullet, baseStyle), ...inlineRuns],
          indent: { left: 720 + level * 360 },
        })
      );
    };

    const walkContainer = async (container: any, level: number, isOl: boolean, state: { index: number; step: number }): Promise<void> => {
      for (const child of $(container).contents().toArray()) {
        if (child.type === 'text') {
          // 列表容器里的游离文本（<ul>说明：<li>…</li></ul>）单独成段，不静默丢弃
          const text = (child.data ?? '').replace(/\s+/g, ' ').trim();
          if (text) {
            paragraphs.push(
              new Paragraph({
                children: [this.createTextRun(text, baseStyle)],
                indent: { left: 720 + level * 360 },
              })
            );
          }
        } else if (child.type === 'tag') {
          if (child.name === 'li') {
            state.index += state.step;
            await emitItem(child, isOl ? `${state.index}. ` : '• ', level);
            for (const nested of collectTopLists(child)) {
              await processList(nested, level + 1);
            }
          } else if (child.name === 'ul' || child.name === 'ol') {
            await processList(child, level + 1);
          } else {
            // 畸形嵌套：li 被 div/section 等包了一层，按本层继续下钻，不丢内容
            await walkContainer(child, level, isOl, state);
          }
        }
      }
    };

    /** 统计本层（不含嵌套列表）的 li 数，供 reversed 起点计算。 */
    const countTopLevelItems = (container: any): number => {
      let n = 0;
      for (const child of $(container).contents().toArray()) {
        if (child.type !== 'tag') continue;
        if (child.name === 'li') n++;
        else if (child.name !== 'ul' && child.name !== 'ol') n += countTopLevelItems(child);
      }
      return n;
    };

    const processList = async (listNode: any, level: number): Promise<void> => {
      const isOl = String(listNode.tagName ?? element.tag).toLowerCase() === 'ol';
      const attribs: Record<string, string> = listNode.attribs ?? {};
      let index = 0;
      let step = 1;
      if (isOl) {
        const start = parseInt(attribs.start ?? '', 10);
        const reversed = 'reversed' in attribs;
        if (reversed) step = -1;
        const first = Number.isFinite(start)
          ? start
          : reversed
            ? countTopLevelItems(listNode)
            : 1;
        // walkContainer 先加 step 再使用，故起点回退一步
        index = first - step;
      }
      await walkContainer(listNode, level, isOl, { index, step });
    };

    await processList($list.get(0), 0);
    return paragraphs;
  }

  /** HTML 表格 → 真 docx Table：colspan/rowspan 合并、colgroup/单元格列宽、底纹、单元格内联样式。 */
  private async createTableElements(element: ParsedElement, baseStyle: StyleMapping, $: any): Promise<any> {
    const sanitizedHtml = this.sanitizeHtml(element.html);
    // element.html 是 table 的内层 html；thead/tbody/tr/td 只有在 <table> 上下文里
    // 才会被解析器保留（在 div 里按 HTML5 规则被丢弃、只剩文本），因此外层必须
    // 用 table 标签包裹，不能用 div。
    const $table = $('<table>' + sanitizedHtml + '</table>');
    // 只取本表直接结构行（thead/tbody/tfoot 或 table 的直接子 tr）。find('tr') 会
    // 下钻到单元格里的嵌套表格，把内层行重复算作本表的顶层行。
    const rowNodes: Array<{ node: any; inHead: boolean }> = [];
    $table.children('thead, tbody, tfoot, tr').each((_i: number, section: any) => {
      const tag = section.tagName.toLowerCase();
      if (tag === 'tr') {
        rowNodes.push({ node: section, inHead: false });
      } else {
        const inHead = tag === 'thead';
        $(section).children('tr').each((_j: number, tr: any) => rowNodes.push({ node: tr, inHead }));
      }
    });

    // 第一遍：按网格占位模型解析每个单元格（grid 坐标 + colspan/rowspan/宽度/底纹）。
    // docx 会为 rowSpan 自动插入 vMerge 延续单元格，因此被上方合并覆盖的列必须跳过，
    // 且该占用状态要跨行累计（coveredUntil），否则后续行的列坐标会整体错位。
    const cellRows: Array<Array<{
      node: any;
      col: number;
      colspan: number;
      rowspan: number;
      dxa: number | null;
      bg: string | null;
      valign: (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable] | undefined;
      alignment: StyleMapping['alignment'];
      isTh: boolean;
    }>> = [];
    const coveredColumns: Array<Set<number>> = [];
    const headerRows: boolean[] = [];
    const coveredUntilRow = new Map<number, number>(); // 列 → 被 rowspan 占用至哪一行（不含）
    let gridCols = 0;
    const spanHints: Array<{ start: number; count: number; dxa: number }> = [];
    rowNodes.forEach(({ node: tr, inHead }, rowIndex) => {
      const cells: typeof cellRows[number] = [];
      const covered = new Set<number>();
      let col = 0;
      $(tr)
        .children('td, th')
        .each((_i: number, cell: any) => {
          while ((coveredUntilRow.get(col) ?? 0) > rowIndex) col++;
          const $cell = $(cell);
          const rawColspan = Math.max(1, parseInt($cell.attr('colspan') ?? '1', 10) || 1);
          // 夹取到本行剩余可用列，避免超大 colspan 撑出畸形宽网格
          const colspan = Math.max(1, Math.min(rawColspan, MAX_TABLE_COLUMNS - col));
          const rowspan = Math.max(1, Math.min(999, parseInt($cell.attr('rowspan') ?? '1', 10) || 1));
          const style = this.extractStyles($cell);
          const bg = this.parseColor(style['background-color'] ?? '');
          // valign 兼容 HTML 遗留值 middle（= center）
          const valignRaw: string | undefined = $cell.attr('valign');
          const valignKey = valignRaw === 'middle' ? 'CENTER' : valignRaw?.toUpperCase();
          const valign =
            valignKey === 'TOP' || valignKey === 'CENTER' || valignKey === 'BOTTOM'
              ? VerticalAlignTable[valignKey]
              : undefined;
          cells.push({
            node: cell,
            col,
            colspan,
            rowspan,
            dxa: this.parseWidthDxa($cell.attr('width') ?? style.width ?? null),
            bg,
            valign,
            alignment: this.convertCssToDocx(style).alignment,
            isTh: cell.tagName && cell.tagName.toLowerCase() === 'th',
          });
          for (let c = col; c < col + colspan; c++) {
            covered.add(c);
            coveredUntilRow.set(c, rowIndex + rowspan);
          }
          col += colspan;
        });
      for (const [c, until] of coveredUntilRow) if (until > rowIndex) covered.add(c);
      for (const cell of cells) {
        if (cell.dxa != null) spanHints.push({ start: cell.col, count: cell.colspan, dxa: cell.dxa });
      }
      cellRows.push(cells);
      coveredColumns.push(covered);
      headerRows.push(inHead || (cells.length > 0 && cells.every((c) => c.isTh)));
      gridCols = Math.max(gridCols, col, covered.size === 0 ? 0 : Math.max(...covered) + 1);
    });
    if (cellRows.length === 0 || gridCols === 0) return null;

    // 列宽：colgroup/col 优先，其次单元格 width 提示，剩余列按平均分配；总宽固定页面可用宽度。
    // 只取本表直接子级的 col：find('col') 会下钻到单元格内嵌套表格的 colgroup，
    // 把内层比例误当成外层列宽（曾把 1:1 的外层带成 1:84）。
    const colNodes = $table
      .children('colgroup')
      .children('col')
      .toArray()
      .concat($table.children('col').toArray());
    const colWidths = this.resolveColumnWidths(colNodes, gridCols, spanHints, $);
    const fallbackColDxa = Math.round(TABLE_FULL_WIDTH_DXA / gridCols);

    const rows: TableRow[] = [];
    for (let rowIndex = 0; rowIndex < cellRows.length; rowIndex++) {
      const cells = cellRows[rowIndex];
      // 视觉表头：真表头行，或沿用既有约定把首行当表头
      const isHeader = headerRows[rowIndex] || rowIndex === 0;
      const cellBase: StyleMapping = {
        size: baseStyle.size ?? 22,
        color: baseStyle.color ?? '000000',
        ...(isHeader ? { bold: true } : {}),
      };
      const out: TableCell[] = [];
      for (const cell of cells) {
        let widthDxa = 0;
        for (let c = cell.col; c < Math.min(gridCols, cell.col + cell.colspan); c++) {
          widthDxa += colWidths[c] ?? fallbackColDxa;
        }
        out.push(
          new TableCell({
            width: widthDxa > 0 ? { size: widthDxa, type: WidthType.DXA } : undefined,
            columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
            rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
            shading: cell.bg ? { fill: cell.bg } : isHeader ? { fill: 'EDEDED' } : undefined,
            verticalAlign: cell.valign,
            children: [
              new Paragraph({
                alignment: cell.alignment,
                spacing: { line: 276, lineRule: 'auto' },
                children: await this.createCellRuns(cell.node, cellBase, $),
              }),
            ],
          })
        );
      }
      // 补齐未被 colspan/rowspan 覆盖的列，保持网格矩形（Word 对短行会拉伸末格导致错列）
      for (let c = 0; c < gridCols; c++) {
        if (coveredColumns[rowIndex].has(c)) continue;
        out.push(
          new TableCell({
            width: { size: colWidths[c] ?? fallbackColDxa, type: WidthType.DXA },
            children: [new Paragraph({ spacing: { line: 276, lineRule: 'auto' }, children: [] })],
          })
        );
      }
      // 只有真表头（thead / 全 th 行）才跨页重复；表单首行等数据行不应被 Word 当表头重排
      rows.push(new TableRow({ tableHeader: headerRows[rowIndex], children: out }));
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: colWidths.map((w) => w ?? fallbackColDxa),
      rows,
    });
  }

  /** 解析本表直接子级的 col 声明 + 单元格宽度提示 → 每列 DXA 宽度数组（长度 = gridCols）。 */
  private resolveColumnWidths(colNodes: any[], gridCols: number, spanHints: Array<{ start: number; count: number; dxa: number }>, $: any): Array<number | null> {
    const TOTAL_DXA = TABLE_FULL_WIDTH_DXA;
    const widths: Array<number | null> = Array.from({ length: gridCols }, () => null);
    // colgroup/col 声明：起始列按累计游标推进（col 的索引不等于列索引，span 会跨列）
    let cursor = 0;
    for (const colEl of colNodes) {
      const $col = $(colEl);
      const span = Math.max(1, parseInt($col.attr('span') ?? '1', 10) || 1);
      const start = cursor;
      cursor += span;
      const dxa = this.parseWidthDxa($col.attr('width') ?? this.extractStyles($col)['width'] ?? null);
      if (dxa == null) continue;
      const end = Math.min(gridCols, start + span);
      const count = end - start;
      if (count <= 0) continue;
      const per = Math.round(dxa / count);
      for (let c = start; c < end; c++) {
        if (widths[c] == null) widths[c] = per;
      }
    }
    // 单元格 width 提示：单列直接采用；跨列按均分兜底
    for (const hint of spanHints) {
      if (hint.start >= gridCols) continue;
      const count = Math.min(hint.count, gridCols - hint.start);
      if (count === 1) {
        if (widths[hint.start] == null) widths[hint.start] = Math.round(hint.dxa);
      } else {
        const allNull = widths.slice(hint.start, hint.start + count).every((w) => w == null);
        if (allNull) {
          const per = Math.round(hint.dxa / count);
          for (let c = hint.start; c < hint.start + count; c++) widths[c] = per;
        }
      }
    }
    // 归一化到总宽：已知列按比例，未知列按已知均值（全未知则均分）
    const known = widths.filter((w): w is number => w != null);
    if (known.length === 0) return Array.from({ length: gridCols }, () => Math.round(TOTAL_DXA / gridCols));
    const knownSum = known.reduce((a, b) => a + b, 0);
    const unknownCount = gridCols - known.length;
    const avg = knownSum / known.length;
    const total = knownSum + unknownCount * avg;
    const scale = TOTAL_DXA / total;
    return widths.map((w) => (w != null ? Math.max(1, Math.round(w * scale)) : Math.max(1, Math.round(avg * scale))));
  }

  /**
   * width 值 → DXA（twip）。支持 "120"、"120px"（1px = 15/16 twip）、
   * "20%"（表格占满页面可用宽度，按 baseDxa 换算）。单位统一后才能混用
   * px 与百分比而不扭曲比例；无法解析返回 null。
   */
  private parseWidthDxa(raw: string | null | undefined, baseDxa = TABLE_FULL_WIDTH_DXA): number | null {
    if (!raw) return null;
    const v = String(raw).trim();
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(v);
    if (pct) {
      const p = parseFloat(pct[1]);
      return p > 0 && p <= 100 ? (p / 100) * baseDxa : null;
    }
    const num = parseFloat(v.replace(/px$/i, ''));
    return Number.isFinite(num) && num > 0 ? (num * 15) / 16 : null;
  }

  /** 单元格内容 → 内联 runs：复用内联标签样式链路，支持行内图片，嵌套表格/列表压平为文本。 */
  private async createCellRuns(cellNode: any, baseStyle: StyleMapping, $: any): Promise<Array<TextRun | ImageRun>> {
    // 单元格自身 background-color 已作为 w:shd 底纹，不能再当文字高亮重复应用
    const { highlight: _cellHighlight, ...cellCss } = this.convertCssToDocx(this.extractStyles($(cellNode)));
    const cellStyle = { ...baseStyle, ...cellCss };
    const segments: Array<{ text: string; style: StyleMapping; isBreak?: boolean; image?: ImageRun }> = [];
    const push = (text: string, style: StyleMapping): void => {
      if (!text) return;
      const last = segments[segments.length - 1];
      // 合并相邻同样式片段（嵌套结构压平后会产生 "o"+"n" 这类碎片）；换行/图片段不参与合并
      if (last && !last.isBreak && !last.image && this.sameInlineStyle(last.style, style)) last.text += text;
      else segments.push({ text, style });
    };
    const walk = async (nodes: any[], style: StyleMapping): Promise<void> => {
      for (const node of nodes) {
        if (node.type === 'text') {
          // 连续空白（含换行）折叠为单个空格：纯空白若丢弃会把 "a<strong>b</strong>" 拼成 "ab"
          push((node.data ?? '').replace(/\s+/g, ' '), style);
        } else if (node.type === 'tag') {
          if (node.name === 'br') {
            segments.push({ text: '', style, isBreak: true });
            continue;
          }
          if (node.name === 'img') {
            const run = await this.createImageRun($(node).attr('src'));
            if (run) segments.push({ text: '', style, image: run });
            continue;
          }
          const tagStyle = this.applyTagStyles(node, style, $);
          if (node.name === 'table' || node.name === 'ul' || node.name === 'ol') {
            // 嵌套表格/列表压平为文本（不递归成真嵌套表，避免与"嵌套表不重复输出内层行"
            // 的既有语义冲突）；单元格/列表项之间补空格，否则 "内a""内b" 会粘成 "内a内b"
            const text = this.flattenToText(node).replace(/\s+/g, ' ').trim();
            if (text) push(text, tagStyle);
            continue;
          }
          await walk(node.children ?? [], tagStyle);
        }
      }
    };
    await walk(cellNode.children ?? [], cellStyle);
    const runs: Array<TextRun | ImageRun> = [];
    for (const seg of segments) {
      if (seg.image) runs.push(seg.image);
      else if (seg.isBreak) runs.push(new TextRun({ text: '', break: 1 }));
      else runs.push(this.createTextRun(seg.text, seg.style));
    }
    return runs.length > 0 ? runs : [this.createTextRun('', cellStyle)];
  }

  /** 嵌套表格/列表 → 纯文本：单元格与列表项两侧补空格，避免相邻内容粘连。 */
  private flattenToText(node: any): string {
    const parts: string[] = [];
    for (const child of node.children ?? []) {
      if (child.type === 'text') parts.push(child.data ?? '');
      else if (child.type === 'tag') {
        const inner = this.flattenToText(child);
        if (child.name === 'td' || child.name === 'th' || child.name === 'li' || child.name === 'br') {
          parts.push(` ${inner} `);
        } else {
          parts.push(inner);
        }
      }
    }
    return parts.join('');
  }

  private sameInlineStyle(a: StyleMapping, b: StyleMapping): boolean {
    return (
      a.bold === b.bold && a.italics === b.italics && a.size === b.size && a.color === b.color &&
      a.strike === b.strike && a.highlight === b.highlight && a.fontName === b.fontName &&
      JSON.stringify(a.underline ?? null) === JSON.stringify(b.underline ?? null)
    );
  }

  private createCodeBlock(element: ParsedElement, $: any): any[] {
    const paragraphs: any[] = [];
    const lines = element.text.split('\n');
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: ' ', size: 4 })],
        spacing: { after: 120 },
      })
    );
    for (const line of lines) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: line ?? ' ', font: { name: 'Consolas' }, size: 20, color: '24292f' }),
          ],
          spacing: { line: 276, lineRule: 'auto', before: 0, after: 0 },
          indent: { left: 432, right: 432 },
          border: { left: { style: 'single', size: 4, color: 'e1e4e8' } },
          shading: { type: 'solid', color: 'f6f8fa' },
        })
      );
    }
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: ' ', size: 4 })],
        spacing: { before: 120 },
      })
    );
    return paragraphs;
  }

  private convertCssToDocx(styles: any): StyleMapping {
    const docxStyle: StyleMapping = {};
    this.convertFontSize(styles, docxStyle);
    this.convertColor(styles, docxStyle);
    this.convertBackgroundColor(styles, docxStyle);
    this.convertFontWeight(styles, docxStyle);
    this.convertFontStyle(styles, docxStyle);
    this.convertTextDecoration(styles, docxStyle);
    this.convertTextAlign(styles, docxStyle);
    return docxStyle;
  }

  private convertFontSize(styles: any, docxStyle: StyleMapping): void {
    const size = this.parseFontSize(styles['font-size']);
    if (size) docxStyle.size = size;
  }

  private convertColor(styles: any, docxStyle: StyleMapping): void {
    const color = this.parseColor(styles['color']);
    if (color) docxStyle.color = color;
  }

  private convertBackgroundColor(styles: any, docxStyle: StyleMapping): void {
    const bgColor = this.parseColor(styles['background-color']);
    if (bgColor) docxStyle.highlight = this.mapColorToHighlight(bgColor);
  }

  private mapColorToHighlight(bgColor: string): StyleMapping['highlight'] {
    const map: Record<string, StyleMapping['highlight']> = {
      '#ffff00': 'yellow', '#00ff00': 'green', '#00ffff': 'cyan', '#ff00ff': 'magenta',
      '#0000ff': 'blue', '#ff0000': 'red', '#000080': 'darkBlue', '#008080': 'darkCyan',
      '#008000': 'darkGreen', '#800080': 'darkMagenta', '#800000': 'darkRed',
      '#808000': 'darkYellow', '#808080': 'darkGray', '#c0c0c0': 'lightGray',
      '#000000': 'black', '#ffffff': 'white',
    };
    return map[bgColor.toLowerCase()] ?? 'yellow';
  }

  private convertFontWeight(styles: any, docxStyle: StyleMapping): void {
    const weight = styles['font-weight'];
    if (weight) {
      const w = weight.toLowerCase();
      if (w === 'bold' || w === 'bolder' || parseInt(w) >= 600) {
        docxStyle.bold = true;
      }
    }
  }

  private convertFontStyle(styles: any, docxStyle: StyleMapping): void {
    const style = styles['font-style'];
    if (style && style.toLowerCase() === 'italic') {
      docxStyle.italics = true;
    }
  }

  private convertTextDecoration(styles: any, docxStyle: StyleMapping): void {
    const decoration = styles['text-decoration'];
    if (decoration && decoration.toLowerCase().includes('underline')) {
      docxStyle.underline = { type: UnderlineType.SINGLE };
    }
  }

  private convertTextAlign(styles: any, docxStyle: StyleMapping): void {
    const align = styles['text-align'];
    if (!align) return;
    switch (align.toLowerCase()) {
      case 'center':
        docxStyle.alignment = AlignmentType.CENTER;
        break;
      case 'right':
        docxStyle.alignment = AlignmentType.RIGHT;
        break;
      case 'justify':
        docxStyle.alignment = AlignmentType.JUSTIFIED;
        break;
      default:
        docxStyle.alignment = AlignmentType.LEFT;
    }
  }

  private parseFontSize(value: string): number | null {
    if (!value) return null;
    const numValue = parseFloat(value.replace(/[^0-9.]/g, ''));
    if (isNaN(numValue)) return null;
    if (value.includes('pt')) return numValue * 2;
    if (value.includes('px')) return Math.round(numValue * 1.5);
    if (value.includes('em')) return Math.round(numValue * 24);
    return Math.round(numValue * 2);
  }

  private parseColor(value: string): string | null {
    if (!value) return null;
    value = value.trim();
    if (value.startsWith('#')) {
      let hex = value.substring(1);
      if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
      }
      return hex.toUpperCase();
    }
    const rgbMatch = value.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
      return (r + g + b).toUpperCase();
    }
    const colorMap: Record<string, string> = {
      red: 'FF0000', green: '008000', blue: '0000FF', black: '000000', white: 'FFFFFF',
      yellow: 'FFFF00', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080',
      pink: 'FFC0CB', brown: 'A52A2A', cyan: '00FFFF', magenta: 'FF00FF', lime: '00FF00',
      navy: '000080', maroon: '800000', olive: '808000', teal: '008080', silver: 'C0C0C0',
    };
    return colorMap[value.toLowerCase()] ?? null;
  }
}
