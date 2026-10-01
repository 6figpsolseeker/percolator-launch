/**
 * RotaryDial input model. Pointer/touch DRAG was removed (laggy on the live
 * playground); the dial is operated by wheel, keys and tap-able -/+ buttons.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RotaryDial } from "@/components/create/RotaryDial";

afterEach(cleanup);

function mount(over: Partial<{ value: number; min: number; max: number; step: number; disabled: boolean }> = {}) {
  const onChange = vi.fn();
  const props = { label: "Leverage", value: 5, min: 2, max: 10, step: 0.5, ...over };
  render(<RotaryDial {...props} format={(v) => `${v}x`} onChange={onChange} />);
  return { onChange, slider: screen.getByRole("slider", { name: "Leverage" }) };
}

describe("RotaryDial ARIA", () => {
  it("exposes slider semantics", () => {
    const { slider } = mount();
    expect(slider.getAttribute("aria-valuenow")).toBe("5");
    expect(slider.getAttribute("aria-valuemin")).toBe("2");
    expect(slider.getAttribute("aria-valuemax")).toBe("10");
    expect(slider.getAttribute("aria-valuetext")).toBe("5x");
    expect(slider.tabIndex).toBe(0);
  });
});

describe("RotaryDial wheel", () => {
  it("scroll up increases, down decreases, by one step", () => {
    const { slider, onChange } = mount();
    fireEvent.wheel(slider, { deltaY: -100 });
    expect(onChange).toHaveBeenLastCalledWith(5.5);
    fireEvent.wheel(slider, { deltaY: 100 });
    expect(onChange).toHaveBeenLastCalledWith(4.5);
  });
  it("clamps at the stops (#2621: 10x cap)", () => {
    const { slider, onChange } = mount({ value: 10 });
    fireEvent.wheel(slider, { deltaY: -100 });
    expect(onChange).not.toHaveBeenCalled();
  });
  it("consumes the wheel (non-passive) so the page can't scroll out from under it (#2716)", () => {
    // The bug: React registers `wheel` passively, so the old synthetic onWheel
    // could not preventDefault — the page scrolled and the dial left the cursor,
    // so "scroll" was advertised but never actually moved the value. The fix binds
    // a non-passive native listener that preventDefaults. defaultPrevented===true
    // is what a passive handler can't produce, so this fails if the fix regresses.
    const { slider, onChange } = mount();
    const ev = new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true });
    slider.dispatchEvent(ev);
    expect(onChange).toHaveBeenLastCalledWith(5.5); // still adjusts
    expect(ev.defaultPrevented).toBe(true); // and suppresses the page scroll
  });
});

describe("RotaryDial keys", () => {
  it("arrows, Home, End", () => {
    const { slider, onChange } = mount();
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(5.5);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(4.5);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });
});

describe("RotaryDial tap step buttons (touch users)", () => {
  it("+ and - step by one detent", () => {
    const { onChange } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Increase Leverage" }));
    expect(onChange).toHaveBeenLastCalledWith(5.5);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Leverage" }));
    expect(onChange).toHaveBeenLastCalledWith(4.5);
  });
  it("buttons disable at the stops", () => {
    mount({ value: 10 });
    expect((screen.getByRole("button", { name: "Increase Leverage" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mount({ value: 2 });
    expect((screen.getByRole("button", { name: "Decrease Leverage" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("disabled dial ignores wheel, keys and taps", () => {
    const { slider, onChange } = mount({ disabled: true });
    fireEvent.wheel(slider, { deltaY: -100 });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("button", { name: "Increase Leverage" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("RotaryDial has no drag", () => {
  it("mouse/touch drag never changes the value and adds no window listeners", () => {
    const add = vi.spyOn(window, "addEventListener");
    const { slider, onChange } = mount();
    fireEvent.mouseDown(slider, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 100 });
    fireEvent.touchStart(slider, { touches: [{ clientY: 500 }] });
    fireEvent.touchMove(window, { touches: [{ clientY: 100 }] });
    expect(onChange).not.toHaveBeenCalled();
    const dragEvents = add.mock.calls.filter(([t]) => ["mousemove", "touchmove", "mouseup", "touchend"].includes(t as string));
    expect(dragEvents).toHaveLength(0);
    add.mockRestore();
  });
});
