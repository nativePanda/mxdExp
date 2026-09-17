/**
 * TemplatesStore —— 字形模板库状态（`default` / `custom` 切换、保存）。
 *
 * 依据：架构文档 §2.11 / §3.6 + §9（内置默认模板 + 模板采集向导）。
 *
 * 说明：
 * - `defaultBank` 由浏览器侧 Canvas 渲染器生成（`createCanvasGlyphRenderer` + `buildDefaultBank`），
 *   首次生成后序列化快照存入 `kv`（`KV_KEYS.defaultTemplates`）以避免重复渲染；
 * - `customBank` 由「模板采集向导」产出，存 `KV_KEYS.customTemplates`；
 * - `activeBank()` 优先返回 `customBank`（若存在），否则 `defaultBank`。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { TemplateBank, buildDefaultBank, createCanvasGlyphRenderer } from '@/core/vision';
import { KV_KEYS, DEFAULT_TEMPLATE_SCALE_KEY } from '@/constants';
import { kvRepo } from '@/db';

/**
 * 模板库 store（setup 风格）。
 */
export const useTemplatesStore = defineStore('templates', () => {
  /** 内置模板库（懒构建）。 */
  const defaultBank = ref<TemplateBank | null>(null);

  /** 用户自定义模板库。 */
  const customBank = ref<TemplateBank | null>(null);

  /** 是否启用自定义模板库。 */
  const useCustom = ref(false);

  /** 是否已加载。 */
  const loaded = ref(false);

  /** 当前生效的模板库。 */
  const activeBank = computed<TemplateBank | null>(() =>
    useCustom.value && customBank.value ? customBank.value : defaultBank.value,
  );

  /** 当前生效模板库的字形数量（UI 展示用）。 */
  const glyphCount = computed(() => activeBank.value?.size ?? 0);

  /**
   * 载入模板库：优先读持久化快照，缺失时构建内置库并保存快照。
   */
  const load = async (): Promise<void> => {
    // 自定义
    const customSerialized = await kvRepo.get<ReturnType<TemplateBank['serialize']>>(
      KV_KEYS.customTemplates,
    );
    if (customSerialized) {
      customBank.value = TemplateBank.deserialize(customSerialized);
      useCustom.value = true;
    }

    // 内置
    const defaultSerialized = await kvRepo.get<ReturnType<TemplateBank['serialize']>>(
      KV_KEYS.defaultTemplates,
    );
    if (defaultSerialized) {
      defaultBank.value = TemplateBank.deserialize(defaultSerialized);
    } else {
      const bank = buildBrowserDefaultBank();
      defaultBank.value = bank;
      if (bank) {
        await kvRepo.set(KV_KEYS.defaultTemplates, bank.serialize());
      }
    }

    loaded.value = true;
  };

  /**
   * 保存自定义模板库（模板采集向导产出）。
   *
   * @param bank 自定义模板库。
   */
  const saveCustom = async (bank: TemplateBank): Promise<void> => {
    customBank.value = bank;
    useCustom.value = true;
    await kvRepo.set(KV_KEYS.customTemplates, bank.serialize());
  };

  /**
   * 清除自定义模板库（回退到内置）。
   */
  const clearCustom = async (): Promise<void> => {
    customBank.value = null;
    useCustom.value = false;
    await kvRepo.remove(KV_KEYS.customTemplates);
  };

  /**
   * 切换启用自定义 / 内置模板库。
   *
   * @param custom 是否使用自定义。
   * @returns 是否切换成功（无自定义库时无法启用）。
   */
  const setUseCustom = (custom: boolean): boolean => {
    if (custom && !customBank.value) return false;
    useCustom.value = custom;
    return true;
  };

  return {
    defaultBank,
    customBank,
    useCustom,
    loaded,
    activeBank,
    glyphCount,
    load,
    saveCustom,
    clearCustom,
    setUseCustom,
  };
});

/**
 * 在浏览器环境构建内置默认模板库；无 DOM 时返回 `null`。
 *
 * @returns 内置模板库或 `null`。
 */
function buildBrowserDefaultBank(): TemplateBank | null {
  if (typeof document === 'undefined') return null;
  try {
    const renderer = createCanvasGlyphRenderer((w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    });
    return buildDefaultBank(renderer, { scaleKey: DEFAULT_TEMPLATE_SCALE_KEY });
  } catch {
    return null;
  }
}
