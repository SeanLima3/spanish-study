/* Leitner spaced repetition. Boxes 1-5 with review intervals in days.
   A correct answer moves a card up one box; a miss drops it back to box 1
   (due again today). New cards start in box 1, due immediately. */
const SRS = (() => {
  const INTERVALS = [0, 1, 3, 7, 14]; // days until next review, per box

  function todayStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + days);
    return todayStr(dt);
  }

  function defaultProgress(today = todayStr()) {
    return { box: 1, due: today, correct: 0, incorrect: 0, lastResult: null };
  }

  function applyResult(p, wasCorrect, today = todayStr()) {
    const prev = p || defaultProgress(today);
    const box = wasCorrect ? Math.min(prev.box + 1, 5) : 1;
    return {
      box,
      due: wasCorrect ? addDays(today, INTERVALS[box - 1]) : today,
      correct: prev.correct + (wasCorrect ? 1 : 0),
      incorrect: prev.incorrect + (wasCorrect ? 0 : 1),
      lastResult: wasCorrect ? "correct" : "incorrect",
    };
  }

  function isDue(p, today = todayStr()) {
    if (!p) return true; // never studied -> due now
    return p.due <= today;
  }

  function isTrouble(p) {
    if (!p) return false;
    return p.lastResult === "incorrect" || (p.box === 1 && p.incorrect > 0);
  }

  return { INTERVALS, todayStr, addDays, defaultProgress, applyResult, isDue, isTrouble };
})();
