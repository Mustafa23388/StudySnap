const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../middleware');
const { assertOwner } = require('./sets');

const router = express.Router();
router.use(requireAuth);

// ── Notes (one per user per study set, auto-saved) ───────────────────────
router.get('/sets/:setId/notes', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const note = db.prepare('SELECT content, updated_at FROM notes WHERE study_set_id = ? AND user_id = ?').get(set.id, req.user.id);
  res.json({ content: note ? note.content : '', updated_at: note ? note.updated_at : null });
});

router.put('/sets/:setId/notes', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const content = String((req.body || {}).content || '').slice(0, 50000);
  db.prepare(`INSERT INTO notes (study_set_id, user_id, content, updated_at) VALUES (?,?,?,?)
              ON CONFLICT (study_set_id, user_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
    .run(set.id, req.user.id, content, new Date().toISOString().slice(0, 19).replace('T', ' '));
  res.json({ ok: true, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
});

// ── Progress dashboard (real activity only) ──────────────────────────────
router.get('/progress', (req, res) => {
  const uid = req.user.id;
  const cardAgg = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN f.status='known' THEN 1 ELSE 0 END),0) AS known,
           COALESCE(SUM(CASE WHEN f.status='need_review' THEN 1 ELSE 0 END),0) AS need_review,
           COALESCE(SUM(f.review_count),0) AS reviews
    FROM flashcards f JOIN decks d ON d.id = f.deck_id JOIN study_sets s ON s.id = d.study_set_id
    WHERE s.user_id = ?`).get(uid);
  const attempts = db.prepare('SELECT score, total, percentage, completed_at, quiz_id FROM quiz_attempts WHERE user_id = ? ORDER BY completed_at DESC').all(uid);
  const avgScore = attempts.length ? Math.round(attempts.reduce((a, x) => a + x.percentage, 0) / attempts.length * 10) / 10 : null;

  // topics from saved per-question results
  const topicAgg = {};
  for (const at of attempts) {
    let answers = [];
    try { answers = JSON.parse(at.answers); } catch { continue; }
    for (const a of answers) {
      const t = a.topic || 'General';
      topicAgg[t] = topicAgg[t] || { topic: t, correct: 0, total: 0 };
      topicAgg[t].total++; if (a.correct) topicAgg[t].correct++;
    }
  }
  const topics = Object.values(topicAgg).map(t => ({ ...t, pct: t.total ? Math.round(t.correct / t.total * 100) : 0 }));
  const mastered = topics.filter(t => t.pct >= 80 && t.total >= 2).map(t => t.topic);
  const needsReview = topics.filter(t => t.pct < 60).map(t => t.topic);

  const activity = db.prepare(`
    SELECT date(created_at) AS day, kind, COUNT(*) AS n FROM activity
    WHERE user_id = ? AND created_at >= date('now','-13 days')
    GROUP BY day, kind ORDER BY day`).all(uid);

  const sets = db.prepare('SELECT id, title, subject, status, created_at, last_studied_at FROM study_sets WHERE user_id = ?').all(uid);
  const sessions = db.prepare(`SELECT COUNT(DISTINCT date(created_at)) AS n FROM activity WHERE user_id = ?`).get(uid).n;

  res.json({
    stats: {
      studySets: sets.length,
      cardsTotal: cardAgg.total,
      cardsKnown: cardAgg.known,
      cardsNeedReview: cardAgg.need_review,
      flashcardsReviewed: cardAgg.reviews,
      quizAttempts: attempts.length,
      avgQuizScore: avgScore,
      topicsMastered: mastered,
      topicsNeedingReview: needsReview,
      studyDays: sessions
    },
    recentAttempts: attempts.slice(0, 5).map(a => ({ ...a })),
    activity,
    sets: sets.map(s => ({ ...s }))
  });
});

// ── Review: cards that need work, prioritised ────────────────────────────
router.get('/review', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`
    SELECT f.id, f.question, f.answer, f.status, f.review_count, f.last_reviewed,
           d.id AS deck_id, d.title AS deck_title, s.id AS set_id, s.title AS set_title
    FROM flashcards f
    JOIN decks d ON d.id = f.deck_id
    JOIN study_sets s ON s.id = d.study_set_id
    WHERE s.user_id = ?`).all(uid);

  const today = Date.now();
  const scored = rows.map(c => {
    let score = 0;
    if (c.status === 'need_review') score += 100;                    // 1. marked Need Review
    score += Math.min(c.review_count, 10);                            // 2. frequently missed/reviewed
    if (c.last_reviewed) {
      const days = Math.floor((today - new Date(c.last_reviewed + 'Z').getTime()) / 86400000);
      score += Math.min(days, 14);                                    // 3. stale cards
    } else if (c.status === 'unseen') score += 5;
    return { ...c, priority: score };
  }).filter(c => c.status !== 'known' || c.priority >= 10)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 20);

  const conceptCount = db.prepare(`
    SELECT COUNT(*) AS n FROM concepts c JOIN study_sets s ON s.id = c.study_set_id WHERE s.user_id = ?`).get(uid).n;

  res.json({ cards: scored, conceptsAvailable: conceptCount });
});

module.exports = router;
