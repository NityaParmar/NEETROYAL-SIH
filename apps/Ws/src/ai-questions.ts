import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface Question {
  id: string | number;
  questionText: string;
  options: string[];
  correctAnswer: string;
  subject: string;
  topic?: string;
  difficulty?: string;
  explanation?: string | null;
}

interface AIQuestionResponse {
  id: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  subject: string;
  topic?: string;
  confidence?: number;
  source_type?: string;
}

// Fixed double semicolon typo and explicitly typed string for TS2322 compliance
const AI_SERVICE_URL: string = process.env.AI_SERVICE_URL || "http://localhost:8000";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FALLBACK_PATH = path.join(__dirname, "../questions.json");

/**
 * Fetch questions from the FastAPI internal gateway endpoint.
 */
export async function fetchQuestionsFromAI(
  count: number = 10,
  subject?: string
): Promise<Question[]> {
  try {
    const response = await axios.get<AIQuestionResponse[]>(
      `${AI_SERVICE_URL}/match/questions/internal`,
      {
        params: {
          count,
          ...(subject && { subject }),
        },
        timeout: 5000,
      }
    );

    if (Array.isArray(response.data) && response.data.length > 0) {
      return response.data.map((q: AIQuestionResponse) => ({
        id: q.id,
        questionText: q.question_text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        correctAnswer: normalizeCorrectAnswer(q.correct_answer),
        subject: q.subject,
        topic: q.topic || "General",
        difficulty: "MEDIUM",
      }));
    }

    throw new Error("Empty question list received from AI microservice.");
  } catch (error) {
    console.warn("[WS Questions] AI internal question endpoint failed.");
    if (axios.isAxiosError(error)) {
      console.warn(`[WS Questions] ${error.message}`);
    }
    console.warn("[WS Questions] Using local fallback questions.");
    return loadFallbackQuestions(count);
  }
}

/**
 * Convert any supported answer representation into A/B/C/D.
 */
function normalizeCorrectAnswer(answer: unknown): string {
  if (typeof answer === "number") {
    const letters = ["A", "B", "C", "D"];
    if (answer >= 0 && answer < letters.length) {
      return letters[answer]!;
    }
  }

  const normalized = String(answer ?? "").trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(normalized)) {
    return normalized;
  }

  throw new Error(`[WS Questions] Invalid correct_answer: ${String(answer)}`);
}

/**
 * Local fallback.
 */
function loadFallbackQuestions(count: number): Question[] {
  try {
    const rawData = fs.readFileSync(FALLBACK_PATH, "utf-8");
    const parsed = JSON.parse(rawData);

    if (!Array.isArray(parsed)) {
      throw new Error("questions.json must contain an array.");
    }

    return parsed
      .sort(() => 0.5 - Math.random())
      .slice(0, count)
      .map((q: any) => ({
        id: q.id,
        questionText: q.questionText ?? q.question_text,
        options: q.options ?? [q.option_a, q.option_b, q.option_c, q.option_d],
        correctAnswer: normalizeCorrectAnswer(q.correctAnswer ?? q.correct_answer),
        subject: q.subject,
        topic: q.topic ?? "General",
        difficulty: q.difficulty ?? "MEDIUM",
        explanation: q.explanation ?? null,
      }));
  } catch (error) {
    console.error("[WS Critical] Local questions.json unreadable:", error);
    return [];
  }
}