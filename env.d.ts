/// <reference types="vite/client" />

// Vite 环境变量类型声明（本项目当前未使用自定义 env，保留以备扩展）
interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vue 单文件组件模块声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

// Vite 的 `?worker` 后缀导入声明（capture.worker 等）
declare module '*?worker' {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}

// Vite 的 `?worker&inline` 后缀导入声明
declare module '*?worker&inline' {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}

// Vite 的 `?raw` 后缀导入声明（用于内置静态 JSON 模板）
declare module '*?raw' {
  const content: string;
  export default content;
}

// dexie-export-import 无自带类型时的兜底（该包自带 .d.ts，此处仅作保险）
declare module 'dexie-export-import';
