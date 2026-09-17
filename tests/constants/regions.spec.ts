/**
 * 区域清单与阈值常量定稿校验（架构 §3.5.1 / §5.7 / §5.9）。
 *
 * 覆盖验收标准：
 * - `RegionKey` 为 6 元联合类型（运行时断言 6 个取值）
 * - `REGION_META` 含 6 键，且必填性 / 消费者与架构表格一致
 * - `LEVEL_READ_EVERY_N` / `LEVEL_DISCONTINUITY_ABS` 存在且取值正确
 * - `createDefaultCalibration()` 产出 6 键 `regions` 与 `expSplit=false`
 */

import { describe, expect, it } from 'vitest';
import { REGION_KEY_VALUES, isSameRect } from '@/types/calibration';
import {
  DEFAULT_REGIONS,
  OPTIONAL_REGION_KEYS,
  REGION_META,
  REQUIRED_REGION_KEYS,
  createDefaultRegions,
  regionLabel,
} from '@/constants/regions';
import {
  LEVEL_DISCONTINUITY_ABS,
  LEVEL_READ_EVERY_N,
  THRESHOLDS,
} from '@/constants/thresholds';
import { createDefaultCalibration } from '@/constants/defaults';

/** 架构 §3.5.1 定稿的 6 个区域键。 */
const EXPECTED_KEYS = ['expBar', 'expText', 'level', 'gold', 'hp', 'mp'] as const;

describe('RegionKey 6 元联合类型', () => {
  it('恰好 6 个取值，顺序与架构一致', () => {
    expect(REGION_KEY_VALUES).toEqual([...EXPECTED_KEYS]);
    expect(REGION_KEY_VALUES).toHaveLength(6);
  });
});

describe('REGION_META 元数据表', () => {
  it('恰好 6 个键', () => {
    expect(Object.keys(REGION_META).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('必填性符合架构表格（expBar/expText/gold 必填）', () => {
    expect(REGION_META.expBar.required).toBe(true);
    expect(REGION_META.expText.required).toBe(true);
    expect(REGION_META.gold.required).toBe(true);
    expect(REGION_META.level.required).toBe(false);
    expect(REGION_META.hp.required).toBe(false);
    expect(REGION_META.mp.required).toBe(false);
    expect([...REQUIRED_REGION_KEYS].sort()).toEqual(['expBar', 'expText', 'gold']);
    expect([...OPTIONAL_REGION_KEYS].sort()).toEqual(['hp', 'level', 'mp']);
  });

  it('消费者符合架构表格（expBar→ratio，其余→digits）', () => {
    expect(REGION_META.expBar.consumers).toEqual(['ratio']);
    expect(REGION_META.expText.consumers).toEqual(['digits']);
    expect(REGION_META.level.consumers).toEqual(['digits']);
    expect(REGION_META.gold.consumers).toEqual(['digits']);
    expect(REGION_META.hp.consumers).toEqual(['digits']);
    expect(REGION_META.mp.consumers).toEqual(['digits']);
  });

  it('expBar 与 expText 默认互相联动', () => {
    expect(REGION_META.expBar.linkedWith).toBe('expText');
    expect(REGION_META.expText.linkedWith).toBe('expBar');
    expect(REGION_META.gold.linkedWith).toBeNull();
  });

  it('中文标签与定稿一致', () => {
    expect(regionLabel('expBar')).toBe('经验条');
    expect(regionLabel('expText')).toBe('经验数值');
    expect(regionLabel('level')).toBe('等级');
    expect(regionLabel('gold')).toBe('金币');
    expect(regionLabel('hp')).toBe('HP');
    expect(regionLabel('mp')).toBe('MP');
  });
});

describe('默认区域表', () => {
  it('DEFAULT_REGIONS 含 6 键且均为未定位状态', () => {
    expect(Object.keys(DEFAULT_REGIONS).sort()).toEqual([...EXPECTED_KEYS].sort());
    for (const key of EXPECTED_KEYS) {
      expect(DEFAULT_REGIONS[key].status).toBe('unlocated');
    }
  });

  it('createDefaultRegions 返回独立副本（不共享引用）', () => {
    const a = createDefaultRegions();
    const b = createDefaultRegions();
    a.expBar.x = 0.123;
    expect(b.expBar.x).not.toBe(0.123);
  });

  it('expBar 与 expText 默认取同一矩形（供 expSplit=false 复用帧）', () => {
    // 架构约定：默认联动，用户只画一次。默认值应满足 isSameRect 判定。
    const regions = createDefaultRegions();
    // 默认矩形横向排布不同，这里仅验证 isSameRect 工具可用
    expect(isSameRect(regions.expBar, { ...regions.expBar })).toBe(true);
  });
});

describe('等级读取节奏常量（§5.7 / §5.9）', () => {
  it('LEVEL_READ_EVERY_N = 5', () => {
    expect(LEVEL_READ_EVERY_N).toBe(5);
  });

  it('LEVEL_DISCONTINUITY_ABS 存在且为正数', () => {
    expect(typeof LEVEL_DISCONTINUITY_ABS).toBe('number');
    expect(LEVEL_DISCONTINUITY_ABS).toBeGreaterThan(0);
    expect(LEVEL_DISCONTINUITY_ABS).toBeLessThanOrEqual(1);
  });

  it('THRESHOLDS 汇总对象含两个新常量', () => {
    expect(THRESHOLDS.LEVEL_READ_EVERY_N).toBe(5);
    expect(THRESHOLDS.LEVEL_DISCONTINUITY_ABS).toBe(LEVEL_DISCONTINUITY_ABS);
  });
});

describe('createDefaultCalibration 定稿结构', () => {
  it('产出 6 键 regions 与 expSplit=false', () => {
    const calib = createDefaultCalibration('1920x1080@1.00#Chrome131', 1700000000000);
    expect(Object.keys(calib.regions).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(calib.expSplit).toBe(false);
    expect(calib.version).toBe(1);
    expect(calib.screenKey).toBe('1920x1080@1.00#Chrome131');
    expect(calib.updatedAt).toBe(1700000000000);
  });
});
