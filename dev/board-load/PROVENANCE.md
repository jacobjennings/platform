# Harness client provenance

The two files in `vendor/` are unchanged copies from the clean `main` checkout
of `/home/jakej/gh/jake-harness` at
`90545543416a9a2702ef3c89999cf0967280e726`.

The load driver must inject a local native connection and explicit configuration.
It must never use the default configuration reader or SSH transport.
Snapshot data, credentials, CPU profiles, and raw results stay local and ignored.
