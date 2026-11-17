import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import {
  Board,
  BoardElement,
  BoardElementChanges,
  BoardGrant,
  NewBoardElement,
  BoardNote,
  BoardSummary,
} from "../models/board.model";

@Injectable({ providedIn: "root" })
export class Boards {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = "/api/pinit";

  list(): Observable<{ boards: BoardSummary[] }> {
    return this.http.get<{ boards: BoardSummary[] }>(`${this.apiUrl}/boards`);
  }

  create(title: string): Observable<{ board: Board }> {
    return this.http.post<{ board: Board }>(`${this.apiUrl}/boards`, { title });
  }

  get(
    id: string,
  ): Observable<{ board: Board; permission: BoardSummary["permission"] }> {
    return this.http.get<{
      board: Board;
      permission: BoardSummary["permission"];
    }>(`${this.apiUrl}/boards/${encodeURIComponent(id)}`);
  }

  updateTitle(id: string, title: string): Observable<{ board: Board }> {
    return this.http.patch<{ board: Board }>(
      `${this.apiUrl}/boards/${encodeURIComponent(id)}`,
      { title },
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/boards/${encodeURIComponent(id)}`,
    );
  }

  addNote(
    id: string,
    text = "",
  ): Observable<{ board: Board; element: BoardNote }> {
    return this.http.post<{ board: Board; element: BoardNote }>(
      `${this.apiUrl}/boards/${encodeURIComponent(id)}/elements`,
      { text },
    );
  }

  addElement(
    id: string,
    element: NewBoardElement,
  ): Observable<{ board: Board; element: BoardElement }> {
    return this.http.post<{ board: Board; element: BoardElement }>(
      `${this.apiUrl}/boards/${encodeURIComponent(id)}/elements`,
      element,
    );
  }

  updateElement(
    boardId: string,
    elementId: string,
    changes: BoardElementChanges,
  ): Observable<{ board: Board }> {
    return this.http.patch<{ board: Board }>(
      `${this.apiUrl}/boards/${encodeURIComponent(boardId)}/elements/${encodeURIComponent(elementId)}`,
      changes,
    );
  }

  removeElement(
    boardId: string,
    elementId: string,
  ): Observable<{ board: Board }> {
    return this.http.delete<{ board: Board }>(
      `${this.apiUrl}/boards/${encodeURIComponent(boardId)}/elements/${encodeURIComponent(elementId)}`,
    );
  }

  replaceElements(
    boardId: string,
    elements: BoardElement[],
    expectedUpdatedAt: string,
  ): Observable<{ board: Board }> {
    return this.http.put<{ board: Board }>(
      `${this.apiUrl}/boards/${encodeURIComponent(boardId)}/elements`,
      { elements, expectedUpdatedAt },
    );
  }

  updateNote(
    boardId: string,
    noteId: string,
    changes: Partial<Pick<BoardNote, "text" | "x" | "y" | "color">>,
  ): Observable<{ board: Board }> {
    return this.http.patch<{ board: Board }>(
      `${this.apiUrl}/boards/${encodeURIComponent(boardId)}/elements/${encodeURIComponent(noteId)}`,
      changes,
    );
  }

  removeNote(boardId: string, noteId: string): Observable<{ board: Board }> {
    return this.http.delete<{ board: Board }>(
      `${this.apiUrl}/boards/${encodeURIComponent(boardId)}/elements/${encodeURIComponent(noteId)}`,
    );
  }

  adminList(): Observable<{ boards: BoardSummary[] }> {
    return this.http.get<{ boards: BoardSummary[] }>(
      `${this.apiUrl}/admin/boards`,
    );
  }

  setDemoAccess(
    boardId: string,
    userId: string,
    permission: BoardGrant | null,
  ): Observable<{ board: BoardSummary }> {
    return this.http.put<{ board: BoardSummary }>(
      `${this.apiUrl}/admin/boards/${encodeURIComponent(boardId)}/access/${encodeURIComponent(userId)}`,
      { permission },
    );
  }

  liveTicket(): Observable<{ ticket: string }> {
    return this.http.post<{ ticket: string }>(`${this.apiUrl}/live-ticket`, {});
  }
}
