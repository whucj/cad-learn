import { TOPIC_TAG, type Article, type Note, type Settings, type Starred } from './types';

/**
 * 生成导出到 Obsidian 的文件（路径 → 内容）。纯函数，便于测试；打包 zip 在 exportZip()。
 *
 * <folder>/Notes/<笔记标题>.md        笔记
 * <folder>/Clippings/<文章标题>.md    收藏的文章 + 被笔记引用的文章
 * <folder>/cad-learn-backup.json      浏览器本地数据完整备份（可在设置页恢复）
 */
export interface ExportInput {
  notes: Note[];
  starred: Starred[];
  /** 当前能查到的文章（latest.json + 收藏快照），用于解析笔记关联的文章 */
  articles: Map<string, Article>;
  settings: Settings;
  /** 只导出该时间之后新增/修改的内容 */
  since?: number;
  now?: Date;
}

export function buildExportFiles(input: ExportInput): Map<string, string> {
  const { notes, starred, articles, settings, since = 0 } = input;
  const now = input.now ?? new Date();
  const folder = sanitizeFolder(settings.exportFolder) || 'CADLearn';
  const files = new Map<string, string>();

  // 文件名需全局稳定：基于全部数据分配，而不是只基于本次增量
  const clipArticles = new Map<string, Article>();
  for (const s of starred) clipArticles.set(s.article.id, s.article);
  for (const n of notes) {
    const a = n.articleId ? articles.get(n.articleId) : undefined;
    if (a) clipArticles.set(a.id, a);
  }
  const clipName = assignNames([...clipArticles.values()].map((a) => ({ id: a.id, title: a.title, key: a.fetched })));
  const noteName = assignNames(notes.map((n) => ({ id: n.id, title: n.title || '未命名笔记', key: String(n.created) })));

  const notesByArticle = new Map<string, Note[]>();
  for (const n of notes) {
    if (!n.articleId) continue;
    const list = notesByArticle.get(n.articleId) ?? [];
    list.push(n);
    notesByArticle.set(n.articleId, list);
  }
  const starredAt = new Map(starred.map((s) => [s.article.id, s.starredAt]));

  for (const n of notes) {
    if (n.updated <= since) continue;
    const a = n.articleId ? clipArticles.get(n.articleId) : undefined;
    files.set(`${folder}/Notes/${noteName.get(n.id)}.md`, noteMarkdown(n, a, a ? clipName.get(a.id) : undefined));
  }

  for (const a of clipArticles.values()) {
    const related = notesByArticle.get(a.id) ?? [];
    const changed = (starredAt.get(a.id) ?? 0) > since || related.some((n) => n.updated > since);
    if (!changed) continue;
    files.set(
      `${folder}/Clippings/${clipName.get(a.id)}.md`,
      clippingMarkdown(a, starredAt.get(a.id) ?? now.getTime(), related.map((n) => noteName.get(n.id)!)),
    );
  }

  if (files.size > 0 || since === 0) {
    files.set(`${folder}/cad-learn-backup.json`, JSON.stringify({ version: 1, exportedAt: now.toISOString(), notes, starred, settings }, null, 1));
  }
  return files;
}

export function noteMarkdown(n: Note, a: Article | undefined, clipFile: string | undefined): string {
  const fm: string[] = [
    `title: ${yamlStr(n.title || '未命名笔记')}`,
    `created: ${isoDate(n.created)}`,
    `updated: ${isoDate(n.updated)}`,
  ];
  if (a) fm.push(`url: ${yamlStr(a.url)}`, `source: ${yamlStr(a.source)}`);
  fm.push('tags:', ...tagList(['cad-learn/note', ...(a ? [TOPIC_TAG[a.topic]] : []), ...n.tags]));

  const body = [`---`, ...fm, `---`, ``, `# ${n.title || '未命名笔记'}`, ``];
  if (a) body.push(`> 关联文章：[[Clippings/${clipFile}|${escapeLinkText(a.title)}]] · [原文](${a.url})`, ``);
  body.push(n.body.trim(), ``);
  return body.join('\n');
}

export function clippingMarkdown(a: Article, clippedAt: number, noteFiles: string[]): string {
  const fm: string[] = [
    `title: ${yamlStr(a.title)}`,
    `source: ${yamlStr(a.source)}`,
    `url: ${yamlStr(a.url)}`,
  ];
  if (a.author) fm.push(`author: ${yamlStr(a.author)}`);
  if (a.published) fm.push(`published: ${a.published.slice(0, 10)}`);
  fm.push(`clipped: ${isoDate(clippedAt)}`);
  if (a.ai?.level) fm.push(`level: ${a.ai.level}`);
  if (a.ai?.relevance) fm.push(`relevance: ${a.ai.relevance}`);
  fm.push('tags:', ...tagList(['cad-learn/clipping', TOPIC_TAG[a.topic], ...(a.ai?.tags ?? [])]));

  const out = [`---`, ...fm, `---`, ``, `# ${a.title}`, ``, `> 原文：[${escapeLinkText(a.source)}](${a.url})`, ``];
  const arxiv = /arxiv\.org\/abs\/([\d.]+)/.exec(a.url)?.[1];
  if (arxiv) out.push(`> [PDF](https://arxiv.org/pdf/${arxiv}) · [HTML](https://arxiv.org/html/${arxiv})`, ``);
  if (a.ai) {
    out.push(`## AI 摘要`, ``, a.ai.summary, ``);
    if (a.ai.points.length) out.push(`## 要点`, ``, ...a.ai.points.map((p) => `- ${p}`), ``);
  }
  if (a.snippet) out.push(`## 原文摘录`, ``, `> ${a.snippet}`, ``);
  if (noteFiles.length) out.push(`## 我的笔记`, ``, ...noteFiles.map((f) => `- [[Notes/${f}]]`), ``);
  return out.join('\n');
}

/** 去掉文件系统和 Obsidian 链接不允许的字符；重名时追加序号 */
export function safeFileName(title: string): string {
  let name = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > 80) name = name.slice(0, 80).trim();
  name = name.replace(/^\.+/, '');
  return name || 'untitled';
}

function assignNames(items: { id: string; title: string; key: string }[]): Map<string, string> {
  const sorted = [...items].sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const it of sorted) {
    const base = safeFileName(it.title);
    const k = base.toLowerCase();
    const n = (used.get(k) ?? 0) + 1;
    used.set(k, n);
    out.set(it.id, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/** Obsidian 标签：不能有空格和大多数标点，不能纯数字 */
export function obsidianTag(t: string): string | null {
  const tag = t.trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_\-/]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!tag || /^\d+$/.test(tag)) return null;
  return tag;
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

function sanitizeFolder(f: string): string {
  return f
    .split('/')
    .map((seg) => safeFileName(seg).replace(/^untitled$/, ''))
    .filter(Boolean)
    .join('/');
}

export async function exportZip(input: ExportInput): Promise<{ blob: Blob; count: number }> {
  const { default: JSZip } = await import('jszip');
  const files = buildExportFiles(input);
  const zip = new JSZip();
  for (const [path, content] of files) zip.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, count: [...files.keys()].filter((k) => k.endsWith('.md')).length };
}
