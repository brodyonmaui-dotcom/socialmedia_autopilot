// Dev only (run 4): demo inbox rows so every filter of /inbox has something: 40 comments over the buckets
// (8 promo, drafted shadow replies on the praise, a few queued/sent) and 6 DM threads (2 promo-ignored).
// Idempotent: every row is keyed on platform ids starting with "demo-inbox-" (on conflict do nothing).
// Invented text and obviously fake handles; places come from a cartoon town. Nothing here sends anything.

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

type Bucket = "simple_positive" | "negative" | "flag" | "hide_flag" | "spam_promo";
/** [handle, text, bucket, reasons, reply text (shadow/sent), reply status] */
type Row = [string, string, Bucket, string[], string | null, ("shadow" | "planned" | "sent")?];

export const DEMO_INBOX_PREFIX = "demo-inbox-";

const COMMENTS: Row[] = [
  ["gym_fan_22", "love the gym content", "simple_positive", ["plain praise"], "Appreciate you man"],
  ["lift_daily_04", "clean form 🔥", "simple_positive", ["plain praise"], "Thanks, means a lot"],
  ["chart_nerd_7", "that risk management 👏", "simple_positive", ["plain praise"], "Appreciate it 🙏"],
  ["early_riser_31", "needed this today", "simple_positive", ["plain praise"], "Haha appreciate that"],
  ["squat_squad_9", "park sessions are the best kind", "simple_positive", ["plain praise"], "Thank you, more coming"],
  ["patient_trader_2", "respect the patience on that trade", "simple_positive", ["plain praise"], "Appreciate you man"],
  ["fit_mike_88", "insane progress", "simple_positive", ["plain praise"], "Thanks, means a lot"],
  ["candle_watcher", "trading journal content is so underrated", "simple_positive", ["plain praise"], "Appreciate it 🙏"],
  ["rep_counter_5", "smooth reps", "simple_positive", ["plain praise"], "Haha appreciate that"],
  ["steady_gains_12", "how are you this good?!", "simple_positive", ["rhetorical praise"], "Appreciate you man"],
  ["leg_day_lena", "W video", "simple_positive", ["plain praise"], "Thank you, more coming"],
  ["calm_lifter_6", "love the calm vibe", "simple_positive", ["plain praise"], "Thanks, means a lot"],
  ["deadlift_dan_3", "the consistency is crazy", "simple_positive", ["plain praise"], "Appreciate you man", "planned"],
  ["morning_ny_open", "clean NY session today", "simple_positive", ["plain praise"], "Appreciate it 🙏", "sent"],
  ["protein_pat_1", "great tip, thanks", "simple_positive", ["plain praise"], "Haha appreciate that", "sent"],
  ["skeptic_sam_0", "this is so fake", "negative", ["doubts results"], "Have a great day 😊👍"],
  ["meh_viewer_44", "cringe", "negative", ["mockery"], "Appreciate you watching 😊"],
  ["no_way_nate", "lol no way that works", "negative", ["mockery"], "Hope your day's going well 👍"],
  ["curious_carl_8", "what program do you run?", "flag", ["question"], null],
  ["split_q_19", "what's your split?", "flag", ["question"], null],
  ["broker_b_3", "what broker do you use", "flag", ["question"], null],
  ["warmup_wendy", "how do you warm up", "flag", ["question"], null],
  ["journal_jay_2", "do you journal every trade?", "flag", ["question"], null],
  ["song_seeker_5", "what's the song?", "flag", ["question"], null],
  ["wanderer_77", "which gym is this?", "flag", ["question", "location/schedule"], null],
  ["springfield_fan_0", "are you in springfield?", "flag", ["question", "location/schedule"], null],
  ["meetup_mo_6", "can we meet sometime", "flag", ["location/schedule"], null],
  ["trail_tom_4", "what time do you train", "flag", ["question", "location/schedule"], null],
  ["brand_rep_demo", "we'd like to sponsor your next video", "flag", ["brand/business"], null],
  ["coach_seek_10", "do you offer coaching?", "flag", ["question", "brand/business"], null],
  ["rates_rita_demo", "send me your rate card", "flag", ["brand/business"], null],
  ["angry_anon_000", "kys", "hide_flag", ["threat"], null],
  ["scammy_prize_00", "you are a giveaway winner, claim now", "hide_flag", ["scam"], null],
  ["fit_features_hub", "love it 🔥 send it to @fit_features_hub", "spam_promo", ["promo:send-to"], null],
  ["gains_repost_page", "DM us to be featured", "spam_promo", ["promo:dm-feature"], null],
  ["trader_spotlight_x", "We'd love to feature you on our page!", "spam_promo", ["promo:feature-you"], null],
  ["boost_hub_demo", "grow your page with real followers, dm", "spam_promo", ["promo:growth"], null],
  ["s4s_central_demo", "s4s 🔥", "spam_promo", ["promo:s4s"], null],
  ["gym_reels_spot", "nice 🔥 submit to @gym_reels_spot", "spam_promo", ["promo:send-to"], null],
  ["our_page_daily", "check out our page for more gains", "spam_promo", ["promo:check-our-page"], null],
  ["paid_promo_demo", "paid promotion available, inbox us", "spam_promo", ["promo:paid-promo"], null],
];

/** [handle, inbound text, draft text | null, draft status, ignored reason | null] */
const DMS: Array<[string, string, string | null, "draft" | "copied" | null, string | null]> = [
  ["fan_mail_demo_1", "love your videos man, keep it up", "Thanks for watching and for the support, it means a lot.", "draft", null],
  ["brand_inquiry_demo", "hi, we'd like to discuss a sponsorship for your channel", "Hey, thanks for reaching out, I appreciate you thinking of me. I'm open to hearing more: could you send over the deliverables, timeline and rate you have in mind? I'll look it over and get back to you.", "draft", null],
  ["question_demo_3", "what app do you use for your journal?", "Thanks for the message, appreciate it. I'll get back to you when I can.", "copied", null],
  ["new_dm_demo_4", "hey", null, null, null],
  ["promo_dm_demo_5", "We would love to feature you, paid promo options available", null, null, "promo:feature-you"],
  ["growth_dm_demo_6", "Hi, we can boost your engagement 10x, interested?", null, null, "promo:growth"],
];

export async function seedDemoInbox(db: Queryable, now: Date = new Date()): Promise<string> {
  const min = 60_000;
  let added = 0;
  for (const [i, [handle, text, bucket, reasons, reply, status]] of COMMENTS.entries()) {
    const platform = i % 3 === 2 ? "youtube" : "instagram";
    const at = new Date(now.getTime() - (i * 37 + 5) * min);
    const id = (
      await db.query(
        `insert into comments (platform, platform_comment_id, platform_media_id, author_id, author_handle, text, commented_at, fetched_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7) on conflict (platform, platform_comment_id) do nothing returning id`,
        [platform, `${DEMO_INBOX_PREFIX}c${i}`, `${DEMO_INBOX_PREFIX}media-${i % 5}`, `${DEMO_INBOX_PREFIX}author-${handle}`, handle, text, at],
      )
    ).rows[0]?.id as string | undefined;
    if (!id) continue; // already seeded
    added++;
    const draft = bucket === "simple_positive" || bucket === "negative" ? reply : null;
    await db.query(
      `insert into comment_triage (comment_id, bucket, confidence, draft_reply, reasons, model, decided_at, handled_at)
       values ($1, $2, $3, $4, $5, 'demo', $6, $7) on conflict (comment_id) do nothing`,
      [id, bucket, bucket === "spam_promo" || bucket === "hide_flag" ? 1 : 0.9, draft, reasons, at, status && status !== "shadow" ? at : null],
    );
    if (reply) {
      const s = status ?? "shadow";
      await db.query(
        `insert into engagement_actions (comment_id, kind, text, status, not_before, origin, created_at, updated_at, sent_at)
         values ($1, 'reply', $2, $3, $4, $5, $4, $4, $6) on conflict (comment_id, kind) do nothing`,
        [id, reply, s, new Date(at.getTime() + 10 * min), s === "shadow" ? "auto" : "manual", s === "sent" ? new Date(at.getTime() + 12 * min) : null],
      );
    }
  }
  for (const [i, [handle, text, draft, draftStatus, ignored]] of DMS.entries()) {
    const at = new Date(now.getTime() - (i * 95 + 20) * min);
    const thread = (
      await db.query(
        `insert into dm_threads (platform, platform_thread_id, participant_id, participant_handle, last_inbound_at, ignored_reason, ignored_at)
         values ('instagram', $1, $2, $3, $4, $5, $6) on conflict (platform_thread_id) do nothing returning id`,
        [`${DEMO_INBOX_PREFIX}t${i}`, `${DEMO_INBOX_PREFIX}p${i}`, handle, at, ignored, ignored ? at : null],
      )
    ).rows[0]?.id as string | undefined;
    if (!thread) continue;
    const msg = (
      await db.query(
        `insert into dm_messages (thread_id, platform_message_id, direction, text, sent_at) values ($1, $2, 'in', $3, $4)
         on conflict (platform_message_id) do nothing returning id`,
        [thread, `${DEMO_INBOX_PREFIX}m${i}`, text, at],
      )
    ).rows[0]?.id as string | undefined;
    if (draft && draftStatus) {
      await db.query(`insert into dm_drafts (thread_id, for_message_id, text, bucket, status) values ($1, $2, $3, $4, $5)`, [
        thread, msg ?? null, draft, i === 1 ? "brand" : i === 2 ? "question" : "fan", draftStatus,
      ]);
    }
  }
  const promo = COMMENTS.filter((c) => c[2] === "spam_promo").length;
  return added ? `inbox demo: +${added} of ${COMMENTS.length} comments (${promo} promo) + ${DMS.length} DM threads` : `inbox demo already seeded (${COMMENTS.length} comments)`;
}
