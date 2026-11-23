import { computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { latest, loadError, markAllRead, readIds, settings, starred } from '../store';
import { TOPIC_LABEL, type Article, type Topic } from '../types';
import { relTime, stars } from '../util';

type View = 'rec' | 'all' | 'star';

// 放在模块级：从文章页返回时保留筛选条件和滚动位置
const view = signal<View>('rec');
const topic = signal<Topic | null>(null);
const unreadOnly = signal(false);
const query = signal('');
const limit = signal(60);
let savedScroll = 0;

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const read = readIds.value;
  let list: Article[] =
    view.value === 'star'
      ? Object.values(starred.value)
          .sort((a, b) => b.starredAt - a.starredAt)
          .map((s) => s.article)
      : latest.value?.articles ?? [];
  if (view.value === 'rec') list = list.filter((a) => (a.ai?.relevance ?? 0) >= settings.value.minRelevance);
  if (topic.value) list = list.filter((a) => a.topic === topic.value);
  if (unreadOnly.value) list = list.filter((a) => !read[a.id]);
  if (q) {
    list = list.filter((a) =>
      [a.title, a.source, a.snippet, a.ai?.summary, a.ai?.tags.join(' ')].some((s) => s?.toLowerCase().includes(q)),
    );
  }
  return list;
});

export function ListPage() {
  useEffect(() => {
    const y = savedScroll;
    requestAnimationFrame(() => scrollTo(0, y));
  }, []);

  const data = latest.value;
  const list = filtered.value;
  const shown = list.slice(0, limit.value);
  const read = readIds.value;
  const unsummarized = view.value === 'rec' ? (data?.articles ?? []).filter((a) => !a.ai).length : 0;

  return (
    <>
      <header class="topbar">
        <h1>CAD Learn</h1>
        <span class="muted small">{data ? `更新于 ${relTime(data.generatedAt)}` : ''}</span>
      </header>

      <div class="filters">
        <div class="segmented" role="tablist">
          {(
            [
              ['rec', '推荐'],
              ['all', '全部'],
              ['star', '收藏'],
            ] as const
          ).map(([v, label]) => (
            <button
              role="tab"
              aria-selected={view.value === v}
              class={view.value === v ? 'on' : ''}
              onClick={() => {
                view.value = v;
                limit.value = 60;
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="chips">
          <button class={topic.value === null ? 'chip on' : 'chip'} onClick={() => (topic.value = null)}>
            全部主题
          </button>
          {(Object.keys(TOPIC_LABEL) as Topic[]).map((t) => (
            <button class={topic.value === t ? 'chip on' : 'chip'} onClick={() => (topic.value = t)}>
              {TOPIC_LABEL[t]}
            </button>
          ))}
          <button class={unreadOnly.value ? 'chip on' : 'chip'} onClick={() => (unreadOnly.value = !unreadOnly.value)}>
            只看未读
          </button>
        </div>
        <input
          class="search"
          type="search"
          placeholder="搜索标题、摘要、标签…"
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
      </div>

      {loadError.value && <p class="error">{loadError.value}</p>}
      {!data && !loadError.value && <p class="muted center">加载中…</p>}

      {data && list.length === 0 && (
        <div class="empty">
          {view.value === 'rec' ? (
            <p>
              没有相关度 ≥ {settings.value.minRelevance} 的文章。
              {unsummarized > 0 && <> 还有 {unsummarized} 篇尚未生成 AI 摘要（需配置 DeepSeek Key），可先看「全部」。</>}
            </p>
          ) : view.value === 'star' ? (
            <p>还没有收藏。在文章页点 ☆ 收藏。</p>
          ) : (
            <p>没有匹配的文章。</p>
          )}
        </div>
      )}

      <ul class="cards">
        {shown.map((a) => (
          <li key={a.id}>
            <a
              href={`#/a/${a.id}`}
              class={read[a.id] ? 'card read' : 'card'}
              onClick={() => (savedScroll = scrollY)}
            >
              <div class="card-title">{a.title}</div>
              <div class="meta">
                <span>{a.source}</span>
                <span>{relTime(a.published ?? a.fetched)}</span>
                {a.ai?.level && <span class="badge">{a.ai.level}</span>}
                {a.ai && (
                  <span class="stars" title={`相关度 ${a.ai.relevance}/5`}>
                    {stars(a.ai.relevance)}
                  </span>
                )}
                {starred.value[a.id] && <span class="star-on">★ 已收藏</span>}
              </div>
              {(a.ai?.summary || a.snippet) && <p class="card-summary">{a.ai?.summary ?? a.snippet}</p>}
              {a.ai && a.ai.tags.length > 0 && (
                <div class="tags">
                  {a.ai.tags.map((t) => (
                    <span class="tag">#{t}</span>
                  ))}
                </div>
              )}
            </a>
          </li>
        ))}
      </ul>

      {list.length > shown.length && (
        <button class="btn wide" onClick={() => (limit.value += 60)}>
          加载更多（还有 {list.length - shown.length} 篇）
        </button>
      )}
      {shown.length > 0 && view.value !== 'star' && (
        <button class="btn wide ghost" onClick={() => markAllRead(list.map((a) => a.id))}>
          当前列表全部标为已读
        </button>
      )}
    </>
  );
}
