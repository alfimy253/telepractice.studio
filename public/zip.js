const encoder = new TextEncoder();
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function join(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function put16(view, offset, value) { view.setUint16(offset, value, true); }
function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}
function createZip(files) {
  if (!Array.isArray(files) || files.length > 65535) throw new Error('Too many files for a standard ZIP archive.');
  const localParts = [];
  const centralParts = [];
  const stamp = dosDateTime();
  let offset = 0;
  for (const [filePath, raw] of files) {
    const normalized = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some((part) => part === '..')) throw new Error(`Unsafe ZIP path: ${filePath}`);
    const name = encoder.encode(normalized);
    const data = raw instanceof Uint8Array ? raw : encoder.encode(String(raw));
    if (name.length > 65535 || data.length > 0xffffffff) throw new Error('ZIP entry exceeds supported size.');
    const checksum = crc32(data);
    const local = new Uint8Array(30); const localView = new DataView(local.buffer);
    put32(localView, 0, 0x04034b50); put16(localView, 4, 20); put16(localView, 6, 0x0800);
    put16(localView, 8, 0); put16(localView, 10, stamp.time); put16(localView, 12, stamp.date);
    put32(localView, 14, checksum); put32(localView, 18, data.length); put32(localView, 22, data.length);
    put16(localView, 26, name.length); put16(localView, 28, 0);
    localParts.push(local, name, data);

    const central = new Uint8Array(46); const centralView = new DataView(central.buffer);
    put32(centralView, 0, 0x02014b50); put16(centralView, 4, 20); put16(centralView, 6, 20);
    put16(centralView, 8, 0x0800); put16(centralView, 10, 0); put16(centralView, 12, stamp.time);
    put16(centralView, 14, stamp.date); put32(centralView, 16, checksum); put32(centralView, 20, data.length);
    put32(centralView, 24, data.length); put16(centralView, 28, name.length); put16(centralView, 30, 0);
    put16(centralView, 32, 0); put16(centralView, 34, 0); put16(centralView, 36, 0);
    put32(centralView, 38, 0); put32(centralView, 42, offset);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = join(centralParts);
  const end = new Uint8Array(22); const endView = new DataView(end.buffer);
  put32(endView, 0, 0x06054b50); put16(endView, 4, 0); put16(endView, 6, 0);
  put16(endView, 8, files.length); put16(endView, 10, files.length);
  put32(endView, 12, centralDirectory.length); put32(endView, 16, offset); put16(endView, 20, 0);
  return join([...localParts, centralDirectory, end]);
}
export { createZip, crc32 };
