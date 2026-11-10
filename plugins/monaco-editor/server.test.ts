import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const source = {
  kind: "thread-storage",
  threadId: "thread-editor-test",
  environmentId: "environment-editor-test",
  projectId: null,
};
const storageRootPath = "/remote-storage/thread-editor-test";
const hostId = "remote-editor-host";

async function setup(root = storageRootPath) {
  const storageLocation = vi.fn(() => ({ hostId, storageRootPath: root }));
  const read = vi.fn(() => ({
    content: "saved text",
    contentEncoding: "utf8",
    sizeBytes: 10,
    sha256: "original",
  }));
  const listPaths = vi.fn(() => ({
    paths: [{ path: "notes/document.txt", kind: "file" }],
    truncated: false,
  }));
  const write = vi.fn(() => ({ outcome: "written", sha256: "updated" }));
  const { bb, harness } = createFakePluginHost({
    pluginId: "monaco-editor",
    sdk: {
      system: { config: () => ({ dataDir: "/server-data" }) },
      threads: { storageLocation },
      files: { read, listPaths, write },
    },
  });
  await plugin(bb);
  return { harness, storageLocation, read, listPaths, write };
}

describe("host files without an environment", () => {
  it("reads an absolute path on the named host", async () => {
    const { harness, read } = await setup();
    const filePath = "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP/package.json";
    const result = await harness.callRpc("read", {
      source: {
        kind: "host",
        threadId: null,
        environmentId: null,
        projectId: null,
        experimental_hostId: "local-host",
      },
      path: filePath,
    });
    expect(read).toHaveBeenCalledWith({
      hostId: "local-host",
      rootPath: "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP",
      path: filePath,
    });
    expect(result).toMatchObject({ kind: "text", content: "saved text" });
  });
});

describe("host file tree", () => {
  it("lists the folder that contains the open file", async () => {
    const { harness, listPaths } = await setup();
    const filePath =
      "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP/install.mjs";
    const result = await harness.callRpc("tree", {
      source: {
        kind: "host",
        threadId: null,
        environmentId: null,
        projectId: null,
        experimental_hostId: "local-host",
      },
      path: filePath,
    });
    expect(listPaths).toHaveBeenCalledWith({
      hostId: "local-host",
      path: "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP",
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      limit: 10_000,
    });
    expect(result).toMatchObject({
      root: "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP",
    });
  });

  it("lists a project checkout when the open path is relative", async () => {
    const listPaths = vi.fn(() => ({
      paths: [{ path: "install.mjs", kind: "file" }],
      truncated: false,
    }));
    const projects = {
      get: vi.fn(() => ({
        sources: [
          {
            path: "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP",
            hostId: "local-host",
            isDefault: true,
          },
        ],
      })),
    };
    const { bb, harness } = createFakePluginHost({
      pluginId: "monaco-editor",
      sdk: {
        system: { config: () => ({ dataDir: "/server-data" }) },
        threads: { storageLocation: vi.fn() },
        files: {
          read: vi.fn(),
          listPaths,
          write: vi.fn(),
        },
        projects,
      },
    });
    await plugin(bb);
    const result = await harness.callRpc("tree", {
      source: {
        kind: "host",
        threadId: null,
        environmentId: null,
        projectId: "project-sop",
        experimental_hostId: "local-host",
      },
      path: "install.mjs",
    });
    expect(projects.get).toHaveBeenCalledWith({ projectId: "project-sop" });
    expect(listPaths).toHaveBeenCalledWith({
      hostId: "local-host",
      path: "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP",
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      limit: 10_000,
    });
    expect(result).toMatchObject({
      root: "/Users/williamlilley/Projects/Boltrig/boltrig-opencode-company-SOP",
    });
  });
});

describe("thread storage host routing", () => {
  it("reads from the thread's storage host and root", async () => {
    const { harness, read, storageLocation } = await setup();
    const result = await harness.callRpc("read", {
      source,
      path: "notes/document.txt",
    });
    expect(read).toHaveBeenCalledWith({
      hostId,
      rootPath: storageRootPath,
      path: `${storageRootPath}/notes/document.txt`,
    });
    expect(storageLocation).toHaveBeenCalledWith({ threadId: source.threadId });
    expect(result).toMatchObject({
      kind: "text",
      content: "saved text",
      absolutePath: `${storageRootPath}/notes/document.txt`,
      relativePath: "notes/document.txt",
    });
  });

  it.each([
    [
      "//server/share/storage",
      "\\\\server\\share\\storage\\notes\\document.txt",
    ],
    ["C:", "C:\\notes\\document.txt"],
  ])("reads and names files under %s", async (root, expected) => {
    const { harness, read } = await setup(root);
    try {
      expect(
        await harness.callRpc("read", { source, path: "notes/document.txt" }),
      ).toMatchObject({
        absolutePath: expected,
        relativePath: "notes/document.txt",
      });
      expect(read).toHaveBeenCalledWith({
        hostId,
        rootPath: root,
        path: expected,
      });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("lists the thread's storage host and root", async () => {
    const { harness, listPaths } = await setup();
    const result = await harness.callRpc("tree", { source });
    expect(listPaths).toHaveBeenCalledWith({
      hostId,
      path: storageRootPath,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      limit: 10_000,
    });
    expect(result).toEqual({
      root: storageRootPath,
      entries: [{ path: "notes/document.txt", kind: "file" }],
      truncated: false,
    });
  });

  it("saves to the thread's storage host with the expected version", async () => {
    const { harness, write } = await setup();
    const result = await harness.callRpc("write", {
      source,
      path: "notes/document.txt",
      content: "edited text",
      expectedSha256: "original",
    });
    expect(write).toHaveBeenCalledWith({
      hostId,
      rootPath: storageRootPath,
      path: `${storageRootPath}/notes/document.txt`,
      content: "edited text",
      contentEncoding: "utf8",
      expectedSha256: "original",
    });
    expect(result).toEqual({ outcome: "written", sha256: "updated" });
  });
});
