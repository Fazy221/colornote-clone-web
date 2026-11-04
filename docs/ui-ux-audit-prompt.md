# Starter prompt: UI/UX consistency audit between the phone and desktop apps

Paste everything below the line into a **new** session (working directory
`D:\Business Workspace\Current Projects\Color Note`). It is an audit that reports; it changes no code.
Suggested model: the top model at high effort (it is open-ended reading and judgement, not mechanical).

---

I own two apps that are one product on one Firestore: the Android app (`124.colornote-android`, Kotlin and
Compose) and the web/desktop app (`124.colornote-web`, React and MUI). They are meant to behave and look the
same, apart from layout that suits a bigger screen. They have drifted: for example the desktop bottom navigation
had Calendar and Folders in the opposite order to the phone, and the desktop calendar had no date picker.
I want a list of every such inconsistency, so I can decide what to fix.

**Your job: find and report. Do not change any code, do not commit, do not start other sessions or subagents.**

Read first: both repos' `CLAUDE.md` / `README.md` ("Both apps" section), and the Android `docs/ui-decisions.md`
(what was matched to the real ColorNote app, what was a guess). The real app's reference screenshots are in
`124.1.colornote-wip\17 May Screens\`; use them only to judge which side is closer to the real app, and never
copy any note titles, emails or colour names from them into your report.

**How to audit** (code reading; the web preview is behind Google sign-in, so do not try to drive it, and do
not launch anything on the phone):

1. List every screen and dialog on each side from the code (Android: `app/src/main/java/com/faizan/colornote/ui/`,
   web: `src/screens/` and `src/components/`). Build a table: screen or dialog, present on phone, present on
   desktop. Anything on only one side is a finding unless it is clearly platform-specific (back button, share
   sheet, keyboard shortcuts, install prompt).
2. For each screen that exists on both, compare: the order and labels of menu entries, bottom navigation, toolbar
   icons and their order, empty-state text, button labels and order in dialogs (OK/CANCEL), confirmation wording,
   sort and filter options, default sort, what a tap, long-press or click does, which fields a note shows, date and
   time formats, plurals ("1 edit" / "2 edits"), capitalisation, and error and offline messages.
3. Colours and themes: the note colour table (names, values, the 10 colour labels), folder colours and icons,
   light theme and dark theme on every screen and dialog (backgrounds, text, inputs, icons, menus, top bars,
   the note editor, selection and highlight styles, rule lines in text notes).
4. Behaviour that should match: autosave and when the modified date changes, the modified-date picker, version
   history (grouping, wording, restore), locked notes (lock, unlock, search, preview hiding), archive and trash,
   pinning, checklist behaviour (reorder, check, delete), the calendar (date pick, note dots, "go to today"),
   search (what it searches, locked notes), backup import, sync status and conflict handling.
5. Settings: every setting on each side, its label, its default, and whether changing it on one device is
   respected on the other through `meta/appSettings`.
6. Data parity: fields that one app writes to Firestore and the other ignores or drops (round-trip a mental
   note through both apps; look for lost fields).

**Report format**, in the chat, plus a copy saved as `docs/ui-audit-<today's date>.md` in the web repo:

- A summary line: how many findings, how many are "bug", "drift" and "intentional difference".
- A table, one row per finding: id, screen, what the phone does, what the desktop does, which is closer to the
  real ColorNote app (or "unknown"), severity (bug / drift / cosmetic), and a suggested fix in one sentence
  naming the file on the side that should change.
- Findings sorted by severity, then by how often the owner sees the screen.
- A short list of "looks different but probably intentional" so I can confirm it.
- A list of what you could not check from code alone and need a screenshot or the phone for.

Rules: diary text never goes into the report, logs or screenshots; use invented notes if you need an example.
State plainly what is a guess. Keep the closing message short: lead with the count and the three most important
findings.
