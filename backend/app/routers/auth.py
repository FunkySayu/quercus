from __future__ import annotations

import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from .. import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])

STATE_MAX_AGE = 600  # durée de vie du cookie state/nonce pendant l'aller-retour Authentik
DEV_SESSION_MAX_AGE = 30 * 24 * 3600


def _safe_next_path(next_path: str | None) -> str:
    """N'autorise qu'un chemin relatif du site, pour éviter un open-redirect."""
    if not next_path or not next_path.startswith("/") or next_path.startswith("//"):
        return "/"
    return next_path


@router.get("/login")
async def login(request: Request, next: str = "/") -> RedirectResponse:
    if auth.DEV_AUTH:
        # Mode dev : "se connecter" = poser le cookie factice, sans passer par Authentik.
        # Non `secure`, pour fonctionner en http (localhost ou téléphone sur le réseau local).
        response = RedirectResponse(_safe_next_path(next))
        response.set_cookie(
            auth.SESSION_COOKIE,
            auth.DEV_SESSION_TOKEN,
            max_age=DEV_SESSION_MAX_AGE,
            httponly=True,
            samesite="lax",
        )
        return response
    discovery = await auth.get_discovery()
    state_token = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    state = f"{state_token}|{_safe_next_path(next)}"

    params = {
        "response_type": "code",
        "client_id": auth.AUTHENTIK_CLIENT_ID,
        "redirect_uri": auth.AUTHENTIK_REDIRECT_URI,
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
    }
    response = RedirectResponse(f"{discovery['authorization_endpoint']}?{urlencode(params)}")
    response.set_cookie(
        auth.STATE_COOKIE, state_token, max_age=STATE_MAX_AGE, httponly=True, secure=True, samesite="lax"
    )
    response.set_cookie(
        auth.NONCE_COOKIE, nonce, max_age=STATE_MAX_AGE, httponly=True, secure=True, samesite="lax"
    )
    return response


@router.get("/callback")
async def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if auth.DEV_AUTH:
        raise HTTPException(status_code=404, detail="Pas de callback OAuth en mode dev.")
    if error or not code or not state:
        raise HTTPException(status_code=400, detail=f"Authentification échouée : {error or 'paramètres manquants'}")

    try:
        state_token, next_path = state.split("|", 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="État OAuth invalide.")

    expected_state = request.cookies.get(auth.STATE_COOKIE)
    expected_nonce = request.cookies.get(auth.NONCE_COOKIE)
    if not expected_state or not secrets.compare_digest(state_token, expected_state):
        raise HTTPException(status_code=400, detail="État OAuth invalide.")

    discovery = await auth.get_discovery()
    async with httpx.AsyncClient(timeout=10) as client:
        token_response = await client.post(
            discovery["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": auth.AUTHENTIK_REDIRECT_URI,
                "client_id": auth.AUTHENTIK_CLIENT_ID,
                "client_secret": auth.AUTHENTIK_CLIENT_SECRET,
            },
        )
    if token_response.status_code != 200:
        raise HTTPException(status_code=400, detail="Échange du code OAuth échoué.")

    id_token = token_response.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="Aucun id_token reçu d'Authentik.")

    try:
        claims = await auth.decode_id_token(id_token)
    except ValueError:
        raise HTTPException(status_code=400, detail="id_token invalide.")

    if not expected_nonce or claims.get("nonce") != expected_nonce:
        raise HTTPException(status_code=400, detail="Nonce OAuth invalide.")

    max_age = max(int(claims["exp"] - time.time()), 0)
    response = RedirectResponse(_safe_next_path(next_path))
    response.set_cookie(
        auth.SESSION_COOKIE, id_token, max_age=max_age, httponly=True, secure=True, samesite="lax"
    )
    response.delete_cookie(auth.STATE_COOKIE)
    response.delete_cookie(auth.NONCE_COOKIE)
    return response


@router.get("/logout")
async def logout(request: Request) -> RedirectResponse:
    if auth.DEV_AUTH:
        response = RedirectResponse(auth.SITE_ROOT)
        response.delete_cookie(auth.SESSION_COOKIE)
        return response
    discovery = await auth.get_discovery()
    id_token = request.cookies.get(auth.SESSION_COOKIE)
    end_session_endpoint = discovery.get("end_session_endpoint")

    if end_session_endpoint:
        params = {"post_logout_redirect_uri": auth.SITE_ROOT}
        if id_token:
            params["id_token_hint"] = id_token
        target = f"{end_session_endpoint}?{urlencode(params)}"
    else:
        target = auth.SITE_ROOT

    response = RedirectResponse(target)
    response.delete_cookie(auth.SESSION_COOKIE)
    return response


@router.get("/me")
async def me(request: Request) -> dict:
    token = request.cookies.get(auth.SESSION_COOKIE)
    if not token:
        return {"authenticated": False}
    try:
        claims = await auth.decode_id_token(token)
    except ValueError:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "name": claims.get("name") or claims.get("preferred_username"),
        "email": claims.get("email"),
    }
