// pursor — sweep plan schema validator.
//
// Validates a parsed JSON object against the sweep plan grammar used by
// runSweep(). Returns { valid, errors } with a flat list of human-readable
// error messages. This is intentionally lightweight (no JSON-schema
// dependency) but covers the practical cases that bite users: missing
// op keys, wrong types, unknown ops, out-of-range numbers.

const KNOWN_OPS = new Set([
  "shoot", "hover", "frames", "diff", "audit", "dom", "seq", "eval",
  "every-viewport", "baseline-save", "baseline-approve", "diff-baseline",
]);

const KNOWN_SWEEP_PLUGIN_OPS = new Set(); // populated at runtime by plugins

export function registerSweepOp(name) { KNOWN_SWEEP_PLUGIN_OPS.add(name); }

function isPlainObject(x) { return x != null && typeof x === "object" && !Array.isArray(x); }

function err(errors, path, msg) { errors.push(`${path}: ${msg}`); }

function validateStep(step, i, errors, ctx) {
  const base = `steps[${i}]`;
  if (!isPlainObject(step)) { err(errors, base, "must be an object"); return; }
  const keys = Object.keys(step).filter(k => k !== "name");
  if (step.name !== undefined && typeof step.name !== "string") err(errors, `${base}.name`, "must be a string");
  if (!keys.length) { err(errors, base, `must define exactly one operation key (one of: ${[...KNOWN_OPS].join(", ")})`); return; }
  if (keys.length > 1) err(errors, base, `defines multiple operation keys (${keys.join(", ")}); only one allowed`);
  const op = keys[0];
  if (!KNOWN_OPS.has(op) && !KNOWN_SWEEP_PLUGIN_OPS.has(op)) err(errors, `${base}.${op}`, `unknown op; expected one of ${[...KNOWN_OPS].join(", ")}`);
  const v = step[op];
  if (!isPlainObject(v)) { err(errors, `${base}.${op}`, "must be an object"); return; }
  // Per-op checks
  if (op === "shoot") {
    if (v.url !== undefined && typeof v.url !== "string") err(errors, `${base}.shoot.url`, "must be a string");
  } else if (op === "hover") {
    if (typeof v.selector !== "string") err(errors, `${base}.hover.selector`, "required string");
  } else if (op === "frames") {
    if (v.count !== undefined && !(Number.isFinite(Number(v.count)) && Number(v.count) >= 1 && Number(v.count) <= 120))
      err(errors, `${base}.frames.count`, "must be a number between 1 and 120");
    if (v.intervalMs !== undefined && !(Number.isFinite(Number(v.intervalMs)) && Number(v.intervalMs) >= 16))
      err(errors, `${base}.frames.intervalMs`, "must be >= 16");
  } else if (op === "diff") {
    if (typeof v.ref !== "string") err(errors, `${base}.diff.ref`, "required string (step name or filename)");
    if (v.threshold !== undefined && !(Number.isFinite(Number(v.threshold)) && Number(v.threshold) >= 0 && Number(v.threshold) <= 1))
      err(errors, `${base}.diff.threshold`, "must be 0..1");
  } else if (op === "audit") {
    if (v.tags !== undefined && typeof v.tags !== "string") err(errors, `${base}.audit.tags`, "must be a string (comma-separated)");
  } else if (op === "baseline-save" || op === "baseline-approve") {
    if (v.id !== undefined && typeof v.id !== "string") err(errors, `${base}.${op}.id`, "must be a string");
  } else if (op === "diff-baseline") {
    if (v.id !== undefined && typeof v.id !== "string") err(errors, `${base}.diff-baseline.id`, "must be a string");
  }
  // Step name uniqueness (soft check)
  if (ctx.seenNames.has(step.name)) err(errors, `${base}.name`, `duplicate step name "${step.name}"`);
  ctx.seenNames.add(step.name);
}

export function validateSweepPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) { return { valid: false, errors: ["plan: must be an object"] }; }
  if (!Array.isArray(plan.steps)) { return { valid: false, errors: ["plan.steps: required array"] }; }
  if (!plan.steps.length) err(errors, "plan.steps", "must be non-empty");
  if (plan.base !== undefined && typeof plan.base !== "string") err(errors, "plan.base", "must be a string");
  if (plan.outDir !== undefined && typeof plan.outDir !== "string") err(errors, "plan.outDir", "must be a string");
  if (plan.name !== undefined && typeof plan.name !== "string") err(errors, "plan.name", "must be a string");
  const ctx = { seenNames: new Set() };
  plan.steps.forEach((s, i) => validateStep(s, i, errors, ctx));
  return { valid: errors.length === 0, errors };
}
