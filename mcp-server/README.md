# ColorNote MCP server (desktop only, read-only)

Lets Claude Code read the diary: list, open, search and count notes, see folders, and read each note's
version history. **Locked notes are included** and come back decrypted. It never writes.

It reads the same Firestore the apps use (`users/{uid}/notes`, `.../versions`, `meta/appSettings`).
Locked notes are decrypted in memory with ColorNote's fixed built-in key (the same one the web app and the
phone use; it is not your master password, which this server never sees). Nothing is written to disk and
nothing is printed to a log.

## Tools

| Tool | What it does |
|---|---|
| `list_notes` | Notes with a short preview. Filters: state (normal / archived / trash / any), type, colour, folder, locked, pinned, calendar date, modified and created date ranges. Sort and paging. |
| `get_note` | One note in full (title, complete text, checklist items, colour, folder, dates, reminder). `uuid` can be a unique prefix. |
| `search_notes` | Every word must appear in the title or text, locked notes included. Returns snippets. Same filters as `list_notes`. |
| `list_folders` | Folders and colour names, with how many notes each holds. |
| `get_note_versions` | The version history of a note, grouped by day, newest first, with the text as it was. |
| `stats` | Counts by state, type, colour, folder, year, locked, pinned. |

All six are marked read-only.

## Setup (once)

1. **Make a read-only service account.** Firebase console, Project settings, Service accounts, "Manage
   service account permissions" (opens Google Cloud). Create a service account named `colornote-reader` and
   give it **only** the role **Cloud Datastore Viewer**. That role cannot write, so even a bug here cannot
   change your notes.
2. **Create a key** for it (Keys, Add key, JSON). Save the file **outside this repo and outside any synced
   folder**, for example `D:\Secrets\colornote-reader.json`. Anyone holding this file can read your whole diary,
   locked notes included. Never commit it.
3. **Find your uid**: Firebase console, Authentication, Users, "User UID". (Optional: with exactly one user the
   server finds it itself.)
4. **Install** (once): `cd mcp-server` then `npm install`.
5. **Register it with Claude Code.** From any folder:

```bash
claude mcp add colornote --scope user -e GOOGLE_APPLICATION_CREDENTIALS=D:/Secrets/colornote-reader.json -e COLORNOTE_UID=<your uid> -- node "D:/Business Workspace/Current Projects/Color Note/124.colornote-web/mcp-server/src/server.js"
```

Or by hand in `.mcp.json` / `~/.claude.json`:

```json
{
  "mcpServers": {
    "colornote": {
      "command": "node",
      "args": ["D:/Business Workspace/Current Projects/Color Note/124.colornote-web/mcp-server/src/server.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "D:/Secrets/colornote-reader.json",
        "COLORNOTE_UID": "<your uid>"
      }
    }
  }
}
```

Restart Claude Code, then ask something like "how many locked notes do I have?" or "search my notes for
harbour".

| Variable | Needed | Meaning |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | yes | Path to the service-account key. |
| `COLORNOTE_UID` | optional | The Firebase uid to read. Without it the server uses the only user it finds, and errors if there are several. |
| `GCLOUD_PROJECT` | optional | Project id, when the key file does not name it. |

## Things to know

- Anything a tool returns goes into the Claude Code conversation, so diary text (locked notes too) is sent to
  Anthropic in that session. That is the point of the tool, but only connect it in sessions where you are
  happy with that.
- Data is cached for 30 seconds, so a burst of questions reads Firestore once. Edits made in the apps show
  up within half a minute.
- Version history needs the Firestore rule below deployed, and only exists for edits made after the version
  history round shipped. Older notes have none.
- A locked note whose data cannot be decrypted comes back with `decryptError` set and empty text. It never
  crashes the other tools.
- Search and the previews of locked notes decrypt in memory on every request; nothing decrypted is stored.

## Firestore rule for version history (you deploy this)

The apps now read and write `users/{uid}/notes/{noteId}/versions/{versionId}`. In the Firebase console, Firestore
Database, Rules, check that the signed-in owner may use the `versions` subcollection. If your rules already
use a recursive wildcard for the user's own data, nothing changes. If they list collections one by one, add:

```
match /users/{uid}/notes/{noteId}/versions/{versionId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

The server does not need a rule: the service account reads through IAM, not through these rules.

## Tests

```bash
npm test
```

23 tests with invented notes and a fake store, no network: the Node decryption reads what the web app
encrypts, filters, search (locked notes included, past the 200-note list cap), version grouping, the tools over
a real in-memory MCP connection, and a scan that fails if any source file calls a Firestore write.

## Keeping it in step

This is part of the web repo. If the note format changes (a new field, a new state, a change to locked-note
encryption), change `src/notes.js` and `src/crypto.js` with it, and the phone's `NoteCrypto.kt`. The encryption
test imports the web app's own `src/utils/crypto.js`, so the two cannot drift silently.
