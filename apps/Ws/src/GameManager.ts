import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";
import { prisma } from "@repo/db";
import { User } from "./User.js";
import {
  Game,
  QuestionItem,
} from "./Game.js";
import {
  fetchQuestionsFromAI,
} from "./ai-questions.js";

import {
  INIT_GAME,
  SUBMIT_ANSWER,
  LEADERBOARD,
  LEADERBOARD_UPDATE,
  PING,
  PONG,
  EXIT_GAME,
} from "./messages.js";

import {
  QUESTIONS_PER_MATCH,
} from "./config.js";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

function loadQuestionsFromJson(): QuestionItem[] {
  const paths = [
    path.join(
      __dirname,
      "questions.json"
    ),
    path.join(
      __dirname,
      "../src/questions.json"
    ),
    path.join(
      process.cwd(),
      "apps/Ws/src/questions.json"
    ),
    path.join(
      process.cwd(),
      "src/questions.json"
    ),
  ];

  for (const p of paths) {
    if (!fs.existsSync(p)) {
      continue;
    }

    try {
      return JSON.parse(
        fs.readFileSync(
          p,
          "utf-8"
        )
      );
    } catch (error) {
      console.error(
        `[WS Questions] Failed to load ${p}:`,
        error
      );
    }
  }

  return [];
}

const DEFAULT_QUESTIONS =
  loadQuestionsFromJson();

export class GameManager {
  private games: Game[] = [];
  private pendingUser: User | null = null;
  private users: User[] = [];

  private inMemoryScores = new Map<
    string,
    {
      points: number;
      matchesWon: number;
      matchesPlayed: number;
    }
  >();

  public addUser(user: User) {
    this.users.push(user);

    if (
      !this.inMemoryScores.has(
        user.id
      )
    ) {
      this.inMemoryScores.set(
        user.id,
        {
          points:
            user.points || 0,
          matchesWon: 0,
          matchesPlayed: 0,
        }
      );
    }

    this.addHandler(user);

    void this.sendLeaderboard(user);
  }

  private isSocketOpen(
    user: User | null
  ) {
    return (
      !!user &&
      user.socket.readyState ===
        WebSocket.OPEN
    );
  }

  private findActiveGame(
    userId: string
  ) {
    return this.games.find(
      (game) =>
        game.player1.id ===
          userId ||
        game.player2.id ===
          userId
    );
  }

  private requeueIfConnected(
    user: User
  ) {
    if (
      !this.isSocketOpen(user) ||
      this.findActiveGame(user.id)
    ) {
      return;
    }

    if (
      this.pendingUser?.id ===
      user.id
    ) {
      return;
    }

    if (!this.pendingUser) {
      this.pendingUser = user;

      try {
        user.send({
          type:
            "waiting_for_opponent",
          payload: {
            message:
              "Searching for opponent...",
          },
        });
      } catch {
        this.pendingUser = null;
      }
    }
  }

  public removeUser(
    socket: WebSocket
  ) {
    const user =
      this.users.find(
        (u) => u.socket === socket
      );

    if (!user) {
      return;
    }

    console.log(
      `[WS] User disconnected: ${user.name} (${user.id})`
    );

    this.users =
      this.users.filter(
        (u) => u.socket !== socket
      );

    if (
      this.pendingUser?.socket ===
      socket
    ) {
      this.pendingUser = null;
    }

    const game =
      this.findActiveGame(
        user.id
      );

    if (game) {
      void game.handleDisconnect(
        user
      );
    }
  }

  public removeGame(
    gameId: string
  ) {
    this.games =
      this.games.filter(
        (game) =>
          game.gameId !== gameId
      );
  }

  private addHandler(
    user: User
  ) {
    user.socket.on(
      "message",
      async (data) => {
        try {
          const message =
            JSON.parse(
              data.toString()
            );

          const type =
            String(
              message?.type ?? ""
            ).trim();

          const isInitGame =
            type === INIT_GAME ||
            type === "init_game";

          const isBotGame =
            type === "init_bot_game";

          const isSubmitAnswer =
            type ===
              SUBMIT_ANSWER ||
            type ===
              "submit_answer";

          const isExitGame =
            type === EXIT_GAME ||
            type === "exit_game";

          const isLeaderboard =
            type === LEADERBOARD ||
            type ===
              "leaderboard";

          const isPing =
            type === PING ||
            type === "ping";

          console.log(
            `[WS] ${user.name} -> ${type}`
          );

          // -------------------------
          // Human matchmaking
          // -------------------------

          if (isInitGame) {
            if (
              this.findActiveGame(
                user.id
              )
            ) {
              return;
            }

            if (
              this.pendingUser &&
              !this.isSocketOpen(
                this.pendingUser
              )
            ) {
              this.pendingUser = null;
            }

            if (
              this.pendingUser?.id ===
              user.id
            ) {
              user.send({
                type:
                  "waiting_for_opponent",
                payload: {
                  message:
                    "Already waiting for opponent...",
                },
              });

              return;
            }

            if (!this.pendingUser) {
              this.pendingUser = user;

              user.send({
                type:
                  "waiting_for_opponent",
                payload: {
                  message:
                    "Searching for opponent...",
                },
              });

              return;
            }

            const opponent =
              this.pendingUser;

            this.pendingUser = null;

            if (
              !this.isSocketOpen(
                opponent
              ) ||
              !this.isSocketOpen(user)
            ) {
              this.requeueIfConnected(
                opponent
              );

              this.requeueIfConnected(
                user
              );

              return;
            }

            const questions =
              await this.getQuestions(
                QUESTIONS_PER_MATCH
              );

            if (
              !this.isSocketOpen(
                opponent
              ) ||
              !this.isSocketOpen(user)
            ) {
              this.requeueIfConnected(
                opponent
              );

              this.requeueIfConnected(
                user
              );

              return;
            }

            let game!: Game;

            game = new Game(
              opponent,
              user,
              questions,
              (gameId) => {
                this.updateScoresAfterGame(
                  game
                );

                this.removeGame(
                  gameId
                );

                void this.broadcastLeaderboard();
              }
            );

            this.games.push(game);

            if (!game.start()) {
              this.removeGame(
                game.gameId
              );

              return;
            }

            return;
          }

          // -------------------------
          // Bot game
          // -------------------------

          if (isBotGame) {
            if (
              this.findActiveGame(
                user.id
              )
            ) {
              return;
            }

            if (
              this.pendingUser?.id ===
              user.id
            ) {
              this.pendingUser = null;
            }

            const botSocket =
              {
                send: () => {},
                on: () => {},
                readyState: 1,
              } as unknown as WebSocket;

            const bot =
              new User(botSocket, {
                id: "bot_ai_agent",
                username: "bot_ai_agent",
                email: "bot_ai_agent@neetroyal.local",
                name: "NEET AI Bot",
                points: 0,
                avatar: null,
              });

            const questions =
              await this.getQuestions(
                QUESTIONS_PER_MATCH
              );

            if (
              !this.isSocketOpen(user)
            ) {
              return;
            }

            let game!: Game;

            game = new Game(
              user,
              bot,
              questions,
              (gameId) => {
                this.updateScoresAfterGame(
                  game
                );

                this.removeGame(
                  gameId
                );

                void this.broadcastLeaderboard();
              }
            );

            this.games.push(game);

            if (!game.start()) {
              this.removeGame(
                game.gameId
              );

              return;
            }

            const botInterval =
              setInterval(() => {
                if (
                  !this.games.includes(
                    game
                  )
                ) {
                  clearInterval(
                    botInterval
                  );

                  return;
                }

                const question =
                  game.questions[
                    game.currentQuestionIndex
                  ];

                if (!question) {
                  return;
                }

                const answer =
                  Math.floor(
                    Math.random() * 4
                  );

                game.submitAnswer(
                  bot,
                  question.id,
                  answer
                );
              }, 4000);

            return;
          }

          // -------------------------
          // Answer
          // -------------------------

          if (
            isSubmitAnswer &&
            message.payload
          ) {
            const game =
              this.findActiveGame(
                user.id
              );

            if (!game) {
              return;
            }

            game.submitAnswer(
              user,
              message.payload
                .questionId,
              message.payload
                .selectedOption
            );

            return;
          }

          // -------------------------
          // Exit
          // -------------------------

          if (isExitGame) {
            const game =
              this.findActiveGame(
                user.id
              );

            if (!game) {
              return;
            }

            await game.handleExit(
              user
            );

            return;
          }

          // -------------------------
          // Leaderboard
          // -------------------------

          if (isLeaderboard) {
            await this.sendLeaderboard(
              user
            );

            return;
          }

          // -------------------------
          // Ping
          // -------------------------

          if (isPing) {
            user.send({
              type: PONG,
              timestamp: Date.now(),
            });
          }
        } catch (error) {
          console.error(
            "[WS] Message handling error:",
            error
          );
        }
      }
    );
  }

  private updateScoresAfterGame(
    game: Game
  ) {
    const p1 =
      this.inMemoryScores.get(
        game.player1.id
      );

    if (p1) {
      p1.points += Math.max(
        0,
        game.player1Score
      );

      p1.matchesPlayed++;

      if (
        game.player1Score >
        game.player2Score
      ) {
        p1.matchesWon++;
      }
    }

    const p2 =
      this.inMemoryScores.get(
        game.player2.id
      );

    if (p2) {
      p2.points += Math.max(
        0,
        game.player2Score
      );

      p2.matchesPlayed++;

      if (
        game.player2Score >
        game.player1Score
      ) {
        p2.matchesWon++;
      }
    }
  }

  private answerLetterToIndex(
    answer: string
  ): number {
    switch (
      String(answer)
        .trim()
        .toUpperCase()
    ) {
      case "A":
        return 0;

      case "B":
        return 1;

      case "C":
        return 2;

      case "D":
        return 3;

      default:
        throw new Error(
          `[WS Questions] Invalid correct_answer: ${answer}`
        );
    }
  }

  public async getQuestions(
    count: number = 5
  ): Promise<QuestionItem[]> {
    try {
      const aiQuestions =
        await fetchQuestionsFromAI(
          count
        );

      if (
        aiQuestions.length > 0
      ) {
        return aiQuestions.map(
          (q) => ({
            id: String(q.id),

            questionText:
              q.questionText,

            options:
              q.options,

            correctAnswer:
              this.answerLetterToIndex(
                q.correctAnswer
              ),

            subject:
              q.subject,

            topic:
              q.topic ||
              "General",

            difficulty:
              q.difficulty ||
              "MEDIUM",

            explanation:
              q.explanation ||
              null,
          })
        );
      }
    } catch (error) {
      console.warn(
        "[WS Questions] AI loading failed."
      );
    }

    // Database fallback
    try {
      const dbQuestions =
        await prisma.question.findMany({
          take: 50,
        });

      if (
        dbQuestions.length > 0
      ) {
        return [
          ...dbQuestions,
        ]
          .sort(
            () =>
              0.5 -
              Math.random()
          )
          .slice(0, count)
          .map((q) => ({
            id: String(q.id),

            questionText:
              q.questionText,

            options:
              Array.isArray(q.options)
                ? (q.options as string[])
                : typeof q.options ===
                    "string"
                  ? JSON.parse(
                      q.options
                    )
                  : [
                      "A",
                      "B",
                      "C",
                      "D",
                    ],

            correctAnswer:
              q.correctAnswer,

            subject:
              q.subject,

            topic:
              q.topic,

            difficulty:
              q.difficulty,

            explanation:
              q.explanation,
          }));
      }
    } catch (error) {
      console.warn(
        "[WS Questions] DB loading failed."
      );
    }

    // Local fallback
    const pool =
      DEFAULT_QUESTIONS.length > 0
        ? DEFAULT_QUESTIONS
        : this.getFallbackHardcoded();

    return [
      ...pool,
    ]
      .sort(
        () =>
          0.5 -
          Math.random()
      )
      .slice(0, count);
  }

  private getFallbackHardcoded(): QuestionItem[] {
    return [
      {
        id: "q1",

        questionText:
          "Which organelle is known as the 'Powerhouse of the Cell'?",

        options: [
          "Ribosome",
          "Mitochondria",
          "Endoplasmic Reticulum",
          "Golgi",
        ],

        correctAnswer: 1,

        subject: "Biology",

        difficulty: "EASY",

        explanation:
          "Mitochondria produce ATP.",
      },
    ];
  }

  public async sendLeaderboard(
    user: User
  ) {
    const leaderboard =
      await this.getLeaderboardData();

    try {
      user.send({
        type:
          LEADERBOARD_UPDATE,

        payload: {
          leaderboard,
        },
      });
    } catch (error) {
      console.error(
        "[WS Leaderboard] Send failed:",
        error
      );
    }
  }

  public async broadcastLeaderboard() {
    const leaderboard =
      await this.getLeaderboardData();

    const payload = {
      type:
        LEADERBOARD_UPDATE,

      payload: {
        leaderboard,
      },
    };

    for (const user of this.users) {
      if (
        user.socket.readyState ===
        WebSocket.OPEN
      ) {
        try {
          user.send(payload);
        } catch {
          // socket closed
        }
      }
    }
  }

  private async getLeaderboardData() {
    try {
      const users =
        await prisma.user.findMany({
          take: 20,

          orderBy: [
            {
              points: "desc",
            },
            {
              matchesWon: "desc",
            },
          ],

          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
            points: true,
            matchesWon: true,
            matchesPlayed: true,
          },
        });

      if (users.length > 0) {
        return users.map(
          (user: any, index: number) => ({
            rank: index + 1,
            ...user,
          })
        );
      }
    } catch {
      // use memory fallback
    }

    const list =
      this.users.map((user: User) => {
        const stats =
          this.inMemoryScores.get(
            user.id
          ) || {
            points:
              user.points || 0,
            matchesWon: 0,
            matchesPlayed: 0,
          };

        return {
          id: user.id,
          username:
            user.username,
          name: user.name,
          avatar:
            user.avatar || null,
          points:
            stats.points,
          matchesWon:
            stats.matchesWon,
          matchesPlayed:
            stats.matchesPlayed,
        };
      });

    list.sort(
      (a, b) =>
        b.points - a.points
    );

    return list.map(
      (user: any, index: number) => ({
        rank: index + 1,
        ...user,
      })
    );
  }
}