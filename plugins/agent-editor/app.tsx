import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, type PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { agentEditorRpc } from "./server.js";
import { SeatSidebar, SeatThreads } from "./seat-sidebar.js";
import { SopFiles } from "./sop-files.js";
import { Area, Choice, Field, Fold, GroupHeading, Hit, Note, Page, Pick, Primary, Quiet, Read, ScrollFade, SearchField, SeatMark, TextField, accent, appear, fieldControl, focusRing, listPage, scrollRowIntoList, stroke } from "./chrome.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function paintTone(node: HTMLElement, color: string) {
  node.style.color = color;
  node.querySelectorAll("mark").forEach((part) => {
    if (part instanceof HTMLElement) part.style.color = color;
  });
}

const tierOrder = ["head", "vp", "pm"];

function seatLabel(id: string, tier: string): string {
  const stem = id.replace(/^(?:head|vp|pm)-/, "");
  const name = stem
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  if (tier === "head" && id.startsWith("head-")) return `Head of ${name}`;
  if (tier === "vp") return `VP · ${name}`;
  if (tier === "pm") return `PM · ${name}`;
  return name || id;
}

function AgentEditorPage(_props: PluginSettingsSectionProps) {
  const rpc = useRpc<typeof agentEditorRpc>();
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [doctrine, setDoctrine] = useState("");
  const [seats, setSeats] = useState<Array<{ id: string; mode: string; tier: string; rank: string; permissions: string; reach: string }>>([]);
  const [seat, setSeat] = useState("");
  const [duty, setDuty] = useState("");
  const [requestBase, setRequestBase] = useState<"head" | "vp" | "pm">("pm");
  const [requestId, setRequestId] = useState("");
  const [requestBody, setRequestBody] = useState("");
  const [roleId, setRoleId] = useState("");
  const [roleBase, setRoleBase] = useState<"subagent" | "primary">("subagent");
  const [roleBody, setRoleBody] = useState("");
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set(["head", "vp", "pm", "other"]));
  const [live, setLive] = useState(false);
  const [query, setQuery] = useState("");
  const [point, setPoint] = useState(0);
  const [pointedQuery, setPointedQuery] = useState("");
  const [copied, setCopied] = useState("");
  if (pointedQuery !== query) {
    setPointedQuery(query);
    setPoint(0);
  }
  const loadedDuty = useRef("");
  const shownSeat = useRef("");

  const loadSeats = useCallback(async () => {
    const listed = await rpc.call("seats", null);
    setDoctrine(listed.doctrine);
    setSeats(listed.seats);
    const requested = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("seat");
    setSeat((current) => {
      if (requested && listed.seats.some((entry) => entry.id === requested)) return requested;
      return current || listed.seats[0]?.id || "";
    });
  }, [rpc]);

  useEffect(() => {
    void rpc.call("getRoot", null).then((result) => {
      if (result.root) {
        setSavedRoot(result.root);
        setRoot(result.root);
      }
    }).catch((error: unknown) => setStatus(message(error)));
    void loadSeats().catch((error: unknown) => setStatus(message(error)));
  }, [loadSeats, rpc]);

  useEffect(() => {
    if (!seat) return;
    void rpc.call("readDuty", { seat }).then((result) => {
      loadedDuty.current = result.body;
      setDuty(result.body);
    }).catch((error: unknown) => setStatus(message(error)));
  }, [rpc, seat]);

  useEffect(() => {
    const tier = seats.find((entry) => entry.id === seat)?.tier;
    if (!tier) return;
    const key = tierOrder.includes(tier) ? tier : "other";
    setShut((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, [seat, seats]);

  useEffect(() => {
    if (live || seats.length === 0) return;
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, [live, seats.length]);

  useEffect(() => {
    if (!seat || shownSeat.current === seat) return;
    const row = document.querySelector(`[data-seat="${CSS.escape(seat)}"]`);
    if (!(row instanceof HTMLElement)) return;
    shownSeat.current = seat;
    scrollRowIntoList(`[data-seat="${CSS.escape(seat)}"]`);
  }, [seat, shut]);

  useEffect(() => {
    setCopied("");
  }, [seat]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
    const seats = document.querySelector<HTMLInputElement>('[aria-label="Search agents"]');
    const files = document.querySelector<HTMLInputElement>('[aria-label="Search files"]');
    const distance = (node: HTMLInputElement | null) => {
      if (!node) return Number.POSITIVE_INFINITY;
      const box = node.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= window.innerHeight) return Number.POSITIVE_INFINITY;
      return Math.abs(box.top + box.height / 2 - window.innerHeight / 2);
    };
    const field = distance(files) < distance(seats) ? files : seats;
      if (!field) return;
      event.preventDefault();
      field.focus();
      field.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const listedSeats = seats.filter((entry) => entry.id !== "vp" && entry.id !== "pm");
  const selected = listedSeats.find((entry) => entry.id === seat) ?? seats.find((entry) => entry.id === seat);
  const groups = tierOrder
    .map((tier) => ({ tier, seats: listedSeats.filter((entry) => entry.tier === tier) }))
    .filter((group) => group.seats.length > 0);
  const other = listedSeats.filter((entry) => !tierOrder.includes(entry.tier));
  if (other.length > 0) groups.push({ tier: "other", seats: other });
  const dutyDirty = duty !== loadedDuty.current;
  const dutyNote = copied || (status === "Save this duty before opening another agent." ? "Save the duty first." : dutyDirty ? "Unsaved" : selected?.mode ?? "");
  const tierName: Record<string, string> = { head: "Heads", vp: "VPs", pm: "PMs", other: "Other" };
  const needle = query.trim().toLowerCase();
  const listed = groups
    .map((group) => ({
      ...group,
      seats: needle
        ? group.seats.filter((entry) => {
          const name = seatLabel(entry.id, entry.tier).toLowerCase();
          return name.includes(needle) || entry.id.toLowerCase().includes(needle);
        })
        : group.seats,
    }))
    .filter((group) => group.seats.length > 0);
  const visible = listed.flatMap((group) => (needle.length > 0 || !shut.has(group.tier) ? group.seats : []));
  const pointedId = needle ? visible[Math.min(point, Math.max(visible.length - 1, 0))]?.id ?? "" : "";
  const hadQuery = useRef(false);
  useEffect(() => {
    if (!pointedId) return;
    scrollRowIntoList(`[data-seat="${CSS.escape(pointedId)}"]`);
  }, [pointedId]);
  useEffect(() => {
    if (needle) {
      hadQuery.current = true;
      return;
    }
    if (!hadQuery.current || !seat) return;
    hadQuery.current = false;
    scrollRowIntoList(`[data-seat="${CSS.escape(seat)}"]`);
  }, [needle, seat]);

  return (
    <Page>
      {status ? <Note>{status}</Note> : null}
      <Fold title="Company folder" dirty={root.trim() !== savedRoot}>
        <p className="text-pretty text-sm text-muted-foreground">The folder that holds Agent Operations. Render writes the agents, then restarts OpenCode.</p>
        <Field label="Path">
          <TextField aria-label="Company root" value={root} onChange={(event) => setRoot(event.target.value)} placeholder="/path/to/company" spellCheck={false} autoCorrect="off" autoCapitalize="off" style={root.trim() !== savedRoot ? { borderBottomColor: accent } : undefined} />
        </Field>
        <div className={`flex flex-wrap gap-2 ${fieldControl}`}>
          <Quiet disabled={!root.trim() || root.trim() === savedRoot} onClick={() => {
            void rpc.call("setRoot", { root }).then((result) => {
              setSavedRoot(root.trim());
              setRoot(root.trim());
              setStatus(result.reason);
            }).catch((error: unknown) => setStatus(message(error)));
          }}>Save</Quiet>
          <Quiet onClick={() => {
            void rpc.call("renderThenRestart", null).then((result) => setStatus(result.reason)).catch((error: unknown) => setStatus(message(error)));
          }}>Render, then restart</Quiet>
        </div>
      </Fold>

      <div className="@container border-t border-border pt-4" style={{ borderTopColor: stroke }}>
      <div className="mb-2 flex h-8 w-full items-center pl-8 @[40rem]:w-[15rem] @[40rem]:pr-2">
        <h2 className="min-w-0 truncate text-sm font-medium">Boltrig Company Agents</h2>
        <span key={listed.reduce((sum, group) => sum + group.seats.length, 0)} className={`ml-auto shrink-0 text-xs tabular-nums text-muted-foreground ${live ? appear : ""}`}>{listed.reduce((sum, group) => sum + group.seats.length, 0)}</span>
      </div>
      <div className="grid items-start gap-6 @[40rem]:grid-cols-[15rem_minmax(0,1fr)] @[40rem]:gap-8">
        <div className="flex max-h-72 w-full min-w-0 flex-col gap-2 overflow-hidden @[40rem]:sticky @[40rem]:top-4 @[40rem]:max-h-96">
          <SearchField
            aria-label="Search agents"
            hint="/"
            placeholder="Agents"
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
                const step = listPage(`[data-seat="${CSS.escape(visible[0].id)}"]`);
                setPoint((current) => {
                  const last = visible.length - 1;
                  const next = event.key === "PageDown" ? current + step : current - step;
                  return Math.max(0, Math.min(last, next));
                });
              }
              if (event.key === "Enter" && pointedId) {
                event.preventDefault();
                event.stopPropagation();
                document.querySelector<HTMLButtonElement>(`[data-seat="${CSS.escape(pointedId)}"]`)?.click();
              }
            }}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-muted py-1" style={{ boxShadow: `0 0 0 1px ${stroke}` }}>
          <ScrollFade label="Agents">
          {groups.length === 0 ? <p className={`flex min-h-8 items-center pl-8 pr-2 text-sm text-muted-foreground ${appear}`}>No agents are installed yet.</p> : null}
          {listed.length === 0 && groups.length > 0 ? <p className={`flex min-h-8 items-center pl-8 pr-2 text-sm text-muted-foreground ${appear}`}>Nothing matches.</p> : null}
          {listed.map((group) => {
            const open = needle.length > 0 || !shut.has(group.tier);
            return (
            <div key={group.tier} className="pt-2 first:pt-0">
              <GroupHeading
                open={open}
                fade={live}
                count={group.seats.length}
                onToggle={() => setShut((current) => {
                  const next = new Set(current);
                  if (next.has(group.tier)) next.delete(group.tier);
                  else next.add(group.tier);
                  return next;
                })}
              ><Hit text={tierName[group.tier] ?? group.tier} query={query} /></GroupHeading>
              {open ? <div className={live ? `min-w-0 ${appear}` : "min-w-0"}>{group.seats.map((entry) => {
                const current = entry.id === seat;
                const name = seatLabel(entry.id, entry.tier);
                const nameHit = needle.length > 0 && name.toLowerCase().includes(needle);
                const idHit = needle.length > 0 && entry.id.toLowerCase().includes(needle) && !nameHit;
                return (
                  <Pick
                    key={entry.id}
                    current={current}
                    dirty={current && dutyDirty}
                    mark={<SeatMark id={entry.id} name={name} />}
                    pointed={entry.id === pointedId}
                    aside={idHit ? <span className="ml-2 min-w-0 max-w-[40%] truncate font-mono text-xs text-muted-foreground" onMouseEnter={(event) => { const node = event.currentTarget; node.title = node.scrollWidth > node.clientWidth + 1 ? entry.id : ""; }}><Hit text={entry.id} query={query} /></span> : null}
                    data-seat={entry.id}
                    onClick={() => {
                      if (entry.id === seat) return;
                      if (dutyDirty) {
                        setStatus("Save this duty before opening another agent.");
                        return;
                      }
                      setSeat(entry.id);
                    }}
                  >{<Hit text={name} query={query} />}</Pick>
                );
              })}</div> : null}
            </div>
            );
          })}
          </ScrollFade>
          </div>
        </div>

        <div className="@container min-w-0 @[40rem]:self-start">
          {selected ? (
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex h-8 min-w-0 items-center gap-2 border-b" style={{ borderBottomColor: stroke }}>
                  <SeatMark id={selected.id} name={seatLabel(selected.id, selected.tier)} />
                  <h2 key={selected.id} className={`min-w-0 truncate text-sm font-medium ${live ? appear : ""}`} onMouseEnter={(event) => { const node = event.currentTarget; node.title = node.scrollWidth > node.clientWidth + 1 ? (node.textContent ?? "") : ""; }}><Hit text={seatLabel(selected.id, selected.tier)} query={query} /></h2>
                  {dutyDirty ? (
                    <span className={`shrink-0 ${appear}`}>
                    <Primary onClick={() => {
                      const show = (text: string) => {
                        setCopied(text);
                        window.setTimeout(() => setCopied(""), 1200);
                      };
                      void rpc.call("saveDuty", { seat, body: duty }).then(() => {
                        loadedDuty.current = duty;
                        show("Saved");
                        setStatus(`Saved the duty for ${seat}.`);
                      }).catch((error: unknown) => {
                        show("Not saved");
                        setStatus(message(error));
                      });
                    }}>Save duty</Primary>
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-2 pl-6">
                <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <button
                    type="button"
                    aria-label="Copy seat id"
                    title="Copy"
                    className={`-mx-1 min-w-0 cursor-pointer truncate rounded-sm px-1 text-left font-mono font-medium text-foreground tabular-nums motion-safe:duration-150 motion-safe:transition-[color,background-color,border-color,box-shadow] ${focusRing}`}
                    onMouseEnter={(event) => { const node = event.currentTarget; node.title = node.scrollWidth > node.clientWidth + 1 ? (node.textContent ?? "") : "Copy"; paintTone(node, accent); }}
                    onMouseLeave={(event) => { if (event.currentTarget !== document.activeElement) paintTone(event.currentTarget, ""); }}
                    onFocus={(event) => { paintTone(event.currentTarget, accent); }}
                    onBlur={(event) => { paintTone(event.currentTarget, ""); }}
                    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}
                    onClick={() => {
                      const show = (text: string) => {
                        setCopied(text);
                        window.setTimeout(() => setCopied(""), 1200);
                      };
                      void navigator.clipboard.writeText(selected.id).then(() => show("Copied")).catch(() => show("Not copied"));
                    }}
                  ><span key={selected.id} className={live ? appear : ""}><Hit text={selected.id} query={query} /></span></button>
                  <span aria-hidden className="shrink-0 opacity-60">·</span>
                  <span className="shrink-0 whitespace-nowrap motion-safe:duration-150 motion-safe:transition-colors" style={copied === "Not saved" || copied === "Not copied" || (!copied && (dutyDirty || status === "Save this duty before opening another agent.")) ? { color: accent } : undefined}><span key={dutyNote} className={live ? appear : ""}>{dutyNote}</span></span>
                </p>
                {selected.reach.trim() ? <p className="min-w-0 whitespace-pre-wrap break-words text-pretty text-sm leading-6 text-muted-foreground">{selected.reach}</p> : null}
                <Area aria-label="Duty" boxed dirty={dutyDirty} className="max-w-xs" value={duty} onChange={(event) => setDuty(event.target.value)} placeholder="Add the duty." />
                {selected.permissions.trim() ? (
                  <Fold title="Permissions" compact rule={false} className="max-w-xs mt-4">
                    <Read resetKey={selected.id} className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-3 pt-3 pb-3 font-mono text-xs leading-5 text-foreground selection:bg-[#5E6AD2]/30 [tab-size:2]">{selected.permissions}</Read>
                  </Fold>
                ) : null}
                </div>
            </div>
          ) : <p className="text-pretty text-sm text-muted-foreground">Save the company folder, then render. The installed agents appear here.</p>}
        </div>
      </div>
      </div>

      <SopFiles />

      <Fold title="Ask for a seat">
        <p className="text-pretty text-sm text-muted-foreground">A head, VP, or PM the canon does not ship. Render records the request and does not install a profile.</p>
        <Field label="Base">
          <Choice aria-label="Requested base" value={requestBase} onChange={(event) => setRequestBase(event.target.value as "head" | "vp" | "pm")}>
            <option value="head">Head</option>
            <option value="vp">VP</option>
            <option value="pm">PM</option>
          </Choice>
        </Field>
        <Field label="Id">
          <TextField aria-label="Requested id" value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="vp-records" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
        </Field>
        <Field label="What they do">
          <Area aria-label="Request body" filled className="min-h-16" value={requestBody} onChange={(event) => setRequestBody(event.target.value)} placeholder="Add what they do." />
        </Field>
        <div className={fieldControl}>
        <Quiet disabled={!requestId.trim()} onClick={() => {
          void rpc.call("saveRequest", { base: requestBase, id: requestId, body: requestBody }).then(() => setStatus(`Recorded a request for ${requestId}.`)).catch((error: unknown) => setStatus(message(error)));
        }}>Record request</Quiet>
        </div>
      </Fold>
      <Fold title="Role">
        <p className="text-pretty text-sm text-muted-foreground">A subagent is installed on render. A primary is kept as a request.</p>
        <Field label="Id">
          <TextField aria-label="Role id" value={roleId} onChange={(event) => setRoleId(event.target.value)} placeholder="clerk" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
        </Field>
        <Field label="Base">
          <Choice aria-label="Role base" value={roleBase} onChange={(event) => setRoleBase(event.target.value as "subagent" | "primary")}>
            <option value="subagent">Subagent</option>
            <option value="primary">Primary</option>
          </Choice>
        </Field>
        <Field label="What they do">
          <Area aria-label="Role body" filled className="min-h-16" value={roleBody} onChange={(event) => setRoleBody(event.target.value)} placeholder="Add what they do." />
        </Field>
        <div className={fieldControl}>
        <Quiet disabled={!roleId.trim()} onClick={() => {
          void rpc.call("saveRole", { id: roleId, base: roleBase, body: roleBody }).then(() => setStatus(`Saved the role ${roleId}.`)).catch((error: unknown) => setStatus(message(error)));
        }}>Save role</Quiet>
        </div>
      </Fold>

      <Fold title="Doctrine">
        <Read className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words px-6 pt-6 pb-6 text-sm leading-6 text-foreground selection:bg-[#5E6AD2]/30 [tab-size:2]">{doctrine || "No doctrine file is installed."}</Read>
      </Fold>
    </Page>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "company",
    component: AgentEditorPage,
  });
  app.slots.experimental_threadList({
    id: "seats",
    title: "Boltrig Company Agents",
    description: "Heads, VPs, and PMs. A subagent stays off this list.",
    component: SeatSidebar,
  });
  app.slots.experimental_threadContextCardSection({
    id: "seat-threads",
    title: "Threads",
    group: "seat",
    component: SeatThreads,
  });
});
