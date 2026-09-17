import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Vite 配置：Vue 单文件组件 + `@` 别名 + worker ESM 格式。
// 注意：dev server 必须绑定 localhost（getDisplayMedia 要求安全上下文）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Worker 以 ESM 格式打包，配合 `new Worker(url, { type: 'module' })`。
  worker: {
    format: 'es',
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
