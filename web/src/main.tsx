import { render } from 'preact';
import { App, route } from './app';
import { initPwa } from './pwa';
import { appendQuote, planShare, readShareParams } from './share';
import { articleMap, createNote, ensureArticleNote, initLocal, loadRemote, notes, saveNote, settings, showToast } from './store';
import './styles.css';

/** 安卓“分享”到本应用：见 share.ts。返回分享后要打开的页面 */
function handleShare(): string | null {
  const data = readShareParams(location.search);
  if (!data) return null;
  const action = planShare(data, articleMap.value.values(), Object.values(notes.value));
  switch (action.kind) {
    case 'article': {
      if (!action.quote) return `#/a/${action.article.id}`;
      const n = ensureArticleNote(action.article);
      saveNote({ ...n, body: appendQuote(notes.value[n.id].body, action.quote) });
      showToast('已摘录到这篇文章的笔记');
      return `#/n/${n.id}`;
    }
    case 'note':
      if (action.quote) {
        saveNote({ ...action.note, body: appendQuote(action.note.body, action.quote) });
        showToast('已摘录到已有笔记');
      }
      return `#/n/${action.note.id}`;
    default: {
      const n = createNote({ title: action.title, body: action.body, tags: ['待读'] });
      return `#/n/${n.id}`;
    }
  }
}

/** 阅读字号 */
function applyFontSize() {
  document.documentElement.dataset.font = settings.value.fontSize ?? 'md';
}

async function start() {
  await initLocal();
  applyFontSize();
  settings.subscribe(applyFontSize);
  initPwa();
  const shared = readShareParams(location.search) !== null;
  // 分享的链接可能对应已有文章：先加载数据再处理（离线时用缓存）
  const loading = loadRemote();
  if (shared) await loading;
  const target = handleShare();
  if (target) {
    // replaceState 不触发 hashchange，需同步路由；同时去掉 ?title=&text=&url=
    history.replaceState(null, '', `${location.pathname}${target}`);
    route.value = location.hash;
  }
  render(<App />, document.getElementById('app')!);
  await loading;
}

start();
