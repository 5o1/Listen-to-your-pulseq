export const minimalSequenceText = [
  '# Pulseq sequence file',
  '[VERSION]',
  'major 1',
  'minor 5',
  'revision 1',
  '',
  '[DEFINITIONS]',
  'GradientRasterTime 1e-05',
  'BlockDurationRaster 1e-05',
  '',
  '[BLOCKS]',
  '1 100 0 1 0 0 0 0',
  '2 100 0 0 2 0 0 0',
  '3 100 0 0 0 3 0 0',
  '',
  '[TRAP]',
  '1 10000 100 500 100 0',
  '2 15000 200 300 200 0',
  '3 8000 150 400 150 0',
  '',
].join('\n');

export function createMinimalBinarySequence() {
  const buffer = new ArrayBuffer(80);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x01, 0x70, 0x75, 0x6c, 0x73, 0x65, 0x71, 0x02]);

  const view = new DataView(buffer);
  let offset = 8;
  const writeInt64 = value => { view.setBigInt64(offset, BigInt(value), true); offset += 8; };
  const writeUint64 = value => { view.setBigUint64(offset, BigInt(value), true); offset += 8; };
  const writeInt32 = value => { view.setInt32(offset, value, true); offset += 4; };

  writeInt64(1);
  writeInt64(5);
  writeInt64(1);
  writeUint64(0xffff_ffff_0000_0002n); // BLOCKS section
  writeInt64(1); // one block
  writeInt64(100); // 100 block-duration raster ticks
  for (let i = 0; i < 6; i++) writeInt32(0); // RF, Gx, Gy, Gz, ADC, extensions

  return Buffer.from(buffer);
}

export const demoSequenceText = [
  '# Pulseq sequence file',
  '[VERSION]',
  'major 1',
  'minor 5',
  'revision 1',
  '',
  '[DEFINITIONS]',
  'GradientRasterTime 1e-05',
  'BlockDurationRaster 1e-05',
  '',
  '[BLOCKS]',
  '1 10000 0 1 0 0 0 0',
  '2 10000 0 0 2 0 0 0',
  '3 10000 0 0 0 3 0 0',
  '4 10000 0 4 4 0 0 0',
  '5 10000 0 0 0 0 0 0',
  '6 20000 0 5 5 5 0 0',
  '',
  '[TRAP]',
  '1 10 10000 50000 10000 0',
  '2 15 20000 30000 20000 0',
  '3 8 15000 40000 15000 0',
  '4 12 10000 60000 10000 0',
  '5 20 5000 80000 5000 0',
  '',
].join('\n');
