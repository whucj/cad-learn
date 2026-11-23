import { signal } from '@preact/signals';
import { ArticlePage } from './pages/ArticlePage';
import { ListPage } from './pages/ListPage';
import { NoteEditor } from './pages/NoteEditor';
import { NotesPage } from './pages/NotesPage';
import { SettingsPage } from './pages/SettingsPage';

export const route = signal(location.hash);
addEventListener('hashchange', () => {
  route.value = location.hash;
});

function parse(hash: string): { name: string; id?: string } {
  const [, name = '', id] = hash.replace(/^#\/?/, '').match(/^([^/]*)\/?(.*)$/) ?? [];
  return { name, id: id ? decodeURIComponent(id) : undefined };
}

export function App() {
  const { name, id } = parse(route.value);
  let page;
  let tab: 'feed' | 'notes' | 'settings' = 'feed';
  switch (name) {
    case 'a':
      page = <ArticlePage key={id} id={id!} />;
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
  return (
    <>
      <main class="page">{page}</main>
      <nav class="tabbar" aria-label="主导航">
        <a href="#/" class={tab === 'feed' ? 'active' : ''}>
          <span class="tab-icon" aria-hidden="true">◫</span>资讯
        </a>
        <a href="#/notes" class={tab === 'notes' ? 'active' : ''}>
          <span class="tab-icon" aria-hidden="true">✎</span>笔记
        </a>
        <a href="#/settings" class={tab === 'settings' ? 'active' : ''}>
          <span class="tab-icon" aria-hidden="true">⚙</span>设置
        </a>
      </nav>
    </>
  );
}
