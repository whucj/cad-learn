import { createReadStream, existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

// 采集器输出目录：默认仓库根目录的 data/，本地调试可用 DATA_DIR 指向别处
const dataDir = resolve(process.env.DATA_DIR ?? resolve(import.meta.dirname, '../data'));

/** 开发时把 /data/*.json 映射到采集器输出；构建时复制到 dist/data */
function dataPlugin(): Plugin {
  return {
    name: 'cad-learn-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const file = resolve(dataDir, '.' + (req.url ?? '').split('?')[0]);
        if (!file.startsWith(dataDir) || !file.endsWith('.json') || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        createReadStream(file).pipe(res);
      });
    },
    async closeBundle() {
      for (const f of ['latest.json', 'status.json', 'usage.json']) {
        const src = resolve(dataDir, f);
        if (existsSync(src)) await cp(src, resolve(import.meta.dirname, 'dist/data', f));
      }
    },
  };
}

export default defineConfig({
  // 相对路径：GitHub Pages 的 https://<用户>.github.io/<仓库>/ 子路径也能用
  base: './',
  plugins: [preact(), dataPlugin()],
});
