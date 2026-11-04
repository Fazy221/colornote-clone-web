#!/usr/bin/env node
// ColorNote MCP server: read-only, stdio. Locked notes are decrypted in memory and returned like any other.
// Setup is in ../README.md. Environment:
//   GOOGLE_APPLICATION_CREDENTIALS  path to the service-account key (role: Cloud Datastore Viewer only)
//   COLORNOTE_UID                   the Firebase uid to read (optional when there is exactly one user)
//   GCLOUD_PROJECT                  the Firebase project id (optional when the key file names it)

import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NoteStore } from './store.js';
import { filterNotes, searchNotes, summarise, fullNote, noteStats } from './notes.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const filterShape = {
  state: z.enum(['normal', 'archived', 'trash', 'any']).optional().describe("Default 'normal' (the notes list). 'archived' and 'trash' are the other lists; 'any' is all three."),
  type: z.enum(['text', 'checklist']).optional(),
  colorIndex: z.number().int().min(0).max(9).optional().describe('0 none, 1 red, 2 orange, 3 yellow, 4 green, 5 blue, 6 purple, 7 dark, 8 gray, 9 light'),
  folder: z.string().optional().describe('Folder name (case-insensitive). See list_folders.'),
  folderId: z.number().int().optional().describe('Folder id; 0 means notes with no folder.'),
  locked: z.boolean().optional().describe('Only locked (true) or only unlocked (false) notes.'),
  pinned: z.boolean().optional(),
  calendarDate: day.optional().describe('Notes placed on this calendar day (the calendar screen).'),
  modifiedFrom: day.optional().describe('Modified on or after this local day.'),
  modifiedTo: day.optional().describe('Modified on or before this local day.'),
  createdFrom: day.optional(),
  createdTo: day.optional(),
};

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

// Wrap a handler so a Firestore or setup error becomes a readable tool error, not a crash.
const guarded = (fn) => async (args) => {
  try {
    return await fn(args ?? {});
  } catch (e) {
    return fail(`${e?.code ? `[${e.code}] ` : ''}${e?.message ?? 'Unknown error'}`);
  }
};

// Every tool only reads. The store is passed in so the tests can use invented notes.
export function buildServer(store) {
  const server = new McpServer({ name: 'colornote', version: '1.0.0' });

  server.registerTool('list_notes', {
    description: 'List notes (newest modified first by default) with a short preview, not the full text. Locked notes are included and their previews are decrypted. Use get_note for the full text.',
    inputSchema: {
      ...filterShape,
      sort: z.enum(['modified', 'created', 'title']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
      offset: z.number().int().min(0).optional(),
      previewLength: z.number().int().min(0).max(1000).optional().describe('Characters of preview, default 160.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async ({ previewLength, ...f }) => {
    const { notes } = await store.allNotes();
    const page = filterNotes(notes, f);
    return ok({ total: page.total, offset: page.offset, returned: page.notes.length, notes: page.notes.map((n) => summarise(n, previewLength ?? 160)) });
  }));

  server.registerTool('get_note', {
    description: 'One note in full: title, complete text (decrypted when locked), checklist items, colour, folder, dates, reminder. uuid may be a unique prefix.',
    inputSchema: { uuid: z.string().min(4) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async ({ uuid }) => {
    const note = await store.getNote(uuid);
    return note ? ok(fullNote(note)) : fail(`No single note matches "${uuid}".`);
  }));

  server.registerTool('search_notes', {
    description: 'Find notes whose title or text contains every word of the query (case-insensitive), locked notes included. Returns snippets around the matches, newest modified first. Accepts the same filters as list_notes.',
    inputSchema: {
      query: z.string().min(1),
      ...filterShape,
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
      offset: z.number().int().min(0).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async ({ query, ...f }) => {
    const { notes } = await store.allNotes();
    return ok(searchNotes(notes, query, f));
  }));

  server.registerTool('list_folders', {
    description: 'The folders and the colour names the owner set up, with how many notes each holds (normal notes only).',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async () => {
    const { notes, ctx } = await store.allNotes();
    const live = notes.filter((n) => n.state === 'normal');
    return ok({
      folders: ctx.folders.map((f) => ({ id: f.id, name: f.name, color: f.color ?? null, notes: live.filter((n) => n.folder?.id === f.id).length })),
      withoutFolder: live.filter((n) => !n.folder).length,
      colorNames: ctx.colorNames.map((name, index) => ({ index, name: name || null, notes: live.filter((n) => n.color.index === index).length })),
    });
  }));

  server.registerTool('get_note_versions', {
    description: "A note's version history, newest first, grouped by day like the apps show it. Each version has the full title and text as it was (decrypted when locked), what changed, which device, and when. kind: edit, date (modified date changed), restore, baseline (the original).",
    inputSchema: { uuid: z.string().min(4), includeText: z.boolean().optional().describe('Default true. Set false for just the timeline.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async ({ uuid, includeText }) => {
    const found = await store.versions(uuid);
    if (!found) return fail(`No single note matches "${uuid}".`);
    const strip = includeText === false;
    const days = found.days.map((d) => ({
      ...d,
      versions: d.versions.map((v) => (strip ? { ...v, text: undefined, items: undefined } : v)),
    }));
    return ok({ uuid: found.note.uuid, title: found.note.title, versionCount: found.count, days });
  }));

  server.registerTool('stats', {
    description: 'Counts across the whole diary: by state, type, colour, folder, year last modified, locked, pinned.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async () => ok(noteStats((await store.allNotes()).notes))));

  return server;
}

async function main() {
  const store = new NoteStore({ uid: process.env.COLORNOTE_UID, projectId: process.env.GCLOUD_PROJECT });
  const server = buildServer(store);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('colornote-mcp failed to start:', e?.message ?? e);
    process.exit(1);
  });
}
