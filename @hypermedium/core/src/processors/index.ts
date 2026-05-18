import { type Processor } from 'hypermedium';
import { processorDefinitions as standard } from './standard.js';
import { processorDefinitions as jsonld } from './jsonld.js';

export const processorDefinitions: Processor.Definition[] = (standard as Processor.Definition[]).concat(jsonld);
