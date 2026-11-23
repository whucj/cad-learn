import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PATHS } from './curated';
import { AiError, curatorMessages, estimateCost, generatePath, isPeak, parsePathJson } from './deepseek';
import { buildExportPlan } from './export';
import { mergeBackup } from './import';
import type { LearningPath, Note, Settings } from './types';

const settings: Settings = { minRelevance: 3, exportFolder: 'CADLearn' };

describe('builtin curated paths', () => {
  it.each(BUILTIN_PATHS.map((p) => [p.title, p] as const))('%s: 5 complete resources, ranked', (_, p) => {
    expect(p.resources).toHaveLength(5);
    for (const r of p.resources) {
      expect(r.type).toBeTruthy();
      for (const f of ['name', 'why', 'teaches', 'bestFor', 'howTo', 'avoid'] as const) expect(r[f].length, `${r.name}.${f}`).toBeGreaterThan(5);
      expect(['中级', '高级']).toContain(r.level); // 内置清单不含新手资源
      expect(r.url).toMatch(/^https:\/\//);
    }
    expect(p.order.map((o) => o.name).sort()).toEqual(p.resources.map((r) => r.name).sort());
    expect(p.order.every((o) => o.reason)).toBe(true);
  });
});

const aiJson = (over: object = {}) =>
  JSON.stringify({
    title: 'CAD 布尔运算',
    intro: '覆盖求交、分类与重建。',
    resources: [
      { name: 'A', type: '书籍', url: 'https://a.example/book', why: 'w', teaches: 't', bestFor: 'b', level: '入门', howTo: 'h', avoid: 'x' },
      { name: 'B', type: '网站', url: 'javascript:alert(1)', why: 'w', teaches: 't', bestFor: 'b', level: 'Advanced', howTo: 'h', avoid: 'x' },
      { name: 'C', type: '课程', url: null, why: 'w', teaches: 't', bestFor: 'b', level: '中级', howTo: 'h', avoid: 'x' },
      { name: 'A', type: '重复', why: '', teaches: '', bestFor: '', level: '', howTo: '', avoid: '' },
    ],
    order: [
      { name: 'C', reason: '先打基础' },
      { name: '不存在', reason: '应被丢弃' },
      { name: 'A', reason: '再精读' },
    ],
    ...over,
  });

describe('parsePathJson', () => {
  it('cleans AI output: unsafe links, levels, duplicates, ranking', () => {
    const p = parsePathJson('```json\n' + aiJson() + '\n```', '布尔');
    expect(p.title).toBe('CAD 布尔运算');
    expect(p.resources.map((r) => [r.name, r.level, r.url])).toEqual([
      ['A', '新手', 'https://a.example/book'],
      ['B', '高级', undefined],
      ['C', '中级', undefined],
    ]);
    expect(p.order).toEqual([
      { name: 'C', reason: '先打基础' },
      { name: 'A', reason: '再精读' },
      { name: 'B', reason: '' },
    ]);
  });

  it('drops beginner resources unless asked for them (keeps at least 3)', () => {
    const extra = { name: 'D', type: '论文', why: 'w', teaches: 't', bestFor: 'b', level: '高级', howTo: 'h', avoid: 'x' };
    const base = JSON.parse(aiJson());
    const four = JSON.stringify({ ...base, resources: [...base.resources, extra] });
    expect(parsePathJson(four, 't', false).resources.map((r) => r.name)).toEqual(['B', 'C', 'D']);
    expect(parsePathJson(four, 't', false).order.map((o) => o.name)).toEqual(['C', 'B', 'D']);
    expect(parsePathJson(four, 't', true).resources.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
    // 去掉后不足 3 个：保留原样，不报错
    expect(parsePathJson(aiJson(), 't', false).resources.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('rejects unusable output', () => {
    expect(() => parsePathJson('not json', 't')).toThrow(AiError);
    expect(() => parsePathJson(aiJson({ resources: [{ name: 'only one' }] }), 't')).toThrow('太少');
  });

  it('prompt carries the curator template and asks for json', () => {
    const [sys, user] = curatorMessages('网格生成', '会 C++');
    expect(sys.content).toContain('json');
    expect(user.content).toContain('学习「网格生成」杠杆最高的 5 个资源');
    expect(user.content).toContain('我要的是信号，不是噪音');
    expect(user.content).toContain('我的背景和目标：会 C++');
    expect(user.content).toContain('不需要新手级资源');
    expect(curatorMessages('x', '', true)[1].content).not.toContain('不需要新手级资源');
  });
});

describe('generatePath', () => {
  it('calls DeepSeek in json mode and estimates cost', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: aiJson() } }],
          usage: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1000, completion_tokens: 2000 },
        }),
      );
    });
    const r = await generatePath({ key: ' sk-test ', topic: '布尔', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(r.path.resources).toHaveLength(3);
    expect(r.costUsd).toBeGreaterThan(0.0013);
    expect(r.costUsd).toBeLessThan(0.003);
  });

  it('maps HTTP errors to readable messages', async () => {
    const f = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
    await expect(generatePath({ key: 'k', topic: 't', fetchImpl: f(401) })).rejects.toThrow('API Key 无效');
    await expect(generatePath({ key: 'k', topic: 't', fetchImpl: f(402) })).rejects.toThrow('余额不足');
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(generatePath({ key: 'k', topic: 't', fetchImpl: offline })).rejects.toThrow('网络错误');
  });

  it('peak pricing', () => {
    expect(isPeak(new Date('2026-11-23T02:00:00Z'))).toBe(true); // 周一 UTC 02
    expect(isPeak(new Date('2026-11-22T02:00:00Z'))).toBe(false); // 周日
    const u = { prompt_cache_miss_tokens: 1e6 };
    expect(estimateCost(u, new Date('2026-11-23T02:00:00Z'))).toBeCloseTo(0.3);
    expect(estimateCost(u, new Date('2026-11-23T12:00:00Z'))).toBeCloseTo(0.15);
  });
});

describe('learning paths in Obsidian export and backup', () => {
  const ai: LearningPath = {
    ...parsePathJson(aiJson(), 't'), // title: CAD 布尔运算
    id: 'ai-x',
    source: 'ai',
    model: 'deepseek-flash',
    createdAt: new Date('2026-11-23T08:00:00Z').getTime(),
  };
  const note: Note = { id: 'n1', title: '学习：A', body: 'x', tags: [], ref: 'ai-x::A', created: 1, updated: 1 };

  it('writes 学习路线/*.md with progress and note links', () => {
    const plan = buildExportPlan({
      notes: [note],
      starred: [],
      articles: new Map(),
      settings,
      paths: [...BUILTIN_PATHS, ai],
      progress: { 'ai-x::A': 'done', 'ai-x::C': 'doing', 'geometry-kernel::The NURBS Book（第 2 版，Piegl & Tiller）': 'doing' },
      aiPaths: { [ai.id]: ai },
      exported: {},
      incremental: true,
    });
    const md = plan.files.get('CADLearn/学习路线/CAD 布尔运算.md')!;
    expect(md).toContain('progress: "1/3"');
    expect(md).toContain('> [!warning] AI 生成的推荐');
    expect(md).toContain('1. [/] **C**：先打基础\n2. [x] **A**：再精读\n3. [ ] **B**');
    expect(md).toContain('- 我的笔记：[[Notes/学习：A]]');
    expect(md).not.toContain('javascript:');
    expect(plan.files.get('CADLearn/学习路线/几何内核.md')).toContain('1. [/] **The NURBS Book');
    expect(plan.files.has('CADLearn/学习路线/GPU 驱动与 CAD 渲染.md')).toBe(true);

    const backup = JSON.parse(plan.files.get('CADLearn/cad-learn-backup.json')!);
    expect(Object.keys(backup.aiPaths)).toEqual(['ai-x']);
    const merged = mergeBackup({ notes: {}, starred: {}, exportState: {}, progress: { 'ai-x::A': 'doing' } }, JSON.stringify(backup));
    expect(merged.counts.paths).toBe(1);
    expect(merged.state.aiPaths!['ai-x'].title).toBe('CAD 布尔运算');
    expect(merged.state.progress!['ai-x::A']).toBe('doing'); // 本地进度优先
    expect(merged.state.progress!['ai-x::C']).toBe('doing');
  });

  it('deleted AI path goes to cleanup list', () => {
    const base = { notes: [], starred: [], articles: new Map(), settings, incremental: true };
    const first = buildExportPlan({ ...base, paths: [ai], exported: {} });
    const second = buildExportPlan({ ...base, paths: [], exported: first.nextState });
    expect(second.removed).toEqual(['CADLearn/学习路线/CAD 布尔运算.md']);
  });
});
