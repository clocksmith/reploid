import { describe, expect, it } from 'vitest';
import { byteCapacity, encodeQr, reedSolomon, renderQrForTerminal } from '../../server/terminal-qr.js';

// Format information is a BCH(15,5) code word XOR 0x5412; the 32 valid words differ in at least 7 bits.
const validFormats = new Set(Array.from({ length: 32 }, (_, data) => {
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (data << 10 | rem) ^ 0x5412;
}));
const finderAt = (grid, x0, y0) => Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => {
  const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
  return grid[y0 + y][x0 + x] === (ring !== 2);
}).every(Boolean)).every(Boolean);

describe('terminal QR encoder', () => {
  it('computes Reed-Solomon codewords for the ISO 18004 HELLO WORLD 1-M example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('matches the published byte-mode capacities', () => {
    expect([1, 2, 5, 7, 10, 23, 40].map(v => byteCapacity(v, 0))).toEqual([17, 32, 106, 154, 271, 1091, 2953]);
    expect([1, 7, 10, 40].map(v => byteCapacity(v, 1))).toEqual([14, 122, 213, 2331]);
    expect([1, 10, 40].map(v => byteCapacity(v, 3))).toEqual([7, 119, 1273]);
  });

  it.each([['', 21], ['x'.repeat(17), 21], ['x'.repeat(18), 25], ['x'.repeat(200), 53], ['x'.repeat(1091), 109]])(
    'draws finder, timing, format and version patterns (%#)', (text, size) => {
      const grid = encodeQr(text);
      expect(grid).toHaveLength(size);
      expect(finderAt(grid, 0, 0) && finderAt(grid, size - 7, 0) && finderAt(grid, 0, size - 7)).toBe(true);
      for (let i = 8; i < size - 8; i++) { expect(grid[6][i]).toBe(i % 2 === 0); expect(grid[i][6]).toBe(i % 2 === 0); }
      expect(grid[size - 8][8]).toBe(true);
      const bit = (x, y) => grid[y][x] ? 1 : 0;
      let first = 0, second = 0;
      const firstCells = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
      firstCells.forEach(([x, y], i) => { first |= bit(x, y) << i; });
      for (let i = 0; i < 8; i++) second |= bit(size - 1 - i, 8) << i;
      for (let i = 8; i < 15; i++) second |= bit(8, size - 15 + i) << i;
      expect(validFormats.has(first)).toBe(true);
      expect(second).toBe(first);
      if (size >= 45) {
        const version = (size - 17) / 4;
        let word = 0;
        for (let i = 0; i < 18; i++) word |= bit(size - 11 + i % 3, Math.floor(i / 3)) << i;
        expect(word >>> 12).toBe(version);
      }
    });

  it('places alignment patterns on the timing lines and the version 23 row at 78', () => {
    const alignmentAt = (grid, cx, cy) => [-2, -1, 0, 1, 2].every(dy => [-2, -1, 0, 1, 2]
      .every(dx => grid[cy + dy][cx + dx] === (Math.max(Math.abs(dx), Math.abs(dy)) !== 1)));
    const v7 = encodeQr('x'.repeat(154));
    expect(alignmentAt(v7, 22, 6) && alignmentAt(v7, 6, 22) && alignmentAt(v7, 22, 22) && alignmentAt(v7, 38, 22)).toBe(true);
    const v23 = encodeQr('x'.repeat(1091));
    expect(alignmentAt(v23, 54, 78) && alignmentAt(v23, 78, 6) && alignmentAt(v23, 102, 78)).toBe(true);
  });

  it('rejects text beyond version 40', () => {
    expect(() => encodeQr('x'.repeat(2954))).toThrow('too long');
  });

  it('renders two modules per cell, black on white, with a quiet zone', () => {
    const lines = renderQrForTerminal('https://replo.id/').split('\n');
    expect(lines).toHaveLength(Math.ceil((21 + 8) / 2));
    for (const line of lines) {
      expect(line.startsWith('\x1b[30;107m') && line.endsWith('\x1b[0m')).toBe(true);
      expect(line.slice(9, -4)).toMatch(/^ {4}[ ▀▄█]{21} {4}$/u);
    }
  });
});
