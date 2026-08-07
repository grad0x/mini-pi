import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function assertInside(root: string, candidate: string): void {
  if (!isInside(root, candidate)) {
    throw new Error("Path is outside the workspace");
  }
}

/** Resolves an untrusted relative path without allowing lexical workspace escape. */
export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): string {
  if (requestedPath.length === 0) {
    throw new Error("Path must not be empty");
  }
  if (isAbsolute(requestedPath)) {
    throw new Error("Absolute paths are not allowed");
  }

  const root = resolve(workspaceRoot);
  const candidate = resolve(root, requestedPath);
  assertInside(root, candidate);
  return candidate;
}

export async function resolveExistingWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const candidate = resolveWorkspacePath(workspaceRoot, requestedPath);
  const [realRoot, realCandidate] = await Promise.all([
    realpath(workspaceRoot),
    realpath(candidate),
  ]);
  assertInside(realRoot, realCandidate);
  return realCandidate;
}

/** Checks existing ancestors and rejects symlink file targets before a write. */
export async function resolveWorkspaceWritePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const candidate = resolveWorkspacePath(workspaceRoot, requestedPath);
  const realRoot = await realpath(workspaceRoot);

  try {
    const targetStats = await lstat(candidate);
    if (targetStats.isSymbolicLink()) {
      throw new Error("Writing through a symbolic link is not allowed");
    }
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }

  let ancestor = dirname(candidate);
  while (true) {
    try {
      const realAncestor = await realpath(ancestor);
      assertInside(realRoot, realAncestor);
      return candidate;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new Error("No writable ancestor exists inside the workspace");
      }
      ancestor = parent;
    }
  }
}
