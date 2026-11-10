import { describe, expect, it } from "vitest";
import { craftAppForName, saveDestination } from "./craft-apps.js";

describe("craft apps", () => {
  it("picks the app from the office extension", () => {
    expect(craftAppForName("notes/Q4.docx")?.id).toBe("wordcraft");
    expect(craftAppForName("deck.PPTX")?.id).toBe("deckcraft");
    expect(craftAppForName("books/budget.xlsx")?.id).toBe("gridcraft");
    expect(craftAppForName("scans/form.pdf")?.id).toBe("pdfcraft");
    expect(craftAppForName("readme.md")).toBeNull();
  });

  it("writes a save over the open file and an export beside it", () => {
    expect(saveDestination("docs/notes.docx", "notes.docx", false)).toEqual({
      path: "docs/notes.docx",
      becomesCurrent: false,
    });
    expect(saveDestination("docs/notes.docx", "notes.pdf", false)).toEqual({
      path: "docs/notes.pdf",
      becomesCurrent: false,
    });
    expect(saveDestination("docs/notes.docx", "copy.docx", true)).toEqual({
      path: "docs/copy.docx",
      becomesCurrent: true,
    });
  });
});
