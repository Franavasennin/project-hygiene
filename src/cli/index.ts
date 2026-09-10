#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../audit.js';
import { loadPacks } from '../rules/schema.js';
import { renderReport } from '../report/human.js';

export type Printer = (line: string) => void;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.resolve(HERE, '..', '..', 'rules');

const USAGE = `hygiene <comando> [ruta] [opciones]

Comandos:
  scan [ruta]            Inventario, sin juicio
  audit [ruta]            Hallazgos y puntuacion
  explain <RULE-ID>      Por que existe una regla

Opciones:
  --json                 Salida legible por maquina
  --help                 Esta ayuda

Codigos de salida: 0 limpio, 1 hallazgos, 2 fallo de la herramienta.`;

function replacer(_key: string, value: unknown): unknown {
  return value instanceof Set ? [...value] : value;
}

export async function main(argv: string[], print: Printer = console.log): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, help: { type: 'boolean' } },
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
      const root = path.resolve(target ?? process.cwd());

      let rootStat;
      try {
        rootStat = await stat(root);
      } catch {
        print(`La ruta no existe: ${root}`);
        return 2;
      }
      if (!rootStat.isDirectory()) {
        print(`La ruta no es un directorio: ${root}`);
        return 2;
      }

      const result = await runAudit({ root, rulesDir: RULES_DIR });

      if (command === 'scan') {
        print(JSON.stringify(result.inventory, replacer, 2));
        return 0;
      }

      print(json ? JSON.stringify(result, replacer, 2) : renderReport(result));
      return result.score.clean ? 0 : 1;
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
