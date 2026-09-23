"""Which subjects a document mentions, by name, alias or keyword (a cheap pre-filter for Jev).

- Entity: its name or an alias, case-sensitive ("Fed", "Circle", "MAS" are proper nouns).
- Topic: its name or a keyword, case-insensitive.
- Group: its name (case-insensitive), or any member entity's name or alias.
"""

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

from intelmonitor.seed import SubjectType, load_subjects


@dataclass(frozen=True)
class SubjectMatcher:
    id: str
    name: str
    type: SubjectType
    pattern: re.Pattern[str]

    def matches(self, text: str) -> bool:
        return self.pattern.search(text) is not None


def _pattern(terms: Iterable[str], case_sensitive: Iterable[str] = ()) -> re.Pattern[str]:
    parts = [f"(?i:{re.escape(t)})" for t in terms]
    parts += [re.escape(t) for t in case_sensitive]
    return re.compile(r"(?<!\w)(?:" + "|".join(parts) + r")(?!\w)")


@lru_cache
def subject_matchers() -> list[SubjectMatcher]:
    seed = load_subjects()
    entity_terms = {e.id: [e.name, *e.aliases] for e in seed.entities}
    matchers = [
        SubjectMatcher(t.id, t.name, "topic", _pattern([t.name, *t.keywords])) for t in seed.topics
    ]
    matchers += [
        SubjectMatcher(
            g.id,
            g.name,
            "group",
            _pattern([g.name], [term for m in g.members for term in entity_terms[m]]),
        )
        for g in seed.groups
    ]
    matchers += [
        SubjectMatcher(e.id, e.name, "entity", _pattern([], entity_terms[e.id]))
        for e in seed.entities
    ]
    return matchers


def normalize(text: str) -> str:
    return text.replace("’", "'").replace("‘", "'")


def candidate_subjects(title: str, text: str) -> list[str]:
    """Ids of subjects named in the title or text."""
    haystack = normalize(f"{title}\n{text}")
    return [m.id for m in subject_matchers() if m.matches(haystack)]


def candidate_counts(docs: Iterable[tuple[str, str]]) -> Counter[str]:
    """Candidate document count per subject id, over (title, text) pairs."""
    counts: Counter[str] = Counter()
    for title, text in docs:
        counts.update(candidate_subjects(title, text))
    return counts
