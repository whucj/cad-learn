import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildExportPlan, zipPlan, type ExportState } from './export';
import { parseNoteMarkdown, planImport, readImportFile, type ImportContext, type LocalState } from './import';
import type { Article, Note, Settings } from './types';

const t0 = new Date('2026-11-23T08:00:00Z').getTime();
const settings: Settings = { minRelevance: 3, exportFolder: 'CADLearn' };
const art: Article = {
  id: 'a1',
  url: 'https://arxiv.org/abs/2611.00001',
  title: 'Robust NURBS Intersection',
  source: 'arXiv',
  topic: 'geometry',
  fetched: '2026-11-21T00:00:00.000Z',
};
const articles = new Map([[art.id, art]]);
const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: '求交笔记',
  body: '## 思路\n\n细分 + 牛顿迭代',
  tags: ['复习', 'PBR 材质'],
  articleId: 'a1',
  created: t0,
  updated: t0,
  ...over,
});

/** 导出并确认，返回 zip 文件内容和确认后的本地状态 */
function exported(notes: Note[]) {
  const plan = buildExportPlan({ notes, starred: [], articles, settings, exported: {}, incremental: false, now: new Date(t0) });
  const local: LocalState = { notes: Object.fromEntries(notes.map((n) => [n.id, n])), starred: {}, exportState: plan.nextState };
  return { files: plan.files, local };
}

let seq = 0;
const ctx = (local: LocalState): ImportContext => ({
  local,
  articles,
  settings,
  now: new Date(t0 + 1000),
  newId: () => `new${++seq}`,
});

const edit = (files: Map<string, string>, path: string, f: (s: string) => string) => {
  const m = new Map(files);
  m.set(path, f(m.get(path)!));
  return m;
};
const P = 'CADLearn/Notes/求交笔记.md';

describe('planImport', () => {
  it('restores everything from an exported zip on an empty device', async () => {
    const { files } = exported([note()]);
    const read = await readImportFile(new File([await zipPlan({ files } as never)], 'x.zip'));
    const p = planImport(read, ctx({ notes: {}, starred: {}, exportState: {} }));
    expect(p.backup).toEqual({ notes: 1, starred: 0, paths: 0 });
    expect(p.notes.n1).toEqual(note());
    expect(p.updated).toEqual([]);
    expect(p.added).toEqual([]);
    expect(p.unchanged).toBe(1); // md 与备份一致；标签规范化（PBR-材质）不算修改
    expect(p.exportState['note:n1'].name).toBe('求交笔记');
  });

  it('same device, nothing changed: no-op', () => {
    const { files, local } = exported([note()]);
    const p = planImport(files, ctx(local));
    expect(p.backup).toEqual({ notes: 0, starred: 0, paths: 0 });
    expect([p.updated, p.added, p.conflicts]).toEqual([[], [], []]);
  });

  it('takes Obsidian edits when the local note is unchanged since export (CRLF, edited title/tags)', () => {
    const { files, local } = exported([note()]);
    const changed = edit(files, P, (s) =>
      s.replace('# 求交笔记', '# 曲面求交笔记').replace('牛顿迭代', '牛顿迭代\n\n补充：区间算术').replace('  - 复习\n', '  - 复习\n  - 已读\n').replace(/\n/g, '\r\n'),
    );
    const p = planImport(changed, ctx(local));
    expect(p.updated).toEqual(['曲面求交笔记']);
    expect(p.notes.n1).toMatchObject({
      id: 'n1',
      articleId: 'a1',
      title: '曲面求交笔记',
      body: '## 思路\n\n细分 + 牛顿迭代\n\n补充：区间算术',
      tags: ['复习', '已读', 'PBR-材质'],
      created: t0,
      updated: t0 + 1000,
    });
    // 文件名不变：下次导出覆盖同一个文件
    const next = buildExportPlan({ notes: Object.values(p.notes), starred: [], articles, settings, exported: p.exportState, incremental: true });
    expect([...next.files.keys()]).toContain(P);
    expect(next.files.get(P)).toContain('aliases:\n  - "曲面求交笔记"');
  });

  it('keeps the local note when the file is the old export', () => {
    const { files, local } = exported([note()]);
    local.notes.n1 = note({ body: '本地新内容', updated: t0 + 500 });
    const p = planImport(files, ctx(local));
    expect(p.notes.n1.body).toBe('本地新内容');
    expect(p.unchanged).toBe(1);
    expect(p.conflicts).toEqual([]);
  });

  it('both sides changed: local kept, Obsidian version saved as a copy', () => {
    const { files, local } = exported([note()]);
    local.notes.n1 = note({ body: '本地新内容', updated: t0 + 500 });
    const p = planImport(edit(files, P, (s) => s.replace('牛顿迭代', 'Obsidian 改的')), ctx(local));
    expect(p.conflicts).toEqual(['求交笔记']);
    expect(p.notes.n1.body).toBe('本地新内容');
    const copy = Object.values(p.notes).find((n) => n.id !== 'n1')!;
    expect(copy).toMatchObject({ title: '求交笔记（Obsidian 版本）', articleId: 'a1', body: '## 思路\n\n细分 + Obsidian 改的' });
  });

  it('imports notes created in Obsidian, reusing the file name', () => {
    const { local } = exported([note()]);
    const files = new Map([
      ['Notes/BVH 构建.md', '---\ntags: [bvh, "#渲染"]\nurl: https://arxiv.org/abs/2611.00001\n---\n\nSAH 分割\n'],
      ['Vault/Notes/无关.md', '不在 CADLearn 文件夹里，忽略'],
      ['CADLearn/Clippings/x.md', '文章不导入'],
    ]);
    const p = planImport(files, ctx(local));
    expect(p.backup).toBeUndefined();
    expect(p.added).toEqual(['BVH 构建']);
    const n = Object.values(p.notes).find((x) => x.title === 'BVH 构建')!;
    expect(n).toMatchObject({ body: 'SAH 分割', tags: ['bvh', '渲染'], articleId: 'a1' });
    expect(p.exportState[`note:${n.id}`]).toEqual({ name: 'BVH 构建', hash: '' });
    const next = buildExportPlan({ notes: Object.values(p.notes), starred: [], articles, settings, exported: p.exportState, incremental: true });
    expect(next.files.has('CADLearn/Notes/BVH 构建.md')).toBe(true);
  });

  it('notes exported before cad-learn-id existed are matched by file name', () => {
    const { files, local } = exported([note()]);
    const p = planImport(edit(files, P, (s) => s.replace(/cad-learn-id: .*\n/, '').replace('牛顿迭代', '改')), ctx(local));
    expect(p.updated).toEqual(['求交笔记']);
    expect(Object.keys(p.notes)).toEqual(['n1']);
  });

  it('rejects unrelated files', async () => {
    const empty = new Map([['readme.md', 'x']]);
    expect(() => planImport(empty, ctx({ notes: {}, starred: {}, exportState: {} }))).toThrow('没有找到');
    expect(() => planImport(new Map([['cad-learn-backup.json', '{"a":1}']]), ctx({ notes: {}, starred: {}, exportState: {} }))).toThrow(
      '不是 CAD Learn 的备份文件',
    );
    await expect(readImportFile(new File(['not a zip'], 'x.zip'))).rejects.toThrow('无法读取');
  });

  it('reads a zip made by hand (skips macOS metadata) and a bare backup json', async () => {
    const zip = new JSZip();
    zip.file('CADLearn/Notes/a.md', '# A\n\nbody');
    zip.file('__MACOSX/CADLearn/Notes/._a.md', 'junk');
    zip.file('CADLearn/img.png', 'binary');
    const files = await readImportFile(new File([await zip.generateAsync({ type: 'blob' })], 'CADLearn.zip'));
    expect([...files.keys()]).toEqual(['CADLearn/Notes/a.md']);
    const json = await readImportFile(new File(['{}'], 'backup (1).json', { type: 'application/json' }));
    expect([...json.keys()]).toEqual(['cad-learn-backup.json']);
  });
});

describe('parseNoteMarkdown', () => {
  it('round-trips exported notes', () => {
    const ex: ExportState = {};
    const plan = buildExportPlan({ notes: [note({ title: 'A: "quoted"' })], starred: [], articles, settings, exported: ex, incremental: false });
    const md = [...plan.files.entries()].find(([k]) => k.includes('/Notes/'))![1];
    expect(parseNoteMarkdown(md, 'A quoted')).toMatchObject({
      id: 'n1',
      title: 'A: "quoted"',
      body: '## 思路\n\n细分 + 牛顿迭代',
      url: art.url,
      tags: ['cad-learn/note', 'geometry-kernel', '复习', 'PBR-材质'],
    });
  });

  it('falls back to frontmatter title, then file name', () => {
    expect(parseNoteMarkdown('---\ntitle: T\n---\nbody', 'f').title).toBe('T');
    expect(parseNoteMarkdown('just text', 'file').title).toBe('file');
    expect(parseNoteMarkdown("---\ntitle: 'it''s'\ntags: a, b\n---\n", 'f')).toMatchObject({ title: "it's", tags: ['a', 'b'] });
  });
});
