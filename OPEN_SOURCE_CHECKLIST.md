# Open Source Release Checklist

Findings and action items for publishing this library as a standalone open source project.

---

## Blockers (must fix before release)

### 1. Add a LICENSE file

Without one, the code is legally All Rights Reserved by default. MIT is the conventional choice for a utility library — add `LICENSE` to the repo root before anything else.

### 2. Fix integration tests

`scid.integration.test.ts` has a hard-coded Windows path to a local copy of the Gigabase. This must be replaced before the repo is public.

**Recommended approach: commit small binary fixture files.**

Construct a minimal valid SCID4 and SCID5 database (2-3 short games — Fool's Mate, Scholar's Mate, etc.) by hand using the binary format specified in SPEC.md. Run a one-off fixture generator script, commit the resulting `.si4/.sn4/.sg4` and `.si5/.sn5/.sg5` files under `fixtures/`. Rewrite the integration tests to load these fixtures and assert exact known values:

```ts
expect(headers.white).toBe("White");
expect(moves[0]).toEqual({ from: "e2", to: "e4" });
```

This is far more valuable than testing against a gigabase — it verifies correctness rather than just "something was read", and it works in CI with no setup.

**Optional secondary path:** support a `SCID_TEST_DB` environment variable for those who want to run against a real large database locally. Keep this separate from the primary fixture-based tests.

### 3. Add a standalone `package.json`

The library is currently embedded inside the Obsidian plugin project. For independent publication it needs its own manifest. Minimum fields:

```json
{
  "name": "scid",
  "version": "0.1.0",
  "description": "Read SCID chess database files (.si4/.si5) in TypeScript",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "license": "MIT",
  "engines": { "node": ">=18" },
  "exports": { ".": "./dist/index.js" }
}
```

Decide on a package name (check npm for conflicts). Add `scripts` for build and test.

---

## Important (should fix before release)

### 4. Write a README

Sections needed:

- **What it is:** TypeScript library for reading SCID chess databases, supports SCID4 (.si4/.sn4/.sg4) and SCID5 (.si5/.sn5/.sg5).
- **Requirements:** Node.js 18+. The library uses `fs` and `Buffer` and is Node.js only; it does not work in browsers or Deno.
- **Installation:** `npm install <package-name>`
- **Basic usage example** (open, count games, read headers, read moves, close).
- **Known limitations** (see section below — these must be in the README).
- **Link to SPEC.md** for the binary format reference.

### 5. Document known limitations clearly

These should be stated in the README so users aren't surprised:

- **Read-only.** There is no write support. You cannot create or modify SCID databases.
- **Node.js only.** Uses `fs.readFileSync`, `fs.openSync`, `fs.readSync`, and `Buffer`. No browser support.
- **Variations are not returned.** `getMoves()` returns main-line moves only. Variation branches in annotated games are silently skipped.
- **Comments are not decoded.** `ENCODE_COMMENT` markers are recognised but the comment strings that follow the move stream are not parsed or returned.
- **`search()` is a linear scan.** It iterates every game entry and resolves names for each one. It is suitable for small-to-medium databases; on a multi-million-game database (e.g. the Gigabase) it will be slow.
- **`getMoves()` opens and closes the game file on every call.** Reading many games sequentially is less efficient than it could be; no file handle is kept open between calls.

### 6. Add `.gitignore`

At minimum exclude: `node_modules/`, `dist/`, `*.tsbuildinfo`.

### 7. Add `tsconfig.json`

The library currently relies on the parent Obsidian plugin's TypeScript configuration. A standalone project needs its own, targeting an appropriate module format for a Node.js library (e.g. `"module": "NodeNext"` or `"module": "CommonJS"` depending on whether you publish ESM).

---

## Minor / polish

### 8. Clean up SPEC.md

Around line 166 there is a "Wait — let me restate" correction mid-table left over from drafting. This should be cleaned up before the file is public — it looks rough in a public repo.

### 9. Verify codec4 coverage

`codec4.ts` provides SCID4 support but it is not clear whether it has dedicated unit tests. The unit tests in `decode.test.ts` and `board.test.ts` exercise the format-agnostic decoding layer, but the SCID4 index and namebase parsing in `codec4.ts` should have at least one integration-level test. The fixture approach (item 2 above) naturally handles this if you include a SCID4 fixture alongside the SCID5 one.

### 10. Review king-swap logic in `board.ts`

In `addPiece()`, when the king is encountered after other pieces in a FEN position, it uses `base + count` as the `absIdx` for the king. Since `count` is already the number of pieces added, this could overwrite a previously allocated slot or use an unexpected index. This should be verified carefully against SCID's `AddPiece` behaviour. The existing `decode.test.ts` FEN tests give reasonable coverage, but a dedicated board setup test for this case (king encountered mid-FEN) would add confidence.

---

## Future work (open issues, not blockers)

These are not required for a 1.0 release but worth filing as issues so users can find them:

- **Write support** — creating and modifying SCID databases
- **Variation tree decoding** — return variations as a tree rather than discarding them
- **Comment parsing** — decode and return annotation text
- **Search performance** — build an in-memory index over the namebase for fast player/event lookups

---

## Summary: order of work

1. Add `LICENSE`
2. Create fixture binary files + rewrite integration tests
3. Write `README.md`
4. Add standalone `package.json`
5. Add `.gitignore` and `tsconfig.json`
6. Clean up `SPEC.md` note-to-self
7. Verify `codec4.ts` test coverage
8. File issues for future work items
