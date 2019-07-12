import { from, bindNodeCallback, forkJoin } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { outputFile } from 'fs-extra';
import { render as renderCb } from 'node-sass';

import { TaskDefinition } from '../../../../src/build';

const render = bindNodeCallback(renderCb);

/**
 * Compiles a SASS or SCSS file to CSS. options are passed directly to the node-sass render function. file and outFile are always overwitten with the freshr task paths, and sourceMap is always enabled
 */
export const CompileSass: TaskDefinition = {
    name: 'sass',
    description: 'Compile Sass and SCSS files into CSS',
    func: (inputs, outputs, options, logger) => {
        logger.info(`Compiling ${inputs.target[0]} to ${outputs.css[0]}`);
        return render(Object.assign({}, options, {
            file: inputs.target[0],
            outFile: outputs.css[0],
            sourceMap: true
        })).pipe(
            mergeMap((result) => {
                return forkJoin(
                    outputFile(outputs.css[0], result.css),
                    outputFile(outputs.sourceMap[0], result.map)
                );
            })
        );
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
