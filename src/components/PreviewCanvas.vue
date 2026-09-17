<script setup lang="ts">
/**
 * PreviewCanvas —— 共享画面预览 + 校准框叠加。
 *
 * 把「离屏 video 元素」（由 `useDisplayStream` 提供）挂载到可见容器中，
 * 并叠加 `CalibrationOverlay` 用于框选。预览容器保持原始宽高比（`aspect-ratio`）。
 *
 * 说明：video 元素本身由父级通过 `videoEl` prop 传入并 `appendChild`；
 * 组件只负责容器与叠加层。
 */
import { computed, ref, watch, onMounted } from 'vue';
import type { Region, RegionKey, RegionRect } from '@/types/calibration';
import CalibrationOverlay from './CalibrationOverlay.vue';

const props = defineProps<{
  /** 原始画面宽度（px）。 */
  width: number;
  /** 原始画面高度（px）。 */
  height: number;
  /** 离屏 video 元素（未连接为 `null`）。 */
  videoEl: HTMLVideoElement | null;
  /** 是否叠加校准框。 */
  overlay: boolean;
  /** 六区域（叠加时使用）。 */
  regions?: Record<RegionKey, Region>;
  /** 当前选中区域键。 */
  activeKey?: RegionKey;
}>();

const emit = defineEmits<{
  /** 切换选中区域。 */
  (e: 'update:activeKey', key: RegionKey): void;
  /** 上报某区域矩形。 */
  (e: 'update:region', key: RegionKey, rect: RegionRect): void;
}>();

/** 视频挂载容器。 */
const stageRef = ref<HTMLDivElement | null>(null);

/** 宽高比（用于保持预览不变形）。 */
const aspect = computed<string>(() =>
  props.width > 0 && props.height > 0 ? `${props.width} / ${props.height}` : '16 / 9',
);

/**
 * 把 video 元素挂载到预览容器。
 */
function mountVideo(): void {
  const stage = stageRef.value;
  const el = props.videoEl;
  if (!stage) return;
  // 清空旧子节点（保留 overlay 的兄弟层由模板控制）。
  if (el && el.parentElement !== stage) {
    stage.appendChild(el);
  }
}

watch(
  () => props.videoEl,
  () => mountVideo(),
);
onMounted(() => mountVideo());
</script>

<template>
  <div class="preview-canvas">
    <div v-if="width <= 0" class="preview-canvas__empty">
      <p>尚未连接共享画面</p>
      <p class="preview-canvas__empty-sub">请在上方选择游戏窗口后在此预览并框选</p>
    </div>

    <div v-else class="preview-canvas__stage" :style="{ aspectRatio: aspect }">
      <div ref="stageRef" class="preview-canvas__video" />
      <CalibrationOverlay
        v-if="overlay && regions && activeKey"
        :regions="regions"
        :active-key="activeKey"
        @update:active-key="(k) => emit('update:activeKey', k)"
        @update:region="(k, r) => emit('update:region', k, r)"
      />
    </div>
  </div>
</template>

<style scoped>
.preview-canvas {
  position: relative;
  width: 100%;
  background: #111827;
  border: 1px solid #1f2937;
  border-radius: 10px;
  overflow: hidden;
  min-height: 220px;
}

.preview-canvas__empty {
  display: flex;
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #9ca3af;
  font-size: 14px;
}

.preview-canvas__empty-sub {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
}

.preview-canvas__stage {
  position: relative;
  width: 100%;
}

.preview-canvas__video {
  position: absolute;
  inset: 0;
}

.preview-canvas__video :deep(video) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
