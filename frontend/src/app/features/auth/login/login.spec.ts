// Copyright Epic Games, Inc. All Rights Reserved.

import { describe, expect, it } from "vitest";
import { getSafeReturnUrl } from "./login";

describe("getSafeReturnUrl", () => {
  it("preserves an internal return path", () => {
    expect(getSafeReturnUrl("/boards/sample?view=grid")).toBe(
      "/boards/sample?view=grid",
    );
  });

  it.each(["https://example.com", "//example.com", "/\\example.com", null])(
    "falls back for an unsafe return path: %s",
    (returnUrl) => {
      expect(getSafeReturnUrl(returnUrl)).toBe("/boards");
    },
  );
});
