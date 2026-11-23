import { TOPIC_TAG, type Article, type LearningPath, type Note, type ProgressState, type Settings, type Starred } from './types';
import { safeHref } from './url';

/**
 * 导出到 Obsidian。zip 只能新增/覆盖文件，不能删除或改名，所以：
 * - 文件名在首次（确认过的）导出时固定，之后改标题也不变，新标题写进 aliases；
 * - 记录每个文件上次导出内容的哈希，增量导出只包含内容变化的文件；
 * - 用户确认“已放入 Obsidian”后才提交导出记录（nextState）；
 * - 已删除的笔记/收藏列在 _待清理.md 里，提示手动删除。
 *
 * zip 结构：
 *   <folder>/Notes/<笔记>.md
 *   <folder>/Clippings/<文章>.md      收藏的文章 + 被笔记引用的文章
 *   <folder>/学习路线/<主题>.md        精选资源、使用顺序和学习进度
 *   <folder>/_待清理.md                （有删除时）
 *   <folder>/cad-learn-backup.json     浏览器本地数据完整备份
 *
 * 笔记 frontmatter 带 cad-learn-id，导入 zip 时据此把 Obsidian 里的修改对应回原笔记（见 import.ts）。
 */

export interface ExportRecord {
  name: string; // 不含 .md
  hash: string;
}
/** key：`note:<id>`、`clip:<articleId>` 或 `path:<路线 id>` */
export type ExportState = Record<string, ExportRecord>;

export interface ExportInput {
  notes: Note[];
  starred: Starred[];
  /** 当前能查到的最新文章数据（latest.json + 收藏快照），优先于收藏快照使用 */
  articles: Map<string, Article>;
  settings: Settings;
  /** 学习路线（内置 + AI 生成）及进度 */
  paths?: LearningPath[];
  progress?: Record<string, ProgressState>;
  /** 只进备份、不生成 Markdown 的 AI 路线（内置路线不需要备份） */
  aiPaths?: Record<string, LearningPath>;
  exported: ExportState;
  /** true：只导出内容有变化的文件；false：全部重新导出 */
  incremental: boolean;
  now?: Date;
}

export interface ExportPlan {
  files: Map<string, string>;
  /** 本次包含的笔记/文章 Markdown 数 */
  changed: number;
  /** 需要在 Obsidian 中手动删除的文件（zip 内路径） */
  removed: string[];
  /** 用户确认后保存的导出记录 */
  nextState: ExportState;
  /** 每个笔记/文章当前应有的完整内容（不受增量影响），key 同 ExportState */
  entries: Map<string, { path: string; content: string }>;
  exportedAt: number;
}

export function buildExportPlan(input: ExportInput): ExportPlan {
  const { notes, starred, articles, settings, exported, incremental } = input;
  const now = input.now ?? new Date();
  const folder = sanitizeFolder(settings.exportFolder) || 'CADLearn';
  const files = new Map<string, string>();
  const entries = new Map<string, { path: string; content: string }>();
  const next: ExportState = {};

  // ---- 需要导出的文章：收藏的 + 笔记引用的；都优先用最新数据（可能后来才有 AI 摘要） ----
  const starredAt = new Map(starred.map((s) => [s.article.id, s.starredAt]));
  const clipArticles = new Map<string, Article>();
  for (const s of starred) clipArticles.set(s.article.id, articles.get(s.article.id) ?? s.article);
  const notesByArticle = new Map<string, Note[]>();
  const referencedMissing = new Set<string>(); // 被笔记引用、但文章数据已不可得（滚出最新列表且未收藏）
  for (const n of notes) {
    if (!n.articleId) continue;
    notesByArticle.set(n.articleId, [...(notesByArticle.get(n.articleId) ?? []), n]);
    const a = articles.get(n.articleId) ?? clipArticles.get(n.articleId);
    if (a) clipArticles.set(a.id, a);
    else referencedMissing.add(n.articleId);
  }

  // ---- 分配文件名：已导出过的沿用，新的按创建顺序分配并避开重名 ----
  const used = { note: new Set<string>(), clip: new Set<string>(), path: new Set<string>() };
  for (const [key, rec] of Object.entries(exported)) used[kindOf(key)]?.add(rec.name.toLowerCase());
  const names = new Map<string, string>();
  const assign = (key: string, title: string) => {
    const prev = exported[key]?.name;
    if (prev) return names.set(key, prev);
    const set = used[kindOf(key)];
    const base = safeFileName(title);
    let name = base;
    for (let i = 2; set.has(name.toLowerCase()); i++) name = `${base} (${i})`;
    set.add(name.toLowerCase());
    names.set(key, name);
  };
  [...notes]
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
    .forEach((n) => assign(`note:${n.id}`, n.title || '未命名笔记'));
  [...clipArticles.values()]
    .sort((a, b) => a.fetched.localeCompare(b.fetched) || a.id.localeCompare(b.id))
    .forEach((a) => assign(`clip:${a.id}`, a.title));
  const paths = input.paths ?? [];
  paths.forEach((p) => assign(`path:${p.id}`, p.title));

  const emit = (key: string, path: string, content: string) => {
    const hash = hashString(content);
    next[key] = { name: names.get(key)!, hash };
    entries.set(key, { path, content });
    if (!incremental || exported[key]?.hash !== hash) files.set(path, content);
  };

  for (const n of notes) {
    const key = `note:${n.id}`;
    const a = n.articleId ? clipArticles.get(n.articleId) : undefined;
    emit(key, `${folder}/Notes/${names.get(key)}.md`, noteMarkdown(n, names.get(key)!, a, a ? names.get(`clip:${a.id}`) : undefined));
  }

  for (const a of clipArticles.values()) {
    const key = `clip:${a.id}`;
    const related = notesByArticle.get(a.id) ?? [];
    // 未收藏、仅被笔记引用的文章：用最早那条笔记的创建时间，保证内容稳定（不会每天都“有变化”）
    const clipped = starredAt.get(a.id) ?? Math.min(...related.map((n) => n.created));
    emit(
      key,
      `${folder}/Clippings/${names.get(key)}.md`,
      clippingMarkdown(a, clipped, related.map((n) => names.get(`note:${n.id}`)!)),
    );
  }

  const progress = input.progress ?? {};
  for (const p of paths) {
    const key = `path:${p.id}`;
    const linked = notes
      .filter((n) => n.ref?.startsWith(`${p.id}::`))
      .map((n) => ({ res: n.ref!.slice(p.id.length + 2), file: names.get(`note:${n.id}`)! }));
    emit(key, `${folder}/${KIND_DIR.path}/${names.get(key)}.md`, pathMarkdown(p, progress, linked));
  }

  // 文章数据暂时拿不到，但笔记还在：保留原导出记录，不算删除
  for (const id of referencedMissing) {
    const rec = exported[`clip:${id}`];
    if (rec) next[`clip:${id}`] = rec;
  }

  const removed = Object.entries(exported)
    .filter(([key]) => !next[key])
    .map(([key, rec]) => `${folder}/${KIND_DIR[kindOf(key)]}/${rec.name}.md`);

  const changed = files.size;
  if (removed.length) files.set(`${folder}/_待清理.md`, cleanupMarkdown(folder, removed, now));
  if (files.size > 0) {
    files.set(
      `${folder}/cad-learn-backup.json`,
      JSON.stringify(
        { version: 2, exportedAt: now.toISOString(), notes, starred, settings, exportState: next, aiPaths: input.aiPaths ?? {}, progress },
        null,
        1,
      ),
    );
  }
  return { files, changed, removed, nextState: next, entries, exportedAt: now.getTime() };
}

export function noteMarkdown(n: Note, fileName: string, a: Article | undefined, clipFile: string | undefined): string {
  const title = n.title || '未命名笔记';
  const fm: string[] = [`title: ${yamlStr(title)}`];
  // 文件名首次导出后固定；标题改过时写入 aliases，Obsidian 里仍可按新标题搜索和链接
  if (safeFileName(title) !== fileName.replace(/ \(\d+\)$/, '')) fm.push('aliases:', `  - ${yamlStr(title)}`);
  fm.push(`created: ${isoDate(n.created)}`, `updated: ${isoDate(n.updated)}`, `cad-learn-id: ${n.id}`);
  const url = a ? safeHref(a.url) : undefined;
  if (a) {
    if (url) fm.push(`url: ${yamlStr(url)}`);
    fm.push(`source: ${yamlStr(a.source)}`);
  }
  fm.push('tags:', ...tagList(['cad-learn/note', ...(a ? [TOPIC_TAG[a.topic]] : []), ...n.tags]));

  const body = [`---`, ...fm, `---`, ``, `# ${title}`, ``];
  if (a && clipFile) {
    body.push(`> 关联文章：[[Clippings/${clipFile}|${escapeLinkText(a.title)}]]${url ? ` · [原文](${url})` : ''}`, ``);
  }
  body.push(n.body.trim(), ``);
  return body.join('\n');
}

export function clippingMarkdown(a: Article, clippedAt: number, noteFiles: string[]): string {
  const url = safeHref(a.url);
  const fm: string[] = [`title: ${yamlStr(a.title)}`, `source: ${yamlStr(a.source)}`];
  if (url) fm.push(`url: ${yamlStr(url)}`);
  if (a.author) fm.push(`author: ${yamlStr(a.author)}`);
  if (a.published) fm.push(`published: ${a.published.slice(0, 10)}`);
  fm.push(`clipped: ${isoDate(clippedAt)}`);
  if (a.via) fm.push(`via: ${yamlStr(a.via.title)}`);
  if (a.ai?.level) fm.push(`level: ${a.ai.level}`);
  if (a.ai?.relevance) fm.push(`relevance: ${a.ai.relevance}`);
  fm.push('tags:', ...tagList(['cad-learn/clipping', TOPIC_TAG[a.topic], ...(a.ai?.tags ?? [])]));

  const out = [`---`, ...fm, `---`, ``, `# ${a.title}`, ``];
  if (url) out.push(`> 原文：[${escapeLinkText(a.source)}](${url})`, ``);
  const viaUrl = safeHref(a.via?.url);
  if (a.via && viaUrl) out.push(`> 收录于：[${escapeLinkText(a.via.title)}](${viaUrl})`, ``);
  const arxiv = url && /^https:\/\/arxiv\.org\/abs\/([\d.]+)$/.exec(url)?.[1];
  if (arxiv) out.push(`> [PDF](https://arxiv.org/pdf/${arxiv}) · [HTML](https://arxiv.org/html/${arxiv})`, ``);
  if (a.ai) {
    out.push(`## AI 摘要`, ``, a.ai.summary, ``);
    if (a.ai.points.length) out.push(`## 要点`, ``, ...a.ai.points.map((p) => `- ${p}`), ``);
  }
  if (a.snippet) {
    out.push(a.via ? `## 编辑推荐语` : `## 原文摘录`, ``, ...a.snippet.split('\n').map((l) => `> ${l}`), ``);
  }
  if (noteFiles.length) out.push(`## 我的笔记`, ``, ...noteFiles.map((f) => `- [[Notes/${f}]]`), ``);
  return out.join('\n');
}

export function pathMarkdown(p: LearningPath, progress: Record<string, ProgressState>, notes: { res: string; file: string }[]): string {
  const state = (name: string) => progress[`${p.id}::${name}`];
  const done = p.resources.filter((r) => state(r.name) === 'done').length;
  const fm = [
    `title: ${yamlStr(`${p.title} · 学习路线`)}`,
    `source: ${yamlStr(p.source === 'ai' ? `AI 生成（${p.model ?? 'DeepSeek'}）` : 'CAD Learn 精选')}`,
  ];
  if (p.createdAt) fm.push(`created: ${isoDate(p.createdAt)}`);
  fm.push(`progress: "${done}/${p.resources.length}"`);
  fm.push('tags:', ...tagList(['cad-learn/path', ...(p.topic ? [TOPIC_TAG[p.topic]] : [])]));

  const out = [`---`, ...fm, `---`, ``, `# ${p.title}：学习杠杆最高的 ${p.resources.length} 个资源`, ``];
  if (p.source === 'ai') out.push(`> [!warning] AI 生成的推荐，书名和链接请自行核实。`, ``);
  if (p.background) out.push(`> 我的背景：${p.background}`, ``);
  if (p.intro) out.push(p.intro, ``);

  out.push(`## 推荐使用顺序`, ``);
  p.order.forEach((o, i) => {
    const st = state(o.name);
    out.push(`${i + 1}. [${st === 'done' ? 'x' : st === 'doing' ? '/' : ' '}] **${o.name}**${o.reason ? `：${o.reason}` : ''}`);
  });
  out.push(``);

  p.resources.forEach((r, i) => {
    const url = safeHref(r.url);
    const st = state(r.name);
    out.push(`## ${i + 1}. ${r.name}`, ``);
    out.push(`- 类型：${r.type} · 难度：${r.level}${url ? ` · [链接](${url})` : ''}`);
    out.push(`- 进度：${st === 'done' ? '✅ 已完成' : st === 'doing' ? '📖 进行中' : '未开始'}`);
    out.push(`- **为什么值得花时间**：${r.why}`);
    out.push(`- **能帮我学会**：${r.teaches}`);
    out.push(`- **最适合**：${r.bestFor}`);
    out.push(`- **高效用法**：${r.howTo}`);
    out.push(`- **别浪费时间在**：${r.avoid}`);
    const linked = notes.filter((n) => n.res === r.name);
    if (linked.length) out.push(`- 我的笔记：${linked.map((n) => `[[Notes/${n.file}]]`).join('、')}`);
    out.push(``);
  });
  return out.join('\n');
}

function cleanupMarkdown(folder: string, removed: string[], now: Date): string {
  const prefix = `${folder}/`;
  return [
    `# 待清理的文件`,
    ``,
    `${isoDate(now.getTime())} 导出时发现：以下笔记或收藏已在 CAD Learn 中删除，但 Obsidian 里的文件不会自动删除。`,
    `点开链接确认后，可在 Obsidian 中手动删除；全部处理完也可以删除本文件。`,
    ``,
    ...removed.map((p) => `- [[${p.slice(prefix.length).replace(/\.md$/, '')}]]`),
    ``,
  ].join('\n');
}

/** 去掉文件系统和 Obsidian 链接不允许的字符 */
export function safeFileName(title: string): string {
  let name = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > 80) name = name.slice(0, 80).trim();
  name = name.replace(/^\.+/, '');
  return name || 'untitled';
}

/** Obsidian 标签：不能有空格和大多数标点，不能纯数字 */
export function obsidianTag(t: string): string | null {
  const tag = t.trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_\-/]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!tag || /^\d+$/.test(tag)) return null;
  return tag;
}

/** 非加密哈希（cyrb53），只用于判断内容是否变化 */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

type Kind = 'note' | 'clip' | 'path';
const KIND_DIR: Record<Kind, string> = { note: 'Notes', clip: 'Clippings', path: '学习路线' };

function kindOf(key: string): Kind {
  return key.startsWith('note:') ? 'note' : key.startsWith('path:') ? 'path' : 'clip';
}

function tagList(tags: string[]): string[] {
  const set = new Set<string>();
  for (const t of tags) {
    const v = obsidianTag(t);
    if (v) set.add(v);
  }
  return [...set].map((t) => `  - ${t}`);
}

function yamlStr(s: string): string {
  return JSON.stringify(s); // JSON 字符串是合法的 YAML 双引号字符串
}

function escapeLinkText(s: string): string {
  return s.replace(/[[\]|]/g, ' ');
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sanitizeFolder(f: string): string {
  return f
    .split('/')
    .map((seg) => safeFileName(seg).replace(/^untitled$/, ''))
    .filter(Boolean)
    .join('/');
}

export async function zipPlan(plan: ExportPlan): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [path, content] of plan.files) zip.file(path, content);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
