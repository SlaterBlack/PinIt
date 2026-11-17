// Copyright Epic Games, Inc. All Rights Reserved.

import { Routes } from "@angular/router";
import { authGuard } from "./core/guards/auth.guard";
import { adminGuard } from "./core/guards/admin.guard";
import { Login } from "./features/auth/login/login";
import { BoardPage } from "./features/board/board-page";
import { BoardsPage } from "./features/boards/boards-page";
import { Users } from "./features/users/users";
import { Profile } from "./features/profile/profile";
import { Shell } from "./layout/shell/shell";

export const routes: Routes = [
  { path: "login", component: Login },
  {
    path: "",
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: "", pathMatch: "full", redirectTo: "boards" },
      { path: "boards", component: BoardsPage },
      { path: "boards/:boardId", component: BoardPage },
      { path: "profile", component: Profile },
      { path: "users", canActivate: [adminGuard], component: Users },
      { path: "**", redirectTo: "boards" },
    ],
  },
  { path: "**", redirectTo: "" },
];
