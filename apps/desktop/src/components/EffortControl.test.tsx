import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EffortControl } from "./EffortControl.js";

describe("EffortControl", () => {
  it("disables unsupported levels with an explanation (never silently ignored)", () => {
    render(<EffortControl value="medium" supported={["low", "medium"]} onChange={() => {}} />);
    const max = screen.getByRole("button", { name: "max" });
    expect(max).toBeDisabled();
    expect(max).toHaveAttribute("title", expect.stringMatching(/refused, not ignored/));
  });

  it("marks the selected level pressed", () => {
    render(<EffortControl value="high" supported={["low", "medium", "high"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "high" })).toHaveAttribute("aria-pressed", "true");
  });

  it("changes to a supported level on click but not an unsupported one", () => {
    const onChange = vi.fn();
    render(<EffortControl value="low" supported={["low", "high"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "high" }));
    expect(onChange).toHaveBeenCalledWith("high");
    fireEvent.click(screen.getByRole("button", { name: "max" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
