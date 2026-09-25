"""
End-to-end test for the full match flow including AI analysis.
"""
import requests
import json
import uuid

BASE = "http://localhost:8000"
session_id = str(uuid.uuid4())

print("=== NEET Royale AI -- E2E Test with AI Analysis ===\n")

# 1. Health
r = requests.get(f"{BASE}/health")
print("1. HEALTH:", r.json())

# 2. Get questions
r = requests.get(f"{BASE}/match/questions", params={"count": 5})
questions = r.json()
print(f"\n2. MATCH QUESTIONS: {len(questions)} returned")
for q in questions:
    txt = q["question_text"][:55].encode("ascii", errors="replace").decode("ascii")
    print(f"   [{q['subject']}] id={q['id']} | {txt}...")

# 3. Submit answers
print("\n3. SUBMITTING ANSWERS:")
for i, q in enumerate(questions):
    payload = {
        "session_id": session_id, "user_id": "test_player",
        "match_id": "test_match_ai", "question_id": q["id"],
        "chosen_answer": "A" if i % 2 == 0 else "B"  # mix A and B answers
    }
    r = requests.post(f"{BASE}/answers/submit", json=payload)
    res = r.json()
    print(f"   Q{q['id']}: chose={'A' if i%2==0 else 'B'} | correct={res['correct_answer']} | {'CORRECT' if res['is_correct'] else 'WRONG'}")

# 4. End session
requests.post(f"{BASE}/performance/end/{session_id}")
print(f"\n4. SESSION ENDED: {session_id[:16]}...")

# 5. Get AI-powered summary
print("\n5. FETCHING AI PERFORMANCE SUMMARY...")
r = requests.get(f"{BASE}/performance/summary/{session_id}")
summary = r.json()

print(f"\n   Score: {summary['correct']}/{summary['total_questions']} ({summary['score_percent']}%)")
print(f"   Status: {summary['status']}")

ai = summary.get("ai_analysis", {})
print(f"\n   === AI ANALYSIS ===")
print(f"   ai_available: {ai.get('ai_available')}")
fb = ai.get("overall_feedback", "").encode("ascii", errors="replace").decode("ascii")
print(f"   Feedback: {fb}")
print(f"   Strong topics: {ai.get('strong_topics', [])}")
print(f"   Weak topics:   {ai.get('weak_topics', [])}")
print(f"   Priority topic: {ai.get('priority_topic', '')}")
print(f"   Subject breakdown: {ai.get('subject_breakdown', {})}")
print(f"\n   Recommendations:")
for rec in ai.get("recommendations", []):
    rec_ascii = rec.encode("ascii", errors="replace").decode("ascii")
    print(f"     - {rec_ascii}")

print("\n=== TEST COMPLETE ===")
