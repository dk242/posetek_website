"""Identity verification and the one shared player-access authorization
function (contract §1; plan Part 3: "solve it once").

`authorize_player_access` mirrors the app's own resolution — `UserStore.
queryPlayers()`'s cascade (signupEmail -> authenticationUID -> userUID ->
Auth-UID fallback), see FIREBASE_INTEGRATION.md in the mobile repo — plus the
coach-roster path. Every capability and every model-callable tool must go
through this one function so authorization logic is never forked per feature.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional

from gateway.errors import GatewayError, permission_denied, unauthenticated

logger = logging.getLogger(__name__)

_firebase_app = None


def _ensure_firebase_app():
    """Initializes the default `firebase_admin` app exactly once, lazily.

    Deferred past import time (and past module load of this file) so a broken
    `firebase-admin` install or missing ADC only breaks the first authenticated
    request, not process boot — `/health` must still answer either way.
    """
    global _firebase_app
    if _firebase_app is None:
        try:
            import firebase_admin
        except ImportError as exc:  # pragma: no cover - exercised only if the SDK is missing
            raise GatewayError("internal", f"firebase-admin is not available: {exc}") from exc
        # Cloud Run's service-account ADC is sufficient; no service-account
        # JSON is shipped with the image (plan's "no API keys anywhere," and
        # by extension no bundled credentials either).
        try:
            _firebase_app = firebase_admin.get_app()
        except ValueError:
            _firebase_app = firebase_admin.initialize_app()
    return _firebase_app


@dataclass
class AuthContext:
    uid: str
    email: Optional[str]
    claims: dict = field(default_factory=dict)


def _header(headers: Mapping[str, Any], name: str) -> Optional[str]:
    """Case-insensitive header lookup that also works for a plain dict (tests
    pass plain dicts; `werkzeug`'s real `Headers` is already case-insensitive).
    """
    if hasattr(headers, "get"):
        value = headers.get(name)
        if value is not None:
            return value
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _bearer_token(headers: Mapping[str, Any]) -> str:
    auth = _header(headers, "Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise unauthenticated()
    token = auth[len("Bearer "):].strip()
    if not token:
        raise unauthenticated()
    return token


def verify_request(headers: Mapping[str, Any]) -> AuthContext:
    """Verifies the Firebase Auth ID token (always) and the App Check token
    (only when `APP_CHECK_ENFORCED=1`) per contract §1.

    App Check is advisory outside production: debug builds present a debug
    token via `AppCheckDebugProviderFactory`, and hard-failing on it before
    the product has real traffic to police is the wrong trade.
    """
    _ensure_firebase_app()
    from firebase_admin import auth as fb_auth

    token = _bearer_token(headers)
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as exc:
        raise unauthenticated(f"ID token verification failed: {exc}") from exc

    if os.environ.get("APP_CHECK_ENFORCED") == "1":
        app_check_token = _header(headers, "X-Firebase-AppCheck")
        if not app_check_token:
            raise GatewayError("app_check_failed", "Missing App Check token")
        try:
            from firebase_admin import app_check

            app_check.verify_token(app_check_token)
        except Exception as exc:
            raise GatewayError("app_check_failed", f"App Check verification failed: {exc}") from exc

    uid = decoded.get("uid")
    if not uid:
        raise unauthenticated("Decoded token missing uid")
    return AuthContext(uid=uid, email=decoded.get("email"), claims=decoded)


def _normalized_email(value: Optional[str]) -> Optional[str]:
    return value.strip().lower() if isinstance(value, str) and value.strip() else None


def _club_player_access(db, uid, player_id, player, *, trusted_claims=None, mutation=False, read=None):
    """Strict migrated-club boundary; legacy rollout flags never relax it.

    This helper is deliberately scoped to documents carrying organizationId.
    Unmigrated athletes retain the serving revision's authorization behavior.
    """
    if not isinstance(uid, str) or not uid or "/" in uid:
        raise permission_denied("Invalid requesting identity")
    claims = {} if trusted_claims is None else trusted_claims
    if not isinstance(claims, Mapping):
        raise permission_denied("Invalid trusted identity claims")
    identities = [claims[key] for key in ("uid", "sub", "user_id") if key in claims]
    if any(identity != uid for identity in identities):
        raise permission_denied("Identity does not match the invocation")
    provider = claims.get("firebase", {})
    if not isinstance(provider, Mapping) or provider.get("sign_in_provider") == "anonymous":
        raise permission_denied("A registered account is required")
    staff_email = _normalized_email(claims.get("email")) or ""
    if re.fullmatch(r"[a-z0-9._%+-]+@posetek\.net", staff_email):
        if claims.get("email_verified") is not True:
            raise permission_denied("Staff email verification is required")
        if identities:
            return "admin"
    owners = [player[key] for key in ("authenticationUID", "userUID") if key in player]
    if any(not isinstance(owner, str) or not owner for owner in owners) or len(set(owners)) > 1:
        raise permission_denied("Player identity requires reconciliation")
    if (owners and all(owner == uid for owner in owners)) or (not owners and player_id == uid):
        return "athlete"
    org = player.get("organizationId")
    if not isinstance(org, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", org):
        raise permission_denied("Club membership requires administrator repair")
    if not mutation:
        ref = db.collection("organizations").document(org).collection("members").document(uid)
        snap = read(ref) if read else ref.get()
        member = (snap.to_dict() or {}) if snap.exists else {}
        teams = member.get("teamIds")
        active = (member.get("userUID") == uid and member.get("status") == "active"
                  and member.get("role") in ("manager", "coach") and isinstance(teams, list)
                  and all(isinstance(team, str) and team for team in teams))
        if active and (member["role"] == "manager" or player.get("teamId") in teams):
            return "coach"
    raise permission_denied("Only the athlete or a verified admin may edit this workout" if mutation
                            else "Not authorized for this athlete's club team")


def authorize_player_access(db, uid: str, email: Optional[str], player_id: str, *, trusted_claims: Optional[Mapping[str, Any]] = None) -> Optional[str]:
    """Raises `GatewayError("permission_denied")` unless `uid` may act for
    `player_id`, per contract §1:

    0. Verified staff admin: trusted claims match the invocation UID and have
       an email_verified literal true and the exact posetek.net email domain.
       This grants the existing capability scope, never a log/rep write tool.
    1. Player self-access: `players/{player_id}` matches `uid` on
       `authenticationUID`, `userUID`, a case-insensitive `signupEmail`, or
       `player_id == uid` (the Auth-UID fallback signup path).
    2. Coach -> roster: a `coaches` doc with `userUID == uid` that either lists
       `player_id` in its `members` array or shares the player's
       `organizationCode` (older docs predate org codes, so `members` is the
       path real coach data actually takes).

    Enforcement is gated on `AUTHZ_ENFORCED=1`. While unset (pre-launch, no
    real athlete data), a caller the check would have denied is allowed
    through with a warning log — so the logs accumulate evidence of what
    strict mode will reject before it starts rejecting.

    Returns `"admin"` only for the already-verified staff branch below; other
    authorized callers retain `None`. The quota shell uses this marker without
    changing any released player/coach authorization policy.
    """
    if not player_id:
        raise GatewayError("invalid_request", "player_id is required")

    player_snap = db.collection("players").document(player_id).get()
    player = (player_snap.to_dict() or {}) if player_snap.exists else {}
    if "organizationId" in player:
        return _club_player_access(db, uid, player_id, player, trusted_claims=trusted_claims)

    # Staff authority comes only from verified transport/server claims, never
    # the legacy email argument or requestedByEmail in a client-created job.
    # Reject identity disagreement even when the legacy rollout flag is off.
    if trusted_claims is not None:
        if not isinstance(trusted_claims, Mapping):
            raise permission_denied("Invalid trusted identity claims")
        identities = [trusted_claims[key] for key in ("uid", "sub", "user_id") if key in trusted_claims]
        if any(identity != uid for identity in identities):
            raise permission_denied("Identity does not match the invocation")
        staff_email = _normalized_email(trusted_claims.get("email"))
        local, _, domain = (staff_email or "").rpartition("@")
        if (uid and identities and local and "@" not in local and domain == "posetek.net"
                and trusted_claims.get("email_verified") is True):
            return "admin"

    try:
        _check_player_access(db, uid, email, player_id, _snapshot=player_snap)
    except GatewayError:
        if os.environ.get("AUTHZ_ENFORCED") == "1" or not uid:
            raise
        logger.warning(
            "authz relaxed: uid %s allowed for player %s (strict mode would deny)",
            uid,
            player_id,
        )


def _check_player_access(db, uid: str, email: Optional[str], player_id: str, *, _snapshot=None) -> None:
    """The strict check `authorize_player_access` gates on `AUTHZ_ENFORCED`."""
    if not uid:
        raise permission_denied()

    player_snap = _snapshot if _snapshot is not None else db.collection("players").document(player_id).get()
    player = (player_snap.to_dict() or {}) if player_snap.exists else {}
    if "organizationId" in player:
        _club_player_access(db, uid, player_id, player)
        return
    if player_id == uid:
        return

    if not player_snap.exists:
        # Deliberately the same error as "found but not yours" — don't leak
        # player existence to an unauthorized caller.
        raise permission_denied()
    player = player_snap.to_dict() or {}

    norm_email = _normalized_email(email)
    if (
        player.get("authenticationUID") == uid
        or player.get("userUID") == uid
        or (norm_email is not None and _normalized_email(player.get("signupEmail")) == norm_email)
    ):
        return

    org_code = player.get("organizationCode")
    coach_docs = db.collection("coaches").where("userUID", "==", uid).limit(1).stream()
    for coach_snap in coach_docs:
        coach = coach_snap.to_dict() or {}
        members = coach.get("members")
        if isinstance(members, list) and player_id in members:
            return
        if org_code and coach.get("organizationCode") == org_code:
            return

    raise permission_denied()


def resolve_job_identity(uid: str, *, include_provider=False) -> AuthContext:
    """Resolve Transport A identity using Admin Auth, never client job fields."""
    _ensure_firebase_app()
    from firebase_admin import auth
    try:
        user = auth.get_user(uid)
    except Exception as exc:
        raise unauthenticated("Unable to resolve the requesting account") from exc
    if user.disabled:
        raise unauthenticated("The requesting account is disabled")
    claims = {
        "uid": user.uid, "email": user.email, "email_verified": bool(user.email_verified),
    }
    if include_provider:
        registered = bool(user.provider_data or user.email or user.phone_number)
        claims['firebase'] = {'sign_in_provider': 'registered' if registered else 'anonymous'}
    return AuthContext(uid=user.uid, email=user.email, claims=claims)


def authorize_v3(inv, mutation: bool = False, read=None) -> str:
    """Unconditionally enforce v3 access and the narrower player/admin edit role.

    The read callback accepts document references and queries, so transactional
    callers recheck identity relationships on the same snapshot as the write.
    """
    def load(ref):
        return read(ref) if read else (list(ref.stream()) if hasattr(ref, "stream") else ref.get())
    if not inv.uid:
        raise unauthenticated()
    snap = load(inv.player_ref())
    player = (snap.to_dict() or {}) if snap.exists else {}
    if "organizationId" in player:
        return _club_player_access(inv.db, inv.uid, inv.player_id, player,
                                  trusted_claims=inv.trusted_claims, mutation=mutation, read=read)
    claims = inv.trusted_claims or {}
    claim_uid = claims.get("uid") or claims.get("sub") or claims.get("user_id")
    if claim_uid and claim_uid != inv.uid:
        raise permission_denied("Identity does not match the invocation")
    email = _normalized_email(claims.get("email"))
    if email and email.endswith("@posetek.net"):
        if claims.get("email_verified") is not True:
            raise permission_denied("Staff email verification is required")
        return "admin"
    if not player:
        raise permission_denied()
    if (inv.player_id == inv.uid or player.get("authenticationUID") == inv.uid
            or player.get("userUID") == inv.uid
            or (email is not None and claims.get("email_verified") is True
                and _normalized_email(player.get("signupEmail")) == email)):
        return "athlete"
    if not mutation:
        for cs in load(inv.db.collection("coaches").where("userUID", "==", inv.uid)):
            coach = cs.to_dict() or {}
            if (inv.player_id in (coach.get("members") or [])
                    or (player.get("organizationCode") and coach.get("organizationCode") == player.get("organizationCode"))):
                return "coach"
    raise permission_denied("Only the athlete or a verified admin may edit this workout" if mutation else "Not authorized for this athlete")
