import { describe, expect, it } from "vitest";
import { byteRange } from "@pocket/core";

describe("private source seeking", () => {
  it("supports initial, open-ended and suffix ranges", () => {
    expect(byteRange(undefined, 100)).toBeNull();
    expect(byteRange("bytes=0-10", 100)).toEqual({ start: 0, end: 10 });
    expect(byteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
  });
  it.each(["bytes=100-", "bytes=30-20", "bytes=-0", "bytes=-", "bytes=1-2,4-5", "items=0-1"])("rejects invalid range %s", (range) => {
    expect(byteRange(range, 100)).toBe("invalid");
  });
});
