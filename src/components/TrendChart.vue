<script setup lang="ts">
/**
 * TrendChart —— ★ 效率趋势图（P1）。
 *
 * ## 实现选择（与架构文档的偏差，已说明）
 * 架构文档 §2 建议用 **uPlot**，但 `package.json` 中**未声明 uPlot 依赖**（仅 vite/vue/
 * element-plus/pinia/dexie 等）。为遵守「不擅自新增重量级依赖、保持可离线构建」的约束，
 * 本组件用**原生 SVG** 绘制折线（零依赖、可服务端渲染、体积小）。若后续确需 uPlot 的交互
 * （缩放/游标），可在 `package.json` 增加依赖后替换本组件实现（对外 props 契约保持不变）。
 *
 * ## 数据
 * 由 `samples`（按 `t` 升序）推导「经验/小时」趋势：
 * - 以相邻两个**有效经验绝对值**样本的 `Δexp/Δt` 计算瞬时速率（与核心口径一致）；
 * - 拒识样本（`expRaw === null`）跳过，不在图上伪造 0 点。
 *
 * 拒识约定：无足够样本时展示空态，不画猜测曲线。
 */
import { computed } from 'vue';
import type { Sample } from '@/types/models';
import { formatCompact, formatDurationShort } from '@/utils/format';
import { MS_PER_HOUR } from '@/core/metrics';
import EmptyState from './EmptyState.vue';

const props = withDefaults(
  defineProps<{
    /** 采样点（按 `t` 升序）。 */
    samples: Sample[];
    /** 图表高度（px）。 */
    height?: number;
  }>(),
  { height: 200 },
);

/** SVG 视口宽（viewBox 逻辑宽，实际宽度自适应）。 */
const VIEW_W = 640;

/** 内边距。 */
const PAD = { top: 16, right: 16, bottom: 24, left: 56 };

/**
 * 由采样点推导趋势点 `{ t, rate }`（经验/小时）。
 *
 * @returns 趋势点列表（时间升序）。
 */
const points = computed<Array<{ t: number; rate: number }>>(() => {
  const valid = props.samples.filter((s) => s.expRaw !== null && Number.isFinite(s.expRaw));
  const out: Array<{ t: number; rate: number }> = [];
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1];
    const b = valid[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    const dExp = (b.expRaw as number) - (a.expRaw as number);
    if (dExp < 0) continue; // 跨级/回退不计
    out.push({ t: b.t, rate: (dExp / dt) * MS_PER_HOUR });
  }
  return out;
});

/** 是否有可绘制数据。 */
const hasData = computed<boolean>(() => points.value.length >= 2);

/** 数值范围（用于纵轴）。 */
const range = computed(() => {
  const pts = points.value;
  if (pts.length === 0) return { min: 0, max: 1, maxT: 1 };
  let min = Infinity;
  let max = -Infinity;
  let maxT = 0;
  for (const p of pts) {
    if (p.rate < min) min = p.rate;
    if (p.rate > max) max = p.rate;
    if (p.t > maxT) maxT = p.t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, maxT: 1 };
  if (max === min) max = min + 1;
  return { min, max, maxT: maxT > 0 ? maxT : 1 };
});

/** 绘图区尺寸。 */
const plot = computed(() => {
  const w = VIEW_W - PAD.left - PAD.right;
  const h = props.height - PAD.top - PAD.bottom;
  return { w, h };
});

/**
 * 把数据点映射为 SVG 坐标。
 *
 * @param t 时刻。
 * @param rate 速率。
 * @returns `{x,y}`。
 */
function toXY(t: number, rate: number): { x: number; y: number } {
  const { min, max, maxT } = range.value;
  const { w, h } = plot.value;
  const x = PAD.left + (t / maxT) * w;
  const y = PAD.top + (1 - (rate - min) / (max - min)) * h;
  return { x, y };
}

/** 折线 `points` 属性字符串。 */
const polyline = computed<string>(() =>
  points.value
    .map((p) => {
      const { x, y } = toXY(p.t, p.rate);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' '),
);

/** 纵轴刻度（min / mid / max）。 */
const yTicks = computed<Array<{ y: number; label: string }>>(() => {
  const { min, max } = range.value;
  const { h } = plot.value;
  const mid = (min + max) / 2;
  return [
    { y: PAD.top, label: formatCompact(max) },
    { y: PAD.top + h / 2, label: formatCompact(mid) },
    { y: PAD.top + h, label: formatCompact(min) },
  ];
});

/** 横轴起止时刻标签。 */
const xLabels = computed<{ start: string; end: string }>(() => ({
  start: '00:00:00',
  end: formatDurationShort(range.value.maxT),
}));
</script>

<template>
  <div class="trend-chart">
    <EmptyState
      v-if="!hasData"
      title="暂无可绘制的趋势"
      description="需要至少 2 个有效经验读数样本才能计算速率趋势。"
    />
    <svg
      v-else
      class="trend-chart__svg"
      :viewBox="`0 0 ${VIEW_W} ${height}`"
      preserveAspectRatio="none"
      role="img"
      aria-label="效率趋势图"
    >
      <!-- 纵轴刻度 -->
      <g class="trend-chart__grid">
        <template v-for="tick in yTicks" :key="tick.y">
          <line :x1="PAD.left" :y1="tick.y" :x2="VIEW_W - PAD.right" :y2="tick.y" />
          <text :x="PAD.left - 6" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
        </template>
      </g>

      <!-- 折线 -->
      <polyline class="trend-chart__line" :points="polyline" />

      <!-- 横轴标签 -->
      <text :x="PAD.left" :y="height - 6" text-anchor="start">{{ xLabels.start }}</text>
      <text :x="VIEW_W - PAD.right" :y="height - 6" text-anchor="end">{{ xLabels.end }}</text>
    </svg>
    <p v-if="hasData" class="trend-chart__caption">纵轴：经验 / 小时 · 横轴：记录内时间</p>
  </div>
</template>

<style scoped>
.trend-chart {
  width: 100%;
}

.trend-chart__svg {
  display: block;
  width: 100%;
  height: auto;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}

.trend-chart__grid line {
  stroke: #f0f2f5;
  stroke-width: 1;
}

.trend-chart__grid text {
  font-size: 10px;
  fill: #909399;
}

.trend-chart__line {
  fill: none;
  stroke: #f59e0b;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.trend-chart__svg text {
  font-size: 10px;
  fill: #909399;
}

.trend-chart__caption {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
