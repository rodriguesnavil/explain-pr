## What this PR does

**Handlers can now call `request.send_early_hints(...)` to send a 103 Early Hints response before the real one, and both `BaseHTTPMiddleware` and `GZipMiddleware` now pass those hints through instead of breaking on or dropping them.**

It's a new public method on `Request`, plus two pieces of plumbing so the method actually reaches the server. Class-based endpoints now give their `Request` a real `send` channel, and the two middlewares that sit between the app and the server learn about the `http.response.early_hint` ASGI message. Without the server's extension, the method does nothing.

<sub>encode/starlette #3435 · 10 files · +240 −9 · effort 2/5</sub>

### Intent vs code <sub>(from commit messages)</sub>

| | Claim | Note |
|---|---|---|
| ✅ | Add HTTP Early Hints support | `Request.send_early_hints` sends `http.response.early_hint` with the links encoded as latin-1 bytes. |
| ✅ | Make Early Hints links positional | Signature is `send_early_hints(link, /, *additional_links)`: at least one link, no keywords. |
| ✅ | Assert no Early Hints are sent without the extension | The method checks `scope["extensions"]` and returns silently when the server doesn't advertise the extension. |
| ✅ | Group GZip passthrough events | `early_hint` joins `trailers` in the same pass-through branch of `IdentityResponder.send`. |
| ➖ | (not stated) Class-based endpoints get a send channel | `HTTPEndpoint.dispatch` now passes `send=self.send`. That also makes `request.send_push_promise` work in `HTTPEndpoint`s, where it used to raise. |

### Architecture impact

No new modules or dependencies. The change adds one public API and teaches the request path (endpoint → middleware → server) about one more ASGI message type that can arrive before `http.response.start`.

- **🟢 added api:** `Request.send_early_hints(link, *additional_links)` — New public coroutine; a no-op unless the server advertises the `http.response.early_hint` extension.
- **🟠 changed boundary:** `HTTPEndpoint` requests can write to the response channel — The endpoint's `Request` now holds the real ASGI `send`, not the raising `empty_send`.
- **🟠 changed module:** `BaseHTTPMiddleware` forwards pre-response messages — It now reads messages in a loop until the response start, forwarding early hints to the server and recording debug info.
- **🟠 changed module:** `GZipMiddleware` passes early hints through — Before, an `early_hint` message matched no branch and was silently dropped.

```mermaid
flowchart TD
  subgraph n_layer_app["App code"]
    n_handler["Your handler"]
  end
  subgraph n_layer_fw["Starlette"]
    n_endpoint["HTTPEndpoint (changed)"]
    n_request["Request (changed)"]
  end
  subgraph n_layer_mw["Middleware"]
    n_base["BaseHTTPMiddleware (changed)"]
    n_gzip["GZipMiddleware (changed)"]
  end
  subgraph n_layer_server["Server"]
    n_asgi{{"ASGI server"}}
  end
  n_handler -->|"send_early_hints()"| n_request
  n_endpoint -->|"passes send"| n_request
  n_request -->|"early_hint"| n_base
  n_request -->|"early_hint"| n_gzip
  n_base -->|"forwarded"| n_asgi
  n_gzip -->|"passed through"| n_asgi
  linkStyle 0 stroke:#16a34a,stroke-width:2px
  linkStyle 1 stroke:#d97706,stroke-width:2px
  linkStyle 2 stroke:#16a34a,stroke-width:2px
  linkStyle 3 stroke:#16a34a,stroke-width:2px
  linkStyle 4 stroke:#16a34a,stroke-width:2px
  linkStyle 5 stroke:#16a34a,stroke-width:2px
  classDef added fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef removed fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-dasharray:4 4
  classDef changed fill:#fef3c7,stroke:#d97706,color:#78350f
  class n_endpoint,n_request,n_base,n_gzip changed
```

| Convention | Source | Status | Note |
|---|---|---|---|
| After each heading, include text explaining the section before any code snippets | AGENTS.md | ✅ follows | docs/early-hints.md opens each section with prose before its example. |

### Flow: Through BaseHTTPMiddleware

A handler sends one hint, then returns a response, behind a `BaseHTTPMiddleware`.

**Server supports early hints** — The 103 goes out first, then the normal response.

<details><summary>Before this change</summary>

```mermaid
sequenceDiagram
  participant n_handler as Handler
  participant n_mw as BaseHTTPMiddleware
  participant n_server as ASGI server
  n_handler->>n_mw: http.response.early_hint
  n_mw->>n_mw: treats it as the response start ✖ ⚠
  n_mw->>n_server: broken response ✖ ⚠
```
</details>

```mermaid
sequenceDiagram
  participant n_handler as Handler
  participant n_mw as BaseHTTPMiddleware
  participant n_server as ASGI server
  n_handler->>n_mw: http.response.early_hint
  n_mw->>n_server: http.response.early_hint 🆕
  Note over n_server: forwarded immediately, loop continues
  n_handler->>n_mw: http.response.start 🆕
  n_mw->>n_server: http.response.start 🆕
  n_mw->>n_server: http.response.body 🆕
```

**Server without the extension** — Same as a request without hints: the call is a silent no-op.

```mermaid
sequenceDiagram
  participant n_handler as Handler
  participant n_mw as BaseHTTPMiddleware
  participant n_server as ASGI server
  n_handler->>n_handler: send_early_hints() returns, nothing sent
  n_handler->>n_mw: http.response.start
  n_mw->>n_server: http.response.start
  n_mw->>n_server: http.response.body
```

### Decisions made

- **No-op without the server extension.** Chose silently skip over raising an error. Handlers can call it unconditionally; only servers that advertise `http.response.early_hint` receive anything. <sub>`starlette/requests.py:351`</sub>
- **Positional-only links.** Chose `link, /, *additional_links` over a list argument or keywords. At least one link is required by the signature itself. Each link is a full `Link` header value. <sub>`starlette/requests.py:350`</sub>
- **Forward hints inside the middleware's read loop.** Chose a `while True` loop that forwards `early_hint` and keeps reading over buffering them until the response starts. Hints are useful only if they reach the client before the response, so they go to the server as soon as they arrive. <sub>`starlette/middleware/base.py:156-165`</sub>

### Worth a closer look

- **[Subtle] BaseHTTPMiddleware now reads any number of pre-response messages** — The old code read one message, plus one more only if the first was a debug message. Now it loops past every `debug` and `early_hint` message until something else arrives. _(step 2)_
- **[Behaviour change] `send_push_promise` now works in `HTTPEndpoint`s** — It's a side effect of passing `send`: before, the endpoint's Request held `empty_send`, which raises when called. _(step 1)_

### Walkthrough

| Step | What | Files |
|---|---|---|
| 1 | **Add `send_early_hints` and give endpoint requests a send channel** — `Request.send_early_hints` encodes each link as latin-1 and sends one `http.response.early_hint` message, but only when the scope's extensions include it. `HTTPEndpoint.dispatch` now builds its Request with `send=self.send`, so the call can reach the server. | `starlette/requests.py`<br>`starlette/endpoints.py` |
| 2 | **Let `BaseHTTPMiddleware` forward hints while it waits for the response** — `_CachedRequest` now takes `send` like `Request` does. The read of the app's first message becomes a loop: `debug` messages are recorded, `early_hint` messages are sent straight to the server, and the first other message ends the loop as before. | `starlette/middleware/base.py` |
| 3 | **Pass early hints through GZip untouched** — `IdentityResponder.send` groups `http.response.early_hint` with `http.response.trailers` in the branch that forwards the message as-is. | `starlette/middleware/gzip.py` |
| 4 | **Test the method, the endpoint, and both middlewares** — Each test sends a hint and asserts the message order the server sees: `early_hint` first, then `http.response.start`, then the body. Two request tests cover the no-extension and no-send-channel cases. | `tests/test_requests.py`<br>`tests/test_endpoints.py`<br>`tests/middleware/test_base.py`<br>`tests/middleware/test_gzip.py` |

### What stopped happening

- GZipMiddleware no longer drops `http.response.early_hint` messages — They used to match no branch in `IdentityResponder.send`. <sub>`starlette/middleware/gzip.py`</sub>
- Requests in `HTTPEndpoint` no longer hold the raising `empty_send` — They get the real `send`. <sub>`starlette/endpoints.py`</sub>

<details><summary>Files you can skip</summary>

- **Docs** — A usage page for the new method and its nav entry.: `docs/early-hints.md`, `mkdocs.yml`

</details>

<details><summary>Not verified (needs running the code)</summary>

- What a real server (Hypercorn, Granian) sends to the browser for these messages; the tests use fake send callables.
- Exactly how the old `BaseHTTPMiddleware` would have failed on an early hint arriving first.

</details>

<sub>Generated by [explain-pr](https://github.com/rodriguesnavil/explain-pr) at 1677452.</sub>
