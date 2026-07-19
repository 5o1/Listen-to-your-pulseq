import { test, expect } from '@playwright/test';
import { minimalSequenceText } from './fixtures/sequences.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('Browser parser smoke tests', () => {
  test('parses text blocks and trapezoid gradients', async ({ page }) => {
    const result = await page.evaluate(async seqText => {
      const { parseSequenceText } = await import('/js/reader.js');
      const sequence = parseSequenceText(seqText);
      return {
        blocks: sequence.blocks.length,
        traps: sequence.trapGrads.size,
        amplitude: sequence.trapGrads.get(1).amplitude,
        blockRaster: sequence.rasterTimes.blockDurationRaster,
      };
    }, minimalSequenceText);

    expect(result).toEqual({
      blocks: 3,
      traps: 3,
      amplitude: 10000,
      blockRaster: 1e-5,
    });
  });

  test('passes uncompressed shape data through unchanged', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { decompressShape } = await import('/js/decompressor.js');
      const original = new Float64Array([0.1, 0.2, 0.3, 0.4]);
      return Array.from(decompressShape(original, original.length));
    });

    expect(result).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});
