import { useEffect } from 'preact/hooks';
import { articleMap, createNote, latest, markRead, noteForArticle, readIds, starred, toggleStar } from '../store';
import { TOPIC_LABEL } from '../types';
import { arxivId, navigate, relTime, stars } from '../util';

export function ArticlePage({ id }: { id: string }) {
  const a = articleMap.value.get(id);

  useEffect(() => {
    if (a) markRead(a.id);
  }, [a?.id]);

  if (!a) {
    return (
      <>
        <BackBar />
        <p class="muted center">{latest.value ? '找不到这篇文章（可能已滚出最新列表）。' : '加载中…'}</p>
      </>
    );
  }

  const isStarred = !!starred.value[a.id];
  const existingNote = noteForArticle(a.id);
  const arxiv = arxivId(a.url);

  function openNote() {
    if (existingNote) return navigate(`#/n/${existingNote.id}`);
    const body = a!.ai
      ? `> [!summary] AI 摘要\n> ${a!.ai.summary}\n\n## 我的笔记\n\n`
      : `## 我的笔记\n\n`;
    const n = createNote({ title: a!.title, body, articleId: a!.id, tags: [] });
    navigate(`#/n/${n.id}`);
  }

  return (
    <>
      <BackBar />
      <article class="article">
        <h1>{a.title}</h1>
        <div class="meta">
          <span>{a.source}</span>
          {a.author && <span>{a.author}</span>}
          <span>{relTime(a.published ?? a.fetched)}</span>
          <span>{TOPIC_LABEL[a.topic]}</span>
        </div>

        <div class="actions">
          <a class="btn primary" href={a.url} target="_blank" rel="noopener noreferrer">
            阅读原文 ↗
          </a>
          <button class={isStarred ? 'btn on' : 'btn'} onClick={() => toggleStar(a)} aria-pressed={isStarred}>
            {isStarred ? '★ 已收藏' : '☆ 收藏'}
          </button>
          <button class="btn" onClick={openNote}>
            {existingNote ? '✎ 打开笔记' : '✎ 写笔记'}
          </button>
        </div>

        {arxiv && (
          <div class="actions">
            <a class="btn small" href={`https://arxiv.org/pdf/${arxiv}`} target="_blank" rel="noopener noreferrer">
              PDF
            </a>
            <a class="btn small" href={`https://arxiv.org/html/${arxiv}`} target="_blank" rel="noopener noreferrer">
              HTML 全文
            </a>
          </div>
        )}

        {a.ai ? (
          <section class="panel">
            <h2>
              AI 摘要
              <span class="stars" title={`相关度 ${a.ai.relevance}/5`}>
                {stars(a.ai.relevance)}
              </span>
              {a.ai.level && <span class="badge">{a.ai.level}</span>}
            </h2>
            <p>{a.ai.summary}</p>
            {a.ai.points.length > 0 && (
              <ul>
                {a.ai.points.map((p) => (
                  <li>{p}</li>
                ))}
              </ul>
            )}
            {a.ai.tags.length > 0 && (
              <div class="tags">
                {a.ai.tags.map((t) => (
                  <span class="tag">#{t}</span>
                ))}
              </div>
            )}
          </section>
        ) : (
          <p class="muted">暂无 AI 摘要。</p>
        )}

        {a.snippet && (
          <section>
            <h2>原文摘录</h2>
            <blockquote>{a.snippet}</blockquote>
          </section>
        )}

        <button class="btn ghost wide" onClick={() => markRead(a.id, !readIds.value[a.id])}>
          {readIds.value[a.id] ? '标为未读' : '标为已读'}
        </button>
      </article>
    </>
  );
}

function BackBar() {
  return (
    <header class="topbar">
      <button class="back" onClick={() => (history.length > 1 ? history.back() : navigate('#/'))} aria-label="返回">
        ‹ 返回
      </button>
    </header>
  );
}
