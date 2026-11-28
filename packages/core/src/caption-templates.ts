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
 * Deterministic: the same (pillar, seed) with the same `avoid` always gives the same caption. Never returns a template
 * in `avoid` (exact caption text, e.g. used in the last 14 days): when every one was used it returns null and the
 * caller leaves the caption empty ("needs a caption"). Two posts sharing a caption would let an existence check match
 * the wrong post (non-negotiable 3), so there is no fall-back to the full pool.
 */
export function pickCaptionTemplate(pillar: string | null | undefined, seed: string, avoid: Iterable<string> = []): string | null {
  const pool = CAPTION_TEMPLATES[captionGroupFor(pillar)];
  const used = new Set(avoid);
  const fresh = pool.filter((t) => !used.has(t));
  if (fresh.length === 0) return null;
  return fresh[hash(seed) % fresh.length]!;
}

/* ------------------------------------------------------------------------------------------------------------------
 * F26 stream B: the composed bank. A caption = hook (+ body) (+ soft closer), composed deterministically in
 * caption-compose.ts; hashtags come from hashtags.ts. Same voice rules as above (docs/voice.md): calm, dry, no hype,
 * no exclamation marks, no digits, no place or whereabouts, no claims about a specific workout unless the clip's folder
 * or file name says so (CONTEXT_BODIES), at most one emoji per caption (never in the bank itself except the signature).
 * ---------------------------------------------------------------------------------------------------------------- */
export interface CaptionBank {
  hooks: readonly string[];
  bodies: readonly string[];
  /** Soft closers: a low-key line or question, never "follow for more" / "link in bio". Used on a share of captions only. */
  ctas: readonly string[];
}

export const CAPTION_BANK: Record<CaptionGroup, CaptionBank> = {
  gym: {
    hooks: [
      "Quiet session, good reps, no complaints.",
      "Just stacking days is all 🙂‍↕️…",
      "Nothing fancy today, just the work…",
      "Most people don't need a new program. They need better reps.",
      "Not my best session, but it counts…",
      "Slow reps, honest weight, onto the next one.",
      "Some days the warm-up is the hardest set…",
      "Same plan as last week, just a little heavier…",
      "Pump was fine, ego was not…",
      "Still showing up, that's the whole trick…",
      "Form first, the weight can catch up later.",
      "Another set, another reminder to rest properly…",
      "The bar didn't care how I felt today…",
      "Wasn't feeling it, did it anyway…",
      "Progress is slow until it suddenly isn't, supposedly…",
      "Lifting is mostly just repeating yourself on purpose…",
      "Today's plan was simple, so I kept it simple.",
      "Slightly sore, mostly fine…",
      "Rest days are part of the program, I keep telling myself…",
      "Nobody is watching the warm-up sets, so I took my time…",
      "A boring session is still a session…",
      "The weight went up a little, the mood did not…",
      "Less ego, more range of motion…",
      "Showed up tired, left slightly less tired…",
      "I'd call it consistent, not impressive…",
      "Small PRs are still PRs, even if nobody claps…",
      "Sleep, food, reps, repeat…",
    ],
    bodies: [
      "No big plan, just steady work.",
      "Kept the rest times honest.",
      "Tried to actually feel the muscle instead of just moving the weight.",
      "Not chasing numbers today.",
      "Controlled the negatives and left it there.",
      "It adds up if I keep it boring.",
      "Training is the easy part of the day.",
      "Good enough is a fine target some days.",
      "Slept okay, ate okay, lifted okay.",
      "The best sets were the quiet ones.",
      "Same movements, slightly better each time.",
      "Nothing to report, which is kind of the point.",
      "Left a rep or two in the tank and called it a day.",
      "The goal was to leave a bit better than I walked in.",
      "A little more patience would help.",
      "Still figuring out what actually works for me.",
      "Warm-ups got more attention than usual.",
      "Stopped when the form started to slip.",
      "Some sets felt great, some felt like homework.",
      "Writing it down so I can beat it next time.",
      "Not a highlight, just a data point.",
      "Fixing the small stuff before adding more weight.",
    ],
    ctas: [
      "What's your go-to when motivation is low?",
      "Curious what keeps your sessions consistent.",
      "How do you track progress when it's slow?",
      "What's the one thing you'd fix in your warm-up?",
      "Do you plan the session first or wing it?",
      "What do you do on the days you don't feel it?",
      "Anyone else a creature of habit with their routine?",
      "What's your favorite boring habit that works?",
      "How long do you rest between sets, honestly?",
      "What's one thing you'd tell yourself a year ago?",
      "Still learning, always open to ideas.",
    ],
  },
  running: {
    hooks: [
      "Got absolutely wrecked by blisters on both feet post run 😔",
      "Easy pace today, and it still felt hard…",
      "Not fast, just consistent…",
      "The run was fine, the legs disagree…",
      "Went out slower than planned and I'm okay with that.",
      "Cardio is a lot less fun than lifting, but it keeps showing up on the plan…",
      "One more easy run in the books…",
      "Legs felt heavy, finished anyway…",
      "The first mile is always a negotiation…",
      "Running slow on purpose is harder than it sounds…",
      "Nobody tells you how much laundry running creates…",
      "Not every run needs to be a good one…",
      "Started the run annoyed, finished it less annoyed…",
      "Easy runs are supposed to feel easy, apparently…",
      "My shoes did more work than my lungs today…",
      "Running is mostly just deciding to start…",
      "The pace was humbling, the effort was honest…",
      "Cardio day, no excuses, a few complaints…",
      "Legs were not consulted on today's plan…",
      "Built the habit first, the speed can come later.",
      "Another run that was better than staying inside…",
      "Not pretty, but it counts…",
      "Slow progress is still progress, I keep hearing…",
      "Took the pace down and enjoyed it more…",
      "I run so I can eat, and that's the whole plan…",
      "Walked a bit, ran a bit, called it a run…",
      "Breathing was a suggestion today…",
    ],
    bodies: [
      "Keeping the cardio base boring and steady.",
      "Heart rate stayed low, ego stayed lower.",
      "Not chasing a pace, just the habit.",
      "Hydrated better than last time.",
      "The warm-up was the hardest part.",
      "Felt rough early, better after a while.",
      "Mixing it in with lifting without wrecking the legs.",
      "Cooldown walk counts too.",
      "Shoes are the only thing I'd upgrade.",
      "A short one, but it still counts.",
      "Slept badly and still got it done.",
      "Aiming for consistency over anything else.",
      "It gets easier, or I get used to it.",
      "Stretched afterwards for once.",
      "Enjoying it a little more each week.",
      "Not a personal best, and that's fine.",
      "Easy effort, easy conscience.",
      "Fueled properly and it showed.",
      "Listened to my body and cut it short.",
      "Just logging the miles quietly.",
    ],
    ctas: [
      "What's your go-to easy run pace feeling?",
      "How do you get through the first mile?",
      "Do you run with music or without?",
      "What's the one running habit that helped you most?",
      "Anyone else bad at slowing down?",
      "How do you balance running and lifting?",
      "What do you eat after a run, honestly?",
      "Open to shoe advice if you have any.",
      "What keeps you going on the bad days?",
      "Morning runs or later in the day?",
    ],
  },
  meal: {
    hooks: [
      "Keeping it simple, high protein, and consistent.",
      "Another day of eating while balancing college, training, and everything in between.",
      "Nothing fancy, just food that keeps the week easy…",
      "Prep once, eat the same thing all week, call it discipline…",
      "Protein first, everything else second.",
      "Simple meals are the only ones I actually stick to…",
      "Not pretty, but it hits the goals…",
      "Same rotation as always, and it works…",
      "Meal prep is just cooking once and complaining less…",
      "Boring food, good results, no complaints…",
      "If it's easy, I'll actually eat it…",
      "The fridge is the real program…",
      "Eating the same thing again, on purpose…",
      "Most of nutrition is just not overthinking it…",
      "Cooked everything in one go and called it a day…",
      "Food prep is the part of the plan nobody sees…",
      "Not every meal needs to be exciting…",
      "Another full day of eating, nothing special…",
      "Planning the meals so I don't have to plan the day…",
      "Eating enough is harder than it sounds…",
      "The goal is food I won't skip…",
      "Rice, protein, repeat…",
      "Past me did a favor for the rest of the week…",
      "A decent plate beats a perfect plan…",
      "Easy meals for a busy week…",
      "Prepped it, packed it, forgot about it…",
      "Still the most underrated part of training…",
    ],
    bodies: [
      "Keeping the ingredients short and the meals repeatable.",
      "Protein at every meal is the only rule.",
      "Portioned it out so I don't have to think later.",
      "Cheap, simple and it actually tastes fine.",
      "Containers are doing the heavy lifting.",
      "Same base, different sauces.",
      "Nothing here is complicated.",
      "It's not about perfect, it's about consistent.",
      "Fits the schedule, fits the goals.",
      "Tastes better on day one than day four.",
      "Spent less time cooking than scrolling.",
      "Cooking in bulk saves the week.",
      "Staying on top of it without making it a project.",
      "Fiber and vegetables are on the list too.",
      "Figured out what I'll actually eat and stuck with it.",
      "Fueling the training, nothing more.",
      "Less decision making, more eating.",
      "A solid base for the whole week.",
      "Not tracking every gram, just staying in range.",
      "Leftovers count as meal prep.",
    ],
    ctas: [
      "What's your easiest high protein meal?",
      "How do you keep meal prep from getting boring?",
      "What's in your weekly rotation?",
      "Do you prep for the whole week or just a few days?",
      "What's your go-to cheap protein?",
      "Any sauce suggestions that aren't just hot sauce?",
      "How do you keep it going on busy weeks?",
      "What's the one container you couldn't live without?",
      "Always looking for easy meal ideas.",
      "What would you add to this?",
    ],
  },
  lifestyle: {
    hooks: [
      "Another day balancing college, lifting, and everything in between.",
      "Just documenting the process, including the slow days…",
      "Quiet day, steady work…",
      "Not every day is a highlight reel, and that's fine.",
      "Small habits, repeated. That's most of it…",
      "Oh well, onto the next one.",
      "Trying to keep the routine boring on purpose…",
      "Some days are for progress, some are for just showing up…",
      "Lately it's mostly lifting, studying, and sleeping…",
      "Discipline is mostly just doing the next small thing…",
      "Not much happened, which is a good sign…",
      "A normal day, documented…",
      "Trying to be consistent when nobody's checking…",
      "The routine isn't exciting, but it works…",
      "Today was about getting through the list…",
      "Motivation comes and goes, the schedule stays…",
      "Learning to be okay with an average day…",
      "Balancing a lot, dropping a few things, still going…",
      "Showing up is the least glamorous part of the plan…",
      "Most progress happens on the days nobody posts about…",
      "Tired but on track…",
      "Taking the week one day at a time…",
      "Keeping the days simple and the goals clear…",
      "I'm not special, I'm just consistent…",
      "Sleep is underrated, food is underrated, routines are underrated…",
      "A slow day is still a day on the board…",
      "The plan is simple, the follow-through is the hard part…",
    ],
    bodies: [
      "Class, training, food, sleep, repeat.",
      "Trying to keep the whole thing sustainable.",
      "No big announcement, just the process.",
      "Some days it clicks, some days it doesn't.",
      "Getting a little better at saying no.",
      "The goal is to keep it boring and keep it going.",
      "Writing things down helps more than I expected.",
      "Learning as I go.",
      "Making time for the basics first.",
      "Doing the unglamorous part again.",
      "Still figuring out the balance.",
      "A little progress is still progress.",
      "Keeping the standards simple.",
      "Not perfect, just steady.",
      "The habits are doing most of the work now.",
      "Trying to be a bit better than yesterday.",
      "Rest counts as part of the routine.",
      "Staying patient with the long game.",
      "Not much to say, just glad I did it.",
      "The schedule makes the decisions easier.",
    ],
    ctas: [
      "How do you stay consistent when things get busy?",
      "What's one habit that actually stuck for you?",
      "What does your routine look like on a slow day?",
      "Curious how you balance it all.",
      "What's the best advice you've gotten on discipline?",
      "Morning person or night person, honestly?",
      "What's the hardest part of the week for you?",
      "Anyone else trying to keep it simple lately?",
      "What helps you reset after a bad day?",
      "Always open to better habits.",
    ],
  },
};

/** Clip topics read from the folder + file name; the matching lines may only be used when the clip says so. */
export interface ContextTopic {
  id: string;
  /** Matched against "<folder> <basename>" (lowercased). */
  match: RegExp;
  group: CaptionGroup;
  bodies: readonly string[];
}

export const CONTEXT_TOPICS: readonly ContextTopic[] = [
  { id: "upper-body", match: /upper[\s_-]*body/, group: "gym", bodies: ["Upper body day, nothing complicated.", "Upper body sets, kept the form clean.", "Upper body today, and the pump was decent."] },
  { id: "lower-body", match: /lower[\s_-]*body|\blegs?\b|leg[\s_-]*day/, group: "gym", bodies: ["Leg day, stairs are going to be a problem tomorrow.", "Legs today, walking later is optional.", "Lower body day, kept it controlled."] },
  { id: "back", match: /\bback\b|pull[\s_-]*day|\blats?\b/, group: "gym", bodies: ["Pull day, trying to feel the back instead of the arms.", "Back day, slow reps and a proper squeeze.", "Pull day, nothing fancy."] },
  { id: "chest", match: /\bchest\b|push[\s_-]*day|\bpress\b/, group: "gym", bodies: ["Push day, kept the shoulders happy.", "Chest day, slow on the way down.", "Push day, nothing fancy."] },
  { id: "arms", match: /\barms?\b|biceps?|triceps?/, group: "gym", bodies: ["Arm day, the easy kind of hard.", "Arms today, light weight, strict reps."] },
  { id: "shoulders", match: /shoulders?|delts?/, group: "gym", bodies: ["Shoulder day, going lighter than the ego wanted.", "Shoulders today, strict form only."] },
  { id: "physique", match: /physique|check[\s_-]*in|progress|flex/, group: "gym", bodies: ["Physique check, honest lighting and all.", "Progress check, slow but visible.", "Just a check-in on where things are."] },
  { id: "run", match: /\bruns?\b|running|jog|cardio/, group: "running", bodies: ["Easy run, kept the effort low.", "Run day, no pace goals.", "Cardio today, slow and steady."] },
  { id: "meal-prep", match: /meal[\s_-]*prep|\bprep\b/, group: "meal", bodies: ["Meal prep for the week, same as always.", "Prepped the week in one go."] },
  { id: "full-day", match: /full[\s_-]*day|what[\s_-]*i[\s_-]*eat|\beating\b/, group: "meal", bodies: ["Full day of eating, nothing hidden.", "A normal day of food, nothing special."] },
];

/** Group implied by the clip's folder / file name, or null when the name says nothing. */
export function contextTopicFor(clipContext: string | null | undefined): ContextTopic | null {
  const t = (clipContext ?? "").toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "");
  if (!t.trim()) return null;
  return CONTEXT_TOPICS.find((c) => c.match.test(t)) ?? null;
}
