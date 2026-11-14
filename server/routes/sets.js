const express = require('express');
const multer = require('multer');
const path = require('path');
const { db, logActivity, logUsage, usageToday } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '10', 10);
const ALLOWED_EXT = ['.pdf', '.txt', '.docx', '.md'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return cb(Object.assign(new Error('This file type isn\'t supported yet. Supported: PDF, TXT, DOCX, MD.'), { status: 415 }));
    cb(null, true);
  }
});

async function extractTextFromFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const out = await pdfParse(file.buffer);
    return out.text || '';
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const out = await mammoth.extractRawText({ buffer: file.buffer });
    return out.value || '';
  }
  return file.buffer.toString('utf8');
}

function assertOwner(req, res) {
  const id = req.params.id ?? req.params.setId;
  const set = db.prepare('SELECT * FROM study_sets WHERE id = ?').get(id);
  if (!set) { res.status(404).json({ error: 'Study set not found.' }); return null; }
  if (set.user_id !== req.user.id) { res.status(403).json({ error: 'You do not have access to this study set.' }); return null; }
  return set;
}

function setStats(setId) {
  const decks = db.prepare('SELECT id FROM decks WHERE study_set_id = ?').all(setId);
  let cards = 0, known = 0, review = 0;
  for (const d of decks) {
    const row = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN status='known' THEN 1 ELSE 0 END) k, SUM(CASE WHEN status='need_review' THEN 1 ELSE 0 END) r FROM flashcards WHERE deck_id = ?`).get(d.id);
    cards += row.n; known += row.k || 0; review += row.r || 0;
  }
  const quizzes = db.prepare('SELECT id FROM quizzes WHERE study_set_id = ?').all(setId);
  let attempts = 0, bestPct = null, lastPct = null;
  for (const q of quizzes) {
    const a = db.prepare('SELECT percentage FROM quiz_attempts WHERE quiz_id = ? ORDER BY completed_at DESC').all(q.id);
    attempts += a.length;
    if (a.length) {
      lastPct = a[0].percentage;
      const mx = Math.max(...a.map(x => x.percentage));
      bestPct = bestPct === null ? mx : Math.max(bestPct, mx);
    }
  }
  const concepts = db.prepare('SELECT COUNT(*) n FROM concepts WHERE study_set_id = ?').get(setId).n;
  const qn = db.prepare('SELECT COUNT(*) n FROM quiz_questions qq JOIN quizzes q ON qq.quiz_id = q.id WHERE q.study_set_id = ?').get(setId).n;
  const progress = cards > 0 ? Math.round(((known / cards) * 0.7 + (bestPct !== null ? bestPct : 0) / 100 * 0.3) * 100) : (bestPct !== null ? Math.round(bestPct) : 0);
  return { cards, known, review, concepts, quizQuestions: qn, quizAttempts: attempts, bestQuizPct: bestPct, lastQuizPct: lastPct, progress };
}

// ── Create study set (text paste or file upload) + process ──────────────
const FREE_MAX_SETS = parseInt(process.env.FREE_MAX_STUDY_SETS || '5', 10);

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const body = req.body || {};
    let title = (body.title || '').trim();
    let subject = (body.subject || '').trim();
    let text = (body.text || '').trim();
    let sourceType = 'text';

    if (req.file) {
      if (text && text.length > 100) return res.status(400).json({ error: 'Provide either pasted text or a file, not both.' });
      sourceType = path.extname(req.file.originalname).toLowerCase().replace('.', '') || 'file';
      text = await extractTextFromFile(req.file);
      if (!title) title = path.basename(req.file.originalname, path.extname(req.file.originalname));
    }
    title = title || 'Untitled study set';
    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'Your material is too short. Paste at least a paragraph (or upload a readable file) so StudySnap has something to work with.' });
    }
    text = text.slice(0, 200000);

    const count = db.prepare('SELECT COUNT(*) n FROM study_sets WHERE user_id = ?').get(req.user.id).n;
    if (count >= FREE_MAX_SETS) {
      return res.status(403).json({ error: `Free plan is limited to ${FREE_MAX_SETS} active study sets. Delete one or upgrade (coming soon).`, code: 'set_limit' });
    }

    const info = db.prepare(`INSERT INTO study_sets (user_id, title, subject, source_text, source_type, word_count, status) VALUES (?,?,?,?,?,?, 'processing')`)
      .run(req.user.id, title.slice(0, 150), subject.slice(0, 60) || 'General', text, sourceType, text.split(/\s+/).length);
    const setId = info.lastInsertRowid;

    // Run the AI pipeline (falls back to clearly-labelled local extraction on failure)
    const { processStudySet } = require('../pipeline');
    const result = await processStudySet(setId, body.style || 'standard');
    logActivity(req.user.id, setId, 'set_created', title);
    logUsage(req.user.id, result.generatedBy === 'ai' ? 'ai_generation' : 'offline_generation');

    const set = db.prepare('SELECT * FROM study_sets WHERE id = ?').get(setId);
    res.status(201).json({ set: { ...set, stats: setStats(setId) }, generatedBy: result.generatedBy, notice: result.notice });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `This file is too large. Please upload a smaller file (max ${MAX_MB} MB).` });
    if (err.status === 415) return res.status(415).json({ error: err.message });
    console.error('[create set]', err);
    res.status(500).json({ error: 'Something went wrong while creating your study set. Please try again.' });
  }
});

// ── List / search / filter / sort ────────────────────────────────────────
router.get('/', (req, res) => {
  const { q = '', filter = '', sort = 'recent' } = req.query;
  let rows = db.prepare('SELECT * FROM study_sets WHERE user_id = ?').all(req.user.id);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(r => r.title.toLowerCase().includes(needle) || r.subject.toLowerCase().includes(needle) || r.source_text.toLowerCase().includes(needle));
  }
  const enriched = rows.map(r => ({ ...r, stats: setStats(r.id) }));
  let out = enriched;
  if (filter === 'needs_review') out = enriched.filter(r => r.stats.review > 0);
  if (filter === 'recently_studied') out = enriched.filter(r => r.last_studied_at);
  if (filter === 'has_quiz_score') out = enriched.filter(r => r.stats.bestQuizPct !== null);
  const sorters = {
    recent: (a, b) => (b.last_studied_at || b.updated_at).localeCompare(a.last_studied_at || a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    score: (a, b) => (b.stats.bestQuizPct ?? -1) - (a.stats.bestQuizPct ?? -1),
    title: (a, b) => a.title.localeCompare(b.title)
  };
  out.sort(sorters[sort] || sorters.recent);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const per = Math.min(50, parseInt(req.query.per || '20', 10));
  res.json({ sets: out.slice((page - 1) * per, page * per), total: out.length, page, per });
});

// ── Full workspace payload ───────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const summaries = db.prepare('SELECT * FROM summaries WHERE study_set_id = ?').all(set.id);
  const concepts = db.prepare('SELECT * FROM concepts WHERE study_set_id = ? ORDER BY position, id').all(set.id);
  const decks = db.prepare('SELECT * FROM decks WHERE study_set_id = ? ORDER BY id').all(set.id)
    .map(d => ({ ...d, cards: db.prepare('SELECT * FROM flashcards WHERE deck_id = ? ORDER BY position, id').all(d.id) }));
  const quizzes = db.prepare('SELECT * FROM quizzes WHERE study_set_id = ? ORDER BY id DESC').all(set.id)
    .map(q => {
      const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(q.id)
        .map(qq => ({ id: qq.id, question: qq.question, type: qq.type, options: JSON.parse(qq.options), topic: qq.topic })); // correct answers excluded pre-submission
      const attempts = db.prepare('SELECT id, score, total, percentage, completed_at FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? ORDER BY completed_at DESC').all(q.id, req.user.id);
      return { ...q, questions, attempts };
    });
  const note = db.prepare('SELECT * FROM notes WHERE study_set_id = ? AND user_id = ?').get(set.id, req.user.id);
  res.json({ set: { ...set, stats: setStats(set.id) }, summaries, concepts, decks, quizzes, note: note ? note.content : '', generatedBy: set.ai_generated ? 'ai' : 'heuristic' });
});

router.patch('/:id', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const { title, subject } = req.body || {};
  if (typeof title === 'string' && title.trim()) db.prepare('UPDATE study_sets SET title = ?, updated_at = ? WHERE id = ?').run(title.trim().slice(0, 150), new Date().toISOString().slice(0, 19).replace('T', ' '), set.id);
  if (typeof subject === 'string' && subject.trim()) db.prepare('UPDATE study_sets SET subject = ? WHERE id = ?').run(subject.trim().slice(0, 60), set.id);
  const updated = db.prepare('SELECT * FROM study_sets WHERE id = ?').get(set.id);
  res.json({ set: { ...updated, stats: setStats(set.id) } });
});

router.delete('/:id', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  db.prepare('DELETE FROM study_sets WHERE id = ?').run(set.id);
  res.json({ ok: true });
});

// Regenerate with a different summary style (consumes an AI generation)
router.post('/:id/regenerate', async (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const style = ['quick', 'standard', 'detailed', 'exam'].includes((req.body || {}).style) ? req.body.style : 'standard';
  try {
    const { processStudySet } = require('../pipeline');
    const result = await processStudySet(set.id, style, { replaceSummaryOnly: true });
    logUsage(req.user.id, result.generatedBy === 'ai' ? 'ai_generation' : 'offline_generation');
    res.json({ ok: true, generatedBy: result.generatedBy });
  } catch (err) {
    console.error('[regenerate]', err);
    res.status(502).json({ error: 'StudySnap couldn\'t reach the AI service. Please try again.' });
  }
});

router.get('/:id/usage', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  res.json({ usedToday: usageToday(req.user.id), limit: parseInt(process.env.FREE_DAILY_AI_CALLS || '25', 10) });
});

module.exports = { router, setStats, assertOwner };
