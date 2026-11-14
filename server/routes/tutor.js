const express = require('express');
const { db, logActivity, logUsage } = require('../db');
const { requireAuth } = require('../middleware');
const { aiAvailable, tutorReply } = require('../ai');
const { assertOwner } = require('./sets');

const router = express.Router();
router.use(requireAuth);

// Offline tutor: retrieve the most relevant passages from the material.
// Clearly labelled as offline — never presented as model output.
function offlineTutor(sourceText, question) {
  const sentences = sourceText.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.length > 25);
  const qWords = new Set((question.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []));
  const scored = sentences.map(s => {
    const words = s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
    let hit = 0; for (const w of words) if (qWords.has(w)) hit++;
    return { s, score: hit };
  }).sort((a, b) => b.score - a.score).filter(x => x.score > 0).slice(0, 3);
  if (!scored.length) {
    return `The AI tutor is currently offline (no AI key is configured on this server), and your material doesn't contain a clear passage matching that question.\n\nYou can still study your summaries, flashcards and quizzes — or configure AI_API_KEY on the server to enable the full AI tutor.`;
  }
  return `The AI tutor is currently offline (no AI key is configured on this server), so here are the most relevant passages from your own material:\n\n` +
    scored.map(x => `• ${x.s.trim()}`).join('\n\n') +
    `\n\nConfigure AI_API_KEY on the server to enable full conversational tutoring.`;
}

const MODES = ['explain', 'detail', 'example', 'quiz', 'understand'];

router.post('/sets/:setId/tutor', async (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last || !String(last.content || '').trim()) return res.status(400).json({ error: 'Ask the tutor a question first.' });
  const mode = MODES.includes(body.mode) ? body.mode : 'explain';
  const scope = body.scope === 'general' ? 'general' : 'set';

  // persist chat per user+set (simple: store latest thread in notes-like table? keep client-side history, server only needs recent messages)
  if (!aiAvailable()) {
    const reply = offlineTutor(set.source_text, String(last.content));
    return res.json({ reply, generatedBy: 'offline' });
  }
  try {
    const reply = await tutorReply({
      sourceText: scope === 'set' ? set.source_text : '',
      messages: messages.slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) })),
      mode, scope
    });
    logUsage(req.user.id, 'ai_generation');
    if (scope === 'set') {
      db.prepare('UPDATE study_sets SET last_studied_at = ? WHERE id = ?').run(new Date().toISOString().slice(0, 19).replace('T', ' '), set.id);
    }
    logActivity(req.user.id, set.id, 'tutor_message', String(last.content).slice(0, 80));
    res.json({ reply, generatedBy: 'ai' });
  } catch (err) {
    console.error('[tutor]', err.message);
    res.status(err.status === 429 ? 429 : 502).json({ error: 'StudySnap couldn\'t reach the AI service. Please try again.' });
  }
});

module.exports = router;
