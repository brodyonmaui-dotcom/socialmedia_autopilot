/** The F24 EDL types come from the worker's own module (import-free, safe in the browser); the rest is editor vocabulary. */
import type { Edl as WorkerEdl, EdlSpeed, EdlText } from "@autopilot/media/src/edl.js";
export { TEXT_COLORS, textLayout } from "@autopilot/media/src/edl.js";
export type { EdlText, TextLayout } from "@autopilot/media/src/edl.js";
export type Edl = WorkerEdl;
export type Speed = EdlSpeed;
export const SPEEDS: Speed[] = [0.5, 0.75, 1, 1.25, 1.5, 2];
export type TextPosition = EdlText["position"];
export type TextStyle = EdlText["style"];
export type TextLook = NonNullable<EdlText["bg"]>;
export type TextAlign = NonNullable<EdlText["align"]>;
