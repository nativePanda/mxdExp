/**
 * 出厂默认值（PRD §6.7 / §6.9 / P0-21）。
 *
 * 硬约定：所有默认值集中在此，供「恢复出厂设置」与首次启动复用。
 */

import type { CalibrationConfig } from '@/types/calibration';
import type { AppSettings } from './appSettings';
import { createDefaultRegions } from './regions';
import {
  RATE_ARROW,
  RATE_HIDE,
  RATE_HIDE_DELAY_MS,
} from './thresholds';

/** 校准配置的当前版本号（分辨率变化时旧的视为失效）。 */
export const CALIBRATION_VERSION = 1;

/**
 * 创建一份「全部恢复默认」的校准配置。
 *
 * 说明：区域清单（6 键）与默认矩形来自 `constants/regions.ts`（唯一真相源）。
 * 默认 `expSplit=false`，即 `expBar` 与 `expText` 联动为同一矩形。
 *
 * @param screenKey 当前画面的指纹；未知时传空串。
 * @param now 生成时间戳（`Date.now()`），默认当前时间。
 * @returns 默认校准配置。
 */
export function createDefaultCalibration(screenKey = '', now = Date.now()): CalibrationConfig {
  return {
    version: CALIBRATION_VERSION,
    screenKey,
    regions: createDefaultRegions(),
    expSplit: false,
    updatedAt: now,
  };
}

/** 出厂默认设置（PRD §6.9）。 */
export const DEFAULT_SETTINGS: AppSettings = {
  perfTier: 'default',
  captureFps: 1,
  checkFps: 1,
  rateCompare: {
    arrowThreshold: RATE_ARROW,
    hideThreshold: RATE_HIDE,
    hideDelayMs: RATE_HIDE_DELAY_MS,
  },
};

/** 默认设置的深拷贝工厂（避免共享引用被修改）。 */
export function createDefaultSettings(): AppSettings {
  return {
    perfTier: DEFAULT_SETTINGS.perfTier,
    captureFps: DEFAULT_SETTINGS.captureFps,
    checkFps: DEFAULT_SETTINGS.checkFps,
    rateCompare: { ...DEFAULT_SETTINGS.rateCompare },
  };
}

/** 模板库默认渲染管线标识（对应 glyphSource 的 scale=3）。 */
export const DEFAULT_TEMPLATE_SCALE_KEY = 's3';

/** 使用持久化的键名统一常量。 */
export const KV_KEYS = {
  /** 应用设置。 */
  settings: 'app.settings',
  /** 用户自定义字形模板库。 */
  customTemplates: 'templates.custom',
  /** 内置字形模板库（首次生成的序列化快照）。 */
  defaultTemplates: 'templates.default',
} as const;

/** `KV_KEYS` 值的联合类型。 */
export type KvKey = (typeof KV_KEYS)[keyof typeof KV_KEYS];
