import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { delimiter, dirname, resolve } from "node:path";
import { getConfigDir } from "./config.js";
import { readMobbinBundle, type MobbinCredentialBundle } from "./auth/mobbin.js";
import {
  AGENT_IDS,
  SKILL_IDS,
  AgentConfigurationError,
  describeAgentPlan,
  planAgentRegistrations,
  registerAgentConfigs,
  type AgentId,
  type AgentRegistrationPlan,
  type RegistrationConsent,
  type RegisteredAgentResult,
  type SkillId,
} from "./agents.js";
import {
  ensureDurableRuntime,
  inspectDurableRuntime,
  installSelectedSkills,
  planSkillInstall,
  requireDurableRuntime,
  sourcePackageRoot,
  type DurableRuntime,
  type SkillDestinationPlan,
  type SkillInstallResult,
  type SkillReplaceConsent,
} from "./install.js";
import {
  runGoogleFontsAuthorization,
  runIconifyCheck,
  runMobbinAuthorization,
  verifyGoogleFontsCatalog,
  verifyStoredMobbinCredentials,
} from "./cli.js";


export { runIconifyCheck, verifyGoogleFontsCatalog };
export interface InstallOptions {
  agents: AgentId[];
  skills: SkillId[];
  skipAuth: boolean;
  yes: boolean;
  ompProfile?: string;
}

export interface SetupOptions {
  agents: AgentId[];
  skipAuth: boolean;
  yes: boolean;
  ompProfile?: string;
}

export interface InstallCommandOptions {
  agents?: AgentId[];
  skills?: SkillId[];
  skipAuth: boolean;
  yes: boolean;
  ompProfile?: string;
}

export interface SetupCommandOptions {
  agents?: AgentId[];
  skipAuth: boolean;
  yes: boolean;
  ompProfile?: string;
}

interface ProviderResult {
  name: string;
  status: "verified" | "not configured" | "failed" | "not checked";
  detail: string;
  requiredFailure: boolean;
}

interface ConsentResult {
  agents: RegistrationConsent;
  skills: SkillReplaceConsent;
  declinedAgentPaths: Set<string>;
}

export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

export type ProviderCheckStatus = "verified" | "not-configured" | "invalid";

export async function checkMobbinProviderStatus(): Promise<ProviderCheckStatus> {
  let bundle: MobbinCredentialBundle | undefined;
  try {
    bundle = await readMobbinBundle();
  } catch {
    return "invalid";
  }
  if (!bundle) return "not-configured";
  try {
    await verifyStoredMobbinCredentials();
    return "verified";
  } catch {
    return "invalid";
  }
}

function interactiveTerminal(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function assertSelections<T extends string>(
  values: readonly string[],
  allowed: readonly T[],
  label: string,
): T[] {
  const selected = unique(values);
  if (selected.length === 0) throw new OnboardingError(`Select at least one ${label}.`);
  const invalid = selected.find((value) => !allowed.includes(value as T));
  if (invalid) throw new OnboardingError(`Unknown ${label}: ${invalid}.`);
  return selected as T[];
}

async function askLine(prompt: string): Promise<string> {
  const interfaceHandle = createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    return await interfaceHandle.question(prompt);
  } finally {
    interfaceHandle.close();
  }
}

async function chooseSelection<T extends string>(
  provided: readonly T[] | undefined,
  all: readonly T[],
  label: string,
): Promise<T[]> {
  if (provided !== undefined) return assertSelections(provided, all, label);
  if (!interactiveTerminal()) {
    throw new OnboardingError(`Non-TTY ${label} selection is required; pass repeated ${label === "agent" ? "--agent" : "--skill"} flags.`);
  }
  const answer = (await askLine(`${label} selection (comma-separated; Enter selects all ${all.join(", ")}): `)).trim();
  if (!answer) return [...all];
  const requested = answer.split(",").map((value) => value.trim()).filter(Boolean);
  return assertSelections(requested, all, label);
}

async function approveOverview(yes: boolean): Promise<void> {
  if (yes) return;
  if (!interactiveTerminal()) throw new OnboardingError("Non-TTY installation requires --yes to approve the initial overview.");
  const answer = (await askLine("Proceed with these global changes? [y/N] ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") throw new OnboardingError("Onboarding was canceled before changes were made.");
}

async function approve(question: string): Promise<boolean> {
  if (!interactiveTerminal()) return false;
  const answer = (await askLine(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function approveWithDefaultYes(question: string): Promise<boolean> {
  if (!interactiveTerminal()) return false;
  const answer = (await askLine(`${question} [Y/n] `)).trim().toLowerCase();
  return answer !== "n" && answer !== "no";
}

function displayOverview(
  mode: "install" | "setup",
  runtime: DurableRuntime,
  agents: readonly AgentRegistrationPlan[],
  skills: readonly SkillDestinationPlan[],
): void {
  const lines = [
    `UI Reference MCP ${mode} overview (global scope)`,
    `Agents: ${agents.map((plan) => plan.agent).join(", ")}`,
    `Skills: ${mode === "install" ? unique(skills.map((plan) => plan.skill)).join(", ") : "unchanged"}`,
    `Runtime prefix: ${runtime.prefix}`,
    `Durable package: ${runtime.packageRoot}${runtime.installed ? " (current version present)" : " (install/repair required)"}`,
    `Terminal command: ${runtime.terminalBinary}`,
    `Provider credentials: ${getConfigDir()}`,
    "Agent configuration targets:",
    ...agents.map((plan) => `  ${describeAgentPlan(plan)}`),
  ];
  if (mode === "install") {
    lines.push("Skill destinations:");
    for (const plan of skills) {
      const owners = plan.agents.join("/");
      const state = plan.state === "missing" ? "new copy" : plan.state === "identical" ? "identical copy reused" : "different existing tree; explicit replacement required";
      lines.push(`  ${owners} ${plan.skill}: ${plan.path} (${state})`);
    }
  }
  const warnings = unique(agents.flatMap((plan) => plan.shadowWarning ? [plan.shadowWarning] : []));
  if (warnings.length > 0) {
    lines.push("Project-local policy (not modified):", ...warnings.map((warning) => `  ${warning}`));
  }
  lines.push(
    "This changes only the selected global targets. Project-level disabled/override policy remains authoritative.",
    "No agent application will be auto-installed and no approval bypass will be enabled.",
  );
  stdout.write(`${lines.join("\n")}\n`);
}

async function collectConsent(
  agentPlans: readonly AgentRegistrationPlan[],
  skillPlans: readonly SkillDestinationPlan[],
): Promise<ConsentResult> {
  const replaceAgents = new Set<string>();
  const enableAgents = new Set<string>();
  const replaceSkills = new Set<string>();
  const declinedAgentPaths = new Set<string>();
  if (!interactiveTerminal()) {
    const conflictingAgent = agentPlans.find((plan) => plan.state === "conflict" || plan.disabled || plan.denied);
    const conflictingSkill = skillPlans.find((plan) => plan.state === "conflict");
    if (conflictingAgent) {
      throw new OnboardingError(`Non-TTY conflict requires explicit interactive consent before mutation: ${conflictingAgent.configPath}.`);
    }
    if (conflictingSkill) {
      throw new OnboardingError(`Non-TTY skill conflict requires explicit interactive consent before mutation: ${conflictingSkill.path}.`);
    }
    return {
      agents: { replace: replaceAgents, enable: enableAgents },
      skills: { replace: replaceSkills },
      declinedAgentPaths,
    };
  }

  for (const plan of skillPlans) {
    if (plan.state !== "conflict") continue;
    const owners = plan.agents.join("/");
    if (await approve(`Replace only the selected ${owners} skill directory ${plan.path}?`)) {
      replaceSkills.add(plan.path);
    }
  }
  for (const plan of agentPlans) {
    if (plan.state === "conflict") {
      if (await approve(`Replace only the ui-reference entry in ${plan.configPath}?`)) {
        replaceAgents.add(plan.configPath);
      } else {
        declinedAgentPaths.add(plan.configPath);
        continue;
      }
    }
    if (plan.disabled || plan.denied) {
      if (await approve(`Enable ui-reference and remove only its own disabled/denylist entry in ${plan.configPath}?`)) {
        enableAgents.add(plan.configPath);
      } else {
        declinedAgentPaths.add(plan.configPath);
      }
    }
  }
  return {
    agents: { replace: replaceAgents, enable: enableAgents },
    skills: { replace: replaceSkills },
    declinedAgentPaths,
  };
}

function printProviderSummary(providers: readonly ProviderResult[]): void {
  stdout.write("Provider verification:\n");
  for (const provider of providers) {
    stdout.write(`  ${provider.name}: ${provider.status} — ${provider.detail}\n`);
  }
}

function recoveryCommand(provider: "mobbin" | "google-fonts"): string {
  return provider === "mobbin" ? "ui-reference-mcp auth mobbin" : "ui-reference-mcp auth google-fonts";
}

async function providerOnboarding(skipAuth: boolean): Promise<ProviderResult[]> {
  if (skipAuth) {
    return [
      { name: "Mobbin", status: "not configured", detail: `authorization skipped; run \`${recoveryCommand("mobbin")}\``, requiredFailure: false },
      { name: "Google Fonts", status: "not configured", detail: `API key skipped; run \`${recoveryCommand("google-fonts")}\``, requiredFailure: false },
      { name: "Iconify", status: "not checked", detail: "public source; no credential file was created", requiredFailure: false },
    ];
  }

  const providers: ProviderResult[] = [];
  const terminal = interactiveTerminal();
  const mobbinVerified = await checkMobbinProviderStatus() === "verified";
  if (mobbinVerified) {
    const reauthorize = terminal && await approve("Mobbin credentials are valid. Reauthorize explicitly?" );
    if (!reauthorize) {
      providers.push({ name: "Mobbin", status: "verified", detail: "saved credentials passed authenticated tools/list validation", requiredFailure: false });
    } else {
      try {
        await runMobbinAuthorization(17_831, false);
        providers.push({ name: "Mobbin", status: "verified", detail: "reauthorization and authenticated tools/list validation succeeded", requiredFailure: false });
      } catch {
        providers.push({ name: "Mobbin", status: "failed", detail: `reauthorization failed; existing credentials were preserved; run \`${recoveryCommand("mobbin")}\``, requiredFailure: true });
      }
    }
  } else if (terminal && await approveWithDefaultYes("Mobbin is missing or could not be verified. Authenticate now with browser OAuth?")) {
    try {
      await runMobbinAuthorization(17_831, false);
      providers.push({ name: "Mobbin", status: "verified", detail: "OAuth credentials passed authenticated tools/list validation", requiredFailure: false });
    } catch {
      providers.push({ name: "Mobbin", status: "failed", detail: `authorization failed or was canceled; run \`${recoveryCommand("mobbin")}\``, requiredFailure: true });
    }
  } else {
    providers.push({
      name: "Mobbin",
      status: terminal ? "not configured" : "failed",
      detail: `saved credentials are missing or invalid; run \`${recoveryCommand("mobbin")}\``,
      requiredFailure: !terminal,
    });
  }

  let fontsVerified = false;
  try {
    await verifyGoogleFontsCatalog();
    fontsVerified = true;
  } catch {
    // Do not expose the key or provider response.
  }
  if (fontsVerified) {
    const reauthorize = terminal && await approve("Google Fonts credentials are valid. Replace the saved key explicitly?" );
    if (!reauthorize) {
      providers.push({ name: "Google Fonts", status: "verified", detail: "saved or configured key returned the official Roboto catalog", requiredFailure: false });
    } else {
      try {
        await runGoogleFontsAuthorization(false);
        providers.push({ name: "Google Fonts", status: "verified", detail: "new key passed the official Roboto catalog check", requiredFailure: false });
      } catch {
        providers.push({ name: "Google Fonts", status: "failed", detail: `new key was not saved; run \`${recoveryCommand("google-fonts")}\``, requiredFailure: true });
      }
    }
  } else if (terminal && await approveWithDefaultYes("Google Fonts is missing or could not be verified. Add an API key now?")) {
    try {
      await runGoogleFontsAuthorization(false);
      providers.push({ name: "Google Fonts", status: "verified", detail: "key passed the official Roboto catalog check", requiredFailure: false });
    } catch {
      providers.push({ name: "Google Fonts", status: "failed", detail: `key was not saved; run \`${recoveryCommand("google-fonts")}\``, requiredFailure: true });
    }
  } else {
    providers.push({
      name: "Google Fonts",
      status: terminal ? "not configured" : "failed",
      detail: `saved credentials are missing or invalid; run \`${recoveryCommand("google-fonts")}\``,
      requiredFailure: !terminal,
    });
  }

  try {
    await runIconifyCheck();
    providers.push({ name: "Iconify", status: "verified", detail: "public Lucide credit-card catalog smoke succeeded; no key required", requiredFailure: false });
  } catch {
    providers.push({ name: "Iconify", status: "failed", detail: "public source verification failed; retry with `ui-reference-mcp auth iconify`", requiredFailure: true });
  }
  return providers;
}

function printRuntimeSummary(runtime: DurableRuntime): void {
  stdout.write(`Runtime: ${runtime.installed ? "installed" : "reused"} v${runtime.version} at ${runtime.packageRoot}\n`);
  stdout.write(`Terminal binary: ${runtime.terminalBinary}\n`);
  const binaryDirectory = dirname(runtime.terminalBinary);
  const onPath = (process.env.PATH ?? "").split(delimiter).some((entry) => entry !== "" && resolve(entry) === resolve(binaryDirectory));
  if (!onPath) {
    stdout.write(
      `The install prefix is not on PATH; run future commands as \`${runtime.terminalBinary} setup\` or add ${binaryDirectory} to PATH.\n`,
    );
  }
}

function printSkillSummary(results: readonly SkillInstallResult[]): boolean {
  stdout.write("Skills:\n");
  let incomplete = false;
  for (const result of results) {
    const owners = result.agents.join("/");
    if (result.status === "declined") incomplete = true;
    stdout.write(`  ${owners} ${result.skill}: ${result.status} at ${result.path}\n`);
  }
  return incomplete;
}

async function registerSelectedAgents(
  plans: readonly AgentRegistrationPlan[],
  consent: RegistrationConsent,
  declinedPaths: ReadonlySet<string>,
): Promise<{ results: RegisteredAgentResult[]; failed: boolean }> {
  const results: RegisteredAgentResult[] = [];
  let failed = declinedPaths.size > 0;
  for (const plan of plans) {
    if (declinedPaths.has(plan.configPath)) {
      stdout.write(`Agent registration declined: ${plan.agent} at ${plan.configPath}\n`);
      continue;
    }
    try {
      const [result] = await registerAgentConfigs([plan], consent);
      if (result) results.push(result);
    } catch (error) {
      failed = true;
      const message = error instanceof AgentConfigurationError ? error.message : `Agent registration failed safely at ${plan.configPath}.`;
      stdout.write(`${message}\n`);
    }
  }
  stdout.write("Agent registration:\n");
  for (const result of results) {
    const state = result.status === "already-current"
      ? (result.hostInstalled ? "already current; restart/reload the host to connect" : "already current; configured for next launch")
      : (result.hostInstalled ? "registered; restart/reload the host to connect" : "registered; configured for next launch");
    stdout.write(`  ${result.agent}: ${state} (${result.configPath})\n`);
    if (result.shadowWarning) stdout.write(`    ${result.shadowWarning}\n`);
  }
  return { results, failed };
}

function printFinalInstructions(): void {
  stdout.write("Restart or normally reload selected host apps to discover the server. Project-level disabled/override policy still wins; no auto-approval or permission bypass was added.\n");
}

async function runOverviewAndConsents(
  mode: "install" | "setup",
  runtime: DurableRuntime,
  agentPlans: readonly AgentRegistrationPlan[],
  skillPlans: readonly SkillDestinationPlan[],
  yes: boolean,
): Promise<ConsentResult> {
  displayOverview(mode, runtime, agentPlans, skillPlans);
  await approveOverview(yes);
  return collectConsent(agentPlans, skillPlans);
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const agents = assertSelections(options.agents, AGENT_IDS, "agent");
  const skills = assertSelections(options.skills, SKILL_IDS, "skill");
  const inspectedRuntime = await inspectDurableRuntime();
  const agentPlans = await planAgentRegistrations(agents, inspectedRuntime.cliPath, { ompProfile: options.ompProfile });
  const initialSkillPlans = await planSkillInstall(
    sourcePackageRoot(),
    agents,
    skills,
    { ompProfile: options.ompProfile },
  );
  const consents = await runOverviewAndConsents("install", inspectedRuntime, agentPlans, initialSkillPlans, options.yes);

  const runtime = await ensureDurableRuntime();
  printRuntimeSummary(runtime);
  const skillPlans = await planSkillInstall(runtime.packageRoot, agents, skills, { ompProfile: options.ompProfile });
  if (skillPlans.some((plan) => {
    const reviewed = initialSkillPlans.find((initial) => initial.path === plan.path);
    return !reviewed || plan.state !== reviewed.state || plan.snapshot !== reviewed.snapshot;
  })) {
    throw new OnboardingError("A selected skill destination changed after the overview; rerun install to review it safely.");
  }
  const skillResults = await installSelectedSkills(runtime, skillPlans, consents.skills, { ompProfile: options.ompProfile });
  const skillIncomplete = printSkillSummary(skillResults);

  const providers = await providerOnboarding(options.skipAuth);
  printProviderSummary(providers);
  const registration = await registerSelectedAgents(agentPlans, consents.agents, consents.declinedAgentPaths);
  printFinalInstructions();
  if (skillIncomplete || registration.failed || providers.some((provider) => provider.requiredFailure)) {
    process.exitCode = 1;
  }
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const agents = assertSelections(options.agents, AGENT_IDS, "agent");
  const runtime = await requireDurableRuntime();
  const agentPlans = await planAgentRegistrations(agents, runtime.cliPath, { ompProfile: options.ompProfile });
  const consents = await runOverviewAndConsents("setup", runtime, agentPlans, [], options.yes);
  const providers = await providerOnboarding(options.skipAuth);
  printProviderSummary(providers);
  const registration = await registerSelectedAgents(agentPlans, consents.agents, consents.declinedAgentPaths);
  printRuntimeSummary(runtime);
  printFinalInstructions();
  if (registration.failed || providers.some((provider) => provider.requiredFailure)) {
    process.exitCode = 1;
  }
}

export async function runInstallCommand(options: InstallCommandOptions): Promise<void> {
  if (!interactiveTerminal() && (!options.agents || !options.skills || !options.yes)) {
    throw new OnboardingError("Non-TTY install requires explicit --agent, --skill, and --yes; add --skip-auth for a credential-free install.");
  }
  const agents = await chooseSelection(options.agents, AGENT_IDS, "agent");
  const skills = await chooseSelection(options.skills, SKILL_IDS, "skill");
  await runInstall({
    agents,
    skills,
    skipAuth: options.skipAuth,
    yes: options.yes,
    ...(options.ompProfile !== undefined ? { ompProfile: options.ompProfile } : {}),
  });
}

export async function runSetupCommand(options: SetupCommandOptions): Promise<void> {
  if (!interactiveTerminal() && (!options.agents || !options.yes)) {
    throw new OnboardingError("Non-TTY setup requires explicit --agent and --yes; add --skip-auth for a credential-free setup.");
  }
  const agents = await chooseSelection(options.agents, AGENT_IDS, "agent");
  await runSetup({
    agents,
    skipAuth: options.skipAuth,
    yes: options.yes,
    ...(options.ompProfile !== undefined ? { ompProfile: options.ompProfile } : {}),
  });
}
