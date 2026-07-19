import { test, expect } from '@playwright/test';
import { createMinimalBinarySequence } from './fixtures/sequences.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('Binary parser', () => {
  test('parses a minimal valid binary sequence', async ({ page }) => {
    const binary = createMinimalBinarySequence();
    const result = await page.evaluate(async bytes => {
      const { parseSequenceBinary } = await import('/js/binaryReader.js');
      const sequence = parseSequenceBinary(Uint8Array.from(bytes));
      return {
        version: sequence.version,
        blocks: sequence.blocks.length,
        duration: sequence.blocks[0].dur,
      };
    }, [...binary]);

    expect(result).toEqual({
      version: { major: 1, minor: 5, revision: 1 },
      blocks: 1,
      duration: 100,
    });
  });

  test('rejects invalid magic and truncated files', async ({ page }) => {
    const errors = await page.evaluate(async () => {
      const { parseSequenceBinary } = await import('/js/binaryReader.js');
      const messages = [];
      for (const bytes of [new Uint8Array(8), new Uint8Array([1, 0x70, 0x75])]) {
        try {
          parseSequenceBinary(bytes);
        } catch (error) {
          messages.push(error.message);
        }
      }
      return messages;
    });

    expect(errors).toEqual([
      'Not a valid Pulseq binary file',
      'Unexpected EOF at byte 0',
    ]);
  });
});

test.describe('Shape decompression', () => {
  test('decodes run-length encoded derivative data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { decompressShape } = await import('/js/decompressor.js');
      return Array.from(decompressShape(new Float64Array([1, 1, 2]), 4));
    });

    expect(result).toEqual([1, 2, 3, 4]);
  });

  test('rejects malformed compressed data', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const { decompressShape } = await import('/js/decompressor.js');
      try {
        decompressShape(new Float64Array([1, 1]), 3);
      } catch (error) {
        return error.message;
      }
      return null;
    });

    expect(message).toBe('Malformed compressed shape: repeat marker missing count');
  });
});

test.describe('Gradient decoding and WAV generation', () => {
  test('decodes trapezoids on the expected timeline', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { decodeAllBlocks } = await import('/js/decoder.js');
      const sequence = {
        blocks: [{ num: 1, dur: 100, gxId: 1, gyId: 0, gzId: 0 }],
        trapGrads: new Map([[1, { id: 1, amplitude: 10, rise: 100, flat: 500, fall: 100, delay: 0 }]]),
        arbitraryGrads: new Map(),
        shapes: new Map(),
        rasterTimes: { blockDurationRaster: 1e-5, gradientRaster: 1e-5 },
      };
      const [block] = decodeAllBlocks(sequence);
      return {
        duration: block.duration,
        type: block.gx.type,
        times: Array.from(block.gx.timePoints),
        waveform: Array.from(block.gx.waveform),
      };
    });

    expect(result.duration).toBeCloseTo(0.001);
    expect(result.type).toBe('trap');
    expect(result.times).toHaveLength(4);
    expect(result.times[0]).toBe(0);
    expect(result.times[1]).toBeCloseTo(0.0001);
    expect(result.times[2]).toBeCloseTo(0.0006);
    expect(result.times[3]).toBeCloseTo(0.0007);
    expect(result.waveform).toEqual([0, 10, 10, 0]);
  });

  test('interpolates gradients and emits a valid PCM WAV header', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createGradientSampler, exportWav } = await import('/js/audio.js');
      const gradient = {
        type: 'trap',
        timePoints: new Float64Array([0, 0.5, 1]),
        waveform: new Float64Array([0, 1, 0]),
      };
      const blocks = [{ startTime: 0, duration: 1, gx: gradient, gy: null, gz: null }];
      const sampler = createGradientSampler(blocks, 'gx');
      const wav = exportWav(blocks, 10);
      const view = new DataView(wav);
      return {
        samples: [sampler(0), sampler(0.25), sampler(0.5), sampler(0.75), sampler(1)],
        riff: String.fromCharCode(...new Uint8Array(wav, 0, 4)),
        wave: String.fromCharCode(...new Uint8Array(wav, 8, 4)),
        sampleRate: view.getUint32(24, true),
        dataSize: view.getUint32(40, true),
        byteLength: wav.byteLength,
      };
    });

    expect(result.samples).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(result.riff).toBe('RIFF');
    expect(result.wave).toBe('WAVE');
    expect(result.sampleRate).toBe(10);
    expect(result.dataSize + 44).toBe(result.byteLength);
  });
});
