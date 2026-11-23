import { computed, signal } from '@preact/signals';
import { get, set } from 'idb-keyval';
import type { ExportPlan, ExportState } from './export';
import type { Article, LatestData, Note, Settings, Starred, StatusData, UsageData } from './types';

/** ---------- 远程数据（采集器生成的静态 JSON） ---------- */
export const latest = signal<LatestData | null>(null);
export const status = signal<StatusData | null>(null);
export const usage = signal<UsageData | null>(null);
export const loadError = signal<string | null>(null);

/** ---------- 本地数据（IndexedDB，只在当前浏览器） ---------- */
export const readIds = signal<Record<string, number>>({});
export const starred = signal<Record<string, Starred>>({});
export const notes = signal<Record<string, Note>>({});
export const settings = signal<Settings>({ minRelevance: 3, exportFolder: 'CADLearn' });
/** 已确认导出到 Obsidian 的文件记录（文件名 + 内容哈希） */
export const exportState = signal<ExportState>({});
export const localReady = signal(false);

/** 所有可查到的文章：latest.json + 收藏快照 */
export const articleMap = computed(() => {
  const m = new Map<string, Article>();
  for (const s of Object.values(starred.value)) m.set(s.article.id, s.article);
  for (const a of latest.value?.articles ?? []) m.set(a.id, a);
  return m;
});

async function persist(key: string, value: unknown) {
  try {
    await set(key, value);
  } catch (e) {
    console.warn('保存到 IndexedDB 失败', key, e);
  }
}

async function load<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key);
  } catch {
    return undefined;
  }
}

export async function initLocal() {
  const [r, s, n, st, ex] = await Promise.all([
    load<Record<string, number>>('readIds'),
    load<Record<string, Starred>>('starred'),
    load<Record<string, Note>>('notes'),
    load<Settings>('settings'),
    load<ExportState>('exportState'),
  ]);
  if (r) readIds.value = r;
  if (s) starred.value = s;
  if (n) notes.value = n;
  if (st) settings.value = { ...settings.value, ...st };
  if (ex) exportState.value = ex;
  localReady.value = true;
}

async function fetchJson<T>(path: string): Promise<T> {
  const resp = await fetch(path, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

export async function loadRemote() {
  try {
    latest.value = await fetchJson<LatestData>('./data/latest.json');
    loadError.value = null;
    refreshStarredSnapshots();
  } catch (e) {
    loadError.value = `加载数据失败：${(e as Error).message}`;
  }
  // 状态和用量不影响阅读，失败忽略
  fetchJson<StatusData>('./data/status.json').then((v) => (status.value = v), () => {});
  fetchJson<UsageData>('./data/usage.json').then((v) => (usage.value = v), () => {});
}

/** 收藏快照跟随最新数据更新（例如收藏后才生成的 AI 摘要） */
function refreshStarredSnapshots() {
  const fresh = new Map((latest.value?.articles ?? []).map((a) => [a.id, a]));
  let changed = false;
  const next = { ...starred.value };
  for (const [id, s] of Object.entries(next)) {
    const a = fresh.get(id);
    if (a && JSON.stringify(a) !== JSON.stringify(s.article)) {
      next[id] = { ...s, article: a };
      changed = true;
    }
  }
  if (changed) {
    starred.value = next;
    persist('starred', next);
  }
}

/** 用户确认 zip 已放入 Obsidian 后调用：保存文件名与内容哈希，下次增量导出以此为准 */
export function confirmExport(plan: ExportPlan) {
  exportState.value = plan.nextState;
  persist('exportState', plan.nextState);
  updateSettings({ lastExportAt: plan.exportedAt });
}

export function markRead(id: string, read = true) {
  const next = { ...readIds.value };
  if (read) {
    if (next[id]) return;
    next[id] = Date.now();
  } else {
    delete next[id];
  }
  readIds.value = next;
  persist('readIds', next);
}

export function markAllRead(ids: string[]) {
  const now = Date.now();
  const next = { ...readIds.value };
  for (const id of ids) next[id] ??= now;
  readIds.value = next;
  persist('readIds', next);
}

export function toggleStar(a: Article) {
  const next = { ...starred.value };
  if (next[a.id]) delete next[a.id];
  else next[a.id] = { article: a, starredAt: Date.now() };
  starred.value = next;
  persist('starred', next);
  requestPersistentStorage();
}

export function saveNote(n: Note) {
  const next = { ...notes.value, [n.id]: { ...n, updated: Date.now() } };
  notes.value = next;
  persist('notes', next);
  requestPersistentStorage();
}

export function deleteNote(id: string) {
  const next = { ...notes.value };
  delete next[id];
  notes.value = next;
  persist('notes', next);
}

export function createNote(init: Partial<Note> = {}): Note {
  const now = Date.now();
  const n: Note = { id: newId(), title: '', body: '', tags: [], created: now, updated: now, ...init };
  saveNote(n);
  return n;
}

export function noteForArticle(articleId: string): Note | undefined {
  return Object.values(notes.value).find((n) => n.articleId === articleId);
}

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  persist('settings', settings.value);
}

/** 从导出的 cad-learn-backup.json 恢复：按“更新时间较新者优先”合并，不会删除本地已有内容 */
export function importBackup(json: string): { notes: number; starred: number } {
  const data = JSON.parse(json) as {
    version?: number;
    notes?: Note[];
    starred?: Starred[];
    settings?: Settings;
    exportState?: ExportState;
  };
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.notes)) throw new Error('不是 CAD Learn 的备份文件');
  const n = { ...notes.value };
  let nc = 0;
  for (const note of data.notes) {
    if (!n[note.id] || n[note.id].updated < note.updated) {
      n[note.id] = note;
      nc++;
    }
  }
  const s = { ...starred.value };
  let sc = 0;
  for (const st of data.starred ?? []) {
    if (!s[st.article.id]) {
      s[st.article.id] = st;
      sc++;
    }
  }
  // 导出记录：补上本地没有的条目，保证换设备后导出的文件名与 Obsidian 里已有的一致
  const ex = { ...(data.exportState ?? {}), ...exportState.value };
  notes.value = n;
  starred.value = s;
  exportState.value = ex;
  persist('notes', n);
  persist('starred', s);
  persist('exportState', ex);
  return { notes: nc, starred: sc };
}

let persistAsked = false;
/** 申请持久化存储，降低浏览器清理本地数据（笔记）的概率 */
function requestPersistentStorage() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
