import { Plugin } from 'hypermedium';

import { handlebarsHelpers } from './handlebars';
import { processorFactories } from './processors';

export interface CoreOptions {
}

const corePlugin: Plugin<CoreOptions> = {
    name: 'core',
    version: '1.0.0',
    pluginApi: '1',
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
