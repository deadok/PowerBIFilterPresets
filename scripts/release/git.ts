import { spawn } from "node:child_process";

export type ExecFile = (
  args: string[]
) => Promise<{
  exitCode: number;
  stderr: string;
}>;

export async function isCommitReachableFromRef(input: {
  commitish: string;
  refName: string;
  execFile?: ExecFile;
}): Promise<boolean> {
  const execFile = input.execFile ?? defaultExecFile;
  const result = await execFile(["merge-base", "--is-ancestor", input.commitish, input.refName]);
  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1) {
    return false;
  }

  throw new Error(result.stderr || "git merge-base failed.");
}

const defaultExecFile: ExecFile = (args) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode: exitCode ?? 1, stderr: stderr.trim() });
    });
  });
