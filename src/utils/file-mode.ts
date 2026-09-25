import { promises as fs } from "node:fs";

/**
 * Customization #7 — write a secret-bearing file with mode 0o600, defended
 * against a permissive umask.
 *
 * `fs.writeFile(path, data, { mode: 0o600 })` only applies the mode as a
 * default — the process umask still masks it on platforms that honour it
 * strictly. We write with mode 0o600 and then `chmod 0o600` so the on-disk
 * mode cannot be widened even when the parent process runs with `umask 0`.
 */
const SECRET_FILE_MODE = 0o600;

export async function writeSecretFile(path: string, data: string): Promise<void> {
  // open() applies 0o600 subject to the umask; chmod() afterwards forces
  // the bits back to exactly 0o600. This is the only way to defeat a
  // umask that would otherwise strip the group/world-readable bits.
  const handle = await fs.open(path, "w", SECRET_FILE_MODE);
  try {
    await handle.writeFile(data, "utf8");
  } finally {
    await handle.close();
  }
  await fs.chmod(path, SECRET_FILE_MODE);
}

export { SECRET_FILE_MODE };
