import { describe, expect, it } from "vitest";
import { buildTimelineErrorDisplay } from "../src/error-display.js";
import type { EventProjectionErrorMessage } from "../src/event-projection-types.js";
import { friendlyProviderError } from "../src/friendly-provider-error.js";

function providerError(message: string, detail: string | null): EventProjectionErrorMessage {
  return {
    kind: "error",
    id: "thr:error:1",
    threadId: "thr",
    sourceEvent: { seq: 1, part: 0 },
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    createdAt: 1,
    scope: { kind: "thread" },
    rawType: "provider/error",
    systemErrorCode: null,
    message,
    detail,
    providerErrorInfo: { category: "unknown", providerCode: null, httpStatusCode: null },
  } as unknown as EventProjectionErrorMessage;
}

describe("friendlyProviderError", () => {
  it("shows the reset time for a weekly limit", () => {
    const friendly = friendlyProviderError(
      "Internal error: You've hit your weekly limit - resets Nov 12 at 9pm (Europe/London). errorName provider.unknown",
    );
    expect(friendly?.title).toBe("Usage limit reached");
    expect(friendly?.detail).toContain("weekly limit");
    expect(friendly?.detail).toContain("resets Nov 12 at 9pm (Europe/London)");
  });

  it("explains an image rejection and ignores the raw json", () => {
    const friendly = friendlyProviderError(
      'HTTP 400 Bad Request: {"error":{"message":"Image inputs are not supported for this model","type":"invalid_request_error"}}',
    );
    expect(friendly?.title).toBe("This model can't read images");
    expect(friendly?.detail).not.toContain("{");
  });

  it("extracts the message from other json error bodies", () => {
    const friendly = friendlyProviderError('HTTP 429 {"error":{"message":"slow down please"}}');
    expect(friendly).toEqual({ title: "Provider rejected the request (HTTP 429)", detail: "Slow down please." });
  });

  it("leaves plain messages alone", () => {
    expect(friendlyProviderError("Connection reset by peer")).toBeNull();
  });

  it("drives the timeline display", () => {
    const display = buildTimelineErrorDisplay(providerError("Error", "You've hit your weekly limit, resets Nov 12 at 9pm."));
    expect(display.title).toBe("Usage limit reached");
    expect(display.detail).toContain("Nov 12 at 9pm");
  });
});
