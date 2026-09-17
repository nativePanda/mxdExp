import type { Config } from 'tailwindcss';

// Tailwind 配置：扫描 src 下所有模板文件。
// 与 Element Plus 共存：不开启 preflight 之外的复杂定制，类名前加 `tw-` 前缀可选，
// 这里保持默认前缀，通过 layer 顺序保证 Element Plus 样式优先级更高。
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主题色（与 Element Plus 主色协调）
        brand: {
          DEFAULT: '#f59e0b',
          dark: '#b45309',
          light: '#fcd34d',
        },
      },
      fontFamily: {
        // 等宽数字字体，用于所有指标数值
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  corePlugins: {
    // 保留 preflight，让 Tailwind 的基础重置生效（Element Plus 会覆盖表单控件）
    preflight: true,
  },
  plugins: [],
} satisfies Config;
