import { expect, it } from 'vitest';
import { mathematicalFields, classificationBlend, primeSieve } from '../../self/ui/components/mathematical-background.js';

it('sieves primes and excludes one and composite squares', () => {
  expect([...primeSieve(25)].flatMap((value, index) => value ? [index] : []))
    .toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23]);
});

it('places each spiral integer once, with primes and perfect squares distinct', () => {
  const { ulam, squares } = mathematicalFields(5);
  expect([...ulam].reduce((a, b) => a + b)).toBe(9);
  expect([...squares].reduce((a, b) => a + b)).toBe(5);
  expect(ulam[2 * 5 + 3]).toBe(1); // 2, immediately right of the origin
  expect(squares[4 * 5 + 4]).toBe(1); // 25, outer corner
  expect([...ulam].some((value, index) => value && squares[index])).toBe(false);
});

it('uses the separate axis rule for Gaussian primes', () => {
  const { gaussian, size } = mathematicalFields(9), half = 4;
  const at = (x, y) => gaussian[(y + half) * size + x + half];
  expect(at(1, 1)).toBe(1); // norm 2
  expect(at(2, 1)).toBe(1); // norm 5
  expect(at(2, 2)).toBe(0); // norm 8
  expect(at(2, 0)).toBe(0); // rational prime 2 splits
  expect(at(3, 0)).toBe(1); // 3 mod 4
  expect(at(-3, 0)).toBe(1);
  expect(at(0, 0)).toBe(0);
});

it('marks nonzero quadratic residues of the squared norm modulo 163', () => {
  const { residues, size } = mathematicalFields(9);
  const at = (x, y) => residues[(y + 4) * size + x + 4];
  expect(at(0, 0)).toBe(0);
  expect(at(1, 0)).toBe(1);
  expect(at(1, 1)).toBe(0); // 2 is a nonresidue modulo 163
  expect(at(-2, 3)).toBe(at(2, -3));
});

it('sweeps fixed columns in order and keeps the endpoint classifications exact', () => {
  for (const col of [0, 75, 150]) {
    expect(classificationBlend(col, 151, 0)).toBe(0);
    expect(classificationBlend(col, 151, 30)).toBe(0);
    expect(classificationBlend(col, 151, 50)).toBe(1);
  }
  expect(classificationBlend(10, 151, 40)).toBe(1);
  expect(classificationBlend(140, 151, 40)).toBe(0);
  expect(classificationBlend(75, 151, 39.9)).toBeLessThan(classificationBlend(75, 151, 40.1));
});
