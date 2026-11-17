// Copyright Epic Games, Inc. All Rights Reserved.

import { Component, inject } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";

@Component({
  selector: "app-board-page",
  imports: [RouterLink],
  templateUrl: "./board-page.html",
  styleUrl: "./board-page.scss",
})
export class BoardPage {
  private readonly route = inject(ActivatedRoute);
  readonly isSample = this.route.snapshot.paramMap.get("boardId") === "sample";
  readonly title = this.isSample ? "Getting started" : "Untitled board";
}
