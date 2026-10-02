import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AgentId, SkillId } from "./agents.js";
import { resolveSkillDestinations } from "./agents.js";

const execFile = promisify(execFileCallback);
const SERVER_PACKAGE_NAME = "uizze-ui-reference-mcp";
const PINNED_SKILLS_VERSION = "1.5.20";
const requireFromHere = createRequire(import.meta.url);
const currentPackageRoot = dirname(fileURLToPath(new URL("../../../package.json", import.meta.url)));

export function sourcePackageRoot(): string {
  return currentPackageRoot;
}

interface PackageManifest {
  name: string;
  version: string;
  bin?: Record<string, string> | string;
}

export interface DurableRuntime {
  prefix: string;
  packageRoot: string;
  cliPath: string;
  terminalBinary: string;
  version: string;
  installed: boolean;
}

export interface SkillDestinationPlan {
  readonly path: string;
  readonly skill: SkillId;
  readonly agents: readonly AgentId[];
  readonly kind: "cli" | "omp";
  readonly state: "missing" | "identical" | "conflict";
  readonly snapshot: string | undefined;
}

export interface SkillInstallResult {
  path: string;
  skill: SkillId;
  agents: readonly AgentId[];
  status: "installed" | "already-current" | "declined";
}

export interface SkillReplaceConsent {
  readonly replace: ReadonlySet<string>;
}

export class InstallStageError extends Error {
  readonly stage: string;

  constructor(stage: string, message: string, options?: ErrorOptions) {
    super(`${stage}: ${message}`, options);
    this.name = "InstallStageError";
    this.stage = stage;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as NodeJS.ErrnoException).code === code;
}

function globalPrefix(): string {
  const configured = process.env.UI_REFERENCE_INSTALL_PREFIX?.trim();
  if (!configured) return resolve(join(homedir(), ".local"));
  if (configured === "~") return homedir();
  if (configured.startsWith(`~${sep}`)) return resolve(join(homedir(), configured.slice(2)));
  return resolve(configured);
}

async function npmGlobalRoot(prefix: string): Promise<string> {
  try {
    const { stdout } = await execFile("npm", ["root", "--global", "--prefix", prefix], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    const root = String(stdout).trim();
    if (!root || !isAbsolute(root)) throw new Error("npm returned a non-absolute global module path");
    return resolve(root);
  } catch (error) {
    throw new InstallStageError("runtime discovery", "could not resolve the global npm package directory for the selected prefix.", {
      cause: error,
    });
  }
}


async function readManifest(packageRoot: string, stage: string): Promise<PackageManifest> {
  try {
    const content = await readFile(join(packageRoot, "package.json"), "utf8");
    const parsed = JSON.parse(content) as Partial<PackageManifest>;
    if (parsed.name !== SERVER_PACKAGE_NAME || typeof parsed.version !== "string") {
      throw new Error("package identity does not match");
    }
    return parsed as PackageManifest;
  } catch (error) {
    throw new InstallStageError(stage, "the selected package directory has no valid UI Reference package manifest.", { cause: error });
  }
}

async function validateDurablePackage(packageRoot: string, version: string): Promise<PackageManifest> {
  const manifest = await readManifest(packageRoot, "runtime validation");
  if (manifest.version !== version) {
    throw new InstallStageError("runtime validation", `expected version ${version} at ${packageRoot}.`);
  }
  let current = packageRoot;
  try {
    for (const component of ["", "integrations", "mcp", "dist"]) {
      if (component) current = join(current, component);
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("durable package path contains a non-directory or symlink");
    }
    const cliPath = join(current, "cli.js");
    const cliStats = await lstat(cliPath);
    if (!cliStats.isFile() || cliStats.isSymbolicLink()) throw new Error("CLI entry is not a regular file");
    await access(cliPath, fsConstants.R_OK);
  } catch (error) {
    throw new InstallStageError("runtime validation", `the durable CLI entry is missing or unsafe at ${join(packageRoot, "integrations", "mcp", "dist", "cli.js")}.`, { cause: error });
  }
  return manifest;
}

async function validateTerminalBinary(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() && !stats.isSymbolicLink()) throw new Error("global command is not a file or npm symlink");
    await access(path, fsConstants.X_OK);
  } catch (error) {
    throw new InstallStageError("runtime validation", `the global terminal command is missing or unsafe at ${path}.`, { cause: error });
  }
}

async function sourceManifest(): Promise<PackageManifest> {
  return readManifest(currentPackageRoot, "runtime source");
}

function isSamePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

export async function inspectDurableRuntime(): Promise<DurableRuntime> {
  const prefix = globalPrefix();
  const manifest = await sourceManifest();
  const packageRoot = await npmGlobalRoot(prefix).then((root) => join(root, SERVER_PACKAGE_NAME));
  const cliPath = join(packageRoot, "integrations", "mcp", "dist", "cli.js");
  const terminalBinary = join(prefix, "bin", "ui-reference-mcp");
  let installed = false;
  try {
    await validateDurablePackage(packageRoot, manifest.version);
    await validateTerminalBinary(terminalBinary);
    installed = true;
  } catch {
    // The overview reports this as an install/repair stage, not as a valid runtime.
  }
  return { prefix, packageRoot, cliPath, terminalBinary, version: manifest.version, installed };
}

export async function ensureDurableRuntime(): Promise<DurableRuntime> {
  const prefix = globalPrefix();
  const manifest = await sourceManifest();
  const globalRoot = await npmGlobalRoot(prefix);
  const expectedRoot = join(globalRoot, SERVER_PACKAGE_NAME);
  const currentRoot = resolve(currentPackageRoot);
  const terminalBinary = join(prefix, "bin", "ui-reference-mcp");

  if (isSamePath(currentRoot, expectedRoot)) {
    try {
      await validateDurablePackage(expectedRoot, manifest.version);
      await validateTerminalBinary(terminalBinary);
      return {
        prefix,
        packageRoot: expectedRoot,
        cliPath: join(expectedRoot, "integrations", "mcp", "dist", "cli.js"),
        terminalBinary,
        version: manifest.version,
        installed: false,
      };
    } catch {
      // Repair a damaged or non-durable install from the current built package below.
    }
  }

  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "ui-reference-install-"));
    await chmod(temporaryDirectory, 0o700);
    const packResult = await execFile(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryDirectory],
      { cwd: currentPackageRoot, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    let packed: unknown;
    try {
      packed = JSON.parse(String(packResult.stdout));
    } catch (error) {
      throw new InstallStageError("runtime pack", "npm returned invalid pack metadata.", { cause: error });
    }
    if (!Array.isArray(packed) || typeof packed[0]?.filename !== "string") {
      throw new InstallStageError("runtime pack", "npm did not report a packed package file.");
    }
    const tarball = resolve(temporaryDirectory, packed[0].filename as string);
    const archiveRelativePath = relative(temporaryDirectory, tarball);
    if (!archiveRelativePath || archiveRelativePath.startsWith(`..${sep}`) || isAbsolute(archiveRelativePath)) {
      throw new InstallStageError("runtime pack", "npm returned an archive path outside the private temporary directory.");
    }
    try {
      const tarballStats = await lstat(tarball);
      if (!tarballStats.isFile() || tarballStats.isSymbolicLink()) throw new Error("pack output is not a regular file");
    } catch (error) {
      throw new InstallStageError("runtime pack", "the npm package archive is missing or unsafe.", { cause: error });
    }

    try {
      await execFile(
        "npm",
        ["install", "--global", "--prefix", prefix, "--ignore-scripts", tarball],
        { cwd: currentPackageRoot, encoding: "utf8", windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      throw new InstallStageError("runtime install", `npm could not install the package into ${prefix}.`, { cause: error });
    }
    const installedRoot = await npmGlobalRoot(prefix).then((root) => join(root, SERVER_PACKAGE_NAME));
    await validateDurablePackage(installedRoot, manifest.version);
    await validateTerminalBinary(terminalBinary);
    return {
      prefix,
      packageRoot: installedRoot,
      cliPath: join(installedRoot, "integrations", "mcp", "dist", "cli.js"),
      terminalBinary,
      version: manifest.version,
      installed: true,
    };
  } catch (error) {
    if (error instanceof InstallStageError) throw error;
    throw new InstallStageError("runtime pack", "could not create a durable package from the current built package.", { cause: error });
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function requireDurableRuntime(): Promise<DurableRuntime> {
  const prefix = globalPrefix();
  const manifest = await sourceManifest();
  const packageRoot = join(await npmGlobalRoot(prefix), SERVER_PACKAGE_NAME);
  await validateDurablePackage(packageRoot, manifest.version);
  await validateTerminalBinary(join(prefix, "bin", "ui-reference-mcp"));
  return {
    prefix,
    packageRoot,
    cliPath: join(packageRoot, "integrations", "mcp", "dist", "cli.js"),
    terminalBinary: join(prefix, "bin", "ui-reference-mcp"),
    version: manifest.version,
    installed: false,
  };
}

async function pathComponentsHaveNoSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = absolute.startsWith(sep) ? sep : "";
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new InstallStageError("skill preflight", `refusing a symlink in selected source or destination: ${current}.`);
      }
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      if (error instanceof InstallStageError) throw error;
      throw new InstallStageError("skill preflight", `could not inspect selected path ${current}.`, { cause: error });
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

async function listTree(root: string): Promise<Map<string, { kind: "directory" } | { kind: "file"; bytes: Buffer }>> {
  const tree = new Map<string, { kind: "directory" } | { kind: "file"; bytes: Buffer }>();
  const visit = async (directory: string, relativePath: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childPath = join(directory, entry.name);
      const childRelative = relativePath ? join(relativePath, entry.name) : entry.name;
      const stats = await lstat(childPath);
      if (stats.isSymbolicLink()) {
        throw new InstallStageError("skill preflight", `skill trees may not contain symlinks: ${childPath}.`);
      }
      if (stats.isDirectory()) {
        tree.set(childRelative, { kind: "directory" });
        await visit(childPath, childRelative);
      } else if (stats.isFile()) {
        tree.set(childRelative, { kind: "file", bytes: await readFile(childPath) });
      } else {
        throw new InstallStageError("skill preflight", `unsupported file type in skill tree: ${childPath}.`);
      }
    }
  };
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new InstallStageError("skill preflight", `skill source must be a real directory: ${root}.`);
  }
  await visit(root, "");
  return tree;
}

function sameTree(
  left: Map<string, { kind: "directory" } | { kind: "file"; bytes: Buffer }>,
  right: Map<string, { kind: "directory" } | { kind: "file"; bytes: Buffer }>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [name, entry] of left) {
    const other = right.get(name);
    if (!other || entry.kind !== other.kind) return false;
    if (entry.kind === "file" && other.kind === "file" && !entry.bytes.equals(other.bytes)) return false;
  }
  return true;
}

function fingerprintTree(
  tree: Map<string, { kind: "directory" } | { kind: "file"; bytes: Buffer }>,
): string {
  const digest = createHash("sha256");
  for (const [path, entry] of [...tree.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(path);
    digest.update("\0");
    digest.update(entry.kind);
    digest.update("\0");
    if (entry.kind === "file") digest.update(entry.bytes);
  }
  return digest.digest("hex");
}

async function classifySkillDestination(
  source: string,
  destination: string,
  skill: SkillId,
): Promise<{ state: SkillDestinationPlan["state"]; snapshot: string | undefined }> {
  await pathComponentsHaveNoSymlinks(source);
  await pathComponentsHaveNoSymlinks(destination);
  if (isWithin(source, destination) || isWithin(destination, source)) {
    throw new InstallStageError("skill preflight", `refusing overlapping skill source and destination for ${skill}.`);
  }
  const sourceTree = await listTree(source);
  try {
    const stats = await lstat(destination);
    if (stats.isSymbolicLink()) {
      throw new InstallStageError("skill preflight", `refusing a symlink skill destination: ${destination}.`);
    }
    if (stats.isDirectory()) {
      const destinationTree = await listTree(destination);
      return {
        state: sameTree(sourceTree, destinationTree) ? "identical" : "conflict",
        snapshot: fingerprintTree(destinationTree),
      };
    }
    if (stats.isFile()) {
      const bytes = await readFile(destination);
      return { state: "conflict", snapshot: createHash("sha256").update("file\\0").update(bytes).digest("hex") };
    }
    throw new InstallStageError("skill preflight", `unsupported existing skill destination type: ${destination}.`);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { state: "missing", snapshot: undefined };
    if (error instanceof InstallStageError) throw error;
    throw new InstallStageError("skill preflight", `could not inspect skill destination ${destination}.`, { cause: error });
  }
}

export async function planSkillInstall(
  packageRoot: string,
  agents: readonly AgentId[],
  skills: readonly SkillId[],
  options: { ompProfile?: string } = {},
): Promise<ReadonlyArray<SkillDestinationPlan>> {
  const raw = await resolveSkillDestinations(agents, skills, options);
  const byDestination = new Map<string, { skill: SkillId; agents: AgentId[]; kind: "cli" | "omp" }>();
  for (const item of raw) {
    const previous = byDestination.get(item.path);
    if (previous) {
      if (previous.skill !== item.skill || previous.kind !== item.kind) {
        throw new InstallStageError("skill preflight", `different skills resolve to the same destination ${item.path}.`);
      }
      if (!previous.agents.includes(item.agent)) previous.agents.push(item.agent);
    } else {
      byDestination.set(item.path, { skill: item.skill, agents: [item.agent], kind: item.kind });
    }
  }
  const planned: SkillDestinationPlan[] = [];
  for (const [path, item] of byDestination) {
    const source = join(packageRoot, "skills", item.skill);
    const destination = await classifySkillDestination(source, path, item.skill);
    planned.push({
      path,
      skill: item.skill,
      agents: item.agents,
      kind: item.kind,
      state: destination.state,
      snapshot: destination.snapshot,
    });
  }
  return planned;
}

async function resolveSkillsBinary(): Promise<string> {
  let packageJsonPath: string;
  try {
    packageJsonPath = requireFromHere.resolve("skills/package.json");
  } catch (error) {
    throw new InstallStageError("skills install", "the pinned skills CLI package is unavailable from this runtime.", { cause: error });
  }
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageManifest;
  } catch (error) {
    throw new InstallStageError("skills install", "could not read the pinned skills CLI package metadata.", { cause: error });
  }
  if (manifest.name !== "skills" || manifest.version !== PINNED_SKILLS_VERSION ||
      typeof manifest.bin !== "object" || !manifest.bin || typeof manifest.bin.skills !== "string") {
    throw new InstallStageError("skills install", `expected skills@${PINNED_SKILLS_VERSION} with a declared bin.skills path.`);
  }
  const binary = resolve(dirname(packageJsonPath), manifest.bin.skills);
  try {
    const stats = await lstat(binary);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("skills binary is not a regular file");
  } catch (error) {
    throw new InstallStageError("skills install", "the pinned skills CLI entry point is missing or unsafe.", { cause: error });
  }
  return binary;
}

function spawnInherited(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit", env: environment, windowsHide: true });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(signal ? `process terminated by ${signal}` : `process exited with code ${code ?? "unknown"}`));
    });
  });
}

function skillsCliEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "CI",
    "NO_COLOR",
    "FORCE_COLOR",
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.DISABLE_TELEMETRY = "1";
  return environment;
}

async function installWithSkillsCli(
  binary: string,
  packageRoot: string,
  plans: readonly SkillDestinationPlan[],
): Promise<void> {
  const pending = plans.filter((plan) => plan.kind === "cli" && plan.state !== "identical");
  const groups = new Map<string, { agent: "codex" | "claude-code" | "cursor"; skills: SkillId[] }>();
  for (const plan of pending) {
    const agent = plan.agents.includes("claude-code") ? "claude-code" :
      plan.agents.includes("codex") ? "codex" :
        plan.agents.includes("cursor") ? "cursor" : undefined;
    if (!agent) throw new InstallStageError("skills install", `no supported skills CLI agent owns ${plan.path}.`);
    const key = `${agent}:${plan.path.slice(0, -plan.skill.length - 1)}`;
    const group = groups.get(key) ?? { agent, skills: [] };
    if (!group.skills.includes(plan.skill)) group.skills.push(plan.skill);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const args = ["add", join(packageRoot, "skills"), "--global", "--copy", "--yes", "--agent", group.agent];
    for (const skill of group.skills) args.push("--skill", skill);
    try {
      await spawnInherited(process.execPath, [binary, ...args], skillsCliEnvironment());
    } catch (error) {
      throw new InstallStageError("skills install", `the pinned skills CLI failed for ${group.agent}.`, { cause: error });
    }
  }
}

async function copyOmpSkills(
  packageRoot: string,
  plans: readonly SkillDestinationPlan[],
  consent: SkillReplaceConsent,
): Promise<void> {
  // OMP skills are copied as complete trees rather than passed to the Vercel agent installer.
  for (const plan of plans) {
    if (plan.kind !== "omp" || plan.state === "identical") continue;
    if (plan.state === "conflict" && !consent.replace.has(plan.path)) continue;
    const source = join(packageRoot, "skills", plan.skill);
    await pathComponentsHaveNoSymlinks(source);
    await pathComponentsHaveNoSymlinks(plan.path);
    const parent = dirname(plan.path);
    try {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await pathComponentsHaveNoSymlinks(plan.path);
      if (plan.state === "conflict") await rm(plan.path, { recursive: true, force: true });
      await cp(source, plan.path, { recursive: true, errorOnExist: true, force: false });
    } catch (error) {
      throw new InstallStageError("omp skills install", `could not copy ${plan.skill} into ${plan.path}.`, { cause: error });
    }
  }
}

export async function installSelectedSkills(
  runtime: DurableRuntime,
  plans: readonly SkillDestinationPlan[],
  consent: SkillReplaceConsent,
  options: { ompProfile?: string } = {},
): Promise<ReadonlyArray<SkillInstallResult>> {
  const approved = plans.filter((plan) => plan.state !== "conflict" || consent.replace.has(plan.path));
  const cliPlans = approved.filter((plan) => plan.kind === "cli");
  const ompPlans = approved.filter((plan) => plan.kind === "omp");
  // Recheck every selected destination immediately before either installer can mutate one.
  const checked = await planSkillInstall(
    runtime.packageRoot,
    [...new Set(plans.flatMap((plan) => plan.agents))],
    [...new Set(plans.map((plan) => plan.skill))],
    options,
  );
  const allowedPaths = new Set(approved.map((plan) => plan.path));
  for (const fresh of checked) {
    const reviewed = plans.find((plan) => plan.path === fresh.path);
    if (!reviewed || reviewed.state !== fresh.state || reviewed.snapshot !== fresh.snapshot) {
      throw new InstallStageError("skill preflight", `skill destination changed after review: ${fresh.path}.`);
    }
    if (fresh.state === "conflict" && !consent.replace.has(fresh.path)) allowedPaths.delete(fresh.path);
  }
  const readyCli = cliPlans.filter((plan) => allowedPaths.has(plan.path));
  const readyOmp = ompPlans.filter((plan) => allowedPaths.has(plan.path));
  if (readyCli.some((plan) => plan.state !== "identical")) {
    const binary = await resolveSkillsBinary();
    await installWithSkillsCli(binary, runtime.packageRoot, readyCli);
  }
  await copyOmpSkills(runtime.packageRoot, readyOmp, consent);
  const finalPlans = await planSkillInstall(runtime.packageRoot, [...new Set(plans.flatMap((plan) => plan.agents))], [...new Set(plans.map((plan) => plan.skill))], options);
  for (const finalPlan of finalPlans) {
    if (allowedPaths.has(finalPlan.path) && finalPlan.state !== "identical") {
      throw new InstallStageError("skills verification", `the selected skill copy is not identical to its source at ${finalPlan.path}.`);
    }
  }

  return plans.map((plan) => ({
    path: plan.path,
    skill: plan.skill,
    agents: plan.agents,
    status: plan.state === "identical" ? "already-current" :
      allowedPaths.has(plan.path) ? "installed" : "declined",
  }));
}

