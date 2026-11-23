/** 与采集器 data/latest.json 对应 */
export interface AiResult {
  summary: string;
  points: string[];
  tags: string[];
  relevance: number; // 1–5
  level?: '入门' | '进阶' | '专业';
}

export type Topic = 'geometry' | 'rendering' | 'general';

export interface Article {
  id: string;
  url: string;
  title: string;
  source: string;
  topic: Topic;
  author?: string;
  published?: string;
  fetched: string;
  snippet?: string;
  ai?: AiResult;
}

export interface LatestData {
  generatedAt: string;
  articles: Article[];
}

export interface SourceStatus {
  name: string;
  topic: Topic;
  ok: boolean;
  error?: string;
  items?: number;
  added?: number;
}

export interface StatusData {
  generatedAt: string;
  sources: SourceStatus[];
}

export interface UsageData {
  months: Record<string, { calls: number; costUsd: number }>;
}

/** ---------- 以下是只存在浏览器本地的数据 ---------- */

/** 收藏时保存文章快照：文章滚出 latest.json 后仍能查看和导出 */
export interface Starred {
  article: Article;
  starredAt: number;
}

export interface Note {
  id: string;
  title: string;
  body: string; // Markdown
  tags: string[];
  articleId?: string;
  created: number;
  updated: number;
}

export interface Settings {
  minRelevance: number; // “推荐”视图的最低相关度
  exportFolder: string; // zip 内的根目录，也是 Obsidian 仓库里的文件夹
  lastExportAt?: number;
}

export const TOPIC_LABEL: Record<Topic, string> = {
  geometry: '几何内核',
  rendering: '实时渲染',
  general: '综合',
};

/** 导出到 Obsidian 时的主题标签 */
export const TOPIC_TAG: Record<Topic, string> = {
  geometry: 'geometry-kernel',
  rendering: 'realtime-rendering',
  general: 'graphics',
};
