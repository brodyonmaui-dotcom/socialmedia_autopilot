import { redirect } from "next/navigation";
import { getAuthStore, getOptionalSession } from "../../lib/auth/require.js";
import { PasskeyPanel } from "./PasskeyPanel.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getOptionalSession()) redirect("/batches");
  const hasCredentials = (await getAuthStore().listCredentials()).length > 0;

  return (
    <main className="mx-auto max-w-sm p-4 pt-12">
      <h1 className="text-2xl font-semibold">runmysocials</h1>
      <p className="mt-1 text-sm text-neutral-500">Private dashboard. Passkey only.</p>
      <PasskeyPanel hasCredentials={hasCredentials} />
    </main>
  );
}
