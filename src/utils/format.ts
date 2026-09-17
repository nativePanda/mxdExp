/**
 * 数值 / 时间格式化工具。
 *
 * 拒识约定（架构 §5.4）：`null` 一律显示为 `—`（`PLACEHOLDER`），**绝不显示猜测值**。
 */

/** 未确认 / 不可用数值的占位符。 */
export const PLACEHOLDER = '—';

/**
 * 千分位格式化整数（如 `1234567` → `'1,234,567'`）。
 *
 * @param value 数值；`null`/`undefined`/`NaN` 返回占位符。
 * @returns 千分位字符串。
 */
export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  return Math.round(value).toLocaleString('en-US');
}

/**
 * 大数缩写（如 `2100000` → `'2.1M'`）。
 *
 * 规则（PRD §5.3 示例「金币/小时 2.1M」）：
 * - < 1,000 原样输出（保留整数）；
 * - < 1,000,000 用 `K`（保留 1 位小数，去尾零）；
 * - < 1,000,000,000 用 `M`；
 * - 其余用 `B`。
 *
 * @param value 数值；不可用时返回占位符。
 * @param digits 小数位，默认 1。
 * @returns 缩写字符串。
 */
export function formatCompact(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const trim = (n: number): string => {
    // 去掉尾部多余的 0（保留至少 1 位整数）
    return n.toFixed(digits).replace(/\.?0+$/, '');
  };
  if (abs < 1_000) return `${sign}${Math.round(abs)}`;
  if (abs < 1_000_000) return `${sign}${trim(abs / 1_000)}K`;
  if (abs < 1_000_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  return `${sign}${trim(abs / 1_000_000_000)}B`;
}

/**
 * 时长格式化 `HH:mm:ss`（如 `4364000` ms → `'01:12:44'`，对应 PRD「记录时长 01:12:44」）。
 *
 * @param ms 毫秒数；负数或不可用时按 0 处理。
 * @returns `HH:mm:ss` 字符串。
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return '00:00:00';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * 时长格式化（简短版）：`mm:ss` 或 `H:mm:ss`，用于卡片内联显示。
 *
 * @param ms 毫秒数。
 * @returns 简短时长字符串。
 */
export function formatDurationShort(ms: number | null | undefined): string {
  const full = formatDuration(ms);
  // `01:12:44` → 去掉开头的 `0`：`1:12:44`
  return full.replace(/^0(?=\d:)/, '');
}

/**
 * 百分比格式化（如 `0.624` → `'62.40%'`）。
 *
 * 注意：若输入已是百分数（如 `62.4`），请传 `isRatio=false`。
 *
 * @param value 比例（0–1）或百分数。
 * @param digits 小数位，默认 2。
 * @param isRatio 输入是否为 0–1 的比例，默认 `true`。
 * @returns 百分比字符串。
 */
export function formatPercent(
  value: number | null | undefined,
  digits = 2,
  isRatio = true,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  const pct = isRatio ? value * 100 : value;
  return `${pct.toFixed(digits)}%`;
}

/**
 * 带符号百分比（差值展示用，如 `0.012` → `'+1.20%'`）。
 *
 * @param value 比例（0–1）。
 * @param digits 小数位，默认 2。
 * @returns 带符号百分比字符串。
 */
export function formatSignedPercent(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  const pct = value * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * 把绝对时间戳格式化为 `YYYY-MM-DD HH:mm`（历史列表用）。
 *
 * @param ts `Date.now()` 时间戳；`null` 返回占位符。
 * @returns 本地时间字符串。
 */
export function formatDateTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return PLACEHOLDER;
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const da = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${y}-${mo}-${da} ${hh}:${mi}`;
}

/**
 * 「x 前」相对时间（如「2s 前」「刚刚」）。
 *
 * @param ts 目标时间戳（ms）。
 * @param now 当前时间戳（ms），默认 `Date.now()`。
 * @returns 相对时间字符串；`null` 返回占位符。
 */
export function formatRelativeTime(
  ts: number | null | undefined,
  now: number = Date.now(),
): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return PLACEHOLDER;
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 3) return '刚刚';
  if (sec < 60) return `${sec}s 前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min 前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h 前`;
  const day = Math.floor(hour / 24);
  return `${day}d 前`;
}

/**
 * 数字左补零到 2 位。
 *
 * @param n 非负整数。
 * @returns 2 位字符串。
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
