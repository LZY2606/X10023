import type { DifferOptions, DiffResult } from '../differ';
import diffArrayLCS from './diff-array-lcs';
import diffObject from './diff-object';
import getType from './get-type';
import isEqual from './is-equal';
import shallowSimilarity from './shallow-similarity';
import concat from './concat';
import formatValue from './format-value';
import stringify from './stringify';
import prettyAppendLines from './pretty-append-lines';
import { addArrayClosingBrackets, addArrayOpeningBrackets, addMaxDepthPlaceholder } from './array-bracket-utils';

/**
 * Reference implementation: the historical full-matrix algorithm, kept here
 * verbatim as the shared contract. The production code computes the same
 * alignments with linear auxiliary memory; both are compared below on
 * crafted and randomized inputs, so any drift in matching, tie-breaking or
 * `showModifications` pairing is caught.
 */
const referenceLcs = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
): [DiffResult[], DiffResult[]] => {
  const f = Array(arrLeft.length + 1).fill(0).map(() => Array(arrRight.length + 1).fill(0));
  const backtrack = Array(arrLeft.length + 1).fill(0).map(() => Array(arrRight.length + 1).fill(0));

  for (let i = 1; i <= arrLeft.length; i++) {
    backtrack[i][0] = 'up';
  }
  for (let j = 1; j <= arrRight.length; j++) {
    backtrack[0][j] = 'left';
  }
  for (let i = 1; i <= arrLeft.length; i++) {
    for (let j = 1; j <= arrRight.length; j++) {
      const typeI = getType(arrLeft[i - 1]);
      const typeJ = getType(arrRight[j - 1]);
      if (typeI === typeJ && (typeI === 'array' || typeI === 'object')) {
        if (options.recursiveEqual) {
          if (
            isEqual(arrLeft[i - 1], arrRight[j - 1], options) ||
            shallowSimilarity(arrLeft[i - 1], arrRight[j - 1]) > 0.5
          ) {
            f[i][j] = f[i - 1][j - 1] + 1;
            backtrack[i][j] = 'diag';
          } else if (f[i - 1][j] >= f[i][j - 1]) {
            f[i][j] = f[i - 1][j];
            backtrack[i][j] = 'up';
          } else {
            f[i][j] = f[i][j - 1];
            backtrack[i][j] = 'left';
          }
        } else {
          f[i][j] = f[i - 1][j - 1] + 1;
          backtrack[i][j] = 'diag';
        }
      } else if (isEqual(arrLeft[i - 1], arrRight[j - 1], options)) {
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

  let i = arrLeft.length;
  let j = arrRight.length;
  let tLeft: DiffResult[] = [];
  let tRight: DiffResult[] = [];
  while (i > 0 || j > 0) {
    if (backtrack[i][j] === 'diag') {
      const type = getType(arrLeft[i - 1]);
      if (
        options.recursiveEqual &&
        (type === 'array' || type === 'object') &&
        isEqual(arrLeft[i - 1], arrRight[j - 1], options)
      ) {
        const reversedLeft = [];
        const reversedRight = [];
        prettyAppendLines(reversedLeft, reversedRight, '', '', arrLeft[i - 1], arrRight[j - 1], level + 1, options);
        tLeft = concat(tLeft, reversedLeft.reverse(), true);
        tRight = concat(tRight, reversedRight.reverse(), true);
      } else if (type === 'array') {
        const [l, r] = referenceDiffArrayLCS(arrLeft[i - 1], arrRight[j - 1], keyLeft, keyRight, level + 1, options);
        tLeft = concat(tLeft, l.reverse(), true);
        tRight = concat(tRight, r.reverse(), true);
      } else if (type === 'object') {
        const [l, r] = diffObject(arrLeft[i - 1], arrRight[j - 1], level + 2, options, referenceDiffArrayLCS);
        tLeft.unshift({ level: level + 1, type: 'equal', text: '}' });
        tRight.unshift({ level: level + 1, type: 'equal', text: '}' });
        tLeft = concat(tLeft, l.reverse(), true);
        tRight = concat(tRight, r.reverse(), true);
        tLeft.unshift({ level: level + 1, type: 'equal', text: '{' });
        tRight.unshift({ level: level + 1, type: 'equal', text: '{' });
      } else {
        const reversedLeft = [];
        const reversedRight = [];
        prettyAppendLines(reversedLeft, reversedRight, '', '', arrLeft[i - 1], arrRight[j - 1], level + 1, options);
        tLeft = concat(tLeft, reversedLeft.reverse(), true);
        tRight = concat(tRight, reversedRight.reverse(), true);
      }
      i--;
      j--;
    } else if (backtrack[i][j] === 'up') {
      if (options.showModifications && i > 1 && backtrack[i - 1][j] === 'left') {
        const typeLeft = getType(arrLeft[i - 1]);
        const typeRight = getType(arrRight[j - 1]);
        if (typeLeft === typeRight) {
          if (typeLeft === 'array') {
            const [l, r] = referenceDiffArrayLCS(
              arrLeft[i - 1], arrRight[j - 1], keyLeft, keyRight, level + 1, options,
            );
            tLeft = concat(tLeft, l.reverse(), true);
            tRight = concat(tRight, r.reverse(), true);
          } else if (typeLeft === 'object') {
            const [l, r] = diffObject(arrLeft[i - 1], arrRight[j - 1], level + 2, options, referenceDiffArrayLCS);
            tLeft.unshift({ level: level + 1, type: 'equal', text: '}' });
            tRight.unshift({ level: level + 1, type: 'equal', text: '}' });
            tLeft = concat(tLeft, l.reverse(), true);
            tRight = concat(tRight, r.reverse(), true);
            tLeft.unshift({ level: level + 1, type: 'equal', text: '{' });
            tRight.unshift({ level: level + 1, type: 'equal', text: '{' });
          } else {
            tLeft.unshift({
              level: level + 1,
              type: 'modify',
              text: formatValue(arrLeft[i - 1], undefined, undefined, options.undefinedBehavior),
            });
            tRight.unshift({
              level: level + 1,
              type: 'modify',
              text: formatValue(arrRight[j - 1], undefined, undefined, options.undefinedBehavior),
            });
          }
        } else {
          const reversedLeft = [];
          const reversedRight = [];
          prettyAppendLines(reversedLeft, reversedRight, '', '', arrLeft[i - 1], arrRight[j - 1], level + 1, options);
          tLeft = concat(tLeft, reversedLeft.reverse(), true);
          tRight = concat(tRight, reversedRight.reverse(), true);
        }
        i--;
        j--;
      } else {
        const removedLines = stringify(arrLeft[i - 1], undefined, 1, undefined, options.undefinedBehavior).split('\n');
        for (let k = removedLines.length - 1; k >= 0; k--) {
          tLeft.unshift({
            level: level + 1 + (removedLines[k].match(/^\s+/)?.[0]?.length || 0),
            type: 'remove',
            text: removedLines[k].replace(/^\s+/, '').replace(/,$/g, ''),
          });
          tRight.unshift({ level: level + 1, type: 'equal', text: '' });
        }
        i--;
      }
    } else {
      const addedLines = stringify(arrRight[j - 1], undefined, 1, undefined, options.undefinedBehavior).split('\n');
      for (let k = addedLines.length - 1; k >= 0; k--) {
        tLeft.unshift({ level: level + 1, type: 'equal', text: '' });
        tRight.unshift({
          level: level + 1 + (addedLines[k].match(/^\s+/)?.[0]?.length || 0),
          type: 'add',
          text: addedLines[k].replace(/^\s+/, '').replace(/,$/g, ''),
        });
      }
      j--;
    }
  }

  return [tLeft, tRight];
};

const referenceDiffArrayLCS = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
  linesLeft: DiffResult[] = [],
  linesRight: DiffResult[] = [],
): [DiffResult[], DiffResult[]] => {
  addArrayOpeningBrackets(linesLeft, linesRight, keyLeft, keyRight, level);
  if (level >= (options.maxDepth || Infinity)) {
    addMaxDepthPlaceholder(linesLeft, linesRight, level);
  } else {
    const [tLeftReverse, tRightReverse] = referenceLcs(arrLeft, arrRight, keyLeft, keyRight, level, options);
    linesLeft = concat(linesLeft, tLeftReverse);
    linesRight = concat(linesRight, tRightReverse);
  }
  addArrayClosingBrackets(linesLeft, linesRight, level);
  return [linesLeft, linesRight];
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const diffBothWays = (left: any[], right: any[], options: DifferOptions) => {
  const expected = referenceDiffArrayLCS(left, right, '', '', 0, options);
  const actual = diffArrayLCS(left, right, '', '', 0, options);
  expect(actual).toEqual(expected);
};

describe('diff-array-lcs: linear-memory implementation vs matrix reference', () => {
  it('keeps the duplicate-element alignment ([1, 1] vs [1] removes the first copy)', () => {
    // the most dangerous counterexample: two equal-cost candidates for one
    // match; the matrix path aligns the *second* `1`, a naive divide &
    // conquer split would align the first one instead
    diffBothWays([1, 1], [1], {});
    diffBothWays([1], [1, 1], {});
    diffBothWays([1, 1], [1, 1, 1], { showModifications: true });
  });

  it('keeps equal-cost candidate tie-breaking (up on ties)', () => {
    diffBothWays(['A', 'B'], ['B', 'A'], {});
    diffBothWays(['A', 'B'], ['B', 'A'], { showModifications: false });
    diffBothWays([1, 2, 3], [3, 2, 1], { showModifications: true });
  });

  it('keeps showModifications pairing decisions', () => {
    diffBothWays([5, 6], [5, 9], { showModifications: true });
    diffBothWays([5, 6], [5, 9], { showModifications: false });
    diffBothWays([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }], { showModifications: true });
    diffBothWays([[1, 2], [3, 4]], [[1, 2], [3, 5]], { showModifications: true });
    diffBothWays([1, 'x'], [2, 'y'], { showModifications: true });
  });

  it('matches the reference on randomized nested arrays', () => {
    const rand = mulberry32(0xc0ffee);
    const randValue = (depth: number): any => {
      const pick = rand();
      if (depth <= 0 || pick < 0.4) {
        return Math.floor(rand() * 3);
      }
      if (pick < 0.55) {
        return ['a', 'b'][Math.floor(rand() * 2)];
      }
      if (pick < 0.6) {
        return null;
      }
      if (pick < 0.8) {
        return Array.from({ length: Math.floor(rand() * 4) }, () => randValue(depth - 1));
      }
      const obj: Record<string, any> = {};
      const keys = ['x', 'y', 'z'];
      const count = Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        obj[keys[Math.floor(rand() * 3)]] = randValue(depth - 1);
      }
      return obj;
    };
    const optionsList: DifferOptions[] = [
      {},
      { showModifications: true },
      { showModifications: false },
      { recursiveEqual: true, showModifications: true },
      { recursiveEqual: true, showModifications: false },
    ];
    for (const options of optionsList) {
      for (let t = 0; t < 150; t++) {
        const left = Array.from({ length: Math.floor(rand() * 9) }, () => randValue(3));
        const right = Array.from({ length: Math.floor(rand() * 9) }, () => randValue(3));
        diffBothWays(left, right, options);
      }
    }
  });

  it('matches the reference on duplicate-heavy arrays', () => {
    const rand = mulberry32(0xbeef);
    for (const options of [{}, { showModifications: true }, { recursiveEqual: true }]) {
      for (let t = 0; t < 100; t++) {
        const left = Array.from({ length: Math.floor(rand() * 25) }, () => Math.floor(rand() * 2));
        const right = Array.from({ length: Math.floor(rand() * 25) }, () => Math.floor(rand() * 2));
        diffBothWays(left, right, options);
      }
    }
  });
});
