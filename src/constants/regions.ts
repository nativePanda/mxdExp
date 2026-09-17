/**
 * 区域清单元数据（`RegionKey` 唯一真相源，架构文档 §3.5.1 / §2.4）。
 *
 * 定稿：共 **6 个区域** ——
 * `expBar`（比例） / `expText`（数值） / `level` / `gold` / `hp` / `mp`。
 *
 * 硬约定：
 * - `expBar` 与 `expText` 是**同一物理区域的两种测量**（数值文字叠印在条上），
 *   默认联动为**同一矩形**（`CalibrationConfig.expSplit=false`），用户只画一次。
 * - `level` / `hp` / `mp` 为**选填**区域；未校准时对应能力降级（见架构 §5.9）。
 * - 本文件是区域清单的唯一真相源，禁止在其他地方再定义一份区域列表。
 */

import type { Region, RegionKey } from '@/types/calibration';

/** 区域消费者：`ratio`=经验条比例（`columnProfile`）；`digits`=文字读数（`readDigits`）。 */
export type RegionConsumer = 'ratio' | 'digits';

/** 单个区域的元数据。 */
export interface RegionMeta {
  /** UI 标签（PRD §5.2 / §6.7 用词）。 */
  label: string;
  /** 是否必填（选填区域缺失时对应能力降级）。 */
  required: boolean;
  /** 消费者：该区域的数据被哪个识别阶段使用。 */
  consumers: RegionConsumer[];
  /** 默认与谁联动为同一矩形；无联动为 `null`。 */
  linkedWith: RegionKey | null;
  /** 该区域用途简述（UI 提示 / 诊断信息）。 */
  description: string;
}

/**
 * 六个区域的元数据表（架构 §3.5.1 定稿，逐条对齐）。
 *
 * | RegionKey | 物理含义 | 消费者 | 必填 | 默认与谁联动 |
 * |-----------|---------|--------|------|------------|
 * | expBar    | 经验条填充区 | columnProfile（比例） | 必填 | 与 expText 同矩形 |
 * | expText   | 经验数值文字 | readDigits（当前经验绝对值） | 必填 | 与 expBar 同矩形 |
 * | level     | 等级数字 | readDigits（等级） | 选填 | — |
 * | gold      | 金币数值 | readDigits | 必填 | — |
 * | hp        | HP 数值 | readDigits | 选填 | — |
 * | mp        | MP 数值 | readDigits | 选填 | — |
 */
export const REGION_META: Record<RegionKey, RegionMeta> = {
  expBar: {
    label: '经验条',
    required: true,
    consumers: ['ratio'],
    linkedWith: 'expText',
    description: '经验条填充区，用于像素法计算本级经验比例',
  },
  expText: {
    label: '经验数值',
    required: true,
    consumers: ['digits'],
    linkedWith: 'expBar',
    description: '经验数值文字，用于读取当前经验绝对值（默认与经验条同矩形）',
  },
  level: {
    label: '等级',
    required: false,
    consumers: ['digits'],
    linkedWith: null,
    description: '等级数字（选填）；未校准时升级检测降级为纯数值判定',
  },
  gold: {
    label: '金币',
    required: true,
    consumers: ['digits'],
    linkedWith: null,
    description: '金币数值，用于计算金币/小时',
  },
  hp: {
    label: 'HP',
    required: false,
    consumers: ['digits'],
    linkedWith: null,
    description: 'HP 数值（选填，P1 角色状态卡片）',
  },
  mp: {
    label: 'MP',
    required: false,
    consumers: ['digits'],
    linkedWith: null,
    description: 'MP 数值（选填，P1 角色状态卡片）',
  },
};

/** 必填区域键列表（`expBar` / `expText` / `gold`）。 */
export const REQUIRED_REGION_KEYS: readonly RegionKey[] = (
  Object.keys(REGION_META) as RegionKey[]
).filter((key) => REGION_META[key].required);

/** 选填区域键列表（`level` / `hp` / `mp`）。 */
export const OPTIONAL_REGION_KEYS: readonly RegionKey[] = (
  Object.keys(REGION_META) as RegionKey[]
).filter((key) => !REGION_META[key].required);

/**
 * 默认框选位置（未定位状态）——6 个区域横向均匀排布在画面下方。
 *
 * 说明：这里只提供「矩形有效但状态为 `unlocated`」的初始值，方便框选页拖拽起点；
 * 语义上仍属「未校准」，`regions.<key>.status` 均为 `unlocated`。
 * 经验条（`expBar`）与经验数值（`expText`）默认取**同一矩形**。
 */
function defaultRegionFor(key: RegionKey): Region {
  const order: RegionKey[] = ['expBar', 'expText', 'level', 'gold', 'hp', 'mp'];
  const index = order.indexOf(key);
  const slotW = 1 / 6;
  return {
    x: slotW * index,
    y: 0.9,
    w: slotW,
    h: 0.06,
    status: 'unlocated',
  };
}

/** 默认区域矩形（6 键，均为未定位状态）。 */
export const DEFAULT_REGIONS: Record<RegionKey, Region> = {
  expBar: defaultRegionFor('expBar'),
  expText: defaultRegionFor('expText'),
  level: defaultRegionFor('level'),
  gold: defaultRegionFor('gold'),
  hp: defaultRegionFor('hp'),
  mp: defaultRegionFor('mp'),
};

/**
 * 深拷贝一份默认区域表（避免共享引用被就地修改）。
 *
 * @returns 6 键默认区域映射。
 */
export function createDefaultRegions(): Record<RegionKey, Region> {
  return {
    expBar: { ...DEFAULT_REGIONS.expBar },
    expText: { ...DEFAULT_REGIONS.expText },
    level: { ...DEFAULT_REGIONS.level },
    gold: { ...DEFAULT_REGIONS.gold },
    hp: { ...DEFAULT_REGIONS.hp },
    mp: { ...DEFAULT_REGIONS.mp },
  };
}

/**
 * 取某个区域的中文标签（供 UI 列表渲染）。
 *
 * @param key 区域键。
 * @returns 中文标签。
 */
export function regionLabel(key: RegionKey): string {
  return REGION_META[key].label;
}
