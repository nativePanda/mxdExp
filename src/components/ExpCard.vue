<script setup lang="ts">
/**
 * ExpCard —— 经验卡：当前等级 / 本级经验进度条 / 净经验 / 经验每小时。
 *
 * 拒识约定：`null` 一律显示「—」（`formatInt` / `formatCompact` 兜底），绝不显示猜测值或 0。
 * 数据可信度：`muted` 为 `true` 时（`readState` 异常）数值整体置灰，并显示 `mutedHint`。
 */
import { computed } from 'vue';
import type { LevelInfo } from '@/types/models';
import type { EfficiencyTier } from '@/types/enums';
import { formatInt, formatCompact, formatPercent, PLACEHOLDER } from '@/utils/format';
import EfficiencyTierTag from './EfficiencyTierTag.vue';

const props = withDefaults(
  defineProps<{
    /** 等级进度信息；未知为 `null`。 */
    levelInfo: LevelInfo | null;
    /** 净经验；含未确认区间为 `null`。 */
    netExp: number | null;
    /** 经验/小时；不可算为 `null`。 */
    expPerHour: number | null;
    /** 效率分档；未知为 `null`。 */
    tier: EfficiencyTier | null;
    /** 是否置灰（数据可信度低）。 */
    muted?: boolean;
    /** 置灰原因提示。 */
    mutedHint?: string;
  }>(),
  { muted: false, mutedHint: '' },
);

/** 当前等级文本。 */
const levelText = computed<string>(() =>
  props.levelInfo && props.levelInfo.level > 0 ? `Lv.${props.levelInfo.level}` : PLACEHOLDER,
);

/** 本级经验占比（0–100）。 */
const percent = computed<number>(() => props.levelInfo?.expPercent ?? 0);

/** 百分比文本。 */
const percentText = computed<string>(() =>
  props.levelInfo ? `${percent.value.toFixed(2)}%` : PLACEHOLDER,
);

/** 当前经验 / 所需经验文本。 */
const currentText = computed<string>(() => formatInt(props.levelInfo?.currentExp ?? null));
const neededText = computed<string>(() => formatInt(props.levelInfo?.expNeeded ?? null));

/** 净经验文本。 */
const netText = computed<string>(() => formatCompact(props.netExp));

/** 经验/小时文本。 */
const rateText = computed<string>(() => formatCompact(props.expPerHour));

/** 距升级文本。 */
const toNextText = computed<string>(() => formatInt(props.levelInfo?.expToNext ?? null));
</script>

<template>
  <section class="exp-card" :class="{ 'exp-card--muted': muted }">
    <header class="exp-card__head">
      <div class="exp-card__level">
        <span class="exp-card__level-label">等级</span>
        <span class="exp-card__level-value">{{ levelText }}</span>
      </div>
      <EfficiencyTierTag :tier="tier" />
    </header>

    <div class="exp-card__progress">
      <div class="exp-card__progress-bar">
        <div class="exp-card__progress-fill" :style="{ width: `${percent}%` }" />
      </div>
      <div class="exp-card__progress-meta">
        <span>{{ currentText }} / {{ neededText }}</span>
        <span>{{ percentText }}</span>
      </div>
    </div>

    <div class="exp-card__stats">
      <div class="exp-card__stat">
        <div class="exp-card__stat-label">净经验</div>
        <div class="exp-card__stat-value">{{ netText }}</div>
      </div>
      <div class="exp-card__stat">
        <div class="exp-card__stat-label">经验 / 小时</div>
        <div class="exp-card__stat-value">{{ rateText }}</div>
      </div>
      <div class="exp-card__stat">
        <div class="exp-card__stat-label">距升级</div>
        <div class="exp-card__stat-value">{{ toNextText }}</div>
      </div>
    </div>

    <p v-if="muted && mutedHint" class="exp-card__muted-hint">{{ mutedHint }}</p>
  </section>
</template>

<style scoped>
.exp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.exp-card--muted {
  background: #f4f4f5;
}

.exp-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.exp-card__level-label {
  margin-right: 6px;
  font-size: 12px;
  color: #909399;
}

.exp-card__level-value {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}

.exp-card__progress-bar {
  height: 10px;
  border-radius: 999px;
  background: #f0f2f5;
  overflow: hidden;
}

.exp-card__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #d97706);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.exp-card__progress-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  font-variant-numeric: tabular-nums;
}

.exp-card__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.exp-card__stat {
  padding: 8px 10px;
  background: #fafafa;
  border-radius: 8px;
}

.exp-card__stat-label {
  font-size: 12px;
  color: #909399;
}

.exp-card__stat-value {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

.exp-card--muted .exp-card__stat-value,
.exp-card--muted .exp-card__level-value {
  color: #a8abb2;
}

.exp-card__muted-hint {
  margin: 0;
  font-size: 12px;
  color: #b45309;
}
</style>
