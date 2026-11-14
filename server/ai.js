/**
 * StudySnap AI service.
 * Talks to ANY OpenAI-compatible /chat/completions endpoint (OpenAI, Groq,
 * Together, Ollama, ...) configured via env: AI_API_KEY, AI_BASE_URL, AI_MODEL.
 *
 * When no key is configured, aiAvailable() is false and callers fall back to
 * a clearly-labelled local heuristic generator (generatedBy: 'heuristic') so
 * the product never shows fake "AI" output pretending to be model output.
 */
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

function aiAvailable() { return Boolean(AI_API_KEY); }

async function chatJSON(system, user, maxTokens = 3000) {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`AI service error (${res.status})`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw Object.assign(new Error('AI returned an empty response'), { status: 502 });
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw Object.assign(new Error('AI returned invalid JSON'), { status: 502 });
  }
}

const STYLES = {
  quick: 'a Quick Overview: 2-3 sentences, only the absolute core idea',
  standard: 'a Standard Summary: one clear paragraph plus 3-5 key points',
  detailed: 'a Detailed Breakdown: 2-3 paragraphs walking through each major section, plus key points',
  exam: 'an Exam-focused Summary: what is most likely to be tested, definitions to memorise, likely question topics, and any formulas'
};

async function generateStudyPack(sourceText, { style = 'standard', counts = {} } = {}) {
  const nCards = counts.cards || 12;
  const nQuiz = counts.quiz || 8;
  const nConcepts = counts.concepts || 8;
  const system = `You are StudySnap, an expert study assistant for students. You read study material and produce structured learning resources. Always answer with valid JSON only, no markdown fences, no commentary. Base everything strictly on the provided material; do not invent outside facts.`;
  const user = `Study material:
"""
${sourceText.slice(0, 24000)}
"""
Generate JSON with EXACTLY this shape:
{
  "subject": "one or two word subject (e.g. Biology)",
  "summary": { "headline": "one-sentence thesis of the material", "content": "${STYLES[style] || STYLES.standard}", "key_points": ["4-6 short bullet points"], "formulas": ["any formulas found, or empty array"] },
  "concepts": [ { "title": "concept name", "explanation": "simple explanation a student understands", "details": "important details", "example": "a concrete example" } ]  // exactly ${nConcepts} items
  "cards": [ { "question": "front of flashcard (question, term, or prompt)", "answer": "back (answer or explanation)" } ]  // exactly ${nCards} items
  "questions": [ { "question": "quiz question", "type": "multiple_choice" | "true_false" | "short_answer", "options": ["only for multiple_choice, 4 options"], "correctAnswer": "exact correct answer (for multiple_choice the option text; for true_false 'True' or 'False'; for short_answer a model answer)", "explanation": "why it is correct", "topic": "short topic tag" } ]  // exactly ${nQuiz} items, mostly multiple_choice, 1-2 true_false
}`;
  const out = await chatJSON(system, user, 4000);
  if (!out || !out.summary || !Array.isArray(out.cards) || !Array.isArray(out.questions) || !Array.isArray(out.concepts)) {
    throw Object.assign(new Error('AI returned unexpected structure'), { status: 502 });
  }
  return { ...out, generatedBy: 'ai' };
}

async function tutorReply({ sourceText, messages, mode = 'explain', scope = 'set' }) {
  const modeGuide = {
    explain: 'Explain the concept simply, as if to a student seeing it for the first time.',
    detail: 'Explain in detail with depth, structure and the reasoning behind it.',
    example: 'Give a concrete, memorable example and walk through it.',
    quiz: 'Ask the student one practice question at a time, wait for their answer, then tell them if they are right and why.',
    understand: 'Diagnose what the student might be misunderstanding, re-explain step by step, then check understanding with a small question.'
  };
  const system = `You are StudySnap's AI Tutor: a patient, encouraging study assistant. ${modeGuide[mode] || modeGuide.explain}
${scope === 'set' ? `PRIORITY: answer using the student's study material below. If the answer is not in it, say clearly that the material does not cover it, then (clearly labelled) offer general knowledge. Never invent facts confidently.` : 'This is a general question; answer helpfully but note it is outside their study material when relevant.'}
Keep answers focused and readable (short paragraphs, bullets when helpful).
${scope === 'set' ? `STUDENT MATERIAL:\n"""\n${(sourceText || '').slice(0, 12000)}\n"""` : ''}`;
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.4,
      max_tokens: 1200,
      messages: [{ role: 'system', content: system }, ...messages.slice(-12)]
    })
  });
  if (!res.ok) throw Object.assign(new Error(`AI service error (${res.status})`), { status: res.status === 429 ? 429 : 502 });
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw Object.assign(new Error('AI returned an empty response'), { status: 502 });
  return reply.trim();
}

module.exports = { aiAvailable, generateStudyPack, tutorReply, chatJSON };
