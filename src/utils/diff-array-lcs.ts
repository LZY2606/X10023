import type { DifferOptions, DiffResult } from '../differ';
import formatValue from './format-value';
import diffObject from './diff-object';
import getType from './get-type';
import stringify from './stringify';

import isEqual from './is-equal';
import concat from './concat';
import prettyAppendLines from './pretty-append-lines';
import lcsOps from './lcs-ops';
import { addArrayClosingBrackets, addArrayOpeningBrackets, addMaxDepthPlaceholder } from './array-bracket-utils';

const lcs = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
): [DiffResult[], DiffResult[]] => {
  // The alignment is computed by `lcsOps` with linear auxiliary memory; the
  // returned op sequence is bit-identical to the historical full-matrix
  // backtracking path, so every rendering decision below is preserved.
  const ops = lcsOps(arrLeft, arrRight, options);
  let i = arrLeft.length;
  let j = arrRight.length;
  let tLeft: DiffResult[] = [];
  let tRight: DiffResult[] = [];
  // this is a backtracking process, all new lines should be unshifted to the result, not
  // pushed to the result
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op === 'diag') {
      const type = getType(arrLeft[i - 1]);
      if (
        options.recursiveEqual &&
        (type === 'array' || type === 'object') &&
        isEqual(arrLeft[i - 1], arrRight[j - 1], options)
      ) {
        const reversedLeft = [];
        const reversedRight = [];
        prettyAppendLines(
          reversedLeft,
          reversedRight,
          '',
          '',
          arrLeft[i - 1],
          arrRight[j - 1],
          level + 1,
          options,
        );
        tLeft = concat(tLeft, reversedLeft.reverse(), true);
        tRight = concat(tRight, reversedRight.reverse(), true);
      } else if (type === 'array') {
        const [l, r] = diffArrayLCS(arrLeft[i - 1], arrRight[j - 1], keyLeft, keyRight, level + 1, options);
        tLeft = concat(tLeft, l.reverse(), true);
        tRight = concat(tRight, r.reverse(), true);
      } else if (type === 'object') {
        const [l, r] = diffObject(arrLeft[i - 1], arrRight[j - 1], level + 2, options, diffArrayLCS);
        tLeft.unshift({ level: level + 1, type: 'equal', text: '}' });
        tRight.unshift({ level: level + 1, type: 'equal', text: '}' });
        tLeft = concat(tLeft, l.reverse(), true);
        tRight = concat(tRight, r.reverse(), true);
        tLeft.unshift({ level: level + 1, type: 'equal', text: '{' });
        tRight.unshift({ level: level + 1, type: 'equal', text: '{' });
      } else {
        const reversedLeft = [];
        const reversedRight = [];
        prettyAppendLines(
          reversedLeft,
          reversedRight,
          '',
          '',
          arrLeft[i - 1],
          arrRight[j - 1],
          level + 1,
          options,
        );
        tLeft = concat(tLeft, reversedLeft.reverse(), true);
        tRight = concat(tRight, reversedRight.reverse(), true);
      }
      i--;
      j--;
    } else if (op === 'up') {
      // `ops[k + 1]` is the step the matrix algorithm would have read from
      // `backtrack[i - 1][j]`, so the modification-pairing check is unchanged.
      if (options.showModifications && i > 1 && ops[k + 1] === 'left') {
        const typeLeft = getType(arrLeft[i - 1]);
        const typeRight = getType(arrRight[j - 1]);
        if (typeLeft === typeRight) {
          if (typeLeft === 'array') {
            const [l, r] = diffArrayLCS(arrLeft[i - 1], arrRight[j - 1], keyLeft, keyRight, level + 1, options);
            tLeft = concat(tLeft, l.reverse(), true);
            tRight = concat(tRight, r.reverse(), true);
          } else if (typeLeft === 'object') {
            const [l, r] = diffObject(arrLeft[i - 1], arrRight[j - 1], level + 2, options, diffArrayLCS);
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
          prettyAppendLines(
            reversedLeft,
            reversedRight,
            '',
            '',
            arrLeft[i - 1],
            arrRight[j - 1],
            level + 1,
            options,
          );
          tLeft = concat(tLeft, reversedLeft.reverse(), true);
          tRight = concat(tRight, reversedRight.reverse(), true);
        }
        i--;
        j--;
        // the modification pairing consumes the paired `left` step as well,
        // exactly like the matrix walk skipping over `backtrack[i - 1][j]`
        k++;
      } else {
        const removedLines = stringify(arrLeft[i - 1], undefined, 1, undefined, options.undefinedBehavior).split('\n');
        for (let i = removedLines.length - 1; i >= 0; i--) {
          tLeft.unshift({
            level: level + 1 + (removedLines[i].match(/^\s+/)?.[0]?.length || 0),
            type: 'remove',
            text: removedLines[i].replace(/^\s+/, '').replace(/,$/g, ''),
          });
          tRight.unshift({ level: level + 1, type: 'equal', text: '' });
        }
        i--;
      }
    } else {
      const addedLines = stringify(arrRight[j - 1], undefined, 1, undefined, options.undefinedBehavior).split('\n');
      for (let i = addedLines.length - 1; i >= 0; i--) {
        tLeft.unshift({ level: level + 1, type: 'equal', text: '' });
        tRight.unshift({
          level: level + 1 + (addedLines[i].match(/^\s+/)?.[0]?.length || 0),
          type: 'add',
          text: addedLines[i].replace(/^\s+/, '').replace(/,$/g, ''),
        });
      }
      j--;
    }
  }

  return [tLeft, tRight];
};

const diffArrayLCS = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
  linesLeft: DiffResult[] = [],
  linesRight: DiffResult[] = [],
): [DiffResult[], DiffResult[]] => {
  addArrayOpeningBrackets(linesLeft, linesRight, keyLeft, keyRight, level)

  if (level >= (options.maxDepth || Infinity)) {
    addMaxDepthPlaceholder(linesLeft, linesRight, level);
  } else {
    const [tLeftReverse, tRightReverse] = lcs(arrLeft, arrRight, keyLeft, keyRight, level, options);
    linesLeft = concat(linesLeft, tLeftReverse);
    linesRight = concat(linesRight, tRightReverse);
  }

  addArrayClosingBrackets(linesLeft, linesRight, level)
  return [linesLeft, linesRight];
};

export default diffArrayLCS;
