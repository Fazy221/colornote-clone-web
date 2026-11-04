// Find in note, same rules as the Android app's findOffsets: case-insensitive, hits never overlap.
export function findOffsets(text, query) {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const hits = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return hits;
    hits.push(at);
    from = at + needle.length;
  }
}

// Cuts styled runs (see runsOf) at the hit edges, for drawing. `hit` is 0 for plain text,
// 1 for a hit, 2 for the hit in focus.
export function markRuns(runs, hits, length, current) {
  if (!hits.length) return runs.map(r => ({ ...r, hit: 0 }));
  const out = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    let at = pos;
    while (at < end) {
      const i = hits.findIndex(h => h + length > at);
      const h = i < 0 ? -1 : hits[i];
      if (i >= 0 && h <= at) {
        const to = Math.min(end, h + length);
        out.push({ text: run.text.slice(at - pos, to - pos), styles: run.styles, hit: i === current ? 2 : 1 });
        at = to;
      } else {
        const to = i < 0 ? end : Math.min(end, h);
        out.push({ text: run.text.slice(at - pos, to - pos), styles: run.styles, hit: 0 });
        at = to;
      }
    }
    pos = end;
  }
  return out;
}
