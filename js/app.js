/* Spanish flash cards app. Deck ships in data/deck.json (updated by the
   sync-spanish-notes skill); per-device progress lives in localStorage. */
(() => {
  const LS = {
    progress: "spanish-study.progress.v1",
    prefs: "spanish-study.prefs.v1",
    customCards: "spanish-study.customCards.v1",
  };

  const state = {
    deck: { lessons: [], cards: [] },
    cardsById: new Map(),
    grammar: { topicOrder: [], bySlug: {} },
    progress: loadJSON(LS.progress, {}),
    prefs: Object.assign(
      { direction: "es-en", mode: "review", length: 25, lessonDates: [], quizStyle: "flip", notesMode: "topic" },
      loadJSON(LS.prefs, {})
    ),
    session: null,
    importPreview: null,
  };

  function loadJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function saveProgress() { saveJSON(LS.progress, state.progress); }
  function savePrefs() { saveJSON(LS.prefs, state.prefs); }

  const $ = (id) => document.getElementById(id);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}/${d}/${String(y).slice(2)}`;
  };
  const esc = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- deck loading ---------- */
  async function loadDeck() {
    const res = await fetch("data/deck.json?ts=" + Date.now());
    const deck = await res.json();
    const ids = new Set(deck.cards.map((c) => c.id));
    // Cards added via paste-import on this device; skip any the synced deck now has.
    const custom = loadJSON(LS.customCards, []);
    for (const c of custom) {
      if (!ids.has(c.id)) {
        deck.cards.push(c);
        ids.add(c.id);
        if (!deck.lessons.some((l) => l.date === c.lesson)) deck.lessons.push({ date: c.lesson, notes: [] });
      }
    }
    deck.lessons.sort((a, b) => a.date.localeCompare(b.date));
    state.deck = deck;
    state.cardsById = new Map(deck.cards.map((c) => [c.id, c]));
  }

  async function loadGrammar() {
    try {
      const res = await fetch("data/grammar.json?ts=" + Date.now());
      state.grammar = await res.json();
    } catch {
      /* topic view degrades to "More tips" for everything */
    }
  }

  /* ---------- card pools ---------- */
  function poolFor(mode, lessonDates) {
    const today = SRS.todayStr();
    const cards = state.deck.cards;
    if (mode === "review") return cards.filter((c) => SRS.isDue(state.progress[c.id], today));
    if (mode === "incorrect") return cards.filter((c) => SRS.isTrouble(state.progress[c.id]));
    if (mode === "lessons") return cards.filter((c) => lessonDates.includes(c.lesson));
    return cards.slice();
  }

  /* ---------- study setup ---------- */
  function renderSetup() {
    $("count-review").textContent = poolFor("review").length;
    $("count-incorrect").textContent = poolFor("incorrect").length;
    $("count-all").textContent = state.deck.cards.length;
    $("count-lessons").textContent = state.deck.lessons.length;

    document.querySelectorAll("#direction-picker button").forEach((b) => b.classList.toggle("active", b.dataset.dir === state.prefs.direction));
    document.querySelectorAll("#style-picker button").forEach((b) => b.classList.toggle("active", b.dataset.style === state.prefs.quizStyle));
    document.querySelectorAll("#mode-picker .mode-card").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.prefs.mode));
    document.querySelectorAll("#length-picker button").forEach((b) => b.classList.toggle("active", Number(b.dataset.len) === state.prefs.length));

    const lp = $("lesson-picker");
    lp.classList.toggle("hidden", state.prefs.mode !== "lessons");
    if (state.prefs.mode === "lessons" && !lp.dataset.built) {
      lp.innerHTML = state.deck.lessons
        .map((l) => `<button class="chip" data-date="${l.date}">${fmtDate(l.date)}</button>`)
        .join("");
      lp.dataset.built = "1";
      lp.querySelectorAll(".chip").forEach((chip) =>
        chip.addEventListener("click", () => {
          const d = chip.dataset.date;
          const sel = state.prefs.lessonDates;
          state.prefs.lessonDates = sel.includes(d) ? sel.filter((x) => x !== d) : [...sel, d];
          savePrefs();
          renderSetup();
        })
      );
    }
    if (state.prefs.mode === "lessons") {
      lp.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("active", state.prefs.lessonDates.includes(chip.dataset.date)));
    }

    const pool = poolFor(state.prefs.mode, state.prefs.lessonDates);
    const n = state.prefs.length === 0 ? pool.length : Math.min(state.prefs.length, pool.length);
    $("btn-start").disabled = pool.length === 0;
    $("setup-hint").textContent =
      pool.length === 0
        ? state.prefs.mode === "lessons" && state.prefs.lessonDates.length === 0
          ? "Pick one or more lesson dates above."
          : "Nothing to study here right now. 🎉"
        : `${n} of ${pool.length} card${pool.length === 1 ? "" : "s"} this session`;
  }

  /* ---------- study session ---------- */
  function startSession(cardIds) {
    const queue = cardIds.map((id) => ({
      id,
      dir: state.prefs.direction === "mixed" ? (Math.random() < 0.5 ? "es-en" : "en-es") : state.prefs.direction,
      requeued: false,
    }));
    state.session = { queue, idx: 0, flipped: false, right: 0, wrong: 0, missedIds: [] };
    showStudyPane("session");
    renderCard();
  }

  function showStudyPane(which) {
    $("study-setup").classList.toggle("hidden", which !== "setup");
    $("study-session").classList.toggle("hidden", which !== "session");
    $("study-summary").classList.toggle("hidden", which !== "summary");
    if (which === "setup") renderSetup();
  }

  function currentItem() {
    return state.session.queue[state.session.idx];
  }

  function itemDir(item) {
    return state.prefs.direction === "mixed" ? item.dir : state.prefs.direction;
  }

  function buildOptions(card, dir) {
    const key = dir === "es-en" ? "english" : "spanish";
    const answer = card[key];
    const pool = state.deck.cards.filter((c) => c.id !== card.id && c[key] !== answer);
    const texts = new Set();
    for (const c of shuffle(pool.filter((c) => c.lesson === card.lesson)).slice(0, 2)) texts.add(c[key]);
    for (const c of shuffle(pool)) {
      if (texts.size >= 3) break;
      texts.add(c[key]);
    }
    const opts = [...texts].slice(0, 3).map((text) => ({ text, correct: false }));
    opts.push({ text: answer, correct: true });
    return shuffle(opts);
  }

  function renderCard() {
    const s = state.session;
    const item = currentItem();
    const card = state.cardsById.get(item.id);
    const dir = itemDir(item);
    const mc = state.prefs.quizStyle === "mc";
    const frontIsSpanish = dir === "es-en";
    const showingBack = !mc && s.flipped;
    const showSpanish = frontIsSpanish !== showingBack;

    $("card-lang").textContent = showSpanish ? "Español" : "English";
    $("card-word").textContent = showSpanish ? card.spanish : card.english;
    $("card-meta").textContent =
      showingBack || mc ? `lesson ${fmtDate(card.lesson)}${item.requeued ? " · again" : ""}` : "";
    $("flip-hint").classList.toggle("hidden", mc || showingBack);
    $("flashcard").classList.toggle("flipped", showingBack);
    $("btn-wrong").classList.toggle("hidden", mc || !showingBack);
    $("btn-right").classList.toggle("hidden", mc || !showingBack);
    $("mc-options").classList.toggle("hidden", !mc);
    $("key-hint").textContent = mc ? "press 1–4 to answer" : "space to flip · ← missed · → got it";

    if (mc) {
      if (!item.options || item.optionsDir !== dir) {
        item.options = buildOptions(card, dir);
        item.optionsDir = dir;
        item.answered = false;
      }
      $("mc-options").innerHTML = item.options
        .map((o, i) => `<button class="mc-option" data-i="${i}"><span class="mc-key">${i + 1}</span>${esc(o.text)}</button>`)
        .join("");
    }

    const answered = s.right + s.wrong;
    $("session-count").textContent = `${Math.min(answered + 1, s.queue.length)} / ${s.queue.length}`;
    $("session-progress").style.width = `${(answered / s.queue.length) * 100}%`;
    $("btn-direction").textContent = { "es-en": "ES→EN", "en-es": "EN→ES", mixed: "MIX" }[state.prefs.direction];
  }

  function flip() {
    if (state.prefs.quizStyle === "mc") return;
    state.session.flipped = !state.session.flipped;
    renderCard();
  }

  function recordResult(item, wasCorrect) {
    const s = state.session;
    state.progress[item.id] = SRS.applyResult(state.progress[item.id], wasCorrect);
    saveProgress();
    if (wasCorrect) s.right++;
    else {
      s.wrong++;
      if (!s.missedIds.includes(item.id)) s.missedIds.push(item.id);
      if (!item.requeued) s.queue.push({ id: item.id, dir: item.dir, requeued: true }); // one more try at the end
    }
  }

  function advance() {
    const s = state.session;
    s.idx++;
    s.flipped = false;
    if (s.idx >= s.queue.length) return endSession();
    renderCard();
  }

  function answer(wasCorrect) {
    const s = state.session;
    if (!s.flipped) return;
    recordResult(currentItem(), wasCorrect);
    advance();
  }

  function answerMC(idx) {
    const item = currentItem();
    if (!item.options || item.answered) return;
    const chosen = item.options[idx];
    if (!chosen) return;
    item.answered = true;
    document.querySelectorAll(".mc-option").forEach((b, i) => {
      b.disabled = true;
      if (item.options[i].correct) b.classList.add("correct");
      else if (i === idx) b.classList.add("wrong");
    });
    recordResult(item, chosen.correct);
    setTimeout(advance, chosen.correct ? 650 : 1500);
  }

  function endSession() {
    const s = state.session;
    $("summary-title").textContent = s.wrong === 0 ? "¡Perfecto! 🎉" : "Session done";
    $("summary-right").textContent = s.right;
    $("summary-wrong").textContent = s.wrong;
    $("summary-missed-list").innerHTML = s.missedIds
      .map((id) => {
        const c = state.cardsById.get(id);
        return `<div class="missed-word"><span>${esc(c.spanish)}</span><em>${esc(c.english)}</em></div>`;
      })
      .join("");
    $("btn-redo").classList.toggle("hidden", s.missedIds.length === 0);
    showStudyPane("summary");
  }

  /* ---------- stats ---------- */
  function renderStats() {
    const cards = state.deck.cards;
    const today = SRS.todayStr();
    let studied = 0, right = 0, wrong = 0, due = 0;
    const boxes = [0, 0, 0, 0, 0, 0]; // index 0 = new
    for (const c of cards) {
      const p = state.progress[c.id];
      if (p) {
        studied++;
        right += p.correct;
        wrong += p.incorrect;
        boxes[p.box]++;
      } else boxes[0]++;
      if (SRS.isDue(p, today)) due++;
    }
    const acc = right + wrong ? Math.round((right / (right + wrong)) * 100) : null;
    $("stats-overall").innerHTML = `
      <div class="stat"><b>${cards.length}</b><span>cards</span></div>
      <div class="stat"><b>${studied}</b><span>studied</span></div>
      <div class="stat"><b>${due}</b><span>due now</span></div>
      <div class="stat"><b>${acc === null ? "–" : acc + "%"}</b><span>accuracy</span></div>`;

    const boxLabels = ["New", "Box 1", "Box 2", "Box 3", "Box 4", "Box 5"];
    const max = Math.max(...boxes, 1);
    $("stats-boxes").innerHTML = boxes
      .map(
        (n, i) =>
          `<div class="boxbar"><label>${boxLabels[i]}</label><div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`
      )
      .join("");

    const trouble = cards
      .filter((c) => state.progress[c.id] && state.progress[c.id].incorrect > 0)
      .sort((a, b) => {
        const pa = state.progress[a.id], pb = state.progress[b.id];
        return pb.incorrect - pa.incorrect || pa.box - pb.box;
      })
      .slice(0, 12);
    $("stats-trouble").innerHTML = trouble.length
      ? trouble
          .map((c) => {
            const p = state.progress[c.id];
            return `<div class="missed-word"><span>${esc(c.spanish)} <em style="font-size:.8em">✗${p.incorrect} ✓${p.correct}</em></span><em>${esc(c.english)}</em></div>`;
          })
          .join("")
      : `<p class="muted">Nothing here yet — misses will show up as you study.</p>`;

    $("stats-lessons").innerHTML = state.deck.lessons
      .map((l) => {
        const lc = cards.filter((c) => c.lesson === l.date);
        if (!lc.length) return "";
        let r = 0, w = 0, lessonDue = 0;
        for (const c of lc) {
          const p = state.progress[c.id];
          if (p) { r += p.correct; w += p.incorrect; }
          if (SRS.isDue(p, today)) lessonDue++;
        }
        const lacc = r + w ? Math.round((r / (r + w)) * 100) + "%" : "–";
        return `<div class="lesson-stat"><span><b>${fmtDate(l.date)}</b> · ${lc.length} cards</span><span class="acc">${lacc}</span><span class="due-badge">${lessonDue} due</span></div>`;
      })
      .join("");
  }

  /* ---------- backup ---------- */
  function exportProgress() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), progress: state.progress, customCards: loadJSON(LS.customCards, []) }, null, 1)],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spanish-study-progress-${SRS.todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importProgressFile(file) {
    const data = JSON.parse(await file.text());
    if (!data.progress) throw new Error("Not a progress backup file");
    Object.assign(state.progress, data.progress);
    saveProgress();
    if (Array.isArray(data.customCards) && data.customCards.length) {
      const existing = loadJSON(LS.customCards, []);
      const have = new Set(existing.map((c) => c.id));
      saveJSON(LS.customCards, existing.concat(data.customCards.filter((c) => !have.has(c.id))));
      await loadDeck();
    }
    renderStats();
  }

  /* ---------- notes ---------- */
  function renderNotes() {
    const mode = state.prefs.notesMode;
    document.querySelectorAll("#notes-mode button").forEach((b) => b.classList.toggle("active", b.dataset.nmode === mode));

    if (mode === "lesson") {
      $("notes-list").innerHTML = state.deck.lessons
        .filter((l) => l.notes && l.notes.length)
        .map(
          (l) => `
          <details class="notes-lesson">
            <summary>${fmtDate(l.date)}<span class="n">${l.notes.length} note${l.notes.length === 1 ? "" : "s"}</span></summary>
            <ul>${l.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
          </details>`
        )
        .join("");
      return;
    }

    const fallback = "More tips";
    const groups = new Map(state.grammar.topicOrder.map((t) => [t, []]));
    if (!groups.has(fallback)) groups.set(fallback, []);
    for (const l of state.deck.lessons) {
      for (const n of l.notes || []) {
        const t = state.grammar.bySlug[Parser.slugify(n)] || fallback;
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t).push({ n, date: l.date });
      }
    }
    $("notes-list").innerHTML = [...groups]
      .filter(([, notes]) => notes.length)
      .map(
        ([topic, notes]) => `
        <details class="notes-lesson">
          <summary>${esc(topic)}<span class="n">${notes.length}</span></summary>
          <ul>${notes.map(({ n, date }) => `<li>${esc(n)}<span class="note-date">${fmtDate(date)}</span></li>`).join("")}</ul>
        </details>`
      )
      .join("");
  }

  /* ---------- paste import ---------- */
  function normPair(es, en) {
    return `${Parser.slugify(es)}::${Parser.slugify(en)}`;
  }

  function previewImport() {
    const text = $("import-text").value;
    if (!text.trim()) return;
    const fallback = $("import-date").value || SRS.todayStr();
    const parsed = Parser.parse(text, fallback);
    const hasUndated = parsed.lessons.some((l) => l.date === fallback) && !text.match(/^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/m);
    $("import-date-row").classList.toggle("hidden", !hasUndated);

    const existingPairs = new Set(state.deck.cards.map((c) => normPair(c.spanish, c.english)));
    let rows = "";
    let fresh = 0;
    parsed.lessons.forEach((l, li) => {
      rows += `<div class="preview-lesson-h">Lesson ${fmtDate(l.date)} <span class="muted">· ${l.cards.length} cards, ${l.notes.length} notes</span></div>`;
      l.cards.forEach((c, ci) => {
        const dup = existingPairs.has(normPair(c.spanish, c.english));
        if (!dup) fresh++;
        rows += `<div class="preview-card ${dup ? "dup" : ""}" data-l="${li}" data-c="${ci}">
          <input type="checkbox" ${dup ? "" : "checked"}>
          <input type="text" class="es" value="${esc(c.spanish)}">
          <input type="text" class="en" value="${esc(c.english)}">
          ${dup ? '<span class="dup-tag">already have</span>' : ""}
        </div>`;
      });
    });
    state.importPreview = parsed;
    $("import-preview").innerHTML = rows || `<p class="muted">No cards found — expected lines like “La palabra - the word”.</p>`;
    $("import-preview-title").textContent = "Review before adding";
    $("btn-confirm-import").textContent = `Add ${fresh} card${fresh === 1 ? "" : "s"}`;
    $("btn-confirm-import").disabled = fresh === 0;
    $("import-result").textContent = "";
    $("import-preview-panel").classList.remove("hidden");
  }

  async function confirmImport() {
    const parsed = state.importPreview;
    if (!parsed) return;
    const custom = loadJSON(LS.customCards, []);
    const ids = new Set(state.deck.cards.map((c) => c.id));
    const pairs = new Set(state.deck.cards.map((c) => normPair(c.spanish, c.english)));
    let added = 0;

    document.querySelectorAll(".preview-card").forEach((row) => {
      if (!row.querySelector("input[type=checkbox]").checked) return;
      const l = parsed.lessons[Number(row.dataset.l)];
      const es = row.querySelector(".es").value.trim();
      const en = row.querySelector(".en").value.trim();
      if (!es || !en || pairs.has(normPair(es, en))) return;
      const card = { id: Parser.cardId(l.date, es, ids), spanish: es, english: en, lesson: l.date, source: "paste" };
      ids.add(card.id);
      pairs.add(normPair(es, en));
      custom.push(card);
      added++;
    });
    // Notes aren't stored here — they arrive with the next "sync my spanish notes" run.
    saveJSON(LS.customCards, custom);
    await loadDeck();
    renderSetup();
    $("import-result").textContent = `Added ${added} card${added === 1 ? "" : "s"} — they’ll show up in every study mode.`;
    $("btn-confirm-import").disabled = true;
  }

  /* ---------- navigation ---------- */
  function switchView(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    if (name === "stats") renderStats();
    if (name === "notes") renderNotes();
    if (name === "study" && !state.session) showStudyPane("setup");
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("nav-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (tab) switchView(tab.dataset.view);
    });

    $("direction-picker").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.prefs.direction = b.dataset.dir;
      savePrefs();
      renderSetup();
    });
    $("style-picker").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.prefs.quizStyle = b.dataset.style;
      savePrefs();
      renderSetup();
    });
    $("notes-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.prefs.notesMode = b.dataset.nmode;
      savePrefs();
      renderNotes();
    });
    $("mc-options").addEventListener("click", (e) => {
      const b = e.target.closest(".mc-option");
      if (b) answerMC(Number(b.dataset.i));
    });
    $("mode-picker").addEventListener("click", (e) => {
      const b = e.target.closest(".mode-card");
      if (!b) return;
      state.prefs.mode = b.dataset.mode;
      savePrefs();
      renderSetup();
    });
    $("length-picker").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.prefs.length = Number(b.dataset.len);
      savePrefs();
      renderSetup();
    });

    $("btn-start").addEventListener("click", () => {
      const pool = shuffle(poolFor(state.prefs.mode, state.prefs.lessonDates));
      const n = state.prefs.length === 0 ? pool.length : Math.min(state.prefs.length, pool.length);
      if (n) startSession(pool.slice(0, n).map((c) => c.id));
    });

    $("flashcard").addEventListener("click", flip);
    $("btn-right").addEventListener("click", () => answer(true));
    $("btn-wrong").addEventListener("click", () => answer(false));
    $("btn-exit").addEventListener("click", () => {
      state.session = null;
      showStudyPane("setup");
    });
    $("btn-direction").addEventListener("click", () => {
      const order = ["es-en", "en-es", "mixed"];
      state.prefs.direction = order[(order.indexOf(state.prefs.direction) + 1) % order.length];
      savePrefs();
      renderCard();
    });

    $("btn-redo").addEventListener("click", () => startSession(shuffle(state.session.missedIds.slice())));
    $("btn-again").addEventListener("click", () => {
      state.session = null;
      showStudyPane("setup");
    });

    document.addEventListener("keydown", (e) => {
      if (!state.session || $("study-session").classList.contains("hidden")) return;
      if (e.target.matches("input, textarea")) return;
      if (state.prefs.quizStyle === "mc") {
        if (/^[1-4]$/.test(e.key)) answerMC(Number(e.key) - 1);
        return;
      }
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        flip();
      } else if (e.code === "ArrowRight") answer(true);
      else if (e.code === "ArrowLeft") answer(false);
    });

    $("btn-export").addEventListener("click", exportProgress);
    $("btn-import-progress").addEventListener("click", () => $("file-progress").click());
    $("file-progress").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        await importProgressFile(f);
        alert("Progress imported.");
      } catch (err) {
        alert("Couldn’t import: " + err.message);
      }
      e.target.value = "";
    });

    $("btn-preview").addEventListener("click", previewImport);
    $("btn-confirm-import").addEventListener("click", confirmImport);
    $("import-date").value = SRS.todayStr();
  }

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      await loadDeck();
      await loadGrammar();
    } catch (err) {
      document.querySelector("main").innerHTML =
        `<div class="panel"><h2>Couldn’t load the deck</h2><p class="muted">data/deck.json failed to load (${esc(String(err))}). If you opened index.html directly from disk, serve it instead: <code>python3 -m http.server</code></p></div>`;
      return;
    }
    wire();
    renderSetup();
  })();
})();
