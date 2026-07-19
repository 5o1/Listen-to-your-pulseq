// Gradient Waveform Decoder — ported from seqeyes_plugin decoder.ts (MIT)

export function decodeAllBlocks(seq) {
  const blocks = [];
  let t0 = 0;
  for (const block of seq.blocks) {
    const dur = block.dur * seq.rasterTimes.blockDurationRaster;
    blocks.push({
      blockIndex: block.num, startTime: t0, duration: dur,
      gx: decodeGradient(seq, block.gxId, t0, dur, 'gx'),
      gy: decodeGradient(seq, block.gyId, t0, dur, 'gy'),
      gz: decodeGradient(seq, block.gzId, t0, dur, 'gz'),
    });
    t0 += dur;
  }
  return blocks;
}

function decodeGradient(seq, gradId, blockStart, blockDur, channel) {
  if (gradId <= 0) return zeroGradient(blockStart, blockDur, channel);
  const trap = seq.trapGrads.get(gradId);
  if (trap) return decodeTrap(trap, blockStart, channel);
  const arb = seq.arbitraryGrads.get(gradId);
  if (arb) return decodeArb(seq, arb, blockStart, channel);
  return zeroGradient(blockStart, blockDur, channel);
}

function zeroGradient(t0, dur, ch) {
  return { startTime: t0, duration: dur, timePoints: new Float64Array([t0, t0 + dur]), waveform: new Float64Array([0, 0]), amplitude: 0, type: 'none', channel: ch };
}

function decodeTrap(trap, blockStart, ch) {
  const rise = trap.rise * 1e-6, flat = trap.flat * 1e-6, fall = trap.fall * 1e-6, delay = trap.delay * 1e-6;
  const gradStart = blockStart + delay;
  const tRel = [0, rise, rise + flat, rise + flat + fall];
  const wfRel = [0, trap.amplitude, trap.amplitude, 0];
  if (delay > 0) {
    const tp = new Float64Array(5), wf = new Float64Array(5);
    tp[0] = blockStart; wf[0] = 0;
    for (let i = 0; i < 4; i++) { tp[i + 1] = gradStart + tRel[i]; wf[i + 1] = wfRel[i]; }
    return { startTime: blockStart, duration: delay + rise + flat + fall, timePoints: tp, waveform: wf, amplitude: trap.amplitude, type: 'trap', channel: ch };
  }
  const tp = new Float64Array(4), wf = new Float64Array(4);
  for (let i = 0; i < 4; i++) { tp[i] = gradStart + tRel[i]; wf[i] = wfRel[i]; }
  return { startTime: blockStart, duration: rise + flat + fall, timePoints: tp, waveform: wf, amplitude: trap.amplitude, type: 'trap', channel: ch };
}

function decodeArb(seq, arb, blockStart, ch) {
  const shape = seq.shapes.get(arb.shapeId);
  if (!shape) return zeroGradient(blockStart, 0, ch);
  const raster = seq.rasterTimes.gradientRaster;
  const delay = arb.delay * 1e-6, gradStart = blockStart + delay;
  const n = shape.numSamples;
  const oversampled = arb.timeId === -1;
  const timeShape = arb.timeId > 0 ? seq.shapes.get(arb.timeId)?.samples ?? null : null;
  if (timeShape) {
    const tp = new Float64Array(n), wf = new Float64Array(n);
    for (let i = 0; i < n; i++) { tp[i] = gradStart + timeShape[i] * raster; wf[i] = arb.amplitude * shape.samples[i]; }
    const dur = n > 0 ? tp[n - 1] - blockStart + raster : delay;
    return { startTime: blockStart, duration: dur, timePoints: tp, waveform: wf, amplitude: arb.amplitude, type: 'arb', channel: ch };
  }
  const tp = new Float64Array(n + 2), wf = new Float64Array(n + 2);
  tp[0] = gradStart;
  wf[0] = edgeAmp(arb.first, arb.amplitude, shape.samples, true);
  if (oversampled) {
    const dt = raster * 0.5;
    for (let i = 0; i < n; i++) { tp[i + 1] = gradStart + (i + 1) * dt; wf[i + 1] = arb.amplitude * shape.samples[i]; }
    tp[n + 1] = gradStart + (n + 1) * dt;
  } else {
    for (let i = 0; i < n; i++) { tp[i + 1] = gradStart + (i + 0.5) * raster; wf[i + 1] = arb.amplitude * shape.samples[i]; }
    tp[n + 1] = gradStart + n * raster;
  }
  wf[wf.length - 1] = edgeAmp(arb.last, arb.amplitude, shape.samples, false);
  const dur = tp[tp.length - 1] - blockStart;
  return { startTime: blockStart, duration: dur, timePoints: tp, waveform: wf, amplitude: arb.amplitude, type: 'arb', channel: ch };
}

function edgeAmp(stored, amplitude, samples, first) {
  let value;
  if (Number.isFinite(stored)) { value = stored; if (Math.abs(value) > 1 + 1e-6 && Math.abs(amplitude) > 0) value /= amplitude; }
  else if (samples.length === 0) value = 0;
  else if (samples.length === 1) value = samples[0];
  else if (first) value = 0.5 * (3 * samples[0] - samples[1]);
  else value = 0.5 * (3 * samples[samples.length - 1] - samples[samples.length - 2]);
  return value * amplitude;
}
