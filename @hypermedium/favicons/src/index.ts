import { promisify } from 'util';

import { outputFile } from 'fs-extra';
import { Plugin, Build } from 'hypermedium';

import favicons from 'favicons';
// import favicons = require('favicons');

const generateFavicons = promisify(favicons);

const faviconsPlugin: Plugin = {
    name: 'favicons',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    basePath: '../',
    moduleFactory: (options) => {
        return {
            build: {
                taskDefinitions: [faviconsTaskDefinition],
            }
        };
    },
};

// TODO: use fibers package to speed up render times
const faviconsTaskDefinition: Build.TaskDefinition = {
    name: 'favicons',
    description: 'Generate favicon files from image',
    func: (inputs, outputs, options, logger) => {
        logger.info(`Generating favicons: ${inputs.target[0]} -> ${outputs.favicons[0]}`);
        return generateFavicons(inputs.target[0], Object.assign({
            path: outputs.icons[0],
            android: true,
            appleIcon: true,
            appleStartup: true,
            favicons: true,
            windows: true,
            // yandex: true,
        }, options))
            .then((result: any) => {
                return outputFile(outputs.html[0], result.html)
                    .then(() => result.files);
            });
    },
    inputs: {
        target: {
            count: [1],
        }
    },
    outputs: {
        favicons: {
            fType: 'dir',
            count: [1],
            hint: 'favicons'
        },
        html: {
            fType: 'file',
            count: 1,
            hint: '{0 | basename}.html'
        }
    }
};

export default faviconsPlugin;
