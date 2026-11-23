import { signal } from '@preact/signals';
import { lastLoadAt, latest, loadRemote, showToast } from './store';

/**
 * 安卓 / PWA 体验：
 * - 安装到主屏幕（捕获 beforeinstallprompt，在设置里提供按钮）
 * - 离线状态
 * - 新版本就绪提示
 * - 从后台回到 App 时自动刷新数据（安装后的 PWA 没有浏览器的下拉刷新）
 * - 列表页下拉刷新
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installEvent = signal<InstallPromptEvent | null>(null);
export const isStandalone = signal(
  typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches),
);
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

export async function promptInstall(): Promise<boolean> {
  const e = installEvent.value;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installEvent.value = null;
  return outcome === 'accepted';
}

/** 回到前台时，距上次加载超过这个时间就自动刷新 */
const STALE_MS = 30 * 60 * 1000;

export async function refreshData(manual = false) {
  const added = await loadRemote();
  if (added > 0) showToast(`已更新：新增 ${added} 篇`, { label: '查看', run: () => (location.hash = '#/') });
  else if (manual) showToast('已是最新');
}

export function initPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 不弹浏览器默认的迷你信息栏，改由设置页按钮触发
    installEvent.value = e as InstallPromptEvent;
  });
  addEventListener('appinstalled', () => {
    installEvent.value = null;
    isStandalone.value = true;
    showToast('已安装到主屏幕');
  });
  addEventListener('online', () => {
    online.value = true;
    if (latest.value && Date.now() - lastLoadAt.value > STALE_MS) refreshData();
  });
  addEventListener('offline', () => (online.value = false));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && lastLoadAt.value && Date.now() - lastLoadAt.value > STALE_MS) {
      refreshData();
    }
  });

  // 输入时隐藏底部导航，给软键盘和编辑区腾出空间
  const typing = (el: EventTarget | null) =>
    el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button'].includes((el as HTMLInputElement).type)));
  document.addEventListener('focusin', (e) => document.body.classList.toggle('typing', typing(e.target)));
  document.addEventListener('focusout', () => setTimeout(() => document.body.classList.toggle('typing', typing(document.activeElement)), 0));

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 首次安装 service worker 时也会触发，那时不需要提示
      if (hadController) showToast('新版本已就绪', { label: '刷新', run: () => location.reload() }, 15000);
    });
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker 注册失败', e));
  }
}

/** 下拉刷新：页面在顶部时下拉超过阈值松手即刷新。返回清理函数 */
export function attachPullToRefresh(indicator: HTMLElement, onRefresh: () => Promise<unknown>): () => void {
  const THRESHOLD = 70;
  let startY = -1;
  let dy = 0;
  let busy = false;
  const set = (h: number, label: string) => {
    indicator.style.height = `${h}px`;
    indicator.textContent = label;
  };
  const start = (e: TouchEvent) => {
    startY = !busy && scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : -1;
    dy = 0;
  };
  const move = (e: TouchEvent) => {
    if (startY < 0) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || scrollY > 0) return set(0, '');
    const h = Math.min(dy * 0.5, 90);
    set(h, dy >= THRESHOLD ? '松开刷新' : '下拉刷新');
  };
  const end = async () => {
    if (startY < 0) return;
    startY = -1;
    if (dy < THRESHOLD || scrollY > 0) return set(0, '');
    busy = true;
    set(40, '刷新中…');
    try {
      await onRefresh();
    } finally {
      busy = false;
      set(0, '');
    }
  };
  addEventListener('touchstart', start, { passive: true });
  addEventListener('touchmove', move, { passive: true });
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);
  return () => {
    removeEventListener('touchstart', start);
    removeEventListener('touchmove', move);
    removeEventListener('touchend', end);
    removeEventListener('touchcancel', end);
  };
}

/** 调起安卓系统分享面板；不支持时复制到剪贴板 */
export async function shareOrCopy(data: { title?: string; text?: string; url?: string }) {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const text = [data.title, data.text, data.url].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch {
    showToast('当前浏览器不支持分享');
  }
}
