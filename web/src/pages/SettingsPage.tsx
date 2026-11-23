import { useState } from 'preact/hooks';
import { buildExportPlan, zipPlan, type ExportPlan } from '../export';
import {
  articleMap,
  confirmExport,
  exportState,
  importBackup,
  latest,
  loadRemote,
  notes,
  settings,
  starred,
  status,
  updateSettings,
  usage,
} from '../store';
import { formatNext, localSlots, nextRun } from '../schedule';
import { TOPIC_LABEL } from '../types';
import { relTime } from '../util';

export function SettingsPage() {
  const s = settings.value;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 已下载、等待确认“已放入 Obsidian”的导出 */
  const [awaiting, setAwaiting] = useState<{ plan: ExportPlan; name: string } | null>(null);

  const plan = (incremental: boolean) =>
    buildExportPlan({
      notes: Object.values(notes.value),
      starred: Object.values(starred.value),
      articles: articleMap.value,
      settings: s,
      exported: exportState.value,
      incremental,
    });
  const pendingPlan = plan(true);
  const pending = pendingPlan.changed + pendingPlan.removed.length;

  async function doExport(incremental: boolean) {
    setBusy(true);
    setMsg(null);
    setAwaiting(null);
    try {
      const p = plan(incremental);
      if (p.files.size === 0) {
        setMsg('没有需要导出的内容。');
        return;
      }
      const d = new Date(p.exportedAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const name = `cad-learn-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
      const url = URL.createObjectURL(await zipPlan(p));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setAwaiting({ plan: p, name });
    } catch (e) {
      setMsg(`导出失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!awaiting) return;
    confirmExport(awaiting.plan);
    setMsg(`已记录。下次「导出更新」只包含之后的变化。`);
    setAwaiting(null);
  }

  async function doImport(file: File) {
    try {
      const r = importBackup(await file.text());
      setMsg(`已恢复：笔记 ${r.notes} 条，收藏 ${r.starred} 篇（已有的较新内容保留不变）`);
    } catch (e) {
      setMsg(`恢复失败：${(e as Error).message}`);
    }
  }

  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = usage.value?.months[month];
  const failed = status.value?.sources.filter((x) => !x.ok) ?? [];
  const summarized = latest.value?.articles.filter((a) => a.ai).length ?? 0;
  const sched = status.value?.schedule;
  const next = sched ? nextRun(sched) : null;

  return (
    <>
      <header class="topbar">
        <h1>设置</h1>
      </header>

      <section class="panel">
        <h2>导出到 Obsidian</h2>
        <p class="muted small">
          生成 zip，解压到 Obsidian 仓库根目录即可（同名文件覆盖）。包含笔记、收藏的文章（含 AI 摘要）和一份本地数据备份。
          文件名在第一次导出后固定，之后改标题不会产生重复文件。
        </p>
        <label class="field">
          <span>zip 内的文件夹（修改后请「全部导出」一次）</span>
          <input value={s.exportFolder} onChange={(e) => updateSettings({ exportFolder: (e.target as HTMLInputElement).value })} />
        </label>
        <div class="actions">
          <button class="btn primary" disabled={busy || pending === 0} onClick={() => doExport(true)}>
            导出更新（{pending}）
          </button>
          <button class="btn" disabled={busy} onClick={() => doExport(false)}>
            全部导出
          </button>
        </div>
        <p class="muted small">上次确认导出：{s.lastExportAt ? relTime(s.lastExportAt) : '从未'}</p>
        {awaiting && (
          <div class="notice">
            <p>
              已下载 {awaiting.name}：{awaiting.plan.changed} 个 Markdown 文件
              {awaiting.plan.removed.length > 0 && `，另有 ${awaiting.plan.removed.length} 个已删除的文件需在 Obsidian 中手动删除（见 _待清理.md）`}。
            </p>
            <p>解压到 Obsidian 仓库后点「已放入」；如果下载失败或还没解压，点「稍后」，下次导出仍会包含这些内容。</p>
            <div class="actions">
              <button class="btn primary small" onClick={confirm}>
                已放入 Obsidian
              </button>
              <button class="btn small" onClick={() => setAwaiting(null)}>
                稍后
              </button>
            </div>
          </div>
        )}
        {msg && <p class="notice">{msg}</p>}
      </section>

      <section class="panel">
        <h2>备份恢复</h2>
        <p class="muted small">笔记和收藏只保存在本浏览器。换手机、清除浏览器数据前请先导出；之后选 zip 里的 cad-learn-backup.json 恢复。</p>
        <label class="btn">
          选择备份文件…
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) doImport(f);
            }}
          />
        </label>
      </section>

      <section class="panel">
        <h2>推荐</h2>
        <label class="field">
          <span>「推荐」只显示相关度 ≥</span>
          <select value={s.minRelevance} onChange={(e) => updateSettings({ minRelevance: Number((e.target as HTMLSelectElement).value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option value={n}>{n} 星</option>
            ))}
          </select>
        </label>
      </section>

      <section class="panel">
        <h2>数据状态</h2>
        <ul class="plain">
          <li>数据生成于：{latest.value ? relTime(latest.value.generatedAt) : '—'}</li>
          {sched && (
            <li>
              更新周期：{sched.label}
              {sched.every !== 'manual' && `，本地时间 ${localSlots(sched)}`}
              {next ? `；下次约 ${formatNext(next)}` : '；仅在 GitHub 上手动运行时更新'}
            </li>
          )}
          <li>
            文章：{latest.value?.articles.length ?? 0} 篇，已有 AI 摘要 {summarized} 篇
          </li>
          <li>
            本月 AI：{thisMonth ? `${thisMonth.calls} 次，估算 $${thisMonth.costUsd.toFixed(3)}` : '无调用'}
          </li>
          <li>
            订阅源：{status.value ? `${status.value.sources.length - failed.length}/${status.value.sources.length} 正常` : '—'}
          </li>
        </ul>
        {failed.length > 0 && (
          <ul class="plain error small">
            {failed.map((f) => (
              <li>
                ⚠ {f.name}（{TOPIC_LABEL[f.topic]}）：{f.error}
              </li>
            ))}
          </ul>
        )}
        <button class="btn" onClick={() => loadRemote()}>
          重新加载数据
        </button>
        <p class="muted small">
          更新周期、订阅源和 AI 预算都在仓库的 config.yaml 中修改（可直接在 GitHub 网页上编辑），提交后自动生效。
        </p>
      </section>
    </>
  );
}
