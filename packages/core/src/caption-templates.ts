/**
 * F20 stream D: template captions for the daily Instagram top-up (apps/worker/src/jobs/daily-instagram.ts).
 * No AI: a small pool per pillar group, written in the voice of docs/voice.md (calm, dry, no greetings, no hype,
 * <= 1 emoji, no calls to action). Every line is generic on purpose: no place, no time, no whereabouts, no numbers,
 * no trading results. 2-4 lowercase hashtags each (Instagram allows <= 5). A unit test lints every template.
 */
export type CaptionGroup = "gym" | "running" | "meal" | "lifestyle";
export const CAPTION_GROUPS: readonly CaptionGroup[] = ["gym", "running", "meal", "lifestyle"];

const T = (text: string, tags: string): string => `${text}\n\n${tags}`;

export const CAPTION_TEMPLATES: Record<CaptionGroup, readonly string[]> = {
  gym: [
    T("Quiet session, good reps, no complaints.", "#gym #gymbro #hypertrophy"),
    T("Just stacking days is all 🙂‍↕️…", "#gym #discipline #gymbro"),
    T("Nothing fancy today, just the work…", "#physique #gym #gymbro"),
    T("Most people don't need a new program. They need better reps.", "#gym #hypertrophy #discipline"),
    T("Not my best session, but it counts…", "#gym #discipline"),
    T("Slow reps, honest weight, onto the next one.", "#hypertrophy #gym #gymbro"),
    T("Some days the warm-up is the hardest set…", "#gym #collegefitness #discipline"),
    T("Same plan as last week, just a little heavier…", "#gym #hypertrophy #discipline"),
    T("Pump was fine, ego was not…", "#gym #gymbro #physique"),
    T("Still showing up, that's the whole trick…", "#discipline #gym #collegefitness"),
    T("Form first, the weight can catch up later.", "#hypertrophy #gym #physique"),
    T("Another set, another reminder to rest properly…", "#gym #gymbro #physicaltherapy"),
  ],
  running: [
    T("Got absolutely wrecked by blisters on both feet post run 😔", "#running #discipline #collegefitness"),
    T("Easy pace today, and it still felt hard…", "#running #discipline"),
    T("Not fast, just consistent…", "#running #collegefitness #discipline"),
    T("The run was fine, the legs disagree…", "#running #gym #discipline"),
    T("Went out slower than planned and I'm okay with that.", "#running #collegefitness"),
    T("Cardio is a lot less fun than lifting, but it keeps showing up on the plan…", "#running #gym #discipline"),
    T("One more easy run in the books…", "#running #discipline #collegefitness"),
    T("Legs felt heavy, finished anyway…", "#running #discipline"),
  ],
  meal: [
    T("Keeping it simple, high protein, and consistent.", "#mealprep #highproteinmeals #collegefitness"),
    T("Another day of eating while balancing college, training, and everything in between.", "#fulldayofeating #collegefitness #mealprep"),
    T("Nothing fancy, just food that keeps the week easy…", "#mealprep #highproteinmeals"),
    T("Prep once, eat the same thing all week, call it discipline…", "#mealprep #discipline #highproteinmeals"),
    T("Protein first, everything else second.", "#highproteinmeals #fulldayofeating #mealprep"),
    T("Simple meals are the only ones I actually stick to…", "#mealprep #collegefitness #highproteinmeals"),
    T("Not pretty, but it hits the numbers…", "#fulldayofeating #highproteinmeals"),
    T("Same rotation as always, and it works…", "#mealprep #discipline #fulldayofeating"),
  ],
  lifestyle: [
    T("Another day balancing college, lifting, and everything in between.", "#collegefitness #discipline #gym"),
    T("Just documenting the process, including the slow days…", "#discipline #collegefitness"),
    T("Quiet day, steady work…", "#discipline #collegefitness #gym"),
    T("Not every day is a highlight reel, and that's fine.", "#discipline #collegefitness"),
    T("Small habits, repeated. That's most of it…", "#discipline #gym #collegefitness"),
    T("Oh well, onto the next one.", "#discipline #collegefitness"),
    T("Trying to keep the routine boring on purpose…", "#discipline #gym #collegefitness"),
    T("Some days are for progress, some are for just showing up…", "#discipline #collegefitness #gym"),
    T("Lately it's mostly lifting, studying, and sleeping…", "#collegefitness #gym #discipline"),
  ],
};

/** Library pillar (sidecar or research vocabulary, or null) → caption pool. Unknown or missing → lifestyle. */
export function captionGroupFor(pillar: string | null | undefined): CaptionGroup {
  switch (pillar) {
    case "workout-log":
    case "single-set":
    case "physique":
    case "gym":
      return "gym";
    case "running":
      return "running";
    case "meal":
      return "meal";
    default:
      return "lifestyle";
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * Deterministic: the same (pillar, seed) with the same `avoid` always gives the same caption. Skips any template in
 * `avoid` (exact caption text, e.g. used in the last 14 days); when every one was used, the least-bad choice is the
 * full pool.
 */
export function pickCaptionTemplate(pillar: string | null | undefined, seed: string, avoid: Iterable<string> = []): string {
  const pool = CAPTION_TEMPLATES[captionGroupFor(pillar)];
  const used = new Set(avoid);
  const fresh = pool.filter((t) => !used.has(t));
  const from = fresh.length > 0 ? fresh : pool;
  return from[hash(seed) % from.length]!;
}
