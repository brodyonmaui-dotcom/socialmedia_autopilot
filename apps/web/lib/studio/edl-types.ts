/** The F24 EDL types come from the worker's own module (import-free, safe in the browser); the rest is editor vocabulary. */
import type { Edl as WorkerEdl, EdlSpeed } from "@autopilot/media/src/edl.js";
export type Edl = WorkerEdl;
export type Speed = EdlSpeed;
export const SPEEDS: Speed[] = [0.5, 0.75, 1, 1.25, 1.5, 2];
export type TextPosition = "top" | "center" | "bottom";
export type TextStyle = "bold" | "plain";
