import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { AiError, DEFAULT_MODEL, generatePath, isPeak } from '../deepseek';
import { route } from '../app';
import { addLocalAiCost, aiKey, aiPaths, newId, saveAiPath, setAiKey, settings, showToast, updateSettings } from '../store';
import { navigate } from '../util';

/** 从「重新生成」带过来的预填内容 */
export const genPrefill = signal<{ topic: string; background?: string; replaceId?: string } | null>(null);

const SUGGESTIONS = ['CAD 布尔运算', '网格生成与 Delaunay 三角化', '计算几何基础', 'GPU 驱动渲染', 'WebGPU 入门', '曲面细分与 LOD'];
const TIMEOUT_MS = 120_000;

/** 生成任务放在模块级：切到别的页面不会中断，完成后提示 */
const job = signal<{ topic: string; startedAt: number; ctrl: AbortController } | null>(null);
const jobError = signal<string | null>(null);

async function startGeneration(topic: string, background: string, replaceId?: string) {
  const ctrl = new AbortController();
  job.value = { topic, startedAt: Date.now(), ctrl };
  jobError.value = null;
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const model = settings.value.aiModel || DEFAULT_MODEL;
    const { path, costUsd } = await generatePath({ key: aiKey.value, model, topic, background, signal: ctrl.signal });
    addLocalAiCost(costUsd);
    const id = replaceId ?? `ai-${newId()}`;
    saveAiPath({ ...path, id, source: 'ai', createdAt: Date.now(), model, background: background.trim() || undefined, costUsd });
    genPrefill.value = null;
    const target = `#/learn/${encodeURIComponent(id)}`;
    // 还停在生成页：直接打开（replace，返回键回到学习列表）；否则提示
    if (route.value.startsWith('#/gen')) location.replace(target);
    else showToast(`学习路线「${path.title}」已生成`, { label: '查看', run: () => navigate(target) }, 10000);
  } catch (e) {
    jobError.value = e instanceof AiError ? e.message : `生成失败：${(e as Error).message}`;
    if (!route.value.startsWith('#/gen')) showToast(`「${topic}」${jobError.value}`, undefined, 8000);
  } finally {
    clearTimeout(timer);
    job.value = null;
  }
}

export function GeneratePage() {
  const pre = genPrefill.value;
  const [topic, setTopic] = useState(pre?.topic ?? '');
  const [background, setBackground] = useState(pre?.background ?? settings.value.aiBackground ?? '');
  const [keyDraft, setKeyDraft] = useState('');
  const [, tick] = useState(0);
  const replaceId = pre?.replaceId && aiPaths.value[pre.replaceId] ? pre.replaceId : undefined;
  const running = job.value;
  const busy = !!running;
  const elapsed = running ? Math.round((Date.now() - running.startedAt) / 1000) : 0;
  const error = jobError.value;

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function run() {
    const t = topic.trim();
    if (!t || !aiKey.value || busy) return;
    updateSettings({ aiBackground: background.trim() || undefined });
    startGeneration(t, background, replaceId);
  }

  return (
    <>
      <header class="topbar">
        <button class="back" onClick={() => (history.length > 1 ? history.back() : navigate('#/learn'))}>
          ‹ 返回
        </button>
        <h1>{replaceId ? '重新生成' : 'AI 生成学习路线'}</h1>
      </header>

      <section class="panel">
        <p class="muted small">
          DeepSeek 按“专家级学习策展人”模板，为任意主题挑出学习杠杆最高的 5 个资源并排好使用顺序。每次约 $0.002
          {isPeak() ? '（当前是 DeepSeek 高峰时段，价格 ×2）' : ''}。AI 可能记错书名或链接，请自行核实。
        </p>

        {!aiKey.value && (
          <div class="notice">
            <p>需要 DeepSeek API Key（只保存在本机浏览器，不会导出或上传到别处）。</p>
            <div class="row">
              <input
                type="password"
                class="grow"
                placeholder="sk-…"
                autocomplete="off"
                value={keyDraft}
                onInput={(e) => setKeyDraft((e.target as HTMLInputElement).value)}
              />
              <button class="btn small" disabled={!keyDraft.trim()} onClick={() => setAiKey(keyDraft)}>
                保存
              </button>
            </div>
          </div>
        )}

        <label class="field">
          <span>主题</span>
          <input
            placeholder="例如：CAD 布尔运算、GPU 驱动渲染"
            value={topic}
            maxLength={60}
            onInput={(e) => setTopic((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
        </label>
        {!topic && (
          <div class="chips">
            {SUGGESTIONS.map((s) => (
              <button class="chip" onClick={() => setTopic(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <label class="field">
          <span>我的背景和目标（可选，让推荐更贴合）</span>
          <textarea
            rows={3}
            placeholder="例如：会 C++，做过 3 年 CAD 插件开发，想自己实现 NURBS 曲面求交"
            value={background}
            maxLength={300}
            onInput={(e) => setBackground((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        <div class="actions">
          <button class="btn primary" disabled={busy || !topic.trim() || !aiKey.value} onClick={run}>
            {busy ? `生成「${running.topic}」中… ${elapsed}s` : '生成'}
          </button>
          {busy && (
            <button class="btn" onClick={() => running.ctrl.abort()}>
              取消
            </button>
          )}
        </div>
        {busy && <p class="muted small">通常需要 20–60 秒，可以先切到别的页面，生成完成后会出现在「学习」列表里。</p>}
        {error && <p class="error">{error}</p>}
      </section>
    </>
  );
}
