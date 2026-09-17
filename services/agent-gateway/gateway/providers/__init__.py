"""Provider adapters: one thin class per model SDK (plan Part 1, Principle 3
— "a thin provider adapter, not a framework"). This package's `__init__`
stays empty on purpose: importing `gateway.providers` must never touch an
SDK, only `gateway.providers.get_provider(name)` does, and only at call time.
"""
