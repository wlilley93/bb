import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { agentEditorRpc } from "./server.js";
import { Area, Field, Fold, GroupHeading, Hit, Note, Pick, Primary, Quiet, ScrollFade, SearchField, SeatMark, TextField, accent, appear, fieldControl, focusRing, listPage, scrollRowIntoList, seatTone, stroke } from "./chrome.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function paintCopy(node: HTMLElement, color: string) {
  node.style.color = color;
  node.querySelectorAll("[data-quiet], mark").forEach((part) => {
    if (part instanceof HTMLElement) part.style.color = color;
  });
}

function FileLabel({ name, query }: { name: string; query: string }) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const needle = query.trim().toLowerCase();
  const spans = needle.length > 0 && name.toLowerCase().includes(needle) && !stem.toLowerCase().includes(needle) && !ext.toLowerCase().includes(needle);
  if (!ext || spans) return <Hit text={name} query={query} />;
  return (
    <>
      <Hit text={stem} query={query} />
      <span data-quiet className="font-normal text-muted-foreground motion-safe:duration-150 motion-safe:transition-colors"><Hit text={ext} query={query} /></span>
    </>
  );
}

export function SopFiles() {
  const rpc = useRpc<typeof agentEditorRpc>();
  const [files, setFiles] = useState<Array<{ path: string; title: string }>>([]);
  const [selected, setSelected] = useState("Instructions/firm.md");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [request, setRequest] = useState({ id: "", rule: "", reason: "", layer: "permission", gap: "none", owner: "head-agent-ops" });
  const loadedBody = useRef("");
  const shownFile = useRef("");
  const primedFiles = useRef(false);

  const loadFile = useCallback(async (relative: string) => {
    const file = await rpc.call("readFile", { path: relative });
    loadedBody.current = file.body;
    setBody(file.body);
    setSelected(relative);
  }, [rpc]);

  const openFile = (relative: string) => {
    if (relative === selected) return;
    if (body !== loadedBody.current) {
      setStatus("Save this file before opening another.");
      return;
    }
    void loadFile(relative).catch((error: unknown) => setStatus(message(error)));
  };

  useEffect(() => {
    void rpc.call("files", null).then(async (listed) => {
      setFiles(listed.files);
      if (listed.files.some((file) => file.path === "Instructions/firm.md")) {
        await loadFile("Instructions/firm.md");
      }
    }).catch((error: unknown) => setStatus(message(error)));
  }, [loadFile, rpc]);

  const fileDirty = body !== loadedBody.current;
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set());
  const [live, setLive] = useState(false);
  const [query, setQuery] = useState("");
  const [point, setPoint] = useState(0);
  const [pointedQuery, setPointedQuery] = useState("");
  const [copied, setCopied] = useState("");
  const fileNote = copied || (status === "Save this file before opening another." ? "Save the file first." : fileDirty ? "Unsaved" : "Saved");
  if (pointedQuery !== query) {
    setPointedQuery(query);
    setPoint(0);
  }

  useEffect(() => {
    if (primedFiles.current || files.length === 0) return;
    primedFiles.current = true;
    const currentFolder = selected.includes("/") ? selected.slice(0, selected.indexOf("/")) : "Company";
    const next = new Set<string>();
    for (const file of files) {
      const folder = file.path.includes("/") ? file.path.slice(0, file.path.indexOf("/")) : "Company";
      if (folder !== currentFolder) next.add(folder);
    }
    setShut(next);
  }, [files, selected]);

  useEffect(() => {
    if (live || files.length === 0) return;
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, [files.length, live]);

  useEffect(() => {
    if (!selected || shownFile.current === selected) return;
    const row = document.querySelector(`[data-file="${CSS.escape(selected)}"]`);
    if (!(row instanceof HTMLElement)) return;
    shownFile.current = selected;
    scrollRowIntoList(`[data-file="${CSS.escape(selected)}"]`);
  }, [selected, shut]);

  useEffect(() => {
    setCopied("");
  }, [selected]);
  const folders = new Map<string, Array<{ path: string; title: string }>>();
  for (const file of files) {
    const folder = file.path.includes("/") ? file.path.slice(0, file.path.indexOf("/")) : "Company";
    const group = folders.get(folder) ?? [];
    group.push(file);
    folders.set(folder, group);
  }
  const needle = query.trim().toLowerCase();
  const listed = [...folders.entries()]
    .map(([folder, entries]) => [
      folder,
      needle
        ? entries.filter((file) => file.path.toLowerCase().includes(needle) || file.title.toLowerCase().includes(needle))
        : entries,
    ] as const)
    .filter(([, entries]) => entries.length > 0);
  const visible = listed.flatMap(([, entries]) => entries);
  const pointedPath = needle ? visible[Math.min(point, Math.max(visible.length - 1, 0))]?.path ?? "" : "";
  const hadQuery = useRef(false);
  useEffect(() => {
    if (!pointedPath) return;
    scrollRowIntoList(`[data-file="${CSS.escape(pointedPath)}"]`);
  }, [pointedPath]);
  useEffect(() => {
    if (needle) {
      hadQuery.current = true;
      return;
    }
    if (!hadQuery.current || !selected) return;
    hadQuery.current = false;
    scrollRowIntoList(`[data-file="${CSS.escape(selected)}"]`);
  }, [needle, selected]);

  return (
    <>
      <div className="@container border-t border-border pt-4" style={{ borderTopColor: stroke }}>
      <div className="mb-2 flex h-8 w-full items-center pl-8 @[40rem]:w-[15rem] @[40rem]:pr-2">
        <h2 className="min-w-0 truncate text-sm font-medium">Boltrig Company SOP</h2>
        <span key={listed.reduce((sum, [, entries]) => sum + entries.length, 0)} className={`ml-auto shrink-0 text-xs tabular-nums text-muted-foreground ${live ? appear : ""}`}>{listed.reduce((sum, [, entries]) => sum + entries.length, 0)}</span>
      </div>
      <div className="grid items-stretch gap-6 @[40rem]:grid-cols-[15rem_minmax(0,1fr)] @[40rem]:gap-8">
        <div className="flex max-h-72 w-full min-w-0 flex-col gap-2 overflow-hidden @[40rem]:sticky @[40rem]:top-4 @[40rem]:max-h-96">
          <SearchField
            aria-label="Search files"
            hint="/"
            placeholder="Files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
              if ((event.key === "Home" || event.key === "End") && needle && visible.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                setPoint(event.key === "Home" ? 0 : visible.length - 1);
              }
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && needle && visible.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                setPoint((current) => {
                  const last = visible.length - 1;
                  const next = event.key === "ArrowDown" ? current + 1 : current - 1;
                  return Math.max(0, Math.min(last, next));
                });
              }
              if ((event.key === "PageDown" || event.key === "PageUp") && needle && visible.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                const step = listPage(`[data-file="${CSS.escape(visible[0].path)}"]`);
                setPoint((current) => {
                  const last = visible.length - 1;
                  const next = event.key === "PageDown" ? current + step : current - step;
                  return Math.max(0, Math.min(last, next));
                });
              }
              if (event.key === "Enter" && pointedPath) {
                event.preventDefault();
                event.stopPropagation();
                document.querySelector<HTMLButtonElement>(`[data-file="${CSS.escape(pointedPath)}"]`)?.click();
              }
            }}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-muted py-1" style={{ boxShadow: `0 0 0 1px ${stroke}` }}>
          <ScrollFade label="SOP files">
          {files.length === 0 ? <p className={`flex min-h-8 items-center text-pretty pl-8 pr-2 text-sm text-muted-foreground ${appear}`}>Save the company folder to open its files.</p> : null}
          {files.length > 0 && listed.length === 0 ? <p className={`flex min-h-8 items-center pl-8 pr-2 text-sm text-muted-foreground ${appear}`}>Nothing matches.</p> : null}
          {listed.map(([folder, entries]) => {
            const open = needle.length > 0 || !shut.has(folder);
            return (
            <div key={folder} className="pt-2 first:pt-0">
              <GroupHeading
                open={open}
                fade={live}
                tone={seatTone(folder)}
                count={entries.length}
                onToggle={() => setShut((current) => {
                  const next = new Set(current);
                  if (next.has(folder)) next.delete(folder);
                  else next.add(folder);
                  return next;
                })}
              >{<Hit text={folder} query={query} />}</GroupHeading>
              {open ? <div className={live ? `min-w-0 ${appear}` : "min-w-0"}>{entries.map((file) => {
                const current = file.path === selected;
                const name = file.path.slice(file.path.lastIndexOf("/") + 1);
                return (
                  <Pick
                    key={file.path}
                    current={current}
                    dirty={current && fileDirty}
                    mark={<SeatMark id={folder} name={name} />}
                    pointed={file.path === pointedPath}
                    data-file={file.path}
                    onClick={() => openFile(file.path)}
                  >{<FileLabel name={name} query={query} />}</Pick>
                );
              })}</div> : null}
            </div>
            );
          })}
          </ScrollFade>
          </div>
        </div>
        <div className="@container flex min-h-0 min-w-0 flex-col">
          <div className="flex h-full min-h-0 flex-col gap-2">
              <div className="flex h-8 min-w-0 items-center gap-2 border-b" style={{ borderBottomColor: stroke }}>
                <SeatMark id={selected.includes("/") ? selected.slice(0, selected.indexOf("/")) : selected ? "Company" : "sop"} name={selected.slice(selected.lastIndexOf("/") + 1) || "SOP"} />
                <h2 key={selected || "sop"} className={`min-w-0 truncate text-sm font-medium ${live ? appear : ""}`} onMouseEnter={(event) => { const node = event.currentTarget; node.title = node.scrollWidth > node.clientWidth + 1 ? (node.textContent ?? "") : ""; }}><FileLabel name={selected.slice(selected.lastIndexOf("/") + 1) || "SOP file"} query={query} /></h2>
                {fileDirty ? (
                  <span className={`shrink-0 ${appear}`}>
                  <Primary onClick={() => {
                    const show = (text: string) => {
                      setCopied(text);
                      window.setTimeout(() => setCopied(""), 1200);
                    };
                    void rpc.call("saveFile", { path: selected, body }).then(() => {
                      loadedBody.current = body;
                      setStatus(`Saved ${selected}.`);
                    }).catch((error: unknown) => {
                      show("Not saved");
                      setStatus(message(error));
                    });
                  }}>Save</Primary>
                  </span>
                ) : null}
              </div>
              <p className="flex min-w-0 items-center gap-2 pl-6 text-xs text-muted-foreground">
                <button
                  type="button"
                  aria-label="Copy file path"
                  title="Copy"
                  className={`-mx-1 min-w-0 cursor-pointer truncate rounded-sm px-1 text-left font-mono text-foreground [direction:rtl] [unicode-bidi:plaintext] motion-safe:duration-150 motion-safe:transition-[color,background-color,border-color,box-shadow] ${focusRing}`}
                  onMouseEnter={(event) => { const node = event.currentTarget; node.title = node.scrollWidth > node.clientWidth + 1 ? (node.textContent ?? "") : "Copy"; paintCopy(node, accent); }}
                  onMouseLeave={(event) => { if (event.currentTarget !== document.activeElement) paintCopy(event.currentTarget, ""); }}
                  onFocus={(event) => { paintCopy(event.currentTarget, accent); }}
                  onBlur={(event) => { paintCopy(event.currentTarget, ""); }}
                  onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}
                  onClick={() => {
                    if (!selected) return;
                    const show = (text: string) => {
                      setCopied(text);
                      window.setTimeout(() => setCopied(""), 1200);
                    };
                    void navigator.clipboard.writeText(selected).then(() => show("Copied")).catch(() => show("Not copied"));
                  }}
                ><span key={selected || "sop"} className={`[unicode-bidi:isolate] [direction:ltr] ${live ? appear : ""}`}>{selected.includes("/") ? <span data-quiet className="text-muted-foreground motion-safe:duration-150 motion-safe:transition-colors"><Hit text={`${selected.slice(0, selected.lastIndexOf("/"))}/`} query={query} /></span> : null}<span className="font-medium"><FileLabel name={selected.slice(selected.lastIndexOf("/") + 1) || "SOP file"} query={query} /></span></span></button>
                <span aria-hidden className="shrink-0 opacity-60">·</span>
                <span className="shrink-0 whitespace-nowrap motion-safe:duration-150 motion-safe:transition-colors" style={copied === "Not saved" || copied === "Not copied" || (!copied && (fileDirty || status === "Save this file before opening another.")) ? { color: accent } : undefined}><span key={fileNote} className={live ? appear : ""}>{fileNote}</span></span>
              </p>
              <Area resetKey={selected} aria-label="SOP file body" filled mono dirty={fileDirty} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
        </div>
      </div>
      </div>

      <Fold title="Ask for a permission">
        <p className="text-pretty text-sm text-muted-foreground">This adds a row to the policy register. It does not edit a permission header.</p>
        <Field label="Id"><TextField aria-label="Permission id" value={request.id} onChange={(event) => setRequest({ ...request, id: event.target.value })} placeholder="no-send" spellCheck={false} autoCorrect="off" autoCapitalize="off" /></Field>
        <Field label="Rule"><Area aria-label="Permission rule" lined inset className="min-h-8" value={request.rule} onChange={(event) => setRequest({ ...request, rule: event.target.value })} placeholder="Nothing leaves the company without a person." /></Field>
        <Field label="Reason"><Area aria-label="Permission reason" lined inset className="min-h-8" value={request.reason} onChange={(event) => setRequest({ ...request, reason: event.target.value })} placeholder="A person sends." /></Field>
        <Field label="Enforcing layer"><TextField aria-label="Enforcing layer" value={request.layer} onChange={(event) => setRequest({ ...request, layer: event.target.value })} placeholder="permission" spellCheck={false} autoCorrect="off" autoCapitalize="off" /></Field>
        <Field label="Gap"><TextField aria-label="Gap" value={request.gap} onChange={(event) => setRequest({ ...request, gap: event.target.value })} placeholder="none" spellCheck={false} autoCorrect="off" autoCapitalize="off" /></Field>
        <Field label="Owner"><TextField aria-label="Owner" value={request.owner} onChange={(event) => setRequest({ ...request, owner: event.target.value })} placeholder="head-agent-ops" spellCheck={false} autoCorrect="off" autoCapitalize="off" /></Field>
        <div className={fieldControl}>
        <Quiet disabled={!request.id.trim()} onClick={() => {
          void rpc.call("addPermission", request).then(() => setStatus("Added a policy register row.")).catch((error: unknown) => setStatus(message(error)));
        }}>Add register row</Quiet>
        </div>
      </Fold>
      {status ? <Note>{status}</Note> : null}
    </>
  );
}
