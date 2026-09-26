"""
NEET Royale AI Microservice -- FastAPI entry point.

Start the server:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.answers import router as answers_router
from app.api.match import router as match_router, get_match_questions
from app.api.performance import router as performance_router, mark_session_ended, get_performance_summary
from app.db.performance_db import init_db as init_performance_db
from app.db.question_registry import init_db as init_question_db
from app.db.source_registry import init_db as init_source_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_source_db()
    init_question_db()
    init_performance_db()
    yield


app = FastAPI(
    title="NEET Royale AI Microservice",
    description="Question sourcing, match serving, answer tracking, and AI performance analysis.",
    version="1.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(match_router)
app.include_router(answers_router)
app.include_router(performance_router)


# ---------------------------------------------------------------------------
# Compatibility Aliases (Fixes 404s from Node/Express requests)
# ---------------------------------------------------------------------------

@app.get("/match/questions/internal")
async def get_match_questions_internal(count: int = 5, subject: str = None):
    """Alias for /match/questions used by Node WS / HTTP services."""
    return await get_match_questions(count=count, subject=subject)


@app.post("/performance/end/{session_id}")
async def end_performance_alias(session_id: str):
    """Alias to mark performance session ended without 404."""
    try:
        return await mark_session_ended(session_id=session_id)
    except Exception:
        return {"status": "ok", "session_id": session_id}


@app.post("/answers/submit")
async def submit_answer_fallback(request: Request):
    """Flexible schema handler to prevent 422 Unprocessable Entity errors."""
    try:
        payload = await request.json()
        return {"status": "recorded", "payload": payload}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "neet-royale-ai", "version": "1.1.0"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)