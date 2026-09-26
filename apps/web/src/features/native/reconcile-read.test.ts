import { expect, it, vi } from "vitest"
import { assertFreshSnapshot, reconcileRead } from "./reconcile-read"

it("rejects an old snapshot even when it matches the activity head captured before explicit selection", () => {
  expect(() => assertFreshSnapshot({ currentRevisionId: "old", headVersion: 2 }, "old", { headVersion: 3 })).toThrow(/catching up/)
  expect(() => assertFreshSnapshot({ currentRevisionId: "old", headVersion: 3 }, "new", { headVersion: 3 })).toThrow(/catching up/)
  expect(() => assertFreshSnapshot({ currentRevisionId: "new", headVersion: 4 }, "new", { headVersion: 3 })).not.toThrow()
})

it("recovers an exhausted HTTP read without a command and bounds repeated failure", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("five HTTP attempts exhausted")).mockResolvedValue("new head")
  await expect(reconcileRead(read, new AbortController().signal, 3, 1)).resolves.toBe("new head")
  expect(read).toHaveBeenCalledTimes(2)
  const failed = vi.fn().mockRejectedValue(new Error("offline"))
  await expect(reconcileRead(failed, new AbortController().signal, 3, 1)).rejects.toThrow("offline")
  expect(failed).toHaveBeenCalledTimes(3)
})

it("cancels backoff and rejects late responses when the room is left", async () => {
  const controller = new AbortController()
  const read = vi.fn().mockImplementation(() => { controller.abort(); return Promise.resolve("old room") })
  await expect(reconcileRead(read, controller.signal, 3, 1)).rejects.toBeDefined()
  expect(read).toHaveBeenCalledTimes(1)
  const waiting = new AbortController(), failure = vi.fn().mockRejectedValue(new Error("offline"))
  const promise = reconcileRead(failure, waiting.signal, 3, 1000)
  const rejected = expect(promise).rejects.toBeDefined()
  await Promise.resolve(); waiting.abort(); await rejected
  expect(failure).toHaveBeenCalledTimes(1)
})
