"""HTTP client that caches every response under data/raw/, keyed by request.

A request is identified by method, URL, query params, JSON body and an optional `vary` tag. Headers
and `secret_params` are sent but never keyed or stored, so API keys stay out of the cache. `vary`
is keyed but never sent: a caller passes the fetch date for a URL whose answer changes daily.
Final responses (2xx, and 4xx unless `cache_errors` is off) are cached; network errors, 429 and
5xx are retried and never cached. A rerun over the same requests makes zero network calls, which
`network` counts per namespace. An `offline` client never reaches the network: a request with no
cached response fails, and `missed` counts it.
"""

import hashlib
import json
import threading
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import httpx

from intelmonitor.config import DATA_DIR

RAW_DIR = DATA_DIR / "raw"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
_RETRIES = 4

type JSONValue = str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]


class FetchError(Exception):
    pass


@dataclass(frozen=True)
class CachedResponse:
    status: int
    url: str  # final URL after redirects
    content_type: str
    content: bytes

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def is_pdf(self) -> bool:
        return "pdf" in self.content_type or self.content.startswith(b"%PDF")

    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> JSONValue:
        value: JSONValue = json.loads(self.content)
        return value


@dataclass(frozen=True)
class _Request:
    method: str
    url: str
    params: dict[str, str]
    body: dict[str, JSONValue] | None
    vary: str | None = None
    secret_params: dict[str, str] | None = None  # sent, never part of the key

    def key(self) -> dict[str, JSONValue]:
        key: dict[str, JSONValue] = {"method": self.method, "url": self.url}
        if self.params:
            key["params"] = dict(self.params)
        if self.body is not None:
            key["body"] = self.body
        if self.vary is not None:
            key["vary"] = self.vary
        return key


class CachedHttp:
    def __init__(self, raw_dir: Path = RAW_DIR, *, offline: bool = False) -> None:
        self.raw_dir = raw_dir
        self.offline = offline
        self.client = httpx.Client(
            timeout=httpx.Timeout(45.0, connect=15.0),
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        )
        self.network: Counter[str] = Counter()
        self.cached: Counter[str] = Counter()
        self.missed: Counter[str] = Counter()
        self._lock = threading.Lock()

    def get(
        self,
        namespace: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        expect_json: bool = False,
        vary: str | None = None,
        secret_params: dict[str, str] | None = None,
        cache_errors: bool = True,
    ) -> CachedResponse:
        request = _Request("GET", url, params or {}, None, vary, secret_params)
        return self._fetch(namespace, request, headers or {}, expect_json, cache_errors)

    def post_json(
        self,
        namespace: str,
        url: str,
        body: dict[str, JSONValue],
        *,
        headers: dict[str, str] | None = None,
    ) -> CachedResponse:
        request = _Request("POST", url, {}, body)
        return self._fetch(namespace, request, headers or {}, expect_json=True)

    def _fetch(
        self,
        namespace: str,
        request: _Request,
        headers: dict[str, str],
        expect_json: bool,
        cache_errors: bool = True,
    ) -> CachedResponse:
        key = request.key()
        digest = hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()[:32]
        meta_path = self.raw_dir / namespace / f"{digest}.json"
        body_path = meta_path.with_suffix(".body")
        if meta_path.exists() and body_path.exists():
            meta = json.loads(meta_path.read_text())
            with self._lock:
                self.cached[namespace] += 1
            return CachedResponse(
                status=int(meta["status"]),
                url=str(meta["final_url"]),
                content_type=str(meta["content_type"]),
                content=body_path.read_bytes(),
            )

        if self.offline:
            with self._lock:
                self.missed[namespace] += 1
            raise FetchError(f"{request.url}: not cached")
        response = self._request(namespace, request, headers, expect_json)
        if not (response.ok or cache_errors):
            return response
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        body_path.write_bytes(response.content)
        meta_path.write_text(
            json.dumps(
                {
                    "request": key,
                    "status": response.status,
                    "final_url": response.url,
                    "content_type": response.content_type,
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                },
                indent=1,
            )
        )
        return response

    def _request(
        self,
        namespace: str,
        request: _Request,
        headers: dict[str, str],
        expect_json: bool,
    ) -> CachedResponse:
        url = request.url
        error = ""
        for attempt in range(_RETRIES):
            if attempt:
                time.sleep(2**attempt)
            with self._lock:
                self.network[namespace] += 1
            try:
                if request.body is not None:
                    r = self.client.post(url, json=request.body, headers=headers)
                else:
                    params = {**request.params, **(request.secret_params or {})}
                    r = self.client.get(url, params=params, headers=headers)
            except httpx.HTTPError as e:
                error = repr(e)
                continue
            if r.status_code == 429 or r.status_code >= 500:
                error = f"HTTP {r.status_code}"
                continue
            final_url = r.url
            for name in request.secret_params or {}:
                final_url = final_url.copy_remove_param(name)
            response = CachedResponse(
                status=r.status_code,
                url=str(final_url),
                content_type=r.headers.get("content-type", ""),
                content=r.content,
            )
            if expect_json and response.ok:
                try:
                    response.json()
                except ValueError:
                    # MAS's CDN sometimes answers API calls with a 200 HTML maintenance page.
                    error = "expected JSON, got " + response.content_type
                    continue
            return response
        raise FetchError(f"{url}: {error}")
