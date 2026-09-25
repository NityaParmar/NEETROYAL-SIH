import crypto from "crypto";
import axios from "axios";
import { prisma } from "@repo/db";
import { User } from "./User.js";
import {
  GAME_STARTED,
  QUESTION,
  ANSWER_ACCEPTED,
  QUESTION_RESULT,
  SCORE_UPDATE,
  GAME_OVER,
  OPPONENT_DISCONNECTED,
  MATCH_FORFEIT,
  PERFORMANCE_REPORT,
} from "./messages.js";
import {
  NEET_SCORING,
  QUESTION_TIME_LIMIT_SEC,
  REVIEW_TIME_LIMIT_SEC,
} from "./config.js";

export interface QuestionItem {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: number;
  subject: string;
  topic?: string | null;
  difficulty: string;
  explanation?: string | null;
}

export class Game {
  public gameId: string;

  public player1: User;
  public player2: User;

  public player1Score = 0;
  public player2Score = 0;

  public player1Answer: number | null = null;
  public player2Answer: number | null = null;

  public questions: QuestionItem[];
  public currentQuestionIndex = 0;

  public startTime: Date;

  private timer: NodeJS.Timeout | null = null;
  private reviewTimer: NodeJS.Timeout | null = null;

  private isFinished = false;
  private hasStarted = false;

  private aiServiceUrl =
    process.env.AI_SERVICE_URL || "http://localhost:8000";

  private performanceSessions = new Map<string, string>();
  private pendingPerformanceRequests = new Set<Promise<void>>();

  private onGameOver: (
    gameId: string,
    shouldUpdateScores: boolean
  ) => void;

  constructor(
    player1: User,
    player2: User,
    questions: QuestionItem[],
    onGameOver: (
      gameId: string,
      shouldUpdateScores: boolean
    ) => void
  ) {
    this.gameId = `game_${crypto
      .randomUUID()
      .replace(/-/g, "")
      .substring(0, 10)}`;

    this.player1 = player1;
    this.player2 = player2;
    this.questions = questions;
    this.startTime = new Date();
    this.onGameOver = onGameOver;
  }

  private safeSend(
    user: User,
    message: unknown
  ): boolean {
    if (user.socket.readyState !== 1) {
      return false;
    }

    try {
      user.send(message);
      return true;
    } catch (error) {
      console.error(
        `[GAME ${this.gameId}] Send error:`,
        error
      );

      return false;
    }
  }

  public start(): boolean {
    if (this.hasStarted || this.isFinished) {
      return false;
    }

    if (
      this.player1.socket.readyState !== 1 ||
      this.player2.socket.readyState !== 1
    ) {
      this.isFinished = true;
      this.clearTimers();
      this.onGameOver(this.gameId, false);
      return false;
    }

    this.hasStarted = true;

    this.safeSend(this.player1, {
      type: GAME_STARTED,
      payload: {
        gameId: this.gameId,
        opponent: {
          id: this.player2.id,
          username: this.player2.username,
          name: this.player2.name,
          points: this.player2.points,
          avatar: this.player2.avatar,
        },
        totalQuestions: this.questions.length,
        timeLimit: QUESTION_TIME_LIMIT_SEC,
        scoring: {
          correct: `+${NEET_SCORING.CORRECT}`,
          wrong: `${NEET_SCORING.WRONG}`,
          unanswered: `${NEET_SCORING.UNANSWERED}`,
        },
      },
    });

    this.safeSend(this.player2, {
      type: GAME_STARTED,
      payload: {
        gameId: this.gameId,
        opponent: {
          id: this.player1.id,
          username: this.player1.username,
          name: this.player1.name,
          points: this.player1.points,
          avatar: this.player1.avatar,
        },
        totalQuestions: this.questions.length,
        timeLimit: QUESTION_TIME_LIMIT_SEC,
        scoring: {
          correct: `+${NEET_SCORING.CORRECT}`,
          wrong: `${NEET_SCORING.WRONG}`,
          unanswered: `${NEET_SCORING.UNANSWERED}`,
        },
      },
    });

    console.log(
      `🎮 [GAME ${this.gameId}] STARTED: ${this.player1.name} vs ${this.player2.name}`
    );

    setTimeout(() => {
      if (!this.isFinished) {
        this.sendQuestion();
      }
    }, 300);

    return true;
  }

  private sendQuestion() {
    if (this.isFinished) {
      return;
    }

    if (
      this.currentQuestionIndex >=
      this.questions.length
    ) {
      void this.endGame();
      return;
    }

    this.player1Answer = null;
    this.player2Answer = null;

    const currentQ =
      this.questions[this.currentQuestionIndex];

    if (!currentQ) {
      void this.endGame();
      return;
    }

    const payload = {
      type: QUESTION,
      payload: {
        gameId: this.gameId,
        questionIndex:
          this.currentQuestionIndex + 1,
        totalQuestions:
          this.questions.length,
        timeLimit:
          QUESTION_TIME_LIMIT_SEC,
        question: {
          id: currentQ.id,
          questionText:
            currentQ.questionText,
          options: currentQ.options,
          subject: currentQ.subject,
          topic: currentQ.topic,
          difficulty: currentQ.difficulty,
        },
      },
    };

    this.safeSend(
      this.player1,
      payload
    );

    this.safeSend(
      this.player2,
      payload
    );

    this.clearQuestionTimer();

    this.timer = setTimeout(
      () => this.evaluateQuestion(),
      QUESTION_TIME_LIMIT_SEC * 1000
    );
  }

  public submitAnswer(
    user: User,
    questionId: string,
    selectedOption: number
  ) {
    if (this.isFinished) {
      return;
    }

    const currentQ =
      this.questions[this.currentQuestionIndex];

    if (
      !currentQ ||
      currentQ.id !== questionId
    ) {
      return;
    }

    const isP1 =
      user.id === this.player1.id;

    const isP2 =
      user.id === this.player2.id;

    if (!isP1 && !isP2) {
      return;
    }

    if (
      isP1 &&
      this.player1Answer !== null
    ) {
      return;
    }

    if (
      isP2 &&
      this.player2Answer !== null
    ) {
      return;
    }

    if (
      !Number.isInteger(selectedOption) ||
      selectedOption < 0 ||
      selectedOption >= currentQ.options.length
    ) {
      return;
    }

    const isCorrect =
      selectedOption ===
      currentQ.correctAnswer;

    const scoreDelta = isCorrect
      ? NEET_SCORING.CORRECT
      : NEET_SCORING.WRONG;

    if (isP1) {
      this.player1Answer =
        selectedOption;

      this.player1Score +=
        scoreDelta;

      this.safeSend(this.player1, {
        type: ANSWER_ACCEPTED,
        payload: {
          questionId,
          selectedOption,
          isCorrect,
          scoreDelta,
          totalScore:
            this.player1Score,
        },
      });
    } else {
      this.player2Answer =
        selectedOption;

      this.player2Score +=
        scoreDelta;

      this.safeSend(this.player2, {
        type: ANSWER_ACCEPTED,
        payload: {
          questionId,
          selectedOption,
          isCorrect,
          scoreDelta,
          totalScore:
            this.player2Score,
        },
      });
    }

    this.recordPerformanceAnswer(
      user,
      currentQ,
      selectedOption
    );

    if (
      this.player1Answer !== null &&
      this.player2Answer !== null
    ) {
      this.clearQuestionTimer();
      this.evaluateQuestion();
    }
  }

  private recordPerformanceAnswer(
    user: User,
    question: QuestionItem,
    selectedOption: number
  ) {
    const letters = [
      "A",
      "B",
      "C",
      "D",
    ];

    const chosenAnswer =
      letters[selectedOption];

    if (!chosenAnswer) {
      return;
    }

    const promise =
      this.sendPerformanceAnswer(
        user,
        question,
        chosenAnswer
      );

    this.pendingPerformanceRequests.add(
      promise
    );

    void promise.finally(() => {
      this.pendingPerformanceRequests.delete(
        promise
      );
    });
  }

  private async sendPerformanceAnswer(
    user: User,
    question: QuestionItem,
    chosenAnswer: string
  ): Promise<void> {
    const sessionId =
      this.getPerformanceSessionId(
        user.id
      );

    try {
      await axios.post(
        `${this.aiServiceUrl}/answers/submit`,
        {
          session_id: sessionId,
          user_id: user.id,
          match_id: this.gameId,
          question_id: Number(question.id),
          chosen_answer: chosenAnswer,
          subject: question.subject,
        },
        {
          timeout: 5000,
        }
      );
    } catch (error) {
      console.error(
        `[GAME ${this.gameId}] Performance answer failed:`,
        error
      );
    }
  }

  private getPerformanceSessionId(
    userId: string
  ): string {
    const existing =
      this.performanceSessions.get(
        userId
      );

    if (existing) {
      return existing;
    }

    const sessionId =
      `session_${this.gameId}_${userId}`;

    this.performanceSessions.set(
      userId,
      sessionId
    );

    return sessionId;
  }

 private async finishPerformanceSessions() {
  if (this.pendingPerformanceRequests.size) {
    await Promise.allSettled(
      Array.from(this.pendingPerformanceRequests)
    );
  }

  const reports = new Map<string, unknown>();

  await Promise.allSettled(
    Array.from(this.performanceSessions.entries()).map(
      async ([userId, sessionId]) => {
        try {
          // 1. Mark performance session as completed
          await axios.post(
            `${this.aiServiceUrl}/performance/end/${sessionId}`,
            {},
            { timeout: 5000 }
          );

          // 2. Generate/fetch final AI performance analysis
          const response = await axios.get(
            `${this.aiServiceUrl}/performance/summary/${sessionId}`,
            {
              timeout: 15000,
            }
          );

          reports.set(
            userId,
            response.data
          );
        } catch (error) {
          console.error(
            `[GAME ${this.gameId}] Performance report failed for ${userId}:`,
            error
          );
        }
      }
    )
  );

  // Send each player ONLY their own performance report.
  for (const [userId, report] of reports.entries()) {
    const player =
      userId === this.player1.id
        ? this.player1
        : userId === this.player2.id
          ? this.player2
          : null;

    if (!player) {
      continue;
    }

    this.safeSend(player, {
      type: PERFORMANCE_REPORT,
      payload: {
        gameId: this.gameId,
        report,
      },
    });
  }
}

  private evaluateQuestion() {
    if (this.isFinished) {
      return;
    }

    this.clearQuestionTimer();

    const currentQ =
      this.questions[
        this.currentQuestionIndex
      ];

    if (!currentQ) {
      void this.endGame();
      return;
    }

    const p1Ans =
      this.player1Answer;

    const p2Ans =
      this.player2Answer;

    const p1Correct =
      p1Ans !== null &&
      p1Ans ===
        currentQ.correctAnswer;

    const p2Correct =
      p2Ans !== null &&
      p2Ans ===
        currentQ.correctAnswer;

    const p1Delta =
      p1Ans === null
        ? NEET_SCORING.UNANSWERED
        : p1Correct
          ? NEET_SCORING.CORRECT
          : NEET_SCORING.WRONG;

    const p2Delta =
      p2Ans === null
        ? NEET_SCORING.UNANSWERED
        : p2Correct
          ? NEET_SCORING.CORRECT
          : NEET_SCORING.WRONG;

    const resultPayload = {
      type: QUESTION_RESULT,
      payload: {
        gameId: this.gameId,
        questionId: currentQ.id,
        correctAnswer:
          currentQ.correctAnswer,
        explanation:
          currentQ.explanation,

        player1: {
          id: this.player1.id,
          name: this.player1.name,
          selectedOption: p1Ans,
          isCorrect: p1Correct,
          scoreDelta: p1Delta,
          totalScore:
            this.player1Score,
        },

        player2: {
          id: this.player2.id,
          name: this.player2.name,
          selectedOption: p2Ans,
          isCorrect: p2Correct,
          scoreDelta: p2Delta,
          totalScore:
            this.player2Score,
        },
      },
    };

    const scorePayload = {
      type: SCORE_UPDATE,
      payload: {
        gameId: this.gameId,
        scores: {
          [this.player1.id]:
            this.player1Score,
          [this.player2.id]:
            this.player2Score,
        },
      },
    };

    this.safeSend(
      this.player1,
      resultPayload
    );

    this.safeSend(
      this.player2,
      resultPayload
    );

    this.safeSend(
      this.player1,
      scorePayload
    );

    this.safeSend(
      this.player2,
      scorePayload
    );

    if (this.reviewTimer) {
      clearTimeout(
        this.reviewTimer
      );
    }

    this.reviewTimer =
      setTimeout(() => {
        if (this.isFinished) {
          return;
        }

        this.currentQuestionIndex++;
        this.sendQuestion();
      }, REVIEW_TIME_LIMIT_SEC * 1000);
  }

  private async endGame() {
    if (this.isFinished) {
      return;
    }

    this.isFinished = true;
    this.clearTimers();

    let winnerId: string | null = null;

    if (
      this.player1Score >
      this.player2Score
    ) {
      winnerId = this.player1.id;
    } else if (
      this.player2Score >
      this.player1Score
    ) {
      winnerId = this.player2.id;
    }

    this.safeSend(this.player1, {
      type: GAME_OVER,
      payload: {
        gameId: this.gameId,
        winnerId,
        isDraw:
          this.player1Score ===
          this.player2Score,
        finalScores: {
          [this.player1.id]:
            this.player1Score,
          [this.player2.id]:
            this.player2Score,
        },
      },
    });

    this.safeSend(this.player2, {
      type: GAME_OVER,
      payload: {
        gameId: this.gameId,
        winnerId,
        isDraw:
          this.player1Score ===
          this.player2Score,
        finalScores: {
          [this.player1.id]:
            this.player1Score,
          [this.player2.id]:
            this.player2Score,
        },
      },
    });

    try {
      await prisma.match.create({
        data: {
          id: this.gameId,
          player1Id: this.player1.id,
          player2Id: this.player2.id,
          player1Score:
            this.player1Score,
          player2Score:
            this.player2Score,
          winnerId,
          status: "COMPLETED",
          startedAt: this.startTime,
          endedAt: new Date(),
        },
      });

      await prisma.user.update({
        where: {
          id: this.player1.id,
        },
        data: {
          points: {
            increment: Math.max(
              0,
              this.player1Score
            ),
          },
          matchesPlayed: {
            increment: 1,
          },
          matchesWon: {
            increment:
              winnerId ===
              this.player1.id
                ? 1
                : 0,
          },
          matchesLost: {
            increment:
              winnerId ===
              this.player2.id
                ? 1
                : 0,
          },
        },
      });

      await prisma.user.update({
        where: {
          id: this.player2.id,
        },
        data: {
          points: {
            increment: Math.max(
              0,
              this.player2Score
            ),
          },
          matchesPlayed: {
            increment: 1,
          },
          matchesWon: {
            increment:
              winnerId ===
              this.player2.id
                ? 1
                : 0,
          },
          matchesLost: {
            increment:
              winnerId ===
              this.player1.id
                ? 1
                : 0,
          },
        },
      });
    } catch (error) {
      console.error(
        `[GAME ${this.gameId}] Match save failed:`,
        error
      );
    }

    await this.finishPerformanceSessions();

    this.onGameOver(
      this.gameId,
      true
    );
  }

  public async handleDisconnect(
    user: User
  ) {
    if (this.isFinished) {
      return;
    }

    this.isFinished = true;
    this.clearTimers();

    const remainingPlayer =
      user.id === this.player1.id
        ? this.player2
        : this.player1;

    const winnerId =
      remainingPlayer.id;

    this.safeSend(
      remainingPlayer,
      {
        type: OPPONENT_DISCONNECTED,
        payload: {
          gameId: this.gameId,
          winnerId,
          message:
            "Opponent disconnected. You win by default!",
        },
      }
    );

    try {
      await prisma.match.create({
        data: {
          id: this.gameId,
          player1Id: this.player1.id,
          player2Id: this.player2.id,
          player1Score:
            this.player1Score,
          player2Score:
            this.player2Score,
          winnerId,
          status: "ABANDONED",
          startedAt: this.startTime,
          endedAt: new Date(),
        },
      });
    } catch (error) {
      console.error(
        `[GAME ${this.gameId}] Abandoned match save failed:`,
        error
      );
    }

    await this.finishPerformanceSessions();

    this.onGameOver(
      this.gameId,
      false
    );
  }

  public async handleExit(
    user: User
  ) {
    if (this.isFinished) {
      return;
    }

    this.isFinished = true;
    this.clearTimers();

    const remainingPlayer =
      user.id === this.player1.id
        ? this.player2
        : this.player1;

    const winnerId =
      remainingPlayer.id;

    this.safeSend(
      remainingPlayer,
      {
        type: MATCH_FORFEIT,
        payload: {
          gameId: this.gameId,
          exiterId: user.id,
          winnerId,
          isDraw: false,
          reason: "forfeit",
          message:
            "Opponent quit the match.",
        },
      }
    );

    this.safeSend(user, {
      type: MATCH_FORFEIT,
      payload: {
        gameId: this.gameId,
        exiterId: user.id,
        winnerId,
        isDraw: false,
        reason: "forfeit",
        youExited: true,
        message:
          "You exited the match.",
      },
    });

    try {
      await prisma.match.create({
        data: {
          id: this.gameId,
          player1Id: this.player1.id,
          player2Id: this.player2.id,
          player1Score:
            this.player1Score,
          player2Score:
            this.player2Score,
          winnerId,
          status: "ABANDONED",
          startedAt: this.startTime,
          endedAt: new Date(),
        },
      });
    } catch (error) {
      console.error(
        `[GAME ${this.gameId}] Forfeit save failed:`,
        error
      );
    }

    await this.finishPerformanceSessions();

    this.onGameOver(
      this.gameId,
      false
    );
  }

  private clearQuestionTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public clearTimers() {
    this.clearQuestionTimer();

    if (this.reviewTimer) {
      clearTimeout(
        this.reviewTimer
      );

      this.reviewTimer = null;
    }
  }
}