import { Plugin } from 'freshr';

import Processors from './processors';
import TaskDefinitions from './task-definitions';

const coreModuleFactory: Plugin.Module.Factory = (options) => {
    return {
        processorGenerators: Processors,
        taskDefinitions: TaskDefinitions,

        profileLayouts: {
            '/schema/index/schema/post': 'core/layouts/index.hbs',
            '/schema/index/schema/index/tags': 'core/layouts/tags-index.hbs',
            '/schema/freshr/resource-graph': 'core/layouts/resource-graph.hbs',
        }
    };
};

export default coreModuleFactory;
