"""
Match serving endpoints.

GET /match/questions
    Public-safe question endpoint.
    Correct answers are NOT returned.

GET /match/questions/internal
    Internal gateway endpoint.
    Returns correct_answer so the Node.js WebSocket server can
    keep the answer key server-side.

IMPORTANT:
    The browser should never call the internal endpoint.
    It is intended for the trusted WebSocket backend.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db.question_registry import get_random_questions


router = APIRouter(prefix="/match", tags=["match"])

GENERATED_SOURCE_DOC_ID = 0


# ---------------------------------------------------------------------------
# Public response
# ---------------------------------------------------------------------------

class QuestionOut(BaseModel):
    id: int
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    subject: str
    topic: str
    source_type: str


# ---------------------------------------------------------------------------
# Internal response
# ---------------------------------------------------------------------------

class InternalQuestionOut(BaseModel):
    id: int
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str
    subject: str
    topic: str
    confidence: float
    source_type: str


# ---------------------------------------------------------------------------
# Shared query validation
# ---------------------------------------------------------------------------

def _validate_subject(subject: str | None) -> None:
    if subject and subject not in {
        "physics",
        "chemistry",
        "biology",
    }:
        raise HTTPException(
            status_code=400,
            detail="subject must be physics, chemistry, or biology",
        )


def _get_questions(
    count: int,
    subject: str | None,
    min_confidence: float,
):
    _validate_subject(subject)

    rows = get_random_questions(
        count=count * 3,
        subject=subject,
    )

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No questions found in the bank. Run the pipeline first.",
        )

    filtered = [
        row
        for row in rows
        if row["confidence"] >= min_confidence
    ]

    filtered = filtered[:count]

    if not filtered:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No questions found matching "
                f"min_confidence={min_confidence}"
            ),
        )

    return filtered


# ---------------------------------------------------------------------------
# PUBLIC endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/questions",
    response_model=list[QuestionOut],
    summary="Serve questions for a match round",
)
def serve_questions(
    count: Annotated[
        int,
        Query(
            ge=1,
            le=100,
            description="Number of questions to return",
        ),
    ] = 10,

    subject: Annotated[
        str | None,
        Query(
            description=(
                "Filter by subject: "
                "physics | chemistry | biology"
            ),
        ),
    ] = None,

    min_confidence: Annotated[
        float,
        Query(
            ge=0.0,
            le=1.0,
            description=(
                "Exclude questions with confidence "
                "below this value"
            ),
        ),
    ] = 0.0,
):
    """
    Return questions WITHOUT correct answers.

    This endpoint is safe for the frontend.
    """

    filtered = _get_questions(
        count=count,
        subject=subject,
        min_confidence=min_confidence,
    )

    return [
        QuestionOut(
            id=row["id"],
            question_text=row["question_text"],
            option_a=row["option_a"],
            option_b=row["option_b"],
            option_c=row["option_c"],
            option_d=row["option_d"],
            subject=row["subject"],
            topic=row["topic"],
            source_type=(
                "generated"
                if row["source_document_id"]
                == GENERATED_SOURCE_DOC_ID
                else "extracted"
            ),
        )
        for row in filtered
    ]


# ---------------------------------------------------------------------------
# INTERNAL WS GATEWAY endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/questions/internal",
    response_model=list[InternalQuestionOut],
    summary="Serve questions to the trusted WebSocket gateway",
)
def serve_internal_questions(
    count: Annotated[
        int,
        Query(
            ge=1,
            le=100,
            description="Number of questions to return",
        ),
    ] = 10,

    subject: Annotated[
        str | None,
        Query(
            description=(
                "Filter by subject: "
                "physics | chemistry | biology"
            ),
        ),
    ] = None,

    min_confidence: Annotated[
        float,
        Query(
            ge=0.0,
            le=1.0,
            description=(
                "Exclude questions with confidence "
                "below this value"
            ),
        ),
    ] = 0.0,
):
    """
    Return questions INCLUDING correct answers.

    This endpoint is intended ONLY for the Node.js WebSocket
    gateway, which keeps correct_answer out of the browser payload.

    Deployment note:
        Keep FastAPI on the private/internal network or localhost
        so this endpoint is not publicly reachable.
    """

    filtered = _get_questions(
        count=count,
        subject=subject,
        min_confidence=min_confidence,
    )

    return [
        InternalQuestionOut(
            id=row["id"],
            question_text=row["question_text"],
            option_a=row["option_a"],
            option_b=row["option_b"],
            option_c=row["option_c"],
            option_d=row["option_d"],
            correct_answer=str(row["correct_answer"]).strip().upper(),
            subject=row["subject"],
            topic=row["topic"],
            confidence=row["confidence"],
            source_type=(
                "generated"
                if row["source_document_id"]
                == GENERATED_SOURCE_DOC_ID
                else "extracted"
            ),
        )
        for row in filtered
    ]