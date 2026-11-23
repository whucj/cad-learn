import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildExportFiles, exportZip, obsidianTag, safeFileName } from './export';
import type { Article, Note, Settings, Starred } from './types';

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

const settings: Settings = { minRelevance: 3, exportFolder: 'CADLearn' };
const t0 = new Date('2026-11-23T08:00:00Z').getTime();

describe('buildExportFiles', () => {
  it('exports notes, linked clippings and backup with wikilinks', () => {
    const a = article();
    const note: Note = { id: 'n1', title: '求交笔记', body: '## 思路\n\n细分 + 牛顿迭代', tags: ['复习'], articleId: 'a1', created: t0, updated: t0 };
    const files = buildExportFiles({ notes: [note], starred: [], articles: new Map([[a.id, a]]), settings, now: new Date(t0) });

    expect([...files.keys()].sort()).toEqual([
      'CADLearn/Clippings/Robust NURBS Intersection v2.md',
      'CADLearn/Notes/求交笔记.md',
      'CADLearn/cad-learn-backup.json',
    ]);
    const noteMd = files.get('CADLearn/Notes/求交笔记.md')!;
    expect(noteMd).toMatch(/^---\ntitle: "求交笔记"\n/);
    expect(noteMd).toContain('  - cad-learn/note\n  - geometry-kernel\n  - 复习');
    expect(noteMd).toContain('[[Clippings/Robust NURBS Intersection v2|Robust NURBS: Intersection  v2 ]]');
    expect(noteMd).toContain('细分 + 牛顿迭代');

    const clip = files.get('CADLearn/Clippings/Robust NURBS Intersection v2.md')!;
    expect(clip).toContain('title: "Robust NURBS: Intersection [v2]"');
    expect(clip).toContain('published: 2026-11-20');
    expect(clip).toContain('level: 专业');
    expect(clip).toContain('  - NURBS\n  - 曲面-求交\n');
    expect(clip).not.toContain('  - 2026\n'); // 纯数字标签无效
    expect(clip).toContain('[PDF](https://arxiv.org/pdf/2611.00001)');
    expect(clip).toContain('- [[Notes/求交笔记]]');

    const backup = JSON.parse(files.get('CADLearn/cad-learn-backup.json')!);
    expect(backup.version).toBe(1);
    expect(backup.notes).toHaveLength(1);
  });

  it('incremental export only includes items changed since last export', () => {
    const a = article();
    const b = article({ id: 'b2', title: 'Other', url: 'https://example.com/o' });
    const starred: Starred[] = [
      { article: a, starredAt: t0 - 1000 },
      { article: b, starredAt: t0 + 1000 },
    ];
    const files = buildExportFiles({ notes: [], starred, articles: new Map(), settings, since: t0, now: new Date(t0 + 2000) });
    expect([...files.keys()].filter((k) => k.endsWith('.md'))).toEqual(['CADLearn/Clippings/Other.md']);

    const none = buildExportFiles({ notes: [], starred, articles: new Map(), settings, since: t0 + 5000 });
    expect(none.size).toBe(0);
  });

  it('dedupes file names and sanitizes folder', () => {
    const n = (id: string, created: number): Note => ({ id, title: 'Same', body: '', tags: [], created, updated: created });
    const files = buildExportFiles({
      notes: [n('x', t0 + 1), n('y', t0)],
      starred: [],
      articles: new Map(),
      settings: { ...settings, exportFolder: '/My: Vault//Learn/' },
    });
    expect([...files.keys()].sort()).toEqual(['My Vault/Learn/Notes/Same (2).md', 'My Vault/Learn/Notes/Same.md', 'My Vault/Learn/cad-learn-backup.json']);
  });
});

describe('helpers', () => {
  it('safeFileName', () => {
    expect(safeFileName('A/B: [[C]] #tag | d?')).toBe('A B C tag d');
    expect(safeFileName('  ')).toBe('untitled');
    expect(safeFileName('..hidden')).toBe('hidden');
  });

  it('obsidianTag', () => {
    expect(obsidianTag('光线 追踪')).toBe('光线-追踪');
    expect(obsidianTag('#Vulkan')).toBe('Vulkan');
    expect(obsidianTag('D3D12')).toBe('D3D12');
    expect(obsidianTag('123')).toBeNull();
    expect(obsidianTag('C++')).toBe('C');
  });

  it('exportZip produces a readable zip', async () => {
    const a = article();
    const { blob, count } = await exportZip({ notes: [], starred: [{ article: a, starredAt: t0 }], articles: new Map(), settings });
    expect(count).toBe(1);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toContain('CADLearn/Clippings/Robust NURBS Intersection v2.md');
  });
});
