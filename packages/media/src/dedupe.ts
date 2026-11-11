export interface HashedFile {
  path: string;
  hash: string;
  size: number;
}

export interface DuplicateSet {
  hash: string;
  files: HashedFile[];
}

/** Groups already-hashed files by content hash, returning only the sets with more than one copy. */
export function findDuplicateSets(files: HashedFile[]): DuplicateSet[] {
  const byHash = new Map<string, HashedFile[]>();
  for (const f of files) {
    const group = byHash.get(f.hash);
    if (group) group.push(f);
    else byHash.set(f.hash, [f]);
  }
  return [...byHash.entries()].filter(([, group]) => group.length > 1).map(([hash, group]) => ({ hash, files: group }));
}
