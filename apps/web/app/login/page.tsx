import { redirect } from "next/navigation";
import { Wordmark } from "../../components/ui/index.js";
import { getTheme } from "../../components/ui/theme-server.js";
import { getAuthStore, getOptionalSession } from "../../lib/auth/require.js";
import { PasskeyPanel } from "./PasskeyPanel.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · My Socials" };

/** Public sign-in (v3): no shell. A centred card: the wordmark, one line, one solid "Use passkey" button. */
export default async function LoginPage() {
  if (await getOptionalSession()) redirect("/");
  const hasCredentials = (await getAuthStore().listCredentials()).length > 0;
  const theme = await getTheme();

  return (
    <div className="ds-root flex min-h-dvh flex-col items-center justify-center px-4 py-10" data-theme={theme}>
      <main id="main" className="w-full max-w-[400px]">
        <div className="rounded-ds-lg border border-ds-line bg-ds-card p-6 lg:p-8">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <h1>
              <Wordmark size="lg" />
            </h1>
            <p className="text-[15px] text-ds-muted">Private dashboard. Sign in with your passkey.</p>
          </div>
          <PasskeyPanel hasCredentials={hasCredentials} />
        </div>
        <p className="mt-4 text-center text-[13px] text-ds-muted">No passwords are stored. There is no sign-up.</p>
      </main>
    </div>
  );
}
