// Tests du vérificateur de signature — `node --test`, sans Foundry ni licence.
//
// Le vecteur vient de la passerelle Rust : c'est ce qui prouve que les deux
// implémentations, versionnées séparément, s'accordent sur le format de fil.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { verifyCommand, DANGEROUS_COMMANDS } from "../scripts/verify.mjs";

const V = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8"));
const WORLD = V.message.world;
const NOW = V.signedAtMs + 1000; // dans la fenêtre de validité

/** Le cas nominal, avec une altération optionnelle du message. */
const check = (patch = {}, over = {}) =>
  verifyCommand({
    msg: { ...V.message, ...patch },
    publicKeyHex: V.publicKeyHex,
    worldId: WORLD,
    now: NOW,
    ...over,
  });

test("une commande signée par la passerelle est acceptée", async () => {
  const r = await check();
  assert.equal(r.ok, true);
  // Les arguments rendus viennent de argsRaw — donc de ce qui a été vérifié.
  assert.deepEqual(r.args, { macro: "Open Calendar" });
});

test("les arguments exécutés sont ceux qui ont été signés", async () => {
  // Le scénario réel : un joueur intercepte une enveloppe légitime et remplace
  // args en laissant argsRaw intact, en espérant qu'on exécute args.
  const r = await check({ args: { macro: "Evil" } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { macro: "Open Calendar" }, "args non signés utilisés !");
});

test("modifier argsRaw invalide la signature", async () => {
  const r = await check({ argsRaw: '{"macro":"Evil"}' });
  assert.deepEqual(r, { ok: false, reason: "bad-signature" });
});

test("chaque champ signé est lié", async () => {
  for (const [patch, label] of [
    [{ cmd: "run_script" }, "commande"],
    [{ id: "autre" }, "nonce"],
    [{ exp: V.message.exp + 1 }, "expiration"],
  ]) {
    const r = await check(patch);
    assert.equal(r.ok, false, `${label} non lié à la signature`);
    assert.equal(r.reason, "bad-signature");
  }
});

test("une commande signée pour un autre monde est refusée", async () => {
  const r = await verifyCommand({
    msg: V.message, publicKeyHex: V.publicKeyHex, worldId: "un-autre-monde", now: NOW,
  });
  assert.deepEqual(r, { ok: false, reason: "wrong-world" });
});

test("une commande expirée est refusée, tolérance d'horloge comprise", async () => {
  // Juste dans la tolérance : accepté, car une horloge de quelques minutes de
  // décalage est courante et un refus muet serait indiagnosticable.
  const limite = await verifyCommand({
    msg: V.message, publicKeyHex: V.publicKeyHex, worldId: WORLD,
    now: V.message.exp + 119_000,
  });
  assert.equal(limite.ok, true);

  const trop = await verifyCommand({
    msg: V.message, publicKeyHex: V.publicKeyHex, worldId: WORLD,
    now: V.message.exp + 600_000,
  });
  assert.deepEqual(trop, { ok: false, reason: "expired" });
});

test("un message non signé est reconnu comme tel", async () => {
  // C'est le cas d'un joueur qui émet à la main, ET celui d'une passerelle 1.5.
  const nu = { mcp: true, cmd: "run_macro", id: "x", args: { macro: "Evil" } };
  const r = await verifyCommand({
    msg: nu, publicKeyHex: V.publicKeyHex, worldId: WORLD, now: NOW,
  });
  assert.deepEqual(r, { ok: false, reason: "unsigned" });
});

test("sans clé configurée, rien n'est authentifiable", async () => {
  const r = await verifyCommand({
    msg: V.message, publicKeyHex: "", worldId: WORLD, now: NOW,
  });
  assert.deepEqual(r, { ok: false, reason: "no-key" });
});

test("une clé mal formée est refusée sans planter", async () => {
  for (const mauvaise of ["pas-de-l-hex", "04ab", "ff".repeat(65), "abc"]) {
    const r = await verifyCommand({
      msg: V.message, publicKeyHex: mauvaise, worldId: WORLD, now: NOW,
    });
    assert.equal(r.ok, false);
    assert.ok(["bad-key", "bad-signature"].includes(r.reason), `clé « ${mauvaise} » → ${r.reason}`);
  }
});

test("une signature d'une autre clé est refusée", async () => {
  // Un attaquant qui signe avec SA clé : la forme est bonne, l'origine non.
  const autre = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", autre.publicKey));
  const hex = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  const r = await verifyCommand({
    msg: V.message, publicKeyHex: hex, worldId: WORLD, now: NOW,
  });
  assert.deepEqual(r, { ok: false, reason: "bad-signature" });
});

test("un argsRaw illisible est refusé", async () => {
  // La signature doit d'abord échouer : on n'analyse jamais du JSON non vérifié.
  const r = await check({ argsRaw: "pas du json" });
  assert.equal(r.ok, false);
});

test("les commandes dangereuses sont bien celles qui exécutent du code", () => {
  assert.ok(DANGEROUS_COMMANDS.has("run_script"));
  assert.ok(DANGEROUS_COMMANDS.has("run_macro"));
  assert.ok(!DANGEROUS_COMMANDS.has("pan"));
  assert.ok(!DANGEROUS_COMMANDS.has("ask"));
});
