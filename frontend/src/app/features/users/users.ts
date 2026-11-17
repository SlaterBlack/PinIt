// Copyright Epic Games, Inc. All Rights Reserved.

import { HttpErrorResponse } from "@angular/common/http";
import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Auth } from "../../core/services/auth";
import type { ManagedUser } from "../../core/services/user";
import { User as UserService } from "../../core/services/user";
import type { UserRole } from "../../core/models/user.model";
import type { BoardSummary } from "../../core/models/board.model";

const MIN_PASSWORD_LENGTH = 8;

@Component({
  selector: "app-users",
  imports: [FormsModule],
  templateUrl: "./users.html",
  styleUrl: "./users.scss",
})
export class Users implements OnInit {
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);

  readonly users = signal<ManagedUser[]>([]);
  readonly demoUsers = computed(() =>
    this.users().filter((user) => user.role === "demo"),
  );
  readonly boards = signal<BoardSummary[]>([]);
  readonly boardsLoading = signal(true);
  readonly boardsError = signal<string | null>(null);
  readonly selectedDemoUserId = signal("");
  readonly savingAccessBoardId = signal<string | null>(null);
  readonly accessError = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly listError = signal<string | null>(null);
  readonly newName = signal("");
  readonly newEmail = signal("");
  readonly newPassword = signal("");
  readonly newRole = signal<UserRole>("user");
  readonly createError = signal<string | null>(null);
  readonly isCreating = signal(false);
  readonly editingUserId = signal<string | null>(null);
  readonly editingRole = signal<UserRole>("user");
  readonly editingPassword = signal("");
  readonly rowError = signal<{ id: string; message: string } | null>(null);
  readonly busyUserId = signal<string | null>(null);
  readonly currentUserId = this.auth.currentUser()?.id ?? null;

  ngOnInit(): void {
    this.loadUsers();
    this.loadBoards();
  }

  loadUsers(): void {
    this.isLoading.set(true);
    this.listError.set(null);
    this.userService.list().subscribe({
      next: ({ users }) => {
        this.users.set(users);
        this.ensureSelectedDemoUser();
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.listError.set(
          this.describeError(
            error,
            "Could not load users. Try refreshing the page.",
          ),
        );
        this.isLoading.set(false);
      },
    });
  }

  loadBoards(): void {
    this.boardsLoading.set(true);
    this.boardsError.set(null);
    this.userService.listBoardsForAdmin().subscribe({
      next: ({ boards }) => {
        this.boards.set(boards);
        this.boardsLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.boardsError.set(
          this.describeError(error, "Could not load PinIt board permissions."),
        );
        this.boardsLoading.set(false);
      },
    });
  }

  setDemoBoardAccess(board: BoardSummary, value: string): void {
    const userId = this.selectedDemoUserId();
    if (!userId || !this.demoUsers().some((user) => user.id === userId)) {
      this.accessError.set("Choose a demo user first.");
      return;
    }
    if (value !== "" && value !== "view" && value !== "edit") {
      this.accessError.set("Choose a valid board access level.");
      return;
    }
    this.savingAccessBoardId.set(board.id);
    this.accessError.set(null);
    this.userService
      .setDemoBoardAccess(board.id, userId, value === "" ? null : value)
      .subscribe({
        next: ({ board: updatedBoard }) => {
          this.boards.update((boards) =>
            boards.map((entry) =>
              entry.id === updatedBoard.id ? updatedBoard : entry,
            ),
          );
          this.savingAccessBoardId.set(null);
        },
        error: (error: HttpErrorResponse) => {
          this.savingAccessBoardId.set(null);
          this.accessError.set(
            this.describeError(error, "Could not update board access."),
          );
        },
      });
  }

  createUser(): void {
    const name = this.newName().trim();
    const email = this.newEmail().trim();
    const password = this.newPassword();
    if (!name || !email || !password) {
      this.createError.set("Name, email and password are required.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      this.createError.set(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    this.isCreating.set(true);
    this.createError.set(null);
    this.userService
      .create({ name, email, password, role: this.newRole() })
      .subscribe({
        next: ({ user }) => {
          this.users.update((users) =>
            [...users, user].sort((a, b) => a.name.localeCompare(b.name)),
          );
          this.ensureSelectedDemoUser();
          this.newName.set("");
          this.newEmail.set("");
          this.newPassword.set("");
          this.newRole.set("user");
          this.isCreating.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.isCreating.set(false);
          this.createError.set(
            this.describeError(error, "Could not create the user."),
          );
        },
      });
  }

  startEditing(user: ManagedUser): void {
    this.editingUserId.set(user.id);
    this.editingRole.set(user.role);
    this.editingPassword.set("");
    this.rowError.set(null);
  }

  cancelEditing(): void {
    this.editingUserId.set(null);
    this.editingPassword.set("");
    this.rowError.set(null);
  }

  saveEditing(user: ManagedUser): void {
    const role = this.editingRole();
    const password = this.editingPassword();
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      this.rowError.set({
        id: user.id,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }

    const changes: { role?: UserRole; password?: string } = {};
    if (role !== user.role) changes.role = role;
    if (password) changes.password = password;
    if (Object.keys(changes).length === 0) {
      this.cancelEditing();
      return;
    }

    this.busyUserId.set(user.id);
    this.rowError.set(null);
    this.userService.update(user.id, changes).subscribe({
      next: ({ user: updatedUser }) => {
        this.users.update((users) =>
          users.map((entry) =>
            entry.id === updatedUser.id ? updatedUser : entry,
          ),
        );
        this.ensureSelectedDemoUser();
        this.busyUserId.set(null);
        this.cancelEditing();
      },
      error: (error: HttpErrorResponse) => {
        this.busyUserId.set(null);
        this.rowError.set({
          id: user.id,
          message: this.describeError(error, "Could not update the user."),
        });
      },
    });
  }

  deleteUser(user: ManagedUser): void {
    if (!window.confirm(`Delete ${user.name}? This cannot be undone.`)) {
      return;
    }

    this.busyUserId.set(user.id);
    this.rowError.set(null);
    this.userService.remove(user.id).subscribe({
      next: () => {
        this.users.update((users) =>
          users.filter((entry) => entry.id !== user.id),
        );
        this.ensureSelectedDemoUser();
        this.busyUserId.set(null);
      },
      error: (error: HttpErrorResponse) => {
        this.busyUserId.set(null);
        this.rowError.set({
          id: user.id,
          message: this.describeError(error, "Could not delete the user."),
        });
      },
    });
  }

  private describeError(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return "Cannot reach the server. Check that the backend is running.";
    }
    return error.error?.error ?? fallback;
  }

  private ensureSelectedDemoUser(): void {
    if (
      !this.demoUsers().some((user) => user.id === this.selectedDemoUserId())
    ) {
      this.selectedDemoUserId.set(this.demoUsers()[0]?.id ?? "");
    }
  }
}
