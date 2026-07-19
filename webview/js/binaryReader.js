// Binary .bseq Reader — ported from seqeyes_plugin binaryReader.ts (MIT)
import { decompressShape } from './decompressor.js';
import { createEmptySequence, makeVersionCombined, extractRasterTimes } from './shared.js';

const MAGIC = new Uint8Array([0x01, 0x70, 0x75, 0x6c, 0x73, 0x65, 0x71, 0x02]);
const SECTION_PREFIX = 0xffff_ffff_0000_0000n;
const SECTION = Object.freeze({
  definitions: SECTION_PREFIX | 1n, blocks: SECTION_PREFIX | 2n, rf: SECTION_PREFIX | 3n,
  gradients: SECTION_PREFIX | 4n, trapezoids: SECTION_PREFIX | 5n, adc: SECTION_PREFIX | 6n,
  legacyDelays: SECTION_PREFIX | 7n, shapes: SECTION_PREFIX | 8n,
});

function hasPulseqBinaryMagic(bytes) {
  if (bytes.byteLength < MAGIC.byteLength) return false;
  for (let i = 0; i < MAGIC.byteLength; i++) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

export function parseSequenceBinary(bytes) {
  const reader = new BinaryReader(bytes);
  if (!hasPulseqBinaryMagic(reader.bytes(8)))
    throw new Error('Not a valid Pulseq binary file');

  const seq = createEmptySequence();
  seq.version.major = reader.safeInt64();
  seq.version.minor = reader.safeInt64();
  seq.version.revision = reader.safeInt64();
  seq.versionCombined = makeVersionCombined(seq.version.major, seq.version.minor, seq.version.revision);

  while (!reader.eof()) {
    const section = reader.uint64();
    switch (section) {
      case SECTION.definitions: readDefinitions(reader, seq); break;
      case SECTION.blocks: readBlocks(reader, seq); break;
      case SECTION.rf: readRf(reader, seq); break;
      case SECTION.gradients: readGradients(reader, seq); break;
      case SECTION.trapezoids: readTrapezoids(reader, seq); break;
      case SECTION.adc: readAdc(reader, seq); break;
      case SECTION.legacyDelays: readLegacyDelays(reader); break;
      case SECTION.shapes: readShapes(reader, seq); break;
      default: reader.skipToEnd(); break;
    }
  }
  extractRasterTimes(seq);
  return seq;
}

function psToUs(v) { return v >= 0 ? Math.floor((v + 500_000) / 1_000_000) : Math.ceil((v - 500_000) / 1_000_000); }
function psToNs(v) { return v >= 0 ? Math.floor((v + 500) / 1_000) : Math.ceil((v - 500) / 1_000); }

function readDefinitions(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    const key = reader.string(reader.length32());
    const valCount = reader.length32(), valType = reader.char();
    if (valType === 'f') { const vals = []; for (let j = 0; j < valCount; j++) vals.push(reader.float64()); seq.definitions.set(key, vals); }
    else if (valType === 'i') { const vals = []; for (let j = 0; j < valCount; j++) vals.push(reader.int32()); seq.definitions.set(key, vals); }
    else if (valType === 'c') { reader.string(valCount); seq.definitions.set(key, []); }
    else throw new Error(`Unknown definition value type '${valType}'`);
  }
}

function readBlocks(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    seq.blocks.push({ num: i + 1, dur: reader.nonNegativeSafeInt64(), rfId: reader.int32(), gxId: reader.int32(), gyId: reader.int32(), gzId: reader.int32(), adcId: reader.int32(), extId: reader.int32() });
  }
}

function readRf(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    const id = reader.int32();
    seq.rfs.set(id, { id, amplitude: reader.float64(), magShapeId: reader.int32(), phaseShapeId: reader.int32(), timeShapeId: reader.int32(), center: psToUs(reader.safeInt64()), delay: psToUs(reader.safeInt64()), freqPPM: reader.float64(), phasePPM: reader.float64(), freqOffset: reader.float64(), phaseOffset: reader.float64(), use: reader.char().toLowerCase() });
  }
}

function readGradients(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    const id = reader.int32();
    seq.arbitraryGrads.set(id, { id, amplitude: reader.float64(), first: reader.float64(), last: reader.float64(), shapeId: reader.int32(), timeId: reader.int32(), delay: psToUs(reader.safeInt64()) });
  }
}

function readTrapezoids(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    const id = reader.int32();
    seq.trapGrads.set(id, { id, amplitude: reader.float64(), rise: psToUs(reader.safeInt64()), flat: psToUs(reader.safeInt64()), fall: psToUs(reader.safeInt64()), delay: psToUs(reader.safeInt64()) });
  }
}

function readAdc(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    const id = reader.int32();
    seq.adcs.set(id, { id, numSamples: reader.nonNegativeSafeInt64(), dwell: psToNs(reader.safeInt64()), delay: psToUs(reader.safeInt64()), freqPPM: reader.float64(), phasePPM: reader.float64(), freqOffset: reader.float64(), phaseOffset: reader.float64(), phaseModShapeId: reader.int32() });
  }
}

function readLegacyDelays(reader) { const count = reader.count64(); for (let i = 0; i < count; i++) { reader.int32(); reader.safeInt64(); } }

function readShapes(reader, seq) {
  const count = reader.count64();
  for (let i = 0; i < count; i++) {
    const id = reader.int32(), numSamples = reader.positiveSafeInt64(), packedCount = reader.positiveSafeInt64();
    const packed = new Float64Array(packedCount);
    for (let j = 0; j < packedCount; j++) packed[j] = reader.float32();
    seq.shapes.set(id, { numSamples, samples: decompressShape(packed, numSamples) });
  }
}

class BinaryReader {
  constructor(src) { this.src = src; this.view = new DataView(src.buffer, src.byteOffset, src.byteLength); this.offset = 0; }
  get remaining() { return this.view.byteLength - this.offset; }
  eof() { return this.remaining === 0; }
  skipToEnd() { this.offset = this.view.byteLength; }
  require(n) { if (n < 0 || n > this.remaining) throw new Error(`Unexpected EOF at byte ${this.offset}`); }
  count64() { const c = this.nonNegativeSafeInt64(); if (c > 100_000_000) throw new Error(`count exceeds limit: ${c}`); return c; }
  length32() { const v = this.int32(); if (v < 0 || v > 16 * 1024 * 1024) throw new Error(`invalid length: ${v}`); return v; }
  positiveSafeInt64() { const v = this.safeInt64(); if (v <= 0) throw new Error(`must be positive, got ${v}`); return v; }
  nonNegativeSafeInt64() { const v = this.safeInt64(); if (v < 0) throw new Error(`must be non-negative, got ${v}`); return v; }
  safeInt64() { const v = this.int64(); if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`value exceeds safe integer range`); return Number(v); }
  int64() { this.require(8); const v = this.view.getBigInt64(this.offset, true); this.offset += 8; return v; }
  uint64() { this.require(8); const v = this.view.getBigUint64(this.offset, true); this.offset += 8; return v; }
  int32() { this.require(4); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  float64() { this.require(8); const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
  float32() { this.require(4); const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  char() { return this.string(1); }
  string(length) { const data = this.bytes(length); let r = ''; for (let i = 0; i < data.length; i += 8192) r += String.fromCharCode(...data.subarray(i, Math.min(data.length, i + 8192))); return r; }
  bytes(length) { this.require(length); const r = this.src.subarray(this.offset, this.offset + length); this.offset += length; return r; }
}
