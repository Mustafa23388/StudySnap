const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../middleware');
const { assertOwner } = require('./sets');

const router = express.Router();
router.use(requireAuth);

function ownedDeck(req, res) {
  const deck = db.prepare(`
    SELECT d.*, s.user_id AS owner_id FROM decks d JOIN study_sets s ON s.id = d.study_set_id WHERE d.id = ?`).get(req.params.deckId);
  if (!deck) { res.status(404).json({ error: 'Deck not found.' }); return null; }
  if (deck.owner_id !== req.user.id) { res.status(403).json({ error: 'You do not have access to this deck.' }); return null; }
  return deck;
}

function ownedCard(req, res) {
  const card = db.prepare(`
    SELECT f.*, s.user_id AS user_id_owner FROM flashcards f
    JOIN decks d ON d.id = f.deck_id
    JOIN study_sets s ON s.id = d.study_set_id
    WHERE f.id = ?`).get(req.params.cardId);
  if (!card) { res.status(404).json({ error: 'Card not found.' }); return null; }
  if (card.user_id_owner !== req.user.id) { res.status(403).json({ error: 'You do not have access to this card.' }); return null; }
  return card;
}

function touchSet(setId) {
  db.prepare('UPDATE study_sets SET last_studied_at = ? WHERE id = ?')
    .run(new Date().toISOString().slice(0, 19).replace('T', ' '), setId);
}

// Mark a card Known / Need Review / unseen (progress tracking)
router.patch('/cards/:cardId', (req, res) => {
  const card = ownedCard(req, res);
  if (!card) return;
  const status = (req.body || {}).status;
  if (!['known', 'need_review', 'unseen'].includes(status)) {
    return res.status(400).json({ error: 'status must be known, need_review or unseen.' });
  }
  db.prepare(`UPDATE flashcards SET status = ?, review_count = review_count + ?, last_reviewed = ? WHERE id = ?`)
    .run(status, status === 'unseen' ? 0 : 1, new Date().toISOString().slice(0, 19).replace('T', ' '), card.id);
  touchSet(card.deck_id);
  logActivity(req.user.id, card.deck_id, status === 'known' ? 'card_known' : 'card_review', card.question.slice(0, 80));
  const updated = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(card.id);
  res.json({ card: updated });
});

// Create an empty deck in a study set (for user-added cards)
router.post('/sets/:setId/decks', (req, res) => {
  const set = assertOwner(req, res);
  if (!set) return;
  const title = String((req.body || {}).title || '').trim().slice(0, 120) || 'My deck';
  const id = db.prepare('INSERT INTO decks (study_set_id, title) VALUES (?,?)').run(set.id, title).lastInsertRowid;
  res.status(201).json({ deck: { ...db.prepare('SELECT * FROM decks WHERE id = ?').get(id), cards: [] } });
});

router.patch('/decks/:deckId', (req, res) => {
  const deck = ownedDeck(req, res);
  if (!deck) return;
  const title = String((req.body || {}).title || '').trim();
  if (!title) return res.status(400).json({ error: 'Deck title cannot be empty.' });
  db.prepare('UPDATE decks SET title = ? WHERE id = ?').run(title.slice(0, 120), deck.id);
  res.json({ deck: db.prepare('SELECT * FROM decks WHERE id = ?').get(deck.id) });
});

router.delete('/decks/:deckId', (req, res) => {
  const deck = ownedDeck(req, res);
  if (!deck) return;
  db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);
  res.json({ ok: true });
});

// Add your own card
router.post('/decks/:deckId/cards', (req, res) => {
  const deck = ownedDeck(req, res);
  if (!deck) return;
  const { question, answer } = req.body || {};
  if (!question || !String(question).trim() || !answer || !String(answer).trim()) {
    return res.status(400).json({ error: 'A flashcard needs both a question and an answer.' });
  }
  const pos = db.prepare('SELECT COALESCE(MAX(position),0) p FROM flashcards WHERE deck_id = ?').get(deck.id).p + 1;
  const id = db.prepare('INSERT INTO flashcards (deck_id, question, answer, position) VALUES (?,?,?,?)')
    .run(deck.id, String(question).trim().slice(0, 500), String(answer).trim().slice(0, 1000), pos).lastInsertRowid;
  res.status(201).json({ card: db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id) });
});

router.patch('/decks/:deckId/cards/:cardId', (req, res) => {
  const deck = ownedDeck(req, res);
  if (!deck) return;
  const card = db.prepare('SELECT * FROM flashcards WHERE id = ? AND deck_id = ?').get(req.params.cardId, deck.id);
  if (!card) return res.status(404).json({ error: 'Card not found.' });
  const { question, answer } = req.body || {};
  if (typeof question === 'string' && question.trim()) db.prepare('UPDATE flashcards SET question = ? WHERE id = ?').run(question.trim().slice(0, 500), card.id);
  if (typeof answer === 'string' && answer.trim()) db.prepare('UPDATE flashcards SET answer = ? WHERE id = ?').run(answer.trim().slice(0, 1000), card.id);
  res.json({ card: db.prepare('SELECT * FROM flashcards WHERE id = ?').get(card.id) });
});

router.delete('/decks/:deckId/cards/:cardId', (req, res) => {
  const deck = ownedDeck(req, res);
  if (!deck) return;
  const card = db.prepare('SELECT * FROM flashcards WHERE id = ? AND deck_id = ?').get(req.params.cardId, deck.id);
  if (!card) return res.status(404).json({ error: 'Card not found.' });
  db.prepare('DELETE FROM flashcards WHERE id = ?').run(card.id);
  res.json({ ok: true });
});

module.exports = router;
