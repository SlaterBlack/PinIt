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

  it("creates a board element through StoreIt", () => {
    service
      .addElement("board-id", {
        type: "text",
        x: 25,
        y: 30,
        text: "Agenda",
        color: "cream",
        width: 16,
      })
      .subscribe(({ element }) => {
        expect(element.type).toBe("text");
        expect(element.x).toBe(25);
      });

    const request = httpMock.expectOne({
      method: "POST",
      url: "/api/pinit/boards/board-id/elements",
    });
    expect(request.request.body).toEqual({
      type: "text",
      x: 25,
      y: 30,
      text: "Agenda",
      color: "cream",
      width: 16,
    });
    request.flush({
      board: {
        id: "board-id",
        title: "Planning",
        ownerId: "owner-id",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        elements: [
          {
            id: "element-id",
            type: "text",
            x: 25,
            y: 30,
            text: "Agenda",
            color: "cream",
            width: 16,
          },
        ],
        grants: {},
      },
      element: {
        id: "element-id",
        type: "text",
        x: 25,
        y: 30,
        text: "Agenda",
        color: "cream",
        width: 16,
      },
    });
  });

  it("replaces board elements against the expected board version", () => {
    service
      .replaceElements("board-id", [], "2026-01-01T00:00:00.000Z")
      .subscribe();

    const request = httpMock.expectOne({
      method: "PUT",
      url: "/api/pinit/boards/board-id/elements",
    });
    expect(request.request.body).toEqual({
      elements: [],
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    request.flush({ board: { id: "board-id", elements: [] } });
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
