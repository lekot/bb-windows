import { expect, it } from "vitest";
import { captureScript } from "./capture.js";
it.each([-1, 16, 0.5, NaN])("rejects invalid monitor %s before shell execution", (monitor) => {
  expect(() => captureScript(monitor)).toThrow();
});
it("bounds captures and disposes native resources", () => {
  const script = captureScript(0);
  expect(script).toContain("$index = 0");
  expect(script).toContain("OpenInputDesktop");
  expect(script).toContain("40000000");
  expect(script).toContain("$bitmap.Dispose()");
});
