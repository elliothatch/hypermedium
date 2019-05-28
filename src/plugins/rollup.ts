import { from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import { TaskDefinition } from '../build';

import { rollup } from 'rollup';

/**
 * rollup.js task
 */
export const RollupTask: TaskDefinition = {
    name: 'rollup',
    description: 'Transform and bundle code with rollup.js',
    func: (inputs, outputs, options, logger) => {
        const rollupOptions = Object.assign({}, options && options.rollup, {
            input: inputs.target[0]
        });

        const bundleOptions = Object.assign({
            format: 'iife',
            sourcemap: true,
        }, options && options.bundle, {
            file: outputs.js[0]
        });

        return from(rollup(rollupOptions)).pipe(
            mergeMap((bundle) => {
                return from(bundle.write(bundleOptions));
            })
        );
    },
    inputs: {
        target: {
            count: [1],
        }
    },
    outputs: {
        js: {
            count: 1,
            hint: '{0 | basename}.js'
        }
    }
};
