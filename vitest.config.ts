import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest 配置：默认 node 环境（core/ 为纯 TS 无 DOM 依赖，可直接单测）。
// 需要 DOM 的用例可在单个文件中用 `// @vitest-environment jsdom` 覆盖。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
