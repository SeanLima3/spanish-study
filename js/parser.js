/* Parses pasted lesson notes ("Spanish - English" lines under a date header)
   into cards and notes. Mirrors the rules used by the sync-spanish-notes skill. */
const Parser = (() => {
  const DATE_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:Lesson:?)?\s*$/;
  const SKIP_RE = new RegExp(
    "^(homework|la tarea|mi tarea|tarea:|el tema \\d|el tema$|la tema|" +
      "tema (uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)|quiz|study|" +
      "write|memorize|work on|check the|make \\d|send |finish|respond completely|also |" +
      "short paragraph|and listen|listen to the song|song - ser|a1$|debo hacer$|summary$)",
    "i"
  );

  function clean(line) {
    return line.replace(/\\/g, "").replace(/\s+/g, " ").trim();
  }

  function slugify(s) {
    return (
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "x"
    );
  }

  function classify(line) {
    if (/^\d+\.\s/.test(line)) return { kind: "skip" };
    if (line.startsWith("- ")) return { kind: "skip" };
    if (line.startsWith("¿") && !line.includes(" - ")) return { kind: "skip" };
    if (SKIP_RE.test(line)) return { kind: "skip" };
    if (line.includes("Return here")) return { kind: "skip" };
    if (!/[a-zA-Z0-9]/.test(line)) return { kind: "skip" };

    const m = line.match(/^(.+?)\s[-–]\s(.+)$/);
    if (!m) return { kind: "note", text: line };
    const es = m[1].trim();
    let en = m[2].trim();

    if (/^\d{1,2}:\d{2}$/.test(es)) return { kind: "skip" };
    if (/^[A-Za-z]\s?\+/.test(es) || /^[A-Za-z]\s?\+/.test(en)) return { kind: "note", text: line };
    if (line.includes("http") || line.includes("—")) return { kind: "note", text: line };
    if (!/[a-zA-Z0-9]/.test(en)) return { kind: "note", text: line };

    const gm = en.match(/^a\s[-–]\s(.+)$/); // "Sobrino - a - nephew niece"
    if (gm) return { kind: "card", spanish: es + "/a", english: gm[1].trim() };
    if (es.length > 70 || en.length > 90) return { kind: "note", text: line };
    return { kind: "card", spanish: es, english: en };
  }

  /* Returns { lessons: [{date, cards: [{spanish, english}], notes: [str]}] }.
     Lines before any date header fall into a lesson with fallbackDate. */
  function parse(text, fallbackDate) {
    const lessons = [];
    let current = null;
    const ensureLesson = (date) => {
      current = lessons.find((l) => l.date === date) || null;
      if (!current) {
        current = { date, cards: [], notes: [] };
        lessons.push(current);
      }
    };

    for (const raw of text.split(/\r?\n/)) {
      const line = clean(raw);
      if (!line) continue;
      const dm = line.match(DATE_RE);
      if (dm) {
        let [mo, day, yr] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
        if (yr < 100) yr += 2000;
        ensureLesson(
          `${String(yr).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        );
        continue;
      }
      if (!current) ensureLesson(fallbackDate);
      const c = classify(line);
      if (c.kind === "card") current.cards.push({ spanish: c.spanish, english: c.english });
      else if (c.kind === "note") current.notes.push(c.text);
    }
    return { lessons };
  }

  function cardId(lessonDate, spanish, existingIds) {
    const base = `${lessonDate}_${slugify(spanish)}`;
    let id = base;
    let n = 2;
    while (existingIds.has(id)) id = `${base}-${n++}`;
    return id;
  }

  return { parse, slugify, cardId };
})();
