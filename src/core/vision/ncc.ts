/**
 * 归一化互相关（NCC）—— 纯函数，零 DOM 依赖。
 *
 * 参考预研 `exp2d_digits.js` 的 `corr` / `ncc2`：
 * - `corr(a,b)`：皮尔逊相关系数（输入等长）；
 * - `ncc(a,b)`：把两张图（任意尺寸）都缩放填充到 CANON 画布后再算 `corr`。
 *
 * 为什么不用"中心裁剪到较小尺寸"：那会因宽高不同而错位；统一到 CANON 画布才能比较。
 */

import { CANON_H, CANON_W } from '@/constants';
import { drawToCanvas, type GrayImage } from './normalize';

/**
 * 皮尔逊相关系数（输入必须等长）。
 *
 * 退化处理（关键）：若任一方差为 0（整幅同色，典型如 `.` 归一化后成为实心块），
 * 皮尔逊相关系数数学上无定义。此处采用**一致的退化规则**：
 * - 两侧都退化（方差均为 0）且**均值接近** → 视为完全匹配（返回 `1`）；
 *   如 `.` 与 `.` 都是实心块 → 匹配。
 * - 仅一侧退化 → 返回 `0`（无法判断，保守拒配）。
 *
 * @param a 数组 A。
 * @param b 数组 B。
 * @returns 相关系数（-1–1）；退化情形按上述规则返回 1 或 0。
 */
export function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;

  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;

  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  if (den === 0) {
    // 退化：两侧均无方差 → 均值接近则完全匹配；否则 0。
    if (da === 0 && db === 0) {
      return Math.abs(ma - mb) <= CORR_DEGENERATE_EPS ? 1 : 0;
    }
    return 0;
  }
  return num / den;
}

/** 退化（零方差）情形下的均值相等判定容差。 */
const CORR_DEGENERATE_EPS = 1e-6;

/**
 * 归一化互相关：把两图统一到 CANON 画布（默认 24×32）后算相关系数。
 *
 * @param a 图 A。
 * @param b 图 B。
 * @param canonW CANON 画布宽，默认 `CANON_W`。
 * @param canonH CANON 画布高，默认 `CANON_H`。
 * @returns NCC 得分（-1–1）。
 */
export function ncc(a: GrayImage, b: GrayImage, canonW = CANON_W, canonH = CANON_H): number {
  const ca = drawToCanvas(a, canonW, canonH);
  const cb = drawToCanvas(b, canonW, canonH);
  return corr(ca.data, cb.data);
}

/**
 * 由裸数据 + 尺寸构造 `GrayImage` 并计算 NCC（模板库接口用，避免频繁建对象）。
 *
 * @param aData 图 A 数据。
 * @param aw 图 A 宽度。
 * @param ah 图 A 高度。
 * @param bData 图 B 数据。
 * @param bw 图 B 宽度。
 * @param bh 图 B 高度。
 * @param canonW CANON 画布宽。
 * @param canonH CANON 画布高。
 * @returns NCC 得分。
 */
export function nccRaw(
  aData: ArrayLike<number>,
  aw: number,
  ah: number,
  bData: ArrayLike<number>,
  bw: number,
  bh: number,
  canonW = CANON_W,
  canonH = CANON_H,
): number {
  const a: GrayImage = { w: aw, h: ah, data: toF64(aData) };
  const b: GrayImage = { w: bw, h: bh, data: toF64(bData) };
  return ncc(a, b, canonW, canonH);
}

/**
 * 把任意 `ArrayLike<number>` 拷贝为 `Float64Array`。
 *
 * @param src 输入序列。
 * @returns 新的 `Float64Array`。
 */
function toF64(src: ArrayLike<number>): Float64Array {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i];
  return out;
}
