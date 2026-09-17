/**
 * `useFrameGrabber` —— video → canvas 抓帧 + 归一化坐标转像素 + ROI 裁剪。
 *
 * 依据：架构文档 §2.12 / §5.1（归一化坐标约定）。
 *
 * ## 硬约定（架构 §5.1）
 * - 所有 `Region` 是 **0–1 相对坐标**（相对**原始视频尺寸**，不是 canvas 显示尺寸）；
 * - **转换统一走本模块**：`px = round(norm.x * videoWidth)`；
 * - **禁止**在组件/别处直接算像素坐标。
 *
 * ## 可测性设计
 * 本模块把纯逻辑（坐标换算、像素矩形裁剪到边界、同矩形判定、ImageData 子区域裁剪）
 * 抽成**独立导出的纯函数**；浏览器 API（`drawImage`/`getImageData`/`OffscreenCanvas`）
 * 只做薄封装。Node 下可对纯函数完整单测。
 */

import { shallowRef, ref, computed, type Ref, type ComputedRef } from 'vue';
import type { PixelSource, RegionRect } from '@/types';
import { isSameRect, rectToPixels } from '@/types/calibration';

/** 像素整数矩形。 */
export interface PixelRect {
  /** 左上角 x（px）。 */
  x: number;
  /** 左上角 y（px）。 */
  y: number;
  /** 宽度（px）。 */
  w: number;
  /** 高度（px）。 */
  h: number;
}

/**
 * 把归一化矩形换算为像素矩形（并裁剪到源尺寸边界内）。
 *
 * 纯函数；这是全项目**唯一**的归一化 → 像素转换入口（架构 §5.1）。
 *
 * @param norm 归一化矩形（0–1）。
 * @param sourceW 原始视频宽度（px）。
 * @param sourceH 原始视频高度（px）。
 * @returns 像素整数矩形；源尺寸非法时返回 `{0,0,0,0}`。
 */
export function normalizeToPixels(norm: RegionRect, sourceW: number, sourceH: number): PixelRect {
  if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const raw = rectToPixels(norm, sourceW, sourceH);
  return clampPixelRect(raw, sourceW, sourceH);
}

/**
 * 把像素矩形裁剪到源尺寸边界内（并保证宽高 ≥ 0）。
 *
 * @param rect 像素矩形。
 * @param sourceW 源宽（px）。
 * @param sourceH 源高（px）。
 * @returns 裁剪后的像素矩形。
 */
export function clampPixelRect(rect: PixelRect, sourceW: number, sourceH: number): PixelRect {
  const x = Math.max(0, Math.min(Math.round(rect.x), Math.max(0, sourceW - 1)));
  const y = Math.max(0, Math.min(Math.round(rect.y), Math.max(0, sourceH - 1)));
  const w = Math.max(0, Math.min(Math.round(rect.w), sourceW - x));
  const h = Math.max(0, Math.min(Math.round(rect.h), sourceH - y));
  return { x, y, w, h };
}

/**
 * 判断两个归一化矩形是否为同一矩形（用于 `expBar`/`expText` 同框复用判定）。
 *
 * @param a 矩形 A（归一化）。
 * @param b 矩形 B（归一化）。
 * @returns 是否完全相同。
 */
export function isSameNormalizedRect(a: RegionRect, b: RegionRect): boolean {
  return isSameRect(a, b);
}

/**
 * 从整帧 `ImageData` 中裁剪出子区域，返回一个新的 `PixelSource`。
 *
 * 纯函数（不依赖 canvas），便于单测；供「整帧抓一次 → 多次裁剪」的优化路径使用。
 *
 * @param frame 整帧像素源（`ImageData` 兼容结构）。
 * @param rect 像素矩形（已由 `normalizeToPixels` 换算）。
 * @returns 子区域像素源；矩形非法时返回 `{width:0,height:0,data:空}`。
 */
export function cropImageData(frame: PixelSource, rect: PixelRect): PixelSource {
  const { x, y, w, h } = clampPixelRect(rect, frame.width, frame.height);
  if (w <= 0 || h <= 0) {
    return { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const srcW = frame.width;
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * srcW + x) << 2;
    const srcEnd = srcStart + (w << 2);
    out.set(frame.data.subarray(srcStart, srcEnd), row * (w << 2));
  }
  return { width: w, height: h, data: out };
}

/** 抓帧器接口。 */
export interface FrameGrabber {
  /** 当前原始视频宽度（px）。 */
  sourceWidth: number;
  /** 当前原始视频高度（px）。 */
  sourceHeight: number;
  /** 是否可用（尺寸就绪且 canvas 已装配）。 */
  readonly ready: boolean;
  /**
   * 抓取整帧。
   *
   * @returns 整帧像素源；不可用时返回 `null`。
   */
  grabAll: () => PixelSource | null;
  /**
   * 按归一化矩形抓取子区域。
   *
   * @param norm 归一化矩形（0–1）。
   * @returns 子区域像素源；不可用时返回 `null`。
   */
  grabRect: (norm: RegionRect) => PixelSource | null;
  /**
   * 抓取一次整帧，并按多个归一化矩形裁剪（同帧复用，供 `expBar`/`expText` 同框优化）。
   *
   * @param rects 归一化矩形列表（可为空 → 返回整帧自身一次）。
   * @returns 像素源列表（顺序与入参一致）；不可用时返回 `null`。
   */
  grabRects: (rects: RegionRect[]) => PixelSource[] | null;
}

/** `ImageData` 兼容的最小 canvas 上下文接口（避免硬绑定 `lib.dom` 具体命名）。 */
interface GrabContext {
  /**
   * 绘制图像（对齐 DOM `drawImage` 的 5 参 / 9 参重载）。
   *
   * `grabRect` 使用 9 参**源矩形裁剪**重载；若只声明 5 参签名，9 参调用会被 TS
   * 误判为「参数过多」而掩盖真实参数错误（TS2554）。此处补齐 9 参重载，
   * 使裁剪调用的参数类型得到检查。
   */
  drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
}

/** `useFrameGrabber` 的返回。 */
export interface UseFrameGrabber {
  /** 是否可用。 */
  ready: ComputedRef<boolean>;
  /** 原始宽度。 */
  sourceWidth: Ref<number>;
  /** 原始高度。 */
  sourceHeight: Ref<number>;
  /** 绑定 video 元素（尺寸就绪后建立画布）。 */
  attach: (video: HTMLVideoElement | null) => void;
  /** 抓帧器对象。 */
  grabber: ComputedRef<FrameGrabber>;
}

/**
 * 创建一个抓帧器（需在组件作用域内调用）。
 *
 * @returns `UseFrameGrabber`。
 */
export function useFrameGrabber(): UseFrameGrabber {
  const video = shallowRef<HTMLVideoElement | null>(null);
  const sourceWidth = ref(0);
  const sourceHeight = ref(0);
  const canvas = shallowRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  const ready = computed(() => sourceWidth.value > 0 && sourceHeight.value > 0 && !!canvas.value);

  /** 创建（或复用）画布并同步尺寸。 */
  const ensureCanvas = (): void => {
    const w = sourceWidth.value;
    const h = sourceHeight.value;
    if (w <= 0 || h <= 0) return;
    let c = canvas.value;
    if (!c) {
      if (typeof OffscreenCanvas !== 'undefined') {
        c = new OffscreenCanvas(w, h);
      } else if (typeof document !== 'undefined') {
        c = document.createElement('canvas');
      } else {
        return;
      }
      canvas.value = c;
    }
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  };

  /** 取 2D 上下文。 */
  const getContext = (): GrabContext | null => {
    const c = canvas.value;
    if (!c) return null;
    const ctx = (c as HTMLCanvasElement).getContext('2d') as unknown as GrabContext | null;
    return ctx;
  };

  /**
   * 抓整帧到画布并取 `ImageData`。
   *
   * @returns 整帧像素源；不可用返回 `null`。
   */
  const grabAll = (): PixelSource | null => {
    const el = video.value;
    if (!el || sourceWidth.value <= 0 || sourceHeight.value <= 0) return null;
    ensureCanvas();
    const ctx = getContext();
    if (!ctx) return null;
    try {
      ctx.drawImage(el, 0, 0, sourceWidth.value, sourceHeight.value);
      const img = ctx.getImageData(0, 0, sourceWidth.value, sourceHeight.value);
      return { width: sourceWidth.value, height: sourceHeight.value, data: img.data };
    } catch {
      return null;
    }
  };

  /**
   * 按归一化矩形抓取子区域（在画布上直接裁剪，避免抓整帧）。
   *
   * @param norm 归一化矩形（0–1）。
   * @returns 子区域像素源；不可用返回 `null`。
   */
  const grabRect = (norm: RegionRect): PixelSource | null => {
    const el = video.value;
    if (!el || sourceWidth.value <= 0 || sourceHeight.value <= 0) return null;
    const box = normalizeToPixels(norm, sourceWidth.value, sourceHeight.value);
    if (box.w <= 0 || box.h <= 0) return null;
    ensureCanvas();
    const ctx = getContext();
    if (!ctx) return null;
    try {
      // 直接按源矩形 drawImage 到 (0,0)，只保留子区域像素。
      ctx.drawImage(el, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const img = ctx.getImageData(0, 0, box.w, box.h);
      return { width: box.w, height: box.h, data: img.data };
    } catch {
      return null;
    }
  };

  /**
   * 抓一次整帧 → 按多个归一化矩形裁剪（同帧复用，供 `expBar`/`expText` 同框优化）。
   *
   * @param rects 归一化矩形列表。
   * @returns 像素源列表；不可用返回 `null`。
   */
  const grabRects = (rects: RegionRect[]): PixelSource[] | null => {
    const frame = grabAll();
    if (!frame) return null;
    if (rects.length === 0) return [frame];
    return rects.map((norm) =>
      cropImageData(frame, normalizeToPixels(norm, sourceWidth.value, sourceHeight.value)),
    );
  };

  const grabber = computed<FrameGrabber>(() => ({
    sourceWidth: sourceWidth.value,
    sourceHeight: sourceHeight.value,
    get ready() {
      return ready.value;
    },
    grabAll,
    grabRect,
    grabRects,
  }));

  /**
   * 绑定 video 元素并同步尺寸。
   *
   * @param el video 元素或 `null`。
   */
  const attach = (el: HTMLVideoElement | null): void => {
    video.value = el;
    if (el) {
      const sync = (): void => {
        sourceWidth.value = Number.isFinite(el.videoWidth) ? el.videoWidth : 0;
        sourceHeight.value = Number.isFinite(el.videoHeight) ? el.videoHeight : 0;
        ensureCanvas();
      };
      sync();
      el.addEventListener('loadedmetadata', sync);
      el.addEventListener('resize', sync);
    } else {
      sourceWidth.value = 0;
      sourceHeight.value = 0;
      canvas.value = null;
    }
  };

  return { ready, sourceWidth, sourceHeight, attach, grabber };
}
