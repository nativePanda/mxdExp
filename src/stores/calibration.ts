/**
 * CalibrationStore —— 校准配置状态（6 区域框选 + `expSplit`），持久化到 `calibrationRepo`。
 *
 * 依据：架构文档 §2.11 / §3.6 + §3.5.1（区域清单）+ §5.1（归一化坐标）。
 *
 * ## 职责
 * - 持有当前画面的 `CalibrationConfig`（6 个区域的归一化矩形 + 定位状态 + `expSplit`）；
 * - 提供框选期的高频就地更新（拖拽/调整矩形）与「确认保存」两条路径；
 * - 载入/保存与 `screenKey` 绑定：分辨率 / DPR / UA 变化时旧配置视为失效（需重标）；
 * - `expSplit=false` 时 `expBar` 与 `expText` **联动为同一矩形**（用户只画一次）。
 *
 * ## 硬约定
 * - 所有区域坐标为 **0–1 归一化**（相对原始视频尺寸），像素换算统一走 `useFrameGrabber`；
 * - 枚举/文案（`RegionStatus` 等）一律引用 `@/types`，不在此重复定义；
 * - 默认区域矩形来自 `constants/regions`（唯一真相源）。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { CalibrationConfig, Region, RegionKey, RegionRect } from '@/types/calibration';
import { REGION_KEY_VALUES } from '@/types/calibration';
import type { RegionStatus } from '@/types/enums';
import { calibrationRepo } from '@/db';
import { CALIBRATION_VERSION, createDefaultCalibration } from '@/constants/defaults';
import { createDefaultRegions } from '@/constants/regions';
import { isRectValid, clampRect } from '@/types/calibration';

/**
 * 校准 store（setup 风格）。
 */
export const useCalibrationStore = defineStore('calibration', () => {
  /** 当前校准配置（默认起步，未绑 screenKey）。 */
  const config = ref<CalibrationConfig>(createDefaultCalibration(''));

  /** 是否已从持久化载入。 */
  const loaded = ref(false);

  /** 当前 `screenKey`（画面指纹；未连接为 `''`）。 */
  const screenKey = ref<string>('');

  /** 是否存在已保存（已定位）的校准。 */
  const hasSaved = ref(false);

  /** 六个区域（响应式只读视图）。 */
  const regions = computed<Record<RegionKey, Region>>(() => config.value.regions);

  /** 是否已拆分经验条与经验数值框。 */
  const expSplit = computed<boolean>(() => config.value.expSplit);

  /** 必填区域是否全部已定位（矩形有效）。 */
  const requiredLocated = computed<boolean>(() => {
    const required: RegionKey[] = ['expBar', 'expText', 'gold'];
    return required.every((k) => {
      const r = config.value.regions[k];
      return !!r && isRectValid(r);
    });
  });

  /** 已定位区域数量（用于进度展示）。 */
  const locatedCount = computed<number>(() =>
    REGION_KEY_VALUES.filter((k) => config.value.regions[k].status === 'located').length,
  );

  /**
   * 依据给定 `screenKey` 载入校准配置。
   *
   * 行为：命中则用持久化配置；未命中则回落到「最近更新的一条」（跨分辨率兜底），
   * 仍无则用默认（全部未定位）。载入后 `version` 不匹配则视为失效（保留矩形但重置状态）。
   *
   * @param nextScreenKey 当前画面指纹。
   */
  const load = async (nextScreenKey: string): Promise<void> => {
    screenKey.value = nextScreenKey;
    let saved = await calibrationRepo.get(nextScreenKey);
    if (!saved) {
      saved = await calibrationRepo.getLatest();
    }
    if (saved) {
      // 分辨率/版本不匹配：视为未校准（矩形保留作参考，状态重置为未定位）。
      const versionMismatch = saved.version !== CALIBRATION_VERSION;
      const screenMismatch = !!nextScreenKey && saved.screenKey !== nextScreenKey;
      if (versionMismatch || screenMismatch) {
        config.value = {
          ...saved,
          version: CALIBRATION_VERSION,
          screenKey: nextScreenKey,
          regions: resetRegionStatuses(saved.regions),
          updatedAt: Date.now(),
        };
        hasSaved.value = false;
      } else {
        config.value = saved;
        hasSaved.value = true;
      }
    } else {
      config.value = createDefaultCalibration(nextScreenKey);
      hasSaved.value = false;
    }
    loaded.value = true;
  };

  /**
   * 就地更新单个区域的矩形（框选期高频调用，不落库）。
   *
   * - 自动裁剪到 `[0,1]`；
   * - `expSplit=false` 且该区域为 `expBar`/`expText` 时，**联动**更新另一者（同矩形）；
   * - 状态置为 `located`（矩形有效时）。
   *
   * @param key 区域键。
   * @param rect 新矩形（归一化）。
   */
  const setRegionRect = (key: RegionKey, rect: RegionRect): void => {
    const clamped = clampRect(rect);
    const status: RegionStatus = isRectValid(clamped) ? 'located' : 'unlocated';
    const next = { ...config.value.regions };
    next[key] = { ...clamped, status };
    // 联动：expBar ↔ expText 同矩形（未拆分时）。
    if (!config.value.expSplit) {
      const link = key === 'expBar' ? 'expText' : key === 'expText' ? 'expBar' : null;
      if (link) next[link] = { ...clamped, status };
    }
    config.value = { ...config.value, regions: next, updatedAt: Date.now() };
  };

  /**
   * 设定某区域的定位状态。
   *
   * @param key 区域键。
   * @param status 定位状态。
   */
  const setRegionStatus = (key: RegionKey, status: RegionStatus): void => {
    const next = { ...config.value.regions };
    next[key] = { ...next[key], status };
    config.value = { ...config.value, regions: next, updatedAt: Date.now() };
  };

  /**
   * 撤销 `expSplit` 联动：把 `expBar` 与 `expText` 拆为独立矩形。
   *
   * 拆分后初始仍取同一矩形（用户可分别调整）。
   */
  const splitExpRegions = (): void => {
    const bar = config.value.regions.expBar;
    config.value = {
      ...config.value,
      expSplit: true,
      regions: {
        ...config.value.regions,
        expText: { ...bar, status: config.value.regions.expText.status },
      },
      updatedAt: Date.now(),
    };
  };

  /**
   * 恢复默认（全部未定位 + 默认矩形），并落库覆盖当前 `screenKey`。
   */
  const resetDefault = async (): Promise<void> => {
    config.value = {
      version: CALIBRATION_VERSION,
      screenKey: screenKey.value,
      regions: createDefaultRegions(),
      expSplit: false,
      updatedAt: Date.now(),
    };
    hasSaved.value = false;
    await calibrationRepo.save(config.value);
  };

  /**
   * 确认保存当前校准配置（绑定当前 `screenKey`）。
   *
   * @returns 保存后的 `screenKey`。
   */
  const save = async (): Promise<string> => {
    const toSave: CalibrationConfig = {
      ...config.value,
      version: CALIBRATION_VERSION,
      screenKey: screenKey.value,
      updatedAt: Date.now(),
    };
    config.value = toSave;
    const key = await calibrationRepo.save(toSave);
    hasSaved.value = true;
    return key;
  };

  /**
   * 清空全部校准配置（「恢复出厂设置」用）。
   */
  const clearAll = async (): Promise<void> => {
    await calibrationRepo.clear();
    config.value = createDefaultCalibration(screenKey.value);
    hasSaved.value = false;
  };

  return {
    config,
    loaded,
    screenKey,
    hasSaved,
    regions,
    expSplit,
    requiredLocated,
    locatedCount,
    load,
    setRegionRect,
    setRegionStatus,
    splitExpRegions,
    resetDefault,
    save,
    clearAll,
  };
});

/**
 * 把一份区域表的定位状态全部重置为 `unlocated`（矩形保留）。
 *
 * @param regions 区域映射。
 * @returns 新的区域映射（状态重置）。
 */
function resetRegionStatuses(regions: Record<RegionKey, Region>): Record<RegionKey, Region> {
  const out = {} as Record<RegionKey, Region>;
  for (const key of REGION_KEY_VALUES) {
    out[key] = { ...regions[key], status: 'unlocated' };
  }
  return out;
}
