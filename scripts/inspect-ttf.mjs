import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const readU16 = (b, o) => b.readUInt16BE(o);
const readU32 = (b, o) => b.readUInt32BE(o);

function getTable(buf, tagStr) {
  const numTables = readU16(buf, 4);
  for (let i = 0; i < numTables; i += 1) {
    const o = 12 + i * 16;
    const t = buf.subarray(o, o + 4).toString('ascii');
    if (t === tagStr) {
      const off = readU32(buf, o + 8);
      const len = readU32(buf, o + 12);
      return buf.subarray(off, off + len);
    }
  }
  return null;
}

function parseNameRecords(table) {
  if (!table || table.length < 6) return {};
  const count = readU16(table, 2);
  const stringOffset = readU16(table, 4);
  const out = {};
  for (let i = 0; i < count; i += 1) {
    const r = 6 + i * 12;
    const platform = readU16(table, r);
    const enc = readU16(table, r + 2);
    const nameId = readU16(table, r + 6);
    const length = readU16(table, r + 8);
    const offset = readU16(table, r + 10);
    const s = table.subarray(stringOffset + offset, stringOffset + offset + length);
    let text;
    if (platform === 3 && s.length >= 2 && s.length % 2 === 0) {
      let str = '';
      for (let j = 0; j < s.length; j += 2) str += String.fromCharCode(s.readUInt16BE(j));
      text = str;
    } else {
      text = s.toString('latin1');
    }
    const key = `id${nameId}_p${platform}_e${enc}`;
    if ([1, 4, 6].includes(nameId) && !out[key]) out[key] = text.trim();
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const name = process.argv[2] || path.join('母版字体库', '文鼎荊棘體.ttf');
const p = path.join(root, name);
if (!fs.existsSync(p)) {
  console.error('not found:', p);
  process.exit(1);
}
const buf = fs.readFileSync(p);
const magic = buf.subarray(0, 4);
console.log('file', name);
console.log('bytes', buf.length);
if (magic.toString('ascii') === 'ttcf') {
  console.log('type: TTC — 建议拆成单 TTF 再作 webfont');
  process.exit(0);
}
const scaler = buf.readUInt32BE(0);
console.log('scaler', '0x' + scaler.toString(16));

const need = ['head', 'hhea', 'maxp', 'cmap', 'name', 'glyf', 'CFF ', 'loca'];
for (const t of need) {
  const tbl = getTable(buf, t);
  console.log('table', JSON.stringify(t), tbl ? tbl.length : 'MISSING');
}

const nameTable = getTable(buf, 'name');
const recs = parseNameRecords(nameTable);
console.log('name samples (family/full/post if present):');
for (const [k, v] of Object.entries(recs)) {
  if (k.startsWith('id1_') || k.startsWith('id4_') || k.startsWith('id6_')) {
    console.log(' ', k, v.slice(0, 80));
  }
}

const cmap = getTable(buf, 'cmap');
if (cmap && cmap.length >= 4) {
  const nSub = readU16(cmap, 2);
  console.log('cmap subtables', nSub, '(浏览器需要 platform=3 encoding=1/10 的 Unicode cmap)');
  for (let i = 0; i < Math.min(nSub, 12); i += 1) {
    const r = 4 + i * 8;
    const plat = readU16(cmap, r);
    const enc = readU16(cmap, r + 2);
    const off = readU32(cmap, r + 4);
    const fmt = off + 4 <= cmap.length ? readU16(cmap, off) : -1;
    console.log(' ', { plat, enc, offset: off, format: fmt });
  }
}
