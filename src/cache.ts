import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir,	readFile,	rename,	rm,	unlink,	writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { CDN_BASE, JSON_FILES,	META_URL,	PARQUET_FILES, defaultCacheDir } from "./config.js";

export type ProgressCallback = ( filename: string, bytesDownloaded: number, totalBytes: number | null, ) => void;

export class CacheManager { 
  readonly cacheDir: string;
	readonly offline: boolean;
	readonly timeout: number;
	private _remoteVersion: string | null = null;
	private _onProgress: ProgressCallback | null;
	/** In-memory cache: localPath → parsed JSON (lives for the process lifetime). */
	private _jsonCache = new Map<string, Record<string, unknown>>();
	/** Timestamp of the last successful staleness check (ms). */
	private _lastStaleCheck: number | null = null;
	/** How often to re-check the CDN for a new version (default: 1 hour). */
	private _staleCheckTtlMs: number;

	constructor(options?: { cacheDir?: string; offline?: boolean; timeout?: number;	onProgress?: ProgressCallback; staleCheckTtlMs?: number; }) {
		this.cacheDir = options?.cacheDir ?? defaultCacheDir();
		this.offline = options?.offline ?? false;
		this.timeout = options?.timeout ?? 120_000;
		this._onProgress = options?.onProgress ?? null;
		this._staleCheckTtlMs = options?.staleCheckTtlMs ?? 60 * 60 * 1_000; // 1 hour
	}

	async init(): Promise<void> {	await mkdir(this.cacheDir, { recursive: true });}

	close(): void { }	// No persistent HTTP client to close in Node


	private async _localVersion(): Promise<string | null> {
		const versionFile = join(this.cacheDir, "version.txt");
		try {	return (await readFile(versionFile, "utf-8")).trim(); }
    catch { return null; }
	}

	private async _saveVersion(version: string): Promise<void> { await writeFile(join(this.cacheDir, "version.txt"), version, "utf-8");	}

	async remoteVersion(): Promise<string | null> {
		if (this._remoteVersion) return this._remoteVersion;
		if (this.offline) return null;
		try {
			const resp = await fetch(META_URL, { signal: AbortSignal.timeout(this.timeout) });
			if (!resp.ok) return null;
			const data = (await resp.json()) as Record< string, Record<string, string> >;
			this._remoteVersion = data?.data?.version ?? data?.meta?.version ?? null;
			return this._remoteVersion;
		} catch { return null; }
	}

	async isStale(): Promise<boolean> {
		// Skip the remote check if we already checked recently.
		if (this._lastStaleCheck !== null && Date.now() - this._lastStaleCheck < this._staleCheckTtlMs) {
			return false;
		}
		const local = await this._localVersion();
		const remote = await this.remoteVersion();
		if (remote === null) return false;      // If we can't reach remote (offline), not stale
		if (local === null) return true;        // No local version but remote available → stale
		const stale = local !== remote;
		if (!stale) this._lastStaleCheck = Date.now(); // record time only when up-to-date
		return stale;
	}

	private async _downloadFile(filename: string, dest: string): Promise<void> {
		const url = `${CDN_BASE}/${filename}`;
		const dir = join(dest, "..");
		await mkdir(dir, { recursive: true });
		const tmpDest = `${dest}.tmp`;

		try {
			await new Promise<void>((resolve, reject) => {
				httpsGet(url, { timeout: this.timeout }, (res) => {
					// Follow redirects
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location ) {
						httpsGet( res.headers.location, { timeout: this.timeout }, (res2) => {	this._handleDownloadResponse(	res2,	tmpDest, filename, resolve, reject); }).on("error", reject);
						return;
					}
					this._handleDownloadResponse(res, tmpDest, filename, resolve, reject); }).on("error", reject);
			});
			await rename(tmpDest, dest);
		} 
    catch (err) {
			try { await unlink(tmpDest); }
      catch {	} // ignore cleanup errors	
      throw err;
		}
	}

	private _handleDownloadResponse( res: import("node:http").IncomingMessage, tmpDest: string, filename: string, resolve: () => void, reject: (err: Error) => void ): void {
		if (res.statusCode && res.statusCode >= 400) {
			reject(new Error(`HTTP ${res.statusCode} downloading ${filename}`));
			res.resume();
			return;
		}
		const total = res.headers["content-length"]
			? Number.parseInt(res.headers["content-length"], 10)
			: null;
		let downloaded = 0;
		const ws = createWriteStream(tmpDest);

		res.on("data", (chunk: Buffer) => {
			downloaded += chunk.length;
			if (this._onProgress) { this._onProgress(filename, downloaded, total); }
		});

		res.pipe(ws);
		ws.on("finish", resolve);
		ws.on("error", reject);
		res.on("error", reject);
	}

	async ensureParquet(viewName: string): Promise<string> {
		const filename = PARQUET_FILES[viewName];
		if (!filename) throw new Error(`Unknown parquet view: ${viewName}`);
		const localPath = join(this.cacheDir, filename);

		if (!existsSync(localPath) || (await this.isStale())) {
			if (this.offline) {
				if (existsSync(localPath)) return localPath;
				throw new Error( `Parquet file ${filename} not cached and offline mode is enabled` );
			}
			await this._downloadFile(filename, localPath);
			const version = await this.remoteVersion();
			if (version) await this._saveVersion(version);
		}
		return localPath;
	}

	async ensureJson(name: string): Promise<string> {
		const filename = JSON_FILES[name];
		if (!filename) throw new Error(`Unknown JSON file: ${name}`);
		const localPath = join(this.cacheDir, filename);

		if (!existsSync(localPath) || (await this.isStale())) {
			if (this.offline) {
				if (existsSync(localPath)) return localPath;
				throw new Error( `JSON file ${filename} not cached and offline mode is enabled` );
			}
			await this._downloadFile(filename, localPath);
			const version = await this.remoteVersion();
			if (version) await this._saveVersion(version);
			// Evict stale memory-cached value so the next loadJson re-reads from disk.
			this._jsonCache.delete(localPath);
			this._lastStaleCheck = Date.now();
		}
		return localPath;
	}

	/** Invalidate the in-memory JSON cache (e.g. after a fresh download). */
	invalidateMemoryCache(): void {
		this._jsonCache.clear();
		this._lastStaleCheck = null;
	}

	async loadJson(name: string): Promise<Record<string, unknown>> {
		const path = await this.ensureJson(name);
		// Return from memory if already loaded — avoids disk I/O and CDN staleness
		// checks on every call for slow-changing data like keywords/cardTypes.
		const cached = this._jsonCache.get(path);
		if (cached) return cached;
		try {
			let result: Record<string, unknown>;
			if (path.endsWith(".gz")) {
				const compressed = await readFile(path);
				const decompressed = await new Promise<Buffer>((resolve, reject) => {
					const gunzip = createGunzip();
					const chunks: Buffer[] = [];
					gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
					gunzip.on("end", () => resolve(Buffer.concat(chunks)));
					gunzip.on("error", reject);
					gunzip.end(compressed);
				});
				result = JSON.parse(decompressed.toString("utf-8")) as Record<string, unknown>;
			} else {
				const text = await readFile(path, "utf-8");
				result = JSON.parse(text) as Record<string, unknown>;
			}
			this._jsonCache.set(path, result);
			return result;
		} catch (err) {
			try { await unlink(path); } catch { } // ignore
			throw new Error( `Cache file '${path}' was corrupt and has been removed. Retry to re-download. Original error: ${err}` );
		}
	}

	async clear(): Promise<void> {
		try { await rm(this.cacheDir, { recursive: true, force: true }); }
    catch {	} // ignore
		this._jsonCache.clear();
		this._lastStaleCheck = null;
    await mkdir(this.cacheDir, { recursive: true });
	}
}
