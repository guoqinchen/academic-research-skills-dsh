# Optional Jev tools

These tools add optional TypeSafe/Jev judgments on top of the deterministic
adapter. They are **not** imported by the host bundle and do not add a runtime
dependency. They require a user-supplied `TYPESAFE_API_KEY`.

The tools call:

```
POST https://api.typesafe.ai/v1/systemone
model: jev-latest
```

Jev returns probabilities; the code below owns every threshold and every
decision. A failed API call is an error, never a "no" answer.

## Citation-support check

```sh
TYPESAFE_API_KEY=... node tools/jev-citation-support.mjs --input citations.jsonl
```

Input rows:

```json
{"id":"c1","claim":"The trial reduced mortality.","source":{"passage":"...","locator":"Results, p. 4"}}
```

Output adds `noul` and a code verdict:

- `>= 0.70` → `supported`
- `<= 0.30` → `unsupported`
- otherwise → `unresolved` (send to a human)

`--strict` exits 1 when any row is unsupported or unresolved. This is an
advisory layer; it does not replace the citation gate.

## Screening aid

```sh
TYPESAFE_API_KEY=... node tools/jev-screening-assist.mjs --input records.jsonl
```

Input rows contain `id`, `title`, `abstract`, and a non-empty `criteria`
array. Each criterion is judged independently. The output is **advisory only**:
`likely_meet`, `likely_not_meet`, or `unresolved`. It never emits the final
include/exclude decision and must not replace the dual-review + adjudication
workflow.

## Upstream triage

```sh
node tools/check-upstream.mjs --ref main --json > /tmp/upstream.json
TYPESAFE_API_KEY=... node tools/jev-upstream-triage.mjs \
  --diff /tmp/upstream.json --upstream /path/to/upstream
```

The tool classifies each changed path as `runtime_contract`,
`documentation`, `test_only`, or `unknown`, then sorts runtime changes first.
The classification is advisory; `tools/build-payload.mjs` remains the
deterministic source of truth for the rebuild.

## Data and testing

- Send only the claim/source, record/criteria, or diff excerpt needed for the
  judgment. Do not send credentials, reviewer identities, or unpublished data
  without permission.
- CI does not call TypeSafe. `test/jev-tools.test.mjs` uses an injected client.
- Keep the API key server-side; never commit it or place it in the payload.
