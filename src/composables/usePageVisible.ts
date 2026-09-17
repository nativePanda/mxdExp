/**
 * `usePageVisible` —— `visibilitychange` 监听 + 后台提示 + 回前台补采。
 *
 * 依据：架构文档 §2.12 / §5.2 / §6（R1）+ 预研 tech-probe §5.3（Page Visibility 处理）。
 *
 * 行为：
 * - 切到后台（`document.hidden === true`）→ 回调 `onHidden()`，UI 提示
 *   「采样率可能下降，/小时 仍按真实时间计算」；
 * - 回到前台 → 回调 `onVisible()`（采集循环应**立即补采一帧**并**重置时间基准**）。
 *
 * 可测性：把「是否应补采 / 是否应提示」的纯判定抽成 `resolveVisibilityAction`，
 * DOM 监听只做薄封装（在不支持 `document` 的环境自动降级为空实现）。
 */

import { ref, onBeforeUnmount, type Ref } from 'vue';

/** 可见性变化的处置动作（纯判定结果）。 */
export interface VisibilityAction {
  /** 是否应补采一帧（回到前台时）。 */
  shouldCatchUp: boolean;
  /** 是否应显示"采样率可能下降"提示（切到后台时）。 */
  shouldWarn: boolean;
}

/**
 * 由可见性变化推导处置动作 —— 纯函数。
 *
 * @param hidden 变化后的隐藏状态（`document.hidden`）。
 * @returns 处置动作。
 */
export function resolveVisibilityAction(hidden: boolean): VisibilityAction {
  return hidden
    ? { shouldCatchUp: false, shouldWarn: true }
    : { shouldCatchUp: true, shouldWarn: false };
}

/** `usePageVisible` 的入参。 */
export interface UsePageVisibleOptions {
  /** 切到后台回调。 */
  onHidden?: () => void;
  /** 回到前台回调（补采一帧 + 重置时间基准）。 */
  onVisible?: () => void;
}

/** `usePageVisible` 的返回。 */
export interface UsePageVisible {
  /** 当前是否隐藏。 */
  hidden: Ref<boolean>;
  /** 由监听器内部调用（也暴露供测试手动触发）。 */
  handleChange: (hidden: boolean) => void;
}

/**
 * 创建页面可见性监听（需在组件作用域内调用；无 `document` 时自动降级）。
 *
 * @param opts 回调。
 * @returns `UsePageVisible`。
 */
export function usePageVisible(opts: UsePageVisibleOptions = {}): UsePageVisible {
  const hidden = ref(typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false);

  /**
   * 处理一次可见性变化。
   *
   * @param isHidden 变化后的隐藏状态。
   */
  const handleChange = (isHidden: boolean): void => {
    hidden.value = isHidden;
    const action = resolveVisibilityAction(isHidden);
    if (action.shouldWarn) opts.onHidden?.();
    if (action.shouldCatchUp) opts.onVisible?.();
  };

  /** DOM 事件回调。 */
  const listener = (): void => {
    if (typeof document === 'undefined') return;
    handleChange(document.visibilityState === 'hidden');
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', listener);
  }
  if (typeof onBeforeUnmount === 'function') {
    onBeforeUnmount(() => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', listener);
      }
    });
  }

  return { hidden, handleChange };
}
