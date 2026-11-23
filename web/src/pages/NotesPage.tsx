import { signal } from '@preact/signals';
import { articleMap, createNote, notes } from '../store';
import { navigate, relTime } from '../util';

const query = signal('');

export function NotesPage() {
  const q = query.value.trim().toLowerCase();
  const list = Object.values(notes.value)
    .filter((n) => !q || [n.title, n.body, n.tags.join(' ')].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated);

  return (
    <>
      <header class="topbar">
        <h1>笔记</h1>
        <button
          class="btn primary small"
          onClick={() => {
            const n = createNote();
            navigate(`#/n/${n.id}`);
          }}
        >
          + 新建
        </button>
      </header>
      <div class="filters">
        <input
          class="search"
          type="search"
          placeholder="搜索笔记…"
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
      </div>
      {list.length === 0 && (
        <div class="empty">
          <p>{q ? '没有匹配的笔记。' : '还没有笔记。在文章页点「写笔记」，或点右上角新建。'}</p>
        </div>
      )}
      <ul class="cards">
        {list.map((n) => {
          const a = n.articleId ? articleMap.value.get(n.articleId) : undefined;
          const preview = n.body.replace(/^>.*$/gm, '').replace(/[#*`>\-[\]]/g, '').replace(/\s+/g, ' ').trim();
          return (
            <li key={n.id}>
              <a class="card" href={`#/n/${n.id}`}>
                <div class="card-title">{n.title || '未命名笔记'}</div>
                <div class="meta">
                  <span>{relTime(n.updated)}</span>
                  {a && <span>📎 {a.source}</span>}
                  {n.tags.map((t) => (
                    <span class="tag">#{t}</span>
                  ))}
                </div>
                {preview && <p class="card-summary">{preview}</p>}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
