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
  /** 从合集（如 Graphics Programming Weekly 某一期）拆出时的出处 */
  via?: { title: string; url: string };
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

/** 更新周期（采集器写入 status.json） */
export interface ScheduleInfo {
  every: '4x-daily' | '2x-daily' | 'daily' | 'weekly' | 'manual';
  label: string; // 如 "每周 1 次（周日）"
  slotsUtc: number[]; // 运行时段（UTC 小时，xx:30 运行）
  weekday?: number; // weekly：1=周一 … 7=周日
}

export interface StatusData {
  generatedAt: string;
  schedule?: ScheduleInfo;
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
  /** 关联的学习资源：`<路线 id>::<资源名称>` */
  ref?: string;
  created: number;
  updated: number;
}

export interface Settings {
  minRelevance: number; // “推荐”视图的最低相关度
  exportFolder: string; // zip 内的根目录，也是 Obsidian 仓库里的文件夹
  lastExportAt?: number;
  /** 阅读字号 */
  fontSize?: 'sm' | 'md' | 'lg' | 'xl';
  /** App 内生成学习路线用的模型 */
  aiModel?: string;
  /** 生成学习路线时附带的个人背景（可选） */
  aiBackground?: string;
  /** 本机 AI 调用的估算花费（按月） */
  localAi?: { month: string; calls: number; costUsd: number };
}

/** ---------- 学习路线：精选资源 ---------- */

export type Level = '新手' | '中级' | '高级';

export interface LearningResource {
  name: string;
  type: string; // 书籍 / 网站 / 课程 / newsletter / 社区 / 专家…
  url?: string;
  why: string; // 为什么值得花时间
  teaches: string; // 能学会主题的哪个具体部分
  bestFor: string; // 最适合的学习者类型
  level: Level;
  howTo: string; // 如何高效使用
  avoid: string; // 不该在什么上浪费时间
}

export interface LearningPath {
  id: string;
  title: string; // 主题，如“几何内核”
  topic?: Topic;
  source: 'builtin' | 'ai';
  intro?: string;
  resources: LearningResource[];
  /** 最佳使用顺序（按资源名称引用） */
  order: { name: string; reason: string }[];
  createdAt?: number;
  model?: string;
  background?: string;
  costUsd?: number;
}

export type ProgressState = 'doing' | 'done';

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
