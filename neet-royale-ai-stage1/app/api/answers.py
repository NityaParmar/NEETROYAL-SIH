"""
Answer tracking endpoint.

POST /answers/submit
    Record a user's answer to one question during a match.

    Request body (supports both snake_case and camelCase):
        {
          "session_id" / "sessionId":  "uuid",
          "user_id"    / "userId":     "player123",
          "match_id"   / "matchId":    "match_abc",
          "question_id"/ "questionId": 42,
          "chosen_answer"/ "chosenAnswer": "B"
        }

    Response:
        {
          "is_correct": true,
          "correct_answer": "B",
          "source_url": "https://...",
          "source_page": 7,
          "question_id": 42
        }
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, root_validator

from app.db.performance_db import (
    AnswerRecord,
    create_session,
    has_answer_for_question,
    record_answer,
)
from app.db.question_registry import get_question_by_id
from app.db.source_registry import get_source_url

router = APIRouter(prefix="/answers", tags=["answers"])

GENERATED_SOURCE_DOC_ID = 0


# ---------------------------------------------------------------------------
# Helper to resolve source URL
# ---------------------------------------------------------------------------

def _resolve_source_url(source_document_id: int) -> str:
    if source_document_id == GENERATED_SOURCE_DOC_ID:
        return "generated"
    url = get_source_url(source_document_id)
    return url or "unknown"


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class AnswerSubmit(BaseModel):
    session_id: Optional[str] = Field(None, description="Unique identifier for this user's match session")
    sessionId: Optional[str] = None
    user_id: Optional[str] = Field(None, description="Player identifier (supplied by the gateway)")
    userId: Optional[str] = None
    match_id: Optional[str] = Field(None, description="Match identifier (supplied by the gateway)")
    matchId: Optional[str] = None
    question_id: Optional[int] = Field(None, description="ID of the question being answered")
    questionId: Optional[int] = None
    chosen_answer: Optional[str] = Field(None, description="The player's choice: A, B, C, or D")
    chosenAnswer: Optional[str] = None
    subject: Optional[str] = Field(None, description="Subject filter used when the match was started (optional)")

    @root_validator(pre=True)
    def normalize_camel_case(cls, values: dict) -> dict:
        """Seamlessly map camelCase fields from Node.js Express server to snake_case."""
        if not values.get("session_id") and values.get("sessionId"):
            values["session_id"] = str(values["sessionId"])
        if not values.get("user_id") and values.get("userId"):
            values["user_id"] = str(values["userId"])
        if not values.get("match_id") and values.get("matchId"):
            values["match_id"] = str(values["matchId"])
        if values.get("question_id") is None and values.get("questionId") is not None:
            values["question_id"] = int(values["questionId"])
        if not values.get("chosen_answer") and values.get("chosenAnswer"):
            values["chosen_answer"] = str(values["chosenAnswer"])
        return values


class AnswerResult(BaseModel):
    is_correct: bool
    correct_answer: str
    source_url: str
    source_page: int | None
    question_id: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/submit", response_model=AnswerResult, summary="Submit a player's answer")
def submit_answer(payload: AnswerSubmit):
    """
    Records one answer. Returns whether it was correct and the question's
    source link (used in the final performance summary).
    """
    # Verify mandatory fields exist after normalization
    if not payload.session_id or not payload.user_id or not payload.match_id:
        raise HTTPException(status_code=422, detail="Missing mandatory session identifiers (session_id, user_id, match_id)")
    if payload.question_id is None:
        raise HTTPException(status_code=422, detail="Missing question_id")
    if not payload.chosen_answer:
        raise HTTPException(status_code=422, detail="Missing chosen_answer")

    chosen = payload.chosen_answer.strip().upper()
    if chosen not in {"A", "B", "C", "D"}:
        raise HTTPException(status_code=400, detail="chosen_answer must be A, B, C, or D")

    question = get_question_by_id(payload.question_id)
    if question is None:
        raise HTTPException(status_code=404, detail=f"Question id={payload.question_id} not found")

    # Prevent double-submission for the same question in the same session
    if has_answer_for_question(payload.session_id, payload.question_id):
        raise HTTPException(
            status_code=409,
            detail=f"Answer already recorded for question {payload.question_id} in session {payload.session_id}",
        )

    # Auto-create the session on first answer (lazy init)
    create_session(
        session_id=payload.session_id,
        user_id=payload.user_id,
        match_id=payload.match_id,
        subject=payload.subject,
    )

    is_correct = chosen == question["correct_answer"]
    source_url = _resolve_source_url(question["source_document_id"])

    record_answer(
        AnswerRecord(
            session_id=payload.session_id,
            question_id=payload.question_id,
            question_text=question["question_text"],
            option_a=question["option_a"],
            option_b=question["option_b"],
            option_c=question["option_c"],
            option_d=question["option_d"],
            correct_answer=question["correct_answer"],
            chosen_answer=chosen,
            is_correct=1 if is_correct else 0,
            subject=question["subject"],
            topic=question["topic"],
            source_url=source_url,
            source_page=question["page_number"] if question["page_number"] != 0 else None,
            answered_at=datetime.now(timezone.utc).isoformat(),
        )
    )

    return AnswerResult(
        is_correct=is_correct,
        correct_answer=question["correct_answer"],
        source_url=source_url,
        source_page=question["page_number"] if question["page_number"] != 0 else None,
        question_id=payload.question_id,
    )