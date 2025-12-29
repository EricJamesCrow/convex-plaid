#!/usr/bin/env node
/**
 * CLI Entry Point
 *
 * Main entry point for the convex-plaid CLI tool.
 * Invoked via: npx @ericjamescrow/convex-plaid <command>
 */

import { Command } from "commander";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("convex-plaid")
  .description("CLI tools for @ericjamescrow/convex-plaid component")
  .version("0.2.6");

program
  .command("init")
  .description("Initialize Plaid wrapper files in your Convex project")
  .option("-y, --yes", "Skip prompts and use defaults")
  .option("--no-env", "Skip creating .env.local.example")
  .option("--overwrite", "Overwrite existing files without prompting")
  .option(
    "--auth <type>",
    "Auth pattern: ctx-auth | custom | none",
    "ctx-auth"
  )
  .option("--convex-dir <path>", "Path to convex directory", "convex")
  .action(initCommand);

program.parse();
