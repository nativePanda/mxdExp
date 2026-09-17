<script setup lang="ts">
/**
 * 根组件：顶部标题栏 + 5 个 tab 导航 + `<router-view>`。
 *
 * 说明：真正的 `AppHeader.vue` 组件属 T04，此处先内联实现，
 * 保证 T01 阶段「5 个 tab 路由可切换、控制台无报错」的验收标准成立。
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { TABS } from '@/router';
import { TEXTS } from '@/constants/texts';

const route = useRoute();
const router = useRouter();

/** 当前激活的 tab 路径（用于高亮）。 */
const activePath = computed<string>(() => route.path);

/** 底部隐私提示文案。 */
const privacyText = TEXTS.LOCAL_ONLY;

/**
 * 切换 tab。
 *
 * @param path 目标路由路径。
 */
function go(path: string): void {
  if (route.path !== path) {
    void router.push(path);
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header__brand">
        <span class="app-header__title">经验记录</span>
        <span class="app-header__subtitle">{{ privacyText }}</span>
      </div>
      <nav class="app-header__tabs" aria-label="主导航">
        <button
          v-for="tab in TABS"
          :key="tab.path"
          type="button"
          class="app-tab"
          :class="{ 'app-tab--active': activePath === tab.path }"
          :aria-current="activePath === tab.path ? 'page' : undefined"
          @click="go(tab.path)"
        >
          {{ tab.title }}
        </button>
      </nav>
    </header>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  background-color: #f7f8fa;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 24px;
  background-color: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
}

.app-header__brand {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.app-header__title {
  font-size: 18px;
  font-weight: 700;
  color: #b45309;
}

.app-header__subtitle {
  font-size: 12px;
  color: #909399;
}

.app-header__tabs {
  display: flex;
  gap: 4px;
}

.app-tab {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #606266;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.app-tab:hover {
  background-color: #f2f3f5;
  color: #303133;
}

.app-tab--active {
  background-color: #fef3c7;
  color: #b45309;
  font-weight: 600;
}

.app-main {
  flex: 1;
  padding: 24px;
}
</style>
