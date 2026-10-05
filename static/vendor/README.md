Vega 5.30.0 and Vega-Lite 5.21.0 are pinned upstream browser distributions (BSD-3-Clause).

Sources:
- https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js
- https://cdn.jsdelivr.net/npm/vega-lite@5.21.0/build/vega-lite.min.js

They are served locally for participant previews and also loaded by the isolated Node compiler subprocess. No participant CDN request is required. Node.js is required for Vega-Lite evaluation; the Docker image installs it.
