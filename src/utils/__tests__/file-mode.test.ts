import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SECRET_FILE_MODE, writeSecretFile } from "../file-mode.js";

// The global test setup replaces fs.promises.readFile/writeFile/unlink/
// access with bare vi.fn() spies. Restore the real module so this file's
// assertions hit the actual filesystem.
vi.mock("node:fs", async (importOriginal) => importOriginal());

const TMP_ROOT = join(tmpdir(), "teams-mcp-file-mode-test");

let caseDir: string;

beforeEach(async () => {
  caseDir = join(TMP_ROOT, `case-${Math.random().toString(36).slice(2, 10)}`);
  await fs.mkdir(caseDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(caseDir, { recursive: true, force: true });
});

describe("writeSecretFile (customization #7 — 0o600 mode, umask-respecting)", () => {
  it("writes the file contents verbatim", async () => {
    const path = join(caseDir, "auth.json");
    await writeSecretFile(path, '{"clientId":"abc"}');
    const readBack = await fs.readFile(path, "utf8");
    expect(readBack).toBe('{"clientId":"abc"}');
  });

  it("creates the file with mode 0o600 under the default umask", async () => {
    const path = join(caseDir, "auth-default-umask.json");
    await writeSecretFile(path, "{}");
    const stat = await fs.stat(path);
    expect(stat.mode & 0o777).toBe(SECRET_FILE_MODE);
  });

  it("overwrites an existing wider-mode file at 0o600", async () => {
    const path = join(caseDir, "auth-overwrite.json");
    await fs.writeFile(path, "stale", { mode: 0o644 });
    const before = await fs.stat(path);
    expect(before.mode & 0o644).toBe(0o644);

    await writeSecretFile(path, "fresh");

    const after = await fs.stat(path);
    expect(after.mode & 0o777).toBe(SECRET_FILE_MODE);
    const readBack = await fs.readFile(path, "utf8");
    expect(readBack).toBe("fresh");
  });

  it("calls fs.open with mode 0o600 and fs.chmod with 0o600", async () => {
    const openSpy = vi.spyOn(fs, "open");
    const chmodSpy = vi.spyOn(fs, "chmod");

    const path = join(caseDir, "auth-spy.json");
    await writeSecretFile(path, "{}");

    const openCall = openSpy.mock.calls.find(([target]) => target === path);
    expect(openCall).toBeDefined();
    expect(openCall?.[1]).toBe("w");
    expect(openCall?.[2]).toBe(SECRET_FILE_MODE);

    const chmodCall = chmodSpy.mock.calls.find(([target]) => target === path);
    expect(chmodCall).toBeDefined();
    expect(chmodCall?.[1]).toBe(SECRET_FILE_MODE);

    openSpy.mockRestore();
    chmodSpy.mockRestore();
  });
});
