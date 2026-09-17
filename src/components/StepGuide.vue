<script setup lang="ts">
/**
 * StepGuide —— 三步引导（选择窗口 → 完成校准 → 开始记录）。
 *
 * 依据 PRD P0-1 / §5.2。步骤完成态由父级传入的三个布尔量决定。
 */
import { computed } from 'vue';

const props = defineProps<{
  /** 步骤 1：是否已连接共享窗口。 */
  step1Done: boolean;
  /** 步骤 2：是否已完成校准（必填区域已定位）。 */
  step2Done: boolean;
  /** 步骤 3：是否正在/已记录过（有会话）。 */
  step3Done: boolean;
  /** 当前激活步骤（1-based）；父级据状态计算。 */
  activeStep: number;
}>();

/** 三个步骤的展示模型。 */
const steps = computed(() => [
  { index: 1, title: '选择游戏窗口', desc: '共享游戏画面（仅在本地处理）', done: props.step1Done },
  { index: 2, title: '完成识别校准', desc: '框选经验条 / 经验数值 / 金币区域', done: props.step2Done },
  { index: 3, title: '开始记录', desc: '实时统计经验与金币效率', done: props.step3Done },
]);

/**
 * 步骤的 class。
 *
 * @param index 步骤序号。
 * @param done 是否完成。
 * @returns class 对象。
 */
function stepClass(index: number, done: boolean): Record<string, boolean> {
  return {
    'step-guide__step': true,
    'step-guide__step--done': done,
    'step-guide__step--active': !done && props.activeStep === index,
  };
}
</script>

<template>
  <ol class="step-guide">
    <li v-for="step in steps" :key="step.index" :class="stepClass(step.index, step.done)">
      <span class="step-guide__dot">{{ step.done ? '✓' : step.index }}</span>
      <span class="step-guide__body">
        <span class="step-guide__title">{{ step.title }}</span>
        <span class="step-guide__desc">{{ step.desc }}</span>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.step-guide {
  display: flex;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step-guide__step {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #ffffff;
}

.step-guide__step--active {
  border-color: #fcd34d;
  background: #fffbeb;
}

.step-guide__step--done {
  border-color: #86efac;
  background: #f0fdf4;
}

.step-guide__dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  border-radius: 50%;
  background: #f0f2f5;
  color: #909399;
  font-size: 12px;
  font-weight: 700;
}

.step-guide__step--active .step-guide__dot {
  background: #f59e0b;
  color: #ffffff;
}

.step-guide__step--done .step-guide__dot {
  background: #16a34a;
  color: #ffffff;
}

.step-guide__body {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.step-guide__title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.step-guide__desc {
  font-size: 11px;
  color: #909399;
}
</style>
