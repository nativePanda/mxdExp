/**
 * `screenKey` 生成：分辨率 + 设备像素比 + UA 摘要的指纹。
 *
 * 硬约定（架构 §5.1 / A10）：
 * - `screenKey` = `videoWidth x videoHeight + 设备像素比 + UA 摘要`。
 * - 分辨率变化时校准配置视为失效（`version` 不匹配则提示重标）。
 * - 包含 `devicePixelRatio`（高 DPI 下实际像素尺寸不同，不可复用）。
 */

/**
 * 生成 UA 摘要：取浏览器名与主版本号，保证跨小版本可复用。
 *
 * 例：`Chrome/131.0.0.0` → `Chrome131`；无法识别时回退到前 32 字符的哈希。
 *
 * @param ua 浏览器 UA 字符串。
 * @returns UA 摘要字符串。
 */
export function uaDigest(ua: string): string {
  const text = ua || '';
  const browser =
    matchVersion(text, /Edg\/(\d+)/) ||
    matchVersion(text, /Chrome\/(\d+)/) ||
    matchVersion(text, /Firefox\/(\d+)/) ||
    matchVersion(text, /Version\/(\d+)/);
  if (browser) return browser;
  // 无法识别浏览器时，用简单哈希避免整串 UA 过长
  return `ua${hashString(text)}`;
}

/**
 * 从 UA 中提取「浏览器名 + 主版本」。
 *
 * @param ua UA 字符串。
 * @param re 匹配主版本号的正则（捕获组 1 为版本）。
 * @returns 摘要或 `null`。
 */
function matchVersion(ua: string, re: RegExp): string | null {
  const m = re.exec(ua);
  if (!m) return null;
  const version = m[1];
  let name = 'Browser';
  if (/Edg\//.test(ua)) name = 'Edge';
  else if (/Chrome\//.test(ua)) name = 'Chrome';
  else if (/Firefox\//.test(ua)) name = 'Firefox';
  else if (/Version\/.*Safari/.test(ua)) name = 'Safari';
  return `${name}${version}`;
}

/**
 * 简单字符串哈希（FNV-1a 变体），用于生成短摘要。
 *
 * @param str 输入字符串。
 * @returns 无符号 32 位整数的十进制字符串。
 */
export function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 生成 `screenKey` 的入参。 */
export interface ScreenKeyInput {
  /** 画面原始宽度（px，`video.videoWidth`）。 */
  width: number;
  /** 画面原始高度（px，`video.videoHeight`）。 */
  height: number;
  /** 设备像素比（`window.devicePixelRatio`）。 */
  devicePixelRatio: number;
  /** 浏览器 UA。 */
  ua: string;
}

/**
 * 生成画面指纹 `screenKey`。
 *
 * 格式：`{width}x{height}@{dpr}#{uaDigest}`，例如 `1920x1080@1.25#Chrome131`。
 *
 * @param input 画面与设备信息。
 * @returns `screenKey` 字符串。
 */
export function buildScreenKey(input: ScreenKeyInput): string {
  const width = normalizeDim(input.width);
  const height = normalizeDim(input.height);
  const dpr = normalizeDpr(input.devicePixelRatio);
  const digest = uaDigest(input.ua);
  return `${width}x${height}@${dpr}#${digest}`;
}

/**
 * 在浏览器环境下读取当前画面的 `screenKey` 输入并生成指纹。
 *
 * 注意：必须在可访问 `window` / `navigator` 的环境调用（浏览器内）。
 *
 * @param width 画面原始宽度（px）。
 * @param height 画面原始高度（px）。
 * @returns `screenKey` 字符串。
 */
export function screenKeyFromBrowser(width: number, height: number): string {
  const dpr =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
  return buildScreenKey({ width, height, devicePixelRatio: dpr, ua });
}

/**
 * 归一化尺寸：非有限值或非正数视为 0。
 *
 * @param dim 尺寸（px）。
 * @returns 归一化后的整数尺寸。
 */
function normalizeDim(dim: number): number {
  if (!Number.isFinite(dim) || dim <= 0) return 0;
  return Math.round(dim);
}

/**
 * 归一化设备像素比：固定 2 位小数，避免浮点噪声导致指纹抖动。
 *
 * @param dpr 设备像素比。
 * @returns 归一化字符串。
 */
function normalizeDpr(dpr: number): string {
  const value = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return value.toFixed(2);
}

/**
 * 判断两个 `screenKey` 是否指向同一画面规格。
 *
 * @param a 指纹 A。
 * @param b 指纹 B。
 * @returns 是否相同。
 */
export function isSameScreen(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b;
}
