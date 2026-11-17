// Copyright Epic Games, Inc. All Rights Reserved.

import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Boards } from "./boards";

describe("Boards", () => {
  let service: Boards;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(Boards);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("loads only boards available to the signed-in user", () => {
    service.list().subscribe(({ boards }) => {
      expect(boards).toEqual([
        {
          id: "board-id",
          title: "Planning",
          ownerId: "owner-id",
          updatedAt: "2026-01-01T00:00:00.000Z",
          permission: "view",
        },
      ]);
    });

    httpMock.expectOne("/api/pinit/boards").flush({
      boards: [
        {
          id: "board-id",
          title: "Planning",
          ownerId: "owner-id",
          updatedAt: "2026-01-01T00:00:00.000Z",
          permission: "view",
        },
      ],
    });
  });

  it("creates a board through StoreIt", () => {
    service.create("Workshop").subscribe(({ board }) => {
      expect(board.title).toBe("Workshop");
    });

    const request = httpMock.expectOne({
      method: "POST",
      url: "/api/pinit/boards",
    });
    expect(request.request.body).toEqual({ title: "Workshop" });
    request.flush({
      board: {
        id: "board-id",
        title: "Workshop",
        ownerId: "owner-id",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        elements: [],
        grants: {},
      },
    });
  });

  it("saves admin-controlled demo board access", () => {
    service.setDemoAccess("board-id", "demo-user-id", "edit").subscribe();

    const request = httpMock.expectOne({
      method: "PUT",
      url: "/api/pinit/admin/boards/board-id/access/demo-user-id",
    });
    expect(request.request.body).toEqual({ permission: "edit" });
    request.flush({
      board: {
        id: "board-id",
        title: "Planning",
        ownerId: "owner-id",
        updatedAt: "2026-01-01T00:00:00.000Z",
        grants: { "demo-user-id": "edit" },
      },
    });
  });
});
