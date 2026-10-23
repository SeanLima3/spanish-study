---
name: sync-spanish-notes
description: Sync Sean's Spanish lesson notes from his Google Doc into the flash card app's deck (data/deck.json), then deploy. Use when Sean says "sync my spanish notes" or asks to pull in new lesson material.
---

# Sync Spanish notes

Pull the latest lesson notes from Sean's Google Doc into `data/deck.json`, review what changed, and push so GitHub Pages redeploys.

## Steps

1. **Read the doc** with the Google Drive MCP tool `read_file_content`, fileId `1j6L1aXgVEmpZXWei-SUVbfBnp-BjLgd8BIGN3GKnnE0` ("Spanish Lessons - Vocab and Phrases"). The result is JSON `{fileContent: string}`; extract `fileContent` with jq and save it as plain text to a scratchpad file, e.g. `doc.txt`.

2. **Run the sync script** from the repo root:
   ```
   python3 scripts/sync_deck.py <path-to-doc.txt> data/deck.json
   ```
   It is an idempotent merge: existing cards and notes are never modified or removed (card ids anchor Sean's progress in localStorage), only new material is appended. Re-running adds nothing.

3. **Review the output with judgment.** The script prints every new card, new note, and skipped line:
   - Skipped lines that are actually vocab (e.g. a real word that matched a task-line pattern) → add them via `CARD_OVERRIDES` in the script, or adjust `SKIP_RE`, and re-run.
   - New "cards" that are actually grammar rules/mnemonics → move to `NOTE_OVERRIDES` and re-run (delete the bad card from deck.json first if it was already written).
   - A lesson date that looks wrong (out of order with its neighbors, or in the future) is probably a typo in the doc — add a mapping to `DATE_FIXES`, fix the deck, and tell Sean so he can correct the doc.

4. **File new notes into grammar topics.** `data/grammar.json` maps note slugs to the topics shown in the app's Notes → "By topic" view (`{"topicOrder": [...], "bySlug": {slug: topic}}`). For each NEW note the sync added, compute its slug (lowercase, strip accents, non-alphanumerics → `-`, trim to 60 chars — same as `slugify` in `scripts/sync_deck.py`) and add a `bySlug` entry, choosing the best-fitting topic from `topicOrder` with judgment (his own practice sentences → "Example sentences"; anything that fits nothing → "More tips"). Don't invent new topics without asking Sean.

5. **Fix obvious grammar/spelling slips** in new cards (missing accents, `¿…?` on questions, typos), keeping his wording otherwise. Any fix that changes the text also needs a `pair_corrections` entry in `data/corrections.json` (key = `slug(raw_es)::slug(raw_en)` of the ORIGINAL doc text, value = `[corrected_es, corrected_en]`) so the next sync doesn't re-add the uncorrected line. Accent-only or capitalization-only fixes don't strictly need an entry (slugs strip accents/case) but adding one is harmless. Do this before tagging: a correction changes the card’s id (ids come from the corrected Spanish), so re-run the sync from the pre-sync deck after adding corrections.

6. **Tag new cards by topic.** `data/topics.json` powers the app's "By topic" study mode (Sean types e.g. "past tense, direct and indirect, personal products" before a quiz). It has `topics` (id, name, kind grammar|vocab, aliases for typed matching) and `byCard` (card id → list of topic ids). The sync script prints every card missing from `byCard` at the end; add an entry for each, choosing all topics that genuinely apply by understanding the Spanish (e.g. "Se la di" → `pret`, `obj`), not by keyword. Every card gets at least one topic; infinitive vocab cards also get `verbs`. If a lesson introduces a theme no topic covers (a new vocab unit), suggest a new topic to Sean rather than forcing a bad fit; if he says yes, add it with a few aliases (English + Spanish names, as his quiz announcements phrase them). Re-run the script to confirm nothing is untagged.

7. **Sanity-check** that `data/deck.json` and `data/topics.json` are valid JSON and the card count only grew.

8. **Commit and push** (main branch). GitHub Pages redeploys in about a minute; Sean's phone picks up the new deck on next load.

9. **Report to Sean**: how many new cards and notes per lesson date, corrections made, anything you reclassified or skipped that he might want to double-check, and any doc typos found.
