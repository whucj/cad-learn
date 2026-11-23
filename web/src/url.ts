/**
 * 只放行 http(s) 绝对链接。文章链接来自第三方订阅源，直接用作 href 时
 * javascript:/data: 等链接会在本站（存有你的笔记）执行脚本。采集器已过滤，这里是第二道防线。
 */
export function safeHref(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? u.href : undefined;
  } catch {
    return undefined;
  }
}
