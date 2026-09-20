import Differ from './differ';
import { lcsMemoryStats } from './utils/lcs-ops';

const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const digestOf = (result: ReturnType<Differ['diff']>) =>
  fnv1a(result.map(lines => lines.map(line => JSON.stringify(line)).join('\n')).join('\n'));

describe('lcs array diff: char-for-char snapshots of existing fixtures', () => {
  it('object with empty string key', () => {
    const d = new Differ();
    expect(d.diff({ '': 'before', a: 1 }, { '': 'after', b: 2 })).toMatchSnapshot();
  });

  it('object key order is preserved', () => {
    const d = new Differ();
    expect(d.diff({ a: 1, b: 2, c: 3 }, { c: 3, b: 2, d: 4, a: 1 })).toMatchSnapshot();
  });

  it('recursive equal on reordered object array', () => {
    const l = [
      { id: '1', x: 'a' },
      { id: '2', x: 'b' },
    ];
    const r = [
      { id: '2', x: 'b' },
      { id: '1', x: 'a' },
    ];
    const d = new Differ({ recursiveEqual: true, arrayDiffMethod: 'lcs' });
    expect(d.diff(l, r)).toMatchSnapshot();
  });

  it('2-dimensional array with lcs and showModifications', () => {
    const l = [[1, 2, 3, 4], [5, 6], [9]];
    const r = [[1, 2, 4], [5, 9], [9]];
    const d = new Differ({ arrayDiffMethod: 'lcs', showModifications: true });
    expect(d.diff(l, r)).toMatchSnapshot();
  });

  it('2-dimensional array with lcs, modifications hidden', () => {
    const l = [[1, 2, 3, 4], [5, 6], [9]];
    const r = [[1, 2, 4], [5, 9], [9]];
    const d = new Differ({ arrayDiffMethod: 'lcs', showModifications: false });
    expect(d.diff(l, r)).toMatchSnapshot();
  });
});

describe('lcs array diff: the four stressed data groups', () => {
  it('all-equal arrays produce only equal lines', () => {
    const value = { id: 1, tags: ['a', 'b'] };
    const l = Array.from({ length: 40 }, () => JSON.parse(JSON.stringify(value)));
    const r = Array.from({ length: 40 }, () => JSON.parse(JSON.stringify(value)));
    const d = new Differ({ arrayDiffMethod: 'lcs' });
    const result = d.diff(l, r);
    expect(result).toMatchSnapshot();
    expect(result[0].every(line => line.type === 'equal')).toBe(true);
    expect(result[1].every(line => line.type === 'equal')).toBe(true);
  });

  it('all-different arrays produce only removals and additions', () => {
    const l = Array.from({ length: 40 }, (_, i) => i);
    const r = Array.from({ length: 30 }, (_, i) => i + 100);
    const d = new Differ({ arrayDiffMethod: 'lcs' });
    const result = d.diff(l, r);
    expect(result).toMatchSnapshot();
    expect(result[0].filter(line => line.type === 'remove')).toHaveLength(40);
    expect(result[1].filter(line => line.type === 'add')).toHaveLength(30);
  });

  it('alternating repeats keep the deterministic alignment', () => {
    const l = Array.from({ length: 61 }, (_, i) => i % 2);
    const r = Array.from({ length: 60 }, (_, i) => (i + 1) % 2);
    const d = new Differ({ arrayDiffMethod: 'lcs' });
    expect(d.diff(l, r)).toMatchSnapshot();
    const dMod = new Differ({ arrayDiffMethod: 'lcs', showModifications: true });
    expect(dMod.diff(l, r)).toMatchSnapshot();
  });

  it('12k-element arrays stay linear-memory and render identically', () => {
    const size = 12000;
    const l = Array.from({ length: size }, (_, i) => i % 7);
    const r = Array.from({ length: size }, (_, i) => (i + 3) % 7);
    const d = new Differ({ arrayDiffMethod: 'lcs' });
    lcsMemoryStats.reset();
    const result = d.diff(l, r);
    const peak = lcsMemoryStats.peakArrayLength;
    // recorded for the changelog: peak auxiliary array length vs. the cell
    // count of the historical matrix
    expect({
      peakArrayLength: peak,
      matrixCells: (size + 1) * (size + 1),
      leftLines: result[0].length,
      rightLines: result[1].length,
      digest: digestOf(result),
    }).toMatchSnapshot();
    expect(peak).toBeLessThanOrEqual(4 * (2 * size + 2));
    expect(peak).toBeLessThan((size + 1) * (size + 1) / 100);
    expect(result[0].length).toBe(result[1].length);
    // 3 of 12000 elements are realigned, everything else stays equal
    expect(result[0].filter(line => line.type === 'remove')).toHaveLength(3);
    expect(result[1].filter(line => line.type === 'add')).toHaveLength(3);
  }, 120000);
});
