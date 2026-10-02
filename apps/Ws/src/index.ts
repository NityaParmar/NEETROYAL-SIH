import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { WS_PORT } from "./config.js";
import { GameManager } from "./GameManager.js";
import { extractAuthUser } from "./auth.js";
import { User } from "./User.js";

// 1. Create a lightweight HTTP server for Health Checks
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    // Flush immediately with Connection:close so cron probes get a clean 200
    // and don't stall waiting for keep-alive reuse.
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Connection": "close",
    });
    res.end("OK");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain", "Connection": "close" });
    res.end("Not Found");
  }
});

// Disable Nagle's algorithm so health-check responses are sent immediately
// without waiting to batch TCP packets — prevents Render probe timeouts.
server.on("connection", (socket) => {
  socket.setNoDelay(true);
});

// 2. Attach WebSocketServer to the HTTP server
const wss = new WebSocketServer({ server });
const gameManager = new GameManager();

// 3. Start listening on 0.0.0.0 (required for Render — binds all interfaces)
server.listen(WS_PORT, "0.0.0.0", () => {
  console.log(`⚡ WebSocket 1v1 MCQ Battle Backend running on port ${WS_PORT}`);
  console.log(`🏥 Health check available at http://localhost:${WS_PORT}/health`);
});

wss.on("connection", function connection(
  ws: WebSocket & { isEvicted?: boolean },
  req
) {
  const reqUrl = req.url || "/";
  const urlObj = new URL(
    reqUrl,
    `http://${req.headers.host || "localhost"}`
  );

  const token =
    urlObj.searchParams.get("token") ||
    (typeof req.headers["sec-websocket-protocol"] === "string"
      ? req.headers["sec-websocket-protocol"]
      : null) ||
    (req.headers.authorization
      ? req.headers.authorization.replace("Bearer ", "")
      : null);

  if (!token) {
    console.warn("❌ WS Connection rejected: Missing token");
    ws.close(4001, "Missing token");
    return;
  }

  /*
   * The browser can send init_game immediately after onopen.
   * Authentication is asynchronous, so without a small buffer the
   * first message can arrive before GameManager attaches its listener.
   */
  const earlyMessages: Buffer[] = [];
  let authenticated = false;
  let closed = false;

  const earlyMessageHandler = (data: Buffer) => {
    if (!authenticated && !closed) {
      earlyMessages.push(Buffer.from(data));
    }
  };

  ws.on("message", earlyMessageHandler);

  const closeHandler = () => {
    closed = true;
  };
  ws.once("close", closeHandler);

  void (async () => {
    const authUser = await extractAuthUser(token);

    if (!authUser) {
      console.warn("❌ WS Connection rejected: Invalid token");
      closed = true;
      ws.close(4001, "Invalid token");
      return;
    }

    /*
     * Check if this user already has a socket.
     */
    const existingUser = gameManager["users"]?.find(
      (u: any) => u.id === authUser.id
    );

    if (existingUser && existingUser.socket !== ws) {
      console.log(
        `🔄 Evicting stale socket for user: ${authUser.username} (${authUser.id})`
      );

      (existingUser.socket as any).isEvicted = true;
      existingUser.socket = ws;

      if (
        gameManager["pendingUser"] &&
        gameManager["pendingUser"].id === authUser.id
      ) {
        gameManager["pendingUser"].socket = ws;
      }
    } else {
      console.log(
        `✅ WS User Connected: ${authUser.username} (${authUser.id})`
      );

      const user = new User(ws, authUser);
      gameManager.addUser(user);
    }

    authenticated = true;

    /*
     * Remove the temporary buffering listener. GameManager now owns
     * the socket's message handling.
     */
    ws.off("message", earlyMessageHandler);
    ws.off("close", closeHandler);

    /*
     * Replay every message that arrived while auth was in progress.
     * This includes the frontend's immediate init_game.
     */
    for (const message of earlyMessages) {
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.emit("message", message);
    }

    ws.on("close", () => {
      if (!ws.isEvicted) {
        console.log(
          `🔌 WS User Disconnected: ${authUser.username}`
        );
        gameManager.removeUser(ws);
      } else {
        console.log(
          `ℹ️ Stale socket closed cleanly for ${authUser.username}`
        );
      }
    });

    ws.on("error", (err) => {
      console.error(
        `WS error for ${authUser.username}:`,
        err
      );
    });
  })().catch((error) => {
    console.error("❌ WS authentication/setup failed:", error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "WebSocket setup failed");
    }
  });
});