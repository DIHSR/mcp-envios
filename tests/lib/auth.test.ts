import { describe, expect, it } from "vitest";

import { isAuthorized } from "../../src/lib/auth.js";

describe("isAuthorized", () => {
  it("aceita somente o Bearer token exato", () => {
    expect(isAuthorized("Bearer token-super-seguro", "token-super-seguro")).toBe(true);
    expect(isAuthorized("Bearer token-incorreto", "token-super-seguro")).toBe(false);
    expect(isAuthorized("Basic token-super-seguro", "token-super-seguro")).toBe(false);
    expect(isAuthorized(undefined, "token-super-seguro")).toBe(false);
  });
});
