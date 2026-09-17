/**
 * SettingsStore —— 应用设置（性能档位 / 频率 / 速率对比阈值）。
 *
 * 依据：架构文档 §2.11 / §3.6 + PRD §6.9 / P0-20 / P0-21。
 *
 * 持久化键：`KV_KEYS.settings`（`kv` 表）。`resetFactory()` 恢复出厂默认。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AppSettings } from '@/constants/appSettings';
import type { PerfTier } from '@/types/enums';
import {
  createDefaultSettings,
  getPerfPreset,
  clampFps,
  KV_KEYS,
  RATE_ARROW,
  RATE_HIDE,
  RATE_HIDE_DELAY_MS,
} from '@/constants';
import { kvRepo } from '@/db';

/**
 * 设置 store（setup 风格）。
 */
export const useSettingsStore = defineStore('settings', () => {
  /** 当前设置（默认出厂值起步）。 */
  const settings = ref<AppSettings>(createDefaultSettings());

  /** 是否已从持久化加载。 */
  const loaded = ref(false);

  /** 当前性能档位预设。 */
  const preset = computed(() => getPerfPreset(settings.value.perfTier));

  /** 当前采集频率（次/秒）。 */
  const captureFps = computed(() => settings.value.captureFps);

  /** 当前画面检查频率（次/秒）。 */
  const checkFps = computed(() => settings.value.checkFps);

  /**
   * 从 IndexedDB 载入设置（不存在则用出厂默认）。
   */
  const load = async (): Promise<void> => {
    const saved = await kvRepo.get<AppSettings>(KV_KEYS.settings);
    settings.value = sanitizeSettings(saved);
    loaded.value = true;
  };

  /**
   * 保存当前设置到 IndexedDB。
   */
  const save = async (): Promise<void> => {
    await kvRepo.set(KV_KEYS.settings, settings.value);
  };

  /**
   * 设置性能档位（同步更新采集/检查频率为该档位预设）。
   *
   * @param tier 档位。
   */
  const setPerfTier = async (tier: PerfTier): Promise<void> => {
    const p = getPerfPreset(tier);
    settings.value = {
      ...settings.value,
      perfTier: tier,
      captureFps: p.captureFps,
      checkFps: p.checkFps,
    };
    await save();
  };

  /**
   * 直接设置采集频率（约束到合法范围；会解除与档位的联动语义）。
   *
   * @param fps 频率（次/秒）。
   */
  const setCaptureFps = async (fps: number): Promise<void> => {
    settings.value = { ...settings.value, captureFps: clampFps(fps) };
    await save();
  };

  /**
   * 设置画面检查频率。
   *
   * @param fps 频率（次/秒）。
   */
  const setCheckFps = async (fps: number): Promise<void> => {
    settings.value = { ...settings.value, checkFps: clampFps(fps) };
    await save();
  };

  /**
   * 更新速率对比阈值。
   *
   * @param thresholds 部分阈值。
   */
  const setRateCompare = async (thresholds: Partial<AppSettings['rateCompare']>): Promise<void> => {
    settings.value = {
      ...settings.value,
      rateCompare: { ...settings.value.rateCompare, ...thresholds },
    };
    await save();
  };

  /**
   * 恢复出厂设置（重置为默认并持久化）。
   */
  const resetFactory = async (): Promise<void> => {
    settings.value = createDefaultSettings();
    await save();
  };

  return {
    settings,
    loaded,
    preset,
    captureFps,
    checkFps,
    load,
    save,
    setPerfTier,
    setCaptureFps,
    setCheckFps,
    setRateCompare,
    resetFactory,
  };
});

/**
 * 校验并规整一份可能来自旧版本/损坏的设置。
 *
 * @param saved 持久化读到的设置（可能为 `undefined`）。
 * @returns 合法设置。
 */
function sanitizeSettings(saved: AppSettings | undefined): AppSettings {
  const base = createDefaultSettings();
  if (!saved || typeof saved !== 'object') return base;
  const rc = saved.rateCompare ?? base.rateCompare;
  return {
    perfTier: saved.perfTier ?? base.perfTier,
    captureFps: clampFps(saved.captureFps ?? base.captureFps),
    checkFps: clampFps(saved.checkFps ?? base.checkFps),
    rateCompare: {
      arrowThreshold: Number.isFinite(rc.arrowThreshold) ? rc.arrowThreshold : RATE_ARROW,
      hideThreshold: Number.isFinite(rc.hideThreshold) ? rc.hideThreshold : RATE_HIDE,
      hideDelayMs: Number.isFinite(rc.hideDelayMs) ? rc.hideDelayMs : RATE_HIDE_DELAY_MS,
    },
  };
}
