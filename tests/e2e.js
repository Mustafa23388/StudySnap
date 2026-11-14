/**
 * StudySnap end-to-end test — runs the full 20-step user flow against a running
 * server using Node's built-in fetch. No AI key is required: when AI_API_KEY is
 * absent the pipeline uses the clearly-labelled offline extractor, so this
 * verifies the complete product loop (auth → create → generate → study → quiz →
 * tutor → notes → progress → review → logout/login persistence + data isolation).
 *
 * Usage: node tests/e2e.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3000';
let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
};

function client() {
  let cookie = '';
  return async function req(method, path, body, isForm = false) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (isForm) { payload = body; }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}

const MATERIAL = `Photosynthesis is the process by which green plants convert light energy into chemical energy. Chloroplasts contain the green pigment chlorophyll, which absorbs light. The overall equation is 6CO2 + 6H2O + light -> C6H12O6 + 6O2.

Photosynthesis happens in two stages. The light-dependent reactions occur in the thylakoid membranes and produce ATP and NADPH. The Calvin cycle occurs in the stroma and uses ATP and NADPH to fix carbon dioxide into glucose.

The rate of photosynthesis depends on light intensity, carbon dioxide concentration, and temperature. Stomata are small pores on leaves that let carbon dioxide in and oxygen out.`;

(async () => {
  console.log(`\nStudySnap E2E — ${BASE}\n`);

  // ── Step 1-2: register two users (A and B) ──
  const A = client(), B = client();
  const uniq = Date.now();
  let r = await A('POST', '/api/auth/register', { name: 'Alice Tester', email: `alice${uniq}@test.dev`, password: 'password123' });
  ok('1. User A registers', r.status === 201 && r.data.user && r.data.user.id > 0, JSON.stringify(r.data));
  const uidA = r.data.user.id;
  r = await B('POST', '/api/auth/register', { name: 'Bob Tester', email: `bob${uniq}@test.dev`, password: 'password123' });
  ok('2. User B registers', r.status === 201);
  const uidB = r.data.user.id;
  ok('   Data isolation: different user ids', uidA !== uidB);

  // duplicate email rejected
  const C = client();
  r = await C('POST', '/api/auth/register', { name: 'X', email: `alice${uniq}@test.dev`, password: 'password123' });
  ok('   Duplicate email rejected (409)', r.status === 409);
  r = await C('POST', '/api/auth/login', { email: `alice${uniq}@test.dev`, password: 'wrongpass' });
  ok('   Wrong password rejected (401)', r.status === 401);

  // ── Step 3-4: create study set (pasted text) ──
  r = await A('POST', '/api/sets', { text: MATERIAL, title: 'Biology — Photosynthesis', subject: 'Biology', style: 'standard' });
  ok('3. User A creates study set from pasted notes', r.status === 201 && r.data.set, JSON.stringify(r.data));
  const setId = r.data.set.id;
  ok('4. Material processed (status=ready)', r.data.set.status === 'ready', r.data.set.status);
  console.log(`   generatedBy: ${r.data.generatedBy}${r.data.notice ? ' — notice: ' + r.data.notice : ''}`);

  // validation cases
  r = await A('POST', '/api/sets', { text: 'too short' });
  ok('   Too-short input rejected (400)', r.status === 400);
  r = await A('POST', '/api/sets', {});
  ok('   Empty input rejected (400)', r.status === 400);

  // ── Steps 5-10: AI pipeline output persisted ──
  r = await A('GET', `/api/sets/${setId}`);
  const ws = r.data;
  ok('5. Summary generated & saved', ws.summaries.length >= 1 && ws.summaries[0].content.length > 20);
  ok('6. Key concepts extracted', ws.concepts.length >= 3);
  ok('7. Flashcards generated', ws.decks.length >= 1 && ws.decks[0].cards.length >= 5, `cards=${ws.decks[0] && ws.decks[0].cards.length}`);
  ok('8. Quiz questions generated', ws.quizzes.length >= 1 && ws.quizzes[0].questions.length >= 3, `questions=${ws.quizzes[0] && ws.quizzes[0].questions.length}`);
  ok('9. Quiz API hides correct answers pre-submission', !('correct_answer' in (ws.quizzes[0].questions[0] || {})) && !('correctAnswer' in (ws.quizzes[0].questions[0] || {})));
  ok('10. Workspace reloads with saved data', ws.set.title === 'Biology — Photosynthesis');

  // ── Step 12: ownership isolation ──
  r = await B('GET', `/api/sets/${setId}`);
  ok('12. User B gets 403 on A\'s study set', r.status === 403, `got ${r.status}`);
  r = await B('PATCH', `/api/sets/${setId}`, { title: 'hacked' });
  ok('   User B cannot modify A\'s set (403)', r.status === 403);
  r = await B('DELETE', `/api/sets/${setId}`);
  ok('   User B cannot delete A\'s set (403)', r.status === 403);
  r = await C('GET', `/api/sets/${setId}`);
  ok('   Logged-out user gets 401', r.status === 401);

  // ── Step 13: flashcard study loop ──
  const deck = ws.decks[0];
  const card1 = deck.cards[0], card2 = deck.cards[1];
  r = await A('PATCH', `/api/cards/${card1.id}`, { status: 'known' });
  ok('13a. Card marked Known', r.status === 200 && r.data.card.status === 'known');
  r = await A('PATCH', `/api/cards/${card2.id}`, { status: 'need_review' });
  ok('13b. Card marked Need Review', r.status === 200 && r.data.card.status === 'need_review');
  r = await B('PATCH', `/api/cards/${card1.id}`, { status: 'known' });
  ok('   User B cannot mark A\'s card (403)', r.status === 403);
  // user adds own card
  r = await A('POST', `/api/decks/${deck.id}/cards`, { question: 'What do stomata do?', answer: 'Let CO2 in and O2 out through small pores on leaves.' });
  ok('13c. User adds own flashcard', r.status === 201);
  r = await A('PATCH', `/api/decks/${deck.id}`, { title: 'Photosynthesis Deck' });
  ok('13d. Deck renamed', r.status === 200 && r.data.deck.title === 'Photosynthesis Deck');

  // ── Steps 14-15: quiz attempt + scoring ──
  const quiz = ws.quizzes[0];
  // answer all questions: grab correct answers via a fresh full payload for A only (server grading uses DB)
  // Submit with deliberate answers: submit empty for half, and "True"/first option for the rest
  const answers = quiz.questions.map((q, i) => ({ questionId: q.id, answer: i < 2 ? (q.options[0] || 'True') : '' }));
  r = await A('POST', `/api/quizzes/${quiz.id}/submit`, { answers });
  ok('14. Quiz attempt graded & scored', r.status === 200 && r.data.attempt && r.data.attempt.total === quiz.questions.length, JSON.stringify(r.data.attempt || r.data));
  ok('15. Results include explanations & topics', r.data.results.length === quiz.questions.length && r.data.topics.length >= 1);
  const attempt = r.data.attempt;
  ok('   Percentage math correct', Math.round(attempt.score / attempt.total * 1000) / 10 === attempt.percentage || attempt.percentage === Math.round(attempt.score / attempt.total * 100));

  // generate another quiz with difficulty
  r = await A('POST', `/api/sets/${setId}/quizzes`, { difficulty: 'hard', count: 5 });
  ok('   Second quiz generated (hard)', r.status === 201 && r.data.quiz.questions.length >= 3);

  // ── Step 16: tutor ──
  r = await A('POST', `/api/sets/${setId}/tutor`, { messages: [{ role: 'user', content: 'Where does the Calvin cycle happen?' }], mode: 'explain', scope: 'set' });
  ok('16. Tutor replies using study context', r.status === 200 && r.data.reply && r.data.reply.length > 30, JSON.stringify(r.data).slice(0, 200));
  const tutorMode = r.data.generatedBy;
  console.log(`   tutor generatedBy: ${tutorMode}`);

  // ── Step 17: notes ──
  r = await A('PUT', `/api/sets/${setId}/notes`, { content: 'Remember: light reactions = thylakoid, Calvin cycle = stroma.' });
  ok('17a. Note saved', r.status === 200);
  r = await A('GET', `/api/sets/${setId}/notes`);
  ok('17b. Note persists', r.data.content.includes('Calvin cycle'));
  r = await B('GET', `/api/sets/${setId}/notes`);
  ok('   User B has no access to A\'s notes (403)', r.status === 403);

  // ── Step 18: dashboard statistics from real activity ──
  r = await A('GET', '/api/progress');
  const st = r.data.stats;
  ok('18a. Flashcards reviewed tracked', st.flashcardsReviewed >= 2, `got ${st.flashcardsReviewed}`);
  ok('18b. Quiz attempts tracked', st.quizAttempts >= 1, `got ${st.quizAttempts}`);
  ok('18c. Cards known tracked', st.cardsKnown >= 1);
  ok('18d. Avg quiz score is a real number', st.avgQuizScore !== null);
  r = await B('GET', '/api/progress');
  ok('   User B stats isolated (0 reviews)', r.data.stats.flashcardsReviewed === 0 && r.data.stats.quizAttempts === 0);

  // ── Step 19: review queue ──
  r = await A('GET', '/api/review');
  ok('19. Review shows need-review card first', r.data.cards.length >= 1 && r.data.cards[0].status === 'need_review', JSON.stringify(r.data.cards[0] || {}));

  // ── Step 20: logout / login persistence ──
  r = await A('POST', '/api/auth/logout', {});
  ok('20a. Logout works', r.status === 200);
  r = await A('GET', '/api/auth/me');
  ok('   Session cleared (401)', r.status === 401);
  const A2 = client();
  r = await A2('POST', '/api/auth/login', { email: `alice${uniq}@test.dev`, password: 'password123' });
  ok('20b. Re-login works', r.status === 200);
  r = await A2('GET', `/api/sets/${setId}`);
  ok('20c. Data persists across sessions', r.status === 200 && r.data.decks[0].title === 'Photosynthesis Deck');
  r = await A2('PATCH', '/api/auth/me', { prefs: { summaryStyle: 'detailed', theme: 'light' } });
  ok('20d. Settings/preferences saved', r.status === 200 && r.data.user.prefs.summaryStyle === 'detailed');

  // extra: search & filters
  r = await A2('GET', '/api/sets?q=photosynthesis');
  ok('   Search by title/content works', r.data.sets.length >= 1);
  r = await A2('GET', '/api/sets?filter=needs_review');
  ok('   Filter needs_review works', r.data.sets.length >= 1);

  // summary style regenerate
  r = await A2('POST', `/api/sets/${setId}/regenerate`, { style: 'exam' });
  ok('   Regenerate summary (exam style)', r.status === 200);

  // file upload: TXT via multipart
  const fd = new FormData();
  fd.append('file', new Blob([MATERIAL + '\n\nExtra chapter text about respiration and ATP.'], { type: 'text/plain' }), 'physics-notes.txt');
  r = await A2('POST', '/api/sets', fd, true);
  ok('   TXT upload creates study set', r.status === 201 && r.data.set.source_type === 'txt', JSON.stringify(r.data).slice(0, 150));

  // unsupported file type
  const fd2 = new FormData();
  fd2.append('file', new Blob(['x'], { type: 'application/zip' }), 'evil.zip');
  r = await A2('POST', '/api/sets', fd2, true);
  ok('   Unsupported file rejected (415)', r.status === 415, `got ${r.status}`);

  // export
  r = await A2('GET', '/api/auth/me/export');
  ok('   Data export works', r.status === 200 && r.data && r.data.study_sets);

  console.log(`\n════════════════════════════`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`════════════════════════════\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
