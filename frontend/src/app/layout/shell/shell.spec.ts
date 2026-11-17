// Copyright Epic Games, Inc. All Rights Reserved.

import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./shell";

describe("Shell", () => {
  let fixture: ComponentFixture<Shell>;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    fixture = TestBed.createComponent(Shell);
    httpTestingController = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it("loads other configured services and hides PinIt from its own menu", () => {
    const switcher = fixture.nativeElement.querySelector(
      'button[aria-label="PinIt, switch service"]',
    ) as HTMLButtonElement;
    switcher.click();
    fixture.detectChanges();

    const request = httpTestingController.expectOne("/api/services");
    request.flush({
      services: [
        {
          id: "pinit",
          name: "PinIt",
          url: "https://pinit.example.com/",
          logoUrl: "https://pinit.example.com/PinIt_32.png",
        },
        {
          id: "clockit",
          name: "ClockIt",
          url: "https://clockit.example.com/",
          logoUrl: "https://clockit.example.com/ClockItLogo_32x32.png",
        },
      ],
    });
    fixture.detectChanges();

    const serviceNames = Array.from(
      fixture.nativeElement.querySelectorAll(".service-menu-item"),
      (item: Element) => item.textContent?.trim(),
    );
    expect(serviceNames).toEqual(["ClockIt"]);
  });

  it("shows account actions in the user menu", () => {
    const accountButton = fixture.nativeElement.querySelector(
      ".account-menu-trigger",
    ) as HTMLButtonElement;
    accountButton.click();
    fixture.detectChanges();

    const accountMenu = fixture.nativeElement.querySelector(
      ".account-menu-panel",
    ) as HTMLElement;
    expect(accountMenu.textContent).toContain("My account");
    expect(accountMenu.textContent).toContain("Appearance");
    expect(accountMenu.textContent).toContain("Log out");
  });
});
