import { RollupTask } from './rollup';
import { ReactRollup } from './react';
import { CompileSass } from './sass';

import { TaskDefinition } from 'freshr';

const taskDefinitions: TaskDefinition[] = [
    RollupTask,
    ReactRollup,
    CompileSass,
];

export default taskDefinitions;
