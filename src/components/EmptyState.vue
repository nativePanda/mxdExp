<script setup lang="ts">
/**
 * EmptyState —— 通用空状态（标题 + 说明 + 可选插槽）。
 */
withDefaults(
  defineProps<{
    /** 标题。 */
    title: string;
    /** 说明。 */
    description?: string;
  }>(),
  { description: '' },
);
</script>

<template>
  <div class="empty-state">
    <div class="empty-state__icon" aria-hidden="true">☐</div>
    <div class="empty-state__title">{{ title }}</div>
    <p v-if="description" class="empty-state__desc">{{ description }}</p>
    <div class="empty-state__actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 24px;
  background: #fafafa;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  text-align: center;
}

.empty-state__icon {
  font-size: 28px;
  color: #c0c4cc;
}

.empty-state__title {
  font-size: 15px;
  font-weight: 600;
  color: #606266;
}

.empty-state__desc {
  margin: 0;
  max-width: 480px;
  font-size: 13px;
  color: #909399;
}

.empty-state__actions {
  margin-top: 8px;
}
</style>
