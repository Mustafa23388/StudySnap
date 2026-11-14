const express = require('express');
const { db, logActivity, logUsage } = require('../db');
const { requireAuth } = require('../middleware');
const { aiAvailable, chatJSON } = require('../ai');
const { heuristicPack } = require('../fallback');
const { assertOwner } = require('./sets');

const router = express.Router();
router.use(requireAuth);

function ownedQuiz(req, res) {
  const quiz = db.prepare(`
    SELECT q.*, s.user_id AS owner_id, s.title AS set_title, s.source_text
    FROM quizzes q JOIN study_sets s ON s.id = q.study_set_id WHERE q.id = ?`).get(req.params.quizId);
  if (!quiz) { res.status(404).json({ error: 'Quiz not found.' }); return null; }
  if (quiz.owner_id !== req.user.id) { res.status(403).json({ error: 'You do not have access to this quiz.' }); return null; }
  return quiz;
}

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const tokenOverlap = (a, b) => {
  const A = new Set(normalize(a).split(' ').filter(w => w.length > 2));
  const B = new Set(normalize(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
};

const DIFF_GUIDE = {
  easy: 'basic recall and definitions',
  medium: 'understanding and application',
  hard: 'reasoning, comparison and exam-style questions'
};

// Generate an additional quiz for a study set
router.post('/sets/:setId/quizzes', async (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const difficulty = ['easy', 'medium', 'hard'].includes((req.body || {}).difficulty) ? req.body.difficulty : 'medium';
  const count = Math.min(20, Math.max(3, parseInt((req.body || {}).count || '8', 10) || 8));

  let questions = [], generatedBy = 'heuristic';
  if (aiAvailable()) {
    try {
      const out = await chatJSON(
        'You are StudySnap, a quiz generator for students. Answer with valid JSON only, based strictly on the material.',
        `Study material:\n"""\n${set.source_text.slice(0, 16000)}\n"""\nGenerate ${count} quiz questions at ${difficulty} difficulty (${DIFF_GUIDE[difficulty]}).\nJSON shape:\n{"questions":[{"question":"...","type":"multiple_choice"|"true_false"|"short_answer","options":["4 options for multiple_choice"],"correctAnswer":"...","explanation":"why","topic":"short topic tag"}]}`,
        3000
      );
      if (Array.isArray(out.questions) && out.questions.length) { questions = out.questions; generatedBy = 'ai'; logUsage(req.user.id, 'ai_generation'); }
    } catch (err) {
      console.error('[quiz gen] AI failed:', err.message);
    }
  }
  if (!questions.length) questions = heuristicPack(set.source_text, { counts: { quiz: count } }).questions;

  const quizId = db.transaction(() => {
    const id = db.prepare('INSERT INTO quizzes (study_set_id, title, difficulty) VALUES (?,?,?)')
      .run(set.id, `Quiz — ${difficulty[0].toUpperCase() + difficulty.slice(1)}`, difficulty).lastInsertRowid;
    const ins = db.prepare('INSERT INTO quiz_questions (quiz_id, question, type, options, correct_answer, explanation, topic, position) VALUES (?,?,?,?,?,?,?,?)');
    questions.forEach((q, i) => {
      const type = ['multiple_choice', 'true_false', 'short_answer'].includes(q.type) ? q.type : 'multiple_choice';
      let options = Array.isArray(q.options) ? q.options.map(String).slice(0, 6) : [];
      if (type === 'multiple_choice' && options.length < 2) return;
      if (type === 'true_false') options = [];
      ins.run(id, String(q.question).slice(0, 500), type, JSON.stringify(options), String(q.correctAnswer).slice(0, 500),
        String(q.explanation || '').slice(0, 1000), String(q.topic || '').slice(0, 80), i);
    });
    return id;
  })();

  const qn = db.prepare('SELECT COUNT(*) n FROM quiz_questions WHERE quiz_id = ?').get(quizId).n;
  if (!qn) return res.status(502).json({ error: 'Could not generate valid quiz questions. Please try again.' });
  logActivity(req.user.id, set.id, 'quiz_generated', difficulty);
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);
  const qs = db.prepare('SELECT id, question, type, options, topic FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quizId)
    .map(q => ({ ...q, options: JSON.parse(q.options) }));
  res.status(201).json({ quiz: { ...quiz, questions: qs }, generatedBy });
});

router.delete('/quizzes/:quizId', (req, res) => {
  const quiz = ownedQuiz(req, res);
  if (!quiz) return;
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(quiz.id);
  res.json({ ok: true });
});

// Submit an attempt: grade, save, return full results with explanations
router.post('/quizzes/:quizId/submit', async (req, res) => {
  const quiz = ownedQuiz(req, res);
  if (!quiz) return;
  const submitted = Array.isArray((req.body || {}).answers) ? req.body.answers : [];
  const rows = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quiz.id);

  const results = [];
  for (const q of rows) {
    const givenRaw = submitted.find(a => String(a.questionId) === String(q.id));
    const given = givenRaw ? String(givenRaw.answer || '').trim() : '';
    let correct = false, feedback = null;

    if (given) {
      if (q.type === 'multiple_choice' || q.type === 'true_false') {
        correct = normalize(given) === normalize(q.correct_answer);
      } else {
        // short answer: exact/normalized, then token overlap, then AI grading if available
        correct = normalize(given) === normalize(q.correct_answer) || tokenOverlap(given, q.correct_answer) >= 0.6;
        if (!correct && aiAvailable()) {
          try {
            const g = await chatJSON(
              'You grade short-answer quiz responses. Answer with JSON only: {"correct": true|false, "feedback": "one sentence"}',
              `Question: ${q.question}\nModel answer: ${q.correct_answer}\nStudent answer: ${given}\nIs the student answer substantively correct?`,
              300
            );
            correct = Boolean(g.correct);
            feedback = g.feedback || null;
          } catch { /* keep heuristic verdict */ }
        }
      }
    }
    results.push({
      questionId: q.id, question: q.question, type: q.type, options: JSON.parse(q.options),
      yourAnswer: given, correctAnswer: q.correct_answer, correct, explanation: q.explanation, topic: q.topic,
      feedback
    });
  }

  const score = results.filter(r => r.correct).length;
  const total = results.length;
  const percentage = total ? Math.round((score / total) * 1000) / 10 : 0;

  db.transaction(() => {
    db.prepare('INSERT INTO quiz_attempts (quiz_id, user_id, score, total, percentage, answers) VALUES (?,?,?,?,?,?)')
      .run(quiz.id, req.user.id, score, total, percentage, JSON.stringify(results.map(r => ({ questionId: r.questionId, topic: r.topic, correct: r.correct }))));
    db.prepare('UPDATE study_sets SET last_studied_at = ? WHERE id = ?')
      .run(new Date().toISOString().slice(0, 19).replace('T', ' '), quiz.study_set_id);
  })();
  logActivity(req.user.id, quiz.study_set_id, 'quiz_attempt', `${score}/${total}`);

  const topics = {};
  for (const r of results) {
    const t = r.topic || 'General';
    topics[t] = topics[t] || { topic: t, correct: 0, total: 0 };
    topics[t].total++; if (r.correct) topics[t].correct++;
  }
  res.json({
    attempt: { score, total, percentage, completed_at: new Date().toISOString() },
    results, topics: Object.values(topics)
  });
});

module.exports = router;
