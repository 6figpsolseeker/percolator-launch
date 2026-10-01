// @vitest-environment node
/**
 * Error copy for P1 (66..71), P2 matcher (8002..8005) and P3 (provisional, flag-gated),
 * in BOTH wallet shapes (Phantom "custom program error: 0x.." log lines and Solflare's
 * {"InstructionError":[i,{"Custom":n}]} JSON), attributed by program id; plus the
 * zero/partial fill classifier.
 */
import { describe, it, expect, afterEach } from "vitest";
import { humanizeError, P1_ERROR_MESSAGES } from "@/lib/errorMessages";
import { explainMarketTxError } from "@/lib/market-error";
import { limitsErrorCopy } from "@/lib/limits/errors";
import { P2_ERROR_COPY, P3_ERROR_COPY_BY_NAME } from "@/lib/limits/copy";
import { P1_ERR, P2_ERR, P3_ERR } from "@/lib/limits/constants";
import { resolveDevnetProgramIds } from "@/lib/program-ids";
import { __setLimitsFlagsForTest } from "@/lib/limits/flags";
import { classifyFill } from "@/lib/limits/fill-result";

const { wrapper: W, matcher: M } = resolveDevnetProgramIds();
const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const phantom = (prog: string, code: number) =>
  `Simulation failed. Logs: ["Program ${W} invoke [1]", "Program ${prog} failed: custom program error: 0x${code.toString(16)}"]`;
const solflare = (code: number) => `{"InstructionError":[2,{"Custom":${code}}]}`;

afterEach(() => __setLimitsFlagsForTest(null));

describe("P1 wrapper codes 66..71", () => {
  for (const code of Object.values(P1_ERR)) {
    it(`${code}: plain copy in Phantom and Solflare shapes (attributed); bare Solflare is not guessed`, () => {
      expect(P1_ERROR_MESSAGES[code]).toBeTruthy();
      expect(humanizeError(phantom(W, code))).toBe(P1_ERROR_MESSAGES[code]);
      expect(humanizeError(`${solflare(code)}\nProgram ${W} failed: custom program error: 0x${code.toString(16)}`)).toBe(P1_ERROR_MESSAGES[code]);
      expect(humanizeError(solflare(code))).not.toBe(P1_ERROR_MESSAGES[code]);
    });
  }
  it("a 66 raised by SPL/matcher is not read as the band error", () => {
    expect(limitsErrorCopy({ code: 66, originProgramId: SPL, wrapperId: W, matcherId: M, p3Enabled: false })).toBeNull();
    expect(limitsErrorCopy({ code: 66, originProgramId: M, wrapperId: W, matcherId: M, p3Enabled: false })).toBeNull();
  });
});

describe("P2 matcher codes 8002..8005", () => {
  for (const code of Object.values(P2_ERR)) {
    it(`${code}: plain copy only when the MATCHER raised it`, () => {
      expect(humanizeError(phantom(M, code))).toBe(P2_ERROR_COPY[code]);
      expect(limitsErrorCopy({ code, originProgramId: M, wrapperId: W, matcherId: M, p3Enabled: false })).toBe(P2_ERROR_COPY[code]);
      expect(limitsErrorCopy({ code, originProgramId: W, wrapperId: W, matcherId: M, p3Enabled: false })).toBeNull();
    });
  }
  it("Solflare bare JSON (no program log): NOT guessed (error-codes-4b1a5d30.md: decode by the raising program)", () => {
    expect(limitsErrorCopy({ code: 8002, originProgramId: null, wrapperId: W, matcherId: M, p3Enabled: false })).toBeNull();
    expect(limitsErrorCopy({ code: 66, originProgramId: null, wrapperId: W, matcherId: M, p3Enabled: false })).toBeNull();
    // attributed, both map
    expect(limitsErrorCopy({ code: 8002, originProgramId: M, wrapperId: W, matcherId: M, p3Enabled: false })).toBe(P2_ERROR_COPY[8002]);
    expect(limitsErrorCopy({ code: 66, originProgramId: W, wrapperId: W, matcherId: M, p3Enabled: false })).not.toBeNull();
  });
  it("an unknown matcher code keeps the generic matcher line", () => {
    expect(humanizeError(phantom(M, 8009))).toMatch(/matcher rejected this fill/);
  });
});

describe("P3 codes: by name, provisional ordinals, flag-gated", () => {
  it("off => no P3 copy", () => {
    __setLimitsFlagsForTest({ p1: false, p2: false, p2FeeCharged: false, p3: false });
    expect(explainMarketTxError(phantom(W, P3_ERR.VaultLpSeniorImpaired), "earn-deposit", null)).toBeNull();
  });
  it("on => every P3 name maps through the constants module", () => {
    __setLimitsFlagsForTest({ p1: false, p2: false, p2FeeCharged: false, p3: true });
    for (const [name, code] of Object.entries(P3_ERR) as [keyof typeof P3_ERR, number][]) {
      expect(explainMarketTxError(phantom(W, code), "open", null)).toBe(P3_ERROR_COPY_BY_NAME[name]);
      expect(explainMarketTxError(solflare(code), "open", null)).toBe(P3_ERROR_COPY_BY_NAME[name]);
    }
  });
  it("P3 ordinals never overlap P1's", () => {
    const p1 = new Set<number>(Object.values(P1_ERR));
    for (const c of Object.values(P3_ERR)) expect(p1.has(c)).toBe(false);
  });
});

describe("classifyFill (P1 zero-fill coupling)", () => {
  it("zero, partial, full, unknown", () => {
    expect(classifyFill(0n, 0n, 100n)).toEqual({ kind: "zero", filledQ: 0n });
    expect(classifyFill(10n, 50n, 100n)).toEqual({ kind: "partial", filledQ: 40n });
    expect(classifyFill(10n, 110n, 100n)).toEqual({ kind: "full", filledQ: 100n });
    expect(classifyFill(0n, -100n, -100n)).toEqual({ kind: "full", filledQ: -100n });
    expect(classifyFill(0n, null, 100n)).toEqual({ kind: "unknown", filledQ: null });
  });
});
