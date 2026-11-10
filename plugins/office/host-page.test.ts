import { describe, expect, it } from "vitest";
import { CRAFT_APPS } from "./craft-apps.js";
import { craftHostDocument } from "./host-page.js";

describe("craft host document", () => {
  it("runs WordCraft in page-host mode against the served build", () => {
    const word = CRAFT_APPS[0]!;
    const html = craftHostDocument(
      word,
      "https://bb.example/api/v1/file-previews/1/wordcraft/app.js",
    );
    expect(html).toContain('<base href="https://bb.example/api/v1/file-previews/1/wordcraft/">');
    expect(html).toContain('id="wordcraft_canvas"');
    expect(html).toContain('data-host="page"');
    expect(html).toContain('const app = "wordcraft"');
    expect(html).toContain('":open"');
    expect(html).toContain('":module"');
    expect(html).toContain("https://bb.example/api/v1/file-previews/1/wordcraft/app.js");
    expect(html).toContain("boltrig-craft-web");
    expect(html).toContain("installCraftCache");
    expect(html).toContain(".tee()");
    expect(html).not.toContain("arrayBuffer");
    expect(html).not.toContain("sandbox");
  });

  it("points PdfCraft at its text recognition worker", () => {
    const pdf = CRAFT_APPS.find((app) => app.id === "pdfcraft");
    if (pdf === undefined) throw new Error("PdfCraft is missing");
    const html = craftHostDocument(
      pdf,
      "https://bb.example/api/v1/file-previews/1/pdfcraft/app.js",
      "./ocr_loader.js",
    );
    expect(html).toContain('<base href="https://bb.example/api/v1/file-previews/1/pdfcraft/">');
    expect(html).toContain('<meta name="pdfcraft-ocr-worker" content="./ocr_loader.js">');
  });

  it("keeps asset links on the preview when the glue is a local copy", () => {
    const word = CRAFT_APPS[0]!;
    const html = craftHostDocument(
      word,
      "blob:https://bb.example/glue",
      null,
      "https://bb.example/api/v1/file-previews/1/wordcraft/",
    );
    expect(html).toContain("blob:https://bb.example/glue");
    expect(html).toContain('<base href="https://bb.example/api/v1/file-previews/1/wordcraft/">');
  });
});
