/** Fractal-noise SVG tile (160×160), inline so there is no network request. */
const NOISE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/></filter>" +
  "<rect width='160' height='160' filter='url(#n)'/></svg>";

export const NOISE_DATA_URI = `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;

/** Subtle film grain over everything (4% opacity, non-interactive, decorative). */
export function NoiseOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] opacity-[0.04]"
      style={{ backgroundImage: NOISE_DATA_URI, backgroundSize: "160px 160px" }}
    />
  );
}
