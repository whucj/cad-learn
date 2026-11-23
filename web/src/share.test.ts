import { describe, expect, it } from 'vitest';
import { appendQuote, cleanShareUrl, matchKey, planShare, readShareParams } from './share';
import type { Article, Note } from './types';

const art = (id: string, url: string): Article => ({ id, url, title: id, source: 's', topic: 'geometry', fetched: '' });
const articles = [art('a1', 'https://arxiv.org/abs/2611.00001'), art('a2', 'https://www.example.com/blog/post/')];
const notes: Note[] = [{ id: 'n1', title: '待读：X', body: '<https://other.dev/x?utm_source=tw>\n\n', tags: [], created: 0, updated: 0 }];

describe('share target', () => {
  it('matchKey treats URL variants of the same page as equal', () => {
    expect(matchKey('https://arxiv.org/pdf/2611.00001v2')).toBe(matchKey('https://arxiv.org/abs/2611.00001'));
    expect(matchKey('http://example.com/blog/post#:~:text=foo')).toBe(matchKey('https://www.example.com/blog/post/'));
    expect(matchKey('https://example.com/a?utm_source=x')).toBe(matchKey('https://example.com/a'));
    expect(matchKey('https://example.com/a?id=1')).not.toBe(matchKey('https://example.com/a?id=2'));
  });

  it('selected text from Chrome is quoted into the matching article note', () => {
    const d = readShareParams('?title=&text=' + encodeURIComponent('"Robust intersection of NURBS"\nhttps://arxiv.org/pdf/2611.00001v1#:~:text=Robust'))!;
    const a = planShare(d, articles, notes);
    expect(a).toMatchObject({ kind: 'article', quote: 'Robust intersection of NURBS' });
    expect((a as { article: Article }).article.id).toBe('a1');
  });

  it('link only → open the article; link already in a note → that note; otherwise new 待读', () => {
    expect(planShare({ title: 'T', text: '', url: 'https://example.com/blog/post' }, articles, notes)).toMatchObject({ kind: 'article', quote: '' });
    expect(planShare({ title: '', text: '值得一读 https://other.dev/x', url: '' }, articles, notes)).toMatchObject({
      kind: 'note',
      quote: '值得一读',
    });
    const n = planShare({ title: 'New', text: '', url: 'https://new.dev/p?utm_medium=x#:~:text=y' }, articles, notes);
    expect(n).toEqual({ kind: 'new', title: '待读：New', body: '<https://new.dev/p>\n\n' });
  });

  it('appendQuote', () => {
    expect(appendQuote('## 我的笔记\n\n', '第一行\n第二行', new Date(2026, 10, 23))).toBe('## 我的笔记\n\n> 第一行\n> 第二行\n> — 摘录于 11/23\n');
    expect(cleanShareUrl('not a url')).toBe('not a url');
    expect(readShareParams('?foo=1')).toBeNull();
  });
});
