import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { agentEditorRpc } from "./server.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function AgentEditorPage(_props: PluginNavPanelProps) {
  const rpc = useRpc<typeof agentEditorRpc>();
  const [root, setRoot] = useState("");
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

  const loadSeats = useCallback(async () => {
    const listed = await rpc.call("seats", null);
    setDoctrine(listed.doctrine);
    setSeats(listed.seats);
    setSeat((current) => current || listed.seats[0]?.id || "");
  }, [rpc]);

  useEffect(() => {
    void rpc.call("getRoot", null).then((result) => {
      if (result.root) setRoot(result.root);
    }).catch((error: unknown) => setStatus(message(error)));
    void loadSeats().catch((error: unknown) => setStatus(message(error)));
  }, [loadSeats, rpc]);

  const selected = seats.find((entry) => entry.id === seat);

  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Company root</h2>
        <p className="text-muted-foreground">The folder that holds Agent Operations. It may be the copy on this server, or a SharePoint or Box folder that rsync keeps in step. Seats are not mapped here.</p>
        <input className="rounded border px-2 py-1" value={root} onChange={(event) => setRoot(event.target.value)} aria-label="Company root" />
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("setRoot", { root }).then((result) => setStatus(result.reason)).catch((error: unknown) => setStatus(message(error)));
        }}>Save root</button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Installed canon seat</h2>
        <select aria-label="Canon seat" value={seat} onChange={(event) => setSeat(event.target.value)}>
          {seats.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
        </select>
        {selected ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-1">
            <dt>Mode</dt><dd>{selected.mode}</dd>
            <dt>Tier</dt><dd>{selected.tier}</dd>
            <dt>Rank</dt><dd>{selected.rank}</dd>
            <dt>Permissions</dt><dd><pre className="whitespace-pre-wrap">{selected.permissions}</pre></dd>
            <dt>Reach</dt><dd><pre className="whitespace-pre-wrap">{selected.reach}</pre></dd>
          </dl>
        ) : <p>No canon seats are installed in the OpenCode config.</p>}
        <label className="flex flex-col gap-1">Duty
          <textarea className="min-h-32 rounded border p-2" value={duty} onChange={(event) => setDuty(event.target.value)} />
        </label>
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("saveDuty", { seat, body: duty }).then(() => setStatus(`Saved the duty for ${seat}.`)).catch((error: unknown) => setStatus(message(error)));
        }}>Save duty</button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Request a seat the canon does not have</h2>
        <select aria-label="Requested base" value={requestBase} onChange={(event) => setRequestBase(event.target.value as "head" | "vp" | "pm")}>
          <option value="head">head</option>
          <option value="vp">vp</option>
          <option value="pm">pm</option>
        </select>
        <input aria-label="Requested id" className="rounded border px-2 py-1" value={requestId} onChange={(event) => setRequestId(event.target.value)} />
        <textarea aria-label="Request body" className="min-h-24 rounded border p-2" value={requestBody} onChange={(event) => setRequestBody(event.target.value)} />
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("saveRequest", { base: requestBase, id: requestId, body: requestBody }).then(() => setStatus(`Recorded a request for ${requestId}.`)).catch((error: unknown) => setStatus(message(error)));
        }}>Record request</button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Role</h2>
        <input aria-label="Role id" className="rounded border px-2 py-1" value={roleId} onChange={(event) => setRoleId(event.target.value)} />
        <select aria-label="Role base" value={roleBase} onChange={(event) => setRoleBase(event.target.value as "subagent" | "primary")}>
          <option value="subagent">subagent</option>
          <option value="primary">primary</option>
        </select>
        <textarea aria-label="Role body" className="min-h-24 rounded border p-2" value={roleBody} onChange={(event) => setRoleBody(event.target.value)} />
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("saveRole", { id: roleId, base: roleBase, body: roleBody }).then(() => setStatus(`Saved the role ${roleId}.`)).catch((error: unknown) => setStatus(message(error)));
        }}>Save role</button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Doctrine</h2>
        <pre className="whitespace-pre-wrap text-muted-foreground">{doctrine || "No doctrine file is installed."}</pre>
      </section>
      <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
        void rpc.call("renderThenRestart", null).then((result) => setStatus(result.reason)).catch((error: unknown) => setStatus(message(error)));
      }}>Render, then restart</button>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "agent-editor",
    title: "Agent Editor",
    icon: "FolderOpen",
    path: "agent-editor",
    component: AgentEditorPage,
  });
});
