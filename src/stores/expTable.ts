/**
 * ExpTableStore —— 自举经验表状态（读取 / 自举写入）。
 *
 * 依据：架构文档 §2.11 / §3.6 + PRD §6 + 架构 A4（内置表优先，自举用于缺失/近似时）。
 *
 * 持有「等级 → 本级所需经验」映射（内存缓存），并负责与 `expTable` 表同步。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ExpTableRow } from '@/types/models';
import type { ExpTableSource } from '@/types/enums';
import { expTableRepo } from '@/db';

/**
 * 经验表 store（setup 风格）。
 */
export const useExpTableStore = defineStore('expTable', () => {
  /** 等级 → 所需经验（内存缓存；仅含精确值）。 */
  const levelToRequiredExp = ref<Map<number, number>>(new Map());

  /** 完整行缓存（含近似标记/来源）。 */
  const rows = ref<ExpTableRow[]>([]);

  /** 是否已加载。 */
  const loaded = ref(false);

  /** 行数量。 */
  const size = computed(() => rows.value.length);

  /**
   * 从 IndexedDB 载入全部经验表行。
   */
  const load = async (): Promise<void> => {
    const list = await expTableRepo.list();
    rows.value = list;
    const map = new Map<number, number>();
    for (const row of list) map.set(row.level, row.requiredExp);
    levelToRequiredExp.value = map;
    loaded.value = true;
  };

  /**
   * 查询某等级的本级所需经验。
   *
   * @param level 等级。
   * @returns 所需经验；未知返回 `null`。
   */
  const requiredExpFor = (level: number): number | null => {
    const v = levelToRequiredExp.value.get(level);
    return v === undefined ? null : v;
  };

  /**
   * 保存（自举推导出的）一条经验表行，并刷新内存缓存。
   *
   * @param level 等级。
   * @param requiredExp 本级所需经验。
   * @param approximate 是否为近似值，默认 `true`（自举结果）。
   * @param source 来源，默认 `'inferred'`。
   * @param now 更新时间，默认当前时间。
   */
  const save = async (
    level: number,
    requiredExp: number,
    approximate = true,
    source: ExpTableSource = 'inferred',
    now: number = Date.now(),
  ): Promise<void> => {
    await expTableRepo.put(level, requiredExp, approximate, source, now);
    const map = new Map(levelToRequiredExp.value);
    map.set(level, requiredExp);
    levelToRequiredExp.value = map;
    const idx = rows.value.findIndex((r) => r.level === level);
    const row: ExpTableRow = { level, requiredExp, approximate, source, updatedAt: now };
    if (idx >= 0) {
      const next = rows.value.slice();
      next[idx] = row;
      rows.value = next;
    } else {
      rows.value = [...rows.value, row].sort((a, b) => a.level - b.level);
    }
  };

  /**
   * 批量保存经验表行。
   *
   * @param list 行列表。
   */
  const saveMany = async (list: ExpTableRow[]): Promise<void> => {
    if (list.length === 0) return;
    await expTableRepo.bulkPut(list);
    await load();
  };

  /**
   * 清空经验表（恢复出厂设置用）。
   */
  const clear = async (): Promise<void> => {
    await expTableRepo.clear();
    levelToRequiredExp.value = new Map();
    rows.value = [];
  };

  return {
    levelToRequiredExp,
    rows,
    loaded,
    size,
    load,
    requiredExpFor,
    save,
    saveMany,
    clear,
  };
});
