import * as dotenv from "dotenv";

dotenv.config();

export const PORT = Number(process.env.PORT) || 3001;

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production.");
}

export const JWT_SECRET =
  jwtSecret || "testturf-local-development-secret-2026";

export const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

