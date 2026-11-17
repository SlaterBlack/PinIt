import { Injectable, inject, signal } from "@angular/core";
import { Subscription } from "rxjs";
import { Boards } from "./boards";

export type BoardLiveStatus =
  "connecting" | "live" | "reconnecting" | "offline";

@Injectable({ providedIn: "root" })
export class BoardLive {
  private readonly boards = inject(Boards);
  private readonly statusSignal = signal<BoardLiveStatus>("offline");
  readonly status = this.statusSignal.asReadonly();

  connect(
    boardId: string,
    onUpdate: () => void,
    onAccessDenied: () => void,
  ): () => void {
    let disposed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let ticketRequest: Subscription | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const retry = (): void => {
      if (disposed || retryTimer) return;
      this.statusSignal.set("reconnecting");
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connectSocket();
      }, delay);
    };

    const connectSocket = (): void => {
      if (disposed) return;
      this.statusSignal.set(attempt ? "reconnecting" : "connecting");
      ticketRequest = this.boards.liveTicket().subscribe({
        next: ({ ticket }) => {
          if (disposed) return;
          const url = new URL("/api/pinit/live", window.location.href);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          socket = new WebSocket(url);
          socket.addEventListener("open", () => {
            socket?.send(JSON.stringify({ type: "authenticate", ticket }));
          });
          socket.addEventListener("message", (event: MessageEvent<string>) => {
            let message: unknown;
            try {
              message = JSON.parse(event.data);
            } catch {
              socket?.close(1008, "Invalid server message");
              return;
            }
            if (
              typeof message !== "object" ||
              message === null ||
              !("type" in message) ||
              typeof message.type !== "string"
            ) {
              socket?.close(1008, "Invalid server message");
              return;
            }
            if (message.type === "authenticated") {
              socket?.send(JSON.stringify({ type: "subscribe", boardId }));
            } else if (message.type === "subscribed") {
              attempt = 0;
              this.statusSignal.set("live");
            } else if (message.type === "board-updated") {
              onUpdate();
            } else if (message.type === "access-denied") {
              onAccessDenied();
              socket?.close(1008, "Board access revoked");
            }
          });
          socket.addEventListener("close", () => {
            if (!disposed) retry();
          });
          socket.addEventListener("error", () => {
            socket?.close();
          });
        },
        error: () => {
          if (!disposed) retry();
        },
      });
    };

    connectSocket();
    return () => {
      disposed = true;
      ticketRequest?.unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close(1000, "Board closed");
      this.statusSignal.set("offline");
    };
  }
}
