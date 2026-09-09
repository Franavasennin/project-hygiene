export interface Limits {
  maxFilesScanned: number;
  maxFileSizeForContentScan: number;
  maxRuleMatches: number;
  maxReferenceSearchFiles: number;
  maxMatchTreeNodes: number;
  maxRegexInputLength: number;
  timeoutMsPerRule: number;
  timeoutMsTotal: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxFilesScanned: 200_000,
  maxFileSizeForContentScan: 2 * 1024 * 1024,
  maxRuleMatches: 5_000,
  maxReferenceSearchFiles: 20_000,
  maxMatchTreeNodes: 256,
  maxRegexInputLength: 256 * 1024,
  timeoutMsPerRule: 5_000,
  timeoutMsTotal: 300_000,
};

export class Budget {
  private files = 0;
  private ruleDeadline = Infinity;
  private ruleId: string | null = null;
  private readonly startedAt = Date.now();
  private readonly seen = new Set<string>();

  constructor(readonly limits: Limits) {}

  consumeFile(): boolean {
    if (this.files >= this.limits.maxFilesScanned) {
      this.seen.add('maxFilesScanned');
      return false;
    }
    this.files += 1;
    return true;
  }

  startRule(ruleId: string): void {
    this.ruleId = ruleId;
    this.ruleDeadline = Date.now() + this.limits.timeoutMsPerRule;
  }

  ruleExpired(): boolean {
    const expired = Date.now() >= this.ruleDeadline;
    if (expired && this.ruleId) this.seen.add('timeoutMsPerRule');
    return expired;
  }

  totalExpired(): boolean {
    const expired = Date.now() - this.startedAt >= this.limits.timeoutMsTotal;
    if (expired) this.seen.add('timeoutMsTotal');
    return expired;
  }

  note(limit: keyof Limits): void {
    this.seen.add(limit);
  }

  hits(): string[] {
    return [...this.seen];
  }
}
