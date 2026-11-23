import { allPaths, progress, progressKey } from '../store';
import type { LearningPath } from '../types';
import { navigate } from '../util';

export function pathStats(p: LearningPath) {
  const st = p.resources.map((r) => progress.value[progressKey(p.id, r.name)]);
  return { done: st.filter((s) => s === 'done').length, doing: st.filter((s) => s === 'doing').length, total: p.resources.length };
}

export function LearnPage() {
  return (
    <>
      <header class="topbar">
        <h1>学习路线</h1>
        <button class="btn primary small" onClick={() => navigate('#/gen')}>
          + AI 生成
        </button>
      </header>
      <p class="muted small intro-text">
        每个主题精选学习杠杆最高的 5 个资源：为什么值得学、学会什么、适合谁、怎么高效使用、别在哪浪费时间，以及最佳使用顺序。
      </p>
      <ul class="cards">
        {allPaths.value.map((p) => {
          const s = pathStats(p);
          return (
            <li key={p.id}>
              <a class="card" href={`#/learn/${encodeURIComponent(p.id)}`}>
                <div class="card-title">
                  {p.title}
                  <span class={p.source === 'ai' ? 'badge ai' : 'badge'}>{p.source === 'ai' ? 'AI 生成' : '精选'}</span>
                </div>
                {p.intro && <p class="card-summary">{p.intro}</p>}
                <div class="progress" aria-label={`已完成 ${s.done}/${s.total}`}>
                  <div class="progress-bar" style={{ width: `${(s.done / s.total) * 100}%` }} />
                </div>
                <div class="meta">
                  <span>
                    已完成 {s.done}/{s.total}
                  </span>
                  {s.doing > 0 && <span>进行中 {s.doing}</span>}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
