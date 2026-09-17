/**
 * `core/metrics/rateCompare` 单测 —— 4%/2%/1.5s hysteresis。
 *
 * 验收（架构 §7 T02-6）：
 * - 偏差达 4% 显示箭头；
 * - 回落到 2% 后**延迟 1.5s** 才隐藏（用可注入的时钟：直接喂 `now` 参数）；
 * - 「近 60 秒」窗口用 `RATE_WINDOW_MS`。
 */

import { describe, expect, it } from 'vitest';
import {
  createRateComparison,
  pushRateSample,
  type RateComparisonState,
} from '@/core/metrics';
import { RATE_HIDE_DELAY_MS, RATE_WINDOW_MS } from '@/constants';

/**
 * 反复喂同一个速率，直到状态稳定（样本足够）。
 *
 * @param rate 速率（经验/小时）。
 * @param times 次数。
 * @param startNow 起始时刻。
 * @returns 稳定后的状态。
 */
function feed(rate: number, times: number, startNow = 0): RateComparisonState {
  let st = createRateComparison();
  for (let i = 0; i < times; i++) {
    st = pushRateSample(st, startNow + i * 1000, rate);
  }
  return st;
}

/**
 * 以 1000ms 步长持续推进时间并喂基线速率，直到 `pendingHideAt` 被置位
 * （即偏差真正回落到死区、箭头进入"待隐藏"状态）。
 *
 * 说明：设计有**两个独立时间尺度** —— `last60s` 窗口 = `RATE_WINDOW_MS`（60s），
 * `overallAvg` 的 EMA 时间常数 = `RATE_EMA_TAU_MS`（10×窗口）。要让"偏差回落"
 * 真实发生，必须让时间**真正推进**、使旧的偏离样本**滑出 60s 窗口**，而不是在
 * 8 秒内 push 一帧去追平（后者窗口仍被旧样本主导，偏差不可能收敛）。
 *
 * 用循环推进而非硬编码时刻：将来若调 `RATE_WINDOW_MS` / `RATE_EMA_TAU_MS`，
 * 本测试仍稳定。
 *
 * @param st 起始状态（应已建立箭头）。
 * @param rate 回落期间喂的基线速率（经验/小时）。
 * @param stepMs 时间步长（ms），默认 1000。
 * @param maxSteps 最大推进步数（安全上限），默认 200。
 * @returns 首个 `pendingHideAt !== null` 的状态，以及其时刻。
 */
function advanceUntilPendingHide(
  st: RateComparisonState,
  rate: number,
  stepMs = 1000,
  maxSteps = 200,
): { state: RateComparisonState; at: number; steps: number } {
  let cur = st;
  // 从最后一个样本之后继续推进。
  let now = (cur.samples.length > 0 ? cur.samples[cur.samples.length - 1].t : 0) + stepMs;
  for (let i = 0; i < maxSteps; i++) {
    cur = pushRateSample(cur, now, rate);
    if (cur.pendingHideAt !== null) {
      return { state: cur, at: now, steps: i + 1 };
    }
    now += stepMs;
  }
  return { state: cur, at: now, steps: maxSteps };
}

describe('rateCompare —— 基础', () => {
  it('样本不足时（<1 个样本点）→ 无数据、无箭头', () => {
    const st = pushRateSample(createRateComparison(), 0, null);
    expect(st.arrowVisible).toBe(false);
    expect(st.last60s).toBeNull();
    expect(st.overallAvg).toBeNull();
  });

  it('恒定速率 → 偏差 0，不显示箭头', () => {
    const st = feed(1_000_000, 10);
    expect(st.diffRatio).toBeCloseTo(0, 10);
    expect(st.arrowVisible).toBe(false);
  });
});

describe('rateCompare —— 4% 显示箭头', () => {
  it('当前速率显著高于历史 → 显示上升箭头', () => {
    // 先喂 5 帧低速建立基线。
    let st = feed(1_000_000, 5, 0);
    // 再喂高速帧（近 60 秒均值被拉高，偏差 > 4%）。
    st = pushRateSample(st, 5000, 1_500_000);
    st = pushRateSample(st, 6000, 1_500_000);
    st = pushRateSample(st, 7000, 1_500_000);

    expect(Math.abs(st.diffRatio)).toBeGreaterThanOrEqual(0.04);
    expect(st.arrowVisible).toBe(true);
    expect(st.arrowUp).toBe(true);
  });

  it('当前速率显著低于历史 → 显示下降箭头', () => {
    let st = feed(1_000_000, 5, 0);
    st = pushRateSample(st, 5000, 500_000);
    st = pushRateSample(st, 6000, 500_000);
    st = pushRateSample(st, 7000, 500_000);

    expect(Math.abs(st.diffRatio)).toBeGreaterThanOrEqual(0.04);
    expect(st.arrowVisible).toBe(true);
    expect(st.arrowUp).toBe(false);
  });
});

describe('rateCompare —— ★ 回落 2% 后延迟 1.5s 才隐藏', () => {
  it('偏差回到 <2% 时箭头仍显示，直到 1.5s 后才隐藏', () => {
    // 1) 先制造一个"箭头可见、偏差显著"的状态（近 60 秒速率 1.5M，基线 1.0M）。
    let st = feed(1_000_000, 5, 0);
    st = pushRateSample(st, 5000, 1_500_000);
    st = pushRateSample(st, 6000, 1_500_000);
    st = pushRateSample(st, 7000, 1_500_000);
    expect(st.arrowVisible).toBe(true);

    // 2) 推进时间直到"偏差回落到 <2%"真实发生：旧的 1.5M 样本滑出 60s 窗口后，
    //    窗口均值收敛回基线 —— 此时应启动 pendingHideAt = 该时刻 + 1500。
    const baseline = 1_000_000;
    const { state: hidden, at: hideStart } = advanceUntilPendingHide(st, baseline);
    st = hidden;

    expect(Math.abs(st.diffRatio)).toBeLessThanOrEqual(0.02);
    expect(st.pendingHideAt).toBe(hideStart + RATE_HIDE_DELAY_MS);
    // 箭头**仍可见**（延迟未到）。
    expect(st.arrowVisible).toBe(true);

    // 3) 到达 1.5s 前（差 1ms）仍可见。
    st = pushRateSample(st, hideStart + RATE_HIDE_DELAY_MS - 1, baseline);
    expect(st.arrowVisible).toBe(true);
    expect(st.pendingHideAt).toBe(hideStart + RATE_HIDE_DELAY_MS);

    // 4) 到达 1.5s 边界 → 隐藏。
    st = pushRateSample(st, hideStart + RATE_HIDE_DELAY_MS, baseline);
    expect(st.arrowVisible).toBe(false);
    expect(st.pendingHideAt).toBeNull();
  });

  it('延迟期间偏差重新超过 4% → 取消隐藏、箭头保持显示', () => {
    let st = feed(1_000_000, 5, 0);
    st = pushRateSample(st, 5000, 1_500_000);
    st = pushRateSample(st, 6000, 1_500_000);
    st = pushRateSample(st, 7000, 1_500_000);
    expect(st.arrowVisible).toBe(true);

    // 推进到"偏差回落、进入待隐藏"的真实时刻。
    const baseline = 1_000_000;
    const { state: pending, at: hideStart } = advanceUntilPendingHide(st, baseline);
    st = pending;
    expect(st.pendingHideAt).toBe(hideStart + RATE_HIDE_DELAY_MS);

    // 延迟期内偏差又拉大 → 取消待隐藏。
    // 注意：待隐藏时 60s 窗口内已充满基线样本（实测 ~61 帧），单喂一帧不足以把
    // 窗口均值拉回 ≥4%；需在**延迟 1.5s 内**连续喂显著高值（现实中"效率突然飙升"），
    // 使窗口均值迅速抬升。用 100ms 步长喂 5.0M：实测 t+600ms 即达 ≥4%。
    let now = hideStart + 100;
    let lifted = false;
    for (let i = 0; i < 14 && now < hideStart + RATE_HIDE_DELAY_MS; i++) {
      st = pushRateSample(st, now, 5_000_000);
      if (Math.abs(st.diffRatio) >= 0.04) {
        lifted = true;
        break;
      }
      now += 100;
    }

    // 偏差重新超过 4% → 取消待隐藏、箭头保持显示。
    expect(lifted).toBe(true);
    expect(Math.abs(st.diffRatio)).toBeGreaterThanOrEqual(0.04);
    expect(st.pendingHideAt).toBeNull();
    expect(st.arrowVisible).toBe(true);
  });

  it('从未显示过箭头时，偏差在 2% 内不会"凭空"出现箭头', () => {
    const st = feed(1_000_000, 10);
    expect(st.arrowVisible).toBe(false);
    expect(st.pendingHideAt).toBeNull();
  });
});

describe('rateCompare —— 近 60 秒窗口', () => {
  it('超出 RATE_WINDOW_MS 的旧样本被移出 last60s 窗口', () => {
    // 0s 喂一个极高的速率，然后过 60s 再喂正常速率。
    let st = createRateComparison();
    st = pushRateSample(st, 0, 9_000_000);
    // 60s 之后（窗口外）。
    st = pushRateSample(st, RATE_WINDOW_MS + 1000, 1_000_000);

    // last60s 只应包含窗口内样本（1_000_000），不含 0s 的那帧。
    expect(st.last60s).toBe(1_000_000);
    // overallAvg 仍含历史（被拉高）。
    expect(st.overallAvg).toBeGreaterThan(1_000_000);
  });

  it('窗口内全部样本参与 last60s 均值', () => {
    let st = createRateComparison();
    st = pushRateSample(st, 0, 1_000_000);
    st = pushRateSample(st, 1000, 2_000_000);
    st = pushRateSample(st, 2000, 3_000_000);
    expect(st.last60s).toBe(2_000_000); // (1+2+3)/3
  });
});
