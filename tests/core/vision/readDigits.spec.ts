/**
 * `core/vision/readDigits` 单测 —— 数字模板匹配。
 *
 * 验收（架构 §7 T02-2）：
 * - 干净样本识别率 ≥ 6/7；
 * - 噪声 ±40 通过；
 * - **拒识必须返回 `null`（而不是错误数字）** —— 显式断言；
 * - 千分位、百分号处理。
 *
 * 说明：测试用**纯位图字形渲染器**（`atlasRenderer`）在 Node 下构建模板库，
 * 不依赖 Canvas/DOM —— 这正是 `glyphSource.ts` 可注入渲染器设计的回报。
 */

import { describe, expect, it } from 'vitest';
import { buildDefaultBank, parseNumber, readDigits, type TemplateBank } from '@/core/vision';
import { addNoise, renderString, shiftImage, type FixtureImage } from '../../fixtures/bitmapFactory';
import { createAtlasGlyphRenderer } from '../../fixtures/atlasRenderer';

/** 等宽数字区域（像素坐标，框住整张图）。 */
function rectOf(img: FixtureImage) {
  return { x: 0, y: 0, w: img.width, h: img.height };
}

/** 构建与图片同渲染管线的模板库（scale=3、描边）。 */
function bankScale3(): TemplateBank {
  return buildDefaultBank(createAtlasGlyphRenderer({ scale: 3, outline: true }), {
    scaleKey: 'atlas-s3',
  });
}

describe('readDigits —— 干净样本（识别率 ≥ 6/7）', () => {
  const cases: string[] = [
    '1234567',
    '98',
    '2048576',
    '87%',
    '1,234,567',
    '0.05%',
    '12/34',
  ];

  it('≥ 6/7 个用例完全正确', () => {
    const bank = bankScale3();
    let pass = 0;
    const detail: string[] = [];

    for (const truth of cases) {
      const img = renderString(truth, 3, true);
      const r = readDigits(img, rectOf(img), bank);
      const got = r?.text ?? '(null)';
      // 对 `12/34`（HP 样式）本函数按设计拒识（parseNumber 不含 `/`），
      // 因此只对"数值型"用例统计文本完全匹配。
      const matchable = !truth.includes('/');
      if (matchable && got === truth) {
        pass++;
      }
      detail.push(`${truth} -> ${got}`);
    }

    // 7 个用例中 6 个可文本匹配（`12/34` 设计上拒识）。
    expect(pass).toBeGreaterThanOrEqual(6);
    // eslint-disable-next-line no-console
    console.log('[readDigits clean]', detail.join(' | '));
  });

  it('单个数值用例逐项正确（回归锚点）', () => {
    const bank = bankScale3();
    for (const truth of ['1234567', '2048576', '98']) {
      const img = renderString(truth, 3, true);
      const r = readDigits(img, rectOf(img), bank);
      expect(r, `识别 ${truth} 失败`).not.toBeNull();
      expect(r?.text).toBe(truth);
      expect(r?.value).toBe(Number(truth));
    }
  });

  it('干净样本置信度高、margin 充足', () => {
    const bank = bankScale3();
    const img = renderString('1234567', 3, true);
    const r = readDigits(img, rectOf(img), bank);
    expect(r).not.toBeNull();
    expect(r?.confidence).toBeGreaterThanOrEqual(0.55);
    expect(r?.minMargin).toBeGreaterThanOrEqual(0.03);
  });
});

describe('readDigits —— 噪声鲁棒性（±40 通过）', () => {
  it('噪声 ±40 仍识别正确', () => {
    const bank = bankScale3();
    const img = addNoise(renderString('123456', 3, true), 40, 1234);
    const r = readDigits(img, rectOf(img), bank);
    expect(r).not.toBeNull();
    expect(r?.text).toBe('123456');
  });

  it('噪声 ±10 / ±25 均通过', () => {
    const bank = bankScale3();
    for (const amp of [10, 25]) {
      const img = addNoise(renderString('123456', 3, true), amp, 42);
      const r = readDigits(img, rectOf(img), bank);
      expect(r?.text, `噪声 ${amp} 失败`).toBe('123456');
    }
  });
});

describe('readDigits —— ★ 拒识必须返回 null（绝不返回猜测值）', () => {
  it('空图（全背景）→ null', () => {
    const bank = bankScale3();
    const blank: FixtureImage = {
      width: 40,
      height: 40,
      data: new Uint8ClampedArray(40 * 40 * 4).fill(0),
    };
    expect(readDigits(blank, rectOf(blank), bank)).toBeNull();
  });

  it('空模板库 → null', () => {
    const bank = buildDefaultBank(() => null, { scaleKey: 'empty' });
    const img = renderString('123', 3, true);
    expect(readDigits(img, rectOf(img), bank)).toBeNull();
  });

  it('严重噪声（±80）→ 拒识 null（安全失败，不给错误数字）', () => {
    const bank = bankScale3();
    const img = addNoise(renderString('123456', 3, true), 80, 999);
    const r = readDigits(img, rectOf(img), bank);
    // 要么正确识别，要么拒识；**绝不允许返回一个不同数字**。
    if (r !== null) {
      expect(r.text).toBe('123456');
    }
    expect(r === null || r.text === '123456').toBe(true);
  });

  it('非数字图形（全黑方块）→ null（不猜成任何数字）', () => {
    const bank = bankScale3();
    const w = 30;
    const h = 30;
    const data = new Uint8ClampedArray(w * h * 4).fill(0);
    for (let i = 0; i < w * h; i++) {
      const j = i << 2;
      data[j] = 255;
      data[j + 1] = 255;
      data[j + 2] = 255;
      data[j + 3] = 255;
    }
    const solid: FixtureImage = { width: w, height: h, data };
    expect(readDigits(solid, rectOf(solid), bank)).toBeNull();
  });

  it('空区域（w/h = 0）→ null', () => {
    const bank = bankScale3();
    const img = renderString('123', 3, true);
    expect(readDigits(img, { x: 0, y: 0, w: 0, h: 0 }, bank)).toBeNull();
  });
});

describe('readDigits —— 千分位与百分号', () => {
  it('千分位 "1,234,567" → value 1234567、text 保留逗号', () => {
    const bank = bankScale3();
    const img = renderString('1,234,567', 3, true);
    const r = readDigits(img, rectOf(img), bank);
    expect(r).not.toBeNull();
    expect(r?.text).toBe('1,234,567');
    expect(r?.value).toBe(1234567);
  });

  it('百分号 "87%" → value 87、text 保留 %', () => {
    const bank = bankScale3();
    const img = renderString('87%', 3, true);
    const r = readDigits(img, rectOf(img), bank);
    expect(r).not.toBeNull();
    expect(r?.text).toBe('87%');
    expect(r?.value).toBe(87);
  });
});

describe('readDigits —— 平移鲁棒性（先分割再归一化的回报）', () => {
  it('水平平移 −3~+3px 仍识别正确', () => {
    const bank = bankScale3();
    const base = renderString('3456789', 3, true);
    for (let s = -3; s <= 3; s++) {
      const img = shiftImage(base, s);
      const r = readDigits(img, rectOf(img), bank);
      expect(r?.text, `shift=${s} 失败`).toBe('3456789');
    }
  });
});

describe('parseNumber', () => {
  it('处理千分位', () => {
    expect(parseNumber('1,234,567')).toBe(1234567);
  });

  it('处理百分号', () => {
    expect(parseNumber('87%')).toBe(87);
    expect(parseNumber('0.05%')).toBe(0.05);
  });

  it('含拒识别符 `?` → null', () => {
    expect(parseNumber('0?05%')).toBeNull();
  });

  it('HP 样式含 `/` → null（需调用方单独处理）', () => {
    expect(parseNumber('12/34')).toBeNull();
  });

  it('空串 / 非法字符 → null', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});
