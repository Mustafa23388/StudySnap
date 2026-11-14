const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie('snap_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie('snap_token');
}

function requireAuth(req, res, next) {
  let token = req.cookies && req.cookies.snap_token;
  const h = req.headers.authorization;
  if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, prefs, created_at FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, prefs: JSON.parse(u.prefs || '{}'), created_at: u.created_at };
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, requireAuth, publicUser, JWT_SECRET };
