/**
 * ai-questions.ts
 * 
 * Drop-in replacement for the hardcoded questions.json loader in GameManager.ts.
 * Fetches real NEET MCQs from the AI microservice (FastAPI) instead of static JSON.
 *
 * SETUP:
 *   1. Copy this file into  apps/Ws/src/ai-questions.ts
 *   2. Add to your .env:
 *        AI_SERVICE_URL=http://localhost:8000
 *   3. In GameManager.ts, replace the loadQuestionsFromJson() call with:
 *        import { fetchQuestionsFromAI } from "./ai-questions.js";
 *        ...
 *        const questions = await fetchQuestionsFromAI(QUESTIONS_PER_MATCH);
 *
 * WHAT IT DOES:
 *   - Calls GET /match/questions on the FastAPI AI microservice
 *   - Converts the FastAPI format -> the QuestionItem format Game.ts already expects
 *   - Falls back to the static questions.json if the AI service is unreachable
 *   - Caches the last successful fetch for 5 minutes to avoid hammering the AI on every match
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { QuestionItem } from "./Game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple in-memory question pool cache
let cachedQuestions: QuestionItem[] = [];
let cacheTimestamp = 0;

/**
 * Maps option letter (A/B/C/D) to 0-indexed number that Game.ts uses.
 * FastAPI returns correct_answer as "A"/"B"/"C"/"D",
 * Game.ts expects correctAnswer as 0/1/2/3.
 */
function letterToIndex(letter: string): number {
  return { A: 0, B: 1, C: 2, D: 3 }[letter.toUpperCase()] ?? 0;
}

/**
 * Convert a FastAPI /match/questions response item to QuestionItem format.
 *
 * FastAPI shape:
 *   { id, question_text, option_a, option_b, option_c, option_d, subject, topic, source_type }
 *
 * Game.ts QuestionItem shape:
 *   { id, questionText, options[], correctAnswer (0-3), subject, topic, difficulty, explanation? }
 *
 * Note: FastAPI intentionally omits correct_answer from /match/questions (security).
 * We fetch full question details from /answers/submit after the player answers.
 * For the game engine we use correctAnswer=0 as placeholder — the REAL check is
 * done by calling POST /answers/submit which returns is_correct from the AI service.
 */
function toQuestionItem(raw: Record<string, unknown>): QuestionItem {
  return {
    id: String(raw.id),
    questionText: String(raw.question_text),
    options: [
      String(raw.option_a),
      String(raw.option_b),
      String(raw.option_c),
      String(raw.option_d),
    ],
    correctAnswer: 0,          // placeholder — correctness checked via /answers/submit
    subject: String(raw.subject),
    topic: raw.topic ? String(raw.topic) : null,
    difficulty: "MEDIUM",      // FastAPI doesn't expose difficulty yet
    explanation: null,
  };
}

/**
 * Load fallback questions from the local questions.json file.
 */
function loadFallbackQuestions(): QuestionItem[] {
  const possiblePaths = [
    path.join(__dirname, "questions.json"),
    path.join(__dirname, "../src/questions.json"),
    path.join(process.cwd(), "apps/Ws/src/questions.json"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8")) as QuestionItem[];
      } catch {
        // try next
      }
    }
  }
  return [];
}

/**
 * Fetch N questions from the AI microservice.
 * Falls back to local questions.json if the service is unavailable.
 *
 * @param count  How many questions to fetch (default: QUESTIONS_PER_MATCH from config)
 * @param subject  Optional subject filter: "physics" | "chemistry" | "biology"
 */
export async function fetchQuestionsFromAI(
  count: number = 10,
  subject?: string
): Promise<QuestionItem[]> {
  // Use cached pool if it's fresh enough and has enough questions
  const now = Date.now();
  if (cachedQuestions.length >= count && now - cacheTimestamp < CACHE_TTL_MS) {
    // Shuffle and slice from cache so each match gets a different subset
    const shuffled = [...cachedQuestions].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  try {
    // Fetch a larger pool (3x) to fill the cache
    const fetchCount = Math.max(count * 3, 30);
    const params = new URLSearchParams({ count: String(fetchCount) });
    if (subject) params.set("subject", subject);

    const url = `${AI_SERVICE_URL}/match/questions?${params.toString()}`;
    console.log(`[AI Questions] Fetching from ${url}`);

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      throw new Error(`AI service returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>[];

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("AI service returned empty question list");
    }

    cachedQuestions = data.map(toQuestionItem);
    cacheTimestamp = now;

    console.log(`[AI Questions] Cached ${cachedQuestions.length} questions from AI service`);

    const shuffled = [...cachedQuestions].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);

  } catch (err) {
    console.error(`[AI Questions] Failed to fetch from AI service, using fallback:`, err);
    const fallback = loadFallbackQuestions();
    if (fallback.length > 0) {
      return fallback.slice(0, count);
    }
    throw new Error("No questions available — AI service unreachable and no fallback file found.");
  }
}

/**
 * Pre-warm the question cache at server startup.
 * Call this once in your index.ts / server entry point.
 */
export async function warmQuestionCache(): Promise<void> {
  console.log("[AI Questions] Pre-warming question cache...");
  try {
    await fetchQuestionsFromAI(30);
    console.log("[AI Questions] Cache warmed successfully.");
  } catch (err) {
    console.warn("[AI Questions] Cache warm failed (will retry on first match):", err);
  }
}
