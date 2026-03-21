# scid-ts

A TypeScript library for reading [SCID](http://scid.sourceforge.net/) chess databases. Supports both SCID4 (`.si4`/`.sn4`/`.sg4`) and SCID5 (`.si5`/`.sn5`/`.sg5`) formats.

## Requirements

Node.js 18 or later, or Bun. The library uses `fs` and `Buffer` — it does not work in browsers.

## Installation

```bash
npm install scid-ts
```

## Usage

```ts
import { ScidDatabase } from "scid-ts";

const db = new ScidDatabase();

// Open a database — pass the path to the index file (.si4 or .si5)
db.open("/path/to/database.si5");

// Count games
const total = db.getGameCount();
console.log(`${total} games`);

// Read headers for a game (0-based index)
const headers = db.getHeaders(0);
console.log(`${headers.white} vs ${headers.black}, ${headers.date}, ${headers.result}`);
// → "Kasparov, G vs Karpov, A, 1985.09.03, 1-0"

// Read moves for a game
const moves = db.getMoves(0);
for (const move of moves) {
  console.log(`${move.from}-${move.to}${move.promotion ? "=" + move.promotion : ""}`);
}
// → "e2-e4", "e7-e5", ...

// Read headers and moves together
const game = db.getGame(0);
console.log(game.headers.eco);
console.log(game.moves.length, "moves");

// Read with comments, NAGs, and variations
const annotated = db.getAnnotatedGame(0);
if (annotated.comment) console.log(`{${annotated.comment}}`); // pre-game comment
for (const move of annotated.moves) {
  console.log(`${move.from}-${move.to}`);
  if (move.commentBefore) console.log(`  before: {${move.commentBefore}}`);
  if (move.commentAfter) console.log(`  after: {${move.commentAfter}}`);
  if (move.nags) console.log(`  NAGs: ${move.nags.join(", ")}`);
  if (move.variations) {
    for (const variation of move.variations) {
      console.log("  variation:", variation.map(m => `${m.from}-${m.to}`).join(" "));
    }
  }
}

// Search games by player, event, site, or ECO (case-insensitive substring)
const results = db.search("Kasparov", 0, 20);
console.log(`${results.total} matching games`);
for (const idx of results.results) {
  const h = db.getHeaders(idx);
  console.log(`Game ${idx}: ${h.white} vs ${h.black}`);
}

db.close();
```

### Types

```ts
interface ScidGameHeaders {
  white: string;
  black: string;
  event: string;
  site: string;
  round: string;
  date: string;    // "YYYY.MM.DD", unknown parts replaced with "??"
  result: string;  // "1-0", "0-1", "1/2-1/2", or "*"
  whiteElo: number;
  blackElo: number;
  eco: string;     // e.g. "B20", "E97a"
}

interface ScidMove {
  from: string;        // e.g. "e2"
  to: string;          // e.g. "e4"
  promotion?: string;  // "q", "r", "b", or "n" if a promotion
}

interface ScidGame {
  headers: ScidGameHeaders;
  moves: ScidMove[];
}

interface ScidAnnotatedMove extends ScidMove {
  commentBefore?: string;          // comment appearing before this move
  commentAfter?: string;           // comment appearing after this move
  nags?: number[];                 // numeric annotation glyphs (1=!, 2=?, 6=?!, etc.)
  variations?: ScidAnnotatedMove[][];
}

interface ScidAnnotatedGame {
  headers: ScidGameHeaders;
  moves: ScidAnnotatedMove[];
  comment?: string;                // pre-game comment (before move 1)
  extraTags: [string, string][];   // non-standard PGN tags (Annotator, TimeControl, etc.)
  startFen?: string;               // custom start position, absent if standard
}
```

## Known limitations

- **Read-only.** There is no write support. You cannot create or modify SCID databases.
- **No browser support.** Uses `fs.readFileSync`, `fs.openSync`, `fs.readSync`, and `Buffer`. Works on Node.js 18+ and Bun.
- **`getMoves()` returns main-line moves only.** Use `getAnnotatedGame()` to get variations and comments.
- **`search()` is a linear scan.** It iterates every game entry and resolves names for each one. It works fine for small-to-medium databases; on a multi-million-game database (e.g. the Gigabase) it will be slow.
- **`getMoves()` and `getAnnotatedGame()` open and close the game file on every call.** Reading many games sequentially is less efficient than it could be.

## Binary format reference

See [SPEC.md](SPEC.md) for documentation of the SCID4 and SCID5 binary formats.

## License

MIT
