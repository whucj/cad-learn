import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildExportPlan, obsidianTag, safeFileName, zipPlan, type ExportInput, type ExportState } from './export';
import type { Article, Note, Settings } from './types';
import { safeHref } from './url';

const t0 = new Date('2026-11-23T08:00:00Z').getTime();
const settings: Settings = { minRelevance: 3, exportFolder: 'CADLearn' };

const article = (over: Partial<Article> = {}): Article => ({
  id: 'a1',
  url: 'https://arxiv.org/abs/2611.00001',
  title: 'Robust NURBS: Intersection [v2]',
  source: 'arXiv NURBS / B-Rep',
  topic: 'geometry',
  published: '2026-11-20T10:00:00.000Z',
  fetched: '2026-11-21T00:00:00.000Z',
  snippet: 'We present a robust method.',
  ai: { summary: '提出了一种稳健的 NURBS 曲面求交方法。', points: ['要点一', '要点二'], tags: ['NURBS', '曲面 求交', '2026'], relevance: 5, level: '专业' },
  ...over,
});

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: '求交笔记',
  body: '## 思路\n\n细分 + 牛顿迭代',
  tags: ['复习'],
  articleId: 'a1',
  created: t0,
  updated: t0,
  ...over,
});

function input(over: Partial<ExportInput> = {}): ExportInput {
  const a = article();
  return {
    notes: [note()],
    starred: [],
    articles: new Map([[a.id, a]]),
    settings,
    exported: {},
    incremental: true,
    now: new Date(t0),
    ...over,
  };
}

const mdPaths = (files: Map<string, string>) => [...files.keys()].filter((k) => k.endsWith('.md')).sort();

describe('buildExportPlan', () => {
  it('exports notes, linked clippings and backup with wikilinks', () => {
    const plan = buildExportPlan(input());
    expect([...plan.files.keys()].sort()).toEqual([
      'CADLearn/Clippings/Robust NURBS Intersection v2.md',
      'CADLearn/Notes/求交笔记.md',
      'CADLearn/cad-learn-backup.json',
    ]);
    expect(plan.changed).toBe(2);
    expect(plan.removed).toEqual([]);

    const noteMd = plan.files.get('CADLearn/Notes/求交笔记.md')!;
    expect(noteMd).toMatch(/^---\ntitle: "求交笔记"\ncreated: /);
    expect(noteMd).not.toContain('aliases');
    expect(noteMd).toContain('  - cad-learn/note\n  - geometry-kernel\n  - 复习');
    expect(noteMd).toContain('[[Clippings/Robust NURBS Intersection v2|Robust NURBS: Intersection  v2 ]]');

    const clip = plan.files.get('CADLearn/Clippings/Robust NURBS Intersection v2.md')!;
    expect(clip).toContain('title: "Robust NURBS: Intersection [v2]"');
    expect(clip).toContain('published: 2026-11-20');
    expect(clip).toContain('  - NURBS\n  - 曲面-求交\n');
    expect(clip).not.toContain('  - 2026\n'); // 纯数字标签无效
    expect(clip).toContain('[PDF](https://arxiv.org/pdf/2611.00001)');
    expect(clip).toContain('- [[Notes/求交笔记]]');

    const backup = JSON.parse(plan.files.get('CADLearn/cad-learn-backup.json')!);
    expect(backup.version).toBe(2);
    expect(Object.keys(backup.exportState).sort()).toEqual(['clip:a1', 'note:n1']);
  });

  it('P0-3: uses fresh article data instead of the stale starred snapshot', () => {
    const stale = article({ ai: undefined });
    const fresh = article();
    const plan = buildExportPlan(
      input({ notes: [], starred: [{ article: stale, starredAt: t0 }], articles: new Map([[fresh.id, fresh]]) }),
    );
    expect(plan.files.get('CADLearn/Clippings/Robust NURBS Intersection v2.md')).toContain('## AI 摘要');
  });

  it('P0-4: file name is frozen after export; renamed note gets aliases, no duplicate', () => {
    const first = buildExportPlan(input());
    const renamed = buildExportPlan(input({ notes: [note({ title: 'BVH 与求交', updated: t0 + 1 })], exported: first.nextState }));
    expect(mdPaths(renamed.files)).toEqual(['CADLearn/Notes/求交笔记.md']);
    const md = renamed.files.get('CADLearn/Notes/求交笔记.md')!;
    expect(md).toContain('title: "BVH 与求交"\naliases:\n  - "BVH 与求交"');
    expect(md).toContain('# BVH 与求交');
    expect(renamed.removed).toEqual([]);
  });

  it('P0-4: new note reusing an exported name gets a suffix; deleted note is listed for cleanup', () => {
    const first = buildExportPlan(input());
    const plan = buildExportPlan(
      input({ notes: [note({ id: 'n2', created: t0 + 5, articleId: undefined })], exported: first.nextState }),
    );
    expect(mdPaths(plan.files)).toEqual(['CADLearn/Notes/求交笔记 (2).md', 'CADLearn/_待清理.md']);
    expect(plan.removed).toEqual(['CADLearn/Notes/求交笔记.md', 'CADLearn/Clippings/Robust NURBS Intersection v2.md']);
    expect(plan.files.get('CADLearn/_待清理.md')).toContain('- [[Notes/求交笔记]]');
    expect(Object.keys(plan.nextState)).toEqual(['note:n2']);
  });

  it('P0-5: incremental export is driven by confirmed content hashes', () => {
    const first = buildExportPlan(input());
    // 未确认：下一次仍包含全部内容
    expect(buildExportPlan(input()).changed).toBe(2);
    // 已确认且无变化：什么都不导出（也不生成备份）
    expect(buildExportPlan(input({ exported: first.nextState })).files.size).toBe(0);
    // 只改笔记正文：笔记重新导出，文章不动
    const edited = buildExportPlan(input({ notes: [note({ body: '新内容', updated: t0 + 60_000 })], exported: first.nextState }));
    expect(mdPaths(edited.files)).toEqual(['CADLearn/Notes/求交笔记.md']);
    // 文章后来才有 AI 摘要：文章重新导出
    const noAi = article({ ai: undefined });
    const before = buildExportPlan(input({ articles: new Map([[noAi.id, noAi]]) }));
    const after = buildExportPlan(input({ exported: before.nextState }));
    expect(mdPaths(after.files)).toEqual(['CADLearn/Clippings/Robust NURBS Intersection v2.md']);
    // 全部导出：忽略哈希
    expect(buildExportPlan(input({ exported: first.nextState, incremental: false })).changed).toBe(2);
  });

  it('article that dropped out of the data is not treated as deleted', () => {
    const first = buildExportPlan(input());
    const plan = buildExportPlan(input({ articles: new Map(), exported: first.nextState }));
    expect(plan.removed).toEqual([]);
    expect(plan.nextState['clip:a1']).toEqual(first.nextState['clip:a1']);
  });

  it('P0-1: unsafe article URLs never reach the Markdown', () => {
    const evil = article({ id: 'e1', url: 'javascript:alert(1)', title: 'Evil' });
    const plan = buildExportPlan(input({ notes: [note({ articleId: 'e1' })], articles: new Map([[evil.id, evil]]) }));
    const all = [...plan.files.values()].join('\n');
    expect(all).not.toMatch(/javascript:/i);
    expect(plan.files.get('CADLearn/Clippings/Evil.md')).not.toContain('原文：');
  });

  it('digest articles keep their issue link and multi-line editor bullets', () => {
    const a = article({
      id: 'g1',
      url: 'https://dl.acm.org/doi/10.1145/3842562',
      title: 'Stealthy Blue Noise',
      source: 'Graphics Programming Weekly',
      topic: 'rendering',
      snippet: '• presents blue-noise samples\n• applies to stippling',
      via: { title: 'Graphics Programming weekly - Issue 463 - November 15th, 2026', url: 'https://www.jendrikillner.com/post/graphics-programming-weekly-issue-463/' },
    });
    const plan = buildExportPlan(input({ notes: [], starred: [{ article: a, starredAt: t0 }] }));
    const md = plan.files.get('CADLearn/Clippings/Stealthy Blue Noise.md')!;
    expect(md).toContain('via: "Graphics Programming weekly - Issue 463 - November 15th, 2026"');
    expect(md).toContain('> 收录于：[Graphics Programming weekly - Issue 463 - November 15th, 2026](https://www.jendrikillner.com/post/graphics-programming-weekly-issue-463/)');
    expect(md).toContain('## 编辑推荐语\n\n> • presents blue-noise samples\n> • applies to stippling\n');
  });

  it('sanitizes folder and keeps names deterministic', () => {
    const n = (id: string, created: number) => note({ id, title: 'Same', created, updated: created, articleId: undefined });
    const plan = buildExportPlan(input({ notes: [n('x', t0 + 1), n('y', t0)], settings: { ...settings, exportFolder: '/My: Vault//Learn/' } }));
    expect(mdPaths(plan.files)).toEqual(['My Vault/Learn/Notes/Same (2).md', 'My Vault/Learn/Notes/Same.md']);
    expect(plan.nextState['note:y'].name).toBe('Same');
  });

  it('stable output: same input gives same hashes (unstarred clip date does not drift)', () => {
    const a = buildExportPlan(input({ now: new Date(t0) }));
    const b = buildExportPlan(input({ now: new Date(t0 + 86_400_000 * 3) }));
    const strip = (s: ExportState) => JSON.stringify(s);
    expect(strip(a.nextState)).toBe(strip(b.nextState));
  });
});

describe('helpers', () => {
  it('safeHref', () => {
    expect(safeHref('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(safeHref('http://x.org')).toBe('http://x.org/');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref(' JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it('safeFileName', () => {
    expect(safeFileName('A/B: [[C]] #tag | d?')).toBe('A B C tag d');
    expect(safeFileName('  ')).toBe('untitled');
    expect(safeFileName('..hidden')).toBe('hidden');
  });

  it('obsidianTag', () => {
    expect(obsidianTag('光线 追踪')).toBe('光线-追踪');
    expect(obsidianTag('#Vulkan')).toBe('Vulkan');
    expect(obsidianTag('123')).toBeNull();
    expect(obsidianTag('C++')).toBe('C');
  });

  it('zipPlan produces a readable zip', async () => {
    const plan = buildExportPlan(input({ notes: [], starred: [{ article: article(), starredAt: t0 }] }));
    const zip = await JSZip.loadAsync(await (await zipPlan(plan)).arrayBuffer());
    expect(Object.keys(zip.files)).toContain('CADLearn/Clippings/Robust NURBS Intersection v2.md');
  });
});
