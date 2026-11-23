import { useState } from 'preact/hooks';
import { buildExportFiles, exportZip } from '../export';
import { articleMap, importBackup, latest, loadRemote, notes, settings, starred, status, updateSettings, usage } from '../store';
import { TOPIC_LABEL } from '../types';
import { relTime } from '../util';

export function SettingsPage() {
  const s = settings.value;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const input = () => ({
    notes: Object.values(notes.value),
    starred: Object.values(starred.value),
    articles: articleMap.value,
    settings: s,
  });
  const pending = [...buildExportFiles({ ...input(), since: s.lastExportAt ?? 0 }).keys()].filter((k) => k.endsWith('.md')).length;

  async function doExport(incremental: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const now = Date.now();
      const { blob, count } = await exportZip({ ...input(), since: incremental ? s.lastExportAt ?? 0 : 0 });
      if (count === 0) {
        setMsg('没有需要导出的内容。');
        return;
      }
      const d = new Date(now);
      const p = (n: number) => String(n).padStart(2, '0');
      const name = `cad-learn-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      updateSettings({ lastExportAt: now });
      setMsg(`已导出 ${count} 个 Markdown 文件：${name}`);
    } catch (e) {
      setMsg(`导出失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
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

  return (
    <>
      <header class="topbar">
        <h1>设置</h1>
      </header>

      <section class="panel">
        <h2>导出到 Obsidian</h2>
        <p class="muted small">
          生成 zip，解压到 Obsidian 仓库根目录即可。包含笔记、收藏的文章（含 AI 摘要）和一份本地数据备份。同名文件直接覆盖即为更新。
        </p>
        <label class="field">
          <span>zip 内的文件夹</span>
          <input value={s.exportFolder} onChange={(e) => updateSettings({ exportFolder: (e.target as HTMLInputElement).value })} />
        </label>
        <div class="actions">
          <button class="btn primary" disabled={busy || pending === 0} onClick={() => doExport(true)}>
            导出新增/修改（{pending}）
          </button>
          <button class="btn" disabled={busy} onClick={() => doExport(false)}>
            全部导出
          </button>
        </div>
        <p class="muted small">上次导出：{s.lastExportAt ? relTime(s.lastExportAt) : '从未'}</p>
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
        <p class="muted small">订阅源和 AI 预算在仓库的 config.yaml 中修改；数据由 GitHub Actions 每天定时更新 4 次。</p>
      </section>
    </>
  );
}
