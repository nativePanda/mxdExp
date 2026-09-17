/**
 * UUID 生成工具。
 *
 * 优先使用 `crypto.randomUUID()`（安全上下文下可用）；
 * 在不支持的环境（如旧浏览器 / Node 无 crypto 时）回退到基于时间戳 + 随机数的实现。
 */

/**
 * 生成一个 v4 UUID 字符串。
 *
 * @returns UUID 字符串。
 */
export function uuid(): string {
  // 优先使用原生实现（Chrome/Edge 最新版均支持）
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return fallbackUuid();
}

/**
 * 回退的 UUID v4 生成实现（不依赖 crypto.randomUUID）。
 *
 * @returns UUID v4 字符串。
 */
function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    // 最后兜底：时间戳 + Math.random（仅用于无 crypto 的极端环境）
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // 设置版本号（4）与变体位（RFC 4122）
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
