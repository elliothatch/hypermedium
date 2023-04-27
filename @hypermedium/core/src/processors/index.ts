import { Processor } from 'hypermedium';
import { processorDefinitions as standard } from './standard';
import { processorDefinitions as jsonld } from './jsonld';

export const processorDefinitions: Processor.Definition[] = (standard as Processor.Definition[]).concat(jsonld);
