require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// simple in-memory API rate limit (per IP)
const hits = new Map();
app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  hits.set(key, entry);
  if (entry.count > 300) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  next();
});

const authRoutes = require('./server/routes/auth');
const { router: setsRouter } = require('./server/routes/sets');
const flashcardsRoutes = require('./server/routes/flashcards');
const quizzesRoutes = require('./server/routes/quizzes');
const tutorRoutes = require('./server/routes/tutor');
const progressRoutes = require('./server/routes/progress');

app.use('/api/auth', authRoutes);
app.use('/api/sets', setsRouter);
app.use('/api', flashcardsRoutes);     // /api/cards/:id, /api/decks/:id, /api/sets/:id/decks
app.use('/api', quizzesRoutes);        // /api/quizzes/:id, /api/sets/:id/quizzes
app.use('/api', tutorRoutes);          // /api/sets/:id/tutor
app.use('/api', progressRoutes);       // /api/progress, /api/review, notes

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// static frontend + SPA fallback
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/*splat', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// central error handler — never leak stack traces
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `This file is too large. Please upload a smaller file (max ${parseInt(process.env.MAX_UPLOAD_MB || '10', 10)} MB).` });
  if (err && (err.status === 415 || /supported/i.test(String(err.message || '')))) { console.error('[415 path]', err.status, err.message); return res.status(415).json({ error: err.message }); }
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  const { aiAvailable } = require('./server/ai');
  console.log(`StudySnap running on http://localhost:${PORT}`);
  console.log(aiAvailable() ? `AI generation enabled (${process.env.AI_MODEL || 'default model'} @ ${process.env.AI_BASE_URL || 'https://api.openai.com/v1'})`
                            : '⚠ No AI_API_KEY configured — study sets will use clearly-labelled offline extraction.');
});
