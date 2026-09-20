import type { DifferOptions } from '../differ';
import getType from './get-type';
import isEqual from './is-equal';
import shallowSimilarity from './shallow-similarity';

/**
 * One step of the LCS backtracking path, in backtracking order (from the
 * bottom-right corner of the DP table towards the top-left corner):
 * - `diag`: both sequences consume one element (aligned pair)
 * - `up`: the left sequence consumes one element (removal)
 * - `left`: the right sequence consumes one element (addition)
 */
export type LcsOp = 'diag' | 'up' | 'left';

/**
 * Memory-usage observer of the LCS engine. The engine only allocates a
 * constant number of auxiliary arrays per recursion level, each bounded by
 * the input width, so `peakArrayLength` must stay in `O(left + right)`
 * instead of the `O(left * right)` cells of a full DP matrix. Tests reset
 * this before a run and assert the bound afterwards.
 */
export const lcsMemoryStats = {
  peakArrayLength: 0,
  reset() {
    this.peakArrayLength = 0;
  },
};

const noteAllocation = (length: number) => {
  if (length > lcsMemoryStats.peakArrayLength) {
    lcsMemoryStats.peakArrayLength = length;
  }
};

/**
 * The element-matching predicate, kept identical to the historical matrix
 * implementation in `diff-array-lcs.ts`: two arrays/objects are always
 * considered alignable (they are diffed recursively later), unless
 * `recursiveEqual` requires them to be really equal or similar enough.
 *
 * Element types may be precomputed by the caller (they are loop-invariant),
 * which keeps the hot DP loop free of repeated `getType` calls. Exported so
 * tests can drive a reference matrix DP with the very same predicate (the
 * shared contract between both implementations).
 */
export const lcsMatch = (
  left: any,
  right: any,
  options: DifferOptions,
  typeLeft: string = getType(left),
  typeRight: string = getType(right),
): boolean => {
  if (typeLeft === typeRight && (typeLeft === 'array' || typeLeft === 'object')) {
    if (options.recursiveEqual) {
      return isEqual(left, right, options) || shallowSimilarity(left, right) > 0.5;
    }
    return true;
  }
  return isEqual(left, right, options);
};

const typesOf = (arr: any[], start: number, length: number): string[] => {
  const types = new Array(length);
  noteAllocation(length);
  for (let i = 0; i < length; i++) {
    types[i] = getType(arr[start + i]);
  }
  return types;
};

/**
 * Base case of the recursion: a single left element against `rightLength`
 * right elements. A 2-row matrix is already linear memory, and using the
 * same DP rules keeps the alignment decisions bit-exact.
 */
const buildOpsSingleRow = (
  arrLeft: any[],
  leftStart: number,
  arrRight: any[],
  rightStart: number,
  rightLength: number,
  options: DifferOptions,
  ops: LcsOp[],
) => {
  const width = rightLength + 1;
  noteAllocation(width);
  const backtrack = new Array(width).fill('');
  const fPrev = new Array(width).fill(0);
  const fCur = new Array(width).fill(0);
  const typeLeft = getType(arrLeft[leftStart]);
  const typesRight = typesOf(arrRight, rightStart, rightLength);
  for (let j = 1; j <= rightLength; j++) {
    if (lcsMatch(arrLeft[leftStart], arrRight[rightStart + j - 1], options, typeLeft, typesRight[j - 1])) {
      fCur[j] = fPrev[j - 1] + 1;
      backtrack[j] = 'diag';
    } else if (fPrev[j] >= fCur[j - 1]) {
      fCur[j] = fPrev[j];
      backtrack[j] = 'up';
    } else {
      fCur[j] = fCur[j - 1];
      backtrack[j] = 'left';
    }
  }
  let i = 1;
  let j = rightLength;
  while (i > 0 || j > 0) {
    if (j === 0) {
      ops.push('up');
      i--;
    } else if (i === 0) {
      ops.push('left');
      j--;
    } else {
      const op = backtrack[j] as LcsOp;
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
  }
};

/**
 * Divide-and-conquer step. Instead of storing the whole `(m + 1) * (n + 1)`
 * backtrack matrix, we run the forward DP once and carry, for every row
 * below the middle row, the column where the deterministic backtracking
 * path crosses the middle row. The crossing column of the bottom-right
 * corner is exactly the split point that reproduces the matrix algorithm's
 * alignment, including its tie-breaking (`diag` on match, otherwise `up`
 * on equal costs). Each recursion level only keeps two DP rows and two
 * crossing rows, i.e. `O(n)` auxiliary memory.
 */
const buildOps = (
  arrLeft: any[],
  leftStart: number,
  leftLength: number,
  arrRight: any[],
  rightStart: number,
  rightLength: number,
  options: DifferOptions,
  ops: LcsOp[],
) => {
  if (leftLength === 0) {
    for (let j = 0; j < rightLength; j++) {
      ops.push('left');
    }
    return;
  }
  if (rightLength === 0) {
    for (let i = 0; i < leftLength; i++) {
      ops.push('up');
    }
    return;
  }
  if (leftLength === 1) {
    buildOpsSingleRow(arrLeft, leftStart, arrRight, rightStart, rightLength, options, ops);
    return;
  }

  const width = rightLength + 1;
  const mid = leftLength >> 1;
  noteAllocation(width);
  const typesLeft = typesOf(arrLeft, leftStart, leftLength);
  const typesRight = typesOf(arrRight, rightStart, rightLength);

  let fPrev = new Array(width).fill(0);
  let crossingPrev: number[] = [];
  for (let i = 1; i <= leftLength; i++) {
    const fCur = new Array(width).fill(0);
    noteAllocation(width);
    const trackCrossing = i > mid;
    let crossingCur: number[] = [];
    if (i === mid) {
      crossingPrev = new Array(width);
      noteAllocation(width);
      for (let j = 0; j <= rightLength; j++) {
        crossingPrev[j] = j;
      }
    } else if (trackCrossing) {
      crossingCur = new Array(width);
      noteAllocation(width);
      crossingCur[0] = crossingPrev[0];
    }
    const leftValue = arrLeft[leftStart + i - 1];
    const typeLeft = typesLeft[i - 1];
    for (let j = 1; j <= rightLength; j++) {
      if (lcsMatch(leftValue, arrRight[rightStart + j - 1], options, typeLeft, typesRight[j - 1])) {
        fCur[j] = fPrev[j - 1] + 1;
        if (trackCrossing) {
          crossingCur[j] = crossingPrev[j - 1];
        }
      } else if (fPrev[j] >= fCur[j - 1]) {
        fCur[j] = fPrev[j];
        if (trackCrossing) {
          crossingCur[j] = crossingPrev[j];
        }
      } else {
        fCur[j] = fCur[j - 1];
        if (trackCrossing) {
          crossingCur[j] = crossingCur[j - 1];
        }
      }
    }
    if (trackCrossing) {
      crossingPrev = crossingCur;
    }
    fPrev = fCur;
  }
  const split = crossingPrev[rightLength];

  buildOps(arrLeft, leftStart + mid, leftLength - mid, arrRight, rightStart + split, rightLength - split, options, ops);
  buildOps(arrLeft, leftStart, mid, arrRight, rightStart, split, options, ops);
};

/**
 * Computes the LCS alignment of two arrays as a sequence of operations in
 * backtracking order, using linear auxiliary memory. The result is
 * bit-identical to the historical full-matrix implementation: same matches,
 * same tie-breaking between equal-cost candidates, hence the same rendering
 * decisions (including `showModifications` pairing) downstream.
 */
const lcsOps = (arrLeft: any[], arrRight: any[], options: DifferOptions): LcsOp[] => {
  const ops: LcsOp[] = [];
  noteAllocation(arrLeft.length + arrRight.length);
  buildOps(arrLeft, 0, arrLeft.length, arrRight, 0, arrRight.length, options, ops);
  return ops;
};

export default lcsOps;
