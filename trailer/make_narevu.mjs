// SPDX-License-Identifier: MIT
// Drawn from scratch for Langscape. Run: node trailer/make_narevu.mjs
import { writeFileSync } from 'node:fs';

// Coordinates use a 1,000-unit em with Y up. Solid contours are wound
// clockwise; the BOWL and APERTURE counters use the opposite winding.
// Bend and chamfer widths repeat across signs, but each silhouette differs.
const contour = (points, counter = false) => {
  const path = points.split(' ').map((pair) => pair.split(',').map(Number));
  const area = path.reduce((sum, [x, y], i) => {
    const [nx, ny] = path[(i + 1) % path.length];
    return sum + x * ny - y * nx;
  }, 0);
  return (area > 0) === counter ? path : path.reverse();
};
const cut = (points) => contour(points, true);
const tile = (x, y) => contour(`${x},${y + 24} ${x + 24},${y + 48} ${x + 88},${y + 48} ${x + 88},${y + 24} ${x + 64},${y} ${x},${y}`);
const glyphs = {
  '.notdef': [580, contour('60,0 60,640 520,640 520,0'), cut('140,80 440,80 440,560 140,560')],
  ' ': [275],
  // BOWL: low, asymmetrical octagon with a lightly skewed counter.
  a: [592, contour('62,360 213,510 388,510 530,372 530,142 380,0 204,0 62,138'), cut('148,329 248,428 353,428 444,338 444,176 346,82 238,82 148,171')],
  // Two rails closing on the right; the upper rail sits farther in.
  e: [586, contour('60,82 384,82 444,142 444,333 385,392 156,392 156,474 419,474 530,363 530,111 418,0 60,0'), tile(60, 426)],
  i: [456, contour('57,83 153,83 285,215 285,513 371,599 371,182 188,0 57,0'), tile(86, 455)],
  o: [626, contour('55,149 55,448 142,535 428,535 428,453 179,453 141,415 141,115 107,115'), contour('197,82 447,82 485,120 485,420 518,420 571,386 571,87 484,0 197,0')],
  u: [629, contour('61,482 147,568 147,174 238,82 341,82 482,223 482,384 568,470 568,189 376,0 204,0 61,143'), tile(286, 325)],
  // p has no counter: an open sloped shoulder and a low, detached tile.
  p: [608, contour('61,575 209,575 445,338 445,-90 359,-176 359,303 173,489 61,489'), tile(61, 65)],
  // APERTURE: b is tall, closed, and has a prominent rectangular counter.
  b: [620, contour('64,0 64,613 150,699 150,508 428,508 556,380 556,129 427,0'), cut('150,82 393,82 470,159 470,349 393,426 150,426')],
  t: [577, contour('62,477 160,575 517,575 517,493 350,493 350,158 192,0 70,0 70,82 158,82 264,189 264,493 62,493')],
  k: [606, contour('59,0 59,492 166,599 289,599 289,517 201,517 145,461 145,315 238,315 473,550 546,550 546,502 339,295 546,88 546,0 510,0 276,233 145,233 145,0')],
  n: [614, contour('62,0 62,301 291,530 451,530 552,429 552,0 466,0 466,396 414,448 326,448 148,269 148,86')],
  r: [556, contour('60,0 60,462 159,561 372,561 491,442 491,353 405,353 405,408 338,479 194,479 146,432 146,86'), tile(352, 94)],
  m: [722, contour('60,0 60,311 255,506 337,506 443,400 551,508 662,508 662,0 576,0 576,414 552,394 443,283 301,424 291,424 146,277 146,86')],
  s: [612, contour('60,0 60,82 391,82 466,157 466,194 422,238 213,238 95,356 95,451 206,562 552,562 470,480 242,480 181,419 181,390 251,320 457,320 552,225 552,124 428,0')],
  v: [611, contour('61,522 170,522 411,281 411,386 550,525 550,402 411,263 411,0 325,0 325,246 61,510'), tile(61, 137)],
  l: [560, contour('60,0 60,551 208,699 319,699 319,617 244,617 146,519 146,82 414,82 496,0')],
};

const entries = Object.entries(glyphs);
const BE = (data, bytes, signed = false) => {
  const b = Buffer.alloc(data.length * bytes);
  data.forEach((n, i) => {
    if (signed) b.writeIntBE(n, i * bytes, bytes);
    else b.writeUIntBE(n, i * bytes, bytes);
  });
  return b;
};
const u16 = (...data) => BE(data, 2);
const s16 = (...data) => BE(data, 2, true);
const u32 = (...data) => BE(data, 4);
const ascii = (str) => Buffer.from(str, 'ascii');
const cat = (...parts) => Buffer.concat(parts);
const pad = (buf) => cat(buf, Buffer.alloc((4 - (buf.length % 4)) % 4));
const extent = (points) => points.length === 0 ? [0, 0, 0, 0] : [
  Math.min(...points.map(([x]) => x)), Math.min(...points.map(([, y]) => y)),
  Math.max(...points.map(([x]) => x)), Math.max(...points.map(([, y]) => y)),
];
const outlines = entries.map(([, [advance, ...contours]]) => {
  const points = contours.flat();
  const bounds = extent(points);
  const ends = contours.map((_, i) => contours.slice(0, i + 1).flat().length - 1);
  const deltas = (axis) => points.map((point, i) => point[axis] - (points[i - 1]?.[axis] ?? 0));
  const data = points.length === 0 ? Buffer.alloc(0) : pad(cat(
    s16(contours.length, ...bounds), u16(...ends, 0), Buffer.alloc(points.length, 1),
    s16(...deltas(0)), s16(...deltas(1)),
  ));
  return { advance, bounds, data, points, contours };
});
const allBounds = extent(outlines.flatMap(({ points }) => points));
const locations = [0];
for (const { data } of outlines) locations.push(locations.at(-1) + data.length);
const mappings = new Map([[0x20, 1], [0xa0, 1]]);
for (const [i, [char]] of entries.entries()) {
  if (/^[a-z]$/.test(char)) {
    mappings.set(char.charCodeAt(0), i);
    mappings.set(char.toUpperCase().charCodeAt(0), i);
  }
}
// cmap format 4, using one constant-delta segment per character.
const segments = [...mappings].sort(([a], [b]) => a - b).concat([[0xffff, 0]]);
const search = (length, itemSize) => {
  const exponent = Math.floor(Math.log2(length));
  const range = itemSize * 2 ** exponent;
  return [range, exponent, length * itemSize - range];
};
const cmapChars = u16(...segments.map(([code]) => code));
const cmap = cat(u16(0, 2, 0, 3), u32(20), u16(3, 1), u32(20),
  u16(4, 16 + 8 * segments.length, 0, 2 * segments.length, ...search(segments.length, 2)),
  cmapChars, u16(0), cmapChars,
  u16(...segments.map(([code, gid]) => (gid - code) & 0xffff)),
  Buffer.alloc(2 * segments.length));

const names = new Map([
  [0, 'Copyright (c) 2026 Langscape contributors'], [1, 'Narevu Script'], [2, 'Regular'],
  [3, 'Langscape:NarevuScript-Regular:1.000'], [4, 'Narevu Script Regular'],
  [5, 'Version 1.000'], [6, 'NarevuScript-Regular'],
  [13, 'MIT License. See the Langscape project LICENSE.'],
  [14, 'https://opensource.org/license/mit/'], [16, 'Narevu Script'], [17, 'Regular'],
]);
const nameBytes = [...names.values()].map((str) => Buffer.from(str, 'utf16le').swap16());
let nameOffset = 0;
const nameRecords = [...names.keys()].map((id, i) => {
  const length = nameBytes[i].length;
  const record = u16(3, 1, 0x0409, id, length, nameOffset);
  nameOffset += length;
  return record;
});
const averageWidth = Math.round(outlines.slice(2).reduce((n, o) => n + o.advance, 0) / (outlines.length - 2));
const max = (values) => Math.max(...values);
const min = (values) => Math.min(...values);
const tables = {
  'OS/2': cat(u16(4), s16(averageWidth), u16(400, 5, 0),
    s16(650, 660, 0, 75, 650, 660, 0, 350, 82, 270, 0),
    Buffer.from([2, 11, 6, 3, 5, 2, 2, 2, 2, 4]), u32(1, 0, 0, 0), ascii('NONE'),
    u16(0xc0, 0x20, 0xa0), s16(800, -200, 0), u16(800, 200), u32(1, 0),
    s16(510, 699), u16(0, 0x20, 1)),
  cmap,
  glyf: cat(...outlines.map(({ data }) => data)),
  head: cat(u32(0x10000, 0x10000, 0, 0x5f0f3cf5), u16(3, 1000),
    u32(0, 3850070400, 0, 3850070400), s16(...allBounds), u16(0, 8), s16(2, 1, 0)),
  hhea: cat(u32(0x10000), s16(800, -200, 0), u16(max(outlines.map(({ advance }) => advance))),
    s16(min(outlines.map(({ bounds }) => bounds[0])), min(outlines.map(({ bounds, advance }) => advance - bounds[2])),
      allBounds[2], 1, 0, 0, 0, 0, 0, 0, 0), u16(entries.length)),
  hmtx: cat(...outlines.map(({ advance, bounds }) => cat(u16(advance), s16(bounds[0])))),
  loca: u32(...locations),
  maxp: cat(u32(0x10000), u16(entries.length, max(outlines.map(({ points }) => points.length)),
    max(outlines.map(({ contours }) => contours.length)), 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0)),
  name: cat(u16(0, names.size, 6 + 12 * names.size), ...nameRecords, ...nameBytes),
  post: cat(u32(0x30000, 0), s16(-115, 65), u32(0, 0, 0, 0, 0)),
};

const checksum = (buf) => {
  const data = pad(buf);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + data.readUInt32BE(i)) >>> 0;
  return sum;
};
const tags = Object.keys(tables).sort();
const header = cat(u32(0x10000), u16(tags.length, ...search(tags.length, 16)));
let tableOffset = header.length + 16 * tags.length;
let adjustmentOffset;
const records = tags.map((tag) => {
  const table = tables[tag];
  const record = cat(ascii(tag), u32(checksum(table), tableOffset, table.length));
  if (tag === 'head') adjustmentOffset = tableOffset + 8;
  tableOffset += pad(table).length;
  return record;
});
const font = cat(header, ...records, ...tags.map((tag) => pad(tables[tag])));
font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, adjustmentOffset);
writeFileSync(new URL('./public/NarevuScript.ttf', import.meta.url), font);
