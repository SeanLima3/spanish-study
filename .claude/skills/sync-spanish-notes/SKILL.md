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

4. **Sanity-check** that `data/deck.json` is valid JSON and the card count only grew.

5. **Commit and push** (main branch). GitHub Pages redeploys in about a minute; Sean's phone picks up the new deck on next load.

6. **Report to Sean**: how many new cards and notes per lesson date, anything you reclassified or skipped that he might want to double-check, and any doc typos found.
