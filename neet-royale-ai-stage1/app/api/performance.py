"""
Performance summary endpoint.

GET /performance/summary/{session_id}
POST /performance/end/{session_id}
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.ai_analysis import generate_analysis
from app.db.performance_db import (
    create_session,
    end_session,
    get_answers_for_session,
    get_session,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/performance", tags=["performance"])


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
    source_type: str
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


@router.get(
    "/summary/{session_id}",
    response_model=PerformanceSummary,
    summary="Get post-match performance summary with AI analysis",
)
def get_summary(session_id: str):
    session = get_session(session_id)
    if session is None:
        create_session(
            session_id=session_id,
            user_id="player_guest",
            match_id="match_live",
            subject=None,
        )
        session = get_session(session_id)

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

    logger.info("Generating AI analysis for session %s (score=%.1f%%)", session_id, score_pct)
    raw_analysis = generate_analysis(
        score_percent=score_pct,
        correct=correct_count,
        total=total,
        answers=answers_for_ai,
    )

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
        user_id=session["user_id"] if session else "player_guest",
        match_id=session["match_id"] if session else "match_live",
        started_at=session["started_at"] if session else "",
        ended_at=session["ended_at"] if session else None,
        status=session["status"] if session else "completed",
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
    session = get_session(session_id)
    if session is None:
        create_session(
            session_id=session_id,
            user_id="player_guest",
            match_id="match_live",
            subject=None,
        )

    end_session(session_id)
    return {"session_id": session_id, "status": "completed"}