import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCandidate, ProjectStatus } from '../core/types.js';

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'pom.xml', 'composer.json',
];

const W_GIT = 0.8;
const W_MANIFEST = 0.5;
const W_SRC_TESTS = 0.2;
const W_README = 0.05;

const THRESHOLD_PROJECT = 0.75;
const THRESHOLD_UNKNOWN = 0.4;

function classify(confidence: number): ProjectStatus {
  if (confidence >= THRESHOLD_PROJECT) return 'project';
  if (confidence >= THRESHOLD_UNKNOWN) return 'unknown-boundary';
  return 'not-project';
}

async function scoreDir(absDir: string): Promise<{ confidence: number; markers: string[] }> {
  let names: string[];
  try {
    names = await readdir(absDir);
  } catch {
    return { confidence: 0, markers: [] };
  }
  const set = new Set(names);
  const markers: string[] = [];
  let confidence = 0;

  if (set.has('.git')) { confidence += W_GIT; markers.push('.git'); }

  const manifest = MANIFESTS.find((m) => set.has(m));
  if (manifest) { confidence += W_MANIFEST; markers.push(manifest); }

  if (set.has('src') && set.has('tests')) {
    confidence += W_SRC_TESTS;
    markers.push('src+tests');
  }

  if (names.some((n) => /^readme(\.|$)/i.test(n))) {
    confidence += W_README;
    markers.push('README');
  }

  return { confidence: Math.min(1, confidence), markers };
}

/**
 * Clasifica cada hijo directo de `root`. Cada hijo se evalúa por sus propias
 * señales: un manifiesto en `root` nunca absorbe a sus hijos.
 */
export async function detectProjects(root: string): Promise<ProjectCandidate[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const out: ProjectCandidate[] = [];

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const abs = path.join(root, e.name);
    const { confidence, markers } = await scoreDir(abs);
    out.push({ path: e.name, confidence, markers, status: classify(confidence) });
  }

  const self = await scoreDir(root);
  out.push({
    path: '.',
    confidence: self.confidence,
    markers: self.markers,
    status: classify(self.confidence),
  });

  return out;
}
