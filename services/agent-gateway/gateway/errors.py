"""The one error vocabulary shared by both transports.

Codes and their HTTP mappings are fixed by the wire contract (PoseTek-mobile-app
docs/LLM_GATEWAY_CONTRACT.md section 7). The iOS client switches on `code`, so a
code is an API surface: add freely, never rename.
"""

from __future__ import annotations


class GatewayError(Exception):
    """Any failure the client is allowed to see, with a contract error code."""

    def __init__(self, code: str, message: str, http_status: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status if http_status is not None else HTTP_STATUS.get(code, 500)

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message}


HTTP_STATUS: dict[str, int] = {
    "unauthenticated": 401,
    "app_check_failed": 401,
    "permission_denied": 403,
    "capability_disabled": 503,
    "quota_exceeded": 429,
    "invalid_request": 400,
    "client_too_old": 426,
    "context_unavailable": 422,
    "validation_failed": 502,
    "provider_error": 502,
    "internal": 500,
}


def unauthenticated(msg: str = "Missing or invalid ID token") -> GatewayError:
    return GatewayError("unauthenticated", msg)


def permission_denied(msg: str = "Not authorized for this athlete") -> GatewayError:
    return GatewayError("permission_denied", msg)


def invalid_request(msg: str) -> GatewayError:
    return GatewayError("invalid_request", msg)


def context_unavailable(msg: str) -> GatewayError:
    return GatewayError("context_unavailable", msg)
