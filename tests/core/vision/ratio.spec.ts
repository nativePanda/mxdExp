/**
 * `core/vision/ratio` 单测 —— 经验条填充比例识别。
 *
 * 验收（架构 §7 T02-1）：
 * - 干净样本比例误差 ≤ 1px（按条宽折算）；
 * - ★ 高光扫过场景经 2D 中值后误差 ≤ 1px（最关键）；
 *   且**必须包含「不用 2D 中值会失败、用了就通过」的对照用例**，证明机制真的在起作用；
 * - 全满 / 全空边界；
 * - 噪声鲁棒性。
 */

import { describe, expect, it } from 'vitest';
import { columnProfile, ratioFromProfiles } from '@/core/vision';
import {
  makeExpBar,
  makeHighlightFrame,
  type ExpBarOptions,
  type FixtureImage,
} from '../../fixtures/bitmapFactory';

/** 经验条几何（同预研 exp1c/exp5c）：宽 400、高 13、边框 1，内区 x∈[1,399)、宽 398。 */
const W = 400;
const H = 13;
const BORDER = 1;
/** 内区（校准框 = 0%~100% 映射区间）。 */
const INNER = { x: 1, y: 1, w: W - 2, h: H - 2 };
const INNER_W = INNER.w; // 398

/**
 * 单帧测量比例（**不用**跨帧 2D 中值，即"会失败"的旧法）。
 *
 * 为了和 `ratioFromProfiles` 形成对照，这里把单帧剖面喂进去（窗口只有 1 帧），
 * 即退化为"单帧读数"。
 *
 * @param img 位图。
 * @returns 比例。
 */
function singleFrameRatio(img: FixtureImage): number {
  const profile = columnProfile(img, INNER, 0.3);
  return ratioFromProfiles([profile]).ratio;
}

/**
 * 多帧 2D 中值比例（推荐做法）。
 *
 * @param frames 位图序列。
 * @returns 比例。
 */
function temporalRatio(frames: FixtureImage[]): number {
  const profiles = frames.map((f) => columnProfile(f, INNER, 0.3));
  return ratioFromProfiles(profiles).ratio;
}

/**
 * 比例误差（px，按条宽折算）。
 *
 * @param measured 测得比例。
 * @param truth 真值比例。
 * @returns 误差（px）。
 */
function errPx(measured: number, truth: number): number {
  return (measured - truth) * INNER_W;
}

describe('columnProfile', () => {
  it('返回与框宽一致的逐列剖面', () => {
    const img = makeExpBar(W, H, 0.5);
    const p = columnProfile(img, INNER, 0.3);
    expect(p.width).toBe(INNER_W);
    expect(p.columns.length).toBe(INNER_W);
  });

  it('填充区列剖面显著高于底色区（30 分位压掉白字）', () => {
    const img = makeExpBar(W, H, 0.5);
    const p = columnProfile(img, INNER, 0.3);
    const leftCol = p.columns[10];
    const rightCol = p.columns[INNER_W - 10];
    expect(leftCol).toBeGreaterThan(rightCol);
    // 橙黄填充 fillness ≈ 239；深棕底 ≈ 25，差距应很大。
    expect(leftCol - rightCol).toBeGreaterThan(100);
  });
});

describe('ratioFromProfiles —— 干净样本（误差 ≤ 1px）', () => {
  const cases: Array<[string, number]> = [
    ['1%', 0.01],
    ['10%', 0.1],
    ['25.07%', 0.2507],
    ['50.01%', 0.5001],
    ['61.80%', 0.618],
    ['90.01%', 0.9001],
    ['99.37%', 0.9937],
  ];

  for (const [label, ratio] of cases) {
    it(`干净样本 ${label} 误差 ≤ 1px`, () => {
      // 用多帧（相同）以模拟稳定读数。
      const frames = Array.from({ length: 3 }, () => makeExpBar(W, H, ratio));
      const measured = temporalRatio(frames);
      const e = Math.abs(errPx(measured, ratio));
      expect(e).toBeLessThanOrEqual(1);
    });
  }
});

describe('ratioFromProfiles —— 全满 / 全空边界', () => {
  it('100% 判全满（isFull=true, ratio=1）', () => {
    const frames = Array.from({ length: 3 }, () => makeExpBar(W, H, 1));
    const r = ratioFromProfiles(frames.map((f) => columnProfile(f, INNER, 0.3)));
    expect(r.isFull).toBe(true);
    expect(r.ratio).toBe(1);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('0% 判全空（isEmpty=true, ratio=0）', () => {
    const frames = Array.from({ length: 3 }, () => makeExpBar(W, H, 0));
    const r = ratioFromProfiles(frames.map((f) => columnProfile(f, INNER, 0.3)));
    expect(r.isEmpty).toBe(true);
    expect(r.ratio).toBe(0);
  });

  it('空输入 → confidence=0（调用方忽略该帧）', () => {
    const r = ratioFromProfiles([]);
    expect(r.confidence).toBe(0);
  });
});

describe('ratioFromProfiles —— 噪声鲁棒性', () => {
  const noises: Array<[string, number]> = [
    ['±5', 5],
    ['±15', 15],
    ['±30', 30],
    ['±50', 50],
  ];

  for (const [label, amp] of noises) {
    it(`噪声 ${label}（真值 40%）误差 ≤ 1px`, () => {
      // 每帧不同噪声种子（模拟真实抖动），跨帧 2D 中值应有免疫性。
      const frames = Array.from({ length: 12 }, (_, i) =>
        makeExpBar(W, H, 0.4, { noiseAmp: amp, noiseSeed: 2000 + i * 331 } satisfies ExpBarOptions),
      );
      const measured = temporalRatio(frames);
      expect(Math.abs(errPx(measured, 0.4))).toBeLessThanOrEqual(1);
    });
  }
});

describe('ratioFromProfiles —— ★ 高光扫过（2D 中值的核心价值）', () => {
  const TRUE_RATIO = 0.5;

  /** 生成 24 帧高光扫过序列（高光 2 个周期 0→400px）。 */
  function highlightSequence(): FixtureImage[] {
    return Array.from({ length: 24 }, (_, i) => makeHighlightFrame(W, H, TRUE_RATIO, i, 12));
  }

  it('对照：单帧读法（不用 2D 中值）在高光扫过时严重失败', () => {
    const frames = highlightSequence();

    // 旧法：每帧独立读数。
    const perFrame = frames.map((f) => singleFrameRatio(f));
    const errs = perFrame.map((r) => Math.abs(errPx(r, TRUE_RATIO)));
    const maxErr = Math.max(...errs);
    const avgErr = errs.reduce((a, b) => a + b, 0) / errs.length;

    // 断言"确实会失败"：单帧最坏误差巨大（高光柱把读数打到 ~1% 或 ~99%）。
    expect(maxErr).toBeGreaterThan(50);
    // 平均误差也显著（说明高光扫过期间单帧读数整体不可信）。
    expect(avgErr).toBeGreaterThan(30);

    // 也顺带证明：确实有大量帧被高光污染（读数偏离真值 > 10px）。
    const polluted = errs.filter((e) => e > 10).length;
    expect(polluted).toBeGreaterThan(10);
  });

  it('★ 用了跨帧 2D 中值：误差 ≤ 1px', () => {
    const frames = highlightSequence();
    const measured = temporalRatio(frames);
    const e = Math.abs(errPx(measured, TRUE_RATIO));
    expect(e).toBeLessThanOrEqual(1);
  });

  it('2D 中值显著优于单帧读法（最坏单帧误差 / 2D 误差 > 20×）', () => {
    const frames = highlightSequence();

    const perFrame = frames.map((f) => singleFrameRatio(f));
    const maxFrameErr = Math.max(...perFrame.map((r) => Math.abs(errPx(r, TRUE_RATIO))));

    const twoDErr = Math.abs(errPx(temporalRatio(frames), TRUE_RATIO));

    // 2D 中值误差极小；单帧最坏误差巨大。
    expect(twoDErr).toBeLessThanOrEqual(1);
    expect(maxFrameErr / Math.max(twoDErr, 0.001)).toBeGreaterThan(20);
  });

  it('高光扫过时最新帧单独读数会失败，但 2D 中值仍准（证明逐列跨帧是关键）', () => {
    const frames = highlightSequence();
    // 取一个被高光污染的单帧（误差 > 50px）。
    const badIdx = frames.findIndex((f) => Math.abs(errPx(singleFrameRatio(f), TRUE_RATIO)) > 50);
    expect(badIdx).toBeGreaterThanOrEqual(0);

    const single = singleFrameRatio(frames[badIdx]);
    const twoD = temporalRatio(frames);
    expect(Math.abs(errPx(single, TRUE_RATIO))).toBeGreaterThan(50);
    expect(Math.abs(errPx(twoD, TRUE_RATIO))).toBeLessThanOrEqual(1);
  });
});
