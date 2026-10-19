// The four suggested questions under the empty Ask bar: written for the subject the page was opened
// about (`/ask?about=<id>`), else general ones. Mentions are written as `@<name>` (mentions.tsx).
import { mentionOf, type Subject } from "./mentions";

/** The one question with a sample answer (Answer.tsx). */
const LOANS_QUESTION = "How do @DBS and @UOB loans compare by region?";

const GENERAL = [
  LOANS_QUESTION,
  "Compare loans by region across @Singapore banks",
  "What affected @Payment systems this week?",
  "What is coming up for @MAS in the next 90 days?",
];

export function suggestionsFor(about: Subject | undefined): string[] {
  if (!about) return GENERAL;
  const m = mentionOf(about);
  const questions = {
    entity: [
      `What changed for ${m} this week?`,
      `How does ${m} compare with its peers?`,
      `Which developments elsewhere could reach ${m}?`,
      `What is coming up for ${m} in the next 90 days?`,
    ],
    group: [
      `What changed across ${m} this week?`,
      `How do ${m} compare on their latest figures?`,
      `Which of ${m} had High developments this week?`,
      `What is coming up for ${m} in the next 90 days?`,
    ],
    topic: [
      `What changed in ${m} this week?`,
      `Which entities are most exposed to ${m}?`,
      `Which sources reported most on ${m} this week?`,
      `What is coming up in ${m} in the next 90 days?`,
    ],
  }[about.type];
  // DBS and UOB lead with the question that has a sample answer.
  return about.id === "dbs" || about.id === "uob" ? [LOANS_QUESTION, ...questions.slice(1)] : questions;
}
