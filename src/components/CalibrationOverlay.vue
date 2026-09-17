<script setup lang="ts">
/**
 * CalibrationOverlay —— 拖拽框选 6 区域（`expBar` / `expText` / `level` / `gold` / `hp` / `mp`）。
 *
 * ## 坐标约定（架构 §5.1）
 * 区域一律为 **0–1 归一化坐标**（相对原始视频尺寸）。本组件在**预览显示尺寸**上做
 * 交互，再按 `clientWidth/clientHeight` 归一化后经 `update:region` 上抛；
 * **不在此计算像素**（像素换算统一走 `useFrameGrabber`）。
 *
 * ## 联动
 * `expSplit=false` 时 `expBar` / `expText` 由 store 联动为同一矩形；本组件只上报被拖拽的键。
 *
 * ## 交互
 * - 从空白处按下并拖拽 → 绘制当前选中区域的矩形；
 * - 点击已存在矩形 → 选中该区域（高亮）；
 * - 支持键盘 `Esc` 取消当前拖拽。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Region, RegionKey, RegionRect } from '@/types/calibration';
import { REGION_KEY_VALUES } from '@/types/calibration';
import { REGION_META } from '@/constants/regions';

const props = defineProps<{
  /** 六区域（归一化）。 */
  regions: Record<RegionKey, Region>;
  /** 当前选中区域键。 */
  activeKey: RegionKey;
}>();

const emit = defineEmits<{
  /** 请求切换选中区域。 */
  (e: 'update:activeKey', key: RegionKey): void;
  /** 上报某区域的新矩形（归一化）。 */
  (e: 'update:region', key: RegionKey, rect: RegionRect): void;
}>();

/** 覆盖层根元素。 */
const rootRef = ref<HTMLDivElement | null>(null);

/** 拖拽起点（归一化）；未拖拽为 `null`。 */
const dragStart = ref<{ x: number; y: number } | null>(null);

/** 拖拽预览矩形（归一化）；未拖拽为 `null`。 */
const dragPreview = ref<RegionRect | null>(null);

/** 六个区域的展示顺序（与区域清单一致）。 */
const keys = computed<RegionKey[]>(() => [...REGION_KEY_VALUES]);

/**
 * 取根元素尺寸（预览显示尺寸）。
 *
 * @returns `{ w, h }`；不可用返回 `{w:1,h:1}` 兜底避免除零。
 */
function rootSize(): { w: number; h: number } {
  const el = rootRef.value;
  if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return { w: 1, h: 1 };
  return { w: el.clientWidth, h: el.clientHeight };
}

/**
 * 把鼠标事件换算为归一化坐标（裁剪到 [0,1]）。
 *
 * @param e 鼠标事件。
 * @returns 归一化坐标。
 */
function toNorm(e: MouseEvent): { x: number; y: number } {
  const el = rootRef.value;
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  const { w, h } = rootSize();
  const x = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
  const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
  void w;
  void h;
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * 由两个归一化点构造矩形（支持任意方向拖拽）。
 *
 * @param a 起点。
 * @param b 终点。
 * @returns 归一化矩形。
 */
function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): RegionRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/**
 * 裁剪到 [0,1]。
 *
 * @param v 值。
 * @returns 裁剪结果。
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * 开始拖拽（在覆盖层空白处按下）。
 *
 * @param e 鼠标事件。
 */
function onDown(e: MouseEvent): void {
  e.preventDefault();
  const start = toNorm(e);
  dragStart.value = start;
  dragPreview.value = { x: start.x, y: start.y, w: 0, h: 0 };
}

/**
 * 拖拽中：更新预览矩形（仅在已有起点时）。
 *
 * @param e 鼠标事件。
 */
function onMove(e: MouseEvent): void {
  if (!dragStart.value) return;
  dragPreview.value = rectFromPoints(dragStart.value, toNorm(e));
}

/**
 * 结束拖拽：上报矩形（过小视为误触，忽略）。
 */
function onUp(): void {
  const preview = dragPreview.value;
  const start = dragStart.value;
  dragStart.value = null;
  dragPreview.value = null;
  if (!preview || !start) return;
  // 过小的矩形视为误触（< 1% 边长的点击）。
  if (preview.w < 0.01 || preview.h < 0.01) return;
  emit('update:region', props.activeKey, preview);
}

/** 选中某区域。 */
function selectKey(key: RegionKey): void {
  emit('update:activeKey', key);
}

/**
 * 区域矩形的展示样式（百分比）。
 *
 * @param r 区域。
 * @returns 内联样式。
 */
function boxStyle(r: RegionRect): Record<string, string> {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  };
}

/** 拖拽预览样式。 */
const previewStyle = computed<Record<string, string> | null>(() => {
  const p = dragPreview.value;
  return p ? boxStyle(p) : null;
});

/**
 * 键盘 Esc 取消拖拽。
 *
 * @param e 键盘事件。
 */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    dragStart.value = null;
    dragPreview.value = null;
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
});

/** 暴露给父级用于「自动识别」填充后无需重算（纯展示）。 */
defineExpose({ keys, boxStyle });
</script>

<template>
  <div
    ref="rootRef"
    class="calib-overlay"
    @mousedown="onDown"
    @mousemove="onMove"
    @mouseup="onUp"
    @mouseleave="onUp"
  >
    <div
      v-for="key in keys"
      :key="key"
      class="calib-box"
      :class="{
        'calib-box--active': key === activeKey,
        'calib-box--optional': !REGION_META[key].required,
      }"
      :style="boxStyle(regions[key])"
      :title="`${REGION_META[key].label}：${REGION_META[key].description}`"
      @mousedown.stop="selectKey(key)"
      @click.stop="selectKey(key)"
    >
      <span class="calib-box__label">{{ REGION_META[key].label }}</span>
    </div>

    <div v-if="previewStyle" class="calib-preview" :style="previewStyle" />

    <div v-if="dragStart" class="calib-hint">松开鼠标完成框选</div>
  </div>
</template>

<style scoped>
.calib-overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  user-select: none;
}

.calib-box {
  position: absolute;
  border: 2px solid rgb(59 130 246 / 80%);
  background: rgb(59 130 246 / 12%);
  border-radius: 3px;
  box-sizing: border-box;
  cursor: move;
}

.calib-box--active {
  border-color: #f59e0b;
  background: rgb(245 158 11 / 18%);
  box-shadow: 0 0 0 2px rgb(245 158 11 / 30%);
}

.calib-box--optional {
  border-style: dashed;
}

.calib-box__label {
  position: absolute;
  top: -18px;
  left: 0;
  padding: 0 4px;
  font-size: 11px;
  color: #ffffff;
  background: rgb(59 130 246 / 90%);
  border-radius: 3px;
  white-space: nowrap;
}

.calib-box--active .calib-box__label {
  background: #f59e0b;
}

.calib-preview {
  position: absolute;
  border: 2px dashed #f59e0b;
  background: rgb(245 158 11 / 12%);
  box-sizing: border-box;
  pointer-events: none;
}

.calib-hint {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 8px;
  font-size: 11px;
  color: #ffffff;
  background: rgb(0 0 0 / 55%);
  border-radius: 4px;
  pointer-events: none;
}
</style>
