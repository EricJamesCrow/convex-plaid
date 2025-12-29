/**
 * CLI Logger Utilities
 *
 * Styled console output for the CLI tool.
 */

import chalk from "chalk";

export function banner(): void {
  console.log();
  console.log(chalk.cyan.bold("  @ericjamescrow/convex-plaid"));
  console.log(chalk.gray("  Plaid component for Convex"));
  console.log();
}

export function log(message: string): void {
  console.log(message);
}

export function success(message: string): void {
  console.log(chalk.green("\u2713") + " " + message);
}

export function warning(message: string): void {
  console.log(chalk.yellow("\u26A0") + " " + chalk.yellow(message));
}

export function error(message: string): void {
  console.log(chalk.red("\u2717") + " " + chalk.red(message));
}

export function info(message: string): void {
  console.log(chalk.blue("\u2139") + " " + message);
}

export function dim(message: string): void {
  console.log(chalk.gray(message));
}

export function highlight(text: string): string {
  return chalk.cyan(text);
}

export function bold(text: string): string {
  return chalk.bold(text);
}
