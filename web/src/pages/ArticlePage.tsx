import { useEffect } from 'preact/hooks';
import { shareOrCopy } from '../pwa';
import { articleMap, ensureArticleNote, latest, markRead, noteForArticle, readIds, starred, toggleStar } from '../store';
import { TOPIC_LABEL } from '../types';
import { safeHref } from '../url';
import { arxivId, navigate, relTime, stars, viaLabel } from '../util';

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
  const href = safeHref(a.url);
  const arxiv = href && arxivId(href);
  const viaHref = safeHref(a.via?.url);

  function openNote() {
    navigate(`#/n/${ensureArticleNote(a!).id}`);
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
          {a.via &&
            (viaHref ? (
              <a href={viaHref} target="_blank" rel="noopener noreferrer">
                收录于{viaLabel(a.via.title)} ↗
              </a>
            ) : (
              <span>收录于{viaLabel(a.via.title)}</span>
            ))}
        </div>

        <div class="actions">
          {href ? (
            <a class="btn primary" href={href} target="_blank" rel="noopener noreferrer">
              阅读原文 ↗
            </a>
          ) : (
            <button class="btn" disabled title="原文链接不是安全的 http(s) 地址">
              原文链接无效
            </button>
          )}
          <button class={isStarred ? 'btn on' : 'btn'} onClick={() => toggleStar(a)} aria-pressed={isStarred}>
            {isStarred ? '★ 已收藏' : '☆ 收藏'}
          </button>
          <button class="btn" onClick={openNote}>
            {existingNote ? '✎ 打开笔记' : '✎ 写笔记'}
          </button>
          {href && (
            <button class="btn" onClick={() => shareOrCopy({ title: a.title, text: a.ai?.summary, url: href })} aria-label="分享">
              ⤴ 分享
            </button>
          )}
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
            <h2>{a.via ? '编辑推荐语' : '原文摘录'}</h2>
            <blockquote class="snippet">{a.snippet}</blockquote>
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
