/**
 * 文件下载 / 读取工具。
 */

/**
 * 触发浏览器下载一个 `Blob`。
 *
 * @param blob 要下载的内容。
 * @param filename 建议文件名（含扩展名）。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // 延迟释放，确保下载已开始
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * 把字符串以下载文件形式保存（默认 UTF-8）。
 *
 * @param content 文件文本内容。
 * @param filename 建议文件名。
 * @param mime MIME 类型，默认 `application/json;charset=utf-8`。
 */
export function downloadText(
  content: string,
  filename: string,
  mime = 'application/json;charset=utf-8',
): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

/**
 * 弹出文件选择框并读取用户选择的文本文件。
 *
 * @param accept `accept` 属性，默认 `.json`。
 * @returns 文件文本内容；用户取消时返回 `null`。
 */
export function pickTextFile(accept = '.json'): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('读取文件失败'));
      };
      reader.readAsText(file, 'utf-8');
    });
    // 用户取消文件选择时不会触发 change，这里不主动 resolve（由调用方超时/忽略）
    input.click();
  });
}

/**
 * 把字符串复制到剪贴板（「复制诊断信息」用）。
 *
 * @param text 待复制的文本。
 * @returns 是否复制成功。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // 兜底：使用 textarea + execCommand
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
