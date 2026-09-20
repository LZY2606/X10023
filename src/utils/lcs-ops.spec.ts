import type { DifferOptions } from '../differ';
import lcsOps, { lcsMatch, lcsMemoryStats, LcsOp } from './lcs-ops';

/**
 * Shared contract between the historical full-matrix LCS and the current
 * linear-memory divide-and-conquer implementation. The oracle below is the
 * matrix algorithm that used to live in `diff-array-lcs.ts`, driven by the
 * very same exported `lcsMatch` predicate, so any drift in matching or
 * tie-breaking rules is caught here.
 */
const matrixOps = (arrLeft: any[], arrRight: any[], options: DifferOptions): LcsOp[] => {
  const m = arrLeft.length;
  const n = arrRight.length;
  const f = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  const backtrack = Array(m + 1).fill(0).map(() => Array(n + 1).fill(''));
  for (let i = 1; i <= m; i++) {
    backtrack[i][0] = 'up';
  }
  for (let j = 1; j <= n; j++) {
    backtrack[0][j] = 'left';
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (lcsMatch(arrLeft[i - 1], arrRight[j - 1], options)) {
        f[i][j] = f[i - 1][j - 1] + 1;
        backtrack[i][j] = 'diag';
      } else if (f[i - 1][j] >= f[i][j - 1]) {
        f[i][j] = f[i - 1][j];
        backtrack[i][j] = 'up';
      } else {
        f[i][j] = f[i][j - 1];
        backtrack[i][j] = 'left';
      }
    }
  }
  const ops: LcsOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const op = backtrack[i][j] as LcsOp;
    ops.push(op);
    if (op === 'diag') {
      i--;
      j--;
    } else if (op === 'up') {
      i--;
    } else {
      j--;
    }
  }
  return ops;
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const expectSameOps = (left: any[], right: any[], options: DifferOptions) => {
  expect(lcsOps(left, right, options)).toEqual(matrixOps(left, right, options));
};

describe('lcs-ops: linear-memory LCS vs matrix oracle (shared contract)', () => {
  it('is exhaustive over primitive pairs up to length 6', () => {
    const options: DifferOptions = {};
    const alphabet = [0, 1];
    const pools: number[][][] = [[[]]];
    for (let len = 1; len <= 6; len++) {
      const next: number[][] = [];
      for (const seq of pools[len - 1]) {
        for (const v of alphabet) {
          next.push([...seq, v]);
        }
      }
      pools.push(next);
    }
    for (let m = 1; m <= 6; m++) {
      for (let n = 0; n <= 6; n++) {
        for (const left of pools[m]) {
          for (const right of pools[n]) {
            expectSameOps(left, right, options);
          }
        }
      }
    }
  });

  it('is exhaustive over mixed-type pairs up to length 4, both recursiveEqual modes', () => {
    const alphabet: any[] = [0, 'a', {}, []];
    const pools: any[][][] = [[]];
    for (let len = 1; len <= 4; len++) {
      const next: any[][] = [];
      for (const seq of pools[len - 1]) {
        for (const v of alphabet) {
          next.push([...seq, v]);
        }
      }
      pools.push(next);
    }
    for (const recursiveEqual of [false, true]) {
      const options: DifferOptions = { recursiveEqual };
      for (let m = 1; m <= 4; m++) {
        for (let n = 0; n <= 4; n++) {
          for (const left of pools[m]) {
            for (const right of pools[n]) {
              expectSameOps(left, right, options);
            }
          }
        }
      }
    }
  });

  it('matches the oracle on randomized nested inputs', () => {
    const rand = mulberry32(0x5eed);
    const randValue = (depth: number): any => {
      const pick = rand();
      if (depth <= 0 || pick < 0.45) {
        return Math.floor(rand() * 3);
      }
      if (pick < 0.6) {
        return ['x', 'y'][Math.floor(rand() * 2)];
      }
      if (pick < 0.8) {
        return Array.from({ length: Math.floor(rand() * 3) }, () => randValue(depth - 1));
      }
      const obj: Record<string, any> = {};
      const keys = ['a', 'b', 'c'];
      for (let k = 0; k < Math.floor(rand() * 3); k++) {
        obj[keys[Math.floor(rand() * 3)]] = randValue(depth - 1);
      }
      return obj;
    };
    for (const recursiveEqual of [false, true]) {
      const options: DifferOptions = { recursiveEqual };
      for (let t = 0; t < 400; t++) {
        const left = Array.from({ length: Math.floor(rand() * 13) }, () => randValue(2));
        const right = Array.from({ length: Math.floor(rand() * 13) }, () => randValue(2));
        expectSameOps(left, right, options);
      }
    }
  });

  it('handles all-equal arrays as one run of diag ops', () => {
    const left = new Array(500).fill(7);
    const right = new Array(500).fill(7);
    const ops = lcsOps(left, right, {});
    expect(ops).toEqual(new Array(500).fill('diag'));
    expectSameOps(left, right, {});
  });

  it('handles all-different arrays as removals followed by additions', () => {
    const left = Array.from({ length: 300 }, (_, i) => i);
    const right = Array.from({ length: 200 }, (_, i) => i + 1000);
    const ops = lcsOps(left, right, {});
    expect(ops).toEqual([
      ...new Array(300).fill('up'),
      ...new Array(200).fill('left'),
    ]);
    expectSameOps(left, right, {});
  });

  it('keeps deterministic alignment on alternating repeats', () => {
    const left = Array.from({ length: 801 }, (_, i) => i % 2);
    const right = Array.from({ length: 800 }, (_, i) => (i + 1) % 2);
    const ops = lcsOps(left, right, {});
    expect(ops).toEqual(matrixOps(left, right, {}));
    expect(fnv1a(ops.join(','))).toMatchSnapshot();
  });

  it('keeps deterministic alignment on duplicate-heavy repeats', () => {
    const left = Array.from({ length: 400 }, (_, i) => i % 3);
    const right = Array.from({ length: 400 }, (_, i) => (i * 2) % 3);
    const ops = lcsOps(left, right, {});
    expect(ops).toEqual(matrixOps(left, right, {}));
    expect(fnv1a(ops.join(','))).toMatchSnapshot();
  });

  it('stays linear-memory on large arrays and records peak array length', () => {
    const size = 1500;
    const left = Array.from({ length: size }, (_, i) => i % 7);
    const right = Array.from({ length: size }, (_, i) => (i + 3) % 7);
    lcsMemoryStats.reset();
    const ops = lcsOps(left, right, {});
    const peak = lcsMemoryStats.peakArrayLength;
    const matrixCells = (size + 1) * (size + 1);
    // recorded for the changelog: peak array length vs. the old matrix size
    expect({ peakArrayLength: peak, matrixCells, ops: ops.length }).toMatchSnapshot();
    // linear bound: a handful of rows of width n + 1 plus the op sequence
    expect(peak).toBeLessThanOrEqual(4 * (2 * size + 2));
    // and definitely not the quadratic matrix any more
    expect(peak).toBeLessThan(matrixCells / 100);
    // structural invariants of a valid alignment
    const ups = ops.filter(op => op === 'up').length;
    const lefts = ops.filter(op => op === 'left').length;
    const diags = ops.filter(op => op === 'diag').length;
    expect(diags + ups).toBe(size);
    expect(diags + lefts).toBe(size);
    expect(diags).toBe(size - 3);
    // the end-to-end 12k-element stress (with peak recording) lives in
    // `src/differ-lcs.spec.ts`
  });

  it('matches the oracle on a large duplicate-heavy case', () => {
    const left = Array.from({ length: 800 }, (_, i) => i % 5);
    const right = Array.from({ length: 800 }, (_, i) => (i + 1) % 5);
    expectSameOps(left, right, {});
  });
});
