"""
AI-powered performance analysis module.
"""

import logging
import os
import re

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

GROQ_MODEL = "qwen/qwen3.8-27b"

ANALYSIS_SYSTEM_PROMPT = """You are an expert NEET exam coach. A student just completed a practice match round.
You will be given their performance data: score, and each question with whether they got it right or wrong.

Your job is to produce a SHORT, actionable post-match analysis in this exact JSON format (no markdown, no extra text):
{
  "overall_feedback": "1-2 sentence encouraging overall assessment mentioning their score",
  "strong_topics": ["topic1", "topic2"],
  "weak_topics": ["topic1", "topic2"],
  "subject_breakdown": {
    "physics": {"correct": 0, "total": 0},
    "chemistry": {"correct": 0, "total": 0},
    "biology": {"correct": 0, "total": 0}
  },
  "recommendations": [
    "Specific actionable study tip 1",
    "Specific actionable study tip 2",
    "Specific actionable study tip 3"
  ],
  "priority_topic": "The single most important topic to study next"
}

Base recommendations on the specific topics the student got WRONG. Be specific and encouraging.
If they got everything right, focus on maintaining performance and tackling harder problems.
"""


def _strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _build_performance_prompt(score_percent: float, correct: int, total: int,
                               answers: list[dict]) -> str:
    wrong = [a for a in answers if not a["is_correct"]]
    right = [a for a in answers if a["is_correct"]]

    wrong_lines = "\n".join(
        f"  - [{a['subject']}] {a['topic']}: Q: {a['question_text'][:80]}... "
        f"(chose {a['chosen_answer']}, correct was {a['correct_answer']})"
        for a in wrong[:10]
    )
    right_lines = "\n".join(
        f"  - [{a['subject']}] {a['topic']}"
        for a in right[:5]
    )

    return (
        f"Student score: {correct}/{total} ({score_percent}%)\n\n"
        f"Questions answered INCORRECTLY:\n{wrong_lines or '  (none -- perfect score!)'}\n\n"
        f"Topics answered CORRECTLY (sample):\n{right_lines or '  (none)'}\n\n"
        "Generate the JSON analysis now."
    )


def generate_analysis(score_percent: float, correct: int, total: int,
                       answers: list[dict]) -> dict:
    import json

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY not set -- returning fallback AI analysis")
        return _fallback_analysis(score_percent, correct, total, answers)

    try:
        from groq import Groq
        import httpx

        # Explicit client instantiation avoids httpx/proxies version conflict
        http_client = httpx.Client()
        client = Groq(api_key=api_key, http_client=http_client)

        user_msg = _build_performance_prompt(score_percent, correct, total, answers)

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.4,
            max_completion_tokens=800,
        )

        raw = _strip_think(response.choices[0].message.content)
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        result = json.loads(raw)

        result.setdefault("overall_feedback", _default_feedback(score_percent))
        result.setdefault("strong_topics", [])
        result.setdefault("weak_topics", [])
        result.setdefault("subject_breakdown", _compute_subject_breakdown(answers))
        result.setdefault("recommendations", ["Review incorrect questions carefully."])
        result.setdefault("priority_topic", "")
        result["ai_available"] = True

        return result

    except Exception as exc:
        logger.error("AI analysis generation failed: %s", exc)
        return _fallback_analysis(score_percent, correct, total, answers)


def _compute_subject_breakdown(answers: list[dict]) -> dict:
    breakdown = {
        "physics":   {"correct": 0, "total": 0},
        "chemistry": {"correct": 0, "total": 0},
        "biology":   {"correct": 0, "total": 0},
    }
    for a in answers:
        subj = a.get("subject", "").lower()
        if subj in breakdown:
            breakdown[subj]["total"] += 1
            if a.get("is_correct"):
                breakdown[subj]["correct"] += 1
    return breakdown


def _default_feedback(score_percent: float) -> str:
    if score_percent >= 80:
        return f"Excellent performance! You scored {score_percent}% -- keep up the great work."
    if score_percent >= 50:
        return f"Good effort! You scored {score_percent}%. Focus on the topics you missed to improve further."
    return f"You scored {score_percent}%. Don't be discouraged -- review the topics below and you'll improve quickly."


def _fallback_analysis(score_percent: float, correct: int, total: int,
                        answers: list[dict]) -> dict:
    wrong_topics = list({a["topic"] for a in answers if not a["is_correct"]})
    right_topics  = list({a["topic"] for a in answers if a["is_correct"]})

    recs = []
    for topic in wrong_topics[:3]:
        recs.append(f"Review {topic} -- you missed questions on this topic.")
    if not recs:
        recs = ["Keep practising to maintain your high score!"]

    return {
        "overall_feedback":   _default_feedback(score_percent),
        "strong_topics":      right_topics[:5],
        "weak_topics":        wrong_topics[:5],
        "subject_breakdown":  _compute_subject_breakdown(answers),
        "recommendations":    recs,
        "priority_topic":     wrong_topics[0] if wrong_topics else "",
        "ai_available":       False,
    }