const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { db, logActivity } = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth, publicUser } = require('../middleware');

const router = express.Router();

// In-memory password-reset tokens (documented: reset emails need a mail service;
// in development the token is returned so the flow is testable end-to-end).
const resetTokens = new Map(); // token -> { userId, expires }

const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200)
});
const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

router.post('/register', (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { name, email, password } = parsed.data;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)').run(name, email, hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  logActivity(user.id, null, 'account_created');
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ user: publicUser(user), token });
});

router.post('/login', (req, res) => {
  const parsed = LoginSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const { email, password } = parsed.data;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: publicUser(user), token });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Settings: profile + preferences
router.patch('/me', requireAuth, (req, res) => {
  const body = req.body || {};
  if (typeof body.name === 'string' && body.name.trim()) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name.trim().slice(0, 80), req.user.id);
  }
  if (body.newPassword !== undefined) {
    const { currentPassword } = body;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!currentPassword || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(403).json({ error: 'Current password is incorrect.' });
    }
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.newPassword, 10), req.user.id);
  }
  if (body.prefs && typeof body.prefs === 'object') {
    const current = JSON.parse(db.prepare('SELECT prefs FROM users WHERE id = ?').get(req.user.id).prefs || '{}');
    const merged = { ...current, ...body.prefs };
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(merged), req.user.id);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Password reset
router.post('/forgot-password', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const token = require('crypto').randomBytes(24).toString('hex');
    resetTokens.set(token, { userId: user.id, expires: Date.now() + 1000 * 60 * 30 });
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ok: true, message: 'Reset token generated (development mode — no mail service configured).', devResetToken: token });
    }
  }
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
});

router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  const entry = resetTokens.get(String(token || ''));
  if (!entry || entry.expires < Date.now()) return res.status(400).json({ error: 'Reset link is invalid or expired.' });
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), entry.userId);
  resetTokens.delete(String(token));
  res.json({ ok: true });
});

// Data export + account deletion
router.get('/me/export', requireAuth, (req, res) => {
  const uid = req.user.id;
  const sets = db.prepare('SELECT * FROM study_sets WHERE user_id = ?').all(uid);
  const dump = { exported_at: new Date().toISOString(), user: publicUser(req.user), study_sets: sets.map(s => ({
    ...s,
    summaries: db.prepare('SELECT * FROM summaries WHERE study_set_id = ?').all(s.id),
    concepts: db.prepare('SELECT * FROM concepts WHERE study_set_id = ?').all(s.id),
    decks: db.prepare('SELECT * FROM decks WHERE study_set_id = ?').all(s.id).map(d => ({ ...d, cards: db.prepare('SELECT * FROM flashcards WHERE deck_id = ?').all(d.id) })),
    quizzes: db.prepare('SELECT * FROM quizzes WHERE study_set_id = ?').all(s.id).map(q => ({ ...q, questions: db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ?').all(q.id), attempts: db.prepare('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?').all(q.id, uid) })),
    notes: db.prepare('SELECT * FROM notes WHERE study_set_id = ? AND user_id = ?').all(s.id, uid)
  })) };
  res.setHeader('Content-Disposition', 'attachment; filename="studysnap-export.json"');
  res.json(dump);
});

router.delete('/me', requireAuth, (req, res) => {
  const { confirmPassword } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!confirmPassword || !bcrypt.compareSync(confirmPassword, row.password_hash)) {
    return res.status(403).json({ error: 'Confirm your password to delete your account.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  clearAuthCookie(res);
  res.json({ ok: true });
});

module.exports = router;
