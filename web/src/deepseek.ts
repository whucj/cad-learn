import type { LearningPath, LearningResource, Level } from './types';
import { safeHref } from './url';

/**
 * 在浏览器里直接调用 DeepSeek（官方 API 允许跨域）生成学习路线。
 * API Key 只保存在本机 IndexedDB，不进入备份和导出。
 */

export const DEFAULT_MODEL = 'deepseek-flash';
const BASE_URL = 'https://api.deepseek.com';
/** 每百万 token 美元价格（非高峰；高峰时段 ×2），与 config.yaml 的 price_offpeak 一致 */
const PRICE = { hit: 0.003, miss: 0.15, out: 0.6 };

export class AiError extends Error {}

export function curatorMessages(topic: string, background?: string) {
  const system = `你是一位专家级学习策展人，熟悉 CAD 几何内核、计算几何与计算机图形学等领域的学习资源。
只推荐你确定真实存在、口碑公认的资源；不确定的链接宁可留空（null），绝不编造书名、作者或网址。
用简体中文回答，资源名称保留原文。只输出 json。`;
  const user = `请扮演一位专家级学习策展人。找出学习「${topic}」杠杆最高的 5 个资源。
${background?.trim() ? `\n我的背景和目标：${background.trim()}\n` : ''}
资源可以包括书籍、视频、课程、网站、newsletter、社区，或值得关注的专家。

每个资源包含：
1. 资源名称
2. 资源类型
3. 它为什么值得我花时间
4. 它能帮我学会「${topic}」的哪个具体部分
5. 最适合这类资源的学习者类型
6. 难度等级：新手、中级或高级
7. 我应该如何高效使用它
8. 一个关于不该在什么上浪费时间的提醒

在清单之后，按最佳使用顺序给这些资源排名。
聚焦质量、清晰度和实用性。我要的是信号，不是噪音。

按以下 json 格式输出（每个文字字段 1–3 句，具体、可执行）：
{
  "title": "主题的简短名称",
  "intro": "一句话说明这 5 个资源如何覆盖该主题",
  "resources": [
    {"name": "", "type": "", "url": "官方网址或 null", "why": "", "teaches": "", "bestFor": "", "level": "新手|中级|高级", "howTo": "", "avoid": ""}
  ],
  "order": [{"name": "与 resources 中的 name 完全一致", "reason": "为什么排在这一步"}]
}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 校验并清洗 AI 输出；不合格抛 AiError */
export function parsePathJson(content: string, topic: string): Omit<LearningPath, 'id' | 'source'> {
  let s = content.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(s);
  } catch {
    throw new AiError('AI 输出不是有效的 JSON，请重试');
  }
  const text = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const rawList = Array.isArray(j.resources) ? j.resources : [];
  const resources: LearningResource[] = [];
  for (const r of rawList.slice(0, 8)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const name = text(o.name, 160);
    if (!name || resources.some((x) => x.name === name)) continue;
    resources.push({
      name,
      type: text(o.type, 40) || '资源',
      url: safeHref(typeof o.url === 'string' ? o.url.trim() : undefined),
      why: text(o.why),
      teaches: text(o.teaches),
      bestFor: text(o.bestFor),
      level: normalizeLevel(o.level),
      howTo: text(o.howTo),
      avoid: text(o.avoid),
    });
  }
  if (resources.length < 3) throw new AiError('AI 返回的资源太少，请换个说法或重试');

  // 排名：只保留能对应上的名称，缺失的按原顺序补在后面
  const names = new Set(resources.map((r) => r.name));
  const order: LearningPath['order'] = [];
  for (const o of Array.isArray(j.order) ? j.order : []) {
    const name = text((o as Record<string, unknown>)?.name, 160);
    if (names.has(name) && !order.some((x) => x.name === name)) order.push({ name, reason: text((o as Record<string, unknown>).reason, 300) });
  }
  for (const r of resources) if (!order.some((x) => x.name === r.name)) order.push({ name: r.name, reason: '' });

  return { title: text(j.title, 40) || topic.slice(0, 40), intro: text(j.intro) || undefined, resources, order };
}

function normalizeLevel(v: unknown): Level {
  const s = String(v ?? '');
  if (/新|入门|初|begin/i.test(s)) return '新手';
  if (/高|专|adv|expert/i.test(s)) return '高级';
  return '中级';
}

/** DeepSeek 高峰时段：北京时间工作日 09:00–12:00、14:00–18:00（UTC 01–04、06–10） */
export function isPeak(d: Date = new Date()): boolean {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}

export function estimateCost(usage: Record<string, number | undefined>, at: Date = new Date()): number {
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - hit;
  const out = usage.completion_tokens ?? 0;
  return ((hit * PRICE.hit + miss * PRICE.miss + out * PRICE.out) / 1e6) * (isPeak(at) ? 2 : 1);
}

export async function generatePath(opts: {
  key: string;
  model?: string;
  topic: string;
  background?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ path: Omit<LearningPath, 'id' | 'source'>; costUsd: number }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.model?.trim() || DEFAULT_MODEL;
  const body = JSON.stringify({
    model,
    messages: curatorMessages(opts.topic, opts.background),
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: 4000,
    temperature: 0.4,
  });
  let resp: Response;
  try {
    resp = await doFetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.key.trim()}`, 'Content-Type': 'application/json' },
      body,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('已取消或超时');
    throw new AiError('网络错误，无法连接 DeepSeek');
  }
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 160);
    const msg: Record<number, string> = {
      401: 'API Key 无效，请在「设置」里检查',
      402: 'DeepSeek 账户余额不足',
      429: '请求太频繁，请稍后再试',
    };
    throw new AiError(msg[resp.status] ?? `DeepSeek 返回 HTTP ${resp.status}：${detail}`);
  }
  const j = (await resp.json()) as { choices?: { message?: { content?: string } }[]; usage?: Record<string, number> };
  const content = j.choices?.[0]?.message?.content ?? '';
  return { path: parsePathJson(content, opts.topic), costUsd: estimateCost(j.usage ?? {}) };
}
