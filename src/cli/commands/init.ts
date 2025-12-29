/**
 * Init Command
 *
 * Generates boilerplate wrapper files for the Plaid component.
 */

import { confirm, select, input } from "@inquirer/prompts";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { generateEncryptionKey } from "../utils/crypto.js";
import {
  banner,
  log,
  success,
  warning,
  error,
  info,
  dim,
  highlight,
  bold,
} from "../utils/logger.js";
import {
  generateConvexConfig,
  generatePlaidWrapper,
  generateHttpRouter,
  generateEnvExample,
  type TemplateConfig,
} from "../templates/index.js";

// =============================================================================
// TYPES
// =============================================================================

interface InitOptions {
  yes?: boolean;
  env?: boolean;
  overwrite?: boolean;
  auth?: string;
  convexDir?: string;
}

interface Config extends TemplateConfig {
  includeEnvExample: boolean;
}

interface FilesToCreate {
  convexConfig: boolean;
  plaid: boolean;
  http: boolean;
  envExample: boolean;
}

// =============================================================================
// MAIN COMMAND
// =============================================================================

export async function initCommand(options: InitOptions): Promise<void> {
  banner();

  try {
    // 1. Detect project structure
    const projectRoot = process.cwd();
    const convexDir = resolve(projectRoot, options.convexDir ?? "convex");

    // 2. Validate environment
    await validateEnvironment(projectRoot, convexDir);

    // 3. Gather configuration (prompts or defaults)
    const config = options.yes
      ? getDefaultConfig(options)
      : await gatherConfig(options);

    // 4. Check for existing files
    const filesToCreate = await checkExistingFiles(
      convexDir,
      projectRoot,
      config,
      options
    );

    // 5. Generate encryption key
    const encryptionKey = generateEncryptionKey();

    // 6. Generate and write files
    await generateFiles(convexDir, projectRoot, config, encryptionKey, filesToCreate);

    // 7. Display next steps
    displayNextSteps(encryptionKey, config);
  } catch (err) {
    if (err instanceof Error && err.message.includes("User force closed")) {
      log("\nCancelled.");
      process.exit(0);
    }
    throw err;
  }
}

// =============================================================================
// ENVIRONMENT VALIDATION
// =============================================================================

async function validateEnvironment(
  projectRoot: string,
  convexDir: string
): Promise<void> {
  // Check for package.json
  const packageJsonPath = join(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    error("No package.json found. Are you in a Node.js project?");
    process.exit(1);
  }

  // Check for convex in dependencies
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const hasConvex =
    packageJson.dependencies?.convex || packageJson.devDependencies?.convex;

  if (!hasConvex) {
    warning("Convex not found in dependencies.");
    const shouldContinue = await confirm({
      message: "Continue anyway?",
      default: false,
    });
    if (!shouldContinue) process.exit(0);
  }

  // Check/create convex directory
  if (!existsSync(convexDir)) {
    warning(`Convex directory not found at ${convexDir}`);
    const shouldCreate = await confirm({
      message: "Create convex directory?",
      default: true,
    });
    if (shouldCreate) {
      mkdirSync(convexDir, { recursive: true });
      success(`Created ${convexDir}`);
    } else {
      process.exit(0);
    }
  }

  // Check if @ericjamescrow/convex-plaid is installed
  const hasPlaid =
    packageJson.dependencies?.["@ericjamescrow/convex-plaid"] ||
    packageJson.devDependencies?.["@ericjamescrow/convex-plaid"];

  if (!hasPlaid) {
    info(
      "Tip: Run 'npm install @ericjamescrow/convex-plaid' to install the component"
    );
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

async function gatherConfig(options: InitOptions): Promise<Config> {
  log("Let's configure your Plaid integration:\n");

  const authPattern = (await select({
    message: "How do you want to handle authentication?",
    choices: [
      {
        name: "ctx.auth (Convex Auth / Clerk / Auth0)",
        value: "ctx-auth",
      },
      {
        name: "Custom (pass userId explicitly)",
        value: "custom",
      },
      {
        name: "None (no auth checks - testing only)",
        value: "none",
      },
    ],
    default: options.auth ?? "ctx-auth",
  })) as "ctx-auth" | "custom" | "none";

  const clientName = await input({
    message: "App name for Plaid Link (shown to users):",
    default: "My App",
  });

  const webhookPath = await input({
    message: "Webhook path:",
    default: "/plaid/webhook",
  });

  const includeRecurringStreams = await confirm({
    message: "Include recurring streams (subscriptions/income)?",
    default: true,
  });

  const includeLiabilities = await confirm({
    message: "Include liabilities (credit cards)?",
    default: true,
  });

  const includeEnvExample =
    options.env !== false &&
    (await confirm({
      message: "Create .env.local.example with placeholder env vars?",
      default: true,
    }));

  return {
    authPattern,
    clientName,
    webhookPath,
    includeEnvExample,
    includeRecurringStreams,
    includeLiabilities,
  };
}

function getDefaultConfig(options: InitOptions): Config {
  return {
    authPattern: (options.auth as Config["authPattern"]) ?? "ctx-auth",
    clientName: "My App",
    webhookPath: "/plaid/webhook",
    includeEnvExample: options.env !== false,
    includeRecurringStreams: true,
    includeLiabilities: true,
  };
}

// =============================================================================
// FILE HANDLING
// =============================================================================

async function checkExistingFiles(
  convexDir: string,
  projectRoot: string,
  config: Config,
  options: InitOptions
): Promise<FilesToCreate> {
  const files = {
    convexConfig: join(convexDir, "convex.config.ts"),
    plaid: join(convexDir, "plaid.ts"),
    http: join(convexDir, "http.ts"),
    envExample: join(projectRoot, ".env.local.example"),
  };

  const existing: string[] = [];
  if (existsSync(files.convexConfig)) existing.push("convex/convex.config.ts");
  if (existsSync(files.plaid)) existing.push("convex/plaid.ts");
  if (existsSync(files.http)) existing.push("convex/http.ts");
  if (config.includeEnvExample && existsSync(files.envExample)) {
    existing.push(".env.local.example");
  }

  if (existing.length > 0 && !options.overwrite) {
    log("");
    warning("The following files already exist:");
    existing.forEach((f) => dim(`  - ${f}`));
    log("");

    const action = await select({
      message: "What would you like to do?",
      choices: [
        { name: "Skip existing files", value: "skip" },
        { name: "Overwrite all", value: "overwrite" },
        { name: "Cancel", value: "cancel" },
      ],
    });

    if (action === "cancel") {
      log("Cancelled.");
      process.exit(0);
    }

    return {
      convexConfig: action === "overwrite" || !existsSync(files.convexConfig),
      plaid: action === "overwrite" || !existsSync(files.plaid),
      http: action === "overwrite" || !existsSync(files.http),
      envExample:
        config.includeEnvExample &&
        (action === "overwrite" || !existsSync(files.envExample)),
    };
  }

  return {
    convexConfig: true,
    plaid: true,
    http: true,
    envExample: config.includeEnvExample,
  };
}

async function generateFiles(
  convexDir: string,
  projectRoot: string,
  config: Config,
  encryptionKey: string,
  filesToCreate: FilesToCreate
): Promise<void> {
  log("");

  if (filesToCreate.convexConfig) {
    const content = generateConvexConfig();
    const path = join(convexDir, "convex.config.ts");
    writeFileSync(path, content);
    success("Created convex/convex.config.ts");
  }

  if (filesToCreate.plaid) {
    const content = generatePlaidWrapper(config);
    const path = join(convexDir, "plaid.ts");
    writeFileSync(path, content);
    success("Created convex/plaid.ts");
  }

  if (filesToCreate.http) {
    const content = generateHttpRouter({ webhookPath: config.webhookPath });
    const path = join(convexDir, "http.ts");
    writeFileSync(path, content);
    success("Created convex/http.ts");
  }

  if (filesToCreate.envExample) {
    const content = generateEnvExample(encryptionKey);
    const path = join(projectRoot, ".env.local.example");
    writeFileSync(path, content);
    success("Created .env.local.example");
  }
}

// =============================================================================
// NEXT STEPS
// =============================================================================

function displayNextSteps(encryptionKey: string, config: Config): void {
  log("");
  success("Files generated successfully!");
  log("");

  log(bold("Next steps:"));
  log("");

  log(highlight("1.") + " Add environment variables to your Convex dashboard:");
  dim("   Settings > Environment Variables");
  log("");
  log("   " + highlight("PLAID_CLIENT_ID") + " = your_client_id");
  log("   " + highlight("PLAID_SECRET") + "    = your_secret");
  log("   " + highlight("PLAID_ENV") + "       = sandbox");
  dim("   ENCRYPTION_KEY  = " + encryptionKey.slice(0, 20) + "...");
  log("");

  log(highlight("2.") + " Run Convex dev to register the component:");
  dim("   npx convex dev");
  log("");

  log(highlight("3.") + " Use the React hook in your frontend:");
  dim('   import { usePlaidLink } from "@ericjamescrow/convex-plaid/react";');
  log("");

  if (config.authPattern === "ctx-auth") {
    log(highlight("4.") + " Ensure authentication is configured:");
    dim("   The generated code expects ctx.auth.getUserIdentity()");
    dim("   to return a valid identity with a subject field.");
    log("");
  }

  dim("Documentation: https://github.com/EricJamesCrow/convex-plaid#readme");
  log("");
}
