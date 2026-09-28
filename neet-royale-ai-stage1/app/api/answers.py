"""
Answer tracking endpoint.

POST /answers/submit
    Record a user's answer to one question during a match.
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


def _resolve_source_url(source_document_id: int) -> str:
    if source_document_id == GENERATED_SOURCE_DOC_ID:
        return "generated"
    url = get_source_url(source_document_id)
    return url or "unknown"


class AnswerSubmit(BaseModel):
    session_id: Optional[str] = Field(None, description="Unique identifier for this user's match session")
    sessionId: Optional[str] = None
    user_id: Optional[str] = Field(None, description="Player identifier")
    userId: Optional[str] = None
    match_id: Optional[str] = Field(None, description="Match identifier")
    matchId: Optional[str] = None
    question_id: Optional[int] = Field(None, description="ID of the question being answered")
    questionId: Optional[int] = None
    chosen_answer: Optional[str] = Field(None, description="The player's choice: A, B, C, or D")
    chosenAnswer: Optional[str] = None
    subject: Optional[str] = Field(None, description="Subject filter")

    @root_validator(pre=True)
    def normalize_camel_case(cls, values: dict) -> dict:
        """Seamlessly map camelCase fields and handle string-to-int coercion."""
        if not values.get("session_id") and values.get("sessionId"):
            values["session_id"] = str(values["sessionId"])
        
        if not values.get("user_id"):
            if values.get("userId"):
                values["user_id"] = str(values["userId"])
            elif values.get("playerId"):
                values["user_id"] = str(values["playerId"])

        if not values.get("match_id"):
            if values.get("matchId"):
                values["match_id"] = str(values["matchId"])
            elif values.get("gameId"):
                values["match_id"] = str(values["gameId"])

        raw_q_id = values.get("question_id") if values.get("question_id") is not None else values.get("questionId")
        if raw_q_id is not None:
            try:
                values["question_id"] = int(raw_q_id)
            except (ValueError, TypeError):
                pass

        if not values.get("chosen_answer"):
            if values.get("chosenAnswer"):
                values["chosen_answer"] = str(values["chosenAnswer"])
            elif values.get("selectedOption"):
                values["chosen_answer"] = str(values["selectedOption"])
            elif values.get("answer"):
                values["chosen_answer"] = str(values["answer"])

        return values


class AnswerResult(BaseModel):
    is_correct: bool
    correct_answer: str
    source_url: str
    source_page: int | None
    question_id: int


@router.post("/submit", response_model=AnswerResult, summary="Submit a player's answer")
def submit_answer(payload: AnswerSubmit):
    if not payload.session_id or not payload.user_id or not payload.match_id:
        raise HTTPException(status_code=422, detail="Missing mandatory session identifiers (session_id, user_id, match_id)")
    if payload.question_id is None:
        raise HTTPException(status_code=422, detail="Missing question_id")
    if not payload.chosen_answer:
        raise HTTPException(status_code=422, detail="Missing chosen_answer")

    chosen = payload.chosen_answer.strip().upper()
    if chosen not in {"A", "B", "C", "D"}:
        raise HTTPException(status_code=400, detail="chosen_answer must be A, B, C, or D")

    q_id = int(payload.question_id)
    question = get_question_by_id(q_id)
    if question is None:
        raise HTTPException(status_code=404, detail=f"Question id={q_id} not found")

    if has_answer_for_question(payload.session_id, q_id):
        is_correct = chosen == question["correct_answer"]
        return AnswerResult(
            is_correct=is_correct,
            correct_answer=question["correct_answer"],
            source_url=_resolve_source_url(question["source_document_id"]),
            source_page=question["page_number"] if question["page_number"] != 0 else None,
            question_id=q_id,
        )

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
            question_id=q_id,
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
        question_id=q_id,
    )