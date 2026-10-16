// Miroir des tests de src/foundry/script_guard.rs (passerelle) : les deux
// validateurs MAT doivent rendre le même verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matActionsNeed } from "../scripts/policy.mjs";

test("tuile inoffensive acceptée", () => {
  assert.equal(
    matActionsNeed([
      { id: "a", action: "pause", data: { pause: "pause" } },
      { id: "b", action: "chatmessage", data: { text: "Un piège s'ouvre !", showto: "everyone", chatbubble: "false" } },
      { id: "c", action: "hurtheal", data: { entity: { id: "token" }, value: "- [[2d6]]" } },
      { id: "d", action: "alter", data: { entity: { id: "Scene.a.Token.b" }, attribute: "system.attributes.hp.value", value: "= 5" } },
      { id: "e", action: "teleport", data: { location: { id: "Scene.a.Tile.c", x: "+ 100", sceneId: "a" } } },
    ]),
    null
  );
});

test("runcode, eval, Handlebars et HTML actif refusés", () => {
  for (const a of [
    { action: "runcode", data: { code: "alert(1)" } },
    { action: "alter", data: { attribute: "x", value: "= fetch('//e.vil')" } },
    { action: "chatmessage", data: { text: "{{#with this}}{{/with}}" } },
    { action: "notification", data: { text: "<img src=x onerror=alert(1)>" } },
  ]) {
    assert.equal(matActionsNeed([a])?.setting, "runScriptMode", JSON.stringify(a));
  }
});

test("runmacro exige le réglage des macros", () => {
  assert.equal(matActionsNeed([{ action: "runmacro", data: { entity: { id: "Macro.x" } } }])?.setting, "runMacroScriptMode");
});
