import { test, expect } from '@playwright/test';
import { createMinimalBinarySequence, demoSequenceText, minimalSequenceText } from './fixtures/sequences.js';

const pageErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'unexpected uncaught browser errors').toEqual([]);
});

async function clickControl(page, selector) {
  const control = page.locator(selector);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  // This app intentionally keeps a large canvas below the toolbar. In the
  // headless runner, Chromium can defer its stability RAF while the page is
  // backgrounded; visibility/enabled checks above still guard the action.
  await control.click({ force: true });
}

async function loadSequenceFile(page, name = 'demo.seq', content = demoSequenceText) {
  await page.locator('#fileInput').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await expect(page.locator('#loadedFile')).toContainText(`Loaded: ${name}`);
}

async function installAudioMock(page) {
  await page.evaluate(() => {
    class FakeAudioContext {
      constructor() {
        this.destination = {};
      }

      createAnalyser() {
        return {
          fftSize: 256,
          smoothingTimeConstant: 0.7,
          frequencyBinCount: 128,
          connect() {},
          getByteFrequencyData(data) { data.fill(0); },
        };
      }

      createBuffer(_channels, length) {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      }

      createBufferSource() {
        return {
          buffer: null,
          onended: null,
          connect() {},
          start() {},
          stop() {},
        };
      }
    }

    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });
}

test.describe('Page load', () => {
  test('renders the initial state', async ({ page }) => {
    await expect(page.locator('header h1')).toHaveText('Listen to your Pulseq');
    await expect(page.locator('#dropZone')).toBeVisible();
    await expect(page.locator('#dropZone')).toHaveAttribute('role', 'button');
    await expect(page.locator('#dropZone')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#status')).toContainText('Ready');
    await expect(page.locator('#btnPlay')).toBeDisabled();
    await expect(page.locator('#btnStop')).toBeDisabled();
    await expect(page.locator('#btnExport')).toBeDisabled();
    await expect(page.locator('#playbackProgress')).toBeDisabled();
    await expect(page.locator('#progressCurrent')).toHaveText('0:00.0');
    await expect(page.locator('#progressDuration')).toHaveText('0:00.0');
    await expect(page.locator('link[rel=icon]')).toHaveAttribute('href', 'assets/logo-mark.svg');
    await expect(page.locator('#loadedFile')).toHaveText('Load a sequence to enable playback');
    await expect(page.locator('.legend')).toContainText('Combined gradient spectrum');
  });
});

test.describe('Sequence loading', () => {
  test('loads a sequence and updates controls and metadata', async ({ page }) => {
    await loadSequenceFile(page);

    await expect(page.locator('#btnStop')).toBeEnabled();
    await expect(page.locator('#btnExport')).toBeEnabled();
    await expect(page.locator('#emptyState')).toBeHidden();
    await expect(page.locator('#infoBlocks')).toHaveText('6');
    await expect(page.locator('#infoDuration')).toHaveText('700.0 ms');
    await expect(page.locator('#playbackProgress')).toBeEnabled();
    await expect(page.locator('#progressDuration')).toHaveText('0:00.7');
    await expect(page.locator('#status')).toContainText('Loaded: 6 blocks');
    await expect(page.locator('#loadedFile')).toContainText('Loaded: demo.seq');
    await expect(page.locator('#historyEntries')).toContainText('Loaded: 6 blocks');
  });

  test('opens and closes the history log', async ({ page }) => {
    await loadSequenceFile(page);
    await clickControl(page, '#historyToggle');
    await expect(page.locator('#historyLog')).toBeVisible();
    await expect(page.locator('#historyToggle')).toHaveText('Hide history log');
    await clickControl(page, '#historyToggle');
    await expect(page.locator('#historyLog')).toBeHidden();
  });
});

test.describe('Audio playback', () => {
  test('play button toggles between play and pause', async ({ page }) => {
    await installAudioMock(page);
    await loadSequenceFile(page);

    const widthBefore = await page.locator('#btnPlay').evaluate(element => element.getBoundingClientRect().width);
    await clickControl(page, '#btnPlay');
    await expect(page.locator('#btnPlay')).toContainText('Pause');
    const widthDuringPause = await page.locator('#btnPlay').evaluate(element => element.getBoundingClientRect().width);
    expect(widthDuringPause).toBe(widthBefore);

    await clickControl(page, '#btnPlay');
    await expect(page.locator('#btnPlay')).toContainText('Play');
  });

  test('loading another sequence stops the current playback', async ({ page }) => {
    await installAudioMock(page);
    await loadSequenceFile(page);
    await clickControl(page, '#btnPlay');
    await expect(page.locator('#btnPlay')).toContainText('Pause');

    // FileReader stalls during mock audio playback in headless Chromium, so
    // mock it to resolve synchronously. setInputFiles also does not re-fire
    // `change` when the input already holds a file, so set files by hand.
    await page.evaluate(({ name, content }) => {
      window.FileReader = class {
        constructor() { this.onload = null; this.onerror = null; this.result = null; }
        readAsText() { Promise.resolve().then(() => { this.result = content; if (this.onload) this.onload({ target: { result: content } }); }); }
      };
      const file = new File([content], name, { type: 'text/plain' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const input = document.querySelector('#fileInput');
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name: 'another.seq', content: minimalSequenceText });
    await expect(page.locator('#btnPlay')).toContainText('Play');
    await expect(page.locator('#status')).toContainText('Loaded: 3 blocks');
  });

  test('seeks with the progress bar and resets on stop', async ({ page }) => {
    await installAudioMock(page);
    await loadSequenceFile(page);

    await page.locator('#playbackProgress').evaluate(element => {
      element.value = '0.35';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#progressCurrent')).toHaveText('0:00.3');

    await clickControl(page, '#btnPlay');
    await expect(page.locator('#btnPlay')).toContainText('Pause');
    await clickControl(page, '#btnStop');
    await expect(page.locator('#playbackProgress')).toHaveValue('0');
    await expect(page.locator('#progressCurrent')).toHaveText('0:00.0');
  });

  test('stop button stops playback', async ({ page }) => {
    await installAudioMock(page);
    await loadSequenceFile(page);

    await clickControl(page, '#btnPlay');
    await expect(page.locator('#btnPlay')).toContainText('Pause');

    await clickControl(page, '#btnStop');
    await expect(page.locator('#btnPlay')).toContainText('Play');
  });
});

test.describe('WAV export', () => {
  test('downloads a structurally valid WAV file', async ({ page }) => {
    await loadSequenceFile(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      clickControl(page, '#btnExport'),
    ]);

    expect(download.suggestedFilename()).toBe('sequence.wav');
    const stream = await download.createReadStream();
    expect(stream).toBeTruthy();
    const buffer = await readStreamToBuffer(stream);

    expect(buffer.length).toBeGreaterThan(44);
    expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buffer.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buffer.toString('ascii', 36, 40)).toBe('data');

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    expect(view.getUint32(4, true) + 8).toBe(buffer.length);
    expect(view.getUint32(40, true) + 44).toBe(buffer.length);
    await expect(page.locator('#status')).toHaveText('WAV file exported');
  });
});

test.describe('File upload', () => {
  test('loads a valid text .seq file', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles({
      name: 'test.seq',
      mimeType: 'text/plain',
      buffer: Buffer.from(minimalSequenceText),
    });

    await expect(page.locator('#btnPlay')).toBeEnabled();
    await expect(page.locator('#status')).toContainText('Loaded: 3 blocks');
    await expect(page.locator('#infoBlocks')).toHaveText('3');
    await expect(page.locator('#infoDuration')).toHaveText('3.0 ms');
    await expect(page.locator('#emptyState')).toBeHidden();
    await expect(page.locator('#loadedFile')).toContainText('Loaded: test.seq');
  });

  test('loads a valid binary .bseq file', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles({
      name: 'TEST.BSEQ',
      mimeType: 'application/octet-stream',
      buffer: createMinimalBinarySequence(),
    });

    await expect(page.locator('#btnPlay')).toBeEnabled();
    await expect(page.locator('#status')).toContainText('Loaded: 1 blocks');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'success');
    await expect(page.locator('#infoBlocks')).toHaveText('1');
    await expect(page.locator('#infoDuration')).toHaveText('1.0 ms');
  });

  test('supports drag-and-drop text sequence uploads', async ({ page }) => {
    await page.evaluate(seqText => {
      const file = new File([seqText], 'dropped.seq', { type: 'text/plain' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      document.querySelector('#dropZone').dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }));
    }, minimalSequenceText);

    await expect(page.locator('#status')).toContainText('Loaded: 3 blocks');
    await expect(page.locator('#infoBlocks')).toHaveText('3');
  });

  test('shows an error and restores the empty state for an invalid file', async ({ page }) => {
    await loadSequenceFile(page);

    await page.locator('#fileInput').setInputFiles({
      name: 'bad.seq',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a pulseq file'),
    });

    await expect(page.locator('#status')).toContainText('Error: No Pulseq blocks found');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#btnPlay')).toBeDisabled();
    await expect(page.locator('#btnStop')).toBeDisabled();
    await expect(page.locator('#btnExport')).toBeDisabled();
    await expect(page.locator('#infoBlocks')).toHaveText('-');
    await expect(page.locator('#infoDuration')).toHaveText('-');
    await expect(page.locator('#emptyState')).toBeVisible();
  });
});

function readStreamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
