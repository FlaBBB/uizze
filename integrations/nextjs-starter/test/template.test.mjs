import assert from "node:assert/strict";
import test from "node:test";
import {
  validateContractText,
  validateWorkflowText,
} from "../scripts/template-rules.mjs";

test("a workflow without the released action is rejected", () => {
  assert.throws(() => validateWorkflowText("workflow_call:\npermissions:\n  contents: read\n"), /immutable UIZZE gate/);
});

test("a contract without required states is rejected", () => {
  assert.throws(() => validateContractText("## Screen job"), /User and moment/);
});
