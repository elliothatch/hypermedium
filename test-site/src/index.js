import * as Path from 'node:path';
import { Plugin } from 'hypermedium';
const testSitePlugin = {
    name: 'test-site',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    moduleFactory: (options) => {
        return {
            files: ['dist'],
            hypermedia: {
                sitePaths: ['site'],
            },
            renderer: {
                templatePaths: ['templates'],
                partialPaths: ['partials'],
                profileLayouts: {},
                context: '/site.json'
            },
            build: {
                buildSteps: {
                    sType: 'task',
                    definition: 'sass',
                    options: {
                        // include node_modules so we can @use any installed package (e.g. sanitize.css)
                        includePaths: [Path.join(__dirname, 'node_modules')]
                    },
                    watch: true,
                    files: [{
                            inputs: { target: ['sass/styles.scss'] },
                            outputs: {
                                css: ['dist/css/styles.css'],
                                sourceMap: ['dist/css/styles.css.map'],
                            }
                        }],
                    watchFiles: ['sass']
                }
            }
        };
    },
};
export default testSitePlugin;
//# sourceMappingURL=index.js.map