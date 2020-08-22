import {Log} from 'freshlog';
import {BuildStep} from 'freshr';
import * as Path from 'path';

const rollupAlias = require('rollup-plugin-alias');
const rollupCommonjs = require('rollup-plugin-commonjs');
const rollupResolve = require('rollup-plugin-node-resolve');

export const buildSteps: BuildStep = {
    sType: 'multitask',
    sync: true,
    steps: [{
        sType: 'task',
        definition: 'clean',
        files: [{
            inputs: {target: ['build']},
            outputs: {}
        }]
    }, {
        sType: 'multitask',
        steps: [{
            sType: 'task',
            definition: 'copy',
            files: [{
                inputs: {target: [Path.join('src', 'partials')]},
                outputs: {destination: [Path.join('build', 'partials')]}
            }, {
                inputs: {target: [Path.join('src', 'site')]},
                outputs: {destination: [Path.join('build', 'site')]}
            }, {
                inputs: {target: [Path.join('src', 'templates')]},
                outputs: {destination: [Path.join('build', 'templates')]}
            }, {
                inputs: {target: [Path.join('..', '..', 'plugins', 'dashboard', 'build', 'components')]},
                outputs: {destination: [Path.join('build', 'js', '~dashboard')]}
            }, {
                inputs: {target: [Path.join('..', '..', 'plugins', 'material-design-icons', 'build')]},
                outputs: {destination: [Path.join('build', 'material-icons')]}
            }]
        },  {
            sType: 'task',
            definition: 'sass',
            options: {
                includePaths: [Path.join(__dirname, '..', 'node_modules')]
            },
            files: [{
                inputs: {target: ['src/sass/freshr.scss']},
                outputs: {
                    css: ['build/css/freshr.css'],
                    sourceMap: ['build/css/freshr.css.map'],
                }
            }]
        }, {
            sType: 'task',
            definition: 'sass',
            options: {
                includePaths: [Path.join(__dirname, '..', 'node_modules')]
            },
            files: [{
                inputs: {target: ['src/sass/dashboard.scss']},
                outputs: {
                    css: ['build/css/dashboard.css'],
                    sourceMap: ['build/css/dashboard.css.map'],
                }
            }]
        }, {
            sType: 'task',
            definition: 'rollup',
            options: {
                rollup: {
                    plugins: [
                        rollupCommonjs({
                            include: [
                                'node_modules/**',
                            ],
                        }),
                        rollupResolve({
                            browser: true,
                            extensions: ['.js', '.jsx'],
                        }),
                    ]
                }
            },
            files: [{
                inputs: {target: ['src/jsx/resource-graph.jsx']},
                outputs: {
                    js: ['build/js/resource-graph.js'],
                }
            }]
        }, {
            sType: 'task',
            definition: 'react-rollup',
            options: {
            },
            files: [{
                inputs: {target: ['src/jsx/main.jsx']},
                outputs: {
                    js: ['build/js/main.js'],
                }
            }, {
                inputs: {target: ['src/jsx/~config/main.jsx']},
                outputs: {
                    js: ['build/js/main.js'],
                }
            }]
        }]
    }]
};
