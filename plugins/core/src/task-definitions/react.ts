import * as Path from 'path';
import { from } from 'rxjs';
import { mergeMap, map } from 'rxjs/operators';

import { TaskDefinition } from 'freshr';

import { RollupTask } from './rollup';

import * as babel from 'rollup-plugin-babel';
const commonjs = require('rollup-plugin-commonjs');
// import * as rollupNodeBuiltins from 'rollup-plugin-node-builtins';
// import * as rollupNodeGlobals from 'rollup-plugin-node-globals';
const resolve = require('rollup-plugin-node-resolve');
// var nodeBuiltins = require('rollup-plugin-node-builtins');
// var nodeGlobals = require('rollup-plugin-node-globals');
const alias = require('rollup-plugin-alias');


let reactPath = Path.join(__dirname, '..', '..', '..', '..', 'node_modules/react/umd/react.production.min.js');
let reactDomPath = Path.join(__dirname, '..', '..', '..', '..', 'node_modules/react-dom/umd/react-dom.production.min.js');
if (process.env.NODE_ENV !== 'production') {
    reactPath =  Path.join(__dirname, '..', '..', '..', '..', 'node_modules/react/umd/react.development.js');
    reactDomPath = Path.join(__dirname, '..', '..', '..', '..', 'node_modules/react-dom/umd/react-dom.development.js');
}

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
                    alias({
                        'react': reactPath,
                        'react-dom': reactDomPath
                    }),
                    commonjs({
                        // exclude: ['node_modules/**'],
                        include: [
                            'node_modules/**',
                        ],
                    }),
                    babel({
                        exclude: ['node_modules/**/*'],
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
                    // nodeBuiltins(),
                    // nodeGlobals(),
                ].concat(options && options.rollup && options.rollup.plugins || [])
            }),
        });

        return RollupTask.func(inputs, outputs, rollupOptions, logger);
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
