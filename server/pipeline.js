/**
 * StudySnap processing pipeline: validate → clean → analyse → generate
 * structured study data → persist. Uses the real AI service when
 * AI_API_KEY is configured; otherwise a clearly-labelled local heuristic
 * extraction so the product still works offline (never presented as AI).
 */
const { db, logActivity } = require('./db');
const { aiAvailable, generateStudyPack } = require('./ai');
const { heuristicPack } = require('./fallback');

const FREE_DAILY = () => parseInt(process.env.FREE_DAILY_AI_CALLS || '25', 10);
const { usageToday } = require('./db');

function clean(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u200b\u200e\u200f]/g, '')
    .trim();
}

function validateAIOutput(out) {
  const ok =
    out && typeof out === 'object' &&
    typeof out.summary === 'object' && typeof out.summary.content === 'string' && out.summary.content.length > 10 &&
    Array.isArray(out.concepts) && out.concepts.every(c => c && typeof c.title === 'string' && typeof c.explanation === 'string') &&
    Array.isArray(out.cards) && out.cards.every(c => c && typeof c.question === 'string' && typeof c.answer === 'string') &&
    Array.isArray(out.questions) && out.questions.every(q => q && typeof q.question === 'string' && typeof q.correctAnswer === 'string');
  return ok;
}

async function processStudySet(setId, style = 'standard', opts = {}) {
  const set = db.prepare('SELECT * FROM study_sets WHERE id = ?').get(setId);
  if (!set) throw new Error('Study set not found');
  const text = clean(set.source_text);

  let pack = null, generatedBy = 'heuristic', notice = null;
  const dailyUsed = usageToday(set.user_id);

  if (aiAvailable() && dailyUsed < FREE_DAILY()) {
    try {
      const candidate = await generateStudyPack(text, { style, counts: { cards: 12, quiz: 8, concepts: 8 } });
      if (validateAIOutput(candidate)) { pack = candidate; generatedBy = 'ai'; }
      else throw new Error('AI output failed validation');
    } catch (err) {
      console.error('[pipeline] AI generation failed:', err.message);
      pack = heuristicPack(text, { style });
      notice = 'StudySnap couldn\'t reach the AI service, so this study set was built with offline extraction. You can regenerate once the AI service is back.';
    }
  } else if (aiAvailable() && dailyUsed >= FREE_DAILY()) {
    pack = heuristicPack(text, { style });
    notice = 'You\'ve reached today\'s free AI generation limit. This set was built with offline extraction — your limit resets tomorrow.';
  } else {
    pack = heuristicPack(text, { style });
    notice = 'No AI key is configured on this server, so offline extraction was used. Set AI_API_KEY to enable full AI generation.';
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE study_sets SET subject = COALESCE(NULLIF(?, \'\'), subject), status = \'ready\', ai_generated = ?, updated_at = ? WHERE id = ?')
      .run(String(pack.subject || ''), generatedBy === 'ai' ? 1 : 0, new Date().toISOString().slice(0, 19).replace('T', ' '), setId);

    if (opts.replaceSummaryOnly) {
      db.prepare(`INSERT INTO summaries (study_set_id, summary_type, headline, key_points, formulas, content, edited)
                  VALUES (?,?,?,?,?,?,0)
                  ON CONFLICT (study_set_id, summary_type) DO UPDATE SET headline=excluded.headline, key_points=excluded.key_points, formulas=excluded.formulas, content=excluded.content, edited=0`)
        .run(setId, style, String(pack.summary.headline || ''), JSON.stringify(pack.summary.key_points || []), JSON.stringify(pack.summary.formulas || []), String(pack.summary.content || ''));
    } else {
      db.prepare('DELETE FROM summaries WHERE study_set_id = ?').run(setId);
      db.prepare('DELETE FROM concepts WHERE study_set_id = ?').run(setId);
      db.prepare('DELETE FROM decks WHERE study_set_id = ?').run(setId); // cascade removes cards
      db.prepare('DELETE FROM quizzes WHERE study_set_id = ?').run(setId); // cascade removes questions

      db.prepare(`INSERT INTO summaries (study_set_id, summary_type, headline, key_points, formulas, content) VALUES (?,?,?,?,?,?)`)
        .run(setId, style, String(pack.summary.headline || ''), JSON.stringify(pack.summary.key_points || []), JSON.stringify(pack.summary.formulas || []), String(pack.summary.content || ''));

      const insC = db.prepare('INSERT INTO concepts (study_set_id, title, explanation, details, example, position) VALUES (?,?,?,?,?,?)');
      (pack.concepts || []).slice(0, 15).forEach((c, i) =>
        insC.run(setId, String(c.title).slice(0, 120), String(c.explanation || ''), String(c.details || ''), String(c.example || ''), i));

      const deckId = db.prepare('INSERT INTO decks (study_set_id, title) VALUES (?,?)').run(setId, 'Generated deck').lastInsertRowid;
      const insF = db.prepare('INSERT INTO flashcards (deck_id, question, answer, position) VALUES (?,?,?,?)');
      (pack.cards || []).slice(0, 30).forEach((c, i) => insF.run(deckId, String(c.question).slice(0, 500), String(c.answer).slice(0, 1000), i));

      const quizId = db.prepare('INSERT INTO quizzes (study_set_id, title, difficulty) VALUES (?,?,?)').run(setId, 'Generated quiz', 'medium').lastInsertRowid;
      const insQ = db.prepare('INSERT INTO quiz_questions (quiz_id, question, type, options, correct_answer, explanation, topic, position) VALUES (?,?,?,?,?,?,?,?)');
      (pack.questions || []).slice(0, 20).forEach((q, i) => {
        const type = ['multiple_choice', 'true_false', 'short_answer'].includes(q.type) ? q.type : 'multiple_choice';
        const options = Array.isArray(q.options) ? q.options.map(o => String(o)).slice(0, 6) : [];
        if (type === 'multiple_choice' && options.length < 2) return;
        if (type === 'true_false') { options.length = 0; }
        insQ.run(quizId, String(q.question).slice(0, 500), type, JSON.stringify(options), String(q.correctAnswer).slice(0, 500), String(q.explanation || '').slice(0, 1000), String(q.topic || '').slice(0, 80), i);
      });
    }
  });
  tx();
  logActivity(set.user_id, setId, 'processed', style);
  return { generatedBy, notice };
}

module.exports = { processStudySet, clean };
