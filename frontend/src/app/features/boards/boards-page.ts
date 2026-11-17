// Copyright Epic Games, Inc. All Rights Reserved.

import { HttpErrorResponse } from "@angular/common/http";
import { Component, HostListener, OnInit, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { forkJoin } from "rxjs";
import { BoardGrant, BoardSummary } from "../../core/models/board.model";
import { Auth } from "../../core/services/auth";
import { Boards } from "../../core/services/boards";
import type { ManagedUser } from "../../core/services/user";
import { User as UserService } from "../../core/services/user";

@Component({
  selector: "app-boards-page",
  imports: [FormsModule, RouterLink],
  templateUrl: "./boards-page.html",
  styleUrl: "./boards-page.scss",
})
export class BoardsPage implements OnInit {
  private readonly boardService = inject(Boards);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  readonly auth = inject(Auth);
  readonly boards = signal<BoardSummary[]>([]);
  readonly isLoading = signal(true);
  readonly isCreating = signal(false);
  readonly newTitle = signal("");
  readonly listError = signal<string | null>(null);
  readonly createError = signal<string | null>(null);
  readonly openBoardActionsId = signal<string | null>(null);
  readonly renamingBoard = signal<BoardSummary | null>(null);
  readonly renameTitle = signal("");
  readonly renameError = signal<string | null>(null);
  readonly isRenaming = signal(false);
  readonly accessBoard = signal<BoardSummary | null>(null);
  readonly demoUsers = signal<ManagedUser[]>([]);
  readonly demoGrants = signal<Record<string, BoardGrant>>({});
  readonly accessLoading = signal(false);
  readonly accessError = signal<string | null>(null);
  readonly savingAccessUserId = signal<string | null>(null);

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

  toggleBoardActions(boardId: string): void {
    this.openBoardActionsId.update((openId) =>
      openId === boardId ? null : boardId,
    );
  }

  openRenameDialog(board: BoardSummary): void {
    this.openBoardActionsId.set(null);
    if (board.permission === "view") return;
    this.renamingBoard.set(board);
    this.renameTitle.set(board.title);
    this.renameError.set(null);
  }

  closeRenameDialog(): void {
    if (this.isRenaming()) return;
    this.renamingBoard.set(null);
    this.renameError.set(null);
  }

  renameBoard(): void {
    const board = this.renamingBoard();
    const title = this.renameTitle().trim();
    if (!board || this.isRenaming()) return;
    if (!title) {
      this.renameError.set("Enter a name for your board.");
      return;
    }
    if (title === board.title) {
      this.closeRenameDialog();
      return;
    }
    this.isRenaming.set(true);
    this.renameError.set(null);
    this.boardService.updateTitle(board.id, title, board.title).subscribe({
      next: ({ board: updatedBoard }) => {
        this.boards.update((boards) =>
          boards.map((entry) =>
            entry.id === board.id
              ? {
                  ...entry,
                  title: updatedBoard.title,
                  updatedAt: updatedBoard.updatedAt,
                }
              : entry,
          ),
        );
        this.isRenaming.set(false);
        this.renamingBoard.set(null);
      },
      error: (error: HttpErrorResponse) => {
        this.isRenaming.set(false);
        this.renameError.set(
          this.describeError(error, "Could not rename the board."),
        );
        if (error.status === 409) this.loadBoards();
      },
    });
  }

  openAccessDialog(board: BoardSummary): void {
    this.openBoardActionsId.set(null);
    if (board.permission !== "admin") return;
    this.accessBoard.set(board);
    this.demoUsers.set([]);
    this.demoGrants.set({});
    this.accessLoading.set(true);
    this.accessError.set(null);
    forkJoin({
      users: this.userService.list(),
      boards: this.boardService.adminList(),
    }).subscribe({
      next: ({ users, boards }) => {
        const accessBoard = boards.boards.find(
          (entry) => entry.id === board.id,
        );
        if (!accessBoard) {
          this.accessError.set("Could not find this board's access settings.");
        } else {
          this.demoUsers.set(
            users.users.filter((user) => user.role === "demo"),
          );
          this.demoGrants.set(accessBoard.grants ?? {});
        }
        this.accessLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.accessLoading.set(false);
        this.accessError.set(
          this.describeError(error, "Could not load board access."),
        );
      },
    });
  }

  closeAccessDialog(): void {
    if (this.savingAccessUserId()) return;
    this.accessBoard.set(null);
    this.accessError.set(null);
  }

  setDemoAccess(userId: string, value: string): void {
    const board = this.accessBoard();
    if (!board || this.savingAccessUserId()) return;
    if (value !== "" && value !== "view" && value !== "edit") {
      this.accessError.set("Choose a valid board access level.");
      return;
    }
    this.savingAccessUserId.set(userId);
    this.accessError.set(null);
    this.userService
      .setDemoBoardAccess(board.id, userId, value === "" ? null : value)
      .subscribe({
        next: ({ board: updatedBoard }) => {
          this.demoGrants.set(updatedBoard.grants ?? {});
          this.savingAccessUserId.set(null);
        },
        error: (error: HttpErrorResponse) => {
          this.savingAccessUserId.set(null);
          this.accessError.set(
            this.describeError(error, "Could not update board access."),
          );
        },
      });
  }

  deleteBoard(board: BoardSummary): void {
    this.openBoardActionsId.set(null);
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

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".board-card-actions")) {
      this.openBoardActionsId.set(null);
    }
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.openBoardActionsId.set(null);
    this.closeRenameDialog();
    this.closeAccessDialog();
  }

  private describeError(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return "Cannot reach StoreIt. Check that the backend is running.";
    }
    return error.error?.error ?? fallback;
  }
}
