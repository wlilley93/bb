Open a Word, PowerPoint, Excel, or PDF file from a thread and edit it in place. The file panel runs the matching ArtCraft app: WordCraft, DeckCraft, GridCraft, or PdfCraft.

## What you get

- WordCraft for `.docx`, `.doc`, `.dotx`, `.odt`, and `.rtf`.
- DeckCraft for `.pptx`, `.potx`, `.ppsx`, and `.deckcraft`.
- GridCraft for `.xlsx`, `.xlsm`, `.xlsb`, and `.ods`.
- PdfCraft for `.pdf`.
- Save writes the file back. Save As and exports write beside it.

## How it works

The plugin ships the official web builds of the four apps and serves them from bb. Each file opens in its own frame. A bar shows the compressed app download and the open file together, then keeps moving while the app starts. WordCraft is about 22 MB on the wire, PdfCraft about 21 MB, DeckCraft about 12 MB, and GridCraft about 10 MB. The browser keeps that download, and it keeps the small script that starts the app. The next file of the same kind uses those saved copies. Closing the last file keeps the compiled app for two minutes, then releases it. The app runs in page-host mode, so Save hands the bytes back to bb. Recognize Text in a PDF keeps its language files and its reader after the first use. The builds are the release zips in `vendor/zips`, checked against a pinned hash before they are unpacked.

No separate install is required on the server. The browser needs WebGPU or WebGL2. Markdown, HTML, CSV, and plain text stay with their own editors.
