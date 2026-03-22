// Piece types (matches SCID's board_def.h)
export const KING = 1;
export const QUEEN = 2;
export const ROOK = 3;
export const BISHOP = 4;
export const KNIGHT = 5;
export const PAWN = 6;
export const EMPTY = 7;

export const WHITE = 0;
export const BLACK = 1;

export type Color = 0 | 1;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Square: A1=0, B1=1, ..., H8=63
export function squareFile(sq: number): number {
	return sq & 7;
}

export function squareRank(sq: number): number {
	return sq >> 3;
}

const FILE_CHARS = "abcdefgh";
const RANK_CHARS = "12345678";

export function squareToAlgebraic(sq: number): string {
	return FILE_CHARS[sq & 7] + RANK_CHARS[sq >> 3];
}

export function algebraicToSquare(s: string): number {
	return FILE_CHARS.indexOf(s[0]) + RANK_CHARS.indexOf(s[1]) * 8;
}

// Output types — chess.js compatible but no chess.js dependency
export interface ScidMove {
	from: string;
	to: string;
	promotion?: string;
}

export interface ScidGameHeaders {
	white: string;
	black: string;
	event: string;
	site: string;
	round: string;
	date: string;
	result: string;
	whiteElo: number;
	blackElo: number;
	eco: string;
	// Flags
	deleted: boolean;       // game is marked for deletion (FLAG_DELETE)
	flags: number;          // raw 22-bit flags field; test with FLAG_* constants
	// Annotation counts (decoded from the 4-bit coded scale; see decodeAnnotationCount)
	nComments: number;
	nVariations: number;
	nNags: number;
	// Additional index fields
	numHalfMoves: number;   // half-move (ply) count; 0 if unknown
	eventDate: string;      // same format as date ("YYYY.MM.DD")
	chess960: boolean;      // Chess960 / Fischer Random game (SCID5 only)
	whiteEloType: number;   // rating type for white (0=Elo, 1=USCF, …)
	blackEloType: number;   // rating type for black
}

export interface ScidGame {
	headers: ScidGameHeaders;
	moves: ScidMove[];
}

export interface ScidAnnotatedMove extends ScidMove {
	commentBefore?: string;          // comment appearing before this move in the game stream
	commentAfter?: string;           // comment appearing after this move
	nags?: number[];                 // numeric annotation glyphs (1=!, 2=??, 6=?!, etc.)
	variations?: ScidAnnotatedMove[][];
}

export interface ScidAnnotatedGame {
	headers: ScidGameHeaders;
	moves: ScidAnnotatedMove[];
	comment?: string;                // pre-game comment (before move 1)
	extraTags: [string, string][];   // non-standard PGN tags (Annotator, TimeControl, etc.)
	startFen?: string;               // custom start position, absent if standard
}

// Internal types for codec strategy
export interface IndexEntry {
	// Name IDs (reference into namebase)
	whiteId: number;
	blackId: number;
	eventId: number;
	siteId: number;
	roundId: number;
	// Ratings
	whiteElo: number;
	blackElo: number;
	whiteEloType: number;   // 0=Elo, 1=USCF, 2=ECF, 3=ICCF, 4=FIDE, …
	blackEloType: number;
	// Date / event
	date: number;
	eventDate: number;
	// Result / classification
	result: number;
	eco: number;
	// Flags (22-bit; see FLAG_* constants)
	flags: number;
	// Annotation counts (4-bit coded, decoded via decodeAnnotationCount)
	nComments: number;
	nVariations: number;
	nNags: number;
	// Game metadata
	numHalfMoves: number;
	chess960: boolean;
	// Game file location
	gameOffset: number;
	gameLength: number;
	// Search indices (internal use)
	storedLineCode: number;
	finalMatSig: number;
	homePawnData: Uint8Array;  // 9 bytes: [count, data×8]
}

export interface ScidCodec {
	readIndex(buf: Buffer): IndexEntry[];
	readNamebase(buf: Buffer): string[][];   // names[type][id]
	gameFileExt(): string;                   // ".sg4" or ".sg5"
}

// Name type indices (match SCID5 varint encoding)
export const NAME_PLAYER = 0;
export const NAME_EVENT = 1;
export const NAME_SITE = 2;
export const NAME_ROUND = 3;

// Result codes
export const RESULT_NONE = 0;
export const RESULT_WHITE = 1;
export const RESULT_BLACK = 2;
export const RESULT_DRAW = 3;

export function resultToString(r: number): string {
	switch (r) {
		case RESULT_WHITE: return "1-0";
		case RESULT_BLACK: return "0-1";
		case RESULT_DRAW: return "1/2-1/2";
		default: return "*";
	}
}

// Date encoding: (year << 9) | (month << 5) | day
// Bits 0-4: day (0-31, 0=unknown), bits 5-8: month (0-12, 0=unknown), bits 9+: year
export function decodeDate(d: number): string {
	if (d === 0) return "????.??.??";
	const dd = d & 31;
	const m = (d >> 5) & 15;
	const y = d >> 9;
	const ys = y === 0 ? "????" : String(y).padStart(4, "0");
	const ms = m === 0 ? "??" : String(m).padStart(2, "0");
	const ds = dd === 0 ? "??" : String(dd).padStart(2, "0");
	return `${ys}.${ms}.${ds}`;
}

// ECO encoding: eco = (letter - 'A') * 100 * 4 + digits * 4 + subcode
export function decodeEco(eco: number): string {
	if (eco === 0) return "";
	const subcode = eco & 3;
	const digits = Math.floor((eco >> 2) % 100);
	const letter = Math.floor(eco / 400);
	if (letter > 4) return "";
	const base = String.fromCharCode(65 + letter) + String(digits).padStart(2, "00");
	if (subcode === 0) return base;
	return base + String.fromCharCode(96 + subcode); // a, b, c
}

// Flag bit masks for IndexEntry.flags (and ScidGameHeaders.flags).
// Matches SCID's IDX_FLAG_* enum in indexentry.h.
export const FLAG_START       = 1 << 0;   // game has its own start position
export const FLAG_PROMOTIONS  = 1 << 1;   // game contains promotions
export const FLAG_UNDER_PROMO = 1 << 2;   // game contains underpromotions
export const FLAG_DELETE      = 1 << 3;   // game marked for deletion
export const FLAG_WHITE_OP    = 1 << 4;   // white openings flag
export const FLAG_BLACK_OP    = 1 << 5;   // black openings flag
export const FLAG_MIDDLEGAME  = 1 << 6;
export const FLAG_ENDGAME     = 1 << 7;
export const FLAG_NOVELTY     = 1 << 8;
export const FLAG_PAWN        = 1 << 9;   // pawn structure flag
export const FLAG_TACTICS     = 1 << 10;
export const FLAG_KSIDE       = 1 << 11;  // kingside play
export const FLAG_QSIDE       = 1 << 12;  // queenside play
export const FLAG_BRILLIANCY  = 1 << 13;
export const FLAG_BLUNDER     = 1 << 14;
export const FLAG_USER        = 1 << 15;  // user-defined
export const FLAG_CUSTOM1     = 1 << 16;
export const FLAG_CUSTOM2     = 1 << 17;
export const FLAG_CUSTOM3     = 1 << 18;
export const FLAG_CUSTOM4     = 1 << 19;
export const FLAG_CUSTOM5     = 1 << 20;
export const FLAG_CUSTOM6     = 1 << 21;

// Decode a 4-bit coded annotation count to its approximate real value.
// Matches SCID's IndexEntry::DecodeCount() in indexentry.h.
// Values 0-10 are exact; 11-15 map to 15, 20, 30, 40, 50.
const COUNT_DECODE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50];
export function decodeAnnotationCount(raw: number): number {
	return COUNT_DECODE[raw & 0xF];
}

// Special marker codes in move stream (lower nibble when piece index = 0)
export const ENCODE_NAG = 11;
export const ENCODE_COMMENT = 12;
export const ENCODE_START_MARKER = 13;
export const ENCODE_END_MARKER = 14;
export const ENCODE_END_GAME = 15;
