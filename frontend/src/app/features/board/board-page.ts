// Copyright Epic Games, Inc. All Rights Reserved.

import { HttpErrorResponse } from "@angular/common/http";
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import {
  Board,
  BoardNote,
  BoardPermission,
} from "../../core/models/board.model";
import { BoardLive } from "../../core/services/board-live";
import { Boards } from "../../core/services/boards";

@Component({
  selector: "app-board-page",
  imports: [FormsModule, RouterLink],
  templateUrl: "./board-page.html",
  styleUrl: "./board-page.scss",
})
export class BoardPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly boardService = inject(Boards);
  private readonly boardLive = inject(BoardLive);
  @ViewChild("canvas") private canvas?: ElementRef<HTMLElement>;

  readonly boardId = this.route.snapshot.paramMap.get("boardId") ?? "";
  readonly isSample = this.boardId === "sample";
  readonly board = signal<Board | null>(null);
  readonly permission = signal<BoardPermission | null>(null);
  readonly canEdit = computed(() =>
    ["owner", "admin", "edit"].includes(this.permission() ?? ""),
  );
  readonly titleDraft = signal("");
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly saveState = signal("Saved");
  readonly draggingNoteId = signal<string | null>(null);
  readonly liveStatus = this.boardLive.status;
  readonly title = computed(() =>
    this.isSample
      ? "Getting started"
      : (this.board()?.title ?? "Loading board…"),
  );
  private stopLive: (() => void) | null = null;
  private hasLocalEdit = false;
  private refreshPending = false;
  private dragStart:
    | { noteId: string; clientX: number; clientY: number; x: number; y: number }
    | undefined;

  ngOnInit(): void {
    if (this.isSample) {
      this.isLoading.set(false);
      return;
    }
    this.loadBoard(true);
  }

  ngOnDestroy(): void {
    this.stopLive?.();
  }

  loadBoard(connectLive = false): void {
    if (this.hasLocalEdit || this.isSaving()) {
      this.refreshPending = true;
      return;
    }
    this.boardService.get(this.boardId).subscribe({
      next: ({ board, permission }) => {
        this.board.set(board);
        this.permission.set(permission ?? null);
        this.titleDraft.set(board.title);
        this.isLoading.set(false);
        this.errorMessage.set(null);
        if (connectLive && !this.stopLive) {
          this.stopLive = this.boardLive.connect(
            this.boardId,
            () => this.loadBoard(),
            () => {
              this.errorMessage.set(
                "An admin removed your access to this board.",
              );
              this.stopLive?.();
              void this.router.navigate(["/boards"]);
            },
          );
        }
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        if (error.status === 404) {
          void this.router.navigate(["/boards"]);
          return;
        }
        this.errorMessage.set(
          this.describeError(error, "Could not load this board."),
        );
      },
    });
  }

  beginLocalEdit(): void {
    if (this.canEdit()) {
      this.hasLocalEdit = true;
    }
  }

  saveTitle(): void {
    if (!this.canEdit()) return;
    const board = this.board();
    const title = this.titleDraft().trim();
    this.hasLocalEdit = false;
    if (!board || !title) {
      this.titleDraft.set(board?.title ?? "");
      this.finishPendingRefresh();
      return;
    }
    if (title === board.title) {
      this.finishPendingRefresh();
      return;
    }
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.boardService.updateTitle(this.boardId, title).subscribe({
      next: ({ board: updatedBoard }) => {
        this.board.set(updatedBoard);
        this.titleDraft.set(updatedBoard.title);
        this.saveState.set("Saved");
        this.isSaving.set(false);
        this.finishPendingRefresh();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.saveState.set("Not saved");
        this.errorMessage.set(
          this.describeError(error, "Could not rename this board."),
        );
        this.finishPendingRefresh();
      },
    });
  }

  saveTitleOnEnter(event: Event): void {
    event.preventDefault();
    this.saveTitle();
    (event.currentTarget as HTMLInputElement).blur();
  }

  addNote(): void {
    if (!this.canEdit()) return;
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.boardService.addNote(this.boardId).subscribe({
      next: ({ board }) => {
        this.board.set(board);
        this.isSaving.set(false);
        this.saveState.set("Saved");
        this.finishPendingRefresh();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.saveState.set("Not saved");
        this.errorMessage.set(
          this.describeError(error, "Could not add a note."),
        );
        this.finishPendingRefresh();
      },
    });
  }

  changeNoteText(noteId: string, text: string): void {
    const board = this.board();
    if (!board || !this.canEdit()) return;
    this.board.set({
      ...board,
      elements: board.elements.map((note) =>
        note.id === noteId ? { ...note, text } : note,
      ),
    });
  }

  saveNoteText(noteId: string): void {
    const note = this.board()?.elements.find((entry) => entry.id === noteId);
    if (!note || !this.canEdit()) return;
    this.hasLocalEdit = false;
    this.saveNote(noteId, { text: note.text });
  }

  removeNote(note: BoardNote): void {
    if (!this.canEdit() || !window.confirm("Delete this note?")) return;
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.boardService.removeNote(this.boardId, note.id).subscribe({
      next: ({ board }) => {
        this.board.set(board);
        this.isSaving.set(false);
        this.saveState.set("Saved");
        this.finishPendingRefresh();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.saveState.set("Not saved");
        this.errorMessage.set(
          this.describeError(error, "Could not delete the note."),
        );
        this.finishPendingRefresh();
      },
    });
  }

  startNoteDrag(note: BoardNote, event: PointerEvent): void {
    if (!this.canEdit()) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragStart = {
      noteId: note.id,
      clientX: event.clientX,
      clientY: event.clientY,
      x: note.x,
      y: note.y,
    };
    this.draggingNoteId.set(note.id);
    this.beginLocalEdit();
  }

  moveNote(event: PointerEvent): void {
    if (!this.dragStart || !this.canvas) return;
    const bounds = this.canvas.nativeElement.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        85,
        this.dragStart.x +
          ((event.clientX - this.dragStart.clientX) / bounds.width) * 100,
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        85,
        this.dragStart.y +
          ((event.clientY - this.dragStart.clientY) / bounds.height) * 100,
      ),
    );
    const board = this.board();
    if (!board) return;
    const noteId = this.dragStart.noteId;
    this.board.set({
      ...board,
      elements: board.elements.map((note) =>
        note.id === noteId ? { ...note, x, y } : note,
      ),
    });
  }

  finishNoteDrag(): void {
    const drag = this.dragStart;
    this.dragStart = undefined;
    this.draggingNoteId.set(null);
    if (!drag) return;
    const note = this.board()?.elements.find(
      (entry) => entry.id === drag.noteId,
    );
    this.hasLocalEdit = false;
    if (note) {
      this.saveNote(note.id, { x: note.x, y: note.y });
    } else {
      this.finishPendingRefresh();
    }
  }

  private saveNote(
    noteId: string,
    changes: Partial<Pick<BoardNote, "text" | "x" | "y" | "color">>,
  ): void {
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.boardService.updateNote(this.boardId, noteId, changes).subscribe({
      next: ({ board }) => {
        this.board.set(board);
        this.isSaving.set(false);
        this.saveState.set("Saved");
        this.finishPendingRefresh();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.saveState.set("Not saved");
        this.errorMessage.set(
          this.describeError(error, "Could not save your changes."),
        );
        this.finishPendingRefresh();
      },
    });
  }

  private finishPendingRefresh(): void {
    if (!this.refreshPending) return;
    this.refreshPending = false;
    this.loadBoard();
  }

  private describeError(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return "Cannot reach StoreIt. Check that the backend is running.";
    }
    return error.error?.error ?? fallback;
  }
}
