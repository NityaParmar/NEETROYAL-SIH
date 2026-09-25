import * as dotenv from "dotenv";

dotenv.config();

export const WS_PORT = Number(process.env.PORT || process.env.WS_PORT) || 8080;

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production.");
}

export const JWT_SECRET =
  jwtSecret || "testturf-local-development-secret-2026";

export const QUESTION_TIME_LIMIT_SEC = 15;
export const REVIEW_TIME_LIMIT_SEC = 3;
export const COUNTDOWN_SEC = 3;
export const QUESTIONS_PER_MATCH = 5;

// NEET Exam Scoring Rules
export const NEET_SCORING = {
  CORRECT: 4,
  WRONG: -1,
  UNANSWERED: 0,
} as const;

