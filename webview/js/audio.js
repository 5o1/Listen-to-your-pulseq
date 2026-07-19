// Audio playback engine, progress control, and WAV export

let audioCtx = null;
let audioSource = null;
let analyserNode = null;
let audioBuffer = null;
let cachedBlocks = null;
let cachedRate = 0;
let playbackOffset = 0;
let playbackStartedAt = 0;
let playbackDuration = 0;
let sourceToken = 0;

function contextTime() {
  if (audioCtx && Number.isFinite(audioCtx.currentTime)) return audioCtx.currentTime;
  return performance.now() / 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.7;
    analyserNode.connect(audioCtx.destination);
  }
  return { ctx: audioCtx, analyser: analyserNode };
}

function stopSource(preserveOffset) {
  const source = audioSource;
  audioSource = null;
  sourceToken += 1;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch (error) { /* already stopped */ }
  }
  if (!preserveOffset) playbackOffset = 0;
}

export function stopPlayback() {
  stopSource(false);
}

export function pausePlayback() {
  if (!audioSource) return;
  playbackOffset = getPlaybackPosition();
  stopSource(true);
}

export function isPlaying() { return audioSource !== null; }

export function getPlaybackDuration() { return playbackDuration; }

export function getPlaybackPosition() {
  if (!audioSource) return clamp(playbackOffset, 0, playbackDuration || Number.POSITIVE_INFINITY);
  const elapsed = Math.max(0, contextTime() - playbackStartedAt);
  return clamp(playbackOffset + elapsed, 0, playbackDuration);
}

function startBuffer(offset) {
  const { ctx, analyser } = getAudioContext();
  if (!audioBuffer) return;

  const duration = playbackDuration;
  const startOffset = duration > 0 ? clamp(offset, 0, duration) : 0;
  if (startOffset >= duration - 1e-6 && duration > 0) playbackOffset = 0;
  else playbackOffset = startOffset;

  stopSource(true);
  const source = ctx.createBufferSource();
  const token = sourceToken;
  source.buffer = audioBuffer;
  source.connect(analyser);
  playbackStartedAt = contextTime();
  audioSource = source;
  source.onended = () => {
    if (token !== sourceToken || audioSource !== source) return;
    audioSource = null;
    playbackOffset = playbackDuration;
  };
  source.start(0, playbackOffset);
}

function prepareBuffer(decodedBlocks, rate) {
  if (audioBuffer && cachedBlocks === decodedBlocks && cachedRate === rate) return;

  const { ctx } = getAudioContext();
  const waveform = buildWaveform(decodedBlocks, rate);
  const nSamples = waveform.length;
  const buffer = ctx.createBuffer(1, nSamples, rate);
  const data = buffer.getChannelData(0);
  let maxAbs = 0;
  for (let i = 0; i < nSamples; i++) maxAbs = Math.max(maxAbs, Math.abs(waveform[i]));
  const scale = maxAbs > 0 ? 0.9 / maxAbs : 1;
  for (let i = 0; i < nSamples; i++) data[i] = waveform[i] * scale;

  audioBuffer = buffer;
  cachedBlocks = decodedBlocks;
  cachedRate = rate;
  playbackDuration = Number.isFinite(buffer.duration) ? buffer.duration : nSamples / rate;
  playbackOffset = clamp(playbackOffset, 0, playbackDuration);
}

export function playBlocks(decodedBlocks, rate = 44100) {
  prepareBuffer(decodedBlocks, rate);
  startBuffer(playbackOffset);
}

export function seekPlayback(seconds) {
  const value = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const max = playbackDuration > 0 ? playbackDuration : Number.POSITIVE_INFINITY;
  playbackOffset = clamp(value, 0, max);
  if (audioSource) startBuffer(playbackOffset);
  return playbackOffset;
}

export function createGradientSampler(blocks, channel) {
  const events = [];
  for (const block of blocks) {
    const grad = block[channel];
    if (!grad || grad.type === 'none' || !grad.timePoints.length) continue;
    const n = Math.min(grad.timePoints.length, grad.waveform.length);
    if (n < 1) continue;
    events.push({ grad, first: grad.timePoints[0], last: grad.timePoints[n - 1] });
  }
  events.sort((a, b) => a.first - b.first);
  let eventIdx = 0, pointIdx = 0;
  return (t) => {
    while (eventIdx < events.length && events[eventIdx].last < t - 1e-15) { eventIdx++; pointIdx = 0; }
    if (eventIdx >= events.length) return 0;
    const ev = events[eventIdx];
    if (t < ev.first - 1e-15 || t > ev.last + 1e-15) return 0;
    const times = ev.grad.timePoints, values = ev.grad.waveform;
    const n = Math.min(times.length, values.length);
    while (pointIdx + 1 < n && times[pointIdx + 1] <= t + 1e-15) pointIdx++;
    if (pointIdx >= n - 1 || t <= times[pointIdx] + 1e-15) return values[pointIdx];
    const frac = (t - times[pointIdx]) / (times[pointIdx + 1] - times[pointIdx]);
    return values[pointIdx] + frac * (values[pointIdx + 1] - values[pointIdx]);
  };
}

function buildWaveform(decodedBlocks, rate) {
  const tMax = decodedBlocks.length > 0
    ? decodedBlocks[decodedBlocks.length - 1].startTime + decodedBlocks[decodedBlocks.length - 1].duration : 1;
  const nSamples = Math.floor(tMax * rate) + 1;
  const waveform = new Float64Array(nSamples);
  for (const ch of ['gx', 'gy', 'gz']) {
    const sampler = createGradientSampler(decodedBlocks, ch);
    for (let i = 0; i < nSamples; i++) waveform[i] += sampler(i / rate);
  }
  return waveform;
}

export function exportWav(decodedBlocks, rate = 44100) {
  const waveform = buildWaveform(decodedBlocks, rate);
  const nSamples = waveform.length;

  let maxAbs = 0;
  for (let i = 0; i < nSamples; i++) maxAbs = Math.max(maxAbs, Math.abs(waveform[i]));
  const ampScale = maxAbs > 0 ? 32767 / maxAbs : 1;

  const dataSize = nSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  for (let i = 0; i < nSamples; i++) {
    const s = Math.max(-32768, Math.min(32767, Math.round(waveform[i] * ampScale)));
    v.setInt16(44 + i * 2, s, true);
  }
  return buf;
}
