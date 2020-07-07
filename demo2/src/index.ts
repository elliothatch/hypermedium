import { Plugin } from 'freshr';

export interface DemoOptions {
}

const demoPlugin: Plugin<DemoOptions> = {
    name: 'freshr-demo',
    version: '1.0.0',
    dependencies: [],
    defaultOptions: {
    },
    basePath: '../'
    moduleFactory: (options) => {
        return {
            hypermedia: {
                sitePaths: ['site'],
            },
            renderer: {
                templatePaths: ['templates'],
                partialPaths: ['partials'],
                profileLayouts: {
                    '/schema/welcome-page': 'layouts/welcome-page.hbs',
                    '/schema/post': 'layouts/post.hbs',
                },
            }
        };
    },

};

export default demoPlugin;

/*
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
*/
