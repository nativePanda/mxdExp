/**
 * HistoryStore —— 历史记录列表 / 详情 / 删除 / 导出。
 *
 * 依据：架构文档 §2.11 / §3.6 + §4.4（历史页时序）+ §5.8（批量落库、导出）。
 *
 * ## 职责
 * - 列出全部记录（`recordsRepo.list()`，按创建时间倒序）；
 * - 载入单条记录的采样点（`samplesRepo.byRecord`）供详情/趋势图渲染；
 * - 删除单条（连带采样点）与清空全部；
 * - 导出全部记录为 JSON（`recordsRepo.exportAllBlob`）与导入（`recordsRepo.importAll`）。
 *
 * ## 说明
 * P0 阶段不引入 `dexie` 的 liveQuery（避免额外复杂度），列表在增删/记录结束后显式 `reload`。
 * 历史页可在挂载时调用 `reload()`，并在记录保存后由调用方再次 `reload()`。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Record as MapleRecord, Sample } from '@/types/models';
import { recordsRepo, samplesRepo } from '@/db';

/** 导出结果（供 UI 提示）。 */
export interface ExportResult {
  /** 是否成功。 */
  ok: boolean;
  /** 导出条数（成功时）。 */
  count: number;
  /** 错误信息（失败时）。 */
  error: string | null;
}

/** 导入结果（供 UI 提示）。 */
export interface ImportResult {
  /** 是否成功。 */
  ok: boolean;
  /** 导入条数。 */
  imported: number;
  /** 错误信息（失败时）。 */
  error: string | null;
}

/**
 * 历史 store（setup 风格）。
 */
export const useHistoryStore = defineStore('history', () => {
  /** 全部记录（按创建时间倒序）。 */
  const records = ref<MapleRecord[]>([]);

  /** 当前选中记录 id。 */
  const selectedId = ref<string | null>(null);

  /** 当前选中记录的采样点（按 `t` 升序）。 */
  const selectedSamples = ref<Sample[]>([]);

  /** 是否正在加载。 */
  const loading = ref(false);

  /** 最近一次错误信息。 */
  const error = ref<string | null>(null);

  /** 记录条数。 */
  const count = computed(() => records.value.length);

  /** 当前选中记录。 */
  const selected = computed<MapleRecord | null>(
    () => records.value.find((r) => r.id === selectedId.value) ?? null,
  );

  /**
   * 重新载入记录列表。
   */
  const reload = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      records.value = await recordsRepo.list();
      // 选中项已被删除时清空。
      if (selectedId.value && !records.value.some((r) => r.id === selectedId.value)) {
        selectedId.value = null;
        selectedSamples.value = [];
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '载入历史记录失败';
    } finally {
      loading.value = false;
    }
  };

  /**
   * 选中一条记录并载入其采样点。
   *
   * @param id 记录 id。
   */
  const select = async (id: string | null): Promise<void> => {
    selectedId.value = id;
    if (!id) {
      selectedSamples.value = [];
      return;
    }
    loading.value = true;
    try {
      selectedSamples.value = await samplesRepo.byRecord(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '载入采样点失败';
      selectedSamples.value = [];
    } finally {
      loading.value = false;
    }
  };

  /**
   * 删除一条记录（连带其采样点），并刷新列表。
   *
   * @param id 记录 id。
   * @returns 是否删除成功。
   */
  const removeRecord = async (id: string): Promise<boolean> => {
    const ok = await recordsRepo.remove(id);
    if (ok) {
      if (selectedId.value === id) {
        selectedId.value = null;
        selectedSamples.value = [];
      }
      await reload();
    }
    return ok;
  };

  /**
   * 清空全部记录与采样点。
   */
  const clearAll = async (): Promise<void> => {
    await recordsRepo.clear();
    records.value = [];
    selectedId.value = null;
    selectedSamples.value = [];
  };

  /**
   * 导出全部记录为 JSON 文本（供下载）。
   *
   * @returns JSON 文本。
   */
  const exportJson = async (): Promise<string> => recordsRepo.exportAll();

  /**
   * 导出全部记录为 `Blob`。
   *
   * @returns JSON Blob。
   */
  const exportBlob = async (): Promise<Blob> => recordsRepo.exportAllBlob();

  /**
   * 从 JSON 文本导入记录。
   *
   * @param text 文件 JSON 文本。
   * @returns 导入结果。
   */
  const importJson = async (text: string): Promise<ImportResult> => {
    const res = await recordsRepo.importAll(text);
    if (res.ok) await reload();
    return res;
  };

  return {
    records,
    selectedId,
    selectedSamples,
    loading,
    error,
    count,
    selected,
    reload,
    select,
    removeRecord,
    clearAll,
    exportJson,
    exportBlob,
    importJson,
  };
});
