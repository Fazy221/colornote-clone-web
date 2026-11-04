import { describe, it, expect } from 'vitest';
import { parseFormat, formatOf, followEdit, toggleStyle, runsOf } from '../textFormat';

describe('textFormat', () => {
  it('reads and writes the format string the Android app stores', () => {
    const spans = parseFormat('b0-5,h10-20', 30);
    expect(spans).toEqual([{ style: 'b', start: 0, end: 5 }, { style: 'h', start: 10, end: 20 }]);
    expect(formatOf(spans)).toBe('b0-5,h10-20');
  });

  it('skips anything unreadable and holds ranges to the text', () => {
    expect(parseFormat('x1-2,b3,bq-4,b2-99', 10)).toEqual([{ style: 'b', start: 2, end: 10 }]);
    expect(parseFormat('', 5)).toEqual([]);
    expect(parseFormat(undefined, 5)).toEqual([]);
  });

  it('moves ranges along as text is typed before them', () => {
    const spans = parseFormat('b6-11', 11);
    expect(formatOf(followEdit(spans, 'hello world', 'oh hello world'))).toBe('b9-14');
  });

  it('grows a range when typing inside it, and not when typing right after it', () => {
    const spans = parseFormat('b0-5', 11);
    expect(formatOf(followEdit(spans, 'hello world', 'hellooo world'))).toBe('b0-7');
    // Typing right after the range takes the styles of the character in front of it, as in the app.
    expect(formatOf(followEdit(spans, 'hello world', 'hello! world'))).toBe('b0-6');
  });

  it('drops a range whose text was deleted', () => {
    expect(followEdit(parseFormat('b0-5', 11), 'hello world', ' world')).toEqual([]);
  });

  it('toggles a style on a selection', () => {
    const on = toggleStyle([], 2, 6, 'h');
    expect(formatOf(on)).toBe('h2-6');
    expect(toggleStyle(on, 2, 6, 'h')).toEqual([]);
  });

  it('cuts the text into runs for drawing', () => {
    const runs = runsOf('abcdef', parseFormat('b0-3,h2-5', 6));
    expect(runs).toEqual([
      { text: 'ab', styles: 'b' },
      { text: 'c', styles: 'bh' },
      { text: 'de', styles: 'h' },
      { text: 'f', styles: '' },
    ]);
  });
});
