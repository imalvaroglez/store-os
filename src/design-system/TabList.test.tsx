// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TabList } from "./TabList";

describe("manual tab navigation", () => {
  it("moves keyboard focus without changing a partially edited ticket until activation", () => {
    const change = vi.fn();
    render(<TabList id="tickets" label="Tickets" value="a" items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} onChange={change} />);
    const first = screen.getByRole("tab", { name: "A" });
    const second = screen.getByRole("tab", { name: "B" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.click(second);
    expect(change).toHaveBeenCalledWith("b");
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(second).toHaveFocus();
  });
});
