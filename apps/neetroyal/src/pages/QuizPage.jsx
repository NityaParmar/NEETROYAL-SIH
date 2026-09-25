import React, {
  useState,
  useEffect,
  useRef,
} from 'react';

import {
  Shield,
  Flame,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
  Swords,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Trophy,
} from 'lucide-react';

import { WS_BASE_URL } from '../config.js';

export default function QuizArena({
  onReturnToHub,
  token,
  currentUser,
}) {
  const wsRef = useRef(null);

  /*
   * Prevent duplicate connection attempts.
   */
  const isConnectingRef =
    useRef(false);

  /*
   * React cleanup can happen very quickly in
   * development / StrictMode.
   *
   * We delay actual socket closing by one tick.
   */
  const cleanupTimerRef =
    useRef(null);

  /*
   * Once the user explicitly exits,
   * we don't want cleanup/reconnect logic
   * fighting the exit flow.
   */
  const exitRequestedRef =
    useRef(false);

  const [
    reconnectAttempt,
    setReconnectAttempt,
  ] = useState(0);

  const [
    matchStatus,
    setMatchStatus,
  ] = useState('CONNECTING');

  const [
    errorMsg,
    setErrorMsg,
  ] = useState('');

  const [
    performanceReport,
    setPerformanceReport,
  ] = useState(null);

  const [
    isPerformanceLoading,
    setIsPerformanceLoading,
  ] = useState(false);

  /*
   * Controls whether the user has chosen
   * to view the AI performance analysis.
   *
   * The backend may generate the report in
   * the background, but we don't display it
   * automatically.
   */
  const [
    showPerformance,
    setShowPerformance,
  ] = useState(false);

  const [
    gameId,
    setGameId,
  ] = useState(null);

  const [
    opponent,
    setOpponent,
  ] = useState(null);

  const [
    currentQuestion,
    setCurrentQuestion,
  ] = useState(null);

  const [
    questionIndex,
    setQuestionIndex,
  ] = useState(1);

  const [
    totalQuestions,
    setTotalQuestions,
  ] = useState(5);

  const [
    selectedOption,
    setSelectedOption,
  ] = useState(null);

  const [
    isAnswered,
    setIsAnswered,
  ] = useState(false);

  const [
    roundResult,
    setRoundResult,
  ] = useState(null);

  const [
    timeLeft,
    setTimeLeft,
  ] = useState(15);

  const [
    scores,
    setScores,
  ] = useState({});

  const [
    userHp,
    setUserHp,
  ] = useState(100);

  const [
    opponentHp,
    setOpponentHp,
  ] = useState(100);

  const [
    streak,
    setStreak,
  ] = useState(0);

  const [
    gameOverData,
    setGameOverData,
  ] = useState(null);

  /*
   * Quit confirmation modal.
   */
  const [
    showQuitModal,
    setShowQuitModal,
  ] = useState(false);

  const [
    isExiting,
    setIsExiting,
  ] = useState(false);

  const myId =
    currentUser?.id;

  /*
   * Retry WebSocket connection.
   */
  const handleRetry = () => {
    exitRequestedRef.current = false;

    setErrorMsg('');

    isConnectingRef.current =
      false;

    setMatchStatus(
      'CONNECTING'
    );

    setReconnectAttempt(
      (prev) => prev + 1
    );
  };

  /*
   * Start AI bot match.
   */
  const handleStartBotMatch = () => {
    const socket =
      wsRef.current;

    if (
      socket &&
      socket.readyState ===
        WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type: 'init_bot_game',
        })
      );
    }
  };

  /*
   * ============================================================
   * QUIT MATCH
   * ============================================================
   */
  const handleConfirmQuit = () => {
    /*
     * Prevent double click / duplicate
     * exit_game messages.
     */
    if (
      exitRequestedRef.current
    ) {
      return;
    }

    exitRequestedRef.current =
      true;

    setIsExiting(true);

    setShowQuitModal(false);

    const socket =
      wsRef.current;

    /*
     * Tell backend explicitly that
     * the user wants to forfeit.
     *
     * We intentionally don't rely only
     * on socket.close().
     */
    if (
      socket &&
      socket.readyState ===
        WebSocket.OPEN
    ) {
      try {
        socket.send(
          JSON.stringify({
            type: 'exit_game',

            payload: {
              gameId,
            },
          })
        );
      } catch (error) {
        console.error(
          'Failed to send exit_game:',
          error
        );
      }

      /*
       * Give backend a small amount of time
       * to process exit_game and persist the
       * abandoned match.
       */
      setTimeout(() => {
        try {
          if (
            socket.readyState ===
            WebSocket.OPEN
          ) {
            socket.close(
              1000,
              'match_exit'
            );
          }
        } finally {
          onReturnToHub();
        }
      }, 150);
    } else {
      /*
       * Socket is already unavailable.
       */
      onReturnToHub();
    }
  };

  /*
   * ============================================================
   * WEBSOCKET CONNECTION
   * ============================================================
   */
  useEffect(() => {
    /*
     * Cancel a delayed cleanup from a
     * previous effect execution.
     *
     * This is important for React 18 StrictMode.
     */
    if (
      cleanupTimerRef.current
    ) {
      clearTimeout(
        cleanupTimerRef.current
      );

      cleanupTimerRef.current =
        null;
    }

    const authToken =
      token ||
      localStorage.getItem(
        'token'
      );

    if (!authToken) {
      setErrorMsg(
        'No authentication token found. Please login first.'
      );

      setMatchStatus(
        'ERROR'
      );

      return;
    }

    /*
     * Never create another socket while
     * one is already connecting/open.
     */
    if (
      isConnectingRef.current ||
      (
        wsRef.current &&
        (
          wsRef.current.readyState ===
            WebSocket.OPEN ||
          wsRef.current.readyState ===
            WebSocket.CONNECTING
        )
      )
    ) {
      return;
    }

    /*
     * Reset explicit exit state whenever
     * a brand-new connection is created.
     */
    exitRequestedRef.current =
      false;

    isConnectingRef.current =
      true;

    const wsUrl =
      `${WS_BASE_URL}?token=${encodeURIComponent(
        authToken
      )}`;

    console.log(
      'Connecting to:',
      wsUrl
    );

    const socket =
      new WebSocket(wsUrl);

    wsRef.current =
      socket;

    /*
     * ==========================================================
     * OPEN
     * ==========================================================
     */
    socket.onopen = () => {
      console.log(
        '⚡ Connected to 1v1 Battle WebSocket Server'
      );

      isConnectingRef.current =
        false;

      setMatchStatus(
        'WAITING'
      );

      setErrorMsg('');

      /*
       * Start human matchmaking.
       */
      socket.send(
        JSON.stringify({
          type: 'init_game',
        })
      );
    };

    /*
     * ==========================================================
     * MESSAGE
     * ==========================================================
     */
    socket.onmessage = (
      event
    ) => {
      try {
        const message =
          JSON.parse(
            event.data
          );

        const {
          type,
          payload,
        } = message;

        switch (type) {
          /*
           * ----------------------------------------------------
           * WAITING
           * ----------------------------------------------------
           */
          case 'waiting_for_opponent': {
            setMatchStatus(
              'WAITING'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * GAME STARTED
           * ----------------------------------------------------
           */
          case 'game_started': {
            /*
             * Ignore malformed game_started.
             */
            if (!payload?.gameId) {
              console.warn(
                'Received game_started without gameId:',
                payload
              );

              break;
            }

            console.log(
              '🎮 MATCH STARTED:',
              payload.gameId
            );

            setGameId(
              payload.gameId
            );

            setOpponent(
              payload.opponent ||
                null
            );

            setTotalQuestions(
              payload.totalQuestions ||
                5
            );

            setUserHp(100);

            setOpponentHp(
              100
            );

            setScores({});

            setStreak(0);

            setGameOverData(
              null
            );

            setCurrentQuestion(
              null
            );

            setRoundResult(
              null
            );

            /*
             * Reset AI analysis state
             * for the new match.
             */
            setPerformanceReport(
              null
            );

            setIsPerformanceLoading(
              false
            );

            setShowPerformance(
              false
            );

            setMatchStatus(
              'PLAYING'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * QUESTION
           * ----------------------------------------------------
           */
          case 'question': {
            const question =
              payload?.question ||
              payload;

            setCurrentQuestion(
              question
            );

            setQuestionIndex(
              payload?.questionIndex ||
                1
            );

            setTotalQuestions(
              payload?.totalQuestions ||
                5
            );

            setSelectedOption(
              null
            );

            setIsAnswered(
              false
            );

            setRoundResult(
              null
            );

            setTimeLeft(
              payload?.timeLimit ||
                15
            );

            setMatchStatus(
              'PLAYING'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * ANSWER ACCEPTED
           * ----------------------------------------------------
           */
          case 'answer_accepted': {
            setSelectedOption(
              payload?.selectedOption
            );

            setIsAnswered(
              true
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * QUESTION RESULT
           * ----------------------------------------------------
           */
          case 'question_result': {
            setRoundResult(
              payload
            );

            /*
             * Keep showing the question during
             * review period.
             */
            setMatchStatus(
              'REVIEW'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * SCORE UPDATE
           * ----------------------------------------------------
           */
          case 'score_update': {
            setScores(
              payload?.scores ||
                {}
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * NORMAL GAME OVER
           * ----------------------------------------------------
           */
          case 'game_over': {
            setGameOverData(
              payload
            );

            /*
             * Do not automatically show the
             * AI performance report.
             *
             * The report may still be generated
             * by the backend in the background.
             */
            setPerformanceReport(
              null
            );

            setIsPerformanceLoading(
              false
            );

            setShowPerformance(
              false
            );

            setMatchStatus(
              'GAME_OVER'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * AI PERFORMANCE REPORT
           * ----------------------------------------------------
           */
          case 'performance_report': {
            console.log(
              '🤖 AI PERFORMANCE REPORT:',
              payload?.report
            );

            setPerformanceReport(
              payload?.report || null
            );

            /*
             * If the user already clicked
             * "Analyze My Performance", stop
             * the loading state.
             *
             * Otherwise the report simply stays
             * hidden until the user clicks.
             */
            setIsPerformanceLoading(
              false
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * OPPONENT DISCONNECTED
           * ----------------------------------------------------
           */
          case 'opponent_disconnected': {
            setGameOverData({
              winnerId:
                payload?.winnerId ||
                myId,

              isDraw: false,

              reason:
                'disconnect',

              message:
                payload?.message ||
                'Opponent disconnected. You win by default!',
            });

            /*
             * Hide AI analysis automatically.
             */
            setPerformanceReport(
              null
            );

            setIsPerformanceLoading(
              false
            );

            setShowPerformance(
              false
            );

            setMatchStatus(
              'GAME_OVER'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * EXPLICIT FORFEIT
           * ----------------------------------------------------
           */
          case 'match_forfeit': {
            const youExited =
              payload?.youExited ===
              true;

            /*
             * If I clicked Quit, don't show
             * the opponent-win screen.
             *
             * The Quit handler already returns
             * me to the hub.
             */
            if (
              youExited
            ) {
              return;
            }

            /*
             * Opponent quit.
             */
            setGameOverData({
              winnerId:
                payload?.winnerId ||
                null,

              isDraw: false,

              reason:
                'forfeit',

              message:
                payload?.message ||
                'Opponent quit the match.',
            });

            /*
             * Hide AI analysis automatically.
             */
            setPerformanceReport(
              null
            );

            setIsPerformanceLoading(
              false
            );

            setShowPerformance(
              false
            );

            setMatchStatus(
              'GAME_OVER'
            );

            break;
          }

          /*
           * ----------------------------------------------------
           * ERROR
           * ----------------------------------------------------
           */
          case 'error': {
            setErrorMsg(
              payload?.message ||
                'WebSocket Error occurred'
            );

            setMatchStatus(
              'ERROR'
            );

            break;
          }

          default:
            break;
        }
      } catch (error) {
        console.error(
          'Error parsing WS message:',
          error
        );
      }
    };

    /*
     * ==========================================================
     * ERROR
     * ==========================================================
     */
    socket.onerror = (
      error
    ) => {
      console.error(
        'WebSocket Error:',
        error
      );

      /*
       * Don't overwrite a deliberate
       * quit operation with a connection error.
       */
      if (
        exitRequestedRef.current
      ) {
        return;
      }

      setErrorMsg(
        'Failed to connect to battle server.'
      );

      setMatchStatus(
        'ERROR'
      );
    };

    /*
     * ==========================================================
     * CLOSE
     * ==========================================================
     */
    socket.onclose = (
      event
    ) => {
      console.log(
        'WebSocket connection closed:',
        event.code,
        event.reason
      );

      /*
       * Only clear wsRef if THIS socket
       * is still the active socket.
       */
      if (
        wsRef.current ===
        socket
      ) {
        wsRef.current =
          null;
      }

      isConnectingRef.current =
        false;

      /*
       * Explicit exit is expected.
       */
      if (
        exitRequestedRef.current
      ) {
        return;
      }

      /*
       * Authentication failure.
       */
      if (
        event.code ===
        4001
      ) {
        setErrorMsg(
          'Authentication expired or unauthorized. Please re-login.'
        );

        setMatchStatus(
          'ERROR'
        );

        return;
      }

      /*
       * Unexpected close while the component
       * is still alive.
       *
       * Don't immediately reconnect here.
       *
       * This prevents the old:
       *
       * connect -> close -> reconnect ->
       * close -> reconnect
       *
       * loop.
       */
    };

    /*
     * ==========================================================
     * CLEANUP
     * ==========================================================
     */
    return () => {
      /*
       * IMPORTANT:
       *
       * Do not immediately socket.close().
       *
       * React 18 StrictMode can execute:
       *
       * effect
       * cleanup
       * effect
       *
       * during development.
       *
       * Immediate close makes the backend believe
       * the player actually disconnected.
       */
      cleanupTimerRef.current =
        setTimeout(() => {
          /*
           * Only close if this socket is
           * still the active socket.
           */
          if (
            wsRef.current ===
              socket &&
            !exitRequestedRef.current
          ) {
            if (
              socket.readyState ===
                WebSocket.OPEN ||
              socket.readyState ===
                WebSocket.CONNECTING
            ) {
              try {
                socket.close(
                  1000,
                  'component_unmount'
                );
              } catch {
                // Socket already closed.
              }
            }

            wsRef.current =
              null;

            isConnectingRef.current =
              false;
          }
        }, 0);
    };
  }, [
    token,
    reconnectAttempt,
  ]);

  /*
   * ============================================================
   * QUESTION TIMER
   * ============================================================
   */
  useEffect(() => {
    if (
      matchStatus !==
        'PLAYING' ||
      !currentQuestion
    ) {
      return;
    }

    const timer =
      setInterval(() => {
        setTimeLeft(
          (previous) => {
            if (
              previous <= 1
            ) {
              clearInterval(
                timer
              );

              return 0;
            }

            return previous - 1;
          }
        );
      }, 1000);

    return () =>
      clearInterval(timer);
  }, [
    matchStatus,
    currentQuestion,
  ]);

  /*
   * ============================================================
   * SELECT ANSWER
   * ============================================================
   */
  const handleSelectOption = (
    optionIndex
  ) => {
    if (
      isAnswered ||
      (
        matchStatus !==
          'PLAYING' &&
        matchStatus !==
          'REVIEW'
      ) ||
      !currentQuestion
    ) {
      return;
    }

    /*
     * Never allow answering during review.
     */
    if (
      matchStatus ===
      'REVIEW'
    ) {
      return;
    }

    setSelectedOption(
      optionIndex
    );

    setIsAnswered(
      true
    );

    const socket =
      wsRef.current;

    if (
      socket &&
      socket.readyState ===
        WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type:
            'submit_answer',

          payload: {
            questionId:
              currentQuestion.id,

            selectedOption:
              optionIndex,
          },
        })
      );
    }
  };

  /*
   * ============================================================
   * AI PERFORMANCE ANALYSIS
   * ============================================================
   */
  const handleAnalyzePerformance = () => {
    /*
     * The backend is already generating the
     * report in the background.
     *
     * If it has arrived, simply reveal it.
     * Otherwise show the loading state until
     * performance_report arrives.
     */
    setShowPerformance(
      true
    );

    if (
      performanceReport
    ) {
      setIsPerformanceLoading(
        false
      );
    } else {
      setIsPerformanceLoading(
        true
      );
    }
  };

  /*
   * ============================================================
   * CONNECTION ERROR SCREEN
   * ============================================================
   */
  if (
    matchStatus ===
      'ERROR' ||
    errorMsg
  ) {
    return (
      <div className="min-h-screen w-full bg-slate-50 dark:bg-black text-slate-900 dark:text-emerald-400 flex flex-col items-center justify-center p-6 font-mono">
        <div className="p-8 max-w-md w-full bg-white dark:bg-zinc-950 border border-red-500/40 rounded-2xl shadow-xl text-center space-y-5">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto" />

          <div className="space-y-1">
            <h2 className="text-xl font-bold font-sans text-red-500 uppercase">
              CONNECTION ERROR
            </h2>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {errorMsg}
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-2.5">
            <button
              onClick={
                handleRetry
              }
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-4 h-4" />

              <span>
                RETRY CONNECTION
              </span>
            </button>

            <button
              onClick={
                onReturnToHub
              }
              className="w-full py-3 rounded-xl border border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-900 font-bold text-xs uppercase cursor-pointer transition-colors"
            >
              RETURN TO HUB
            </button>
          </div>
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * MATCHMAKING SCREEN
   * ============================================================
   */
  if (
    matchStatus ===
      'CONNECTING' ||
    matchStatus ===
      'WAITING'
  ) {
    return (
      <div className="min-h-screen w-full bg-slate-50 dark:bg-black text-slate-900 dark:text-emerald-400 flex flex-col items-center justify-center p-6 font-mono">
        <div className="relative flex flex-col items-center space-y-6 text-center">
          <div className="relative flex items-center justify-center">
            <div className="w-28 h-28 rounded-full border-4 border-slate-300 dark:border-emerald-950 border-t-emerald-600 dark:border-t-emerald-400 animate-spin"></div>

            <Swords className="w-12 h-12 text-emerald-600 dark:text-emerald-400 absolute animate-pulse" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-black font-sans tracking-widest text-emerald-600 dark:text-emerald-400 uppercase">
              SEARCHING FOR
              OPPONENT...
            </h2>

            <p className="text-xs text-slate-500 dark:text-emerald-600 font-mono">
              SKILL-BASED 1v1 NEET
              MATCHMAKING • NEET
              BATTLE ARENA
            </p>
          </div>

          <div className="px-5 py-2.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-400 dark:border-emerald-500/40 text-xs text-emerald-800 dark:text-emerald-300 font-mono flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>

            <span>
              WAITING FOR ASPIRANT
              IN QUEUE...
            </span>
          </div>

          <button
            onClick={
              handleStartBotMatch
            }
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs uppercase tracking-wider transition-all shadow-lg cursor-pointer"
          >
            🤖 SWITCH TO
            INSTANT AI BOT
            MATCH
          </button>

          <button
            onClick={
              onReturnToHub
            }
            className="mt-2 px-6 py-2.5 rounded-xl border border-slate-300 dark:border-emerald-900/60 text-slate-600 dark:text-emerald-600 hover:text-slate-900 dark:hover:text-emerald-400 text-xs font-bold uppercase transition-colors cursor-pointer"
          >
            Cancel Matchmaking
          </button>
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * GAME OVER
   * ============================================================
   */
  if (
    matchStatus ===
    'GAME_OVER'
  ) {
    const isWinner =
      gameOverData?.winnerId ===
      myId;

    const isDraw =
      gameOverData?.isDraw;

    const isForfeit =
      gameOverData?.reason ===
      'forfeit';

    const isDisconnect =
      gameOverData?.reason ===
      'disconnect';

    const userFinalScore =
      (
        scores &&
        myId &&
        scores[myId]
      ) !== undefined
        ? scores[myId]
        : gameOverData
            ?.finalScores?.[
            myId
          ] ?? 0;

    const oppFinalScore =
      (
        scores &&
        opponent?.id &&
        scores[
          opponent.id
        ]
      ) !== undefined
        ? scores[
            opponent.id
          ]
        : gameOverData
            ?.finalScores?.[
            opponent?.id
          ] ?? 0;

    /*
     * AI analysis data.
     *
     * The backend sends:
     *
     * performanceReport
     *   └── ai_analysis
     *       ├── overall_feedback
     *       ├── strong_topics
     *       ├── weak_topics
     *       ├── subject_breakdown
     *       ├── recommendations
     *       └── priority_topic
     */
    const aiAnalysis =
      performanceReport?.ai_analysis ||
      null;

    const strongTopics =
      Array.isArray(
        aiAnalysis?.strong_topics
      )
        ? aiAnalysis.strong_topics
        : [];

    const weakTopics =
      Array.isArray(
        aiAnalysis?.weak_topics
      )
        ? aiAnalysis.weak_topics
        : [];

    const recommendations =
      Array.isArray(
        aiAnalysis?.recommendations
      )
        ? aiAnalysis.recommendations
        : [];

    const subjectBreakdown =
      aiAnalysis?.subject_breakdown ||
      {};

    return (
      <div className="relative min-h-screen w-full bg-slate-50 dark:bg-black text-slate-900 dark:text-emerald-400 flex flex-col items-center justify-center p-6 font-mono">
        <div className="p-8 max-w-lg w-full bg-white dark:bg-zinc-950 border border-slate-200 dark:border-emerald-900/80 rounded-2xl shadow-2xl text-center space-y-6">
          <Trophy
            className={`w-20 h-20 mx-auto ${
              isWinner
                ? 'text-yellow-400 animate-bounce'
                : 'text-slate-400'
            }`}
          />

          <div className="space-y-1">
            <h2 className="text-3xl sm:text-4xl font-black font-sans uppercase">
              {isWinner
                ? '🎉 VICTORY!'
                : isDraw
                  ? '🤝 DRAW'
                  : isForfeit
                    ? '🏆 OPPONENT QUIT'
                    : '💔 DEFEAT'}
            </h2>

            <p className="text-xs text-slate-500 dark:text-emerald-600">
              {isForfeit
                ? 'Your opponent exited the match. No match points were awarded for the forfeit.'
                : isDisconnect
                  ? 'Your opponent disconnected. The match ended as a forfeit.'
                  : isWinner
                    ? 'Excellent performance! NEET rating points awarded.'
                    : 'Good effort! Review answers to master concepts.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-emerald-950 font-mono">
            <div className="space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">
                You
              </span>

              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {userFinalScore}{' '}
                pts
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">
                {opponent?.name ||
                  'Opponent'}
              </span>

              <p className="text-2xl font-black text-slate-700 dark:text-slate-300">
                {oppFinalScore}{' '}
                pts
              </p>
            </div>
          </div>

          {/* ================================================== */}
          {/* AI PERFORMANCE ANALYSIS */}
          {/* ================================================== */}

          <div className="p-5 rounded-xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-emerald-950 text-left">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-emerald-500" />

              <h3 className="font-black uppercase tracking-wider">
                AI Performance Analysis
              </h3>
            </div>

            {/* BEFORE ANALYSIS */}
            {!showPerformance ? (
              <>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-6">
                  Want a detailed AI analysis of your performance,
                  weak topics, and areas to improve?
                </p>

                <button
                  type="button"
                  onClick={
                    handleAnalyzePerformance
                  }
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />

                  Analyze My Performance
                </button>
              </>
            ) : isPerformanceLoading ? (
              /* LOADING */
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-sm text-slate-500 dark:text-emerald-600">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />

                <span className="font-bold">
                  ANALYZING YOUR PERFORMANCE...
                </span>

                <span className="text-xs text-slate-400 dark:text-slate-600">
                  Preparing your personalized report
                </span>
              </div>
            ) : performanceReport ? (
              /* ==================================================
               * FORMATTED REPORT
               * ================================================== */
              <div className="space-y-5">

                {/* OVERALL FEEDBACK */}
                {aiAnalysis?.overall_feedback && (
                  <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-emerald-500" />

                      <p className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Overall Feedback
                      </p>
                    </div>

                    <p className="text-sm leading-6 text-slate-700 dark:text-emerald-200">
                      {aiAnalysis.overall_feedback}
                    </p>
                  </div>
                )}

                {/* SCORE + QUESTIONS */}
                <div className="grid grid-cols-2 gap-3">

                  <div className="p-4 rounded-xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-emerald-950">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">
                      Score
                    </p>

                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                      {performanceReport.score_percent ?? 0}%
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-emerald-950">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">
                      Correct
                    </p>

                    <p className="text-2xl font-black text-slate-800 dark:text-slate-200 mt-1">
                      {performanceReport.correct ?? 0}/
                      {performanceReport.total_questions ?? 0}
                    </p>
                  </div>

                </div>

                {/* PRIORITY TOPIC */}
                {aiAnalysis?.priority_topic && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Priority Topic
                    </p>

                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                      <p className="text-sm font-bold text-amber-800 dark:text-amber-300 leading-5">
                        {aiAnalysis.priority_topic}
                      </p>
                    </div>
                  </div>
                )}

                {/* STRONG TOPICS */}
                {strongTopics.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Strong Topics
                    </p>

                    <div className="space-y-2">
                      {strongTopics.map(
                        (
                          topic,
                          index
                        ) => (
                          <div
                            key={`${topic}-${index}`}
                            className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-950"
                          >
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />

                            <span className="text-sm text-slate-700 dark:text-emerald-300">
                              {topic}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* WEAK TOPICS */}
                {weakTopics.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Topics To Improve
                    </p>

                    <div className="space-y-2">
                      {weakTopics.map(
                        (
                          topic,
                          index
                        ) => (
                          <div
                            key={`${topic}-${index}`}
                            className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-950"
                          >
                            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />

                            <span className="text-sm text-slate-700 dark:text-red-300 leading-5">
                              {topic}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* SUBJECT BREAKDOWN */}
                {Object.keys(
                  subjectBreakdown
                ).length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Subject Breakdown
                    </p>

                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(
                        subjectBreakdown
                      ).map(
                        (
                          [
                            subject,
                            data,
                          ]
                        ) => (
                          <div
                            key={subject}
                            className="p-3 rounded-xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-emerald-950 text-center"
                          >
                            <p className="text-xs font-bold uppercase text-slate-500 truncate">
                              {subject}
                            </p>

                            <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1">
                              {data?.correct ??
                                0}
                              /
                              {data?.total ??
                                0}
                            </p>

                            <p className="text-[10px] text-slate-400 uppercase mt-0.5">
                              Correct
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* RECOMMENDATIONS */}
                {recommendations.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Recommendations
                    </p>

                    <div className="space-y-2">
                      {recommendations.map(
                        (
                          recommendation,
                          index
                        ) => (
                          <div
                            key={`${index}-${recommendation}`}
                            className="flex items-start gap-2 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-950"
                          >
                            <ArrowRight className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />

                            <p className="text-sm leading-5 text-slate-700 dark:text-indigo-300">
                              {recommendation}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* FALLBACK MESSAGE */}
                {!aiAnalysis?.overall_feedback &&
                  !aiAnalysis?.priority_topic &&
                  strongTopics.length === 0 &&
                  weakTopics.length === 0 &&
                  recommendations.length === 0 &&
                  Object.keys(
                    subjectBreakdown
                  ).length === 0 && (
                    <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900 text-center">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Analysis completed, but no detailed insights were returned.
                      </p>
                    </div>
                  )}
              </div>
            ) : (
              /* NO REPORT */
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Performance analysis is unavailable right now.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={
              onReturnToHub
            }
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all cursor-pointer uppercase tracking-wider text-xs shadow-lg"
          >
            RETURN TO HUB
          </button>
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * ACTIVE QUIZ ARENA
   * ============================================================
   */
  return (
    <div className="relative min-h-screen w-full bg-slate-50 dark:bg-black text-slate-900 dark:text-emerald-400 overflow-x-hidden p-4 sm:p-6 md:p-8 font-mono transition-colors duration-300">

      {/* ====================================================== */}
      {/* HEADER */}
      {/* ====================================================== */}

      <header className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-emerald-950">
        <span className="text-2xl font-black font-sans tracking-wider text-slate-900 dark:text-emerald-400 flex items-center gap-2">
          Quiz Arena

          <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 uppercase tracking-widest px-2.5 py-0.5 rounded bg-emerald-100 dark:bg-black border border-emerald-300 dark:border-emerald-800">
            1v1 LIVE MATCH
          </span>
        </span>

        <div className="flex items-center gap-3">

          {/* TIMER */}
          <div className="flex items-center gap-3 px-5 py-2 rounded-2xl bg-white dark:bg-black border border-slate-200 dark:border-emerald-900 shadow-sm font-mono">
            <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />

            <span
              className={`text-xl font-black ${
                timeLeft <= 3
                  ? 'text-rose-500 animate-pulse'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              00:
              {timeLeft < 10
                ? `0${timeLeft}`
                : timeLeft}
              s
            </span>
          </div>

          {/* QUIT BUTTON */}
          <button
            type="button"
            onClick={() =>
              setShowQuitModal(
                true
              )
            }
            disabled={
              isExiting
            }
            className="px-4 py-2 rounded-xl border border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white font-bold text-xs uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Quit
          </button>
        </div>
      </header>

      {/* ====================================================== */}
      {/* MAIN */}
      {/* ====================================================== */}

      <main className="max-w-7xl mx-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* QUESTION AREA */}
        <div className="lg:col-span-8 space-y-6">

          {/* QUESTION */}
          <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-black border border-slate-200 dark:border-emerald-900/60 shadow-lg space-y-4">
            <p className="text-xs font-mono text-slate-500 dark:text-emerald-600 uppercase tracking-widest">
              QUESTION{' '}
              {questionIndex}{' '}
              OF{' '}
              {totalQuestions}
            </p>

            <p className="text-base sm:text-xl font-black font-sans leading-relaxed text-slate-900 dark:text-slate-200">
              {currentQuestion?.questionText ||
                currentQuestion?.question ||
                'Loading question...'}
            </p>
          </div>

          {/* OPTIONS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              currentQuestion?.options ||
              []
            ).map(
              (
                optText,
                index
              ) => {
                const optLabel =
                  String.fromCharCode(
                    65 + index
                  );

                const isSelected =
                  selectedOption ===
                  index;

                const isCorrectAnswer =
                  roundResult?.correctAnswer ===
                  index;

                const isWrongSelection =
                  roundResult &&
                  isSelected &&
                  !isCorrectAnswer;

                let btnStyle =
                  'bg-white dark:bg-black border-slate-200 dark:border-emerald-900/60 text-slate-900 dark:text-slate-200 hover:border-emerald-500';

                if (
                  isSelected &&
                  !roundResult
                ) {
                  btnStyle =
                    'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-500 text-emerald-900 font-bold shadow-md';
                }

                if (
                  roundResult
                ) {
                  if (
                    isCorrectAnswer
                  ) {
                    btnStyle =
                      'bg-emerald-100 dark:bg-emerald-950 border-emerald-500 text-emerald-950 font-bold shadow-lg ring-2 ring-emerald-500';
                  } else if (
                    isWrongSelection
                  ) {
                    btnStyle =
                      'bg-red-50 dark:bg-red-950/60 border-red-500 text-red-700 font-bold';
                  } else {
                    btnStyle =
                      'bg-white dark:bg-black border-slate-100 dark:border-zinc-900 text-slate-400 opacity-50';
                  }
                }

                return (
                  <button
                    key={index}
                    onClick={() =>
                      handleSelectOption(
                        index
                      )
                    }
                    disabled={
                      isAnswered ||
                      matchStatus ===
                        'REVIEW'
                    }
                    className={`p-4 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer font-mono shadow-sm ${btnStyle}`}
                  >
                    <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 dark:bg-zinc-950 border border-slate-300 dark:border-emerald-900 flex items-center justify-center font-bold text-xs text-slate-600 dark:text-emerald-400">
                      {optLabel}
                    </span>

                    <span className="text-sm font-medium pt-0.5 leading-snug">
                      {optText}
                    </span>
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* ==================================================== */}
        {/* SIDEBAR */}
        {/* ==================================================== */}

        <div className="lg:col-span-4 space-y-6">

          <div className="p-6 rounded-2xl bg-white dark:bg-black border border-slate-200 dark:border-emerald-900/60 shadow-lg space-y-6">

            <h3 className="text-xs font-mono font-bold text-slate-900 dark:text-emerald-400 tracking-widest uppercase pb-3 border-b border-slate-200 dark:border-emerald-950">
              1v1 LIVE DUEL
            </h3>

            <div className="space-y-5 font-mono">

              {/* PLAYER */}
              <div>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span>
                    YOU (
                    {currentUser?.name ||
                      'Aspirant'}
                    )
                  </span>

                  <span className="text-emerald-600">
                    {scores[
                      myId
                    ] ||
                      0}{' '}
                    PTS
                  </span>
                </div>

                <div className="h-3 w-full bg-slate-200 dark:bg-zinc-950 rounded-full overflow-hidden p-0.5 border border-slate-300 dark:border-emerald-900">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${userHp}%`,
                    }}
                  ></div>
                </div>
              </div>

              {/* OPPONENT */}
              <div>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span>
                    {opponent?.name ||
                      'Opponent'}
                  </span>

                  <span className="text-slate-600">
                    {scores[
                      opponent?.id
                    ] ||
                      0}{' '}
                    PTS
                  </span>
                </div>

                <div className="h-3 w-full bg-slate-200 dark:bg-zinc-950 rounded-full overflow-hidden p-0.5 border border-slate-300 dark:border-emerald-900">
                  <div
                    className="h-full bg-emerald-800 rounded-full transition-all duration-500"
                    style={{
                      width: `${opponentHp}%`,
                    }}
                  ></div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>

      {/* ====================================================== */}
      {/* QUIT CONFIRMATION MODAL */}
      {/* ====================================================== */}

      {showQuitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-950 border border-red-500/40 shadow-2xl p-6">

            <div className="flex items-start gap-4">

              <div className="shrink-0 w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-500" />
              </div>

              <div>
                <h2 className="text-lg font-black font-sans uppercase text-slate-900 dark:text-white">
                  Quit Match?
                </h2>

                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Are you sure you
                  want to quit?
                  Match progress
                  will be lost.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">

              {/* CONTINUE */}
              <button
                type="button"
                onClick={() =>
                  setShowQuitModal(
                    false
                  )
                }
                disabled={
                  isExiting
                }
                className="flex-1 py-3 rounded-xl border border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-900 font-bold text-xs uppercase transition-colors disabled:opacity-50"
              >
                Continue Match
              </button>

              {/* QUIT */}
              <button
                type="button"
                onClick={
                  handleConfirmQuit
                }
                disabled={
                  isExiting
                }
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase transition-colors disabled:opacity-50"
              >
                {isExiting
                  ? 'Exiting...'
                  : 'Yes, Quit'}
              </button>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}