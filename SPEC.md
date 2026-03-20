# SCID Binary Format Specification

Reference for the SCID4 (.si4/.sn4/.sg4) and SCID5 (.si5/.sn5/.sg5) database formats.
Derived from the Scid vs PC source code (github.com/benini/scid).

## Squares

A1=0, B1=1, ..., H1=7, A2=8, ..., H8=63.
File = sq & 7, Rank = sq >> 3.

## Piece Types

KING=1, QUEEN=2, ROOK=3, BISHOP=4, KNIGHT=5, PAWN=6, EMPTY=7.
Colors: WHITE=0, BLACK=1.

## Piece List

Each side has up to 16 pieces, stored in a list indexed 0-15.
Index 0 is always the king.

**Standard position** uses a hardcoded order (matching getStdStart() in SCID):
White: K(e1), R(a1), N(b1), B(c1), Q(d1), B(f1), N(g1), R(h1), P(a2)..P(h2)
Black: K(e8), R(a8), N(b8), B(c8), Q(d8), B(f8), N(g8), R(h8), P(a7)..P(h7)

**FEN positions** use AddPiece encounter order: pieces are added in FEN
reading order (rank 8 down to rank 1, left to right). The king is swapped
to index 0 when encountered.

---

## Game File Format (.sg4 / .sg5)

The game file format is **identical** between SCID4 and SCID5. Each game's
data is a variable-length byte sequence at the offset/length specified by
the index entry.

### 1. Extra Tags

Sequence of non-standard PGN tag pairs. Each tag:
- 1 byte: tag name length (if > 240, it's a "common tag" code — see below)
- N bytes: tag name string (not null-terminated)
- 1 byte: tag value length (if > 240, extended: (byte-240)*256 + next byte)
- N bytes: tag value string (not null-terminated)

Terminated by a 0x00 byte (zero-length tag name).

Common tag codes (length byte > 240):
241=Annotator, 242=PlyCount, 243=EventType, 244=EventRounds,
245=EventCountry, 246=EventCategory, 247=Source, 248=SourceDate,
249=TimeControl, 250=Board, 251=Opening, 252=Variation, 253=SubVariation,
254=Section, 255=Stage.

### 2. Start Board

1 flag byte. Bit 0: custom start position. If set, a null-terminated FEN
string follows. Otherwise, standard starting position.

### 3. Move Data

Stream of encoded move bytes, interspersed with special markers.

#### Move Byte Encoding

Each move byte: upper 4 bits = piece index (0-15 in side-to-move's piece
list), lower 4 bits = type-specific code.

**King** (codes 0-10):
- 0: null move (king stays in place)
- 1-8: direction offsets. The king difference table maps code→square delta:
  1→SW(-9), 2→S(-8), 3→SE(-7), 4→W(-1), 5→E(+1), 6→NW(+7), 7→N(+8), 8→NE(+9)
- 9: queenside castling (O-O-O)
- 10: kingside castling (O-O)

**Queen** (codes 0-15):
- 0-7: move to file N on same rank (like rook horizontal)
- 8-15: move to rank (N-8) on same file (like rook vertical)
- If the code equals the queen's own file: diagonal move → read a second byte.
  Second byte = destination square + 64.

**Rook** (codes 0-15):
- 0-7: move to file N (same rank)
- 8-15: move to rank (N-8) (same file)

**Bishop** (codes 0-15):
- 0-7: move to file N along up-right/down-left diagonal
- 8-15: move to file (N-8) along up-left/down-right diagonal

**Knight** (codes 0-15, but only 1-8 used):
- Offset table: 1→-17, 2→-15, 3→-10, 4→-6, 5→+6, 6→+10, 7→+15, 8→+17

**Pawn** (codes 0-15):
- 0: capture left (no promotion)
- 1: forward one square (no promotion)
- 2: capture right (no promotion)
- 3-5: queen promotion (3=cap-left, 4=forward, 5=cap-right)
- 6-8: rook promotion
- 9-11: bishop promotion
- 12-14: knight promotion
- 15: forward two squares (double push)

"Left" and "right" are from the moving side's perspective (White: left=A-side,
right=H-side; Black: left=H-side, right=A-side).

#### Special Markers

When piece index = 0 and code is 11-15 (i.e., byte values 0x0B-0x0F for
piece 0, but actually these are encoded as dedicated values where the
upper nibble encodes the marker type):

Actually, special markers use **fixed byte values** where the byte's upper
nibble is 0 (piece index 0 = king) and lower nibble is the code:

- Byte with piece=0, code=11 → but this conflicts with king code 0-10.

Correction: Special markers are encoded differently. The piece index in
the upper nibble combined with codes 11-15 in the lower nibble indicates
a special token. Since the king only uses codes 0-10, codes 11-15 for
piece index 0 are available as special markers:

- 0x0B (piece 0, code 11): NAG — next byte is the NAG value
- 0x0C (piece 0, code 12): Comment — a null-terminated comment string
  follows later in the comment section
- 0x0D (piece 0, code 13): Start variation
- 0x0E (piece 0, code 14): End variation
- 0x0F (piece 0, code 15): End of game

### 4. Comments

After the move stream, comments are stored as null-terminated strings in
order of their appearance (matching ENCODE_COMMENT markers in the move
stream).

---

## SCID5 Index File (.si5)

No header. Array of 56-byte records (14 × uint32, little-endian).

### Record Layout (56 bytes)

| Word | Bits          | Field                    |
|------|---------------|--------------------------|
| 0    | 31:28         | nComments (4-bit coded)  |
|      | 27:0          | whiteID (28 bits)        |
| 1    | 31:28         | nVariations (4-bit coded)|
|      | 27:0          | blackID (28 bits)        |
| 2    | 31:28         | nNags (4-bit coded)      |
|      | 27:0          | eventID (28 bits)        |
| 3    | 31:0          | siteID (32 bits)         |
| 4    | 31            | chess960 flag (1 bit)    |
|      | 30:0          | roundID (31 bits)        |
| 5    | 31:20         | whiteElo (12 bits)       |
|      | 19:0          | date (20 bits)           |
| 6    | 31:20         | blackElo (12 bits)       |
|      | 19:0          | eventDate (20 bits)      |
| 7    | 31:22         | numHalfMoves (10 bits)   |
|      | 21:0          | flags (22 bits)          |
| 8    | 31:15         | gameDataSize (17 bits)   |
|      | 14:0          | offset high (15 bits)    |
| 9    | 31:0          | offset low (32 bits)     |
| 10   | 31:24         | storedLineCode (8 bits)  |
|      | 23:0          | finalMatSig (24 bits)    |
| 11   | 31:16         | homePawnCount(8) ...     |
|      | 15:10         | ratingTypes (6 bits)     |
|      | 9:8           | result (2 bits)          |
|      | 7(or 15):0    | ECO code (16 bits)       |

Wait — let me restate word 11 more carefully:

| Word | Bits  | Field                                              |
|------|-------|----------------------------------------------------|
| 11   | 31:24 | homePawnData[0] (count byte)                       |
|      | 23:18 | whiteEloType(3) + blackEloType(3)                  |
|      | 17:16 | result (2 bits)                                    |
|      | 15:0  | ECO code (16 bits)                                 |

| 12-13 | 64 bits | homePawnData[1..8] (8 bytes)                   |

### Offset Reconstruction

offset = (offsetHigh << 32) | offsetLow — gives a 47-bit file offset.

### Date Encoding (20 bits)

Bit-packed: date = (year << 9) | (month << 5) | day.
Bits 0-4: day (0-31, 0=unknown). Bits 5-8: month (0-12, 0=unknown). Bits 9+: year.

### Result Encoding (2 bits)

0 = none/unknown, 1 = White wins, 2 = Black wins, 3 = Draw.

### ECO Encoding (16 bits)

Encodes "A00" through "E99" plus sub-codes.
eco = (letter - 'A') * 100 * 4 + digits * 4 + subcode.

---

## SCID5 Namebase File (.sn5)

No header. Sequential entries, each:

1. LEB128 varint encoding: value = (stringLength << 3) | nameType
   - nameType (3 bits): 0=PLAYER, 1=EVENT, 2=SITE, 3=ROUND
   - stringLength: number of bytes in the name string
2. String bytes (not null-terminated)

IDs are assigned sequentially per type (first player seen = ID 0, etc.).

---

## SCID4 Index File (.si4)

### Header (182 bytes)

- Bytes 0-7: magic "Scid.si\x1a" (8 bytes, last byte is 0x1a)
- Bytes 8-9: version number (2 bytes, big-endian)
- Bytes 10-12: base type (uint24, big-endian)
- Bytes 13-15: number of games (uint24, big-endian)
- Bytes 16-19: auto-load game number (uint32, big-endian)
- Bytes 20-181: description string (162 bytes, null-padded)

### Record Layout (47 bytes, big-endian)

| Offset | Size    | Content                                        |
|--------|---------|------------------------------------------------|
| 0-3    | 4 bytes | gameOffset (32-bit BE)                         |
| 4-6    | 3 bytes | gameLength(17 bits) + customFlags(6) + spare(1)|
| 7-8    | 2 bytes | flags (16 bits)                                |
| 9      | 1 byte  | whiteID_high(4) + blackID_high(4)              |
| 10-11  | 2 bytes | whiteID_low (16 bits)                          |
| 12-13  | 2 bytes | blackID_low (16 bits)                          |
| 14     | 1 byte  | eventID_high(3) + siteID_high(3) + roundID_high(2) |
| 15-16  | 2 bytes | eventID_low (16 bits)                          |
| 17-18  | 2 bytes | siteID_low (16 bits)                           |
| 19-20  | 2 bytes | roundID_low (16 bits)                          |
| 21     | 1 byte  | varCount(4) + commentCount(4)                  |
| 22     | 1 byte  | nagCount(4) + result(4)                        |
| 23-24  | 2 bytes | ECO code (16 bits)                             |
| 25-27  | 3 bytes | date (20 bits) + eventDate_high(4)             |
| 28     | 1 byte  | eventDate_low (8 bits — total 12 bits compact) |
| 29-30  | 2 bytes | whiteElo(12) + whiteEloType(4)                 |
| 31-32  | 2 bytes | blackElo(12) + blackEloType(4)                 |
| 33-35  | 3 bytes | finalMatSig (24 bits)                          |
| 36     | 1 byte  | storedLineCode (8 bits)                        |
| 37-38  | 2 bytes | numHalfMoves (10 bits) + padding (6 bits)      |
| 39-46  | 8 bytes | homePawnData (1 count + 7 data bytes)           |

Name ID reconstruction:
- whiteID = (whiteID_high << 16) | whiteID_low → 20 bits
- blackID = (blackID_high << 16) | blackID_low → 20 bits
- eventID = (eventID_high << 16) | eventID_low → 19 bits
- siteID = (siteID_high << 16) | siteID_low → 19 bits
- roundID = (roundID_high << 16) | roundID_low → 18 bits

---

## SCID4 Namebase File (.sn4)

### Header (36 bytes)

- Bytes 0-7: magic "Scid.sn" + version byte
- Bytes 8-11: timestamp (uint32 BE)
- Bytes 12-14: player count (uint24 BE)
- Bytes 15-17: event count (uint24 BE)
- Bytes 18-20: site count (uint24 BE)
- Bytes 21-23: round count (uint24 BE)
- Bytes 24-35: reserved / max frequency per type (12 bytes)

### Entries (per name type, in order: player, event, site, round)

Names are stored alphabetically within each type. Front-coded (prefix
compression): each entry shares a prefix with the previous entry.

Each entry:
1. ID: 2 bytes if count ≤ 65535, else 3 bytes (big-endian)
2. Frequency: 1 byte if max_freq ≤ 255, 2 bytes if ≤ 65535, else 3 bytes
3. Length: 1 byte — total length of the name string
4. Prefix: 1 byte — number of characters shared with previous name
5. Suffix bytes: (length - prefix) bytes — the new characters

To reconstruct: take the first `prefix` characters from the previous name,
then append the suffix bytes.
