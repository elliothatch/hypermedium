import { from } from 'rxjs';
import { mergeMap, map } from 'rxjs/operators';

import { TaskDefinition } from '../build';

import { RollupTask } from './rollup';

import * as babel from 'rollup-plugin-babel';
const commonjs = require('rollup-plugin-commonjs');
// import * as rollupNodeBuiltins from 'rollup-plugin-node-builtins';
// import * as rollupNodeGlobals from 'rollup-plugin-node-globals';
const resolve = require('rollup-plugin-node-resolve');
var nodeBuiltins = require('rollup-plugin-node-builtins');
var nodeGlobals = require('rollup-plugin-node-globals');

/**
 * Compiles a SASS or SCSS file to CSS. options are passed directly to the node-sass render function. file and outFile are always overwitten with the freshr task paths, and sourceMap is always enabled
 */
export const ReactRollup: TaskDefinition = {
    name: 'react-rollup',
    description: 'Compile React JSX into JS using rollup',
    func: (inputs, outputs, options, logger) => {
        const rollupOptions = Object.assign({}, options, {
            rollup: Object.assign({}, options && options.rollup, {
                plugins: [
                    commonjs(),
                    babel({
                        exclude: 'node_modules/**',
                        babelrc: false,
                        presets: [
                            '@babel/preset-react',
                            ['@babel/preset-env', {modules: false}],
                        ],
                        plugins: []
                    }),
                    resolve({
                        browser: true,
                        extensions: ['.js', '.jsx'],
                    }),
                    nodeBuiltins(),
                    nodeGlobals(),
                ].concat(options && options.rollup && options.rollup.plugins || [])
            }),
        });

        return RollupTask.func(inputs, outputs, rollupOptions, logger).pipe(map(() => null));
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
