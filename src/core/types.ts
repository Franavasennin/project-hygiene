export type Axis = 'filesystem' | 'git' | 'security' | 'ai';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Risk = 'safe' | 'low' | 'medium' | 'high' | 'unknown';
export type SuggestionType =
  | 'quarantine' | 'ignore' | 'move' | 'create' | 'review' | 'none';

export interface FileEntry {
  /** Ruta relativa al root escaneado, siempre con separador '/'. */
  path: string;
  absPath: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
  depth: number;
  /** true si es un directorio generado cuyo contenido no se recorrió. */
  notDescended: boolean;
}

export type ProjectStatus = 'project' | 'unknown-boundary' | 'not-project';

export interface ProjectCandidate {
  path: string;
  confidence: number;
  markers: string[];
  status: ProjectStatus;
}

export interface GitFacts {
  isRepo: boolean;
  root: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  trackedFiles: Set<string>;
  ignoredFiles: Set<string>;
  dirtyFiles: Set<string>;
  stashCount: number;
}

export interface Inventory {
  root: string;
  scannedAt: string;
  truncated: boolean;
  files: FileEntry[];
  projects: ProjectCandidate[];
  gitByProject: Record<string, GitFacts>;
}

export interface Finding {
  id: string;
  ruleId: string;
  axis: Axis;
  path: string;
  severity: Severity;
  risk: Risk;
  confidence: number;
  reason: string;
  evidence: Record<string, unknown>;
  suggests: SuggestionType[];
}

export interface LimitHit {
  ruleId: string;
  limit: string;
}

export interface Score {
  profile: string;
  engineVersion: string;
  total: number;
  axes: Record<Axis, number>;
  clean: boolean;
  blockers: string[];
}

export interface AuditResult {
  inventory: Inventory;
  findings: Finding[];
  limits: LimitHit[];
  score: Score;
}
