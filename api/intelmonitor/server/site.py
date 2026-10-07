"""The deployed site: the built web app at / and the API under /api, on one origin, so the
browser needs no CORS. Build the web app with VITE_API_URL=/api. Development keeps the two apart
behind Portless and does not use this module."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import Scope

from intelmonitor.config import REPO_ROOT
from intelmonitor.server.app import app as api

WEB_DIST = REPO_ROOT / "web" / "dist"


class SinglePageApp(StaticFiles):
    """Static files, with index.html for any other path so client routes load on refresh. A
    missing build asset stays a 404, so a stale chunk fails loudly instead of loading HTML."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or path.startswith("assets/"):
                raise
            return await super().get_response("index.html", scope)


# A mounted app's lifespan does not run, so the site runs the API's.
site = FastAPI(lifespan=api.router.lifespan_context, openapi_url=None)
site.mount("/api", api)
site.mount("/", SinglePageApp(directory=WEB_DIST, html=True))
