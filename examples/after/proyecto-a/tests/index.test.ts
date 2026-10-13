import { saludo } from '../src/index.js';

if (saludo() !== 'hola') throw new Error('saludo');
