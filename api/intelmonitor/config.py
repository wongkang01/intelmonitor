"""Settings loaded from the repo-root .env, shared by the CLI and the server."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "api"
SEED_DIR = API_ROOT / "seed"
DATA_DIR = REPO_ROOT / "data"
ARTIFACTS_DIR = REPO_ROOT / "artifacts"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Claude runs on the user's Claude login; a non-empty key would bill the API instead.
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    openrouter_api_key: str
    typesafe_base_url: str = "https://openrouter.ai/api"
    typesafe_default_model: str = "jev-1.13"

    exa_api_key: str = ""
    tavily_api_key: str = ""

    fred_api_key: str = ""
    coingecko_api_key: str = ""

    mas_api_base_url: str = "https://eservices.mas.gov.sg/apimg-gw"
    mas_exchange_rates_api_key: str = ""
    mas_bank_asset_quality_api_key: str = ""
    mas_bank_liquidity_api_key: str = ""
    mas_bank_exposure_api_key: str = ""


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings. Environment variables override values in .env."""
    return Settings()  # pyright: ignore[reportCallIssue]  # required fields come from .env
