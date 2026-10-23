# Español · Flash Cards

Sean's Spanish study app. Flash cards generated from his lesson notes Google Doc
("Spanish Lessons - Vocab and Phrases"), with Leitner spaced repetition,
per-lesson filtering, and missed-card practice.

**Live:** https://seanlima3.github.io/spanish-study/

## How it works

- `data/deck.json` holds the deck: cards (`Spanish - English` vocab pairs, tagged
  with their lesson date) and per-lesson grammar notes. It's generated from the
  Google Doc and committed.
- Study progress (Leitner box, due date, correct/incorrect counts) lives in each
  browser's localStorage — never in the repo. Stats → Backup can export/import it.
- Cards you miss drop to box 1 and come back right away; cards you keep getting
  right climb to box 5 (reviewed every 14 days).
- Quiz styles: flip cards or multiple choice (distractors drawn from the deck,
  preferring same-lesson cards).
- Notes tab shows lesson grammar notes by topic (via `data/grammar.json`, a
  slug→topic map) or by lesson date.
- "By topic" study mode: type what a quiz covers ("past tense, direct and
  indirect, personal products") or browse topic chips. Cards are tagged ahead
  of time in `data/topics.json` (`byCard`: card id → topic ids); typed text is
  matched against each topic's name and aliases, and anything that isn't a
  topic falls back to a word search of the cards.
- `data/corrections.json` maps raw doc pairs to corrected/merged deck pairs —
  the July 2026 grammar cleanup lives there, and syncs consult it so doc typos
  never re-enter the deck.

## Adding new lesson notes

After a lesson, add notes to the Google Doc as usual, then in Claude Code (in this
repo) say **"sync my spanish notes"**. The `sync-spanish-notes` skill re-reads the
whole doc, appends only new cards/notes (existing cards and progress are never
touched), commits, and pushes — the site redeploys in ~1 min.

Manual fallback: the app's **Import** tab accepts pasted lesson text with the same
parsing + dedup rules.

## Development

No build step — vanilla HTML/CSS/JS.

```
python3 -m http.server 8000   # then open http://localhost:8000
```

- `js/srs.js` — Leitner scheduling (pure functions)
- `js/parser.js` — lesson-text parser used by the Import tab
- `js/app.js` — UI and session logic
- `scripts/sync_deck.py` — doc → deck.json merge (idempotent; same rules as parser.js)

Bump the `?v=N` query on css/js tags in `index.html` when changing styles/scripts
(cache busting, same convention as the band site).
