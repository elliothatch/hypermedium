import { Plugin } from 'hypermedium';

import { handlebarsHelpers } from './handlebars';
import { processorDefinitions } from './processors';
import { taskDefinitions } from './task-definitions';

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
                processorDefinitions,
            },
            renderer: {
                templatePaths: ['templates'],
                partialPaths: ['partials'],
                handlebarsHelpers,
                profileLayouts: {
                    '/schema/post': 'layouts/post.hbs',
                    '/schema/index/_links.profile.href/schema/post': 'layouts/article-index.hbs',
                    '/schema/index': 'layouts/index.hbs',
                    '/schema/index/schema/index/tags': 'layouts/tags-index.hbs',
                    '/schema/hypermedium/state/resourceGraph': 'layouts/resource-graph.hbs',
                }
            },
            build: {
                taskDefinitions,
            }
        };
    },
};

export default corePlugin;
