// Copyright Epic Games, Inc. All Rights Reserved.

import { HttpErrorResponse } from "@angular/common/http";
import { Component, OnInit, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { BoardSummary } from "../../core/models/board.model";
import { Auth } from "../../core/services/auth";
import { Boards } from "../../core/services/boards";

@Component({
  selector: "app-boards-page",
  imports: [FormsModule, RouterLink],
  templateUrl: "./boards-page.html",
  styleUrl: "./boards-page.scss",
})
export class BoardsPage implements OnInit {
  private readonly boardService = inject(Boards);
  private readonly router = inject(Router);
  readonly auth = inject(Auth);
  readonly boards = signal<BoardSummary[]>([]);
  readonly isLoading = signal(true);
  readonly isCreating = signal(false);
  readonly newTitle = signal("");
  readonly listError = signal<string | null>(null);
  readonly createError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadBoards();
  }

  loadBoards(): void {
    this.isLoading.set(true);
    this.listError.set(null);
    this.boardService.list().subscribe({
      next: ({ boards }) => {
        this.boards.set(boards);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.listError.set(
          this.describeError(error, "Could not load your boards."),
        );
        this.isLoading.set(false);
      },
    });
  }

  createBoard(): void {
    const title = this.newTitle().trim();
    if (!title) {
      this.createError.set("Enter a name for your board.");
      return;
    }

    this.isCreating.set(true);
    this.createError.set(null);
    this.boardService.create(title).subscribe({
      next: ({ board }) => {
        this.isCreating.set(false);
        void this.router.navigate(["/boards", board.id]);
      },
      error: (error: HttpErrorResponse) => {
        this.isCreating.set(false);
        this.createError.set(
          this.describeError(error, "Could not create the board."),
        );
      },
    });
  }

  deleteBoard(board: BoardSummary): void {
    if (!window.confirm(`Delete "${board.title}"? This cannot be undone.`)) {
      return;
    }
    this.boardService.remove(board.id).subscribe({
      next: () =>
        this.boards.update((boards) =>
          boards.filter((entry) => entry.id !== board.id),
        ),
      error: (error: HttpErrorResponse) =>
        this.listError.set(
          this.describeError(error, "Could not delete the board."),
        ),
    });
  }

  private describeError(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return "Cannot reach StoreIt. Check that the backend is running.";
    }
    return error.error?.error ?? fallback;
  }
}
