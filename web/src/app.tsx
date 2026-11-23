import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ArticlePage } from './pages/ArticlePage';
import { GeneratePage } from './pages/GeneratePage';
import { LearnPage } from './pages/LearnPage';
import { ListPage, showView } from './pages/ListPage';
import { NoteEditor } from './pages/NoteEditor';
import { NotesPage } from './pages/NotesPage';
import { PathPage } from './pages/PathPage';
import { SettingsPage } from './pages/SettingsPage';
import { online } from './pwa';
import { createNote, toast } from './store';

export const route = signal(location.hash);
addEventListener('hashchange', () => {
  route.value = location.hash;
});

function parse(hash: string): { name: string; id?: string } {
  const [, name = '', id] = hash.replace(/^#\/?/, '').match(/^([^/]*)\/?(.*)$/) ?? [];
  return { name, id: id ? decodeURIComponent(id) : undefined };
}

type Tab = 'feed' | 'learn' | 'notes' | 'settings';

export function App() {
  const { name, id } = parse(route.value);
  let page;
  let tab: Tab = 'feed';
  switch (name) {
    case 'a':
      page = <ArticlePage key={id} id={id!} />;
      break;
    case 'learn':
      page = id ? <PathPage key={id} id={id} /> : <LearnPage />;
      tab = 'learn';
      break;
    case 'gen':
      page = <GeneratePage />;
      tab = 'learn';
      break;
    case 'n-new': // 主屏幕图标长按快捷方式
      page = <Redirect to={() => `#/n/${createNote().id}`} />;
      break;
    case 'starred':
      page = <Redirect to={() => (showView('star'), '#/')} />;
      break;
    case 'notes':
      page = <NotesPage />;
      tab = 'notes';
      break;
    case 'n':
      page = <NoteEditor key={id} id={id!} />;
      tab = 'notes';
      break;
    case 'settings':
      page = <SettingsPage />;
      tab = 'settings';
      break;
    default:
      page = <ListPage />;
  }
  const tabs: [Tab, string, string, string][] = [
    ['feed', '#/', '◫', '资讯'],
    ['learn', '#/learn', '◈', '学习'],
    ['notes', '#/notes', '✎', '笔记'],
    ['settings', '#/settings', '⚙', '设置'],
  ];
  const t = toast.value;
  return (
    <>
      {!online.value && <div class="offline-bar">离线中 · 显示的是缓存内容，笔记照常保存</div>}
      <main class="page">{page}</main>
      {t && (
        <div class="toast" role="status">
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                toast.value = null;
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
      <nav class="tabbar" aria-label="主导航">
        {tabs.map(([key, href, icon, label]) => (
          <a href={href} class={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined}>
            <span class="tab-icon" aria-hidden="true">
              {icon}
            </span>
            {label}
          </a>
        ))}
      </nav>
    </>
  );
}

/** 快捷方式入口：执行一次动作后替换为目标页面（不留在历史记录里） */
function Redirect({ to }: { to: () => string }) {
  useEffect(() => {
    location.replace(to());
  }, []);
  return null;
}
