import type { Article, Note } from './types';

/**
 * 安卓“分享到 CAD Learn”（PWA share_target，GET ./?title=&text=&url=）。
 * - 链接是 App 里已有的文章：有选中文字 → 作为引用追加到该文章的笔记；没有 → 打开文章页
 * - 链接已在某条笔记里（例如之前分享过的“待读”）：追加引用到那条笔记
 * - 否则新建“待读”笔记
 * Chrome 分享选中文字时，text 是带引号的文字，url 带 #:~:text= 片段。
 */

export interface SharedData {
  title: string;
  text: string;
  url: string;
}

export type ShareAction =
  | { kind: 'article'; article: Article; quote: string }
  | { kind: 'note'; note: Note; quote: string }
  | { kind: 'new'; title: string; body: string };

export function readShareParams(search: string): SharedData | null {
  const q = new URLSearchParams(search);
  if (!q.has('title') && !q.has('text') && !q.has('url')) return null;
  return { title: q.get('title') ?? '', text: q.get('text') ?? '', url: q.get('url') ?? '' };
}

export function planShare(d: SharedData, articles: Iterable<Article>, notes: Iterable<Note>): ShareAction {
  const url = d.url.trim() || /https?:\/\/\S+/.exec(d.text)?.[0] || '';
  const quote = d.text
    .replace(url, '')
    .trim()
    .replace(/^["“”「](.*)["“”」]$/s, '$1')
    .trim();
  const key = url ? matchKey(url) : '';

  if (key) {
    for (const a of articles) if (matchKey(a.url) === key) return { kind: 'article', article: a, quote };
    for (const n of notes) {
      const urls = n.body.match(/https?:\/\/[^\s<>)\]]+/g) ?? [];
      if (urls.some((u) => matchKey(u) === key)) return { kind: 'note', note: n, quote };
    }
  }
  const title = (d.title || quote || url || '分享的链接').replace(/\s+/g, ' ').trim();
  const body = `${url ? `<${cleanShareUrl(url)}>\n\n` : ''}${quote ? `${quoteBlock(quote)}\n\n` : ''}`;
  return { kind: 'new', title: `待读：${title}`.slice(0, 120), body };
}

/** 把引用追加到笔记末尾 */
export function appendQuote(body: string, quote: string, at: Date = new Date()): string {
  const stamp = `${at.getMonth() + 1}/${at.getDate()}`;
  return `${body.replace(/\s+$/, '')}\n\n${quoteBlock(quote)}\n> — 摘录于 ${stamp}\n`;
}

function quoteBlock(q: string): string {
  return q
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

/** 去掉文字片段锚点（#:~:text=）和跟踪参数，便于保存 */
export function cleanShareUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hash.startsWith('#:~:')) u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^(ref|source|fbclid|gclid)$/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return raw;
  }
}

/** 用于判断“同一篇”的键：忽略协议、www、末尾斜杠、片段、跟踪参数；arXiv 的 abs/pdf/html 和版本号视为同一篇 */
export function matchKey(raw: string): string {
  try {
    const u = new URL(cleanShareUrl(raw));
    const arxiv = /^(?:www\.)?arxiv\.org$/.test(u.hostname) && /^\/(?:abs|pdf|html)\/([\d.]+?)(?:v\d+)?(?:\.pdf)?\/?$/.exec(u.pathname);
    if (arxiv) return `arxiv:${arxiv[1]}`;
    u.hash = '';
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return '';
  }
}
