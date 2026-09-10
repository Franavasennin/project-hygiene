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

// Traduccion unica camelCase -> snake_case para los nombres de limite que
// viajan fuera de este modulo (p.ej. LimitHit.limit en el evaluador, Task 11
// del plan). No se conecta a nada todavia; es la unica fuente de verdad para
// cuando el evaluador exista.
export const LIMIT_WIRE_NAMES: Record<keyof Limits, string> = {
  maxFilesScanned: 'max_files_scanned',
  maxFileSizeForContentScan: 'max_file_size_for_content_scan',
  maxRuleMatches: 'max_rule_matches',
  maxReferenceSearchFiles: 'max_reference_search_files',
  maxMatchTreeNodes: 'max_match_tree_nodes',
  maxRegexInputLength: 'max_regex_input_length',
  timeoutMsPerRule: 'timeout_ms_per_rule',
  timeoutMsTotal: 'timeout_ms_total',
};

export class Budget {
  private files = 0;
  private ruleDeadline = Infinity;
  private ruleId: string | null = null;
  private readonly startedAt: number;
  private readonly seen = new Set<keyof Limits>();

  constructor(readonly limits: Limits, private readonly now: () => number = Date.now) {
    this.startedAt = this.now();
  }

  // Comprueba `value` contra `this.limits[limit]` y, si se supera, lo anota
  // atomicamente en `seen` en la misma llamada -- evita el patron de
  // "comprobar sin anotar" que dejaba callsites sin registrar el hit.
  within(limit: keyof Limits, value: number): boolean {
    const ok = value < this.limits[limit];
    if (!ok) this.seen.add(limit);
    return ok;
  }

  consumeFile(): boolean {
    if (!this.within('maxFilesScanned', this.files)) {
      return false;
    }
    this.files += 1;
    return true;
  }

  startRule(ruleId: string): void {
    this.ruleId = ruleId;
    this.ruleDeadline = this.now() + this.limits.timeoutMsPerRule;
  }

  // El futuro evaluador (Task 11) es responsable de asociar el ruleId activo
  // (ver `currentRuleId`) al LimitHit que construya: Budget no expone
  // directamente que regla estaba en curso cuando expiro el plazo.
  ruleExpired(): boolean {
    const expired = this.now() >= this.ruleDeadline;
    if (expired && this.ruleId) this.seen.add('timeoutMsPerRule');
    return expired;
  }

  get currentRuleId(): string | null {
    return this.ruleId;
  }

  totalExpired(): boolean {
    const expired = this.now() - this.startedAt >= this.limits.timeoutMsTotal;
    if (expired) this.seen.add('timeoutMsTotal');
    return expired;
  }

  note(limit: keyof Limits): void {
    this.seen.add(limit);
  }

  hits(): (keyof Limits)[] {
    return [...this.seen];
  }
}
