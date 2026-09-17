<script setup lang="ts">
/**
 * RateComparePanel —— ★ 实时效率面板：近 60 秒速率 vs 全程平均 + 4%/2% 箭头 hysteresis。
 *
 * ## 架构决策（T03 裁定，缺陷 2）
 * 速率**陈旧性不下沉到 `rateCompare` 内核**（它只负责计算，不承担展示时序职责）。
 * 无有效读数的帧（遮挡/拒识）会**完全跳过** `pushRateSample`，因此 `rate.last60s`
 * 会**冻结在遮挡前的旧值**——该数值在遮挡期间是**陈旧**的，UI 不得把它当新鲜数据展示。
 *
 * 本组件因此在 **UI 层依据 `readState` 表达数据可信度**：
 * 当 `readState` 命中 `READ_STATE_IS_ALERT`（尤其 `interrupted` / `timeout` /
 * `missingCrossLevel` / `unconfirmedNet`）时，把受影响的数值指标（近 60 秒速率、
 * 上下箭头）**置灰或显示为「—」**，并展示 `READ_STATE_TEXT` / `READ_STATE_DESC` 提示。
 *
 * ## 硬约定
 * - 阈值（4% / 2% / 1.5s）已在 `core/metrics.rateCompare` 内实现，本组件**不重算**，
 *   仅渲染其快照（`arrowVisible` / `arrowUp` / `diffRatio`）；
 * - 文案一律引用 `@/types/enums`；
 * - `null` 一律显示「—」。
 */
import { computed } from 'vue';
import type { RateComparisonSnapshot } from '@/core/metrics';
import type { ReadState } from '@/types/enums';
import { READ_STATE_IS_ALERT, READ_STATE_TEXT, READ_STATE_DESC } from '@/types/enums';
import { formatCompact, formatSignedPercent, PLACEHOLDER } from '@/utils/format';
import StatTile from './StatTile.vue';
import ReadStateBadge from './ReadStateBadge.vue';

const props = defineProps<{
  /** 速率对比快照；无会话为 `null`。 */
  rate: RateComparisonSnapshot | null;
  /** 当前读数状态（决定数据可信度）。 */
  readState: ReadState;
}>();

/** 是否处于「数据不可信」状态（警告态 → 置灰并隐藏陈旧数值）。 */
const staleData = computed<boolean>(() => READ_STATE_IS_ALERT[props.readState]);

/** 「近 60 秒」是否应隐藏（陈旧时显示「—」）。 */
const last60sText = computed<string>(() =>
  staleData.value ? PLACEHOLDER : formatCompact(props.rate?.last60s ?? null),
);

/** 「全程平均」文本（全程序均值不因短期遮挡而失效，但仍随 `staleData` 一起标注）。 */
const overallText = computed<string>(() => formatCompact(props.rate?.overallAvg ?? null));

/** 偏差文本（带符号百分比）。 */
const diffText = computed<string>(() =>
  staleData.value ? PLACEHOLDER : formatSignedPercent(props.rate?.diffRatio ?? null),
);

/** 箭头是否展示（陈旧时**不展示**箭头，避免误导）。 */
const showArrow = computed<boolean>(() => !staleData.value && !!props.rate?.arrowVisible);

/** 箭头方向（`true` = 上升）。 */
const arrowUp = computed<boolean>(() => !!props.rate?.arrowUp);

/** 箭头符号。 */
const arrowGlyph = computed<string>(() => (arrowUp.value ? '▲' : '▼'));

/** 状态提示文案（陈旧时展示，帮助用户理解为何置灰）。 */
const staleHint = computed<string>(() =>
  staleData.value ? READ_STATE_TEXT[props.readState] : '',
);

/** 状态解释（hover）。 */
const stateDesc = computed<string>(() => READ_STATE_DESC[props.readState]);
</script>

<template>
  <section class="rate-panel" :class="{ 'rate-panel--stale': staleData }">
    <header class="rate-panel__head">
      <h3 class="rate-panel__title">实时效率</h3>
      <ReadStateBadge :state="readState" />
    </header>

    <div class="rate-panel__grid">
      <StatTile
        label="近 60 秒"
        :value="last60sText"
        unit="/h"
        accent="exp"
        :muted="staleData"
      />
      <StatTile
        label="全程平均"
        :value="overallText"
        unit="/h"
        :muted="staleData"
      />
      <div class="rate-panel__diff" :class="{ 'rate-panel__diff--muted': staleData }">
        <div class="rate-panel__diff-label">与平均偏差</div>
        <div class="rate-panel__diff-value">
          <span
            v-if="showArrow"
            class="rate-panel__arrow"
            :class="arrowUp ? 'rate-panel__arrow--up' : 'rate-panel__arrow--down'"
            :title="arrowUp ? '当前高于全程平均' : '当前低于全程平均'"
          >{{ arrowGlyph }}</span>
          <span>{{ diffText }}</span>
        </div>
      </div>
    </div>

    <p v-if="staleData" class="rate-panel__stale-hint" :title="stateDesc">
      <span class="rate-panel__stale-dot" aria-hidden="true" />
      {{ staleHint }}：近 60 秒速率可能为遮挡前的陈旧值，已置灰。
    </p>
  </section>
</template>

<style scoped>
.rate-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.rate-panel--stale {
  background: #fbfbfc;
  border-color: #fcd34d;
}

.rate-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rate-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.rate-panel__grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  align-items: stretch;
}

.rate-panel__diff {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 12px 14px;
  background: #fafafa;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}

.rate-panel__diff--muted {
  background: #f4f4f5;
  border-color: #e9e9eb;
}

.rate-panel__diff-label {
  font-size: 12px;
  color: #909399;
}

.rate-panel__diff-value {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

.rate-panel__diff--muted .rate-panel__diff-value {
  color: #a8abb2;
}

.rate-panel__arrow {
  font-size: 14px;
}

.rate-panel__arrow--up {
  color: #16a34a;
}

.rate-panel__arrow--down {
  color: #dc2626;
}

.rate-panel__stale-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: #b45309;
}

.rate-panel__stale-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
}
</style>
