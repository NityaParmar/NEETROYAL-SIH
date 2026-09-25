"""
NEET Royale AI Microservice -- FastAPI entry point.

Start the server:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Endpoints exposed:
    GET  /match/questions                     -- serve questions for a match round
    POST /answers/submit                      -- record a player's answer
    GET  /performance/summary/{session_id}    -- post-match AI analysis + report
    POST /performance/end/{session_id}        -- mark a session as completed
    GET  /health                              -- liveness check
    GET  /docs                               -- Swagger UI
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.answers import router as answers_router
from app.api.match import router as match_router
from app.api.performance import router as performance_router
from app.db.performance_db import init_db as init_performance_db
from app.db.question_registry import init_db as init_question_db
from app.db.source_registry import init_db as init_source_db


# ---------------------------------------------------------------------------
# Lifespan: replaces deprecated @app.on_event("startup")
# All DB init happens here -- once, safely, after the data/ dir is available
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_source_db()
    init_question_db()
    init_performance_db()
    yield
    # Shutdown (nothing to clean up for SQLite)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="NEET Royale AI Microservice",
    description=(
        "Question sourcing, match serving, answer tracking, and AI-powered "
        "performance analysis for the NEET Royale multiplayer quiz platform. "
        "All questions are extracted from real NEET past papers."
    ),
    version="1.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Allow any origin during dev -- tighten to your gateway's domain in production
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
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"], summary="Liveness probe")
def health():
    return {"status": "ok", "service": "neet-royale-ai", "version": "1.1.0"}


# ---------------------------------------------------------------------------
# Dev runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
