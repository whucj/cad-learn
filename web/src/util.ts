import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function relTime(iso?: string | number): string {
  if (iso == null) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${Math.max(m, 1)} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(t).toLocaleDateString('zh-CN');
}

export function arxivId(url: string): string | undefined {
  return /arxiv\.org\/abs\/([\d.]+)/.exec(url)?.[1];
}

let hooked = false;
/** Markdown → 安全的 HTML（笔记预览用）；外链在新标签页打开 */
export function renderMarkdown(src: string): string {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(marked.parse(src, { async: false, gfm: true, breaks: true }));
}

export function navigate(hash: string) {
  location.hash = hash;
}

/** 合集出处的简短显示："Graphics Programming weekly - Issue 463 - …" → "第 463 期" */
export function viaLabel(title: string): string {
  const n = /\bIssue\s+(\d+)/i.exec(title)?.[1];
  return n ? `第 ${n} 期` : title;
}

export function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}
