"""Pipeline tuning: routing thresholds, budgets and concurrency, all in one place."""

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

# Materiality levels, indexed 0 to 4 by Jev. NEEDS_ATTENTION_LEVEL or more means "Needs attention".
MATERIALITY_LEVELS = ["Trivial", "Minor", "Notable", "Significant", "Critical"]
# What each level means, in the same order: Jev scores against these, and Help shows them.
MATERIALITY_RUBRIC = [
    "routine or without consequence for the subjects",
    "small, expected or narrowly local impact",
    "worth knowing; a moderate change for a tracked subject",
    "an important change likely to need supervisory follow-up",
    "severe, urgent or systemic; needs immediate attention",
]
NEEDS_ATTENTION_LEVEL = 3

# Run 1 is computed as of T0 minus this many days, Run 2 as of T0.
RUN_SPACING_DAYS = 7

# Concurrent model calls. Claude is capped to stay within the subscription allowance.
JEV_CONCURRENCY = 8
CLAUDE_CONCURRENCY = 4
