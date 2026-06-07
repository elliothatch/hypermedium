import { promisify } from 'util';

import { outputFile } from 'fs-extra';
import { type Plugin, Build } from 'hypermedium';
import { render as renderCb } from 'sass';

const render = promisify(renderCb);

const sassPlugin: Plugin = {
    name: 'sass',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    basePath: '../',
    moduleFactory: (options) => {
        return {
            build: {
                taskDefinitions: [sassTaskDefinition],
            }
        };
    },
};

// TODO: use fibers package to speed up render times
const sassTaskDefinition: Build.TaskDefinition = {
    name: 'sass',
    description: 'Compile Sass and SCSS files into CSS',
    func: async (inputs, outputs, options, logger) => {
        logger.info(`Compiling ${inputs.target[0]} to ${outputs.css[0]}`);
        const result = await render({
            ...options,
            file: inputs.target[0],
            outFile: outputs.css[0],
            sourceMap: true
        });

        if(!result) {
            throw new Error('Sass error');
        }

        await Promise.all([
            outputFile(outputs.css[0], result.css),
            outputFile(outputs.sourceMap[0], result.map)
        ]);

        return result.stats;
    },
    inputs: {
        target: {
            count: [1],
        }
    },
    outputs: {
        css: {
            count: 1,
            hint: '{0 | basename}.css'
        },
        sourceMap: {
            count: 1,
            hint: '{0 | basename}.css.map'
        }
    }
};

export default sassPlugin;
