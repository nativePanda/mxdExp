<script setup lang="ts">
/**
 * GoldCard —— 金币卡：起始 / 当前 / 金币每小时。
 *
 * 拒识约定：`null` 显示「—」（`formatCompact` 兜底）。
 * 数据可信度：`muted=true` 时置灰并显示 `mutedHint`。
 */
import { computed } from 'vue';
import { formatCompact } from '@/utils/format';
import StatTile from './StatTile.vue';

const props = withDefaults(
  defineProps<{
    /** 起始金币；未知为 `null`。 */
    goldStart: number | null;
    /** 当前金币；未知为 `null`。 */
    goldNow: number | null;
    /** 金币/小时；不可算为 `null`。 */
    goldPerHour: number | null;
    /** 是否置灰。 */
    muted?: boolean;
    /** 置灰原因提示。 */
    mutedHint?: string;
  }>(),
  { muted: false, mutedHint: '' },
);

const startText = computed<string>(() => formatCompact(props.goldStart));
const nowText = computed<string>(() => formatCompact(props.goldNow));
const rateText = computed<string>(() => formatCompact(props.goldPerHour));
</script>

<template>
  <section class="gold-card">
    <header class="gold-card__head">
      <h3 class="gold-card__title">金币</h3>
      <span v-if="muted && mutedHint" class="gold-card__hint">{{ mutedHint }}</span>
    </header>
    <div class="gold-card__grid">
      <StatTile label="起始" :value="startText" accent="gold" :muted="muted" />
      <StatTile label="当前" :value="nowText" accent="gold" :muted="muted" />
      <StatTile label="金币 / 小时" :value="rateText" unit="/h" accent="gold" :muted="muted" />
    </div>
  </section>
</template>

<style scoped>
.gold-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.gold-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gold-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.gold-card__hint {
  font-size: 12px;
  color: #b45309;
}

.gold-card__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
</style>
