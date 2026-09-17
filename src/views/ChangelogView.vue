<script setup lang="ts">
/**
 * ChangelogView —— 更新日志页。
 *
 * 依据：架构文档 §2.13。展示各版本的变更条目（与 PRD P0/P1 对齐）。
 *
 * 说明：日志内容为静态维护数据（本页不引入额外数据源）。
 */
import { APP_VERSION } from '@/utils/diag';

/** 单条变更。 */
interface ChangeEntry {
  /** 类型：新增 / 修复 / 优化。 */
  type: 'feat' | 'fix' | 'perf';
  /** 变更描述。 */
  text: string;
}

/** 单版本日志。 */
interface ChangelogRelease {
  /** 版本号。 */
  version: string;
  /** 日期（YYYY-MM-DD）。 */
  date: string;
  /** 变更列表。 */
  entries: ChangeEntry[];
}

/** 类型标签文案。 */
const TYPE_TEXT: Record<ChangeEntry['type'], string> = {
  feat: '新增',
  fix: '修复',
  perf: '优化',
};

/** 更新日志。 */
const releases: ChangelogRelease[] = [
  {
    version: APP_VERSION,
    date: '2025-01-01',
    entries: [
      { type: 'feat', text: '控制面板：三步引导、共享画面、经验卡 / 金币卡、实时效率面板与记录控制' },
      { type: 'feat', text: '识别校准：6 区域框选（经验条 / 经验数值 / 等级 / 金币 / HP / MP）+ 字形模板向导' },
      { type: 'feat', text: '历史记录：列表 / 详情 / 趋势图 / 导出导入 / 删除' },
      { type: 'feat', text: '设置：性能档位、采集帧率、经验表管理、诊断信息' },
      { type: 'fix', text: '修复恢复区间标记失效：`Segment.isRecoveredStart` 现由采集管线真实置位' },
      { type: 'perf', text: '实时效率面板在读数异常（中断 / 超时 / 跨级缺失）时置灰陈旧数值，避免误导' },
    ],
  },
];
</script>

<template>
  <div class="changelog-view">
    <header class="changelog-view__intro">
      <h1 class="changelog-view__title">更新日志</h1>
      <p class="changelog-view__subtitle">按版本倒序记录功能变更与修复。</p>
    </header>

    <section v-for="rel in releases" :key="rel.version" class="changelog-card">
      <header class="changelog-card__head">
        <h2 class="changelog-card__version">v{{ rel.version }}</h2>
        <span class="changelog-card__date">{{ rel.date }}</span>
      </header>
      <ul class="changelog-card__list">
        <li v-for="(entry, i) in rel.entries" :key="i" class="changelog-card__item">
          <span class="changelog-tag" :class="`changelog-tag--${entry.type}`">
            {{ TYPE_TEXT[entry.type] }}
          </span>
          <span class="changelog-card__text">{{ entry.text }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.changelog-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
}

.changelog-view__title {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.changelog-view__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.changelog-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.changelog-card__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.changelog-card__version {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #b45309;
}

.changelog-card__date {
  font-size: 12px;
  color: #909399;
}

.changelog-card__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.changelog-card__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.changelog-card__text {
  font-size: 13px;
  color: #303133;
  line-height: 1.5;
}

.changelog-tag {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.changelog-tag--feat {
  color: #15803d;
  background: #dcfce7;
}

.changelog-tag--fix {
  color: #dc2626;
  background: #fee2e2;
}

.changelog-tag--perf {
  color: #409eff;
  background: #ecf5ff;
}
</style>
