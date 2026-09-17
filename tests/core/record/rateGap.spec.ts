/**
 * 回归测试：读数间隙（拒识帧）不得污染速率样本。
 *
 * ## 背景（缺陷来源）
 * `RecordSession.computeInstantRate(t)` 在**每一帧**都无条件推进
 * `lastRateAbs = abs; lastRateT = t;`（原实现），即使该帧经验文字读数被拒识
 * （`expRaw === null`）。这导致两类垃圾样本：
 *
 * 1. **伪造的 0 速率**：拒识帧上 `lastExpAbs` 未变，`delta = 0`，
 *    经 `delta >= 0` 分支算出 `expPerHour(0, Δt) = 0`，把 0 推入速率窗口，
 *    系统性拉低 `last60s` 与 `overallEma`。
 * 2. **2 倍高估**：拒识帧把 `lastRateT` 推进到当前时刻，但 `lastRateAbs` 停留在
 *    上一个**有效**读数。等下一帧读数恢复时，`delta` 跨了 2 帧的经验增量，
 *    而 `Δt` 只算了 1 帧 → 速率被高估「间隙帧数 + 1」倍。
 *
 * ## 影响
 * 实时效率面板的方向箭头会因噪声样本随机抖动；`overallEma`（τ=600s）
 * 会把噪声记忆长达约 10 分钟。属于**统计数字错误**，非崩溃类缺陷。
 *
 * ## 修复方向（预期语义）
 * 拒识帧（无有效经验绝对值）**不得**推入速率样本，且**不得**推进
 * `lastRateAbs/lastRateT`。恢复后的首个有效帧，其 `delta` 与 `Δt` 必须覆盖
 * 同一时间跨度（即从上一个有效读数帧算起）。
 */

import { describe, it, expect } from 'vitest';
import { RecordSession } from '@/core/record';

/** 单帧输入构造辅助。 */
function frame(t: number, expRaw: number | null, expPct: number | null = 0.1) {
  return {
    t,
    expRaw,
    expPct,
    level: 200,
    gold: null,
    hp: null,
    mp: null,
    confidence: 0.9,
    readState: 'confirmed' as const,
    levelCalibrated: true,
  };
}

describe('RecordSession 速率样本 —— 读数间隙不污染', () => {
  const STEP = 70000; // 让窗口内只保留最新 1 个样本，从而直接暴露原始速率

  it('无拒识帧时，速率样本等于真实速率（基线）', () => {
    const session = new RecordSession({ levelCalibrated: true });
    session.start(0);

    const observed: number[] = [];
    for (let k = 0; k < 4; k++) {
      session.ingestSample(frame(k * STEP, k * 100));
      const r = session.snapshot().rate.last60s;
      if (r !== null) observed.push(r);
    }

    // 每步 Δexp = 100，Δt = 70000ms
    const expected = (100 * 3600000) / STEP;
    expect(observed).toHaveLength(3);
    for (const r of observed) expect(r).toBeCloseTo(expected, 6);
  });

  it('★ 拒识帧不得推入 0 速率样本', () => {
    const session = new RecordSession({ levelCalibrated: true });
    session.start(0);

    // t=0 与 t=STEP 有值；t=2*STEP 拒识
    session.ingestSample(frame(0, 0));
    session.ingestSample(frame(STEP, 100));
    const beforeReject = session.snapshot().rate.last60s;

    session.ingestSample(frame(2 * STEP, null)); // ★ 拒识帧
    const afterReject = session.snapshot().rate.last60s;

    expect(beforeReject).not.toBeNull();
    // 拒识帧不应产生新样本：窗口内仍只有上一帧的真实速率
    expect(afterReject).toBeCloseTo(beforeReject as number, 6);
    expect(afterReject).not.toBe(0);
  });

  it('★ 拒识帧之后的速率样本必须与真实速率一致（不得高估）', () => {
    const session = new RecordSession({ levelCalibrated: true });
    session.start(0);

    const frames = [frame(0, 0), frame(STEP, 100), frame(2 * STEP, null), frame(3 * STEP, 300)];
    const observed: (number | null)[] = [];
    for (const f of frames) {
      session.ingestSample(f);
      observed.push(session.snapshot().rate.last60s);
    }

    // 从上一个**有效**读数（t=STEP, exp=100）到本帧（t=3*STEP, exp=300）：
    // Δexp = 200，Δt = 2*STEP = 140000ms → 真实速率
    const expected = (200 * 3600000) / (2 * STEP);
    const last = observed[observed.length - 1];
    expect(last).toBeCloseTo(expected, 6);
  });

  it('★ 连续多帧拒识后恢复，速率仍覆盖完整时间跨度', () => {
    const session = new RecordSession({ levelCalibrated: true });
    session.start(0);

    // t=0 有值(0) → 连续 3 帧拒识 → t=4*STEP 有值(400)
    session.ingestSample(frame(0, 0));
    for (let k = 1; k <= 3; k++) session.ingestSample(frame(k * STEP, null));
    session.ingestSample(frame(4 * STEP, 400));

    // Δexp = 400，Δt = 4*STEP = 280000ms
    const expected = (400 * 3600000) / (4 * STEP);
    expect(session.snapshot().rate.last60s).toBeCloseTo(expected, 6);
  });
});
