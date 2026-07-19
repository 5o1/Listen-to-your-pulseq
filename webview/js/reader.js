// Text .seq Reader — ported from seqeyes_plugin reader.ts (MIT)
import { decompressShape } from './decompressor.js';
import {
  createEmptySequence, makeVersionCombined, VER_PRE_14, VER_V15,
  extractRasterTimes, splitFields, toNum, toInt, forEachLine,
} from './shared.js';

export function parseSequenceText(text) {
  const seq = createEmptySequence();
  const shapeParser = new ShapeSectionParser(seq);
  let sectionName = null, sectionLines = [];

  forEachLine(text, line => {
    const m = line.match(/^\[(\w+)\]$/);
    if (m) {
      if (sectionName === 'SHAPES') shapeParser.finish();
      else if (sectionName) dispatchSection(seq, sectionName, sectionLines);
      sectionName = m[1]; sectionLines = [];
    } else if (sectionName === 'SHAPES') {
      shapeParser.consume(line);
    } else {
      sectionLines.push(line);
    }
  });
  if (sectionName === 'SHAPES') shapeParser.finish();
  else if (sectionName) dispatchSection(seq, sectionName, sectionLines);

  seq.versionCombined = makeVersionCombined(seq.version.major, seq.version.minor, seq.version.revision);
  extractRasterTimes(seq);
  return seq;
}

function ver(seq) { return seq.versionCombined > 0 ? seq.versionCombined : makeVersionCombined(seq.version.major, seq.version.minor, seq.version.revision); }

function dispatchSection(seq, name, lines) {
  if (name === 'SHAPES') { parseShapes(seq, lines); return; }
  const valid = lines.filter(l => { const t = l.trim(); return t && !t.startsWith('#'); });
  switch (name) {
    case 'VERSION': parseVersion(seq, valid); break;
    case 'DEFINITIONS': parseDefinitions(seq, valid); break;
    case 'BLOCKS': parseBlocks(seq, valid); break;
    case 'RF': parseRF(seq, valid); break;
    case 'GRADIENTS': parseArbitraryGrads(seq, valid); break;
    case 'TRAP': parseTrapGrads(seq, valid); break;
    case 'ADC': parseADC(seq, valid); break;
  }
}

function parseVersion(seq, lines) {
  for (const line of lines) {
    const [k, v] = splitFields(line);
    const n = toInt(v);
    if (k === 'major') seq.version.major = n;
    else if (k === 'minor') seq.version.minor = n;
    else if (k === 'revision') seq.version.revision = n;
  }
  seq.versionCombined = makeVersionCombined(seq.version.major, seq.version.minor, seq.version.revision);
}

function parseDefinitions(seq, lines) {
  for (const line of lines) {
    const idx = line.search(/\s/);
    if (idx < 0) { seq.definitions.set(line.trim(), []); continue; }
    const key = line.substring(0, idx);
    const vals = line.substring(idx + 1).trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
    seq.definitions.set(key, vals);
  }
}

function parseBlocks(seq, lines) {
  for (const line of lines) {
    const p = splitFields(line);
    const num = toInt(p[0]), extId = p.length === 8 ? toInt(p[7]) : 0;
    seq.blocks.push({ num, dur: toNum(p[1]), rfId: toInt(p[2]), gxId: toInt(p[3]), gyId: toInt(p[4]), gzId: toInt(p[5]), adcId: toInt(p[6]), extId });
  }
}

function parseRF(seq, lines) {
  const vc = ver(seq);
  for (const line of lines) {
    const parts = splitFields(line);
    const id = toInt(parts[0]), amp = toNum(parts[1]), magId = toInt(parts[2]), phId = toInt(parts[3]);
    if (vc >= VER_V15) {
      seq.rfs.set(id, { id, amplitude: amp, magShapeId: magId, phaseShapeId: phId, timeShapeId: toInt(parts[4]), center: toNum(parts[5]), delay: toNum(parts[6]), freqPPM: toNum(parts[7]), phasePPM: toNum(parts[8]), freqOffset: toNum(parts[9]), phaseOffset: toNum(parts[10]), use: parts[11].toLowerCase() });
    } else if (vc >= VER_PRE_14) {
      seq.rfs.set(id, { id, amplitude: amp, magShapeId: magId, phaseShapeId: phId, timeShapeId: toInt(parts[4]), center: -1, delay: toNum(parts[5]), freqPPM: 0, phasePPM: 0, freqOffset: toNum(parts[6]), phaseOffset: toNum(parts[7]), use: 'u' });
    } else {
      seq.rfs.set(id, { id, amplitude: amp, magShapeId: magId, phaseShapeId: phId, timeShapeId: 0, center: -1, delay: toNum(parts[4]), freqPPM: 0, phasePPM: 0, freqOffset: toNum(parts[5]), phaseOffset: toNum(parts[6]), use: 'u' });
    }
  }
}

function parseArbitraryGrads(seq, lines) {
  const vc = ver(seq);
  for (const line of lines) {
    const p = splitFields(line), id = toInt(p[0]);
    if (vc >= VER_V15) seq.arbitraryGrads.set(id, { id, amplitude: toNum(p[1]), first: toNum(p[2]), last: toNum(p[3]), shapeId: toInt(p[4]), timeId: toInt(p[5]), delay: toNum(p[6]) });
    else if (vc >= VER_PRE_14) seq.arbitraryGrads.set(id, { id, amplitude: toNum(p[1]), first: NaN, last: NaN, shapeId: toInt(p[2]), timeId: toInt(p[3]), delay: toNum(p[4]) });
    else seq.arbitraryGrads.set(id, { id, amplitude: toNum(p[1]), first: NaN, last: NaN, shapeId: toInt(p[2]), timeId: 0, delay: toNum(p[3]) });
  }
}

function parseTrapGrads(seq, lines) {
  for (const line of lines) {
    const p = splitFields(line), id = toInt(p[0]);
    seq.trapGrads.set(id, { id, amplitude: toNum(p[1]), rise: toNum(p[2]), flat: toNum(p[3]), fall: toNum(p[4]), delay: toNum(p[5]) });
  }
}

function parseADC(seq, lines) {
  const vc = ver(seq);
  for (const line of lines) {
    const p = splitFields(line), id = toInt(p[0]);
    if (vc >= VER_V15) seq.adcs.set(id, { id, numSamples: toInt(p[1]), dwell: toNum(p[2]), delay: toNum(p[3]), freqPPM: toNum(p[4]), phasePPM: toNum(p[5]), freqOffset: toNum(p[6]), phaseOffset: toNum(p[7]), phaseModShapeId: toInt(p[8]) });
    else seq.adcs.set(id, { id, numSamples: toInt(p[1]), dwell: toNum(p[2]), delay: toNum(p[3]), freqPPM: 0, phasePPM: 0, freqOffset: toNum(p[4]), phaseOffset: toNum(p[5]), phaseModShapeId: 0 });
  }
}

function parseShapes(seq, lines) {
  const parser = new ShapeSectionParser(seq);
  for (const line of lines) parser.consume(line);
  parser.finish();
}

class ShapeSectionParser {
  constructor(seq) { this.seq = seq; this.shapeId = 0; this.numSamples = 0; this.raw = new Float64Array(); this.rawCount = 0; }
  consume(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const sm = /^shape_id\s+(\d+)/.exec(trimmed);
    if (sm) { this.storeCurrent(); this.shapeId = Number(sm[1]); return; }
    const cm = /^num_samples\s+(\d+)/.exec(trimmed);
    if (cm) { this.numSamples = Number(cm[1]); this.raw = new Float64Array(Math.min(this.numSamples, 1024)); this.rawCount = 0; return; }
    if (this.shapeId <= 0 || this.numSamples <= 0 || this.rawCount >= this.numSamples) return;
    if (!/\s/.test(trimmed)) { this.appendRaw(trimmed); return; }
    for (const f of trimmed.split(/\s+/)) { this.appendRaw(f); if (this.rawCount >= this.numSamples) break; }
  }
  finish() { this.storeCurrent(); }
  ensureRaw() { if (this.rawCount < this.raw.length) return; const n = Math.min(this.numSamples, Math.max(1, this.raw.length * 2)); const e = new Float64Array(n); e.set(this.raw); this.raw = e; }
  appendRaw(field) { const v = Number(field); if (!Number.isFinite(v)) return; this.ensureRaw(); this.raw[this.rawCount++] = v; }
  storeCurrent() {
    if (this.shapeId > 0 && this.numSamples > 0 && this.rawCount > 0) {
      const samples = this.rawCount === this.numSamples ? this.raw : decompressShape(this.raw.subarray(0, this.rawCount), this.numSamples);
      this.seq.shapes.set(this.shapeId, { numSamples: this.numSamples, samples });
    }
    this.shapeId = 0; this.numSamples = 0; this.raw = new Float64Array(); this.rawCount = 0;
  }
}
