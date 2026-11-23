import { useState } from 'preact/hooks';
import { buildExportPlan, zipPlan, type ExportPlan } from '../export';
import { planImport, readImportFile, type ImportPlan } from '../import';
import { DEFAULT_MODEL } from '../deepseek';
import { installEvent, isStandalone, promptInstall, refreshData } from '../pwa';
import {
  aiKey,
  aiPaths,
  allPaths,
  applyImport,
  articleMap,
  confirmExport,
  exportState,
  latest,
  notes,
  progress,
  setAiKey,
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
  /** 已解析、等待确认的导入 */
  const [importing, setImporting] = useState<{ plan: ImportPlan; name: string } | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const plan = (incremental: boolean) =>
    buildExportPlan({
      notes: Object.values(notes.value),
      starred: Object.values(starred.value),
      articles: articleMap.value,
      settings: s,
      paths: allPaths.value,
      progress: progress.value,
      aiPaths: aiPaths.value,
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

  async function pickImport(file: File) {
    setImporting(null);
    setImportMsg(null);
    try {
      const p = planImport(await readImportFile(file), {
        local: { notes: notes.value, starred: starred.value, exportState: exportState.value, aiPaths: aiPaths.value, progress: progress.value },
        articles: articleMap.value,
        settings: s,
      });
      if (importChanges(p) === 0) setImportMsg(`${file.name}：内容与本地一致，没有需要导入的变化。`);
      else setImporting({ plan: p, name: file.name });
    } catch (e) {
      setImportMsg(`导入失败：${(e as Error).message}`);
    }
  }

  function doImport() {
    if (!importing) return;
    applyImport(importing.plan);
    setImportMsg(`已导入 ${importing.name}。`);
    setImporting(null);
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
          生成 zip，解压到 Obsidian 仓库根目录即可（同名文件覆盖）。包含笔记、收藏的文章（含 AI 摘要）、学习路线（含进度）和一份本地数据备份。
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
        <h2>从 zip 导入</h2>
        <p class="muted small">
          笔记和收藏只保存在本浏览器，换手机、清除浏览器数据前请先导出。选择导出的 zip（或其中的 cad-learn-backup.json）即可恢复；
          在 Obsidian 里修改或新建的笔记，把 {s.exportFolder || 'CADLearn'} 文件夹压缩成 zip 后导入，也会同步回来。
          导入不会删除本地内容，确认前可以先看变化。
        </p>
        <label class="btn">
          选择 zip / 备份文件…
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed,.json,application/json"
            hidden
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              const f = input.files?.[0];
              input.value = ''; // 允许重复选择同一个文件
              if (f) pickImport(f);
            }}
          />
        </label>
        {importing && (
          <div class="notice">
            <p>{importing.name} 将导入：</p>
            <ImportSummary plan={importing.plan} />
            <div class="actions">
              <button class="btn primary small" onClick={doImport}>
                确认导入
              </button>
              <button class="btn small" onClick={() => setImporting(null)}>
                取消
              </button>
            </div>
          </div>
        )}
        {importMsg && <p class="notice">{importMsg}</p>}
      </section>

      <section class="panel">
        <h2>手机使用</h2>
        {isStandalone.value ? (
          <p class="muted small">已作为 App 安装。回到 App 时会自动刷新数据，列表页也可以下拉刷新。</p>
        ) : installEvent.value ? (
          <div class="actions">
            <button class="btn primary" onClick={() => promptInstall()}>
              安装到主屏幕
            </button>
          </div>
        ) : (
          <p class="muted small">
            安装到主屏幕：用安卓 Chrome 打开本站 → 右上角菜单 →「添加到主屏幕」或「安装应用」。安装后可以从其它 App 把链接或选中的文字「分享」到 CAD Learn。
          </p>
        )}
        <div class="field">
          <span>阅读字号</span>
          <div class="segmented" role="radiogroup" aria-label="阅读字号">
            {(
              [
                ['sm', '小'],
                ['md', '标准'],
                ['lg', '大'],
                ['xl', '特大'],
              ] as const
            ).map(([v, label]) => (
              <button
                role="radio"
                aria-checked={(s.fontSize ?? 'md') === v}
                class={(s.fontSize ?? 'md') === v ? 'on' : ''}
                onClick={() => updateSettings({ fontSize: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <AiSection />

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
        <button class="btn" onClick={() => refreshData(true)}>
          重新加载数据
        </button>
        <p class="muted small">
          更新周期、订阅源和 AI 预算都在仓库的 config.yaml 中修改（可直接在 GitHub 网页上编辑），提交后自动生效。
        </p>
      </section>
    </>
  );
}

function importChanges(p: ImportPlan): number {
  return (p.backup ? p.backup.notes + p.backup.starred + p.backup.paths : 0) + p.updated.length + p.added.length + p.conflicts.length;
}

function ImportSummary({ plan }: { plan: ImportPlan }) {
  const names = (list: string[]) => list.slice(0, 5).map((t) => `「${t}」`).join('、') + (list.length > 5 ? ` 等 ${list.length} 条` : '');
  return (
    <ul class="plain small">
      {plan.backup && (plan.backup.notes > 0 || plan.backup.starred > 0 || plan.backup.paths > 0) && (
        <li>
          从备份恢复：笔记 {plan.backup.notes} 条，收藏 {plan.backup.starred} 篇
          {plan.backup.paths > 0 && `，AI 学习路线 ${plan.backup.paths} 条`}（本地较新的内容保留不变）
        </li>
      )}
      {plan.updated.length > 0 && <li>用 Obsidian 里的修改更新：{names(plan.updated)}</li>}
      {plan.added.length > 0 && <li>新增笔记：{names(plan.added)}</li>}
      {plan.conflicts.length > 0 && (
        <li class="error">
          本地和 Obsidian 都改过：{names(plan.conflicts)}。本地版本不变，Obsidian 的版本另存为「…（Obsidian 版本）」，请手动合并。
        </li>
      )}
      {plan.unchanged > 0 && <li class="muted">{plan.unchanged} 条笔记无变化</li>}
    </ul>
  );
}

function AiSection() {
  const s = settings.value;
  const [draft, setDraft] = useState('');
  const month = new Date().toISOString().slice(0, 7);
  const local = s.localAi?.month === month ? s.localAi : undefined;
  return (
    <section class="panel">
      <h2>AI 生成学习路线</h2>
      <p class="muted small">
        在「学习 → AI 生成」里用 DeepSeek 为任意主题生成精选资源。需要你自己的 API Key：只保存在本机浏览器，不进入导出和备份；
        可以和 GitHub 上用于文章摘要的 Key 相同。
      </p>
      {aiKey.value ? (
        <div class="row">
          <span class="grow">
            Key：{aiKey.value.slice(0, 5)}…{aiKey.value.slice(-4)}
          </span>
          <button class="btn small danger" onClick={() => confirm('从本机删除 DeepSeek API Key？') && setAiKey('')}>
            删除 Key
          </button>
        </div>
      ) : (
        <div class="row">
          <input
            type="password"
            class="grow"
            placeholder="sk-…"
            autocomplete="off"
            aria-label="DeepSeek API Key"
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          />
          <button
            class="btn small"
            disabled={!draft.trim()}
            onClick={() => {
              setAiKey(draft);
              setDraft('');
            }}
          >
            保存
          </button>
        </div>
      )}
      <label class="field">
        <span>模型</span>
        <input
          value={s.aiModel ?? ''}
          placeholder={DEFAULT_MODEL}
          onChange={(e) => updateSettings({ aiModel: (e.target as HTMLInputElement).value.trim() || undefined })}
        />
      </label>
      <p class="muted small">本月本机生成：{local ? `${local.calls} 次，估算 $${local.costUsd.toFixed(4)}` : '无'}（不含 GitHub 上的文章摘要）</p>
    </section>
  );
}
