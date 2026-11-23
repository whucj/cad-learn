# CAD Learn（网页版）

手机上自学**几何内核**与**实时渲染**：自动收集资料 → DeepSeek 中文摘要和相关度打分 → 阅读、收藏、记笔记 → 导出 zip 放进 Obsidian。

```
GitHub Actions（每天 4 次）
  └─ collector/：抓取 config.yaml 里的订阅源，DeepSeek 生成中文摘要/标签/相关度
  └─ 结果提交到 data/，构建 web/ 并发布到 GitHub Pages
手机浏览器打开网页（可安装到主屏幕）
  └─ 阅读、收藏、笔记（保存在浏览器本地）
  └─ 设置 → 导出 zip → 解压到 Obsidian 仓库
```

公开仓库免费：Actions（标准 runner）不限分钟数，Pages 免费托管。唯一花钱的是 DeepSeek。

## 部署步骤（约 10 分钟）

1. **建仓库**：在 GitHub 新建一个**公开**仓库（如 `cad-learn`），把本目录的全部内容推到 `main` 分支。
2. **开启 Pages**：仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
3. **配置 DeepSeek Key**：Settings → Secrets and variables → Actions → New repository secret
   - Name：`DEEPSEEK_API_KEY`
   - Secret：你的 DeepSeek API Key（不配置也能运行，只是没有 AI 摘要）
4. **首次运行**：Actions → 「采集并发布」→ Run workflow。几分钟后打开 `https://<用户名>.github.io/<仓库名>/`。
5. **装到手机**：用安卓 Chrome 打开上面的网址 → 菜单 →「添加到主屏幕 / 安装应用」。安装后，在其它 App 里点「分享」可以看到 CAD Learn，分享的链接会存成一条「待读」笔记。

## 日常使用

- **推荐**：只显示 AI 相关度 ≥ 3 星的文章（设置里可调）；**全部**：所有抓到的内容。
- **阅读原文**：在新标签页打开原网站（静态网页无法替你抓取全文，这是公开托管的版权/跨域限制）。arXiv 论文额外给出 PDF 和 HTML 全文链接。
- **笔记**：Markdown，自动保存。从文章页「写笔记」会自动关联文章并带上 AI 摘要。
- **导出到 Obsidian**：设置 →「导出更新」下载 zip → 在电脑上解压到 Obsidian 仓库根目录（同名文件覆盖即为更新）→ 回到网页点「已放入 Obsidian」。
  没点「已放入」（比如下载失败），下次导出会重新包含这些内容，不会漏。
  ```
  CADLearn/Notes/<笔记>.md         笔记（frontmatter + 关联文章的 [[双链]]）
  CADLearn/Clippings/<文章>.md     收藏/被笔记引用的文章（AI 摘要、要点、标签）
  CADLearn/_待清理.md              有删除时出现：列出需要在 Obsidian 里手动删除的文件
  CADLearn/cad-learn-backup.json   本地数据备份
  ```
  - 只导出内容有变化的文件（包括收藏后才生成的 AI 摘要）。
  - 文件名在第一次导出后固定：之后改笔记标题不会产生重复文件，新标题写在 frontmatter 的 `aliases` 里，Obsidian 中照样能搜到、链接到。
- **备份**：笔记和收藏只保存在当前浏览器里。换手机或清除浏览器数据前先导出一次；之后在设置里选 `cad-learn-backup.json` 恢复。

## 修改订阅源 / 兴趣 / 预算

都在 `config.yaml`，可以直接在 GitHub 网页上编辑，提交后会自动重新运行：

- `sources`：RSS/Atom 地址，或 `arxiv:` 查询语句（如 `abs:"ray tracing"`）。GitHub 项目发布：`https://github.com/<owner>/<repo>/releases.atom`
- `split`（可选）：合集类订阅源的拆分规则。例如 Graphics Programming Weekly 每期约 10 篇精选，按 CSS 选择器拆成独立文章，
  各自去重、打分和摘要，编辑写的要点作为“编辑推荐语”保留，并注明收录于第几期
- `interests`：你的学习方向描述，AI 按它给相关度打分
- `tags`：推荐标签（导出到 Obsidian 后是 `#标签`）
- `ai.monthly_budget_usd`：本月估算花费达到后停止摘要（默认 4.5）

## 费用估算（DeepSeek）

按 2026-11 官方价格（deepseek-flash，非高峰：输入 $0.15/百万 token，缓存命中 $0.003，输出 $0.6），每篇摘要约 $0.0005–0.001。
定时任务安排在非高峰时段运行。每月新增几百篇相关文章，**预计 $0.3–1/月**。实际用量见网页「设置 → 数据状态」，以 DeepSeek 控制台账单为准。

首次运行会抓到约 300 篇历史内容，但只给最近 30 天的文章做摘要，每次最多 40 篇，几次运行后补齐。

## 注意

- **公开内容**：`data/` 里的标题、链接、摘录和 AI 摘要都是公开的；笔记和收藏只在你的浏览器里，不会上传。不发布原文全文。
- **60 天规则**：公开仓库 60 天无任何提交，GitHub 会自动停用定时任务。数据每次更新都会提交，正常不会触发；如果被停用，在 Actions 页面点 Enable 即可。
- **订阅源失败**：在网页「设置 → 数据状态」查看。被网站拦截的源可以在 `config.yaml` 里删掉或注释掉。

## 本地开发

```bash
# 采集（需要 Dart ≥ 3.13；不设 Key 则只抓取）
cd collector && dart pub get
DEEPSEEK_API_KEY=sk-xxx dart run bin/collect.dart --root ..
dart test

# 网页（需要 Node ≥ 22）
cd web && npm install
npm run dev      # http://localhost:5173 ，读取 ../data/
npm test
npm run build
```

## 目录

```
config.yaml                 订阅源、兴趣、AI 预算
collector/                  Dart 采集器
  bin/collect.dart          入口
  lib/feed_parser.dart      RSS 2.0 / RSS 1.0 / Atom 解析
  lib/extractor.dart        网页正文提取（只用于喂给 AI）
  lib/summarizer.dart       DeepSeek 调用、费用估算
  lib/store.dart            data/ 读写
  lib/collector.dart        抓取 → 去重 → 摘要 主流程
data/                       采集结果（Actions 自动提交）
web/                        网页（Preact + Vite，PWA）
  src/export.ts             Obsidian Markdown / zip 生成
  src/store.ts              远程数据 + 本地 IndexedDB
  src/pages/                列表、文章、笔记、设置
.github/workflows/collect.yml
```
