// Order-independent CLI argument parsing for pursr subcommands.

const DEFAULT_BOOLEAN_FLAGS = new Set([
  "ai", "full", "grid", "help", "json", "no-animation", "no-embed",
  "no-hud", "no-visual", "update", "visible",
]);

export function parseCommandArgs(args = [], { booleanFlags = DEFAULT_BOOLEAN_FLAGS } = {}) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token?.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    const key = token.slice(2, eq >= 0 ? eq : undefined);
    let value;
    if (eq >= 0) value = token.slice(eq + 1);
    else if (booleanFlags.has(key)) value = true;
    else if (i + 1 < args.length && !args[i + 1].startsWith("--")) value = args[++i];
    else value = true;
    flags[key] = value;
  }
  return { flags, positionals };
}

export function filePathArg(value) {
  if (typeof value !== "string") return value;
  return value.startsWith("@") ? value.slice(1) : value;
}
