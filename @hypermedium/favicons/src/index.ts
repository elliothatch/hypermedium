import Path from 'path';
import { outputFile, copy } from 'fs-extra';
import { Plugin, Build } from 'hypermedium';

import { favicons } from 'favicons';

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
    description: 'Generate favicon files from image. inputs.image - source image. inputs.override - if a generated image matches the file name of one of thee overrides, the override file is used instead. this is useful when the auto-scaled image is not good at extreme resolutions.\n Options: "favicons" package options (https://www.npmjs.com/package/favicons). options.path - the base url path used for the favicons, defaults to /favicons',
    func: (inputs, outputs, options, logger) => {
        logger.info(`Generating favicons: ${inputs.image} -> ${outputs.favicons[0]}`);
        const overrideFilenames = new Map(inputs.override.map((override) => [Path.basename(override), override]));
        return favicons(inputs.image, Object.assign({
            path: '/favicons',
            android: true,
            appleIcon: true,
            appleStartup: true,
            favicons: true,
            windows: true,
            // yandex: true,
        }, options))
            .then((results) => {
                return Promise.all(
                    [outputFile(outputs.html[0], results.html.join('\n'))].concat(
                    results.images.map((image) => {
                            const override = overrideFilenames.get(image.name);
                            if(override) {
                                return copy(override, Path.join(outputs.favicons[0], image.name));
                            }
                            return outputFile(Path.join(outputs.favicons[0], image.name), image.contents)
                    }),
                    results.files.map((file) => outputFile(Path.join(outputs.favicons[0], file.name), file.contents))
                ));
            });
    },
    inputs: {
        image: {
            fType: 'file',
            count: 1,
        },
        override: {
            fType: 'file',
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
