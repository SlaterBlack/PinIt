// Copyright Epic Games, Inc. All Rights Reserved.

import { Component, EventEmitter, inject, Output, signal } from "@angular/core";
import { UserTheme } from "../../../core/models/user.model";
import { Appearance } from "../../../core/services/appearance";

@Component({
  selector: "app-appearance-dialog",
  templateUrl: "./appearance-dialog.html",
  styleUrl: "./appearance-dialog.scss",
})
export class AppearanceDialog {
  @Output() readonly close = new EventEmitter<void>();

  readonly appearance = inject(Appearance);
  readonly isThemeMenuOpen = signal(false);

  get selectedThemeName(): string {
    return this.appearance.theme() === "retro" ? "Retro" : "Default";
  }

  toggleThemeMenu(): void {
    this.isThemeMenuOpen.update((open) => !open);
  }

  selectTheme(value: UserTheme): void {
    this.appearance.setTheme(value);
    this.isThemeMenuOpen.set(false);
  }
}
