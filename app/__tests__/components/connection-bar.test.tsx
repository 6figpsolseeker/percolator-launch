/**
 * UX WP-10 (audit §4.9, RP-1): "Reconnecting to Solana…" after 2 consecutive failed RPC calls or a
 * -32005 / -32603, hidden again on the next good answer. A program error is a reachable Solana.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { __resetRpcHealthForTest, reportRpcOutcome, rpcErrorCode, rpcHealth } from "@/lib/rpc-health";
import { CONNECTION_BAR_TEXT, ConnectionBar } from "@/components/layout/ConnectionBar";

beforeEach(() => __resetRpcHealthForTest());

describe("rpc health", () => {
  it("2 consecutive failures -> degraded; a success clears it", () => {
    reportRpcOutcome(false);
    expect(rpcHealth.getSnapshot()).toBe(false);
    reportRpcOutcome(false);
    expect(rpcHealth.getSnapshot()).toBe(true);
    reportRpcOutcome(true);
    expect(rpcHealth.getSnapshot()).toBe(false);
  });
  it("-32005 / -32603 degrade at once; a failure then a success never shows it", () => {
    reportRpcOutcome(false, -32005);
    expect(rpcHealth.getSnapshot()).toBe(true);
    reportRpcOutcome(true);
    reportRpcOutcome(false, -32603);
    expect(rpcHealth.getSnapshot()).toBe(true);
    reportRpcOutcome(true);
    reportRpcOutcome(false);
    reportRpcOutcome(true);
    expect(rpcHealth.getSnapshot()).toBe(false);
  });
  it("error codes are read from single and batch bodies", () => {
    expect(rpcErrorCode('{"jsonrpc":"2.0","error":{"code":-32005,"message":"429"}}')).toBe(-32005);
    expect(rpcErrorCode('[{"result":1},{"error":{"code":-32603}}]')).toBe(-32603);
    expect(rpcErrorCode('{"result":{"value":null}}')).toBeNull();
    expect(rpcErrorCode("not json")).toBeNull();
  });
});

describe("ConnectionBar", () => {
  it("shows while degraded and hides on recovery", () => {
    render(<ConnectionBar />);
    expect(screen.queryByTestId("connection-bar")).toBeNull();
    act(() => {
      reportRpcOutcome(false);
      reportRpcOutcome(false);
    });
    expect(screen.getByTestId("connection-bar").textContent).toBe(CONNECTION_BAR_TEXT);
    expect(screen.getByTestId("connection-bar").getAttribute("role")).toBe("status");
    act(() => reportRpcOutcome(true));
    expect(screen.queryByTestId("connection-bar")).toBeNull();
  });
});
