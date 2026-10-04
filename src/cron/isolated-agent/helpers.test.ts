import { describe, expect, it } from "vitest";
import {
  detectCronDenialToken,
  isHeartbeatOnlyResponse,
  pickDeliverablePayloads,
  pickLastDeliverablePayload,
  pickLastNonEmptyTextFromPayloads,
  pickSummaryFromPayloads,
} from "./helpers.js";

describe("pickSummaryFromPayloads", () => {
  it("picks real text over error payload", () => {
    const payloads = [
      { text: "Here is your summary" },
      { text: "Tool error: rate limited", isError: true },
    ];
    expect(pickSummaryFromPayloads(payloads)).toBe("Here is your summary");
  });

  it("falls back to error payload when no real text exists", () => {
    const payloads = [{ text: "Tool error: rate limited", isError: true }];
    expect(pickSummaryFromPayloads(payloads)).toBe("Tool error: rate limited");
  });

  it("returns undefined for empty payloads", () => {
    expect(pickSummaryFromPayloads([])).toBeUndefined();
  });

  it("treats isError: undefined as non-error", () => {
    const payloads = [
      { text: "normal text", isError: undefined },
      { text: "error text", isError: true },
    ];
    expect(pickSummaryFromPayloads(payloads)).toBe("normal text");
  });
});

describe("pickLastNonEmptyTextFromPayloads", () => {
  it("picks real text over error payload", () => {
    const payloads = [{ text: "Real output" }, { text: "Service error", isError: true }];
    expect(pickLastNonEmptyTextFromPayloads(payloads)).toBe("Real output");
  });

  it("falls back to error payload when no real text exists", () => {
    const payloads = [{ text: "Service error", isError: true }];
    expect(pickLastNonEmptyTextFromPayloads(payloads)).toBe("Service error");
  });

  it("returns undefined for empty payloads", () => {
    expect(pickLastNonEmptyTextFromPayloads([])).toBeUndefined();
  });

  it("treats isError: undefined as non-error", () => {
    const payloads = [
      { text: "good", isError: undefined },
      { text: "bad", isError: true },
    ];
    expect(pickLastNonEmptyTextFromPayloads(payloads)).toBe("good");
  });
});

describe("pickLastDeliverablePayload", () => {
  it("picks real payload over error payload", () => {
    const real = { text: "Delivered content" };
    const error = { text: "Error warning", isError: true as const };
    expect(pickLastDeliverablePayload([real, error])).toBe(real);
  });

  it("falls back to error payload when no real payload exists", () => {
    const error = { text: "Error warning", isError: true as const };
    expect(pickLastDeliverablePayload([error])).toBe(error);
  });

  it("returns undefined for empty payloads", () => {
    expect(pickLastDeliverablePayload([])).toBeUndefined();
  });

  it("picks media payload over error text payload", () => {
    const media = { mediaUrl: "https://example.com/img.png" };
    const error = { text: "Error warning", isError: true as const };
    expect(pickLastDeliverablePayload([media, error])).toBe(media);
  });

  it("treats isError: undefined as non-error", () => {
    const normal = { text: "ok", isError: undefined };
    const error = { text: "bad", isError: true as const };
    expect(pickLastDeliverablePayload([normal, error])).toBe(normal);
  });
});

describe("pickDeliverablePayloads", () => {
  it("preserves all successful deliverable payloads", () => {
    const payloads = [
      { text: "line 1" },
      { text: "temporary error", isError: true as const },
      { text: "line 2" },
    ];

    expect(pickDeliverablePayloads(payloads)).toEqual([{ text: "line 1" }, { text: "line 2" }]);
  });

  it("returns only the last error payload when all payloads are errors", () => {
    const payloads = [
      { text: "first error", isError: true as const },
      { text: "last error", isError: true as const },
    ];

    expect(pickDeliverablePayloads(payloads)).toEqual([{ text: "last error", isError: true }]);
  });
});

describe("detectCronDenialToken", () => {
  describe("exact tokens match anywhere in text", () => {
    it("detects SYSTEM_RUN_DENIED on first line", () => {
      expect(detectCronDenialToken("SYSTEM_RUN_DENIED: agent profile not found")).toBe(
        "SYSTEM_RUN_DENIED",
      );
    });

    it("detects SYSTEM_RUN_DENIED in body (not first line)", () => {
      expect(detectCronDenialToken("Run result\nSYSTEM_RUN_DENIED\nSee logs")).toBe(
        "SYSTEM_RUN_DENIED",
      );
    });

    it("detects INVALID_REQUEST anywhere", () => {
      expect(detectCronDenialToken("INVALID_REQUEST: bad payload")).toBe("INVALID_REQUEST");
    });
  });

  describe("natural-language tokens fire only on first non-empty line (true positives)", () => {
    it("detects 'could not run' when it is the first line", () => {
      expect(detectCronDenialToken("could not run\nsome details")).toBe("could not run");
    });

    it("detects 'was denied' when first non-empty line starts with the phrase", () => {
      expect(detectCronDenialToken("Request was denied by policy\nSee logs")).toBe("was denied");
    });

    it("detects 'runtime denied' on a leading status line even with blank prefix", () => {
      expect(detectCronDenialToken("\nruntime denied: exec not available\nDetails")).toBe(
        "runtime denied",
      );
    });
  });

  describe("natural-language tokens do NOT fire when phrase is in body, not first line (false-positive regression)", () => {
    it("ignores 'could not run' in second line of a successful summary", () => {
      expect(
        detectCronDenialToken(
          "Completed 3 of 5 tasks.\nNote: low-priority jobs could not run due to resource limits.",
        ),
      ).toBeUndefined();
    });

    it("ignores 'did not run' appearing after a heading line", () => {
      expect(
        detectCronDenialToken(
          "Run complete — 5 signals collected.\n\nSome validations did not run (optional).",
        ),
      ).toBeUndefined();
    });

    it("ignores 'was denied' when it describes a downstream API result", () => {
      expect(
        detectCronDenialToken(
          "All webhooks posted.\nThe rate limiter was denied access to one external endpoint.",
        ),
      ).toBeUndefined();
    });

    it("ignores 'runtime denied' when it appears after a successful status line", () => {
      expect(
        detectCronDenialToken("Config loaded ok.\nruntime denied: optional step skipped."),
      ).toBeUndefined();
    });

    it("ignores 'approval cannot safely bind' in an explanatory clause on line 2", () => {
      expect(
        detectCronDenialToken(
          "5 items processed.\napproval cannot safely bind to external services — expected in sandbox mode.",
        ),
      ).toBeUndefined();
    });

    it("ignores 'did not run' embedded in a clause describing skipped items", () => {
      expect(
        detectCronDenialToken(
          "Backup complete.\nFiles that did not run the new format are skipped automatically.",
        ),
      ).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("returns undefined for undefined input", () => {
      expect(detectCronDenialToken(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(detectCronDenialToken("")).toBeUndefined();
    });

    it("returns undefined for whitespace-only input", () => {
      expect(detectCronDenialToken("   \n   ")).toBeUndefined();
    });
  });
});

describe("isHeartbeatOnlyResponse", () => {
  const ACK_MAX = 300;

  it("returns true for empty payloads", () => {
    expect(isHeartbeatOnlyResponse([], ACK_MAX)).toBe(true);
  });

  it("returns true for a single HEARTBEAT_OK payload", () => {
    expect(isHeartbeatOnlyResponse([{ text: "HEARTBEAT_OK" }], ACK_MAX)).toBe(true);
  });

  it("returns false for a single non-heartbeat payload", () => {
    expect(isHeartbeatOnlyResponse([{ text: "Something important happened" }], ACK_MAX)).toBe(
      false,
    );
  });

  it("returns true when multiple payloads include narration followed by HEARTBEAT_OK", () => {
    // Agent narrates its work then signals nothing needs attention.
    expect(
      isHeartbeatOnlyResponse(
        [
          { text: "It's 12:49 AM — quiet hours. Let me run the checks quickly." },
          { text: "Emails: Just 2 calendar invites. Not urgent." },
          { text: "HEARTBEAT_OK" },
        ],
        ACK_MAX,
      ),
    ).toBe(true);
  });

  it("returns false when media is present even with HEARTBEAT_OK text", () => {
    expect(
      isHeartbeatOnlyResponse(
        [{ text: "HEARTBEAT_OK", mediaUrl: "https://example.com/img.png" }],
        ACK_MAX,
      ),
    ).toBe(false);
  });

  it("returns false when media is in a different payload than HEARTBEAT_OK", () => {
    expect(
      isHeartbeatOnlyResponse(
        [
          { text: "HEARTBEAT_OK" },
          { text: "Here's an image", mediaUrl: "https://example.com/img.png" },
        ],
        ACK_MAX,
      ),
    ).toBe(false);
  });

  it("returns false when no payload contains HEARTBEAT_OK", () => {
    expect(
      isHeartbeatOnlyResponse(
        [{ text: "Checked emails — found 3 urgent messages from your manager." }],
        ACK_MAX,
      ),
    ).toBe(false);
  });
});
