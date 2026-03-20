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
}

export interface ScidGame {
	headers: ScidGameHeaders;
	moves: ScidMove[];
}

// Internal types for codec strategy
export interface IndexEntry {
	whiteId: number;
	blackId: number;
	eventId: number;
	siteId: number;
	roundId: number;
	whiteElo: number;
	blackElo: number;
	date: number;
	result: number;
	eco: number;
	gameOffset: number;
	gameLength: number;
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
	const base = String.fromCharCode(65 + letter) + String(digits).padStart(2, "0");
	if (subcode === 0) return base;
	return base + String.fromCharCode(96 + subcode); // a, b, c
}

// Special marker codes in move stream (lower nibble when piece index = 0)
export const ENCODE_NAG = 11;
export const ENCODE_COMMENT = 12;
export const ENCODE_START_MARKER = 13;
export const ENCODE_END_MARKER = 14;
export const ENCODE_END_GAME = 15;
