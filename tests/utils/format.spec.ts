/**
 * `utils/format.ts` 最小单测。
 *
 * 覆盖验收标准：千分位、HH:mm:ss、2.1M 缩写、百分比、null 占位符。
 */

import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER,
  formatCompact,
  formatDateTime,
  formatDuration,
  formatInt,
  formatPercent,
  formatRelativeTime,
  formatSignedPercent,
} from '@/utils/format';

describe('formatInt（千分位）', () => {
  it('整数加千分位', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
  });

  it('小数四舍五入后加千分位', () => {
    expect(formatInt(1234.6)).toBe('1,235');
  });

  it('null / undefined / NaN 返回占位符', () => {
    expect(formatInt(null)).toBe(PLACEHOLDER);
    expect(formatInt(undefined)).toBe(PLACEHOLDER);
    expect(formatInt(Number.NaN)).toBe(PLACEHOLDER);
  });
});

describe('formatCompact（大数缩写）', () => {
  it('小于 1000 原样输出', () => {
    expect(formatCompact(999)).toBe('999');
  });

  it('千位用 K', () => {
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(486000)).toBe('486K');
  });

  it('百万位用 M（PRD 示例 2.1M）', () => {
    expect(formatCompact(2100000)).toBe('2.1M');
    expect(formatCompact(602000)).toBe('602K');
  });

  it('十亿位用 B', () => {
    expect(formatCompact(2500000000)).toBe('2.5B');
  });

  it('负数保留符号', () => {
    expect(formatCompact(-2100000)).toBe('-2.1M');
  });

  it('不可用值返回占位符', () => {
    expect(formatCompact(null)).toBe(PLACEHOLDER);
  });
});

describe('formatDuration（HH:mm:ss）', () => {
  it('PRD 示例：4364000ms -> 01:12:44', () => {
    expect(formatDuration(4364000)).toBe('01:12:44');
  });

  it('零与负值', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(-100)).toBe('00:00:00');
    expect(formatDuration(null)).toBe('00:00:00');
  });

  it('不足一小时', () => {
    expect(formatDuration(2537000)).toBe('00:42:17');
  });

  it('超过 24 小时不截断', () => {
    expect(formatDuration(100 * 3600 * 1000 + 1000)).toBe('100:00:01');
  });
});

describe('formatPercent（百分比）', () => {
  it('比例转百分比', () => {
    expect(formatPercent(0.624)).toBe('62.40%');
  });

  it('已是百分数时不乘 100', () => {
    expect(formatPercent(62.4, 2, false)).toBe('62.40%');
  });

  it('不可用值返回占位符', () => {
    expect(formatPercent(null)).toBe(PLACEHOLDER);
  });
});

describe('formatSignedPercent（带符号百分比）', () => {
  it('正数带 +', () => {
    expect(formatSignedPercent(0.012)).toBe('+1.20%');
  });

  it('负数带 -', () => {
    expect(formatSignedPercent(-0.012)).toBe('-1.20%');
  });
});

describe('formatDateTime', () => {
  it('格式化为 YYYY-MM-DD HH:mm', () => {
    // 使用本地时间构造，避免时区影响
    const ts = new Date(2025, 0, 20, 21, 30).getTime();
    expect(formatDateTime(ts)).toBe('2025-01-20 21:30');
  });

  it('null 返回占位符', () => {
    expect(formatDateTime(null)).toBe(PLACEHOLDER);
  });
});

describe('formatRelativeTime', () => {
  it('刚刚', () => {
    expect(formatRelativeTime(1000, 1000)).toBe('刚刚');
  });

  it('秒级', () => {
    expect(formatRelativeTime(0, 12000)).toBe('12s 前');
  });

  it('分钟级', () => {
    expect(formatRelativeTime(0, 5 * 60 * 1000)).toBe('5min 前');
  });
});
