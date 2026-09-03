import { rm } from "node:fs/promises";
import path from "node:path";

export default async function globalSetup(): Promise<void> {
  // Every e2e invocation must observe the same state as a fresh CI checkout:
  // the server seeds fixtures only when the candidates table is empty, so a
  // reused demo database (with stale approvals) would make the approval
  // flows unreplayable.
  await rm(path.join(process.cwd(), ".data"), {
    recursive: true,
    force: true,
  });
}
