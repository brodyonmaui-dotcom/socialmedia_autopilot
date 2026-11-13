// Reply pools in his voice (docs/voice.md "Comment replies (auto)"). 2–6 words, at most one emoji
// (the "😊👍" pair is his), no swearing, no places, no selling, no trading talk.
// Every line must pass lintText(kind "reply") with no errors (see rules.test.ts).

/** Positive / simple comments: short and warm. First five are the voice.md seeds, verbatim. */
export const POSITIVE_POOL: readonly string[] = [
  "Appreciate you man",
  "Thanks, means a lot",
  "Appreciate it 🙏",
  "Haha appreciate that",
  "Thank you, more coming",
  "Thanks man, appreciate it",
  "Means a lot, thank you",
  "Glad you liked it",
  "Appreciate the love",
  "Thanks for watching man",
  "Haha thanks man",
  "Really appreciate that",
  "Glad it helped",
  "Thank you, appreciate you",
];

/** Mockery / hate: overly positive only, never engage with the point. First four are the voice.md seeds. */
export const NEGATIVE_POOL: readonly string[] = [
  "Have a great day 😊👍",
  "Appreciate you watching 😊",
  "Hope your day's going well 👍",
  "Thanks for stopping by 😊",
  "Appreciate you stopping by",
  "Wishing you a good one 😊",
  "Thanks for watching 👍",
  "Hope you have a good week",
  "Appreciate the comment 😊",
  "Take care man 👍",
];
