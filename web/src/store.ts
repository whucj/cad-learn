import { computed, signal } from '@preact/signals';
import { get, set } from 'idb-keyval';
import type { ExportPlan, ExportState } from './export';
import type { ImportPlan } from './import';
import { BUILTIN_PATHS } from './curated';
import type { Article, LatestData, LearningPath, Note, ProgressState, Settings, Starred, StatusData, UsageData } from './types';

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
/** AI 生成的学习路线（内置路线见 curated.ts） */
export const aiPaths = signal<Record<string, LearningPath>>({});
/** 学习进度，key：`<路线 id>::<资源名称>` */
export const progress = signal<Record<string, ProgressState>>({});
/** DeepSeek API Key：只存本机，不进备份和导出 */
export const aiKey = signal('');
export const localReady = signal(false);

/** 全局轻提示 */
export const toast = signal<{ text: string; action?: { label: string; run: () => void } } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(text: string, action?: { label: string; run: () => void }, ms = 4000) {
  toast.value = { text, action };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), ms);
}

export const allPaths = computed(() => [
  ...BUILTIN_PATHS,
  ...Object.values(aiPaths.value).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
]);

export const progressKey = (pathId: string, name: string) => `${pathId}::${name}`;

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
  const [r, s, n, st, ex, ap, pg, key] = await Promise.all([
    load<Record<string, number>>('readIds'),
    load<Record<string, Starred>>('starred'),
    load<Record<string, Note>>('notes'),
    load<Settings>('settings'),
    load<ExportState>('exportState'),
    load<Record<string, LearningPath>>('aiPaths'),
    load<Record<string, ProgressState>>('progress'),
    load<string>('aiKey'),
  ]);
  if (ap) aiPaths.value = ap;
  if (pg) progress.value = pg;
  if (key) aiKey.value = key;
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

export const lastLoadAt = signal(0);
export const refreshing = signal(false);

/** 加载最新数据；返回新增文章数（首次加载或失败时为 0） */
export async function loadRemote(): Promise<number> {
  refreshing.value = true;
  const before = new Set((latest.value?.articles ?? []).map((a) => a.id));
  let added = 0;
  try {
    const data = await fetchJson<LatestData>('./data/latest.json');
    if (before.size) added = data.articles.filter((a) => !before.has(a.id)).length;
    latest.value = data;
    loadError.value = null;
    lastLoadAt.value = Date.now();
    refreshStarredSnapshots();
  } catch (e) {
    // 已有数据时（例如离线）不打断阅读，只在首次加载失败时显示错误
    if (!latest.value) loadError.value = `加载数据失败：${(e as Error).message}`;
    else showToast('刷新失败，显示的是之前的数据');
  } finally {
    refreshing.value = false;
  }
  // 状态和用量不影响阅读，失败忽略
  fetchJson<StatusData>('./data/status.json').then((v) => (status.value = v), () => {});
  fetchJson<UsageData>('./data/usage.json').then((v) => (usage.value = v), () => {});
  return added;
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

/** 文章的笔记：已有则返回，没有则新建（带 AI 摘要） */
export function ensureArticleNote(a: Article): Note {
  const existing = noteForArticle(a.id);
  if (existing) return existing;
  const body = a.ai ? `> [!summary] AI 摘要\n> ${a.ai.summary}\n\n## 我的笔记\n\n` : `## 我的笔记\n\n`;
  return createNote({ title: a.title, body, articleId: a.id, tags: [] });
}

export function noteForArticle(articleId: string): Note | undefined {
  return Object.values(notes.value).find((n) => n.articleId === articleId);
}

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  persist('settings', settings.value);
}

/** 应用导入预览（import.ts 的 planImport 结果）：整体替换笔记、收藏和导出记录 */
export function applyImport(plan: ImportPlan) {
  if (plan.aiPaths) {
    aiPaths.value = plan.aiPaths;
    persist('aiPaths', plan.aiPaths);
  }
  if (plan.progress) {
    progress.value = plan.progress;
    persist('progress', plan.progress);
  }
  notes.value = plan.notes;
  starred.value = plan.starred;
  exportState.value = plan.exportState;
  persist('notes', plan.notes);
  persist('starred', plan.starred);
  persist('exportState', plan.exportState);
  requestPersistentStorage();
}

// ---------- 学习路线 ----------

export function setProgress(pathId: string, name: string, state: ProgressState | null) {
  const next = { ...progress.value };
  const k = progressKey(pathId, name);
  if (state) next[k] = state;
  else delete next[k];
  progress.value = next;
  persist('progress', next);
}

export function saveAiPath(p: LearningPath) {
  const next = { ...aiPaths.value, [p.id]: p };
  aiPaths.value = next;
  persist('aiPaths', next);
  requestPersistentStorage();
}

export function deleteAiPath(id: string) {
  const next = { ...aiPaths.value };
  delete next[id];
  aiPaths.value = next;
  persist('aiPaths', next);
}

export function setAiKey(key: string) {
  aiKey.value = key.trim();
  persist('aiKey', aiKey.value);
}

/** 记录本机 AI 调用花费（按月清零） */
export function addLocalAiCost(costUsd: number) {
  const month = new Date().toISOString().slice(0, 7);
  const cur = settings.value.localAi?.month === month ? settings.value.localAi : { month, calls: 0, costUsd: 0 };
  updateSettings({ localAi: { month, calls: cur.calls + 1, costUsd: cur.costUsd + costUsd } });
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let persistAsked = false;
/** 申请持久化存储，降低浏览器清理本地数据（笔记）的概率 */
function requestPersistentStorage() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

