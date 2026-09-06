import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ArenaSoundToggle from "./ArenaSoundToggle";

describe("ArenaSoundToggle", () => {
  it("is a labelled checkbox and forwards persistence changes", () => {
    const onChange = vi.fn();
    render(<ArenaSoundToggle enabled={true} onChange={onChange} />);
    const checkbox = screen.getByLabelText("Geluid");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
