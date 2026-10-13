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
  /** Modo de lstat. En Windows no refleja permisos reales. */
  mode?: number;
}

export type ProjectStatus = 'project' | 'unknown-boundary' | 'not-project';

export interface ProjectCandidate {
  path: string;
  confidence: number;
  markers: string[];
  status: ProjectStatus;
}

export interface BranchFact {
  name: string;
  upstream: string | null;
  lastCommitMs: number;
  /** Fusionada en la rama por defecto. false si no hay rama por defecto. */
  merged: boolean;
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
  /** Directorios ignorados enteros, sin barra final. */
  ignoredDirs?: Set<string>;
  stashTimesMs?: number[];
  branches?: BranchFact[];
  /** Rutas tocadas en el historial acotado, relativas a la raiz del repo. */
  historyPaths?: Set<string>;
  historyTruncated?: boolean;
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

export interface UnsupportedHit {
  ruleId: string;
  reason: string;
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
  /** Reglas que la plataforma no permite evaluar (spec §7, SEC-PERM-001). */
  unsupported?: UnsupportedHit[];
}

export type OperationType = SuggestionType;

export type DegradeReason =
  | 'unknown-risk'
  | 'unknown-project-boundary'
  | 'low-confidence'
  | 'not-a-regular-file'
  | 'referenced-by-source'
  | 'references-undetermined'
  | 'hash-unavailable'
  | 'conflicting-suggestions'
  | 'not-in-git-repo'
  | 'tracked-ignore-ineffective';

export interface Operation {
  /** Estable dentro del plan: mismo estado de disco, mismo ID. */
  id: string;
  type: OperationType;
  path: string;
  findingIds: string[];
  ruleIds: string[];
  risk: Risk;
  reason: string;
  degradedFrom: OperationType | null;
  degradeReason: DegradeReason | null;
  /** Huella del origen al planificar; el executor la revalida antes de mover. */
  source: { sha256: string | null; size: number };
  /** Solo en ignore: linea que se anade y a que fichero (relativo al root). */
  edit?: { file: string; line: string };
}

export interface Plan {
  planId: string;
  root: string;
  createdAt: string;
  engineVersion: string;
  minConfidence: number;
  operations: Operation[];
}
