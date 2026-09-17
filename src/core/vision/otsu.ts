/**
 * Otsu 自适应阈值 —— 纯函数，零 DOM 依赖。
 *
 * 参考：预研报告 §9.2/§9.3 的 `otsu(v, mn, mx)` 实现（`probe/exp5c_temporal.js` 6-12 行）。
 *
 * 设计要点：
 * - 直方图分箱（默认 64 bins），在 `[min, max]` 动态范围内统计；
 * - 类间方差最大化求阈值，返回**还原到原始量纲**的阈值；
 * - 当动态范围退化（`max - min` 过小）时返回 `(min + max) / 2`，调用方应在此之前
 *   自行处理「全满/全空」退化（见 `ratio.ts` 的 `FULL_EMPTY_DELTA` 分支）。
 */

/** Otsu 直方图分箱数（预研脚本一致）。 */
const OTSU_BINS = 64;

/**
 * Otsu 自适应阈值。
 *
 * @param values 样本值数组（可含任意实数，量纲不限，通常为 fillness 或灰度）。
 * @param bins 直方图分箱数，默认 64；必须为正整数。
 * @returns 自适应阈值；输入为空时返回 0。
 */
export function otsu(values: ArrayLike<number>, bins: number = OTSU_BINS): number {
  const n = values.length;
  if (n === 0) return 0;

  const nBins = Number.isInteger(bins) && bins > 0 ? bins : OTSU_BINS;

  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return 0;
  if (mx === mn) return mn;

  const span = mx - mn;
  const hist = new Array<number>(nBins).fill(0);
  for (let i = 0; i < n; i++) {
    let bi = Math.floor(((values[i] - mn) / span) * nBins);
    if (bi < 0) bi = 0;
    if (bi >= nBins) bi = nBins - 1;
    hist[bi] += 1;
  }

  const total = n;
  let sumAll = 0;
  for (let i = 0; i < nBins; i++) sumAll += i * hist[i];

  let weightBg = 0;
  let sumBg = 0;
  let bestVariance = 0;
  let bestBin = nBins / 2;

  for (let i = 0; i < nBins; i++) {
    weightBg += hist[i];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += i * hist[i];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const delta = meanBg - meanFg;
    const variance = weightBg * weightFg * delta * delta;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestBin = i;
    }
  }

  // 还原到原始量纲：bin 中心。
  return mn + ((bestBin + 0.5) / nBins) * span;
}

/**
 * 便捷封装：先在 `[min, max]` 下界裁剪样本，再求 Otsu 阈值。
 *
 * 与本文件的 `otsu` 等价（`otsu` 内部已自行求 min/max），保留此函数是为了让
 * 调用方在已知动态范围时显式传入，避免重复扫描。
 *
 * @param values 样本值数组。
 * @param min 已知最小值。
 * @param max 已知最大值。
 * @returns 自适应阈值。
 */
export function otsuInRange(values: ArrayLike<number>, min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return otsu(values);
  if (max <= min) return min;

  const nBins = OTSU_BINS;
  const span = max - min;
  const n = values.length;
  if (n === 0) return min;

  const hist = new Array<number>(nBins).fill(0);
  for (let i = 0; i < n; i++) {
    let bi = Math.floor(((values[i] - min) / span) * nBins);
    if (bi < 0) bi = 0;
    if (bi >= nBins) bi = nBins - 1;
    hist[bi] += 1;
  }

  let sumAll = 0;
  for (let i = 0; i < nBins; i++) sumAll += i * hist[i];

  let weightBg = 0;
  let sumBg = 0;
  let bestVariance = 0;
  let bestBin = nBins / 2;

  for (let i = 0; i < nBins; i++) {
    weightBg += hist[i];
    if (weightBg === 0) continue;
    const weightFg = n - weightBg;
    if (weightFg === 0) break;
    sumBg += i * hist[i];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const delta = meanBg - meanFg;
    const variance = weightBg * weightFg * delta * delta;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestBin = i;
    }
  }

  return min + ((bestBin + 0.5) / nBins) * span;
}
