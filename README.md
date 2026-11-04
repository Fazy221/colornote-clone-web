# ColorNote web / desktop

Personal, single-user ColorNote clone: React 18, Vite 5, MUI 5, zustand, Dexie (IndexedDB) with a Firestore
sync. It is the desktop half of one product; the phone half is `../124.colornote-android`, on the **same
Firestore**.

## Both apps (read this before any user-facing change)

The web/desktop app and the Android app are one product. Every feature, fix, label, menu order, colour and
dark-mode rule is built for **both**, in the same round, unless the owner says otherwise. Before saying a change
is done, answer: "Does the other app do the same thing?" (The Android repo's `CLAUDE.md` has the same rule.)

Things that already drifted once, so check them every time:

- Bottom navigation order and the menu entries of each screen.
- Dialogs that exist on one side only (the modified-date picker, the calendar's date picker).
- Dark mode: every screen, including the note editor, dialogs, menus and inputs.
- Rules that live in two places and carry a comment pointing at the other copy, so **change both**:
  version history rules (`src/utils/versions.js` here, `NoteVersions.kt` there), the modified-date merge
  (`src/sync/merge.js`, `SyncLogic.mergeNotes`), locked-note encryption (`src/utils/crypto.js`, `NoteCrypto.kt`,
  and `mcp-server/src/crypto.js`), colour tables.
- The Firestore contract (`users/{uid}/notes/{uuid}`, `.../versions/{id}`, `meta/appSettings`).

A UI/UX audit between the two apps is a separate job; its starter prompt is in
[docs/ui-ux-audit-prompt.md](docs/ui-ux-audit-prompt.md).

## Rules (the owner's)

- Diary text never goes into logs, scripts, chat, docs or test output. Tests use invented notes only.
- The deploy is the owner's (`npm run deploy`). Do not run it.
- Run `vitest` one file at a time (`npx vitest run src/utils/versions.test.js`), then `npx vite build`.

## Commands

```bash
npm run dev      # local dev server (sign in with Google)
npm test         # vitest, all files
npm run build    # production build into dist/
npm run deploy   # build + firebase deploy --only hosting (owner only)
```

## Where things are

| Path | What |
|---|---|
| `src/screens/` | One file per screen (notes, calendar, folders, note editor, settings...). |
| `src/components/` | Shared UI: bottom nav, dialogs, note cards, `notes/VersionHistoryDialog.jsx`, `common/DatePickerDialog.jsx`. |
| `src/store/noteStore.js` | All note changes (zustand). The place to add a new action. |
| `src/db/` | Dexie schema (`database.js`, v4 includes `versions`) and `versionLog.js` (recording versions). |
| `src/sync/` | Firestore sync: `notesSync.js`, `merge.js`. |
| `src/utils/` | `crypto.js` (locked notes), `versions.js` (history rules), `colors.js`. |
| `src/theme.js` | MUI light and dark themes. Check dark mode here first. |
| `mcp-server/` | Read-only MCP server so Claude Code can read the diary, locked notes included. See [mcp-server/README.md](mcp-server/README.md). |

## Version history (both apps)

Every change to a note (title, text, colour, folder, the modified date) is kept in
`users/{uid}/notes/{uuid}/versions/{versionId}`, grouped by day in an accordion on both apps, with Restore.
Edits on one device within 5 minutes join one version; at most 200 per note, the first "Original" is never pruned;
locked notes keep ciphertext and show no preview. The Firestore rules must allow the owner to read and write the
`versions` subcollection (snippet in `mcp-server/README.md`).

## MCP server

`mcp-server/` is a separate small Node package (`npm install` inside it). Setup: `mcp-server/README.md`.
