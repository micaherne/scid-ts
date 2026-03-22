import * as fs from "fs";
import { codec4 } from "./codec4.js";
import { codec5 } from "./codec5.js";
import { parseGameData, parseAnnotatedGameData, encodeAnnotatedGameData } from "./game.js";
import {
	ScidCodec, IndexEntry, ScidGameHeaders, ScidMove, ScidGame,
	ScidAnnotatedMove, ScidAnnotatedGame, NewGame,
	NAME_PLAYER, NAME_EVENT, NAME_SITE, NAME_ROUND,
	decodeDate, decodeEco, resultToString, decodeAnnotationCount,
	encodeDate, encodeResult, encodeAnnotationCount,
	FLAG_DELETE,
} from "./types.js";

export type { ScidGameHeaders, ScidMove, ScidGame, ScidAnnotatedMove, ScidAnnotatedGame, NewGame } from "./types.js";
export {
	FLAG_START, FLAG_PROMOTIONS, FLAG_UNDER_PROMO, FLAG_DELETE,
	FLAG_WHITE_OP, FLAG_BLACK_OP, FLAG_MIDDLEGAME, FLAG_ENDGAME,
	FLAG_NOVELTY, FLAG_PAWN, FLAG_TACTICS, FLAG_KSIDE, FLAG_QSIDE,
	FLAG_BRILLIANCY, FLAG_BLUNDER, FLAG_USER,
	FLAG_CUSTOM1, FLAG_CUSTOM2, FLAG_CUSTOM3, FLAG_CUSTOM4, FLAG_CUSTOM5, FLAG_CUSTOM6,
	decodeAnnotationCount,
} from "./types.js";

export class ScidDatabase {
	private codec: ScidCodec | null = null;
	private names: string[][] = [];
	private entries: IndexEntry[] = [];
	private gameFilePath: string = "";
	private indexFilePath: string = "";
	private namebaseFilePath: string = "";
	/** Encoded game data blocks waiting to be flushed to the game file. */
	private pendingGameData: Buffer[] = [];
	/** Byte length of the game file as last known (after open/save). */
	private gameFileSize: number = 0;

	/**
	 * Open a SCID database given the path to the index file (.si4 or .si5).
	 * Reads the index and namebase files into memory.
	 */
	open(path: string): void {
		const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
		let basePath: string;

		if (ext === ".si5") {
			this.codec = codec5;
			basePath = path.substring(0, path.length - 4);
		} else if (ext === ".si4") {
			this.codec = codec4;
			basePath = path.substring(0, path.length - 4);
		} else {
			throw new Error(`Unsupported SCID file extension: ${ext}`);
		}

		const indexBuf = fs.readFileSync(path);
		this.entries = this.codec.readIndex(indexBuf);

		const nbExt = ext === ".si5" ? ".sn5" : ".sn4";
		const nbPath = basePath + nbExt;
		const nbBuf = fs.readFileSync(nbPath);
		this.names = this.codec.readNamebase(nbBuf);

		this.gameFilePath    = basePath + this.codec.gameFileExt();
		this.indexFilePath   = path;
		this.namebaseFilePath = basePath + nbExt;
		this.gameFileSize = fs.existsSync(this.gameFilePath)
			? fs.statSync(this.gameFilePath).size : 0;
		this.pendingGameData = [];
	}

	close(): void {
		this.codec = null;
		this.names = [];
		this.entries = [];
		this.gameFilePath = "";
		this.indexFilePath = "";
		this.namebaseFilePath = "";
		this.pendingGameData = [];
		this.gameFileSize = 0;
	}

	// ---------------------------------------------------------------------------
	// Write API
	// ---------------------------------------------------------------------------

	/**
	 * Create a new empty SCID database. The path must end with .si4 or .si5.
	 * Overwrites any existing files at that path.
	 */
	static create(path: string): ScidDatabase {
		const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
		if (ext !== ".si4" && ext !== ".si5") {
			throw new Error(`Unsupported extension: ${ext}`);
		}
		const codec = ext === ".si5" ? codec5 : codec4;
		const basePath = path.substring(0, path.length - 4);
		const nbExt  = ext === ".si5" ? ".sn5" : ".sn4";
		const sgExt  = codec.gameFileExt();

		// Write empty index, namebase, and game files
		fs.writeFileSync(path,             codec.writeIndex([]));
		fs.writeFileSync(basePath + nbExt, codec.writeNamebase([[], [], [], [], []]));
		fs.writeFileSync(basePath + sgExt, Buffer.alloc(0));

		const db = new ScidDatabase();
		db.open(path);
		return db;
	}

	/**
	 * Add a game to the database. Changes are buffered until save() is called.
	 * Returns the index of the new game.
	 */
	addGame(game: NewGame): number {
		if (!this.codec) throw new Error("Database not open");

		const h = game.headers ?? {};
		const encoded = encodeAnnotatedGameData(game.moves ?? [], {
			comment:   game.comment,
			extraTags: game.extraTags,
			startFen:  game.startFen,
		});

		const gameOffset = this.gameFileSize + this.pendingSize();
		this.pendingGameData.push(encoded.buf);

		const entry: IndexEntry = {
			whiteId:   this.resolveOrAddName(NAME_PLAYER, h.white  ?? "?"),
			blackId:   this.resolveOrAddName(NAME_PLAYER, h.black  ?? "?"),
			eventId:   this.resolveOrAddName(NAME_EVENT,  h.event  ?? "?"),
			siteId:    this.resolveOrAddName(NAME_SITE,   h.site   ?? "?"),
			roundId:   this.resolveOrAddName(NAME_ROUND,  h.round  ?? "?"),
			whiteElo:      h.whiteElo      ?? 0,
			blackElo:      h.blackElo      ?? 0,
			whiteEloType:  h.whiteEloType  ?? 0,
			blackEloType:  h.blackEloType  ?? 0,
			date:      encodeDate(h.date      ?? "????.??.??"),
			eventDate: encodeDate(h.eventDate ?? "????.??.??"),
			result:    encodeResult(h.result  ?? "*"),
			eco:       0,
			flags:     (h.flags ?? 0) | (game.startFen ? 1 : 0), // FLAG_START = bit0
			deleted:   false,
			nComments:   encoded.nComments,
			nVariations: encoded.nVariations,
			nNags:       encoded.nNags,
			numHalfMoves: encoded.numHalfMoves,
			chess960:  h.chess960 ?? false,
			gameOffset,
			gameLength: encoded.buf.length,
			storedLineCode: 0,
			finalMatSig:    0,
			homePawnData:   new Uint8Array(9),
		};

		this.entries.push(entry);
		return this.entries.length - 1;
	}

	/**
	 * Mark game n as deleted. The data remains in the game file until compact().
	 */
	deleteGame(n: number): void {
		if (!this.codec) throw new Error("Database not open");
		const e = this.entries[n];
		if (!e) throw new Error(`Game index out of range: ${n}`);
		e.flags |= FLAG_DELETE;
		e.deleted = true;
	}

	/**
	 * Replace game n's data. The old data remains as dead bytes until compact().
	 */
	updateGame(n: number, game: NewGame): void {
		if (!this.codec) throw new Error("Database not open");
		const e = this.entries[n];
		if (!e) throw new Error(`Game index out of range: ${n}`);

		const h = game.headers ?? {};
		const encoded = encodeAnnotatedGameData(game.moves ?? [], {
			comment:   game.comment,
			extraTags: game.extraTags,
			startFen:  game.startFen,
		});

		const gameOffset = this.gameFileSize + this.pendingSize();
		this.pendingGameData.push(encoded.buf);

		e.whiteId   = this.resolveOrAddName(NAME_PLAYER, h.white  ?? this.resolveName(NAME_PLAYER, e.whiteId));
		e.blackId   = this.resolveOrAddName(NAME_PLAYER, h.black  ?? this.resolveName(NAME_PLAYER, e.blackId));
		e.eventId   = this.resolveOrAddName(NAME_EVENT,  h.event  ?? this.resolveName(NAME_EVENT,  e.eventId));
		e.siteId    = this.resolveOrAddName(NAME_SITE,   h.site   ?? this.resolveName(NAME_SITE,   e.siteId));
		e.roundId   = this.resolveOrAddName(NAME_ROUND,  h.round  ?? this.resolveName(NAME_ROUND,  e.roundId));
		if (h.whiteElo      !== undefined) e.whiteElo      = h.whiteElo;
		if (h.blackElo      !== undefined) e.blackElo      = h.blackElo;
		if (h.whiteEloType  !== undefined) e.whiteEloType  = h.whiteEloType;
		if (h.blackEloType  !== undefined) e.blackEloType  = h.blackEloType;
		if (h.date          !== undefined) e.date          = encodeDate(h.date);
		if (h.eventDate     !== undefined) e.eventDate     = encodeDate(h.eventDate);
		if (h.result        !== undefined) e.result        = encodeResult(h.result);
		if (h.flags         !== undefined) e.flags         = h.flags;
		if (h.chess960      !== undefined) e.chess960      = h.chess960;
		e.nComments   = encoded.nComments;
		e.nVariations = encoded.nVariations;
		e.nNags       = encoded.nNags;
		e.numHalfMoves = encoded.numHalfMoves;
		e.gameOffset  = gameOffset;
		e.gameLength  = encoded.buf.length;
		e.deleted     = (e.flags & FLAG_DELETE) !== 0;
	}

	/**
	 * Flush pending game data to the game file and rewrite the index and namebase.
	 * After save(), compact indices are stable (no deleted games have been removed).
	 */
	save(): void {
		if (!this.codec) throw new Error("Database not open");

		// Append pending game data
		if (this.pendingGameData.length > 0) {
			const fd = fs.openSync(this.gameFilePath, "a");
			try {
				for (const buf of this.pendingGameData) {
					fs.writeSync(fd, buf);
				}
			} finally {
				fs.closeSync(fd);
			}
			this.gameFileSize += this.pendingSize();
			this.pendingGameData = [];
		}

		// Rewrite index and namebase
		fs.writeFileSync(this.indexFilePath,    this.codec.writeIndex(this.entries));
		fs.writeFileSync(this.namebaseFilePath, this.codec.writeNamebase(this.names));
	}

	/**
	 * Rebuild all three database files, removing deleted games and dead game data.
	 * All game indices are reassigned; previously held indices are invalidated.
	 */
	compact(): void {
		if (!this.codec) throw new Error("Database not open");

		// Flush any unsaved changes first
		if (this.pendingGameData.length > 0) this.save();

		const newEntries: IndexEntry[] = [];
		const newGameParts: Buffer[] = [];
		let newOffset = 0;

		const fd = fs.openSync(this.gameFilePath, "r");
		try {
			for (const e of this.entries) {
				if (e.deleted) continue;

				const buf = Buffer.alloc(e.gameLength);
				fs.readSync(fd, buf, 0, e.gameLength, e.gameOffset);

				newEntries.push({ ...e, gameOffset: newOffset });
				newGameParts.push(buf);
				newOffset += e.gameLength;
			}
		} finally {
			fs.closeSync(fd);
		}

		fs.writeFileSync(this.gameFilePath,      Buffer.concat(newGameParts));
		fs.writeFileSync(this.indexFilePath,     this.codec.writeIndex(newEntries));
		fs.writeFileSync(this.namebaseFilePath,  this.codec.writeNamebase(this.names));

		this.entries = newEntries;
		this.gameFileSize = newOffset;
	}

	/** Total byte size of buffered (unsaved) game data. */
	private pendingSize(): number {
		return this.pendingGameData.reduce((s, b) => s + b.length, 0);
	}

	/** Look up a name by string; add it to the namebase if not found. Returns its ID. */
	private resolveOrAddName(type: number, name: string): number {
		if (!this.names[type]) this.names[type] = [];
		const existing = this.names[type].indexOf(name);
		if (existing >= 0) return existing;
		this.names[type].push(name);
		return this.names[type].length - 1;
	}

	getGameCount(): number {
		return this.entries.length;
	}

	getHeaders(n: number): ScidGameHeaders {
		const e = this.entries[n];
		if (!e) {
			return {
				white: "?", black: "?", event: "?", site: "?",
				round: "?", date: "????.??.??", result: "*",
				whiteElo: 0, blackElo: 0, eco: "",
				deleted: false, flags: 0,
				nComments: 0, nVariations: 0, nNags: 0,
				numHalfMoves: 0, eventDate: "????.??.??",
				chess960: false, whiteEloType: 0, blackEloType: 0,
			};
		}

		return {
			white: this.resolveName(NAME_PLAYER, e.whiteId),
			black: this.resolveName(NAME_PLAYER, e.blackId),
			event: this.resolveName(NAME_EVENT, e.eventId),
			site: this.resolveName(NAME_SITE, e.siteId),
			round: this.resolveName(NAME_ROUND, e.roundId),
			date: decodeDate(e.date),
			result: resultToString(e.result),
			whiteElo: e.whiteElo,
			blackElo: e.blackElo,
			eco: decodeEco(e.eco),
			deleted: e.deleted,
			flags: e.flags,
			nComments: decodeAnnotationCount(e.nComments),
			nVariations: decodeAnnotationCount(e.nVariations),
			nNags: decodeAnnotationCount(e.nNags),
			numHalfMoves: e.numHalfMoves,
			eventDate: decodeDate(e.eventDate),
			chess960: e.chess960,
			whiteEloType: e.whiteEloType,
			blackEloType: e.blackEloType,
		};
	}

	getMoves(n: number): ScidMove[] {
		const e = this.entries[n];
		if (!e || e.gameLength === 0) return [];

		const fd = fs.openSync(this.gameFilePath, "r");
		try {
			const buf = Buffer.alloc(e.gameLength);
			fs.readSync(fd, buf, 0, e.gameLength, e.gameOffset);
			const parsed = parseGameData(buf, 0, e.gameLength);
			return parsed.moves;
		} finally {
			fs.closeSync(fd);
		}
	}

	getGame(n: number): ScidGame {
		return {
			headers: this.getHeaders(n),
			moves: this.getMoves(n),
		};
	}

	getAnnotatedGame(n: number): ScidAnnotatedGame {
		const e = this.entries[n];
		const headers = this.getHeaders(n);
		if (!e || e.gameLength === 0) return { headers, moves: [], extraTags: [] };

		const fd = fs.openSync(this.gameFilePath, "r");
		try {
			const buf = Buffer.alloc(e.gameLength);
			fs.readSync(fd, buf, 0, e.gameLength, e.gameOffset);
			const parsed = parseAnnotatedGameData(buf, 0, e.gameLength);
			return {
				headers,
				moves: parsed.moves,
				extraTags: parsed.extraTags,
				...(parsed.startFen !== null ? { startFen: parsed.startFen } : {}),
				...(parsed.comment !== null ? { comment: parsed.comment } : {}),
			};
		} finally {
			fs.closeSync(fd);
		}
	}

	/**
	 * Search games by player name, event, site, or ECO.
	 * Returns matching game indices.
	 */
	search(query: string, offset: number, limit: number): { results: number[]; total: number } {
		const lowerQuery = query.toLowerCase();
		const matches: number[] = [];

		for (let i = 0; i < this.entries.length; i++) {
			const e = this.entries[i];
			const white = this.resolveName(NAME_PLAYER, e.whiteId);
			const black = this.resolveName(NAME_PLAYER, e.blackId);
			const event = this.resolveName(NAME_EVENT, e.eventId);
			const site = this.resolveName(NAME_SITE, e.siteId);
			const eco = decodeEco(e.eco);

			if (
				white.toLowerCase().includes(lowerQuery) ||
				black.toLowerCase().includes(lowerQuery) ||
				event.toLowerCase().includes(lowerQuery) ||
				site.toLowerCase().includes(lowerQuery) ||
				eco.toLowerCase().includes(lowerQuery)
			) {
				matches.push(i);
			}
		}

		return {
			results: matches.slice(offset, offset + limit),
			total: matches.length,
		};
	}

	private resolveName(type: number, id: number): string {
		const typeNames = this.names[type];
		if (!typeNames || id >= typeNames.length) return "?";
		return typeNames[id] || "?";
	}
}
