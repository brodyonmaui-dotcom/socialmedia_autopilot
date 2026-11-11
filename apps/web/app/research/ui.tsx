import Link from "next/link";
import { PILLARS } from "@autopilot/research";

export const input =
  "w-full rounded border border-neutral-300 bg-white px-2 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900";
export const button = "rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900";
export const smallButton = "rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700";

const TABS = [
  ["/research", "overview"],
  ["/research/ideas", "ideas"],
  ["/research/hooks", "hooks"],
  ["/research/creators", "creators"],
] as const;

export function ResearchHeader({ title, current }: { title: string; current: string }) {
  return (
    <header>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <nav className="mt-2 flex gap-4 text-sm">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className={href === current ? "font-semibold underline" : "text-neutral-500 underline"}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function ErrorBanner({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {error}
    </p>
  );
}

export function PillarSelect({ name = "pillar", defaultValue = "" }: { name?: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} className={input} aria-label="pillar">
      <option value="">pillar…</option>
      {PILLARS.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function errorFrom(searchParams: SearchParams): Promise<string | undefined> {
  const e = (await searchParams).error;
  return typeof e === "string" ? e.slice(0, 200) : undefined;
}
