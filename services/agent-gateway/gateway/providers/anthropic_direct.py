"""Claude via the first-party Claude API (`anthropic.Anthropic`).

Why this exists beside anthropic_vertex.py: project `kickai-69dd0` has zero
granted Vertex quota for every Anthropic base model, and Google auto-denies
self-service increases (03A review, 2026-09-06). The first-party API's entry
tier is 1,000 req/min and 2M input tokens/min per model - roughly 13x the
generator's measured peak - so this is the path that actually runs.

Credentials resolve the way the SDK documents (first match wins):
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, an `ant auth login` profile, then
Workload Identity Federation env vars. On Cloud Run the key is mounted from
Secret Manager (`--set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest`);
nothing here ever reads or logs the value. The request surface after the
client is constructed is identical to the Vertex adapter, so this subclass
overrides only the client factory and the ledger/provider name.

Pricing differs from Vertex in two ways the ledger cares about (usage.py):
no regional 1.10x multiplier (first-party is global by default), and Claude
4.6+ is flat across the full 1M context - the >200k tier is partner-only.
"""

from __future__ import annotations

from gateway.errors import GatewayError
from gateway.providers.anthropic_vertex import AnthropicVertexProvider


def _client():
    try:
        from anthropic import Anthropic
    except ImportError as exc:  # pragma: no cover - exercised only when the SDK is missing
        raise GatewayError("provider_error", f"anthropic is not available: {exc}") from exc
    try:
        # max_retries=0: ProviderCall meters every request, and an SDK-internal
        # retry would be an unmetered, unlogged model call. Same as Vertex.
        return Anthropic(max_retries=0, timeout=120)
    except Exception as exc:
        # The SDK raises at construction when no credential source resolves.
        raise GatewayError("provider_error", f"Claude API credentials are not configured: {exc}") from exc


class AnthropicDirectProvider(AnthropicVertexProvider):
    name = "anthropic_direct"
    label = "Claude API"

    def _make_client(self):
        return _client()
