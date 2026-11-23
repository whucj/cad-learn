import { createNote, deleteAiPath, allPaths, notes, progress, progressKey, setProgress } from '../store';
import { genPrefill } from './GeneratePage';
import type { LearningPath, LearningResource, ProgressState } from '../types';
import { safeHref } from '../url';
import { navigate, relTime } from '../util';
import { pathStats } from './LearnPage';

const STATES: [ProgressState | null, string][] = [
  [null, '未开始'],
  ['doing', '进行中'],
  ['done', '已完成'],
];

export function PathPage({ id }: { id: string }) {
  const p = allPaths.value.find((x) => x.id === id);
  if (!p) {
    return (
      <>
        <Back />
        <p class="muted center">找不到这条学习路线。</p>
      </>
    );
  }
  const s = pathStats(p);
  const byName = new Map(p.resources.map((r, i) => [r.name, i]));

  return (
    <>
      <Back />
      <article class="article">
        <h1>
          {p.title}
          <span class={p.source === 'ai' ? 'badge ai' : 'badge'}>{p.source === 'ai' ? 'AI 生成' : '精选'}</span>
        </h1>
        {p.intro && <p>{p.intro}</p>}
        {p.source === 'ai' && (
          <p class="notice small">
            AI 生成的推荐，书名、作者和链接请自行核实。
            {p.model && ` 模型 ${p.model}`}
            {p.createdAt && ` · ${relTime(p.createdAt)}`}
            {p.costUsd != null && ` · 约 $${p.costUsd.toFixed(4)}`}
            {p.background && (
              <>
                <br />
                背景：{p.background}
              </>
            )}
          </p>
        )}
        <div class="progress">
          <div class="progress-bar" style={{ width: `${(s.done / s.total) * 100}%` }} />
        </div>
        <p class="muted small">
          已完成 {s.done}/{s.total}
          {s.doing > 0 && ` · 进行中 ${s.doing}`}
        </p>

        <section class="panel">
          <h2>推荐使用顺序</h2>
          <ol class="order">
            {p.order.map((o) => {
              const st = progress.value[progressKey(p.id, o.name)];
              return (
                <li class={st ? `st-${st}` : ''}>
                  <button class="linklike" onClick={() => document.getElementById(`res-${byName.get(o.name)}`)?.scrollIntoView({ behavior: 'smooth' })}>
                    {st === 'done' ? '✓ ' : st === 'doing' ? '◐ ' : ''}
                    {o.name}
                  </button>
                  {o.reason && <div class="muted small">{o.reason}</div>}
                </li>
              );
            })}
          </ol>
        </section>

        {p.resources.map((r, i) => (
          <ResourceCard p={p} r={r} index={i} />
        ))}

        {p.source === 'ai' && (
          <div class="actions">
            <button
              class="btn"
              onClick={() => {
                genPrefill.value = { topic: p.title, background: p.background, replaceId: p.id };
                navigate('#/gen');
              }}
            >
              重新生成
            </button>
            <button
              class="btn danger"
              onClick={() => {
                if (confirm(`删除学习路线「${p.title}」？相关笔记不受影响。`)) {
                  deleteAiPath(p.id);
                  navigate('#/learn');
                }
              }}
            >
              删除
            </button>
          </div>
        )}
      </article>
    </>
  );
}

function ResourceCard({ p, r, index }: { p: LearningPath; r: LearningResource; index: number }) {
  const key = progressKey(p.id, r.name);
  const st = progress.value[key] ?? null;
  const href = safeHref(r.url);
  const note = Object.values(notes.value).find((n) => n.ref === key);

  function openNote() {
    if (note) return navigate(`#/n/${note.id}`);
    const n = createNote({
      title: `学习：${r.name}`,
      body: `> 学习路线「${p.title}」第 ${index + 1} 个资源${href ? ` · [链接](${href})` : ''}\n> 高效用法：${r.howTo}\n\n## 我的笔记\n\n`,
      tags: ['学习路线', p.title],
      ref: key,
    });
    if (!st) setProgress(p.id, r.name, 'doing');
    navigate(`#/n/${n.id}`);
  }

  return (
    <section class={`panel resource st-${st ?? 'todo'}`} id={`res-${index}`}>
      <h2>
        {index + 1}. {r.name}
      </h2>
      <div class="meta">
        <span>{r.type}</span>
        <span class={`badge level-${r.level}`}>{r.level}</span>
      </div>
      <dl class="fields">
        <dt>为什么值得花时间</dt>
        <dd>{r.why}</dd>
        <dt>能帮我学会</dt>
        <dd>{r.teaches}</dd>
        <dt>最适合</dt>
        <dd>{r.bestFor}</dd>
        <dt>高效用法</dt>
        <dd>{r.howTo}</dd>
        <dt class="warn">别浪费时间在</dt>
        <dd class="warn">{r.avoid}</dd>
      </dl>
      <div class="segmented small" role="radiogroup" aria-label="学习进度">
        {STATES.map(([v, label]) => (
          <button role="radio" aria-checked={st === v} class={st === v ? 'on' : ''} onClick={() => setProgress(p.id, r.name, v)}>
            {label}
          </button>
        ))}
      </div>
      <div class="actions">
        {href && (
          <a class="btn primary small" href={href} target="_blank" rel="noopener noreferrer">
            打开 ↗
          </a>
        )}
        <button class="btn small" onClick={openNote}>
          {note ? '✎ 打开笔记' : '✎ 写笔记'}
        </button>
      </div>
    </section>
  );
}

function Back() {
  return (
    <header class="topbar">
      <button class="back" onClick={() => (history.length > 1 ? history.back() : navigate('#/learn'))} aria-label="返回">
        ‹ 返回
      </button>
    </header>
  );
}
