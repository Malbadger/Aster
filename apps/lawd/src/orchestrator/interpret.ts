/**
 * Prompt interpretation (REQ-D-014/015). The same composer accepts natural
 * language and slash commands. The interpretation is returned so the UI can show
 * it in chat before any consequential work. Unknown slash commands are kept
 * intact so Pi can resolve extension commands and prompt templates that LAW
 * does not know about.
 */
import type { Interpretation } from "@law/contracts";

export const KNOWN_COMMANDS = ["help", "plan", "run", "audit", "model", "clear", "compact", "session", "stats", "name", "auto-compact", "auto-retry"] as const;
export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export interface Parsed {
  interpretation: Interpretation;
  /** The prompt text to hand a phase (for NL, the whole text; for /run, the args). */
  prompt: string;
  command?: KnownCommand;
  args?: string;
}

export function interpret(text: string): Parsed {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return {
      interpretation: { type: "natural-language", summary: "Interpreted as a natural-language request." },
      prompt: trimmed,
    };
  }
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(trimmed);
  const name = (m?.[1] ?? "").toLowerCase();
  const args = (m?.[2] ?? "").trim();
  if (!(KNOWN_COMMANDS as readonly string[]).includes(name)) {
    return {
      interpretation: {
        type: "unknown-command",
        command: name,
        summary: `Unknown command "/${name}". Known: ${KNOWN_COMMANDS.map((c) => `/${c}`).join(", ")}.`,
      },
      prompt: trimmed,
    };
  }
  return {
    interpretation: {
      type: "slash-command",
      command: name,
      summary: `Slash command /${name}${args ? ` with "${args}"` : ""}.`,
    },
    prompt: args,
    command: name as KnownCommand,
    args,
  };
}
