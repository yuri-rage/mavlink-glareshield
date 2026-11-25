export interface BuildInfo {
  id: string;
  sha: string | null;
  date: string | null;
  dirty: boolean;
}
export function describeBuild(parts: { sha: string | null | undefined; date: string | null | undefined; dirty?: boolean; now?: Date }): BuildInfo;
export function readBuildInfo(env?: Record<string, string | undefined>): BuildInfo;
