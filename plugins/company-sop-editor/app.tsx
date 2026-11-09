import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { companySopRpc } from "./server.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function CompanySopPage(_props: PluginNavPanelProps) {
  const rpc = useRpc<typeof companySopRpc>();
  const [root, setRoot] = useState("");
  const [files, setFiles] = useState<Array<{ path: string; title: string }>>([]);
  const [selected, setSelected] = useState("Instructions/firm.md");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [request, setRequest] = useState({ id: "", rule: "", reason: "", layer: "permission", gap: "none", owner: "head-agent-ops" });

  const load = useCallback(async (relative: string) => {
    const listed = await rpc.call("files", null);
    setFiles(listed.files);
    const file = await rpc.call("readFile", { path: relative });
    setBody(file.body);
  }, [rpc]);

  useEffect(() => {
    void rpc.call("getRoot", null).then(async (result) => {
      if (!result.root) return;
      setRoot(result.root);
      await load(selected);
    }).catch((error: unknown) => setStatus(message(error)));
  }, [load, rpc, selected]);

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Company root</h2>
        <input aria-label="Company root" className="rounded border px-2 py-1" value={root} onChange={(event) => setRoot(event.target.value)} />
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("setRoot", { root }).then((result) => load(selected).then(() => setStatus(result.reason))).catch((error: unknown) => setStatus(message(error)));
        }}>Save root</button>
      </section>
      <section className="flex flex-col gap-2">
        <select aria-label="SOP file" value={selected} onChange={(event) => {
          const relative = event.target.value;
          setSelected(relative);
          void load(relative).catch((error: unknown) => setStatus(message(error)));
        }}>
          {files.map((file) => <option key={file.path} value={file.path}>{file.title}</option>)}
        </select>
        <textarea aria-label="SOP file body" className="min-h-64 rounded border p-2" value={body} onChange={(event) => setBody(event.target.value)} />
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("saveFile", { path: selected, body }).then(() => setStatus(`Saved ${selected}.`)).catch((error: unknown) => setStatus(message(error)));
        }}>Save</button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Permission request</h2>
        <p className="text-muted-foreground">A change that needs a permission becomes a register row. It does not edit a permission header.</p>
        <input aria-label="Permission id" className="rounded border px-2 py-1" value={request.id} onChange={(event) => setRequest({ ...request, id: event.target.value })} />
        <input aria-label="Permission rule" className="rounded border px-2 py-1" value={request.rule} onChange={(event) => setRequest({ ...request, rule: event.target.value })} />
        <button type="button" className="self-start rounded border px-3 py-1" onClick={() => {
          void rpc.call("addPermission", request).then(() => setStatus("Added a policy register row.")).catch((error: unknown) => setStatus(message(error)));
        }}>Add register row</button>
      </section>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "company-sop-editor",
    title: "Company SOP Editor",
    icon: "FileText",
    path: "company-sop-editor",
    component: CompanySopPage,
  });
});
