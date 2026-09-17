/**
 * UiStore —— 全局 UI 状态（当前 tab、toast、诊断信息复制）。
 *
 * 依据：架构文档 §2.11 / §3.6。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DiagnosticPayload } from '@/types/ipc';
import { collectDiagnostics, formatDiagnostics, type CollectDiagInput } from '@/utils/diag';

/** 全局 tab 标识（与路由对应）。 */
export type UiTab = 'panel' | 'calibration' | 'history' | 'changelog' | 'settings';

/** 一条 toast（轻量提示）。 */
export interface UiToast {
  /** 唯一 id。 */
  id: number;
  /** 文本。 */
  message: string;
  /** 类型。 */
  type: 'info' | 'success' | 'warning' | 'error';
  /** 生成时刻（`Date.now()`）。 */
  createdAt: number;
}

/**
 * UI store（setup 风格）。
 */
export const useUiStore = defineStore('ui', () => {
  /** 当前 tab。 */
  const activeTab = ref<UiTab>('panel');

  /** toast 队列。 */
  const toasts = ref<UiToast[]>([]);

  /** 自增 id。 */
  let toastSeq = 0;

  /** 最近一次复制的诊断信息文本。 */
  const lastDiagnostics = ref<string | null>(null);

  /**
   * 设置当前 tab。
   *
   * @param tab tab 标识。
   */
  const setActiveTab = (tab: UiTab): void => {
    activeTab.value = tab;
  };

  /**
   * 推入一条 toast。
   *
   * @param message 文本。
   * @param type 类型，默认 `'info'`。
   * @param ttlMs 存活时长（ms），默认 3000；<=0 表示不自动移除。
   * @returns toast 的 id。
   */
  const pushToast = (
    message: string,
    type: UiToast['type'] = 'info',
    ttlMs = 3000,
  ): number => {
    toastSeq += 1;
    const id = toastSeq;
    const toast: UiToast = { id, message, type, createdAt: Date.now() };
    toasts.value = [...toasts.value, toast];
    if (ttlMs > 0) {
      setTimeout(() => removeToast(id), ttlMs);
    }
    return id;
  };

  /**
   * 移除指定 toast。
   *
   * @param id toast id。
   */
  const removeToast = (id: number): void => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  };

  /** 清空全部 toast。 */
  const clearToasts = (): void => {
    toasts.value = [];
  };

  /**
   * 收集诊断信息并（可选）复制到剪贴板。
   *
   * @param input 环境参数。
   * @param copy 是否复制到剪贴板，默认 `true`。
   * @returns 诊断文本。
   */
  const collectAndCopyDiagnostics = async (
    input: CollectDiagInput,
    copy = true,
  ): Promise<string> => {
    const payload: DiagnosticPayload = collectDiagnostics(input);
    const text = formatDiagnostics(payload);
    lastDiagnostics.value = text;
    if (copy && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // 剪贴板权限被拒时忽略（文本已在 lastDiagnostics 中）。
      }
    }
    return text;
  };

  return {
    activeTab,
    toasts,
    lastDiagnostics,
    setActiveTab,
    pushToast,
    removeToast,
    clearToasts,
    collectAndCopyDiagnostics,
  };
});
