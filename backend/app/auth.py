import logging
import os
from typing import Optional
from urllib.parse import urlparse

import httpx
import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

# Mode développement (AUTH_DEV_MODE=1, à ne JAMAIS activer en production) : pas
# d'Authentik, "Connexion" pose simplement un cookie de session local reconnu comme
# un utilisateur fictif (voir routers/auth.py). Absent ou vide : comportement normal.
DEV_AUTH = os.environ.get("AUTH_DEV_MODE", "").strip().lower() in ("1", "true", "yes")
DEV_SESSION_TOKEN = "dev-session"
DEV_USER = {"email": "dev@localhost", "name": "Mode dev"}

if DEV_AUTH:
    logging.getLogger("uvicorn.error").warning(
        "AUTH_DEV_MODE actif : authentification factice, n'importe qui peut se connecter."
    )


def _setting(name: str) -> str:
    # Les réglages Authentik ne sont obligatoires qu'hors mode dev.
    return os.environ.get(name, "") if DEV_AUTH else os.environ[name]


AUTHENTIK_ISSUER = _setting("AUTHENTIK_ISSUER").rstrip("/")
AUTHENTIK_CLIENT_ID = _setting("AUTHENTIK_CLIENT_ID")
AUTHENTIK_CLIENT_SECRET = _setting("AUTHENTIK_CLIENT_SECRET")
# URL absolue et statique (pas dérivée de la requête, pour éviter les
# ambiguïtés de schéma http/https derrière le reverse proxy nginx) —
# doit être exactement celle enregistrée comme redirect URI dans Authentik.
AUTHENTIK_REDIRECT_URI = _setting("AUTHENTIK_REDIRECT_URI")

if DEV_AUTH:
    SITE_ROOT = "/"
else:
    _redirect_parts = urlparse(AUTHENTIK_REDIRECT_URI)
    SITE_ROOT = f"{_redirect_parts.scheme}://{_redirect_parts.netloc}/"

SESSION_COOKIE = "session"
STATE_COOKIE = "oauth_state"
NONCE_COOKIE = "oauth_nonce"

_discovery: Optional[dict] = None
_jwk_client: Optional[PyJWKClient] = None


async def get_discovery() -> dict:
    """Récupère (et met en cache) le discovery document OIDC d'Authentik."""
    global _discovery
    if _discovery is None:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{AUTHENTIK_ISSUER}/.well-known/openid-configuration")
            response.raise_for_status()
            _discovery = response.json()
    return _discovery


async def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        discovery = await get_discovery()
        _jwk_client = PyJWKClient(discovery["jwks_uri"])
    return _jwk_client


async def decode_id_token(token: str) -> dict:
    """Vérifie la signature, l'audience, l'émetteur et l'expiration d'un id_token."""
    if DEV_AUTH:
        # En mode dev, seul le cookie factice est accepté (aucun vrai jeton Authentik).
        if token == DEV_SESSION_TOKEN:
            return dict(DEV_USER)
        raise ValueError("Session de développement invalide.")
    discovery = await get_discovery()
    jwk_client = await _get_jwk_client()
    try:
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=AUTHENTIK_CLIENT_ID,
            issuer=discovery["issuer"],
        )
    except jwt.PyJWTError as exc:
        raise ValueError(str(exc)) from exc


async def require_user(request: Request) -> dict:
    """Dependency FastAPI : lève 401 si la session (cookie) n'est pas valide."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Authentification requise.")
    try:
        return await decode_id_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Session invalide ou expirée.")


async def optional_user(request: Request) -> Optional[dict]:
    """Dependency FastAPI : l'utilisateur connecté, ou None (sans lever d'erreur)."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        return await decode_id_token(token)
    except ValueError:
        return None
