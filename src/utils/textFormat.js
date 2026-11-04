// Bold, strikethrough and highlight on a text note, shared with the Android app through the note's
// `format` field: "b0-5,s7-9,h10-20" is the style's letter, then where it starts and stops in the text
// (UTF-16 offsets, the same as a JS string index). Port of the app's TextFormat.kt: keep the two alike.

export const STYLES = ['b', 's', 'h'];

// Anything unreadable is skipped, and ranges are held to the text so an old value never points past its end.
export function parseFormat(format, length) {
  if (!format || typeof format !== 'string') return [];
  const spans = [];
  for (const part of format.split(',')) {
    const style = part[0];
    if (!STYLES.includes(style)) continue;
    const [a, b] = part.slice(1).split('-');
    const start = Number.parseInt(a, 10);
    const end = Number.parseInt(b, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    spans.push({ style, start, end });
  }
  return normalize(spans, length);
}

export function formatOf(spans) {
  return spans.map(s => `${s.style}${s.start}-${s.end}`).join(',');
}

// Sorted, inside the text, with no empty ranges, and ranges of one style that touch joined up.
export function normalize(spans, length = Infinity) {
  const out = [];
  for (const style of STYLES) {
    let open = null;
    const own = spans
      .filter(s => s.style === style)
      .map(s => ({ style, start: Math.max(s.start, 0), end: Math.min(s.end, length) }))
      .filter(s => s.end > s.start)
      .sort((x, y) => x.start - y.start);
    for (const span of own) {
      if (open && span.start <= open.end) open = { ...open, end: Math.max(open.end, span.end) };
      else { if (open) out.push(open); open = span; }
    }
    if (open) out.push(open);
  }
  return out.sort((x, y) => x.start - y.start || STYLES.indexOf(x.style) - STYLES.indexOf(y.style));
}

// The styles of the character just in front of pos.
function stylesBefore(spans, pos) {
  return new Set(spans.filter(s => s.start < pos && pos <= s.end).map(s => s.style));
}

// Exactly `styles` over from..to: the others are cut out of it, these are laid over it.
export function setStyles(spans, from, to, styles) {
  if (to <= from) return normalize(spans);
  const kept = spans.flatMap(span => {
    if (styles.has(span.style) || span.end <= from || span.start >= to) return [span];
    const parts = [];
    if (span.start < from) parts.push({ ...span, end: from });
    if (span.end > to) parts.push({ ...span, start: to });
    return parts;
  });
  return normalize([...kept, ...[...styles].map(style => ({ style, start: from, end: to }))]);
}

// What replacing `removed` characters at `at` with `inserted` new ones does to the ranges. A range that
// surrounds the change grows or shrinks with it, one that ends where the change starts stays put, and one
// that starts there moves on. New text takes the styles of the character in front of it.
export function editSpans(spans, at, removed, inserted) {
  const to = at + removed;
  const delta = inserted - removed;
  const moved = spans.map(span => {
    let start;
    if (span.start < at) start = span.start;
    else if (span.start === at) start = removed === 0 ? at + inserted : at;
    else if (span.start < to) start = at + inserted;
    else start = span.start + delta;
    let end;
    if (span.end <= at) end = span.end;
    else if (span.end < to) end = at;
    else end = span.end + delta;
    return { ...span, start, end };
  }).filter(s => s.end > s.start);
  if (removed !== 0 || inserted === 0) return normalize(moved);
  return setStyles(moved, at, at + inserted, stylesBefore(spans, at));
}

// The one edit that turns `before` into `after`: what a textarea change amounts to.
export function diffEdit(before, after) {
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return { at: prefix, removed: before.length - prefix - suffix, inserted: after.length - prefix - suffix };
}

// Where the ranges of `spans` go when the text changes from before to after.
export function followEdit(spans, before, after) {
  if (!spans.length || before === after) return spans;
  const { at, removed, inserted } = diffEdit(before, after);
  return editSpans(spans, at, removed, inserted);
}

// Takes the style off from..to if all of it has it, otherwise puts it on all of it.
export function toggleStyle(spans, from, to, style) {
  if (to <= from) return spans;
  const on = !spans.some(s => s.style === style && s.start <= from && s.end >= to);
  const cut = setStyles(spans.filter(s => s.style === style), from, to, new Set());
  return normalize([...spans.filter(s => s.style !== style), ...cut, ...(on ? [{ style, start: from, end: to }] : [])]);
}

// The text cut into runs that each carry one set of styles, for drawing.
export function runsOf(text, spans) {
  if (!spans.length) return [{ text, styles: '' }];
  const cuts = new Set([0, text.length]);
  for (const s of spans) { cuts.add(Math.min(s.start, text.length)); cuts.add(Math.min(s.end, text.length)); }
  const points = [...cuts].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const styles = STYLES.filter(st => spans.some(s => s.style === st && s.start <= from && s.end >= to)).join('');
    runs.push({ text: text.slice(from, to), styles });
  }
  return runs;
}
