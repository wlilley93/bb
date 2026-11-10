export interface CraftApp {
  id: "wordcraft" | "deckcraft" | "gridcraft" | "pdfcraft";
  title: string;
  canvasId: string;
  loadingId: string;
  extensions: readonly string[];
  zip: string;
  sha256: string;
  innerDir: string;
}

export const CRAFT_APPS: readonly CraftApp[] = [
  {
    id: "wordcraft",
    title: "WordCraft",
    canvasId: "wordcraft_canvas",
    loadingId: "wordcraft_loading",
    extensions: ["docx", "doc", "dotx", "odt", "rtf"],
    zip: "wordcraft-web-0.17.0.zip",
    sha256: "713f5e4b01427eb262c70e280e55d1354fa530e5a351b9751ebbe37398ea2ed0",
    innerDir: "wordcraft-web-0.17.0",
  },
  {
    id: "deckcraft",
    title: "DeckCraft",
    canvasId: "deckcraft_canvas",
    loadingId: "deckcraft_loading",
    extensions: ["pptx", "potx", "ppsx", "deckcraft"],
    zip: "deckcraft-web-0.17.0.zip",
    sha256: "bd7bef54b3ef1be3e408e8bdcf291aaf9ad0ee298ea6bb22e1b5b3fc4a72eaba",
    innerDir: "deckcraft-web-0.17.0",
  },
  {
    id: "gridcraft",
    title: "GridCraft",
    canvasId: "gridcraft_canvas",
    loadingId: "gridcraft_loading",
    extensions: ["xlsx", "xlsm", "xlsb", "ods"],
    zip: "gridcraft-web-0.18.0.zip",
    sha256: "39c3236a3ac6c3607a4126c5ae40491069f5e1c28ccaac1bb884ddc9d294e4c0",
    innerDir: "gridcraft-web-0.18.0",
  },
  {
    id: "pdfcraft",
    title: "PdfCraft",
    canvasId: "pdfcraft",
    loadingId: "pdfcraft_loading",
    extensions: ["pdf"],
    zip: "pdfcraft-web-0.20.0.zip",
    sha256: "5cd9da8025e5e4c587069f9ee5fbfeeb859f8fbc35bfdb0c63fc1f139d7240e6",
    innerDir: "pdfcraft-web-0.20.0",
  },
];

export function craftAppForName(name: string): CraftApp | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return CRAFT_APPS.find((app) => app.extensions.includes(extension)) ?? null;
}

export function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Where a Craft save lands. A save of the open file writes that file. A save
 * under another name, including an export, writes beside it. Save As becomes
 * the file the next save updates.
 */
export function saveDestination(
  currentPath: string,
  name: string,
  saveAs: boolean,
): { path: string; becomesCurrent: boolean } {
  const clean = fileName(name).replace(/^\.+/u, "") || fileName(currentPath);
  const slash = Math.max(currentPath.lastIndexOf("/"), currentPath.lastIndexOf("\\"));
  const directory = slash === -1 ? "" : currentPath.slice(0, slash);
  const next = directory === "" ? clean : `${directory}/${clean}`;
  if (!saveAs && clean === fileName(currentPath)) {
    return { path: currentPath, becomesCurrent: false };
  }
  return { path: next, becomesCurrent: saveAs };
}
