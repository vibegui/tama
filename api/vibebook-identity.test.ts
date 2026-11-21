import { afterAll, expect, test } from "bun:test";
import { vibebookOwner } from "./vibebook-identity.ts";

const URL_ = "https://beto.example.dev/api/mcp";
const b64u = (b: ArrayBuffer | Uint8Array) =>
	Buffer.from(new Uint8Array(b)).toString("base64url");

const { privateKey, publicKey } = (await crypto.subtle.generateKey(
	{ name: "Ed25519" },
	true,
	["sign", "verify"],
)) as CryptoKeyPair;
const pub = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () =>
	Response.json({ keys: [{ ...pub, kid: "k1" }] })) as unknown as typeof fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

async function jwt(body: Record<string, unknown>, key = privateKey) {
	const h = b64u(
		new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", kid: "k1" })),
	);
	const now = Math.floor(Date.now() / 1000);
	const b = b64u(
		new TextEncoder().encode(
			JSON.stringify({
				iss: "https://vibebook.dev",
				email: "owner@x.com",
				aud: URL_,
				exp: now + 300,
				...body,
			}),
		),
	);
	const s = await crypto.subtle.sign(
		{ name: "Ed25519" },
		key,
		new TextEncoder().encode(`${h}.${b}`),
	);
	return `${h}.${b}.${b64u(s)}`;
}
const req = (t?: string) =>
	new Request(URL_, {
		method: "POST",
		headers: t ? { "x-vibebook-identity": t } : {},
	});

test("valid seal from an owner passes", async () => {
	expect(await vibebookOwner(req(await jwt({})), "owner@x.com")).toBe(
		"owner@x.com",
	);
});

test("new issuer chat.decocms.com passes", async () => {
	expect(
		await vibebookOwner(
			req(await jwt({ iss: "https://chat.decocms.com" })),
			"owner@x.com",
		),
	).toBe("owner@x.com");
});

test("rejects: not owner, wrong aud, expired, wrong iss, bad sig, missing, feature off", async () => {
	const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const now = Math.floor(Date.now() / 1000);
	const cases = [
		[await jwt({ email: "eve@x.com" }), "owner@x.com"],
		[await jwt({ aud: "https://evil.dev/api/mcp" }), "owner@x.com"],
		[await jwt({ exp: now - 1 }), "owner@x.com"],
		[await jwt({ iss: "https://evil.dev" }), "owner@x.com"],
		[await jwt({}, other.privateKey), "owner@x.com"],
		[undefined, "owner@x.com"],
		[await jwt({}), undefined],
	] as const;
	for (const [t, owners] of cases)
		expect(await vibebookOwner(req(t), owners)).toBeNull();
});
