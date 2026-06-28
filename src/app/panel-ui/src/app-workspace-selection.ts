import { postJson } from "./api";

export async function selectTaskWorkspaceDirectory(): Promise<string | undefined> {
  const response = await postJson<{
    readonly status?: "completed" | "cancelled";
    readonly workspaceDirectory?: string;
  }>("/api/context/workspace/select-directory", {});
  return response.status === "cancelled" ? undefined : response.workspaceDirectory;
}
