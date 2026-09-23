"""HTTP client that caches every response under data/raw/, keyed by request.

A request is identified by method, URL, query params and JSON body (never headers, so API keys
stay out of the cache key). Final responses (2xx and 4xx) are cached; network errors, 429 and 5xx
are retried and never cached. A rerun over the same requests makes zero network calls, which
`network` counts per namespace.
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

    def key(self) -> dict[str, JSONValue]:
        key: dict[str, JSONValue] = {"method": self.method, "url": self.url}
        if self.params:
            key["params"] = dict(self.params)
        if self.body is not None:
            key["body"] = self.body
        return key


class CachedHttp:
    def __init__(self, raw_dir: Path = RAW_DIR) -> None:
        self.raw_dir = raw_dir
        self.client = httpx.Client(
            timeout=httpx.Timeout(45.0, connect=15.0),
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        )
        self.network: Counter[str] = Counter()
        self.cached: Counter[str] = Counter()
        self._lock = threading.Lock()

    def get(
        self,
        namespace: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        expect_json: bool = False,
    ) -> CachedResponse:
        request = _Request("GET", url, params or {}, None)
        return self._fetch(namespace, request, headers or {}, expect_json)

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

        response = self._request(namespace, request, headers, expect_json)
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
                    r = self.client.get(url, params=request.params, headers=headers)
            except httpx.HTTPError as e:
                error = repr(e)
                continue
            if r.status_code == 429 or r.status_code >= 500:
                error = f"HTTP {r.status_code}"
                continue
            response = CachedResponse(
                status=r.status_code,
                url=str(r.url),
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
