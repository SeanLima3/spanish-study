#!/usr/bin/env python3
"""Sync Sean's Spanish lessons Google Doc text into data/deck.json.

Usage: python3 scripts/sync_deck.py <doc_text_file> <deck_json>

Idempotent merge: existing cards/notes in the deck are never modified or
removed (their ids anchor localStorage progress); only new material is added.
Classification rules are mirrored in js/parser.js for the app's paste-import.
"""
import json
import os
import re
import sys
import unicodedata

DATE_RE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:Lesson:?)?\s*$")

# Doc typos: header says 7/21/26 but it sits between the 6/15 and 6/22 lessons.
DATE_FIXES = {"2026-07-21": "2026-06-21"}

# Task/instruction lines to drop entirely (stale todos, not study material).
SKIP_RE = re.compile(
    r"^(homework|la tarea|mi tarea|tarea:|el tema \d|el tema$|la tema|"
    r"tema (uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)|quiz|study|"
    r"write|memorize|work on|check the|make \d|send |finish|respond completely|also |"
    r"short paragraph|"
    r"and listen|listen to the song|song - ser|a1$|debo hacer$|"
    r"why are the images|for future homework|book has a website|"
    r"combine irregular|2 sentences for all|cuarenta mas verbos|"
    r"5 frases|5 debes|summary$)",
    re.IGNORECASE,
)

# Pronunciation/mnemonic lines that look like cards but aren't.
NOTE_OVERRIDES = {
    "Reg - oooo- lar",
    "Peli - cula - pronunciation for movie",
    "Con - yo - conmigo",
    "Con - tu - contigo",
}

# Lines mangled in the doc, hand-fixed here.
CARD_OVERRIDES = {
    "Triste - * sad (cha-riste -": ("Triste", "sad"),
    "Despedirse (adios, hasta manana, hasta pronto, hasta luego, hasta la vista, nos vemos, ciao) - saying goodbye": (
        "Despedirse",
        "saying goodbye (adios, hasta manana, hasta pronto, hasta luego, hasta la vista, nos vemos, ciao)",
    ),
}


def clean(line: str) -> str:
    line = line.replace("\\", "")
    line = re.sub(r"\s+", " ", line)
    return line.strip()


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or "x"


def norm_pair(spanish: str, english: str) -> str:
    return f"{slugify(spanish)}::{slugify(english)}"


def classify(line: str):
    """Return ("card", es, en) | ("note", text) | ("skip", reason)."""
    if line in CARD_OVERRIDES:
        return ("card", *CARD_OVERRIDES[line])
    if line in NOTE_OVERRIDES:
        return ("note", line)
    if re.match(r"^\d+\.\s", line):  # numbered homework lists
        return ("skip", "numbered list")
    if line.startswith("- "):  # bullet homework lists
        return ("skip", "bullet/practice")
    if line.startswith("¿") and " - " not in line:  # untranslated practice questions
        return ("skip", "bullet/practice")
    if SKIP_RE.match(line):
        return ("skip", "task line")
    if "Return here" in line:
        return ("skip", "marker")
    if not re.search(r"[a-zA-Z0-9]", line):
        return ("skip", "punctuation only")

    m = re.match(r"^(.+?)\s[-–]\s(.+)$", line)
    if not m:
        return ("note", line)
    es, en = m.group(1).strip(), m.group(2).strip()

    if re.match(r"^\d{1,2}:\d{2}$", es):  # time homework: "1:15 - Es la una..."
        return ("skip", "time homework")
    if re.match(r"^[A-Za-z]\s?\+", es) or re.match(r"^[A-Za-z]\s?\+", en):
        return ("note", line)  # pronunciation rules: "G+i - he"
    if "http" in line or "—" in line:
        return ("note", line)
    if not en or not re.search(r"[a-zA-Z0-9]", en):
        return ("note", line)  # empty/garbage translation
    # "Sobrino - a - nephew niece" -> gendered pair
    gm = re.match(r"^a\s[-–]\s(.+)$", en)
    if gm:
        return ("card", f"{es}/a", gm.group(1).strip())
    if len(es) > 70 or len(en) > 90:
        return ("note", line)  # long example sentences read better as notes
    return ("card", es, en)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    doc_path, deck_path = sys.argv[1], sys.argv[2]

    if os.path.exists(deck_path):
        with open(deck_path, encoding="utf-8") as f:
            deck = json.load(f)
    else:
        deck = {"version": 1, "lessons": [], "cards": []}

    lessons_by_date = {l["date"]: l for l in deck["lessons"]}
    ids = {c["id"] for c in deck["cards"]}
    seen_pairs = {norm_pair(c["spanish"], c["english"]): c["id"] for c in deck["cards"]}
    existing_notes = {l["date"]: set(l["notes"]) for l in deck["lessons"]}

    new_cards, new_notes, skipped = [], [], []
    current = None

    with open(doc_path, encoding="utf-8") as f:
        raw_lines = f.read().splitlines()

    for raw in raw_lines:
        line = clean(raw)
        if not line:
            continue
        dm = DATE_RE.match(line)
        if dm:
            mo, day, yr = (int(dm.group(1)), int(dm.group(2)), int(dm.group(3)))
            yr += 2000 if yr < 100 else 0
            date = f"{yr:04d}-{mo:02d}-{day:02d}"
            date = DATE_FIXES.get(date, date)
            if date not in lessons_by_date:
                lessons_by_date[date] = {"date": date, "notes": []}
                deck["lessons"].append(lessons_by_date[date])
                existing_notes[date] = set()
            current = lessons_by_date[date]
            continue
        if current is None:
            skipped.append(("before first lesson", line))
            continue

        kind, *rest = classify(line)
        if kind == "skip":
            skipped.append((rest[0], line))
        elif kind == "note":
            if rest[0] not in existing_notes[current["date"]]:
                current["notes"].append(rest[0])
                existing_notes[current["date"]].add(rest[0])
                new_notes.append((current["date"], rest[0]))
        else:
            es, en = rest
            pair = norm_pair(es, en)
            if pair in seen_pairs:
                continue
            base = f"{current['date']}_{slugify(es)}"
            cid, n = base, 2
            while cid in ids:
                cid, n = f"{base}-{n}", n + 1
            ids.add(cid)
            seen_pairs[pair] = cid
            card = {"id": cid, "spanish": es, "english": en, "lesson": current["date"]}
            deck["cards"].append(card)
            new_cards.append(card)

    deck["lessons"].sort(key=lambda l: l["date"])
    with open(deck_path, "w", encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False, indent=1)

    print(f"Deck now: {len(deck['cards'])} cards across {len(deck['lessons'])} lessons")
    print(f"New cards: {len(new_cards)}  |  New notes: {len(new_notes)}")
    by_lesson = {}
    for c in new_cards:
        by_lesson.setdefault(c["lesson"], []).append(c)
    for date in sorted(by_lesson):
        print(f"\n  {date}: {len(by_lesson[date])} new cards")
        for c in by_lesson[date]:
            print(f"    + {c['spanish']} — {c['english']}")
    if new_notes:
        print("\nNew notes:")
        for date, note in new_notes:
            print(f"  [{date}] {note}")
    if new_cards or new_notes:
        print("\nSkipped lines (review for anything that should have been a card):")
        for reason, line in skipped:
            print(f"  [{reason}] {line}")


if __name__ == "__main__":
    main()
