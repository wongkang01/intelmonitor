"""Pipeline tuning: routing thresholds, budgets and concurrency, all in one place."""

from datetime import date
from typing import Literal

# Confidence routing for Jev nouls (relevance and subject tags): at or above HIGH is a clear yes,
# at or below LOW a clear no, and the band in between goes to Claude.
ROUTE_LOW = 0.3
ROUTE_HIGH = 0.7

# Jev's context on OpenRouter is 32k tokens. Documents longer than this state budget are screened
# on their title plus leading chunks (about 4 characters per token).
SCREEN_STATE_TOKENS = 24_000
CHARS_PER_TOKEN = 4

# Claude reads the full text for extraction, capped for the very longest PDFs.
EXTRACT_MAX_CHARS = 200_000

# Same-event candidates: findings sharing a subject, event dates within MERGE_WINDOW_DAYS, cosine
# similarity at or above MERGE_MIN_SIMILARITY, at most MERGE_MAX_NEIGHBOURS per finding.
# Jev decides each pair; SAME_EVENT_THRESHOLD or more merges them.
MERGE_WINDOW_DAYS = 10
MERGE_MIN_SIMILARITY = 0.6
MERGE_MAX_NEIGHBOURS = 5
SAME_EVENT_THRESHOLD = 0.5
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"

# Materiality levels, indexed 0 to 4. Jev scores a development's priority for each subject it
# happened to or that did it; the development's materiality level is its highest.
MATERIALITY_LEVELS = ["Trivial", "Minor", "Notable", "Significant", "Critical"]
# What each level means for one subject, in the same order: Jev scores against these, and Help
# shows them. Opportunities count as well as threats, so adverse is a separate flag.
MATERIALITY_RUBRIC = [
    "routine, promotional or barely about this subject, with no consequence for it or for "
    "Singapore",
    "small or expected: routine statistics, speeches, FAQs and procedural notices, product and "
    "promotional news, or a foreign event with little route to Singapore",
    "worth knowing: a moderate change for this subject, such as new guidance, a consultation or "
    "a results update, or a larger event that reaches it or Singapore only indirectly",
    "a material change for this subject, a threat or an opportunity: an incident, enforcement "
    "action, loss or failure at it, a binding decision that changes what it must do, a major "
    "deal, or a market shock it is exposed to",
    "severe, urgent or systemic for this subject or for Singapore's financial system; needs "
    "immediate attention",
]
# The priority label each level shows (phase1-plan.md, D2): High is Significant or Critical,
# Medium is Notable, Low is Minor or Trivial. High starts at NEEDS_ATTENTION_LEVEL, which the
# interface still calls Needs attention.
Priority = Literal["High", "Medium", "Low"]
PRIORITY_LABELS: list[Priority] = ["Low", "Low", "Medium", "High", "High"]
NEEDS_ATTENTION_LEVEL = 3


def display_key(
    level: int, adverse: bool, last_published: date, development_id: str
) -> tuple[int, bool, int, int, str]:
    """The order a subject's developments are shown and briefed in: High and adverse first, then
    other High, then Medium adverse, then other Medium, then the rest; most recent first within
    each, then most material. `level` and `adverse` are the development's for the subjects in
    view. The feed (server/queries.py) and the briefs (pipeline/summaries.py) both sort by it."""
    rank = ("High", "Medium", "Low").index(PRIORITY_LABELS[level])
    return (rank, rank < 2 and not adverse, -last_published.toordinal(), -level, development_id)


# Promotional and product news gets the lowest label: its priority is capped at Minor.
PROMOTIONAL_MAX_LEVEL = 1
# A development only social media reports is unverified, and a single post is not a signal
# (prd.md section 7): capped at Minor until a news, official or data source joins it.
UNVERIFIED_MAX_LEVEL = 1

# Run 1 is computed as of T0 minus this many days, Run 2 as of T0.
RUN_SPACING_DAYS = 7

# Concurrent model calls. Claude is capped to stay within the subscription allowance.
JEV_CONCURRENCY = 8
CLAUDE_CONCURRENCY = 4
