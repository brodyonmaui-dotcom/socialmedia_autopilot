import Link from "next/link";
import { CAPABILITIES } from "@autopilot/core";

export default function DashboardPage() {
  const platforms = Object.entries(CAPABILITIES);

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-semibold">autopilot</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Dashboard skeleton — login, weekly batch and approval UI land later in M1/M2.
      </p>
      <div className="mt-3 flex gap-4 text-sm">
        <Link href="/library" className="underline">
          library
        </Link>
        <Link href="/touch-up" className="underline">
          touch-up queue
        </Link>
      </div>
      <ul className="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {platforms.map(([platform, cap]) => (
          <li key={platform} className="flex items-center justify-between p-3 text-sm">
            <span className="font-medium capitalize">{platform}</span>
            <span className="text-neutral-500">{cap.route}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
