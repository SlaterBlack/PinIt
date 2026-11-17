// Copyright Epic Games, Inc. All Rights Reserved.

import { Component, inject } from "@angular/core";
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";
import { Appearance } from "../../core/services/appearance";
import { Auth } from "../../core/services/auth";

@Component({
  selector: "app-shell",
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: "./shell.html",
  styleUrl: "./shell.scss",
})
export class Shell {
  readonly auth = inject(Auth);
  readonly appearance = inject(Appearance);
  private readonly router = inject(Router);

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl("/login");
  }
}
