import { describe, it, expect } from 'vitest';
import { findOffsets, markRuns } from '../findInNote';
import { runsOf } from '../textFormat';

describe('findInNote', () => {
  it('finds hits ignoring case, without overlap', () => {
    expect(findOffsets('Rain rain RAIN', 'rain')).toEqual([0, 5, 10]);
    expect(findOffsets('aaaa', 'aa')).toEqual([0, 2]);
    expect(findOffsets('abc', '')).toEqual([]);
    expect(findOffsets('abc', 'x')).toEqual([]);
  });

  it('marks hits and the one in focus, keeping styles', () => {
    const runs = runsOf('one two one', [{ style: 'b', start: 0, end: 7 }]);
    const marked = markRuns(runs, findOffsets('one two one', 'one'), 3, 1);
    expect(marked.map(m => m.text).join('')).toBe('one two one');
    expect(marked.filter(m => m.hit === 1).map(m => m.text)).toEqual(['one']);
    const focus = marked.filter(m => m.hit === 2);
    expect(focus.map(m => m.text)).toEqual(['one']);
    expect(focus[0].styles).toBe('');
    expect(marked[0]).toEqual({ text: 'one', styles: 'b', hit: 1 });
  });

  it('marks a hit that spans a style edge as two pieces', () => {
    const runs = runsOf('abcdef', [{ style: 'h', start: 0, end: 3 }]);
    const marked = markRuns(runs, [2], 3, 0);
    expect(marked.filter(m => m.hit === 2).map(m => m.text)).toEqual(['c', 'de']);
  });
});
