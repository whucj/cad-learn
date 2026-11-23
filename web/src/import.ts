import { buildExportPlan, hashString, sanitizeFolder, type ExportState } from './export';
import { TOPIC_TAG, type Article, type LearningPath, type Note, type ProgressState, type Settings, type Starred } from './types';

/**
 * 导入 zip（或单独的 cad-learn-backup.json）：
 * 1. zip 里的 cad-learn-backup.json：恢复笔记和收藏（按更新时间较新者优先，不删除本地内容）；
 * 2. zip 里 <文件夹>/Notes/*.md：把在 Obsidian 里修改或新建的笔记带回来。
 *    - 按 frontmatter 的 cad-learn-id 对应原笔记（没有时按导出时的文件名）；
 *    - 本地自上次确认导出后没改过 → 用 Obsidian 的版本；
 *    - 两边都改过 → 不覆盖，Obsidian 的版本另存为「标题（Obsidian 版本）」；
 *    - 文章（Clippings）是生成的内容，不导入；Obsidian 里删除的文件也不会删除笔记。
 * 先 planImport 生成预览，用户确认后再 applyImport（store.ts）。
 */

export interface LocalState {
  notes: Record<string, Note>;
  starred: Record<string, Starred>;
  exportState: ExportState;
  aiPaths?: Record<string, LearningPath>;
  progress?: Record<string, ProgressState>;
}

export interface ImportPlan extends LocalState {
  /** 从备份恢复/更新的条数；undefined 表示 zip 里没有备份 */
  backup?: { notes: number; starred: number; paths: number };
  /** 用 Obsidian 版本更新的笔记标题 */
  updated: string[];
  /** 新增的笔记（Obsidian 里新建的，或本地没有的） */
  added: string[];
  /** 两边都改过、另存为副本的笔记 */
  conflicts: string[];
  /** 与本地一致或是旧版本、无需处理的笔记文件数 */
  unchanged: number;
}

export interface ImportContext {
  local: LocalState;
  articles: Map<string, Article>;
  settings: Settings;
  now?: Date;
  newId?: () => string;
}

export const BACKUP_NAME = 'cad-learn-backup.json';

/** 读取用户选择的文件：zip 中只取 .md 和 .json；单独的 json 视为备份 */
export async function readImportFile(file: File): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    files.set(BACKUP_NAME, await file.text());
    return files;
  }
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('无法读取：请选择导出的 zip 或 cad-learn-backup.json');
  }
  for (const entry of Object.values(zip.files)) {
    const path = entry.name;
    if (entry.dir || path.startsWith('__MACOSX/') || /(^|\/)\._/.test(path)) continue;
    if (!/\.(md|json)$/i.test(path)) continue;
    files.set(path, await entry.async('string'));
  }
  return files;
}

export function planImport(files: Map<string, string>, ctx: ImportContext): ImportPlan {
  const now = ctx.now ?? new Date();
  const newId = ctx.newId ?? (() => Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const folder = sanitizeFolder(ctx.settings.exportFolder) || 'CADLearn';

  // ---- 1. 备份 ----
  let state: LocalState = { ...ctx.local };
  let backup: ImportPlan['backup'];
  const backupPath = [...files.keys()]
    .filter((p) => basename(p) === BACKUP_NAME)
    .sort((a, b) => a.length - b.length)[0];
  if (backupPath) {
    const r = mergeBackup(state, files.get(backupPath)!);
    state = r.state;
    backup = r.counts;
  }

  // ---- 2. Obsidian 里的笔记 ----
  const noteRe = new RegExp(`^(?:(?:.*/)?${escapeRe(folder)}/)?Notes/([^/]+)\\.md$`, 'i');
  const mdFiles = [...files.entries()]
    .map(([path, text]) => ({ path, base: noteRe.exec(path)?.[1], text: text.replace(/\r\n?/g, '\n') }))
    .filter((f): f is { path: string; base: string; text: string } => !!f.base)
    .sort((a, b) => a.path.localeCompare(b.path));

  if (!backupPath && mdFiles.length === 0) {
    throw new Error(`没有找到 CAD Learn 的备份或笔记（应包含 ${BACKUP_NAME} 或 ${folder}/Notes/*.md）`);
  }

  const notes = { ...state.notes };
  const exportState = { ...state.exportState };
  // 用合并后的数据生成“本地当前应导出的内容”，用来判断哪边改过
  const current = buildExportPlan({
    notes: Object.values(notes),
    starred: Object.values(state.starred),
    articles: ctx.articles,
    settings: ctx.settings,
    exported: exportState,
    incremental: false,
    now,
  });
  const keyByName = new Map<string, string>();
  for (const [key, rec] of Object.entries(exportState)) {
    if (key.startsWith('note:')) keyByName.set(rec.name.toLowerCase(), key);
  }
  const articleByUrl = new Map([...ctx.articles.values()].map((a) => [a.url, a]));
  const usedNames = new Set(Object.values(exportState).map((r) => r.name.toLowerCase()));
  const seen = new Set<string>();
  const result: ImportPlan = {
    notes,
    starred: state.starred,
    exportState,
    aiPaths: state.aiPaths,
    progress: state.progress,
    backup,
    updated: [],
    added: [],
    conflicts: [],
    unchanged: 0,
  };

  for (const f of mdFiles) {
    const md = parseNoteMarkdown(f.text, f.base);
    let id = md.id && !seen.has(md.id) ? md.id : undefined;
    if (!id && !md.id) {
      const key = keyByName.get(f.base.toLowerCase());
      if (key && !seen.has(key.slice(5))) id = key.slice(5);
    }
    const existing = id ? notes[id] : undefined;

    if (existing && id) {
      seen.add(id);
      const key = `note:${id}`;
      const gen = current.entries.get(key)!.content;
      const topicTag = topicTagOf(existing.articleId, ctx.articles, state.starred);
      const incoming = fieldsOf(md, topicTag);
      if (sameFields(incoming, fieldsOf(parseNoteMarkdown(gen, f.base), topicTag))) {
        result.unchanged++;
        continue;
      }
      const exportedHash = exportState[key]?.hash;
      if (hashString(gen) === exportedHash) {
        // 本地自上次导出没改过：采用 Obsidian 的修改
        notes[id] = { ...existing, ...incoming, updated: now.getTime() };
        result.updated.push(incoming.title);
      } else if (hashString(f.text) === exportedHash) {
        // 文件就是上次导出的旧版本，本地之后又改过：保留本地
        result.unchanged++;
      } else {
        const copy: Note = {
          ...existing,
          ...incoming,
          id: newId(),
          title: `${incoming.title}（Obsidian 版本）`,
          created: now.getTime(),
          updated: now.getTime(),
        };
        notes[copy.id] = copy;
        result.conflicts.push(incoming.title);
      }
      continue;
    }

    // 本地没有：Obsidian 里新建的笔记，或在新设备上恢复
    const nid = id && /^[a-z0-9]{4,40}$/i.test(id) ? id : newId();
    seen.add(nid);
    const linked = md.url ? articleByUrl.get(md.url) : undefined;
    const created = md.created ?? now.getTime();
    notes[nid] = {
      id: nid,
      ...fieldsOf(md, linked ? TOPIC_TAG[linked.topic] : undefined),
      ...(linked ? { articleId: linked.id } : {}),
      created,
      updated: now.getTime(),
    };
    // 沿用原文件名，下次导出覆盖这个文件而不是另建一个
    if (!usedNames.has(f.base.toLowerCase())) {
      usedNames.add(f.base.toLowerCase());
      exportState[`note:${nid}`] = { name: f.base, hash: '' };
    }
    result.added.push(notes[nid].title);
  }
  return result;
}

/** 合并备份：笔记按更新时间较新者优先；收藏、AI 学习路线只补本地没有的；导出记录、学习进度本地优先 */
export function mergeBackup(
  local: LocalState,
  json: string,
): { state: LocalState; counts: { notes: number; starred: number; paths: number } } {
  let data: {
    version?: number;
    notes?: Note[];
    starred?: Starred[];
    exportState?: ExportState;
    aiPaths?: Record<string, LearningPath>;
    progress?: Record<string, ProgressState>;
  };
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.notes)) throw new Error('不是 CAD Learn 的备份文件');
  const notes = { ...local.notes };
  let nc = 0;
  for (const note of data.notes) {
    if (!note?.id) continue;
    if (!notes[note.id] || notes[note.id].updated < note.updated) {
      notes[note.id] = note;
      nc++;
    }
  }
  const starred = { ...local.starred };
  let sc = 0;
  for (const st of data.starred ?? []) {
    if (st?.article?.id && !starred[st.article.id]) {
      starred[st.article.id] = st;
      sc++;
    }
  }
  const exportState = { ...(data.exportState ?? {}), ...local.exportState };
  const aiPaths = { ...(local.aiPaths ?? {}) };
  let pc = 0;
  for (const [id, p] of Object.entries(data.aiPaths ?? {})) {
    if (p?.id === id && Array.isArray(p.resources) && !aiPaths[id]) {
      aiPaths[id] = p;
      pc++;
    }
  }
  const progress = { ...(data.progress ?? {}), ...(local.progress ?? {}) };
  return { state: { notes, starred, exportState, aiPaths, progress }, counts: { notes: nc, starred: sc, paths: pc } };
}

// ---------------- Markdown 解析 ----------------

export interface ParsedNote {
  id?: string;
  title: string;
  body: string;
  tags: string[];
  url?: string;
  created?: number;
}

/** 解析导出的笔记（也兼容 Obsidian 里手写的笔记）。标题优先取正文第一行的 # 标题 */
export function parseNoteMarkdown(text: string, fileBase: string): ParsedNote {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fm: Record<string, string | string[]> = {};
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end > 0) {
      fm = parseFrontmatter(lines.slice(1, end));
      lines = lines.slice(end + 1);
    }
  }
  const skipBlank = () => {
    while (lines.length && !lines[0].trim()) lines.shift();
  };
  skipBlank();
  let title = str(fm.title) || fileBase;
  const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(lines[0] ?? '');
  if (h1) {
    title = h1[1];
    lines.shift();
    skipBlank();
  }
  if (lines[0]?.startsWith('> 关联文章：')) {
    lines.shift();
    skipBlank();
  }
  const rawTags = fm.tags ?? fm.tag ?? [];
  const tags = (Array.isArray(rawTags) ? rawTags : rawTags.split(/[,\s]+/))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
  const created = str(fm.created) ? Date.parse(str(fm.created)!) : NaN;
  return {
    id: str(fm['cad-learn-id']) || undefined,
    title: title.trim(),
    body: lines.join('\n').trim(),
    tags,
    url: str(fm.url) || undefined,
    created: Number.isNaN(created) ? undefined : created,
  };
}

function parseFrontmatter(lines: string[]): Record<string, string | string[]> {
  const fm: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push(unquote(item[1]));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, val] = kv;
    list = null;
    if (val === '') {
      fm[key] = list = [];
    } else if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else {
      fm[key] = unquote(val);
    }
  }
  return fm;
}

function unquote(v: string): string {
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 笔记中可由 Obsidian 修改的字段（去掉导出时自动加的标签） */
function fieldsOf(p: ParsedNote, topicTag?: string): Pick<Note, 'title' | 'body' | 'tags'> {
  return {
    title: p.title,
    body: p.body,
    tags: p.tags.filter((t) => t !== 'cad-learn/note' && t !== topicTag),
  };
}

function sameFields(a: Pick<Note, 'title' | 'body' | 'tags'>, b: Pick<Note, 'title' | 'body' | 'tags'>): boolean {
  return a.title === b.title && a.body === b.body && a.tags.join('\n') === b.tags.join('\n');
}

function topicTagOf(articleId: string | undefined, articles: Map<string, Article>, starred: Record<string, Starred>) {
  if (!articleId) return undefined;
  const a = articles.get(articleId) ?? starred[articleId]?.article;
  return a ? TOPIC_TAG[a.topic] : undefined;
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
