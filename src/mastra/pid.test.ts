import { describe, expect, it } from "vitest";
import { pidOf } from "./pid";

describe("pidOf", () => {
  it("is stable for the same uid and secret", () => {
    expect(pidOf("ana", "s3cret")).toBe(pidOf("ana", "s3cret"));
  });

  it("differs across uids", () => {
    expect(pidOf("ana", "s3cret")).not.toBe(pidOf("bob", "s3cret"));
  });

  it("differs across secrets", () => {
    expect(pidOf("ana", "s3cret")).not.toBe(pidOf("ana", "other-secret"));
  });

  it("is 12 lowercase hex chars", () => {
    expect(pidOf("ana", "s3cret")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("never contains the uid", () => {
    expect(pidOf("secretname", "s3cret")).not.toContain("secretname");
  });
});
