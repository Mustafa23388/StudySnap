const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'studysnap.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  prefs TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS study_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General',
  source_text TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'text',
  word_count INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_studied_at TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  summary_type TEXT NOT NULL,
  headline TEXT NOT NULL DEFAULT '',
  key_points TEXT NOT NULL DEFAULT '[]',
  formulas TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (study_set_id, summary_type)
);

CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unseen',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  type TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  correct_answer TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  percentage REAL NOT NULL,
  answers TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (study_set_id, user_id)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_set_id INTEGER REFERENCES study_sets(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sets_user ON study_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON flashcards(deck_id);
CREATE INDEX IF NOT EXISTS idx_quiz_q ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id);
`);

const nowISO = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function logActivity(userId, setId, kind, detail = '') {
  db.prepare('INSERT INTO activity (user_id, study_set_id, kind, detail, created_at) VALUES (?,?,?,?,?)')
    .run(userId, setId, kind, detail, nowISO());
}

function logUsage(userId, kind) {
  db.prepare('INSERT INTO usage_log (user_id, kind, created_at) VALUES (?,?,?)').run(userId, kind, nowISO());
}

function usageToday(userId) {
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM usage_log WHERE user_id = ? AND created_at >= date('now','start of day')"
  ).get(userId);
  return row.n;
}

function seedDemo() {
  const demoEmail = 'demo@studysnap.app';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);
  if (existing) return;
  const hash = bcrypt.hashSync('studysnap123', 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .run('Demo Student', demoEmail, hash);
  const uid = info.lastInsertRowid;
  const sample = `Cells are the basic units of life. Every living organism is made of one or more cells, and all cells carry out the processes needed for life: obtaining energy, getting rid of waste, and reproducing.

The cell membrane controls what enters and leaves the cell. Inside, the cytoplasm is a jelly-like substance that holds the organelles in place. The nucleus stores DNA, the genetic material that carries instructions for making proteins.

Mitochondria are organelles responsible for producing most of the cell's ATP through cellular respiration. ATP = ADP + Pi + Energy. Because they supply energy, mitochondria are often called the powerhouse of the cell. Ribosomes build proteins, and the Golgi apparatus packages and ships them.

Plant cells also contain chloroplasts, which capture light energy for photosynthesis, and a rigid cell wall made of cellulose that provides structure.`;
  const setId = db.prepare(
    'INSERT INTO study_sets (user_id, title, subject, source_text, source_type, word_count, status) VALUES (?,?,?,?,?,?,?)'
  ).run(uid, 'Biology — Cell Structure', 'Biology', sample, 'text',
    sample.split(/\s+/).length, 'ready').lastInsertRowid;
  db.prepare('INSERT INTO summaries (study_set_id, summary_type, headline, key_points, formulas, content) VALUES (?,?,?,?,?,?)').run(
    setId, 'standard',
    'Cells are the basic units of life.',
    JSON.stringify([
      'Cells are the basic units of life.',
      'Mitochondria produce ATP through respiration.',
      'The nucleus stores DNA.'
    ]),
    JSON.stringify(['ATP = ADP + Pi + Energy']),
    'Cells are the smallest units that can carry out all the processes of life. They include a cell membrane to control what enters and leaves, cytoplasm to hold organelles, and a nucleus that contains genetic material.'
  );
  const insC = db.prepare('INSERT INTO concepts (study_set_id, title, explanation, details, example, position) VALUES (?,?,?,?,?,?)');
  insC.run(setId, 'Mitochondria', "The organelle responsible for producing most of the cell's ATP.", 'ATP is made through cellular respiration.', 'Muscle cells contain many mitochondria because they need lots of energy.', 0);
  insC.run(setId, 'Cell Membrane', 'Controls what enters and leaves the cell.', 'It is selectively permeable.', 'Oxygen enters and carbon dioxide leaves through the membrane.', 1);
  const deckId = db.prepare('INSERT INTO decks (study_set_id, title) VALUES (?,?)').run(setId, 'Cell Structure Deck').lastInsertRowid;
  const insF = db.prepare('INSERT INTO flashcards (deck_id, question, answer, position) VALUES (?,?,?,?)');
  insF.run(deckId, 'What organelle produces ATP?', 'The mitochondria, through cellular respiration.', 0);
  insF.run(deckId, 'What does the nucleus store?', 'DNA — the genetic material with instructions for making proteins.', 1);
  insF.run(deckId, 'What does the cell membrane control?', 'What enters and leaves the cell.', 2);
  console.log('[db] Seeded demo account demo@studysnap.app / studysnap123');
}

seedDemo();

module.exports = { db, nowISO, logActivity, logUsage, usageToday };
