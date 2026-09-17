/**
 * Pinia setup store 边界解包回归守卫。
 *
 * 背景（T05 发现的 P0 白屏缺陷）：
 * useXxxStore() 返回的 setup store **在边界已自动解包 ref**，
 * 因此 `store.someRef` 直接是值，写 `store.someRef.value` 是错的：
 * 当该值为 `null` 时会在渲染期抛 `.value` of null → 白屏
 * （4/5 页面白屏，控制台 `[Vue warn]: Unhandled error during execution of render function`）。
 *
 * 本测试锁死该契约，防止视图层再次回退到 `store.xxx.value` 写法。
 *
 * 注意：composable（如 useDisplayStream）返回的字段**是 Ref**，仍需 `.value`——
 * 两者语义相反，本测试只覆盖 store。
 *
 * 环境：node（无需 jsdom；Pinia 在 node 下可正常实例化）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// fake-indexeddb 让 db 模块在 node 下可加载（record store 依赖 @/db）。
import 'fake-indexeddb/auto';

import { useRecordStore } from '@/stores/record';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';

/**
 * 判定一个 store 字段是否「已经是解包后的普通值（或 null）」。
 *
 * 关键：解包后的值绝不是含 `value` 属性的 Ref 包装对象。
 * 如果字段仍是 Ref（错误用法下视图以为的形态），其会有 `__v_isRef: true`。
 */
function isStillRef(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>).__v_isRef === true
  );
}

describe('Pinia setup store 边界解包契约（T05 白屏回归守卫）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('record store 的 ref 字段在边界已解包（不可再 .value）', () => {
    const store = useRecordStore();

    // 这些字段是 ref/computed——setup store 边界必须已解包成普通值。
    expect(isStillRef(store.rate)).toBe(false);
    expect(isStillRef(store.snapshot)).toBe(false);
    expect(isStillRef(store.status)).toBe(false);
    expect(isStillRef(store.readState)).toBe(false);
    expect(isStillRef(store.expPerHour)).toBe(false);
    expect(isStillRef(store.goldPerHour)).toBe(false);
    expect(isStillRef(store.lastRecord)).toBe(false);
    expect(isStillRef(store.saving)).toBe(false);
    expect(isStillRef(store.notices)).toBe(false);
  });

  it('未开始记录时，可空指标应为 null，取值不应抛异常', () => {
    const store = useRecordStore();

    // 值是 null 是正常的；重点是「直接读字段」不抛错。
    expect(() => {
      void store.rate;
      void store.snapshot;
      void store.expPerHour;
      void store.goldPerHour;
      void store.lastRecord;
    }).not.toThrow();

    expect(store.rate).toBeNull();
    expect(store.snapshot).toBeNull();
    expect(store.expPerHour).toBeNull();
    // status / readState 有兜底默认值。
    expect(store.status).toBe('idle');
    expect(store.readState).toBe('waiting');
  });

  it('复现 T05 的错误写法：对 null 字段读 .value 必须抛 TypeError', () => {
    const store = useRecordStore();

    // 这正是导致白屏的写法。值为 null → 读 .value 抛 TypeError。
    expect(() => {
      const wrong = store.rate as unknown as { value: unknown };
      void wrong.value;
    }).toThrow(TypeError);
  });

  it('白屏的真实触发条件：字段为 null 时误读 .value（已浏览器实测确认）', () => {
    const store = useRecordStore();

    // T05 复现要点（已用真实浏览器验证）：
    // - 字段为 **null** 时，`field.value` 抛 TypeError → 渲染函数中断 → main.innerHTML 长度 0（白屏）
    // - 字段为 **number**（如 settings.captureFps 默认 1）时，`(1).value` 只是 undefined，
    //   **不会**抛错——所以这类误用会静默出错、不会白屏。
    // 因此本守卫必须锚定「null 字段」这一真实触发路径，而非泛泛断言。
    expect(store.rate).toBeNull();
    expect(() => (store.rate as unknown as { value: unknown }).value).toThrow(TypeError);

    // 反例：非空数字字段的误用不抛错（说明仅靠「不抛错」无法守住契约）。
    const numericValue = 42 as unknown as { value: unknown };
    expect(() => void numericValue.value).not.toThrow();
    expect(numericValue.value).toBeUndefined();
  });

  it('settings store 边界同样解包（settings 是单一 Ref 对象）', () => {
    const store = useSettingsStore();

    // 注意：settings store 暴露的是**单个** `settings` Ref（内含 perfTier/captureFps/...），
    // 而不是把内部字段逐个摊平。边界解包只作用于这**一层**：
    // `store.settings` 已是普通对象，而其内部字段本就无需 `.value`（是普通属性）。
    expect(isStillRef(store.settings)).toBe(false);
    expect(() => {
      void store.settings.perfTier;
      void store.settings.captureFps;
    }).not.toThrow();

    // 内部字段是普通值，不是 Ref。
    expect(isStillRef(store.settings.perfTier)).toBe(false);
    expect(isStillRef(store.settings.captureFps)).toBe(false);
  });

  it('ui store 边界同样解包', () => {
    const store = useUiStore();
    // ui store 暴露 activeTab / toasts / lastDiagnostics 等。
    // 逐字段断言（避免对 Store 类型做整体 Record 转换）。
    expect(isStillRef(store.activeTab)).toBe(false);
    expect(isStillRef(store.toasts)).toBe(false);
    expect(isStillRef(store.lastDiagnostics)).toBe(false);
    expect(() => {
      void store.activeTab;
      void store.toasts;
      void store.lastDiagnostics;
    }).not.toThrow();
  });
});
