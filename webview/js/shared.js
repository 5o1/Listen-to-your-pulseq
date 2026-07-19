// Shared types and utilities for Pulseq parsers — ported from seqeyes_plugin (MIT)

export function createEmptySequence() {
  return {
    version: { major: 1, minor: 0, revision: 0 },
    versionCombined: 0,
    definitions: new Map(),
    blocks: [],
    rfs: new Map(),
    arbitraryGrads: new Map(),
    trapGrads: new Map(),
    adcs: new Map(),
    shapes: new Map(),
    rasterTimes: { blockDurationRaster: 1e-5, gradientRaster: 1e-5, rfRaster: 1e-6, adcRaster: 1e-7 },
  };
}

export function makeVersionCombined(major, minor, revision) {
  return major * 1_000_000 + minor * 1_000 + revision;
}

export const VER_PRE_14 = 1_004_000;
export const VER_V15 = 1_005_000;

export function extractRasterTimes(seq) {
  const set = (key, field) => { const v = seq.definitions.get(key); if (v?.length) seq.rasterTimes[field] = v[0]; };
  set('BlockDurationRaster', 'blockDurationRaster');
  set('GradientRasterTime', 'gradientRaster');
  set('RadiofrequencyRasterTime', 'rfRaster');
  set('AdcRasterTime', 'adcRaster');
}

export function splitFields(line) { return line.trim().split(/\s+/); }
export function toNum(v) { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Non-numeric field: ${v}`); return n; }
export function toInt(v) { const n = toNum(v); if (!Number.isInteger(n)) throw new Error(`Non-integer field: ${v}`); return n; }

export function forEachLine(text, visit) {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const contentEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    visit(text.slice(start, contentEnd));
    if (end === text.length) break;
    start = end + 1;
  }
}
