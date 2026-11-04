import { describe, it, expect } from 'vitest';
import { getColor, NOTE_COLORS } from '../colors';

describe('getColor', () => {
  it('in light mode returns the note colour, with the bar the same as the page', () => {
    expect(getColor(1)).toMatchObject({ bg: NOTE_COLORS[1].bg, bar: NOTE_COLORS[1].bg });
  });

  it('in dark mode keeps every note on a dark page, with its colour in the bar and swatch', () => {
    const pages = new Set();
    for (let i = 0; i < 10; i++) {
      const c = getColor(i, true);
      pages.add(c.bg);
      expect(c.text).toBe('#E0E0E0');
      expect(c.bar).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect([...pages]).toEqual(['#101010']);
    expect(getColor(1, true).bar).not.toBe(getColor(2, true).bar);
  });

  it('treats an unknown colour index as None in both modes', () => {
    expect(getColor(99).bg).toBe(NOTE_COLORS[0].bg);
    expect(getColor(99, true).bar).toBe(getColor(0, true).bar);
  });
});
