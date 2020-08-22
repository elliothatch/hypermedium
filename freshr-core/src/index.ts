import { Plugin } from 'freshr';

import { handlebarsHelpers } from './handlebars';
import { processorFactories } from './processors';

export interface CoreOptions {
}

const corePlugin: Plugin<CoreOptions> = {
    name: 'core',
    version: '1.0.0',
    dependencies: [],
    basePath: '../',
    moduleFactory: (options) => {
        return {
            hypermedia: {
                processorFactories,
            },
            renderer: {
                templatePaths: ['templates'],
                partialPaths: ['partials'],
                handlebarsHelpers,
            }
        };
    },
};

export default corePlugin;
