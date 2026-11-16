import type { Pillar } from "../types.js";
import { classifyPattern, type AutoPattern } from "./patterns.js";

/**
 * Parses docs/content/week-2026-11-16/yap-scripts.md (format: `## #N · [Spare · ]Lane[: title]`, then
 * `- **Hook:**`, `- **Alt hook:**`, `- **Anchor:** … <url> · **status**`, `- **Close:**`, optional
 * `- **Note:**`, and the script between `<!-- script -->` and `<!-- /script -->`). The scripts are his,
 * so `adapt` stays empty. Placeholders like {{N}} are kept: they are his to fill in (lint flags them).
 */

export interface YapIdea {
  sourceKey: string;
  number: number;
  title: string;
  lane: string;
  pillar: Pillar;
  hook: string;
  script: string;
  about: string;
  referenceUrl: string | null;
  spare: boolean;
}
export interface YapHook {
  sourceKey: string;
  text: string;
  pillar: Pillar;
  pattern: AutoPattern;
}
export interface YapData {
  prefix: string;
  ideas: YapIdea[];
  hooks: YapHook[];
}

export function laneToPillar(lane: string): Pillar {
  if (/trading|process\s*>\s*results/i.test(lane)) return "trading";
  if (/\bgym\b|lift/i.test(lane)) return "gym";
  return "lifestyle";
}

const field = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(String.raw`^- \*\*${name}:\*\*\s*(.+)$`, "m"));
  return m ? m[1]!.trim() : null;
};
const plain = (s: string) => s.replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/\s+/g, " ").trim();

export function parseYapScripts(markdown: string, prefix = "yap-2026-11-16"): YapData {
  const ideas: YapIdea[] = [];
  const hooks: YapHook[] = [];
  const sections = markdown.split(/^(?=## )/m);
  for (const sec of sections) {
    const head = sec.match(/^## #(\d+)\s*·\s*(.+)$/m);
    if (!head) continue;
    const number = Number(head[1]);
    let heading = head[2]!.trim();
    const spare = /^Spare\s*·\s*/i.test(heading);
    heading = heading.replace(/^Spare\s*·\s*/i, "");
    const lane = heading.includes(":") ? heading.split(":")[0]!.trim() : heading;
    const pillar = laneToPillar(heading);
    const hook = plain(field(sec, "Hook") ?? "");
    const alt = field(sec, "Alt hook");
    const anchorRaw = field(sec, "Anchor") ?? "";
    const url = anchorRaw.match(/https?:\/\/\S+/)?.[0]?.replace(/[)·.,]+$/, "") ?? null;
    const about = plain(anchorRaw.split(/\s+https?:\/\//)[0]!.replace(/\s*·\s*\*\*.*$/, ""));
    const note = field(sec, "Note");
    const script = sec.match(/<!-- script -->\s*([\s\S]*?)\s*<!-- \/script -->/)?.[1]?.trim() ?? "";
    if (!hook || !script) continue;
    const sourceKey = `${prefix}-#${number}`;
    ideas.push({
      sourceKey,
      number,
      title: `Yap #${number} · ${heading}`.slice(0, 140),
      lane,
      pillar,
      hook,
      script,
      about: note ? `${about} Note: ${plain(note)}` : about,
      referenceUrl: url,
      spare,
    });
    if (alt) {
      const text = plain(alt);
      hooks.push({ sourceKey: `${sourceKey}-alt`, text, pillar, pattern: classifyPattern(text) });
    }
  }
  return { prefix, ideas, hooks };
}
