#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../audit.js';
import { runPlan } from '../plan.js';
import { runClean } from '../clean.js';
import { loadPacks } from '../rules/schema.js';
import { renderReport } from '../report/human.js';
import { renderPlan } from '../report/plan.js';
import { resolveHome } from '../core/home.js';
import { deleteApprovals, loadApprovals, saveApprovals } from '../approvals/store.js';
import {
  APPROVABLE_RISKS, mergeApproval, selectOperations, type ApprovableRisk,
} from '../approvals/approve.js';

export type Printer = (line: string) => void;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.resolve(HERE, '..', '..', 'rules');

const USAGE = `hygiene <comando> [ruta] [opciones]

Comandos:
  scan [ruta]            Inventario, sin juicio
  audit [ruta]            Hallazgos y puntuacion
  plan [ruta]            Operaciones propuestas con ID, sin modificar nada
  explain <RULE-ID>      Por que existe una regla
  approve <OP-ID...>     Registra aprobaciones (o --risk <nivel>, o --reset)
  clean --approved       Mueve a cuarentena solo lo aprobado

Opciones:
  --json                 Salida legible por maquina
  --root <ruta>          Workspace para approve y clean (por defecto, el actual)
  --risk <nivel>         approve: todo lo ejecutable hasta ese riesgo (safe, low, medium, high)
  --reset                approve: descarta las aprobaciones pendientes
  --approved             clean: confirma que solo se ejecuta lo aprobado
  --help                 Esta ayuda

Entorno:
  HYGIENE_HOME           Base de cuarentena y aprobaciones (por defecto ~/.hygiene)

Codigos de salida: 0 limpio, 1 hallazgos, 2 fallo de la herramienta.`;

function replacer(_key: string, value: unknown): unknown {
  return value instanceof Set ? [...value] : value;
}

async function resolveDir(target: string | undefined, print: Printer): Promise<string | null> {
  const root = path.resolve(target ?? process.cwd());
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    print(`La ruta no existe: ${root}`);
    return null;
  }
  if (!rootStat.isDirectory()) {
    print(`La ruta no es un directorio: ${root}`);
    return null;
  }
  return root;
}

export async function main(argv: string[], print: Printer = console.log): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        help: { type: 'boolean' },
        root: { type: 'string' },
        risk: { type: 'string' },
        reset: { type: 'boolean' },
        approved: { type: 'boolean' },
      },
    });
  } catch (err) {
    print(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const [command, target] = parsed.positionals;
  const json = parsed.values.json === true;

  if (parsed.values.help === true) {
    print(USAGE);
    return 0;
  }

  if (!command) {
    print(USAGE);
    return 2;
  }

  try {
    if (command === 'explain') {
      if (!target) {
        print('Falta el identificador de regla.');
        return 2;
      }
      const packs = await loadPacks(RULES_DIR);
      const rule = packs.flatMap((p) => p.rules).find((r) => r.id === target);
      if (!rule) {
        print(`Regla desconocida: ${target}`);
        return 2;
      }
      if (json) {
        print(JSON.stringify(rule, replacer, 2));
        return 0;
      }
      print(`${rule.id}  ${rule.title}`);
      print('');
      print(rule.why.trim());
      print('');
      print(`severidad ${rule.severity}  riesgo ${rule.risk}  confianza ${rule.confidence}`);
      print(`sugiere: ${rule.suggests.map((s) => s.type).join(', ')}`);
      return 0;
    }

    if (command === 'scan' || command === 'audit') {
      const root = await resolveDir(target, print);
      if (!root) return 2;

      const result = await runAudit({ root, rulesDir: RULES_DIR });

      if (command === 'scan') {
        print(JSON.stringify(result.inventory, replacer, 2));
        return 0;
      }

      print(json ? JSON.stringify(result, replacer, 2) : renderReport(result));
      return result.score.clean ? 0 : 1;
    }

    if (command === 'plan') {
      const root = await resolveDir(target, print);
      if (!root) return 2;
      const { audit, plan } = await runPlan({ root, rulesDir: RULES_DIR });
      print(json ? JSON.stringify(plan, null, 2) : renderPlan(plan));
      return audit.score.clean ? 0 : 1;
    }

    if (command === 'approve') {
      const root = await resolveDir(parsed.values.root, print);
      if (!root) return 2;
      const home = resolveHome();

      if (parsed.values.reset === true) {
        const borrado = await deleteApprovals(home, root);
        print(borrado ? 'Aprobaciones pendientes descartadas.' : 'No habia aprobaciones pendientes.');
        return 0;
      }

      const ids = parsed.positionals.slice(1);
      const risk = parsed.values.risk;
      if (risk !== undefined && !(APPROVABLE_RISKS as readonly string[]).includes(risk)) {
        print(`--risk no valido: ${risk}. Valores: ${APPROVABLE_RISKS.join(', ')}`);
        return 2;
      }
      if (ids.length === 0 && risk === undefined) {
        print('Indica IDs de operacion o --risk <nivel>.');
        return 2;
      }

      const { plan } = await runPlan({ root, rulesDir: RULES_DIR });
      const { selected, errors } = selectOperations({
        plan, ids, risk: risk as ApprovableRisk | undefined,
      });
      if (errors.length > 0) {
        for (const e of errors) print(e);
        print('No se ha registrado ninguna aprobacion.');
        return 2;
      }
      if (selected.length === 0) {
        print('Ninguna operacion aprobable coincide. No se ha registrado nada.');
        return 0;
      }

      const record = mergeApproval(await loadApprovals(home, root), plan, selected, argv.slice(1), new Date());
      const file = await saveApprovals(home, record);
      print(`Aprobadas: ${selected.map((o) => o.id).join(' ')}`);
      print(`Registrado en ${file}`);
      print(`Para ejecutar: hygiene clean --approved --root "${root}"`);
      return 0;
    }

    if (command === 'clean') {
      if (parsed.values.approved !== true) {
        print('ERROR: No approved operations. Nothing was modified.');
        print('clean solo ejecuta lo aprobado: hygiene clean --approved [--root <ruta>]');
        return 2;
      }
      const root = await resolveDir(parsed.values.root, print);
      if (!root) return 2;

      const result = await runClean({ root, rulesDir: RULES_DIR, home: resolveHome() });
      if (result.status === 'no-approvals') {
        print('ERROR: No approved operations. Nothing was modified.');
        return 2;
      }
      if (result.status === 'stale') {
        print('ERROR: las aprobaciones ya no coinciden con el disco. Nothing was modified.');
        for (const a of result.stale) print(`  caducada  ${a.id}  ${a.type}  ${a.path}`);
        print('Vuelve a ejecutar hygiene plan y aprueba de nuevo, o descarta con hygiene approve --reset.');
        return 2;
      }

      let failed = 0;
      for (const o of result.outcomes) {
        if (o.status === 'quarantined') {
          print(`  cuarentena  ${o.opId}  ${o.path}  -> ${o.entry}`);
        } else {
          if (o.status === 'failed') failed += 1;
          print(`  ${o.status === 'failed' ? 'fallo' : 'omitida'}  ${o.opId}  ${o.path}  (${o.reason})`);
        }
      }
      print('Para deshacer: hygiene restore <OP-ID>');
      return failed > 0 ? 2 : 0;
    }

    print(`Comando desconocido: ${command}`);
    print('');
    print(USAGE);
    return 2;
  } catch (err) {
    print(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

const invocadoDirectamente = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invocadoDirectamente) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
    },
  );
}
