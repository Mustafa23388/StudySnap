/**
 * Local heuristic generator — used ONLY when no AI_API_KEY is configured or the
 * AI call fails, so the user is never stuck. Output is saved with
 * ai_generated = 0 / generatedBy: 'heuristic' and the UI labels it
 * "Offline study notes (no AI key configured)" so it is never presented as AI output.
 */
const STOP = new Set('the a an and or of to in is are was were be been it its that this these those for with on at as by from can will not their they he she we you i which what when where how who whom whose if then than so such into over under about after before between during through also more most other some any each every both few many much no nor only own same too very just because while'.split(' '));

function sentences(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 20);
}

function keywords(text, n = 10) {
  const freq = {};
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
    if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function heuristicPack(sourceText, { style = 'standard', counts = {} } = {}) {
  const text = sourceText.replace(/\s+/g, ' ').trim();
  const sents = sentences(sourceText);
  const kw = keywords(text, 12);
  const take = (n) => sents.slice(0, n).join(' ');
  const headline = sents[0] ? sents[0].slice(0, 160) : 'Study material processed.';
  const content = style === 'quick'
    ? take(2)
    : style === 'detailed'
      ? sents.slice(0, 8).join(' ')
      : take(4);
  const keyPoints = sents.slice(0, 5).map(s => (s.length > 140 ? s.slice(0, 137) + '…' : s));
  const formulas = (sourceText.match(/[A-Za-z0-9)\]\s+]*=[^.\n]{2,60}/g) || [])
    .map(s => s.trim()).filter(s => s.length < 70 && /[A-Za-z]/.test(s)).slice(0, 3);

  const concepts = kw.slice(0, counts.concepts || 8).map((word, i) => {
    const host = sents.find(s => s.toLowerCase().includes(word)) || '';
    return {
      title: word.charAt(0).toUpperCase() + word.slice(1),
      explanation: host ? `Appears in your material: “${host.slice(0, 180)}”` : `A key term appearing ${text.toLowerCase().split(word).length - 1}× in your material.`,
      details: 'Auto-extracted term — open the AI Tutor to get a deeper explanation.',
      example: ''
    };
  });

  const cards = [];
  for (const c of concepts) {
    if (c.explanation.length > 40 && cards.length < (counts.cards || 12)) {
      cards.push({ question: `What does your material say about “${c.title}”?`, answer: c.explanation });
    }
  }
  for (const s of sents) {
    if (cards.length >= (counts.cards || 12)) break;
    const m = s.match(/^(.{20,120}?)\s+(is|are|was|were|means|refers to)\s+(.{10,180})$/i);
    if (m) cards.push({ question: `Complete: ${m[1]} …?`, answer: `${m[2]} ${m[3]}` });
    else cards.push({ question: `Which statement appears in your material?`, answer: s.slice(0, 200) });
  }

  const questions = [];
  const cardSource = cards.slice(0, counts.quiz || 8);
  cardSource.forEach((c, i) => {
    if (i % 4 === 3) {
      questions.push({ question: `True or False: ${c.answer.slice(0, 140)}`, type: 'true_false', options: [], correctAnswer: 'True', explanation: 'This statement is drawn directly from your material.', topic: c.question.slice(0, 40) });
    } else {
      const distractors = cards.filter(x => x !== c).slice(0, 3).map(x => x.answer.slice(0, 90));
      while (distractors.length < 3) distractors.push('None of the above');
      const correct = c.answer.slice(0, 90);
      const options = [correct, ...distractors].sort(() => Math.random() - 0.5);
      questions.push({ question: c.question, type: 'multiple_choice', options, correctAnswer: correct, explanation: 'The correct answer comes directly from your study material.', topic: 'Key terms' });
    }
  });

  return { subject: 'General', summary: { headline, content, key_points: keyPoints, formulas }, concepts, cards, questions, generatedBy: 'heuristic' };
}

module.exports = { heuristicPack };
