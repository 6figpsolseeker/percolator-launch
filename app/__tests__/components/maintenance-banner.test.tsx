import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaintenanceBanner } from "@/components/layout/MaintenanceBanner";

describe("MaintenanceBanner", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("NEGATIVE CONTROL: renders nothing when off", () => {
    const { container } = render(<MaintenanceBanner />);
    expect(container.innerHTML).toBe("");
  });
  it("renders the configured message when on", () => {
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE", "1");
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_MESSAGE", "Cutover in progress");
    render(<MaintenanceBanner />);
    expect(screen.getByTestId("maintenance-banner").textContent).toBe("Cutover in progress");
  });
});
