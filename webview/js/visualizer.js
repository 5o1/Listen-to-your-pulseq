// Audio-reactive bar spectrum visualizer

let timerId = null;

export function startVisualizer(canvas, getAnalyser, getPlaying) {
  if (timerId) return;
  let ctx = null;
  let lastDpr = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  function drawFrame() {
    if (!ctx) ctx = canvas.getContext('2d');

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const pixelWidth = Math.max(1, Math.floor(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.floor(rect.height * dpr));
    if (pixelWidth !== canvas.width || pixelHeight !== canvas.height || dpr !== lastDpr) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastDpr = dpr;
      lastWidth = rect.width;
      lastHeight = rect.height;
    } else if (rect.width !== lastWidth || rect.height !== lastHeight) {
      lastWidth = rect.width;
      lastHeight = rect.height;
    }

    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const analyser = getAnalyser();
    const playing = getPlaying();

    if (!analyser || !playing) {
      // Idle: subtle static bars
      const barCount = 64;
      const barW = (W / barCount) * 0.6;
      const gap = (W / barCount) * 0.4;
      const h = H * 0.02;
      ctx.fillStyle = '#30363d';
      for (let i = 0; i < barCount; i++) {
        ctx.fillRect(i * (barW + gap), H / 2 - h / 2, barW, h);
      }
      return;
    }

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    const barCount = Math.min(64, freqData.length);
    const barW = (W / barCount) * 0.7;
    const gap = (W / barCount) * 0.3;

    for (let i = 0; i < barCount; i++) {
      const value = freqData[i] / 255;
      const h = Math.max(2, value * H * 0.9);
      const x = i * (barW + gap);
      const y = H / 2 - h / 2;

      // Frequency-bin color only: this analyser receives the combined Gx/Gy/Gz audio.
      const t = barCount > 1 ? i / (barCount - 1) : 0;
      const r = 114 + (240 - 114) * t;
      const g = 168 + (171 - 168) * t;
      const b = 255 + (252 - 255) * t;
      ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${0.4 + value * 0.6})`;
      ctx.fillRect(x, y, barW, h);
    }
  }

  function tick() {
    timerId = null;
    if (!getPlaying()) return;
    drawFrame();
    timerId = setTimeout(tick, 33);
  }

  timerId = setTimeout(tick, 0);
}

export function stopVisualizer() {
  if (timerId) { clearTimeout(timerId); timerId = null; }
}
