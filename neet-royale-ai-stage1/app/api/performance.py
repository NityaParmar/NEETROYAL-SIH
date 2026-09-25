"""
Performance summary endpoint.

GET /performance/summary/{session_id}
    Returns the full post-match breakdown for one player session PLUS
    an AI-generated analysis (strengths, weaknesses, study recommendations).

POST /performance/end/{session_id}
    Marks a session as completed (sets ended_at).

Response shape for GET /performance/summary:
    {
      "session_id": "...",
      "user_id": "...",
      "match_id": "...",
      "started_at": "2024-...",
      "ended_at": "2024-..." | null,
      "status": "active" | "completed",
      "total_questions": 10,
      "correct": 7,
      "incorrect": 3,
      "score_percent": 70.0,
      "ai_analysis": {
        "overall_feedback": "Good effort! You scored 70%...",
        "strong_topics": ["Thermodynamics", "Genetics"],
        "weak_topics": ["Optics", "Organic Chemistry"],
        "subject_breakdown": {
          "physics":   {"correct": 2, "total": 4},
          "chemistry": {"correct": 3, "total": 3},
          "biology":   {"correct": 2, "total": 3}
        },
        "recommendations": [
          "Revise Optics — focus on refraction and lens formula",
          "Practice Organic Chemistry reaction mechanisms"
        ],
        "priority_topic": "Optics",
        "ai_available": true
      },
      "answers": [ ... ]
    }
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.ai_analysis import generate_analysis
from app.db.performance_db import end_session, get_answers_for_session, get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/performance", tags=["performance"])

# NOTE: init_db() is NOT called here — it is called once at startup in main.py
# via the lifespan handler. Calling it at import time caused startup crashes
# when the data/ directory didn't exist yet.


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class AnswerDetail(BaseModel):
    question_id: int
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str
    chosen_answer: str
    is_correct: bool
    subject: str
    topic: str
    source_url: str
    source_page: int | None
    source_type: str   # "extracted" | "generated"
    answered_at: str


class SubjectStats(BaseModel):
    correct: int
    total: int


class AIAnalysis(BaseModel):
    overall_feedback: str
    strong_topics: list[str]
    weak_topics: list[str]
    subject_breakdown: dict[str, SubjectStats]
    recommendations: list[str]
    priority_topic: str
    ai_available: bool = True


class PerformanceSummary(BaseModel):
    session_id: str
    user_id: str
    match_id: str
    started_at: str
    ended_at: str | None
    status: str
    total_questions: int
    correct: int
    incorrect: int
    score_percent: float
    ai_analysis: AIAnalysis
    answers: list[AnswerDetail]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/summary/{session_id}",
    response_model=PerformanceSummary,
    summary="Get post-match performance summary with AI analysis",
)
def get_summary(session_id: str):
    """
    Full per-question breakdown WITH AI coaching analysis.

    The AI analysis includes:
    - Overall feedback based on score
    - Topics the player is strong/weak in
    - Per-subject correct/total breakdown
    - Specific study recommendations
    - The single highest-priority topic to review

    If the Groq API is unavailable, ai_analysis.ai_available will be false
    and a rule-based fallback analysis is returned instead. The endpoint
    never fails due to AI unavailability.
    """
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    answer_rows = get_answers_for_session(session_id)

    answers: list[AnswerDetail] = []
    answers_for_ai: list[dict] = []
    correct_count = 0

    for row in answer_rows:
        is_correct = bool(row["is_correct"])
        if is_correct:
            correct_count += 1

        source_type = "generated" if row["source_url"] == "generated" else "extracted"

        answers.append(
            AnswerDetail(
                question_id=row["question_id"],
                question_text=row["question_text"],
                option_a=row["option_a"],
                option_b=row["option_b"],
                option_c=row["option_c"],
                option_d=row["option_d"],
                correct_answer=row["correct_answer"],
                chosen_answer=row["chosen_answer"],
                is_correct=is_correct,
                subject=row["subject"],
                topic=row["topic"],
                source_url=row["source_url"],
                source_page=row["source_page"],
                source_type=source_type,
                answered_at=row["answered_at"],
            )
        )
        # Flat dict version passed to the AI analyser
        answers_for_ai.append({
            "question_text": row["question_text"],
            "subject":       row["subject"],
            "topic":         row["topic"],
            "chosen_answer": row["chosen_answer"],
            "correct_answer":row["correct_answer"],
            "is_correct":    is_correct,
        })

    total = len(answers)
    incorrect_count = total - correct_count
    score_pct = round((correct_count / total * 100), 2) if total > 0 else 0.0

    # ------------------------------------------------------------------
    # AI Analysis — called after all answers are collected
    # Never raises; returns a fallback dict if Groq is unavailable
    # ------------------------------------------------------------------
    logger.info("Generating AI analysis for session %s (score=%.1f%%)", session_id, score_pct)
    raw_analysis = generate_analysis(
        score_percent=score_pct,
        correct=correct_count,
        total=total,
        answers=answers_for_ai,
    )

    # Coerce subject_breakdown values into SubjectStats objects
    subject_breakdown = {
        subj: SubjectStats(
            correct=stats.get("correct", 0),
            total=stats.get("total", 0),
        )
        for subj, stats in raw_analysis.get("subject_breakdown", {}).items()
    }

    ai_analysis = AIAnalysis(
        overall_feedback=raw_analysis.get("overall_feedback", ""),
        strong_topics=raw_analysis.get("strong_topics", []),
        weak_topics=raw_analysis.get("weak_topics", []),
        subject_breakdown=subject_breakdown,
        recommendations=raw_analysis.get("recommendations", []),
        priority_topic=raw_analysis.get("priority_topic", ""),
        ai_available=raw_analysis.get("ai_available", True),
    )

    return PerformanceSummary(
        session_id=session_id,
        user_id=session["user_id"],
        match_id=session["match_id"],
        started_at=session["started_at"],
        ended_at=session["ended_at"],
        status=session["status"],
        total_questions=total,
        correct=correct_count,
        incorrect=incorrect_count,
        score_percent=score_pct,
        ai_analysis=ai_analysis,
        answers=answers,
    )


@router.post(
    "/end/{session_id}",
    summary="Mark a match session as completed",
)
def end_match_session(session_id: str):
    """
    Call this when the match round ends. Sets ended_at and status=completed.
    Idempotent -- safe to call multiple times.
    """
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    end_session(session_id)
    return {"session_id": session_id, "status": "completed"}
