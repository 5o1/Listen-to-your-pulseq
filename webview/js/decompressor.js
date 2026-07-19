// Shape Decompressor — ported from seqeyes_plugin decompressor.ts (MIT)
// Pulseq run-length encoding on the waveform derivative.

export function decompressShape(compressed, numSamples) {
  const packedLen = compressed.length;
  if (!Number.isInteger(numSamples) || numSamples <= 0)
    throw new Error(`Invalid shape sample count: ${numSamples}`);
  if (packedLen === numSamples)
    return new Float64Array(compressed);

  const result = new Float64Array(numSamples);
  let iPacked = 0, iUnpacked = 0;

  while (iPacked < packedLen && iUnpacked < numSamples) {
    if (iPacked + 1 >= packedLen) {
      result[iUnpacked] = compressed[iPacked];
      iPacked++; iUnpacked++; break;
    }
    if (compressed[iPacked] !== compressed[iPacked + 1]) {
      result[iUnpacked] = compressed[iPacked];
      iPacked++; iUnpacked++;
    } else {
      if (iPacked + 2 >= packedLen)
        throw new Error('Malformed compressed shape: repeat marker missing count');
      const value = compressed[iPacked];
      const rawRepeat = compressed[iPacked + 2];
      const repeatCount = Math.round(rawRepeat) + 2;
      if (Math.abs(rawRepeat + 2 - repeatCount) > 1e-6 || repeatCount < 2)
        throw new Error(`Malformed compressed shape: invalid repeat count ${rawRepeat}`);
      if (iUnpacked + repeatCount > numSamples)
        throw new Error('Malformed compressed shape: repeat block exceeds expected sample count');
      iPacked += 3;
      const end = iUnpacked + repeatCount;
      while (iUnpacked < end) result[iUnpacked++] = value;
    }
  }
  if (iUnpacked !== numSamples)
    throw new Error(`Malformed compressed shape: expected ${numSamples} samples, decoded ${iUnpacked}`);

  let cumSum = 0;
  for (let i = 0; i < numSamples; i++) { cumSum += result[i]; result[i] = cumSum; }
  return result;
}
