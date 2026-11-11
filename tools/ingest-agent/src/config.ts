import type { IngestRoot } from "./scan.js";

/** Parses `pillar=path;pillar=path;...` (semicolons separate entries; paths may contain `=` safely since split only happens on the first `=`). */
export function parseIngestRoots(value: string): IngestRoot[] {
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf("=");
      if (i === -1) throw new Error(`INGEST_ROOTS entry missing "pillar=": ${entry}`);
      return { pillar: entry.slice(0, i), path: entry.slice(i + 1) };
    });
}
