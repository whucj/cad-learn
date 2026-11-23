import { render } from 'preact';
import { App, route } from './app';
import { createNote, initLocal, loadRemote } from './store';
import './styles.css';

/**
 * 安卓“分享”到本应用（PWA share_target）：manifest 中配置为 GET ./?title=&text=&url=
 * 很多 App 把链接放在 text 里，这里统一提取，生成一条“待读”笔记。
 */
function handleShare(): boolean {
  const q = new URLSearchParams(location.search);
  if (!q.has('title') && !q.has('text') && !q.has('url')) return false;
  const text = q.get('text') ?? '';
  const url = q.get('url') || /https?:\/\/\S+/.exec(text)?.[0] || '';
  const title = q.get('title') || text.replace(url, '').trim() || url || '分享的链接';
  const note = createNote({
    title: `待读：${title}`.slice(0, 120),
    body: `${url ? `<${url}>\n\n` : ''}${text && text !== url ? `> ${text}\n\n` : ''}`,
    tags: ['待读'],
  });
  history.replaceState(null, '', `${location.pathname}#/n/${note.id}`);
  return true;
}

async function start() {
  await initLocal();
  // 分享处理会改写地址（replaceState 不触发 hashchange），需同步路由
  if (handleShare()) route.value = location.hash;
  render(<App />, document.getElementById('app')!);
  await loadRemote();
}

start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker 注册失败', e));
}
