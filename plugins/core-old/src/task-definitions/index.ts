import { RollupTask } from './rollup';
import { ReactRollup } from './react';
import { CompileSass } from './sass';
import { RegexTask } from './regex';

import { TaskDefinition } from 'freshr';

const taskDefinitions: TaskDefinition[] = [
    RollupTask,
    ReactRollup,
    CompileSass,
    RegexTask,
];

export default taskDefinitions;
