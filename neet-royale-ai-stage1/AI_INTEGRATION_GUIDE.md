# NEET Royale AI Microservice — Architecture & Integration Guide

This document is for the backend and frontend teams integrating with the **NEET Royale AI Microservice**. It explains the architecture, the components, what issues were resolved, and step-by-step instructions for connecting your services.

---

## 1. Executive Summary & Architecture Overview

The NEET Royale AI microservice handles:
1. **Real Question Extraction & RAG Pipeline**: Ingesting official NEET past papers (PDFs), extracting multiple-choice questions (stem, options A–D, correct answer, subject, topic, and confidence) using OCR and LLMs, and indexing them in SQLite/vector storage.
2. **Match Serving**: Exposing vetted questions to users during multiplayer match rounds over REST without exposing the correct answer to the client.
3. **Answer Tracking**: Storing player answers (`chosen_answer`, `is_correct`, timestamp, and question details) in an isolated match performance database.
4. **AI Performance Coaching & Analysis**: Post-match personalised evaluation powered by Groq (`qwen/qwen3.8-27b`) that breaks down performance by subject, identifies strong/weak topics, generates specific study tips, and provides source paper citations.

```
+-------------------------------------------------------------------------------+
|                                NEET Royale Architecture                       |
+-------------------------------------------------------------------------------+

  [ React Frontend (Vite) ]
           │
           │ WebSocket (ws://localhost:8080)
           ▼
  [ Node/TS WebSocket Server (apps/Ws) ]
           │
           │ HTTP REST (http://localhost:8000)
           ▼
+-------------------------------------------------------------------------------+
|                      NEET Royale AI Microservice (FastAPI)                    |
+-------------------------------------------------------------------------------+
|                                                                               |
|  Endpoints:                                                                   |
|   • GET  /match/questions              Serve questions (answers hidden)       |
|   • POST /answers/submit               Record answer & check correctness      |
|   • POST /performance/end/{id}         Finalize match session                 |
|   • GET  /performance/summary/{id}     Return breakdown + AI Coaching Analysis|
|                                                                               |
|  Databases (SQLite):                                                          |
|   • data/registry.db                   Question bank, sources, extracted pages|
|   • data/performance.db                Match sessions & player answer logs    |
|                                                                               |
|  AI Engines:                                                                  |
|   • Groq (qwen/qwen3.8-27b)            Question extraction & Post-round coach |
|   • PyMuPDF + Tesseract OCR            PDF document processing                |
+-------------------------------------------------------------------------------+
```

---

## 2. Issues Detected & Changes Implemented

### Issue 1: Missing Post-Round AI Coaching Analysis
* **Problem**: The `/performance/summary/{session_id}` endpoint previously only returned raw counts (`correct`, `incorrect`, `score_percent`), completely lacking any AI analysis or study recommendations.
* **Fix**: Created [`app/api/ai_analysis.py`](./app/api/ai_analysis.py) and integrated it into [`app/api/performance.py`](./app/api/performance.py). It analyzes the user's specific incorrect answers and generates:
  - `overall_feedback`: Encouraging assessment tailored to their score.
  - `strong_topics` & `weak_topics`: Identified from the questions answered.
  - `subject_breakdown`: Detailed correct/total counts for physics, chemistry, biology.
  - `recommendations`: 3 concrete study tasks.
  - `priority_topic`: The #1 topic to focus on next.
  - `ai_available`: Graceful fallback if Groq API is unreachable.

### Issue 2: Groq Model Deprecation (`model_not_found`)
* **Problem**: The previous model string `qwen/qwen3.6-27b` was retired on Groq, leading to 404 errors.
* **Fix**: Updated all references to the active model: `qwen/qwen3.8-27b` in [`app/api/ai_analysis.py`](./app/api/ai_analysis.py), [`app/extraction/llm_extractor.py`](./app/extraction/llm_extractor.py), and [`app/rag/generator.py`](./app/rag/generator.py).

### Issue 3: Duplicate Import-Time DB Initialization & Deprecated Startup Hooks
* **Problem**: Calling `init_db()` at module import in router files caused crashes when directories didn't exist yet. Furthermore, `@app.on_event("startup")` is deprecated in FastAPI 0.115+.
* **Fix**: Migrated to the modern `@asynccontextmanager lifespan` pattern in [`app/main.py`](./app/main.py), ensuring all DB tables are safely and cleanly created at startup.

### Issue 4: Teammate Bypassing AI Service for Questions
* **Problem**: In the shared repository (`TESTTURF`), `apps/Ws/src/GameManager.ts` loaded 4 hardcoded questions from `questions.json` because the team lacked a direct adapter to fetch questions from the FastAPI service.
* **Fix**: Created [`ai-questions.ts`](./ai-questions.ts), a drop-in TypeScript module for the WebSocket server that fetches real extracted NEET questions, converts the schema, caches the pool for 5 minutes, and falls back to local JSON if the AI service is ever offline.

---

## 3. Microservice Components

### A. Question Ingestion & Extraction Pipeline
1. **Stage 1 (`app/ingestion/downloader.py`)**:
   - Registers official NEET papers in `data/registry.db`.
   - Safely checks local files in `data/raw_pdfs/` (e.g. `NEET_2020` to `NEET_2024`) and computes SHA-256 hashes.
2. **Stage 2 (`app/ingestion/pdf_extractor.py`)**:
   - Reads pages using PyMuPDF (`fitz`).
   - If a page is scanned (fewer than 20 characters), automatically runs Tesseract OCR.
   - Stores extracted text page-by-page in `data/registry.db`.
3. **Stage 3 (`app/extraction/llm_extractor.py`)**:
   - Sends page text to Groq (`qwen/qwen3.8-27b`).
   - Extracts complete MCQs, cleans OCR noise, infers correct answers, tags subject/topic, and assigns confidence scores.

### B. SQLite Databases
* **`data/registry.db`**:
  - `source_documents`: Tracks PDF source metadata, file paths, and original URLs.
  - `extracted_pages`: Stores per-page raw text and extraction method (`native` vs `ocr`).
  - `questions`: Stores extracted questions (`question_text`, `option_a` through `option_d`, `correct_answer`, `subject`, `topic`, `confidence`).
* **`data/performance.db`**:
  - `match_sessions`: Tracks each player round (`id`, `user_id`, `match_id`, `started_at`, `ended_at`, `status`).
  - `match_answers`: Records each submitted answer (`question_id`, `chosen_answer`, `is_correct`, `source_url`, `source_page`).

---

## 4. API Endpoints Reference

Base URL: `http://localhost:8000` (or your deployed server URL)

### 1. `GET /match/questions`
Fetches randomized questions for a match round. Correct answers are **omitted** for security.
* **Query Parameters**:
  - `count` (integer, default: 10, max: 100)
  - `subject` (optional string: `physics` | `chemistry` | `biology`)
  - `min_confidence` (optional float, default: 0.0)
* **Sample Response**:
```json
[
  {
    "id": 13,
    "question_text": "Given below are two statements...",
    "option_a": "Both Statement I and Statement II are true.",
    "option_b": "Both Statement I and Statement II are false.",
    "option_c": "Statement I is true but Statement II is false.",
    "option_d": "Statement I is false but Statement II is true.",
    "subject": "physics",
    "topic": "Current Electricity",
    "source_type": "extracted"
  }
]
```

### 2. `POST /answers/submit`
Records an answer for a question in a match session. Auto-creates the session on the first answer (lazy init).
* **Request Body**:
```json
{
  "session_id": "c0333323-25da-47...",
  "user_id": "player_123",
  "match_id": "room_game_1",
  "question_id": 13,
  "chosen_answer": "D",
  "subject": "physics"
}
```
* **Sample Response**:
```json
{
  "is_correct": true,
  "correct_answer": "D",
  "source_url": "https://docs.aglasem.com/view/fcc6e1ea-2f1c-11f0-a4dd-0a5e36bc6706",
  "source_page": 4,
  "question_id": 13
}
```

### 3. `POST /performance/end/{session_id}`
Marks a session as completed when the round finishes.
* **Sample Response**:
```json
{
  "session_id": "c0333323-25da-47...",
  "status": "completed"
}
```

### 4. `GET /performance/summary/{session_id}`
Returns the complete post-match breakdown and AI coaching analysis.
* **Sample Response**:
```json
{
  "session_id": "c0333323-25da-47...",
  "user_id": "player_123",
  "match_id": "room_game_1",
  "started_at": "2026-09-19T10:50:45.123456Z",
  "ended_at": "2026-09-19T10:50:55.654321Z",
  "status": "completed",
  "total_questions": 5,
  "correct": 4,
  "incorrect": 1,
  "score_percent": 80.0,
  "ai_analysis": {
    "overall_feedback": "Excellent performance! You scored 80.0% -- keep up the great work.",
    "strong_topics": ["Rotational Mechanics", "Current Electricity"],
    "weak_topics": ["Wave Optics - Polarization"],
    "subject_breakdown": {
      "physics": { "correct": 4, "total": 5 },
      "chemistry": { "correct": 0, "total": 0 },
      "biology": { "correct": 0, "total": 0 }
    },
    "recommendations": [
      "Review Brewster's Law and polarization by reflection.",
      "Practice 5 numerical problems on Wave Optics."
    ],
    "priority_topic": "Wave Optics - Polarization",
    "ai_available": true
  },
  "answers": [
    {
      "question_id": 13,
      "question_text": "Given below are two statements...",
      "option_a": "Both Statement I and Statement II are true.",
      "option_b": "Both Statement I and Statement II are false.",
      "option_c": "Statement I is true but Statement II is false.",
      "option_d": "Statement I is false but Statement II is true.",
      "correct_answer": "D",
      "chosen_answer": "D",
      "is_correct": true,
      "subject": "physics",
      "topic": "Current Electricity",
      "source_url": "https://docs.aglasem.com/...",
      "source_page": 4,
      "source_type": "extracted",
      "answered_at": "2026-09-19T10:50:46Z"
    }
  ]
}
```

---

## 5. Teammate Integration Steps (WebSocket Server)

To connect your WebSocket server (`apps/Ws`) to the AI microservice:

### Step 1: Copy `ai-questions.ts`
Copy [`ai-questions.ts`](./ai-questions.ts) into your WebSocket service:
```
apps/Ws/src/ai-questions.ts
```

### Step 2: Update `apps/Ws/src/GameManager.ts`
1. Replace the static import:
   ```ts
   // In apps/Ws/src/GameManager.ts:
   import { fetchQuestionsFromAI } from "./ai-questions.js";
   ```
2. In `addHandler()`, where `INIT_GAME` creates the game:
   ```ts
   // Replace:
   // const questions = DEFAULT_QUESTIONS.sort(...).slice(0, QUESTIONS_PER_MATCH);
   
   // With:
   const questions = await fetchQuestionsFromAI(QUESTIONS_PER_MATCH);
   ```

### Step 3: Add Environment Variable
In `apps/Ws/.env`:
```env
AI_SERVICE_URL=http://localhost:8000
```

### Step 4: Optional Pre-Warming
In `apps/Ws/src/index.ts`:
```ts
import { warmQuestionCache } from "./ai-questions.js";

// Preload questions into memory on startup
warmQuestionCache();
```

---

## 6. How to Run the AI Microservice

### Prerequisites
- Python 3.10+
- Virtual environment with requirements installed:
  ```bash
  pip install -r requirements.txt
  ```
- `.env` file containing:
  ```env
  GROQ_API_KEY=your_groq_api_key_here
  ```

### Running the API Server
```bash
# Development server with auto-reload:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Swagger UI is available at: `http://localhost:8000/docs`

### Running the Pipelines
1. **Register/Download PDFs**:
   ```bash
   python -m app.ingestion.downloader
   ```
2. **Extract Pages from PDFs (PyMuPDF + OCR)**:
   ```bash
   python -m app.ingestion.pdf_extractor
   ```
3. **Extract Questions via LLM**:
   ```bash
   python -m app.extraction.llm_extractor
   ```
4. **Run End-to-End Verification Test**:
   ```bash
   python test_e2e.py
   ```
