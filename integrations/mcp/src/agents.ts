import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, parse as parsePath, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";
import { lock as acquireLock } from "proper-lockfile";
import { getStaticTOMLValue, parseTOML, type AST } from "toml-eslint-parser";

export type AgentId = "omp" | "codex" | "claude-code" | "cursor";
export type SkillId = "anti-ui-slop" | "ui-design" | "ui-radar";

export const AGENT_IDS: readonly AgentId[] = ["omp", "codex", "claude-code", "cursor"];
export const SKILL_IDS: readonly SkillId[] = ["anti-ui-slop", "ui-design", "ui-radar"];

const SERVER_NAME = "ui-reference";
const LOCK_OPTIONS = {
  realpath: false,
  stale: 30_000,
  update: 5_000,
  retries: {
    retries: 240,
    factor: 1,
    minTimeout: 500,
    maxTimeout: 500,
    randomize: false,
  },
} as const;
const JSON_DENYLIST_KEYS = [
  "disabledMcpServers",
  "disabledMcpjsonServers",
  "disabledServers",
  "mcpServerDenylist",
  "mcpServersDenylist",
  "mcpDenylist",
] as const;
const TOML_STALE_KEYS: Record<string, true> = {
  type: true,
  url: true,
  httpUrl: true,
  serverUrl: true,
  headers: true,
  env: true,
  auth: true,
  oauth: true,
  transport: true,
};
const RESERVED_OMP_PROFILES: Record<string, true> = {
  default: true,
  profiles: true,
  agent: true,
};
const execFile = promisify(execFileCallback);
const invokingCwd = process.cwd();

type ConfigFormat = "jsonc" | "toml";
type ConfigState = "new" | "identical" | "managed" | "conflict";

export interface AgentRegistrationPlan {
  readonly agent: AgentId;
  readonly configPath: string;
  readonly format: ConfigFormat;
  readonly desired: Readonly<Record<string, unknown>>;
  readonly state: ConfigState;
  readonly disabled: boolean;
  readonly denied: boolean;
  readonly sourceSnapshot: string | undefined;
  readonly shadowWarning?: string;
}

export interface RegistrationConsent {
  replace: ReadonlySet<string>;
  enable: ReadonlySet<string>;
}

export interface RegisteredAgentResult {
  agent: AgentId;
  configPath: string;
  status: "registered" | "already-current";
  hostInstalled: boolean;
  shadowWarning?: string;
}

export interface AgentPathOptions {
  ompProfile?: string;
}

export class AgentConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentConfigurationError";
  }
}

function trimmedEnvironmentPath(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? expandUserPath(value) : undefined;
}

function expandUserPath(value: string): string {
  const home = homedir();
  if (value === "~") return home;
  if (value.startsWith(`~${sep}`)) return join(home, value.slice(2));
  return resolve(invokingCwd, value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}


function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as NodeJS.ErrnoException).code === code;
}

function runReadOnlyOmp(args: string[]): Promise<string> {
  return execFile("omp", args, { encoding: "utf8", timeout: 10_000, windowsHide: true }).then(({ stdout }) => String(stdout).trim());
}

function normalizeOmpProfile(explicit?: string): string {
  let profile: string;
  if (explicit !== undefined) {
    profile = explicit.trim();
  } else if (process.env.OMP_PROFILE !== undefined) {
    profile = process.env.OMP_PROFILE.trim();
  } else {
    profile = process.env.PI_PROFILE?.trim() ?? "";
  }
  if (!profile) return "";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile) ||
      RESERVED_OMP_PROFILES[profile] === true) {
    throw new AgentConfigurationError("OMP profile must be a non-reserved name matching ^[a-z0-9][a-z0-9._-]{0,63}$.");
  }
  return profile;
}

async function resolveOmpAgentDir(explicitProfile?: string): Promise<string> {
  const profile = normalizeOmpProfile(explicitProfile);
  const args = [...(profile ? ["--profile", profile] : []), "config", "path", "--json"];
  try {
    const output = await runReadOnlyOmp(args);
    if (!output || !isAbsolute(output)) {
      throw new AgentConfigurationError("omp config path did not return an absolute agent directory.");
    }
    return resolve(output);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      if (error instanceof AgentConfigurationError) throw error;
      throw new AgentConfigurationError("Unable to resolve the active omp agent directory using `omp config path --json`.", {
        cause: error,
      });
    }
  }

  const configuredRoot = process.env.PI_CONFIG_DIR?.trim();
  const root = !configuredRoot
    ? join(homedir(), ".omp")
    : configuredRoot === "~"
      ? homedir()
      : configuredRoot.startsWith(`~${sep}`)
        ? join(homedir(), configuredRoot.slice(2))
        : isAbsolute(configuredRoot)
          ? resolve(configuredRoot)
          : resolve(homedir(), configuredRoot);
  if (profile) return join(root, "profiles", profile, "agent");
  const configuredAgent = process.env.PI_CODING_AGENT_DIR?.trim();
  return configuredAgent ? expandUserPath(configuredAgent) : join(root, "agent");
}

function homeConfigPath(environmentName: string, defaultDirectory: string, fileName: string): string {
  const directory = trimmedEnvironmentPath(environmentName) ?? join(homedir(), defaultDirectory);
  return join(directory, fileName);
}

interface AgentTarget {
  agent: AgentId;
  configPath: string;
  format: ConfigFormat;
  desired: Readonly<Record<string, unknown>>;
}

export async function resolveAgentConfigPaths(
  agents: readonly AgentId[],
  options: AgentPathOptions = {},
): Promise<ReadonlyArray<AgentTarget>> {
  const targets: AgentTarget[] = [];
  for (const agent of [...new Set(agents)]) {
    let configPath: string;
    let format: ConfigFormat;
    let desired: Readonly<Record<string, unknown>>;
    if (agent === "omp") {
      const agentDir = await resolveOmpAgentDir(options.ompProfile);
      configPath = join(agentDir, "mcp.json");
      format = "jsonc";
      desired = {
        type: "stdio",
        command: process.execPath,
        args: ["__DURABLE_CLI__", "serve"],
        enabled: true,
      };
    } else if (agent === "codex") {
      configPath = homeConfigPath("CODEX_HOME", ".codex", "config.toml");
      format = "toml";
      desired = { command: process.execPath, args: ["__DURABLE_CLI__", "serve"], enabled: true };
    } else if (agent === "claude-code") {
      const configured = trimmedEnvironmentPath("CLAUDE_CONFIG_DIR");
      configPath = configured
        ? join(configured, ".claude.json")
        : join(homedir(), ".claude.json");
      format = "jsonc";
      desired = {
        type: "stdio",
        command: process.execPath,
        args: ["__DURABLE_CLI__", "serve"],
      };
    } else {
      configPath = join(homedir(), ".cursor", "mcp.json");
      format = "jsonc";
      desired = {
        type: "stdio",
        command: process.execPath,
        args: ["__DURABLE_CLI__", "serve"],
      };
    }
    targets.push({ agent, configPath: resolve(configPath), format, desired });
  }
  return targets;
}

function desiredWithCli(target: AgentTarget, cliPath: string): Readonly<Record<string, unknown>> {
  const desired = { ...target.desired };
  desired.args = [cliPath, "serve"];
  return desired;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftObject = objectValue(left);
  const rightObject = objectValue(right);
  if (!leftObject || !rightObject) return false;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && deepEqual(leftObject[key], rightObject[key]));
}

function recognizedManagedLauncher(entry: unknown): boolean {
  const object = objectValue(entry);
  if (!object || typeof object.command !== "string" || !isAbsolute(object.command)) return false;
  if (!Array.isArray(object.args) || object.args.length !== 2 || object.args[1] !== "serve") return false;
  const launcher = object.args[0];
  return typeof launcher === "string" && isAbsolute(launcher) &&
    launcher.replaceAll("\\", "/").endsWith("/integrations/mcp/dist/cli.js");
}

function jsonParse(text: string, path: string): unknown {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) throw new AgentConfigurationError(`Malformed JSONC agent configuration: ${path}.`);
  return value;
}

function findJsonDenylist(root: Record<string, unknown>): { key: string; indexes: number[] }[] {
  const found: { key: string; indexes: number[] }[] = [];
  for (const key of JSON_DENYLIST_KEYS) {
    const value = root[key];
    if (!Array.isArray(value)) continue;
    const indexes = value.flatMap((item, index) => item === SERVER_NAME ? [index] : []);
    if (indexes.length > 0) found.push({ key, indexes });
  }
  return found;
}

interface JsonInspection {
  state: ConfigState;
  disabled: boolean;
  denied: boolean;
  hasEntry: boolean;
}

function inspectJson(text: string | undefined, path: string, desired: Readonly<Record<string, unknown>>): JsonInspection {
  if (text === undefined) return { state: "new", disabled: false, denied: false, hasEntry: false };
  const parsed = objectValue(jsonParse(text, path));
  if (!parsed) throw new AgentConfigurationError(`Agent configuration root must be a JSON object: ${path}.`);
  const serversValue = parsed.mcpServers;
  if (serversValue !== undefined && !objectValue(serversValue)) {
    throw new AgentConfigurationError(`mcpServers must be a JSON object in ${path}.`);
  }
  const servers = objectValue(serversValue);
  const entry = servers?.[SERVER_NAME];
  const hasEntry = entry !== undefined;
  const denylist = findJsonDenylist(parsed);
  if (!hasEntry) {
    return { state: "new", disabled: false, denied: denylist.length > 0, hasEntry };
  }
  const entryObject = objectValue(entry);
  const state: ConfigState = !entryObject
    ? "conflict"
    : deepEqual(entry, desired)
      ? "identical"
      : recognizedManagedLauncher(entry)
        ? "managed"
        : "conflict";
  return {
    state,
    disabled: entryObject?.enabled === false,
    denied: denylist.length > 0,
    hasEntry,
  };
}

function tomlKeySegments(key: AST.TOMLKey): string[] {
  return key.keys.map((part) => part.type === "TOMLBare" ? part.name : part.value);
}

function tomlRoot(program: AST.TOMLProgram, path: string): Record<string, unknown> {
  try {
    const value = objectValue(getStaticTOMLValue(program));
    if (!value) throw new Error("root is not a table");
    return value;
  } catch (error) {
    throw new AgentConfigurationError(`Unable to read TOML agent configuration: ${path}.`, { cause: error });
  }
}

function inspectToml(text: string | undefined, path: string, desired: Readonly<Record<string, unknown>>): JsonInspection {
  if (text === undefined) return { state: "new", disabled: false, denied: false, hasEntry: false };
  let program: AST.TOMLProgram;
  try {
    program = parseTOML(text, { tomlVersion: "1.0" });
  } catch (error) {
    throw new AgentConfigurationError(`Malformed TOML agent configuration: ${path}.`, { cause: error });
  }
  const root = tomlRoot(program, path);
  const serversValue = root.mcp_servers;
  if (serversValue !== undefined && !objectValue(serversValue)) {
    throw new AgentConfigurationError(`mcp_servers must be a TOML table in ${path}.`);
  }
  const servers = objectValue(serversValue);
  const entry = servers?.[SERVER_NAME];
  const hasEntry = entry !== undefined;
  if (!hasEntry) return { state: "new", disabled: false, denied: false, hasEntry };
  const entryObject = objectValue(entry);
  const state: ConfigState = !entryObject
    ? "conflict"
    : deepEqual(entry, desired)
      ? "identical"
      : recognizedManagedLauncher(entry)
        ? "managed"
        : "conflict";
  return { state, disabled: entryObject?.enabled === false, denied: false, hasEntry };
}

async function readTargetFile(path: string): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new AgentConfigurationError(`Agent configuration must be a regular non-symlink file: ${path}.`);
    }
    if ((stats.mode & 0o200) === 0) {
      throw new AgentConfigurationError(`Agent configuration is not writable: ${path}.`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    if (error instanceof AgentConfigurationError) throw error;
    throw new AgentConfigurationError(`Unable to read agent configuration: ${path}.`, { cause: error });
  }
}

async function projectShadowWarning(agent: AgentId): Promise<string | undefined> {
  const projectDirectories: string[] = [];
  let directory = invokingCwd;
  while (directory !== homedir()) {
    projectDirectories.push(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const candidates: string[] = [];
  for (const projectDirectory of projectDirectories) {
    if (agent === "omp") candidates.push(join(projectDirectory, ".omp", "agent", "mcp.json"));
    if (agent === "codex") candidates.push(join(projectDirectory, ".codex", "config.toml"));
    if (agent === "claude-code") {
      candidates.push(join(projectDirectory, ".mcp.json"), join(projectDirectory, ".claude", "settings.json"));
    }
    if (agent === "cursor") candidates.push(join(projectDirectory, ".cursor", "mcp.json"));
  }
  for (const candidate of candidates) {
    const text = await readTargetFileForInspection(candidate);
    if (text === undefined) continue;
    try {
      if (candidate.endsWith(".toml")) {
        const parsed = parseTOML(text, { tomlVersion: "1.0" });
        const root = tomlRoot(parsed, candidate);
        const servers = objectValue(root.mcp_servers);
        if (servers && Object.hasOwn(servers, SERVER_NAME)) {
          return `Project-local ui-reference policy at ${candidate} may override or disable this global registration; it was left unchanged.`;
        }
      } else {
        const parsed = objectValue(jsonParse(text, candidate));
        if (!parsed) continue;
        const servers = objectValue(parsed.mcpServers);
        const hasEntry = Boolean(servers && Object.hasOwn(servers, SERVER_NAME));
        const disabledArrays = findJsonDenylist(parsed).length > 0;
        const policyLists = [parsed.disabledMcpjsonServers, parsed.enabledMcpjsonServers]
          .some((list) => Array.isArray(list) && list.includes(SERVER_NAME));
        if (hasEntry || disabledArrays || policyLists) {
          return `Project-local ui-reference policy at ${candidate} may override or disable this global registration; it was left unchanged.`;
        }
      }
    } catch {
      return `A project-local configuration at ${candidate} could not be inspected; global registration will not modify it.`;
    }
  }
  return undefined;
}

async function readTargetFileForInspection(path: string): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw new AgentConfigurationError(`Unable to inspect project policy safely: ${path}.`, { cause: error });
  }
}

export async function planAgentRegistrations(
  agents: readonly AgentId[],
  cliPath: string,
  options: AgentPathOptions = {},
): Promise<ReadonlyArray<AgentRegistrationPlan>> {
  const targets = await resolveAgentConfigPaths(agents, options);
  const plans: AgentRegistrationPlan[] = [];
  for (const target of targets) {
    const configPath = resolve(target.configPath);
    const snapshot = await readTargetFile(configPath);
    const desired = desiredWithCli(target, cliPath);
    const inspection = target.format === "jsonc"
      ? inspectJson(snapshot, configPath, desired)
      : inspectToml(snapshot, configPath, desired);
    const shadowWarning = await projectShadowWarning(target.agent);
    plans.push({
      agent: target.agent,
      configPath,
      format: target.format,
      desired,
      state: inspection.state,
      disabled: inspection.disabled,
      denied: inspection.denied,
      sourceSnapshot: snapshot,
      ...(shadowWarning ? { shadowWarning } : {}),
    });
  }
  return plans;
}

export function describeAgentPlan(plan: AgentRegistrationPlan): string {
  const state = plan.state === "new" ? "new entry" :
    plan.state === "identical" ? "already current" :
      plan.state === "managed" ? "managed launcher update" : "foreign/custom entry requires replacement consent";
  const disabled = plan.disabled || plan.denied ? "; currently disabled/denied (enable consent required)" : "";
  return `${plan.agent}: ${plan.configPath} (${state}${disabled})`;
}

function jsonRootAndServers(text: string, path: string): { root: Record<string, unknown>; servers?: Record<string, unknown> } {
  const root = objectValue(jsonParse(text, path));
  if (!root) throw new AgentConfigurationError(`Agent configuration root must be a JSON object: ${path}.`);
  const rawServers = root.mcpServers;
  if (rawServers !== undefined && !objectValue(rawServers)) {
    throw new AgentConfigurationError(`mcpServers must be a JSON object in ${path}.`);
  }
  return { root, servers: objectValue(rawServers) };
}

function jsonApplyPlan(text: string, path: string, desired: Readonly<Record<string, unknown>>): string {
  let output = text;
  const { root } = jsonRootAndServers(output, path);
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: output.includes("\r\n") ? "\r\n" : "\n" };
  output = applyEdits(output, modify(output, ["mcpServers", SERVER_NAME], desired, { formattingOptions }));
  const parsed = jsonRootAndServers(output, path);
  for (const key of JSON_DENYLIST_KEYS) {
    const values = parsed.root[key];
    if (!Array.isArray(values)) continue;
    const indexes = values.flatMap((item, index) => item === SERVER_NAME ? [index] : []).sort((a, b) => b - a);
    for (const index of indexes) {
      output = applyEdits(output, modify(output, [key, index], undefined, { formattingOptions }));
    }
  }
  const verified = jsonRootAndServers(output, path).servers?.[SERVER_NAME];
  if (!deepEqual(verified, desired)) throw new AgentConfigurationError(`Could not safely register ui-reference in ${path}.`);
  return output.endsWith("\n") ? output : `${output}\n`;
}

function tomlKeyValueSegments(item: AST.TOMLKeyValue): string[] {
  return tomlKeySegments(item.key);
}


function tomlQuote(value: string): string {
  return JSON.stringify(value);
}

function tomlDesiredLiteral(value: unknown): string {
  if (typeof value === "string") return tomlQuote(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => tomlDesiredLiteral(item)).join(", ")}]`;
  throw new AgentConfigurationError("Unsupported value in generated Codex MCP configuration.");
}

interface TomlEdit {
  start: number;
  end: number;
  replacement: string;
}

function applyTomlEdits(text: string, edits: TomlEdit[]): string {
  edits.sort((left, right) => right.start - left.start || right.end - left.end);
  let output = text;
  for (const edit of edits) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}

function astBody(program: AST.TOMLProgram): (AST.TOMLKeyValue | AST.TOMLTable)[] {
  return program.body[0].body;
}

function parseTomlConfig(text: string, path: string): AST.TOMLProgram {
  try {
    return parseTOML(text, { tomlVersion: "1.0" });
  } catch (error) {
    throw new AgentConfigurationError(`Malformed TOML agent configuration: ${path}.`, { cause: error });
  }
}


function getNodeRange(node: AST.TOMLNode): [number, number] {
  return node.range;
}

function generatedInlineServer(desired: Readonly<Record<string, unknown>>): string {
  return `{ ${Object.entries(desired).map(([key, value]) => `${key} = ${tomlDesiredLiteral(value)}`).join(", ")} }`;
}

function updateInlineServer(
  text: string,
  entry: AST.TOMLInlineTable,
  desired: Readonly<Record<string, unknown>>,
): string {
  const [start, end] = getNodeRange(entry);
  return applyTomlEdits(text, [{ start, end, replacement: generatedInlineServer(desired) }]);
}

function addNestedInlineEntry(
  text: string,
  parent: AST.TOMLInlineTable,
  desired: Readonly<Record<string, unknown>>,
): string {
  const [, end] = getNodeRange(parent);
  const hasEntries = parent.body.length > 0;
  const addition = `${hasEntries ? ", " : ""}${tomlQuote(SERVER_NAME)} = ${generatedInlineServer(desired)}`;
  return applyTomlEdits(text, [{ start: end - 1, end: end - 1, replacement: addition }]);
}

function findTomlTable(program: AST.TOMLProgram, resolved: string[]): AST.TOMLTable | undefined {
  return astBody(program).find((item): item is AST.TOMLTable =>
    item.type === "TOMLTable" && item.resolvedKey.length === resolved.length &&
    item.resolvedKey.every((part, index) => part === resolved[index]));
}

function staleTomlEntries(entries: AST.TOMLKeyValue[], prefix: string[]): AST.TOMLKeyValue[] {
  return entries.filter((entry) => {
    const segments = tomlKeyValueSegments(entry);
    return segments.length === prefix.length + 1 && prefix.every((part, index) => segments[index] === part) &&
      TOML_STALE_KEYS[segments.at(-1) ?? ""] === true;
  });
}

function updateTomlTable(
  text: string,
  table: AST.TOMLTable,
  desired: Readonly<Record<string, unknown>>,
): string {
  const edits: TomlEdit[] = [];
  const fields = new Map<string, AST.TOMLKeyValue>();
  for (const item of table.body) {
    const segments = tomlKeyValueSegments(item);
    if (segments.length === 1) fields.set(segments[0]!, item);
  }
  for (const stale of staleTomlEntries(table.body, [])) {
    const [start, end] = stale.range;
    edits.push({ start, end, replacement: "" });
  }
  const additions: string[] = [];
  for (const [key, value] of Object.entries(desired)) {
    const item = fields.get(key);
    const literal = tomlDesiredLiteral(value);
    if (item) {
      const [start, end] = item.value.range;
      edits.push({ start, end, replacement: literal });
    } else {
      additions.push(`${key} = ${literal}`);
    }
  }
  if (additions.length > 0) {
    const lastNode = table.body.at(-1);
    const insertionPoint = lastNode
      ? tomlLineInsertionPoint(text, lastNode.range[1])
      : emptyTableInsertionPoint(text, table);
    edits.push({
      start: insertionPoint,
      end: insertionPoint,
      replacement: assignmentLines(text, insertionPoint, additions),
    });
  }
  return applyTomlEdits(text, edits);
}

function tomlLineInsertionPoint(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline < 0 ? text.length : newline + 1;
}

function assignmentLines(text: string, insertionPoint: number, assignments: string[]): string {
  const prefix = insertionPoint === text.length && text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  return `${prefix}${assignments.join("\n")}\n`;
}

function emptyTableInsertionPoint(text: string, table: AST.TOMLTable): number {
  return tomlLineInsertionPoint(text, table.key.range[1]);
}

function findDottedFields(
  entries: AST.TOMLKeyValue[],
  prefix: string[],
): Map<string, AST.TOMLKeyValue> {
  const fields = new Map<string, AST.TOMLKeyValue>();
  for (const item of entries) {
    const segments = tomlKeyValueSegments(item);
    if (segments.length === prefix.length + 1 && prefix.every((part, index) => segments[index] === part)) {
      fields.set(segments.at(-1)!, item);
    }
  }
  return fields;
}

function updateDottedFields(
  text: string,
  entries: AST.TOMLKeyValue[],
  prefix: string[],
  desired: Readonly<Record<string, unknown>>,
  keyPrefix: string,
  insertionPoint: number,
): string {
  const edits: TomlEdit[] = [];
  const fields = findDottedFields(entries, prefix);
  for (const stale of staleTomlEntries(entries, prefix)) {
    const [start, end] = stale.range;
    edits.push({ start, end, replacement: "" });
  }
  const additions: string[] = [];
  for (const [key, value] of Object.entries(desired)) {
    const existing = fields.get(key);
    const literal = tomlDesiredLiteral(value);
    if (existing) {
      edits.push({ start: existing.value.range[0], end: existing.value.range[1], replacement: literal });
    } else {
      additions.push(`${keyPrefix}${tomlQuote(SERVER_NAME)}.${key} = ${literal}`);
    }
  }
  if (additions.length > 0) {
    edits.push({
      start: insertionPoint,
      end: insertionPoint,
      replacement: assignmentLines(text, insertionPoint, additions),
    });
  }
  return applyTomlEdits(text, edits);
}

function tomlApplyPlan(text: string, path: string, desired: Readonly<Record<string, unknown>>): string {
  const program = parseTomlConfig(text, path);
  const rootBody = astBody(program);
  const topInline = rootBody.find((item): item is AST.TOMLKeyValue =>
    item.type === "TOMLKeyValue" && tomlKeyValueSegments(item).length === 1 &&
    tomlKeyValueSegments(item)[0] === "mcp_servers");
  if (topInline) {
    if (topInline.value.type !== "TOMLInlineTable") {
      throw new AgentConfigurationError(`mcp_servers must be a TOML table in ${path}.`);
    }
    const parent = topInline.value;
    const entryItem = parent.body.find((item) => tomlKeyValueSegments(item).join(".") === SERVER_NAME);
    if (entryItem) {
      if (entryItem.value.type === "TOMLInlineTable") {
        text = updateInlineServer(text, entryItem.value, desired);
      } else {
        const [start, end] = entryItem.value.range;
        text = applyTomlEdits(text, [{ start, end, replacement: generatedInlineServer(desired) }]);
      }
    } else {
      text = addNestedInlineEntry(text, parent, desired);
    }
  } else {
    const parentTable = findTomlTable(program, ["mcp_servers"]);
    const subTable = findTomlTable(program, ["mcp_servers", SERVER_NAME]);
    if (subTable) {
      text = updateTomlTable(text, subTable, desired);
    } else if (parentTable) {
      const directEntry = parentTable.body.find((item) => tomlKeyValueSegments(item).join(".") === SERVER_NAME);
      if (directEntry?.value.type === "TOMLInlineTable") {
        text = updateInlineServer(text, directEntry.value, desired);
      } else if (directEntry) {
        text = applyTomlEdits(text, [{
          start: directEntry.value.range[0],
          end: directEntry.value.range[1],
          replacement: generatedInlineServer(desired),
        }]);
      } else {
        const dottedFields = findDottedFields(parentTable.body, [SERVER_NAME]);
        if (dottedFields.size > 0) {
          const insertionPoint = tomlLineInsertionPoint(
            text,
            parentTable.body.at(-1)?.range[1] ?? parentTable.key.range[1],
          );
          text = updateDottedFields(text, parentTable.body, [SERVER_NAME], desired, "", insertionPoint);
        } else {
          text = `${text.trimEnd()}\n\n[mcp_servers.${tomlQuote(SERVER_NAME)}]\n${Object.entries(desired)
            .map(([key, value]) => `${key} = ${tomlDesiredLiteral(value)}`).join("\n")}\n`;
        }
      }
    } else {
      const dottedItem = rootBody.find((item): item is AST.TOMLKeyValue =>
        item.type === "TOMLKeyValue" && tomlKeyValueSegments(item).slice(0, 2).join(".") ===
          `mcp_servers.${SERVER_NAME}`);
      if (dottedItem && tomlKeyValueSegments(dottedItem).length === 2) {
        if (dottedItem.value.type === "TOMLInlineTable") {
          text = updateInlineServer(text, dottedItem.value, desired);
        } else {
          text = applyTomlEdits(text, [{
            start: dottedItem.value.range[0],
            end: dottedItem.value.range[1],
            replacement: generatedInlineServer(desired),
          }]);
        }
      } else {
        const rootEntries = rootBody.filter((item): item is AST.TOMLKeyValue => item.type === "TOMLKeyValue");
        const prefix = ["mcp_servers", SERVER_NAME];
        const directFields = findDottedFields(rootEntries, prefix);
        if (directFields.size > 0) {
          const lastServerEntry = rootEntries.filter((item) => {
            const segments = tomlKeyValueSegments(item);
            return segments.length > prefix.length && prefix.every((part, index) => segments[index] === part);
          }).at(-1);
          const insertionPoint = tomlLineInsertionPoint(text, lastServerEntry?.range[1] ?? text.length);
          text = updateDottedFields(
            text,
            rootEntries,
            prefix,
            desired,
            `mcp_servers.`,
            insertionPoint,
          );
        } else {
          text = `${text.trimEnd()}\n\n[mcp_servers.${tomlQuote(SERVER_NAME)}]\n${Object.entries(desired)
            .map(([key, value]) => `${key} = ${tomlDesiredLiteral(value)}`).join("\n")}\n`;
        }
      }
    }
  }

  const verified = tomlRoot(parseTomlConfig(text, path), path);
  const serverMap = objectValue(verified.mcp_servers);
  if (!deepEqual(serverMap?.[SERVER_NAME], desired)) {
    throw new AgentConfigurationError(`Could not safely register ui-reference in ${path}.`);
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function ensureNoSymlinkComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new AgentConfigurationError(`Refusing a symlink in selected configuration path: ${current}.`);
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      if (error instanceof AgentConfigurationError) throw error;
      throw new AgentConfigurationError(`Unable to inspect selected configuration path: ${current}.`, { cause: error });
    }
  }
}

async function ensureConfigParent(path: string): Promise<void> {
  const parent = dirname(path);
  await ensureNoSymlinkComponents(parent);
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new AgentConfigurationError(`Unable to create selected configuration directory: ${parent}.`, { cause: error });
  }
  await ensureNoSymlinkComponents(parent);
}

async function atomicReplaceConfig(path: string, contents: string, expectedSnapshot: string | undefined): Promise<void> {
  await ensureNoSymlinkComponents(path);
  const current = await readTargetFile(path);
  if (current !== expectedSnapshot) {
    throw new AgentConfigurationError(`Agent configuration changed after review; retry safely at ${path}.`);
  }

  let mode = 0o600;
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new AgentConfigurationError(`Agent configuration must be a regular non-symlink file: ${path}.`);
    }
    mode = stats.mode & 0o7777;
    await access(path, fsConstants.W_OK);
    if ((mode & 0o200) === 0) throw new AgentConfigurationError(`Agent configuration is not writable: ${path}.`);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      if (error instanceof AgentConfigurationError) throw error;
      throw new AgentConfigurationError(`Agent configuration is not writable: ${path}.`, { cause: error });
    }
  }

  const temporary = join(dirname(path), `.${parsePath(path).base}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), mode);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode);
    await ensureNoSymlinkComponents(path);
    const immediatelyCurrent = await readTargetFile(path);
    if (immediatelyCurrent !== expectedSnapshot) {
      throw new AgentConfigurationError(`Agent configuration changed during update; retry safely at ${path}.`);
    }
    await rename(temporary, path);
    if (expectedSnapshot === undefined) await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof AgentConfigurationError) throw error;
    throw new AgentConfigurationError(`Unable to update agent configuration safely: ${path}.`, { cause: error });
  }
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      return true;
    } catch {
      // Continue through PATH without exposing its contents.
    }
  }
  return false;
}

export async function registerAgentConfigs(
  plans: readonly AgentRegistrationPlan[],
  consent: RegistrationConsent,
): Promise<ReadonlyArray<RegisteredAgentResult>> {
  const results: RegisteredAgentResult[] = [];
  for (const plan of plans) {
    if (plan.state === "conflict" && !consent.replace.has(plan.configPath)) {
      throw new AgentConfigurationError(`Replacement was not approved for ${plan.agent} configuration ${plan.configPath}.`);
    }
    if ((plan.disabled || plan.denied) && !consent.enable.has(plan.configPath)) {
      throw new AgentConfigurationError(`Enabling ui-reference was not approved for ${plan.agent} configuration ${plan.configPath}.`);
    }

    await ensureConfigParent(plan.configPath);
    const release = await acquireLock(plan.configPath, {
      ...LOCK_OPTIONS,
      lockfilePath: `${plan.configPath}.lock`,
    }).catch((error: unknown) => {
      throw new AgentConfigurationError(`Unable to lock agent configuration safely: ${plan.configPath}.`, { cause: error });
    });
    try {
      const latest = await readTargetFile(plan.configPath);
      if (latest !== plan.sourceSnapshot) {
        throw new AgentConfigurationError(`Agent configuration changed after review; retry safely at ${plan.configPath}.`);
      }
      const inspection = plan.format === "jsonc"
        ? inspectJson(latest, plan.configPath, plan.desired)
        : inspectToml(latest, plan.configPath, plan.desired);
      if (inspection.state === "conflict" && !consent.replace.has(plan.configPath)) {
        throw new AgentConfigurationError(`Replacement was not approved for ${plan.agent} configuration ${plan.configPath}.`);
      }
      if ((inspection.disabled || inspection.denied) && !consent.enable.has(plan.configPath)) {
        throw new AgentConfigurationError(`Enabling ui-reference was not approved for ${plan.agent} configuration ${plan.configPath}.`);
      }
      if (inspection.state === "identical" && !inspection.denied && !inspection.disabled) {
        results.push({
          agent: plan.agent,
          configPath: plan.configPath,
          status: "already-current",
          hostInstalled: await isCommandAvailable(plan.agent === "claude-code" ? "claude" : plan.agent),
          ...(plan.shadowWarning ? { shadowWarning: plan.shadowWarning } : {}),
        });
        continue;
      }
      const source = latest ?? (plan.format === "jsonc" ? "{}\n" : "");
      const result = plan.format === "jsonc"
        ? jsonApplyPlan(source, plan.configPath, plan.desired)
        : tomlApplyPlan(source, plan.configPath, plan.desired);
      await atomicReplaceConfig(plan.configPath, result, latest);
      results.push({
        agent: plan.agent,
        configPath: plan.configPath,
        status: "registered",
        hostInstalled: await isCommandAvailable(plan.agent === "claude-code" ? "claude" : plan.agent),
        ...(plan.shadowWarning ? { shadowWarning: plan.shadowWarning } : {}),
      });
    } finally {
      await release().catch((error: unknown) => {
        throw new AgentConfigurationError(`Unable to release agent configuration lock safely: ${plan.configPath}.`, { cause: error });
      });
    }
  }
  return results;
}

export async function resolveSkillDestinations(
  agents: readonly AgentId[],
  skills: readonly SkillId[],
  options: AgentPathOptions = {},
): Promise<ReadonlyArray<{ agent: AgentId; skill: SkillId; path: string; kind: "cli" | "omp" }>> {
  const home = homedir();
  const ompAgentDir = agents.includes("omp") ? await resolveOmpAgentDir(options.ompProfile) : undefined;
  const claudeDirectory = trimmedEnvironmentPath("CLAUDE_CONFIG_DIR") ?? join(home, ".claude");
  const destinations: Array<{ agent: AgentId; skill: SkillId; path: string; kind: "cli" | "omp" }> = [];
  for (const agent of [...new Set(agents)]) {
    for (const skill of [...new Set(skills)]) {
      let path: string;
      let kind: "cli" | "omp";
      if (agent === "omp") {
        path = join(ompAgentDir!, "skills", skill);
        kind = "omp";
      } else if (agent === "claude-code") {
        path = join(claudeDirectory, "skills", skill);
        kind = "cli";
      } else {
        path = join(home, ".agents", "skills", skill);
        kind = "cli";
      }
      destinations.push({ agent, skill, path: resolve(path), kind });
    }
  }
  return destinations;
}

