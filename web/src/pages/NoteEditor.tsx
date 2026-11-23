import { useEffect, useRef, useState } from 'preact/hooks';
import { articleMap, deleteNote, notes, saveNote } from '../store';
import type { Note } from '../types';
import { navigate, relTime, renderMarkdown } from '../util';

export function NoteEditor({ id }: { id: string }) {
  const stored = notes.value[id];
  const [draft, setDraft] = useState<Note | undefined>(stored);
  const [preview, setPreview] = useState(false);
  const [tagText, setTagText] = useState(stored?.tags.join(', ') ?? '');
  const dirty = useRef(false);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 输入停顿 600ms 自动保存；离开页面时立即保存
  useEffect(() => {
    if (!dirty.current || !draft) return;
    const t = setTimeout(() => {
      saveNote(draft);
      dirty.current = false;
    }, 600);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    const flush = () => {
      if (dirty.current && latestDraft.current) {
        saveNote(latestDraft.current);
        dirty.current = false;
      }
    };
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // 正文框随内容增高
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 240)}px`;
  }, [draft?.body, preview]);

  if (!draft) {
    return (
      <>
        <header class="topbar">
          <button class="back" onClick={() => navigate('#/notes')}>
            ‹ 笔记
          </button>
        </header>
        <p class="muted center">笔记不存在或已删除。</p>
      </>
    );
  }

  const article = draft.articleId ? articleMap.value.get(draft.articleId) : undefined;
  const update = (patch: Partial<Note>) => {
    dirty.current = true;
    setDraft({ ...draft, ...patch });
  };

  return (
    <>
      <header class="topbar">
        <button class="back" onClick={() => (history.length > 1 ? history.back() : navigate('#/notes'))}>
          ‹ 返回
        </button>
        <div class="row">
          <button class={preview ? 'btn small on' : 'btn small'} onClick={() => setPreview(!preview)}>
            {preview ? '编辑' : '预览'}
          </button>
          <button
            class="btn small danger"
            onClick={() => {
              if (confirm('删除这条笔记？（已导出到 Obsidian 的文件不受影响）')) {
                deleteNote(draft.id);
                dirty.current = false;
                navigate('#/notes');
              }
            }}
          >
            删除
          </button>
        </div>
      </header>

      <div class="editor">
        <input
          class="title-input"
          placeholder="标题"
          value={draft.title}
          onInput={(e) => update({ title: (e.target as HTMLInputElement).value })}
        />
        {article && (
          <a class="linked" href={`#/a/${article.id}`}>
            📎 {article.title} · {article.source}
          </a>
        )}
        <input
          class="tags-input"
          placeholder="标签，用逗号分隔，如：NURBS, 复习"
          value={tagText}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setTagText(v);
            update({ tags: v.split(/[,，]/).map((t) => t.trim()).filter(Boolean) });
          }}
        />
        {preview ? (
          <div class="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body || '*（空）*') }} />
        ) : (
          <textarea
            ref={bodyRef}
            class="body-input"
            placeholder="用 Markdown 记笔记… 支持 ## 标题、- 列表、`代码`、> 引用"
            value={draft.body}
            onInput={(e) => update({ body: (e.target as HTMLTextAreaElement).value })}
          />
        )}
        <p class="muted small">
          自动保存 · 修改于 {relTime(stored?.updated ?? draft.updated)} · 笔记只保存在本浏览器，请定期在「设置」导出
        </p>
      </div>
    </>
  );
}
