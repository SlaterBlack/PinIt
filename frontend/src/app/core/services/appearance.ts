// Copyright Epic Games, Inc. All Rights Reserved.

import { effect, inject, Injectable, signal, untracked } from "@angular/core";
import { Auth } from "./auth";
import { UserTheme } from "../models/user.model";

const THEME_STORAGE_KEY = "pinit_theme";
const DEFAULT_THEME: UserTheme = "default";
const THEMES: readonly UserTheme[] = ["default", "retro"];

function isTheme(value: unknown): value is UserTheme {
  return value === "default" || value === "retro";
}

function readTheme(): UserTheme {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === null) {
    return DEFAULT_THEME;
  }
  if (isTheme(storedTheme)) {
    return storedTheme;
  }

  console.error("Stored PinIt theme is unsupported; resetting to Default.");
  localStorage.removeItem(THEME_STORAGE_KEY);
  return DEFAULT_THEME;
}

@Injectable({ providedIn: "root" })
export class Appearance {
  private readonly auth = inject(Auth);
  private queuedTheme: UserTheme | null = null;
  readonly themeOptions = THEMES;
  readonly theme = signal<UserTheme>(readTheme());
  readonly isSavingTheme = signal(false);
  readonly themeSyncError = signal<string | null>(null);

  constructor() {
    const accountTheme = this.auth.accountTheme();
    this.applyTheme(accountTheme ?? this.theme());

    effect(() => {
      if (!this.auth.accountThemeLoaded()) {
        return;
      }

      const currentAccountTheme = this.auth.accountTheme();
      if (currentAccountTheme && isTheme(currentAccountTheme)) {
        this.applyAccountTheme(currentAccountTheme);
      } else if (currentAccountTheme === null) {
        untracked(() => this.persistTheme(this.theme()));
      }
    });
  }

  setTheme(value: UserTheme): void {
    if (!isTheme(value)) {
      throw new Error("Theme must be one of the available options.");
    }

    localStorage.setItem(THEME_STORAGE_KEY, value);
    this.theme.set(value);
    this.applyTheme(value);
    this.themeSyncError.set(null);
    this.persistTheme(value);
  }

  toggleTheme(): void {
    this.setTheme(this.theme() === "retro" ? "default" : "retro");
  }

  private persistTheme(theme: UserTheme): void {
    if (this.auth.getToken()) {
      this.queuedTheme = theme;
      if (!this.isSavingTheme()) {
        this.saveQueuedTheme();
      }
    }
  }

  private applyAccountTheme(theme: UserTheme): void {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    this.theme.set(theme);
    this.applyTheme(theme);
  }

  private applyTheme(theme: UserTheme): void {
    document.documentElement.dataset["theme"] = theme;
  }

  private saveQueuedTheme(): void {
    const theme = this.queuedTheme;
    if (!theme) {
      this.isSavingTheme.set(false);
      return;
    }

    this.queuedTheme = null;
    this.isSavingTheme.set(true);
    this.auth.updateProfile({ theme }).subscribe({
      next: () => {
        if (this.queuedTheme) {
          this.saveQueuedTheme();
        } else {
          this.isSavingTheme.set(false);
        }
      },
      error: (error: unknown) => {
        console.error("Could not save the PinIt theme to the account.", error);
        if (this.queuedTheme) {
          this.saveQueuedTheme();
        } else {
          this.isSavingTheme.set(false);
          this.themeSyncError.set(
            "Could not save this theme to your account. It is still applied on this device.",
          );
        }
      },
    });
  }
}
