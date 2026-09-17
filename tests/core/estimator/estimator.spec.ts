/**
 * `core/estimator` 单测 —— 交叉校验 + 自举经验表。
 *
 * 验收（架构 §7 T02-4/5）：
 * - ★ **复现预研实测**：真值 `requiredExp = 977471`（Lv.56），3 帧读数
 *   （`120619/12.34%`、`468110/47.89%`、`860272/88.01%`）→ 交集应为 `[977416, 977526]`，
 *   `pick()` 结果应精确等于 `977471`（移植正确性的黄金用例）；
 * - 空条 / 无效读数 / 不一致 三条路径；
 * - 升级重置 → `missingCrossLevel`（由 `requirementFor`/交集行为体现）。
 */

import { describe, expect, it } from 'vitest';
import {
  ExpRequirementEstimator,
  intersectRanges,
  isConsistent,
  isValidReading,
  pickFromRange,
  rangeContains,
  rangeFromReading,
  type Range,
} from '@/core/estimator';

/** 预研黄金用例数据。 */
const TRUE_REQ = 977471;

/** 3 帧读数（数值 = floor(比例 × 真值)，比例按 UI 2 位小数）。 */
function goldenFrames(): Array<{ absolute: number; ratio: number; pct: number }> {
  return [12.34, 47.89, 88.01].map((pct) => {
    const ratio = pct / 100;
    return { absolute: Math.floor(ratio * TRUE_REQ), ratio, pct };
  });
}

describe('rangeFromReading —— 移植枫记（语义严格区分）', () => {
  it('空条（absolute=0 && ratio=0）→ null', () => {
    expect(rangeFromReading({ absolute: 0, ratio: 0 })).toBeNull();
  });

  it('无效读数（ably<=0）→ undefined', () => {
    expect(rangeFromReading({ absolute: 0, ratio: 0.5 })).toBeUndefined();
    expect(rangeFromReading({ absolute: 100, ratio: 0 })).toBeUndefined();
  });

  it('正常读数 → Range', () => {
    const r = rangeFromReading({ absolute: 468110, ratio: 0.4789 });
    expect(r).toBeDefined();
    expect(r).not.toBeNull();
    const range = r as Range;
    expect(range.minimum).toBeLessThanOrEqual(range.maximum);
  });

  it('precision 非法 → undefined', () => {
    expect(rangeFromReading({ absolute: 100, ratio: 0.5 }, 9)).toBeUndefined();
  });
});

describe('★ 黄金用例：3 帧收敛到 [977416, 977526] 且 pick = 977471', () => {
  it('复现预研实测结果', () => {
    const frames = goldenFrames();

    // 帧数值应与预研一致。
    expect(frames[0].absolute).toBe(120619);
    expect(frames[1].absolute).toBe(468110);
    expect(frames[2].absolute).toBe(860272);

    const ranges = frames
      .map((f) => rangeFromReading({ absolute: f.absolute, ratio: f.ratio }, 2))
      .filter((r): r is Range => r !== null && r !== undefined);

    expect(ranges.length).toBe(3);
    expect(ranges[0]).toEqual({ minimum: 977068, maximum: 977859 });
    expect(ranges[1]).toEqual({ minimum: 977368, maximum: 977571 });
    expect(ranges[2]).toEqual({ minimum: 977416, maximum: 977526 });

    const shared = intersectRanges(ranges);
    expect(shared).toEqual({ minimum: 977416, maximum: 977526 });

    // 真值落在交集内。
    expect(rangeContains(shared as Range, TRUE_REQ)).toBe(true);

    // pick 结果精确等于真值。
    const picked = pickFromRange(shared as Range, 860272, TRUE_REQ);
    expect(picked).toBe(TRUE_REQ);
  });

  it('pick 在无已知 requiredExp 时返回区间中点', () => {
    const shared: Range = { minimum: 977416, maximum: 977526 };
    // 中点 = 977471（(977416+977526)/2 = 977471）。
    expect(pickFromRange(shared, 0, null)).toBe(977471);
  });

  it('精度越高交集越窄（0/1/2 位）', () => {
    const widths = [0, 1, 2].map((prec) => {
      const pcts = [12.3, 47.9, 88.0].map((p) => p / 100);
      const rs = pcts
        .map((r) => rangeFromReading({ absolute: Math.floor(r * TRUE_REQ), ratio: r }, prec))
        .filter((x): x is Range => x !== null && x !== undefined);
      const sh = intersectRanges(rs);
      return sh ? sh.maximum - sh.minimum : Number.NaN;
    });
    // 位数越多，区间越窄（严格递减或至少不增）。
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });
});

describe('isConsistent —— 交叉校验', () => {
  it('读数与已知 requiredExp 自洽 → true', () => {
    const f = goldenFrames()[1];
    expect(isConsistent({ absolute: f.absolute, ratio: f.ratio, estimated: false }, TRUE_REQ)).toBe(
      true,
    );
  });

  it('文字与比例打架 → false（"文字数值与血条比例不一致"）', () => {
    // 文字说 50% 但比例显示 40%。
    const bad = { absolute: Math.floor(0.5 * TRUE_REQ), ratio: 0.4, estimated: false };
    expect(isConsistent(bad, TRUE_REQ)).toBe(false);
  });

  it('无效读数 → false', () => {
    expect(isConsistent({ absolute: null, ratio: 0.5, estimated: false }, TRUE_REQ)).toBe(false);
    expect(isConsistent({ absolute: 100, ratio: null, estimated: false }, TRUE_REQ)).toBe(false);
  });

  it('空条 + requiredExp 冲突 → 仍判 true（空条语义）', () => {
    expect(isConsistent({ absolute: 0, ratio: 0, estimated: false }, TRUE_REQ)).toBe(true);
  });
});

describe('isValidReading', () => {
  it('valid', () => {
    expect(isValidReading({ absolute: 100, ratio: 0.5, estimated: false })).toBe(true);
  });
  it('estimated → invalid', () => {
    expect(isValidReading({ absolute: 100, ratio: 0.5, estimated: true })).toBe(false);
  });
  it('ratio > 1 → invalid', () => {
    expect(isValidReading({ absolute: 100, ratio: 1.5, estimated: false })).toBe(false);
  });
});

describe('ExpRequirementEstimator.observe —— 自举收敛', () => {
  it('3 帧读数后被接受，requiredExp 收敛到真值附近', () => {
    const est = new ExpRequirementEstimator();
    const frames = goldenFrames();

    const r0 = est.observe(56, { absolute: frames[0].absolute, ratio: frames[0].ratio, estimated: false }, 0);
    // 第 1 帧：样本不足 → confirming。
    expect(r0.accepted).toBe(false);
    expect(r0.confirming).toBe(true);

    const r1 = est.observe(56, { absolute: frames[1].absolute, ratio: frames[1].ratio, estimated: false }, 1000);
    expect(r1.accepted).toBe(false);

    const r2 = est.observe(56, { absolute: frames[2].absolute, ratio: frames[2].ratio, estimated: false }, 2000);
    expect(r2.accepted).toBe(true);
    expect(r2.requiredExp).toBe(TRUE_REQ);

    expect(est.requirementFor(56)).toBe(TRUE_REQ);
  });

  it('independentlyConfirmed → 1 帧即确认', () => {
    const est = new ExpRequirementEstimator();
    const f = goldenFrames()[2];
    const r = est.observe(
      56,
      { absolute: f.absolute, ratio: f.ratio, estimated: false },
      0,
      { independentlyConfirmed: true },
    );
    expect(r.accepted).toBe(true);
    expect(r.requiredExp).not.toBeNull();
  });

  it('无效读数 → accepted:false', () => {
    const est = new ExpRequirementEstimator();
    const r = est.observe(56, { absolute: null, ratio: null, estimated: false }, 0);
    expect(r.accepted).toBe(false);
    expect(r.confirming).toBe(false);
  });

  it('非法等级 → accepted:false', () => {
    const est = new ExpRequirementEstimator();
    const r = est.observe(0, { absolute: 100, ratio: 0.5, estimated: false }, 0);
    expect(r.accepted).toBe(false);
  });

  it('空条需连续 3 帧才确认（ZERO_CONFIRM_SAMPLES）', () => {
    const est = new ExpRequirementEstimator();
    const r1 = est.observe(56, { absolute: 0, ratio: 0, estimated: false }, 0);
    expect(r1.accepted).toBe(false);
    const r2 = est.observe(56, { absolute: 0, ratio: 0, estimated: false }, 1000);
    expect(r2.accepted).toBe(false);
    const r3 = est.observe(56, { absolute: 0, ratio: 0, estimated: false }, 2000);
    expect(r3.accepted).toBe(true);
    expect(r3.requiredExp).toBeNull();
    expect(est.requirementFor(56)).toBeNull();
  });
});

describe('ExpRequirementEstimator —— seed / reset / requirementFor', () => {
  it('seed(requiredExp) → 立即确认', () => {
    const est = new ExpRequirementEstimator();
    est.seed(56, { requiredExp: TRUE_REQ });
    expect(est.requirementFor(56)).toBe(TRUE_REQ);
  });

  it('seed(absolute=0, ratio=0) → 确认为空条', () => {
    const est = new ExpRequirementEstimator();
    est.seed(56, { absolute: 0, ratio: 0 });
    expect(est.requirementFor(56)).toBeNull();
  });

  it('未观察过的等级 → undefined', () => {
    const est = new ExpRequirementEstimator();
    expect(est.requirementFor(99)).toBeUndefined();
  });

  it('reset(seed) 清空并按 seed 预置', () => {
    const est = new ExpRequirementEstimator();
    est.seed(56, { requiredExp: TRUE_REQ });
    est.reset({ level: 57, value: { requiredExp: 1_000_000 } });
    expect(est.requirementFor(56)).toBeUndefined();
    expect(est.requirementFor(57)).toBe(1_000_000);
  });

  it('读数的 requiredExp 直接给出 → 立即确认（优先级最高）', () => {
    const est = new ExpRequirementEstimator();
    const r = est.observe(
      56,
      { absolute: 100, ratio: 0.5, estimated: false, requiredExp: TRUE_REQ },
      0,
    );
    expect(r.accepted).toBe(true);
    expect(r.requiredExp).toBe(TRUE_REQ);
  });
});

describe('ExpRequirementEstimator —— 升级重置（跨级经验缺失）', () => {
  it('等级跳变后新等级需重新自举（旧等级不受影响）', () => {
    const est = new ExpRequirementEstimator();

    // Lv.56 已确认。
    est.seed(56, { requiredExp: TRUE_REQ });
    expect(est.requirementFor(56)).toBe(TRUE_REQ);

    // 升级到 Lv.57，经验条归零 → 空条路径。
    const rZero = est.observe(57, { absolute: 0, ratio: 0, estimated: false }, 3000);
    expect(rZero.accepted).toBe(false); // 首帧空条 → 需累积

    // Lv.57 尚在自举中 → undefined（未知）。
    expect(est.requirementFor(57)).toBeUndefined();
    // Lv.56 的确认值不受影响。
    expect(est.requirementFor(56)).toBe(TRUE_REQ);
  });

  it('升级后新等级按 3 帧自举可确认', () => {
    const est = new ExpRequirementEstimator();
    const newReq = 1_035_000;
    const pcts = [0.2, 0.55, 0.9];
    // 先推进 3 帧（不依赖 crossed level 的具体值）。
    let last = est.observe(57, { absolute: 0, ratio: 0, estimated: false }, 0);
    void last;
    est.observe(57, { absolute: 0, ratio: 0, estimated: false }, 500);
    est.observe(57, { absolute: 0, ratio: 0, estimated: false }, 1000);

    for (const p of pcts) {
      last = est.observe(
        57,
        { absolute: Math.floor(p * newReq), ratio: p, estimated: false },
        1500 + Math.round(p * 1000),
      );
    }
    expect(last.accepted).toBe(true);
    expect(est.requirementFor(57)).toBe(last.requiredExp);
  });
});

describe('intersectRanges', () => {
  it('空列表 → undefined', () => {
    expect(intersectRanges([])).toBeUndefined();
  });

  it('无交集 → undefined', () => {
    expect(intersectRanges([{ minimum: 1, maximum: 5 }, { minimum: 10, maximum: 20 }])).toBeUndefined();
  });

  it('有交集 → 收紧区间', () => {
    expect(
      intersectRanges([
        { minimum: 1, maximum: 10 },
        { minimum: 5, maximum: 20 },
        { minimum: 0, maximum: 8 },
      ]),
    ).toEqual({ minimum: 5, maximum: 8 });
  });
});
