/**
 * 路由表：5 个页面，默认重定向到 `/panel`（控制面板）。
 *
 * 注意：视图组件在 T04 实现，此处先用占位 SFC 保证路由可通。
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

/** 顶部 tab 的元信息（App.vue 用其渲染导航）。 */
export interface TabMeta {
  /** 路由路径。 */
  path: string;
  /** tab 显示名。 */
  title: string;
}

/** 五个页面的路由定义。 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/panel',
  },
  {
    path: '/panel',
    name: 'panel',
    component: () => import('@/views/PanelView.vue'),
    meta: { title: '控制面板' },
  },
  {
    path: '/calibration',
    name: 'calibration',
    component: () => import('@/views/CalibrationView.vue'),
    meta: { title: '识别校准' },
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/views/HistoryView.vue'),
    meta: { title: '历史记录' },
  },
  {
    path: '/changelog',
    name: 'changelog',
    component: () => import('@/views/ChangelogView.vue'),
    meta: { title: '更新日志' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设置' },
  },
  {
    // 未匹配路由回落控制面板
    path: '/:pathMatch(.*)*',
    redirect: '/panel',
  },
];

/** 顶部 tab 顺序（与 PRD P0-1 一致：控制面板 / 识别校准 / 历史记录 / 更新日志 / 设置）。 */
export const TABS: TabMeta[] = [
  { path: '/panel', title: '控制面板' },
  { path: '/calibration', title: '识别校准' },
  { path: '/history', title: '历史记录' },
  { path: '/changelog', title: '更新日志' },
  { path: '/settings', title: '设置' },
];

/**
 * 创建路由实例。
 *
 * 使用 hash history：纯本地静态应用，刷新/直接打开不易 404。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
