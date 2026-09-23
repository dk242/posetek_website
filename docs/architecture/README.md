# Website architecture diagrams

These diagrams describe the current website source and production routing, not the
older `hypothesis_*` experiments.

- `website-component-interactions.puml` shows build entries, route-level React
  components, shared client modules, and Firebase/server interactions.
- `website-user-flow.puml` shows the literal post-login role decision order,
  default destinations, `returnTo` behavior, and the main navigation surfaces for
  players, independent coaches, canonical club staff, and PoseTek admins.

The sources were validated with PlantUML 1.2026.8. Regenerate a local preview
with `plantuml -charset UTF-8 -tsvg <file>.puml` (or `-tpng` for PNG). Rendered
output is intentionally not tracked with the website source.
