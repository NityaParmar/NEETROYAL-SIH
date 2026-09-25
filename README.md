# 🧠 NEETROYAL

### Real-Time Multiplayer NEET Battle Arena with AI-Powered Performance Analysis

> **NEETROYAL** is a real-time multiplayer competitive learning platform designed around NEET preparation. Players can challenge each other in live 1v1 MCQ battles, compete through timed questions, and receive personalized post-match performance analysis powered by an AI/RAG pipeline.

---

## 🚀 Overview

NEET preparation can become repetitive when learning is limited to conventional question banks and individual practice.

**NEETROYAL** turns MCQ practice into a competitive experience.

Two players enter a real-time **1v1 battle**, receive the same NEET-style questions, answer under time pressure, and compete based on their performance.

After the match, NEETROYAL can analyze the player's performance and provide:

* 📊 Overall performance feedback
* 🎯 Weak topics
* 💪 Strong topics
* 📚 Subject-wise performance
* 🔥 Priority topic for revision
* 📝 Personalized recommendations

The project combines a modern web application, real-time WebSocket communication, a question service, and a separate AI/RAG microservice.

---

# ✨ Core Features

## ⚔️ Real-Time 1v1 Battle

Players can compete against another player in a live MCQ match.

* Real-time matchmaking
* WebSocket-based communication
* Synchronized questions
* Timed answering
* Server-side scoring
* Live opponent state
* Match completion handling

---

## 🧠 NEET Question System

NEET-style MCQs are served through the backend question system.

Questions contain:

* Question text
* Multiple-choice options
* Correct answer
* Subject/topic information

The correct answer is kept on the server side for trusted scoring.

---

## 🔐 Authentication

NEETROYAL includes authentication and user-related backend functionality.

The application separates:

* Frontend authentication flow
* HTTP API
* WebSocket authentication
* User-specific match state

---

## 🤖 AI-Powered Performance Analysis

After a match, the performance service records the player's answers and generates a structured performance report.

The analysis can identify:

* Overall performance
* Correct vs incorrect answers
* Score percentage
* Strong topics
* Weak topics
* Subject breakdown
* Priority revision topic
* Recommended areas for revision

The frontend presents this information in a dedicated post-match analysis interface.

---

# 🧬 AI + RAG Pipeline

The AI system is implemented as a separate FastAPI microservice.

```text
                 NEET Questions
                       │
                       ▼
              Question Registry
                       │
                       ▼
                FAISS Embeddings
                       │
                       ▼
              Semantic Retrieval
                       │
                       ▼
              Performance Context
                       │
                       ▼
                 AI Analysis
                       │
                       ▼
            Personalized Report
```

The AI service is responsible for the performance-analysis pipeline while the Node.js services remain responsible for the real-time game experience.

### AI service components

```text
neet-royale-ai-stage1/
│
├── app/
│   ├── api/
│   │   ├── ai_analysis.py
│   │   ├── answers.py
│   │   ├── match.py
│   │   └── performance.py
│   │
│   ├── db/
│   │   ├── performance_db.py
│   │   ├── question_registry.py
│   │   ├── page_registry.py
│   │   └── source_registry.py
│   │
│   ├── extraction/
│   ├── ingestion/
│   ├── models/
│   └── rag/
│       ├── embedder.py
│       └── generator.py
│
├── data/
├── requirements.txt
└── README.md
```

---

# 🏗️ System Architecture

```text
                        ┌─────────────────────┐
                        │   React + Vite      │
                        │     Frontend        │
                        └──────────┬──────────┘
                                   │
                         HTTP / WebSocket
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
          ┌─────────────────┐           ┌─────────────────┐
          │   HTTP Server   │           │ WebSocket Server│
          │    Node.js      │           │    Node.js      │
          └────────┬────────┘           └────────┬────────┘
                   │                             │
                   │                             │
                   │                    ┌────────▼────────┐
                   │                    │   GameManager   │
                   │                    │      + Game     │
                   │                    └────────┬────────┘
                   │                             │
                   └──────────────┬──────────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │   FastAPI AI       │
                       │     Service        │
                       └──────────┬──────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
             ┌──────────────┐           ┌──────────────┐
             │ Question DB  │           │ FAISS Index  │
             │  Registry    │           │  Embeddings  │
             └──────────────┘           └──────────────┘
                                  │
                                  ▼
                         ┌────────────────┐
                         │  Groq / LLM    │
                         └────────────────┘
```

---

# 🛠️ Tech Stack

## Frontend

* React
* Vite
* Tailwind CSS
* JavaScript / JSX
* Lucide React

## Backend

* Node.js
* TypeScript
* WebSockets
* HTTP API
* Prisma

## AI Service

* Python
* FastAPI
* Sentence Transformers
* FAISS
* Groq
* Pydantic

## Database / Storage

* PostgreSQL / Prisma-based application data
* SQLite-based AI service registries
* FAISS vector index

## Package Management

* pnpm
* Turborepo

---

# 📁 Project Structure

```text
NEETROYAL V1.0/
│
├── apps/
│   │
│   ├── neetroyal/
│   │   └── React + Vite frontend
│   │
│   ├── Ws/
│   │   └── WebSocket multiplayer server
│   │
│   └── http/
│       └── HTTP API server
│
├── packages/
│   │
│   ├── db/
│   │   ├── Prisma schema
│   │   └── database layer
│   │
│   ├── ui/
│   │   └── shared UI components
│   │
│   └── eslint-config/
│       └── shared lint configuration
│
├── neet-royale-ai-stage1/
│   │
│   ├── app/
│   │   ├── api/
│   │   ├── db/
│   │   ├── extraction/
│   │   ├── ingestion/
│   │   ├── models/
│   │   └── rag/
│   │
│   ├── data/
│   ├── requirements.txt
│   └── README.md
│
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── turbo.json
```

---

# 🔄 Match Flow

A typical 1v1 match follows this flow:

```text
Player 1
   │
   ├──────────────┐
   │              │
   ▼              ▼
Matchmaking ← Player 2
       │
       ▼
  Game Created
       │
       ▼
Questions Loaded
       │
       ▼
  Live 1v1 Battle
       │
       ├── Player answers
       ├── Server validates
       ├── Score updated
       └── Performance recorded
       │
       ▼
   Match Ends
       │
       ▼
Performance Session Ends
       │
       ▼
Performance Summary
       │
       ▼
AI / RAG Analysis
       │
       ▼
Post-Match Report
```

---

# 📊 Performance Analysis

The performance service maintains a session for each player during a match.

For each answer, the system records information such as:

```text
Session
├── user
├── match
├── question
├── chosen answer
├── subject
└── correctness
```

After the match, the collected information is transformed into a performance summary.

Example structure:

```json
{
  "total_questions": 5,
  "correct": 3,
  "incorrect": 2,
  "score_percent": 60,
  "ai_analysis": {
    "overall_feedback": "...",
    "strong_topics": [],
    "weak_topics": [],
    "subject_breakdown": {},
    "recommendations": [],
    "priority_topic": "..."
  }
}
```

---

# 🔌 Service Endpoints

The AI service exposes endpoints for:

```text
POST /answers/submit
GET  /performance/summary/{session_id}
POST /performance/end/{session_id}
```

The Node.js question integration communicates with the AI service through the configured AI service URL.

---

# 💻 Local Development

## Prerequisites

Make sure you have:

* Node.js
* pnpm
* Python 3.13+
* Git

---

## 1. Clone the repository

```bash
git clone https://github.com/NityaParmar/NEETROYAL-SIH.git
cd NEETROYAL-SIH
```

---

## 2. Install Node dependencies

```bash
pnpm install
```

---

## 3. Configure environment variables

Create the required `.env` files based on the provided `.env.example` files.

Never commit real secrets.

Typical environment configuration includes:

```text
DATABASE_URL=...
JWT_SECRET=...
AI_SERVICE_URL=...
GROQ_API_KEY=...
```

The exact variables depend on the service being configured.

---

# 🐍 AI Service Setup

Move into the AI service:

```bash
cd neet-royale-ai-stage1
```

Create a virtual environment:

### Windows

```powershell
python -m venv venv
venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure the AI service environment variables.

Then start FastAPI:

```bash
uvicorn app.main:app --reload --port 8000
```

The AI service will be available locally at:

```text
http://127.0.0.1:8000
```

---

# ▶️ Run the Node.js Application

From the project root:

```bash
pnpm dev
```

The monorepo development environment starts the Node/frontend services according to the workspace configuration.

The frontend development server is served by Vite.

---

# 🔗 Local Service Architecture

During development, the services communicate approximately as follows:

```text
Frontend
   │
   ├── HTTP ───────────────► HTTP API
   │
   └── WebSocket ──────────► WS Server
                                  │
                                  ▼
                             AI Service
                                  │
                                  ▼
                              FAISS / DB
                                  │
                                  ▼
                                Groq
```

---

# 🔐 Security Notes

NEETROYAL uses separate environment configuration for secrets and local development data.

The repository intentionally excludes sensitive or generated files such as:

```text
.env
venv/
.venv/
node_modules/
*.db
FAISS indexes
generated PDF data
```

**Never commit:**

* API keys
* database passwords
* JWT secrets
* private credentials
* production environment files

Use environment variables in deployment environments.

---

# 📦 AI Data

The AI service uses generated/local data including:

```text
data/
├── registry.db
├── performance.db
├── faiss_index/
└── raw_pdfs/
```

These generated/runtime artifacts are intentionally excluded from Git.

For production deployment, the required question registry and vector index must be provisioned separately on the AI service.

---

# 🧪 Development Philosophy

NEETROYAL is structured as a modular system rather than a single application.

```text
Frontend
   ↓
HTTP / WebSocket
   ↓
Node.js services
   ↓
AI microservice
   ↓
RAG + LLM
```

This separation allows the real-time game system and AI system to evolve independently.

---

# 🎯 Project Goals

NEETROYAL aims to explore how competitive multiplayer mechanics can be combined with AI-assisted learning.

The core idea is simple:

> **Don't just tell students whether they were right or wrong. Help them understand what they should work on next.**

---

# 🚧 Current Development Status

### Implemented

* [x] React/Vite frontend
* [x] Authentication flow
* [x] HTTP backend
* [x] WebSocket server
* [x] Real-time 1v1 MCQ battle
* [x] Server-side scoring
* [x] NEET question integration
* [x] AI question service integration
* [x] Performance tracking
* [x] FastAPI AI service
* [x] RAG infrastructure
* [x] FAISS-based retrieval
* [x] AI performance analysis
* [x] Post-match performance UI

### In Progress

* [ ] Production deployment
* [ ] Production service configuration
* [ ] Production AI data provisioning
* [ ] Final SIH demonstration environment

---

# 🏆 Smart India Hackathon

**NEETROYAL-SIH** is the deployment repository for the NEETROYAL project prepared for demonstration and evaluation in the **Smart India Hackathon (SIH)** context.

The project combines:

```text
Competitive Learning
        +
Real-Time Multiplayer
        +
NEET MCQs
        +
AI
        +
RAG
```

into one learning experience.

---

# 👨‍💻 Development

Built as a full-stack engineering project using a monorepo architecture.

### Repository

**NEETROYAL-SIH**

### Author

**Project Hail Mary**

---

## ⭐ If you find the project interesting

Give the repository a star and follow the project as NEETROYAL continues to evolve.

---

> **NEETROYAL — Learn. Compete. Analyze. Improve.**
