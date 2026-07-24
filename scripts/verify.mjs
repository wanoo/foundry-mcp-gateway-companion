/**
 * Vérification de la signature des commandes reçues sur le canal socket.
 *
 * # Pourquoi
 *
 * Foundry relaie les canaux `module.*` à TOUS les clients du monde et ne dit
 * jamais qui a émis. N'importe quel joueur pouvait donc taper ceci dans sa
 * console et faire exécuter la commande par le MJ, avec ses droits :
 *
 *     game.socket.emit("module.foundry-mcp-gateway-companion",
 *       { mcp: true, cmd: "run_macro", id: "x", args: { macro: "…" } });
 *
 * Le champ `user` du message est écrit par l'émetteur : il ne prouve rien.
 * Seule une signature le peut.
 *
 * # Pur exprès
 *
 * Ce module ne touche NI `game`, NI `ui`, NI `canvas` : tout ce dont il a
 * besoin lui est passé en argument. C'est ce qui permet de le tester sous
 * `node --test`, sans Foundry, sans licence et sans navigateur — et donc à un
 * contributeur externe de travailler dessus.
 *
 * # ECDSA P-256, et pas Ed25519
 *
 * `crypto.subtle` est natif : zéro dépendance, zéro étape de build. Ed25519 y
 * est récent (Chrome 137+) alors que Foundry tourne aussi dans l'Electron de
 * son application de bureau, plus ancien. P-256 marche partout depuis dix ans,
 * pour une sécurité équivalente ici.
 */

/** Doit correspondre à `FORMAT` dans src/foundry/signing.rs de la passerelle. */
const FORMAT = "fmcg-v1";

/** Tolérance d'horloge, en plus de la validité portée par la commande.
 *  Une machine mal réglée de quelques minutes est courante ; refuser sans le
 *  dire produirait un « ça ne marche pas » impossible à diagnostiquer. */
const CLOCK_SKEW_MS = 120_000;

function unhex(hex) {
  if (typeof hex !== "string" || hex.length % 2 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Les clés importées sont mises en cache : réimporter à chaque commande
 *  coûterait un aller-retour crypto pour rien. */
const keyCache = new Map();

async function importKey(publicKeyHex) {
  if (keyCache.has(publicKeyHex)) return keyCache.get(publicKeyHex);
  const raw = unhex(publicKeyHex);
  // Point SEC1 non compressé : 65 octets, préfixe 0x04. C'est ce que produit
  // `--generate-key` côté passerelle et la seule forme que "raw" accepte.
  if (!raw || raw.length !== 65 || raw[0] !== 0x04) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    keyCache.set(publicKeyHex, key);
    return key;
  } catch {
    return null;
  }
}

/**
 * Cette commande vient-elle bien de la passerelle de confiance ?
 *
 * @param {object} o
 * @param {object} o.msg           le message socket reçu tel quel
 * @param {string} o.publicKeyHex  clé publique configurée dans le monde ("" si aucune)
 * @param {string} o.worldId       `game.world.id` du monde courant
 * @param {number} o.now           `Date.now()`
 * @returns {Promise<{ok: true, args: object} | {ok: false, reason: string}>}
 *
 * `reason` fait partie du contrat : c'est lui qui décide du message montré au
 * MJ, et il doit rester stable — les tests s'appuient dessus.
 *   no-key         aucune clé configurée dans ce monde
 *   unsigned       message sans signature (passerelle 1.5, ou joueur)
 *   bad-key        la clé configurée est illisible
 *   bad-signature  signature invalide → ce n'est pas la passerelle
 *   expired        hors de la fenêtre de validité (souvent une horloge fausse)
 *   wrong-world    signée pour un autre monde
 *   bad-args       `argsRaw` illisible, ou ne correspond pas à la signature
 */
export async function verifyCommand({ msg, publicKeyHex, worldId, now }) {
  if (!publicKeyHex) return { ok: false, reason: "no-key" };
  if (!msg?.sig || typeof msg.argsRaw !== "string" || !msg.exp) {
    return { ok: false, reason: "unsigned" };
  }

  const key = await importKey(publicKeyHex);
  if (!key) return { ok: false, reason: "bad-key" };

  // Le monde est vérifié AVANT la signature : une commande signée pour un
  // autre monde est authentique mais destinée ailleurs, et le dire aide plus
  // qu'un « signature invalide » trompeur.
  if (msg.world !== worldId) return { ok: false, reason: "wrong-world" };

  const exp = Number(msg.exp);
  if (!Number.isFinite(exp) || now > exp + CLOCK_SKEW_MS) {
    return { ok: false, reason: "expired" };
  }

  // On reconstruit la charge signée à l'identique, à partir de `argsRaw` — la
  // chaîne EXACTE que la passerelle a signée. Rehacher un JSON re-sérialisé
  // donnerait une autre empreinte : socket.io décode puis ré-encode le
  // message, l'ordre des clés et le format des nombres ne survivent pas.
  const payload = [
    FORMAT, String(msg.cmd), String(msg.id), String(msg.world),
    String(msg.exp), await sha256Hex(msg.argsRaw),
  ].join("\n");

  const sig = unhex(msg.sig);
  if (!sig || sig.length !== 64) return { ok: false, reason: "bad-signature" };

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(payload),
  );
  if (!valid) return { ok: false, reason: "bad-signature" };

  // On exécute ce qui a été VÉRIFIÉ, jamais `msg.args` : c'est la seule façon
  // de garantir que les arguments exécutés sont ceux qui ont été signés.
  let args;
  try {
    args = JSON.parse(msg.argsRaw);
  } catch {
    return { ok: false, reason: "bad-args" };
  }
  if (args === null || typeof args !== "object") return { ok: false, reason: "bad-args" };
  return { ok: true, args };
}

/** Commandes qui exécutent du code avec les droits du MJ. Sans signature
 *  valide, elles sont refusées — le reste continue de fonctionner, pour ne pas
 *  transformer une mise à jour en panne totale. */
export const DANGEROUS_COMMANDS = new Set(["run_script", "run_macro"]);
