// Accept vibebook's identity seal on /api/mcp, next to the bearer token.
//
// vibebook calls a linked MCP connection with `X-Vibebook-Identity`: a
// 5-minute EdDSA JWT (iss = https://vibebook.dev, sub/email = the person,
// aud = the connection URL). The public key is at
// https://chat.decocms.com/.well-known/jwks.json (vibebook.dev serves the same key). We let the call through only when
// the signature, issuer, audience and expiry check out AND the email is one of
// the owners listed in VIBEBOOK_OWNERS (comma-separated). Unset → feature off.

// vibebook moved to chat.decocms.com (same signing key); accept both issuers.
const ISSUERS = new Set(["https://vibebook.dev", "https://chat.decocms.com"]);
const JWKS_URL = "https://chat.decocms.com/.well-known/jwks.json";
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_FAIL_TTL_MS = 60 * 1000; // brief negative cache: don't hammer vibebook when it's down

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; until: number } | null = null;

async function jwks(): Promise<Jwk[]> {
	if (jwksCache && jwksCache.until > Date.now()) return jwksCache.keys;
	try {
		const r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
		if (!r.ok) throw new Error(`jwks ${r.status}`);
		const j = (await r.json()) as { keys?: Jwk[] };
		const keys = Array.isArray(j.keys) ? j.keys : [];
		jwksCache = { keys, until: Date.now() + JWKS_TTL_MS };
		return keys;
	} catch (err) {
		console.warn("vibebook jwks fetch failed:", err);
		// Keep serving the last good keys if we have them; otherwise cache "none" briefly.
		jwksCache = {
			keys: jwksCache?.keys ?? [],
			until: Date.now() + JWKS_FAIL_TTL_MS,
		};
		return jwksCache.keys;
	}
}

const b64uDecode = (s: string) =>
	Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
		c.charCodeAt(0),
	);

export function parseOwners(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? "")
			.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean),
	);
}

/** Returns the verified owner email, or null when the seal is missing/invalid/not an owner. */
export async function vibebookOwner(
	req: Request,
	ownersRaw: string | undefined,
	now = Date.now(),
): Promise<string | null> {
	const owners = parseOwners(ownersRaw);
	if (owners.size === 0) return null;
	const token = req.headers.get("x-vibebook-identity")?.trim();
	if (!token) return null;
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const head = JSON.parse(new TextDecoder().decode(b64uDecode(parts[0])));
		const body = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])));
		if (head.alg !== "EdDSA") return null;
		const sec = Math.floor(now / 1000);
		if (!ISSUERS.has(body.iss)) return null;
		if (typeof body.exp !== "number" || body.exp < sec) return null;
		const u = new URL(req.url);
		if (body.aud !== `${u.origin}${u.pathname}`) return null;
		const email = String(body.email ?? body.sub ?? "").toLowerCase();
		if (!owners.has(email)) return null;

		const jwk = (await jwks()).find((k) => k.kid === head.kid);
		if (!jwk) return null;
		const key = await crypto.subtle.importKey(
			"jwk",
			{ kty: jwk.kty, crv: jwk.crv, x: jwk.x },
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		const ok = await crypto.subtle.verify(
			{ name: "Ed25519" },
			key,
			b64uDecode(parts[2]),
			new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
		);
		return ok ? email : null;
	} catch {
		return null;
	}
}
