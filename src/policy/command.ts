/**
 * Shell command classification for the tool interceptor (REQ-013, REQ-012, EX-003).
 *
 * Conservative, allowlist-minded detection of destructive and network-egress commands.
 * False positives fail safe (deny/confirm) rather than allowing a dangerous command.
 */

export interface CommandClass {
  destructive: boolean;
  network: boolean;
  matched: string[];
}

const DESTRUCTIVE_PATTERNS: Array<[string, RegExp]> = [
  ['rm-rf', /\brm\s+(-[a-z]*f|-[a-z]*r[a-z]*|--force|--recursive)/i],
  ['rmdir', /\brmdir\b/i],
  ['unlink', /\bunlink\b/i],
  ['mkfs', /\bmkfs\b/i],
  ['dd', /\bdd\s+.*\bof=/i],
  ['shred', /\bshred\b/i],
  ['truncate', /\btruncate\b/i],
  ['shutdown', /\b(shutdown|reboot|halt|poweroff)\b/i],
  ['kill-all', /\bkillall\b|\bkill\s+-9\s+-1\b/i],
  ['chmod-recursive', /\bchmod\s+-R\b/i],
  ['chown-recursive', /\bchown\s+-R\b/i],
  ['git-hard', /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i],
  ['redirect-clobber-dev', />\s*\/dev\/(sd|nvme|vd)/i],
  ['fork-bomb', /:\(\)\s*\{.*\}\s*;/],
];

const NETWORK_PATTERNS: Array<[string, RegExp]> = [
  ['curl', /\bcurl\b/i],
  ['wget', /\bwget\b/i],
  ['nc', /\bnc\b|\bnetcat\b/i],
  ['ssh', /\bssh\b|\bscp\b|\bsftp\b/i],
  ['telnet', /\btelnet\b/i],
  ['ftp', /\bftp\b/i],
  ['pip-install', /\bpip\s+install\b/i],
  ['npm-install', /\bnpm\s+(install|i|ci)\b/i],
  ['apt', /\b(apt|apt-get|yum|dnf|brew)\s+install\b/i],
  ['git-remote', /\bgit\s+(clone|fetch|pull|push)\b/i],
];

export function classifyCommand(command: string): CommandClass {
  const matched: string[] = [];
  let destructive = false;
  let network = false;
  for (const [name, re] of DESTRUCTIVE_PATTERNS) {
    if (re.test(command)) {
      destructive = true;
      matched.push(`destructive:${name}`);
    }
  }
  for (const [name, re] of NETWORK_PATTERNS) {
    if (re.test(command)) {
      network = true;
      matched.push(`network:${name}`);
    }
  }
  return { destructive, network, matched };
}
