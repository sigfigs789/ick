import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SuggestionAcceptedNotice } from "./SuggestionAcceptedNotice";

describe("SuggestionAcceptedNotice", () => {
  it("draws nothing without an accepted word", () => {
    const { container } = render(
      <SuggestionAcceptedNotice words={[]} firstAcceptance={false} onDismiss={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("thanks the player for their word, and names the badge on the first one", () => {
    const onDismiss = vi.fn();
    render(<SuggestionAcceptedNotice words={["zibeline"]} firstAcceptance onDismiss={onDismiss} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Your suggestion “zibeline” was accepted");
    expect(notice).toHaveTextContent("Thank you");
    expect(notice).toHaveTextContent("Achievement unlocked: 📖 In the dictionary.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("lists several words at once", () => {
    render(
      <SuggestionAcceptedNotice
        words={["zibeline", "quockerwodger", "snollygoster"]}
        firstAcceptance={false}
        onDismiss={() => {}}
      />
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(
      "Your suggestions “zibeline”, “quockerwodger” and “snollygoster” were accepted"
    );
    expect(notice).not.toHaveTextContent("Achievement unlocked");
  });
});
