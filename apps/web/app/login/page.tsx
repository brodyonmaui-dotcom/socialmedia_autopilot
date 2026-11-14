import { redirect } from "next/navigation";
import { CONTAINER, Display, GridLines, Logo, NoiseOverlay, StatusPulse, ThemeToggle, cx } from "../../components/ui/index.js";
import { getTheme } from "../../components/ui/theme-server.js";
import { getAuthStore, getOptionalSession } from "../../lib/auth/require.js";
import { PasskeyPanel } from "./PasskeyPanel.js";

export const dynamic = "force-dynamic";

/** Public sign-in: no AppFrame / tab bar (nobody is signed in yet). Same ds-root, grid and noise as the app. */
export default async function LoginPage() {
  if (await getOptionalSession()) redirect("/batches");
  const hasCredentials = (await getAuthStore().listCredentials()).length > 0;
  const theme = await getTheme();

  return (
    <div className="ds-root relative flex min-h-dvh flex-col overflow-x-clip" data-theme={theme}>
      <NoiseOverlay />
      <GridLines />

      <header className="relative z-10 h-[var(--ds-header-h)] border-b border-ds-line bg-ds-bg/80 backdrop-blur-[10px]">
        <div className={cx(CONTAINER, "relative flex h-full items-center justify-between")}>
          <ThemeToggle initial={theme} />
          <span className="absolute left-1/2 flex -translate-x-1/2 items-baseline gap-0.5 text-ds-text">
            <Logo brand={{ serif: "run", sans: "MYSOCIALS" }} />
          </span>
          <StatusPulse label="Private" tone="accent" className="text-ds-muted" />
        </div>
      </header>

      <main id="main" className="relative z-10 flex-1">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 border-b border-ds-line pb-10 pt-16 text-center lg:col-span-6 lg:col-start-4 lg:pb-14 lg:pt-24">
            <p className="ds-caps text-ds-muted">Single-creator dashboard</p>
            <Display lines={[{ text: "Sign" }, { text: "in", style: "serif" }]} className="mt-6" />
            <p className="mx-auto mt-8 max-w-[36ch] text-balance text-[15px] leading-snug text-ds-muted">
              Private dashboard. Passkey only. No sign-up.
            </p>
          </div>

          <div className="col-span-4 lg:col-span-6 lg:col-start-4">
            <PasskeyPanel hasCredentials={hasCredentials} />
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-ds-line">
        <div className={cx(CONTAINER, "flex min-h-14 items-center justify-between gap-4")}>
          <span className="ds-mono text-ds-faint">WEBAUTHN · NO PASSWORDS STORED</span>
          <span className="ds-caps text-ds-faint">Not public</span>
        </div>
      </footer>
    </div>
  );
}
