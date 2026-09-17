/**
 * 自举经验表 + 交叉校验 —— **逐行移植枫记 `exp-requirement-estimator`**。
 *
 * 参考（只读，不 import）：`probe/_estimator_pretty.js`。
 * 对照表（反混淆 → 本实现）：
 *
 * | 枫记函数 | 本实现 |
 * |---------|--------|
 * | `o` (`rangeFromReading`) | `rangeFromReading.ts` 的 `rangeFromReading` |
 * | `s` (`intersect`)        | `rangeFromReading.ts` 的 `intersectRanges` |
 * | `c` (`contains`)         | `rangeFromReading.ts` 的 `rangeContains` |
 * | `l` (`pick`)             | `rangeFromReading.ts` 的 `pickFromRange` |
 * | `f` (`isMonotonicSample`)| `guards.ts` 的 `isMonotonicSample` |
 * | `p` (`validReading`)     | `rangeFromReading.ts` 的 `isValidReading` |
 * | `m` (`toRequiredExp`)    | `guards.ts` 的 `toRequiredExp` |
 * | `h` (`isValidLevel`)     | `guards.ts` 的 `isValidLevel` |
 * | `g`/`_`/`v` (结果构造)    | 本文件 `accept` / `pending` / `reject` |
 *
 * 语义要点（严格保留）：
 * - `requirementFor(level)`：`number` = 已确认；`null` = 已确认为「空条」；
 *   `undefined` = 未知。
 * - `observe` 返回 `ObserveResult{accepted, requiredExp, approximate, confirming}`。
 * - 多帧区间**取交集**，连续 `SAMPLE_CACHE_PER_LEVEL` 帧稳定 → 确认。
 * - 零样本（空条）需连续 `ZERO_CONFIRM_SAMPLES` 帧才确认。
 *
 * 纯 TypeScript，零 DOM 依赖。
 */

import type { ExpReading } from '@/types';
import { PERCENTAGE_PRECISION, SAMPLE_CACHE_PER_LEVEL, ZERO_CONFIRM_SAMPLES } from '@/constants';
import {
  intersectRanges,
  isValidReading,
  pickFromRange,
  rangeContains,
  rangeFromReading,
  ratioToAbsolute,
  type Range,
} from './rangeFromReading';
import {
  isMonotonicSample,
  isValidLevel,
  toRequiredExp,
  type CandidateSample,
} from './guards';

/** `observe` 的结果（枫记 `ObserveResult`）。 */
export interface ObserveResult {
  /** 是否被接受（本帧可用）。 */
  accepted: boolean;
  /** 本级所需经验；`null` = 确认为空条。 */
  requiredExp: number | null;
  /** 该结果是否为估算/近似值。 */
  approximate: boolean;
  /** 是否仍在确认中（尚未收敛）。 */
  confirming: boolean;
}

/** `observe` 的可选参数。 */
export interface ObserveOptions {
  /** 已知的本级所需经验（内置表 / 已确认）。 */
  requiredExp?: number | null;
  /** 百分比小数位，默认 `PERCENTAGE_PRECISION`。 */
  percentagePrecision?: number;
  /** 强制 1 帧确认（内部/高置信场景）。 */
  independentlyConfirmed?: boolean;
}

/** 单个等级的累积状态（枫记 `LevelState`）。 */
interface LevelState {
  /** 已确认的 requiredExp；`undefined` = 未知；`null` = 确认为空条。 */
  confirmed: number | null | undefined;
  /** 候选样本缓存。 */
  samples: CandidateSample[];
  /** 空条样本的时刻缓存（最近 3 个）。 */
  zeroSamples: number[];
  /** 是否已确认为空条。 */
  zeroConfirmed: boolean;
}

/**
 * 自举经验表估算器。
 *
 * 按等级维护 `confirmed` 与候选样本；`observe` 逐帧喂入读数，多帧交集收敛后确认。
 */
export class ExpRequirementEstimator {
  /** 等级 → 状态。 */
  private levels: Map<number, LevelState> = new Map();

  /**
   * 重置全部状态；可选预置一个等级的种子。
   *
   * @param seed 预置项：`{level, value:{requiredExp?, absolute?, ratio?}}`。
   */
  reset(seed?: {
    level: number;
    value: { requiredExp?: number; absolute?: number; ratio?: number };
  }): void {
    this.levels.clear();
    if (seed) {
      this.seed(seed.level, {
        requiredExp: seed.value.requiredExp ?? null,
        absolute: seed.value.absolute ?? null,
        ratio: seed.value.ratio ?? null,
      });
    }
  }

  /**
   * 预置某等级的已知值（冷启动用）。
   *
   * 分支（与枫记 `seed` 一致）：
   * - 若 `reading.requiredExp` 合法 → 直接确认；
   * - 否则若 `absolute === 0 && ratio === 0` → 标记为「已确认为空条」。
   *
   * @param level 等级。
   * @param reading 读数（可只填 `requiredExp` 或 `absolute/ratio`）。
   */
  seed(
    level: number,
    reading: { requiredExp?: number | null; absolute?: number | null; ratio?: number | null },
  ): void {
    if (!isValidLevel(level)) return;

    const req = toRequiredExp(reading.requiredExp);
    if (req !== null) {
      this.levels.set(level, {
        confirmed: req,
        samples: [],
        zeroSamples: [],
        zeroConfirmed: false,
      });
      return;
    }

    if (reading.absolute === 0 && reading.ratio === 0) {
      this.levels.set(level, {
        confirmed: undefined,
        samples: [],
        zeroSamples: [],
        zeroConfirmed: true,
      });
    }
  }

  /**
   * 查询某等级的 requiredExp。
   *
   * @param level 等级。
   * @returns `number` = 已确认；`null` = 已确认为空条；`undefined` = 未知。
   */
  requirementFor(level: number): number | null | undefined {
    const st = this.levels.get(level);
    if (!st) return undefined;
    if (st.confirmed !== undefined) return st.confirmed;
    return st.zeroConfirmed ? null : undefined;
  }

  /**
   * 喂入一帧读数并推进状态机（枫记 `observe`）。
   *
   * @param level 等级。
   * @param reading 读数（`{absolute,ratio,estimated,requiredExp?,sourceAt?}`）。
   * @param sourceAt 源帧时刻（ms）。
   * @param opts 可选参数。
   * @returns `ObserveResult`。
   */
  observe(
    level: number,
    reading: Pick<ExpReading, 'absolute' | 'ratio' | 'estimated'> & { requiredExp?: number | null },
    sourceAt: number,
    opts: ObserveOptions = {},
  ): ObserveResult {
    if (!isValidLevel(level) || !isValidReading(reading) || !Number.isFinite(sourceAt)) {
      return reject(null);
    }

    const st: LevelState =
      this.levels.get(level) ?? {
        confirmed: undefined,
        samples: [],
        zeroSamples: [],
        zeroConfirmed: false,
      };
    this.levels.set(level, st);

    // (1) 读数的 requiredExp 直接给了确定值 → 立即确认。
    const direct = toRequiredExp(reading.requiredExp);
    if (direct !== null) {
      st.confirmed = direct;
      st.samples = [];
      st.zeroSamples = [];
      st.zeroConfirmed = false;
      return accept(direct);
    }

    // (2) 空条处理（absolute===0 && ratio===0）。
    if (reading.absolute === 0 && reading.ratio === 0) {
      if (st.confirmed !== undefined) return accept(st.confirmed);
      if (st.zeroConfirmed) return accept(null);

      const last = st.zeroSamples.length > 0 ? st.zeroSamples[st.zeroSamples.length - 1] : undefined;
      if (last !== undefined && sourceAt <= last) {
        return pending(null);
      }

      st.zeroSamples = [...st.zeroSamples.slice(-2), sourceAt];
      if (opts.independentlyConfirmed || st.zeroSamples.length >= ZERO_CONFIRM_SAMPLES) {
        st.zeroConfirmed = true;
        st.zeroSamples = [];
        return accept(null);
      }
      return pending(null);
    }

    // (3) 正常读数 → 反推区间（枫记 `o`）。
    //     注意：`rangeFromReading` 对「空条」返回 `null`、对「无效读数」返回 `undefined`，
    //     枫记用 `if(!s)` 把两者一并归为"本帧不可用"，本实现保持一致。
    const precision = opts.percentagePrecision ?? PERCENTAGE_PRECISION;
    const range = rangeFromReading(reading, precision);
    if (range === null || range === undefined) {
      return reject(st.confirmed ?? null);
    }

    // (4) 已确认值落在本帧区间内 → 一致，直接接受（枫记 `c(s, i.confirmed)`）。
    if (st.confirmed !== undefined && st.confirmed !== null && rangeContains(range, st.confirmed)) {
      st.samples = [];
      st.zeroSamples = [];
      st.zeroConfirmed = false;
      return accept(st.confirmed);
    }

    // (5) 累积候选，多帧取交集。
    const need = opts.independentlyConfirmed ? 1 : SAMPLE_CACHE_PER_LEVEL;
    const candidate = this.observeRequirementCandidate(st, reading, range, sourceAt, need);

    st.zeroSamples = [];
    st.zeroConfirmed = false;

    if (candidate === null) {
      return pending(st.confirmed ?? null);
    }
    st.confirmed = candidate;
    return accept(candidate);
  }

  /**
   * 候选样本累积 + 交集收敛（枫记 `observeRequirementCandidate`）。
   *
   * @param state 等级状态。
   * @param reading 读数（需 `absolute/ratio`）。
   * @param range 本帧反推区间。
   * @param sourceAt 源帧时刻（ms）。
   * @param need 确认所需样本数（默认 `SAMPLE_CACHE_PER_LEVEL`）。
   * @returns 收敛出的 requiredExp；未收敛返回 `null`。
   */
  private observeRequirementCandidate(
    state: LevelState,
    reading: Pick<ExpReading, 'absolute' | 'ratio'>,
    range: Range,
    sourceAt: number,
    need: number,
  ): number | null {
    const sample: CandidateSample = {
      absolute: reading.absolute as number,
      ratio: reading.ratio as number,
      range,
      sourceAt,
    };

    const last = state.samples.length > 0 ? state.samples[state.samples.length - 1] : undefined;

    // 时间倒退 → 直接忽略本帧（不推进）。
    if (last && sourceAt <= last.sourceAt) {
      return null;
    }

    // 单调则续接，否则重开。
    state.samples = !last || isMonotonicSample(last, sample)
      ? [...state.samples.slice(-(need - 1)), sample]
      : [sample];

    if (state.samples.length < need) return null;

    const shared = intersectRanges(state.samples.map((s) => s.range));
    if (shared) {
      state.samples = [];
      return pickFromRange(shared, sample.absolute, ratioToAbsolute(reading));
    }
    // 交集冲突 → 以当前样本重开。
    state.samples = [sample];
    return null;
  }
}

// ---------------------------------------------------------------------------
// 结果构造（对应枫记 g / _ / v）
// ---------------------------------------------------------------------------

/**
 * 接受结果（枫记 `g`）。
 *
 * @param requiredExp 已确认的 requiredExp（`null` = 空条）。
 * @returns `ObserveResult`。
 */
function accept(requiredExp: number | null): ObserveResult {
  return {
    accepted: true,
    requiredExp,
    approximate: requiredExp !== null,
    confirming: false,
  };
}

/**
 * 确认中结果（枫记 `_`）。
 *
 * @param lastKnown 上次确认值（可为 `null`）。
 * @returns `ObserveResult`。
 */
function pending(lastKnown: number | null): ObserveResult {
  return {
    accepted: false,
    requiredExp: lastKnown,
    approximate: lastKnown !== null,
    confirming: true,
  };
}

/**
 * 拒绝结果（枫记 `v`）。
 *
 * @param lastKnown 上次确认值（默认 `null`）。
 * @returns `ObserveResult`。
 */
function reject(lastKnown: number | null = null): ObserveResult {
  return {
    accepted: false,
    requiredExp: lastKnown,
    approximate: lastKnown !== null,
    confirming: false,
  };
}
