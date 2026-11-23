// Pure view logic for the Move dialog's "Next open slot" chips.
import { localDate, localHHMM } from "@autopilot/core";
import { slotText } from "./model.js";

export interface NextSlotLine {
  itemId: string;
  /** The move form's `item` value (batchId:itemId). */
  field: string;
  platform: string;
  /** ISO of the next open slot, or null when none within 7 days. */
  slot: string | null;
}

export interface NextSlotView {
  itemId: string;
  field: string;
  platform: string;
  /** "Tue 9:30 AM", or null. */
  text: string | null;
  /** Creator-local "YYYY-MM-DD" / "HH:MM" for the existing move form. */
  date: string | null;
  time: string | null;
}

export const NO_SLOT_TEXT = "No open slot in the next 7 days";

export function nextSlotView(line: NextSlotLine, timeZone: string): NextSlotView {
  if (!line.slot || !Number.isFinite(Date.parse(line.slot))) return { itemId: line.itemId, field: line.field, platform: line.platform, text: null, date: null, time: null };
  const d = new Date(line.slot);
  return { itemId: line.itemId, field: line.field, platform: line.platform, text: slotText(line.slot, timeZone), date: localDate(d, timeZone), time: localHHMM(d, timeZone) };
}
