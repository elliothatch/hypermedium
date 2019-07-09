import * as Path from 'path';
import * as Express from 'express';
import { mergeMap } from 'rxjs/operators';

import { Log } from 'freshlog';

import { server } from './server';
import { Hypermedia } from './hypermedia';
import { Processor, tags, makeIndex } from './hypermedia/processor';
import { HypermediaRenderer } from './hypermedia-renderer';
import { BuildManager, BuildStep, TaskDefinition } from './build';

import { Plugin } from './plugin';
import { Freshr } from './freshr';

const rollupAlias = require('rollup-plugin-alias');
const rollupCommonjs = require('rollup-plugin-commonjs');
const rollupResolve = require('rollup-plugin-node-resolve');

Log.handlers.get('trace')!.enabled = true;

    // clientPath: path.join(__dirname, '..', 'demo'),
    // env: 'dev',
const app = Express();

/*
const hypermediaOptions = {
    baseUri: 'https://freshr.io',
    curies: [{
        href: '/rels/{rel}',
        name: 'fs',
        templated: true,
    }],
    processors: [
        Processor.resourceGraph,
        Processor.self,
        tags.tags,
        // Processor.breadcrumb,
        makeIndex.makeIndex('/schema/post'),
        makeIndex.makeIndex('/schema/index/tags'),
        Processor.curies,
        Processor.embed,
        Processor.schema,
        ConfigProcessor
    ]
};
 */

const demoPath = Path.join(__dirname, '..', 'demo');
// const sitePath = Path.join(demoPath, 'build', 'site');
const sitePath = Path.join(demoPath, 'src', 'site');
const freshr = new Freshr(demoPath, {
    renderer: {
        defaultTemplate: '/freshr.hbs',
    }
});

const pluginsPath = Path.join(__dirname, 'plugins');

const verbose = false;

freshr.hypermedia.event$.subscribe({
    next: (e) => {
        if(verbose) {
            Log.trace('hypermedia', e);
        }
        else {
            const event = Object.assign({}, e);
            if(event.eType === 'ProcessResource') {
                delete event.edges;
                delete event.resource;
            }
            Log.trace('hypermedia', event);
        }
    },
    error: (e) => Log.error('hypermedia', e),
});

freshr.loadAndRegisterPlugins(['core', 'filesystem'], pluginsPath).subscribe({
    next: ({plugin, module}) => {
        Log.info('plugin registered', {
            plugin,
            processorGenerators: module.processorGenerators && Object.keys(module.processorGenerators)
        });
    },
    complete: () => {
        Log.info('processor generators', {processors: Array.from(freshr.processorGenerators.keys())});

        freshr.addProcessor('core/resourceGraph');
        freshr.addProcessor('core/self');
        freshr.addProcessor('core/tags');
        // freshr.addProcessor('core/breadcrumb');
        freshr.addProcessor('core/makeIndex', '/schema/post');
        freshr.addProcessor('core/makeIndex', '/schema/index/tags');
        freshr.addProcessor('core/curies');
        freshr.addProcessor('core/embed');
        // freshr.addProcessor('core/schema');

        freshr.hypermedia.loadDirectory(sitePath).catch((e) => console.error(e)).then(() => {
            freshr.hypermedia.processLoadedResources();
        }).catch(console.error);

        const buildSteps: BuildStep = {
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

                                // rollupAlias({
                                //     'cytoscape': Path.join(__dirname, '..', 'node_modules/cytoscape/dist/cytoscape.umd.js'),
                                //     'dagre': Path.join(__dirname, '..', 'node_modules/dagre/dist/dagre.min.js'),
                                //     'cytoscape-dagre': Path.join(__dirname, '..', 'node_modules/cytoscape-dagre/cytoscape-dagre.js'),
                                //     'cytoscape-dagre': Path.join(__dirname, '..', 'node_modules/cytoscape-dagre/cytoscape-dagre.js'),
                                // })
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

        freshr.build.build(buildSteps).subscribe({
            next: (event) => {
                if(event.eType === 'error') {
                    Log.error('build', event);
                }
                else {
                    Log.info('build', event);
                }
            },
            error: (error) => {
                Log.error('build', error);
            }
        });
    }
});



// const sitePath = Path.join(__dirname, '..', 'demo', 'src', 'site');

// hypermedia.loadDirectory(sitePath).catch((e) => console.error(e)).then(() => {
// hypermedia.processLoadedResources();
// console.log(hypermedia.getResource('/freshr/resource-graph.json'));
// hypermedia.processResource('/freshr/resource-graph.json');
// hypermedia.processResource('/index.json');
// hypermedia.processResource('/posts/index.json');
// hypermedia.processResource('/posts/hello-world.json');
// hypermedia.reprocessResources(['/index.json']);
// hypermedia.reprocessResources(['/posts/index.json', '/index.json']);
// }).catch(console.error);

/*
const coreTemplatesPath = Path.join(__dirname, '..', 'src', 'templates');
const corePartialsPath = Path.join(__dirname, '..', 'src', 'partials');

const demoTemplatesPath = Path.join(__dirname, '..', 'demo', 'src', 'templates');
const demoPartialsPath = Path.join(__dirname, '..', 'demo', 'src', 'partials');

const hypermediaRenderer = new HypermediaRenderer({
    hypermedia,
    defaultTemplate: '/freshr.hbs',
    siteContext: {
        title: 'freshr',
        navLinks: {
            "author": {
                "href": "/about",
                "title": "About"
            },
            "fs:posts": {
                "href": "/posts",
                "title": "Posts"
            },
            "fs:tags": {
                "href": "/tags",
                "title": "Tags"
            }
        }
    },
    profileLayouts: {
        '/schema/freshr/resource-graph': 'core/layouts/resource-graph.hbs',
        '/schema/welcome-page': 'layouts/welcome-page.hbs',
        '/schema/post': 'layouts/post.hbs',
        '/schema/index/schema/post': 'core/layouts/index.hbs',
        '/schema/index/schema/index/tags': 'core/layouts/tags-index.hbs',
    }
});

hypermediaRenderer.loadPartials(corePartialsPath, 'core');
hypermediaRenderer.loadTemplates(coreTemplatesPath, 'core');
console.log(hypermediaRenderer.partials);

hypermediaRenderer.loadPartials(demoPartialsPath);
hypermediaRenderer.loadTemplates(demoTemplatesPath).catch((err) => console.error(err));

 */

// const demoBuildPath = Path.join(__dirname, '..', 'demo');

// const buildManager = new BuildManager(demoBuildPath);
// buildManager.taskDefinitions.set(CompileSass.name, CompileSass);
// buildManager.taskDefinitions.set(ReactRollup.name, ReactRollup);
// buildManager.taskDefinitions.set(RollupTask.name, RollupTask);

app.use(freshr.renderer.router);
app.use(freshr.hypermedia.router);
// app.use('/~config', buildManager.router);

app.use(Express.static(Path.join(__dirname, '..', 'demo', 'build', 'site')));
app.use('/css', Express.static(Path.join(__dirname, '..', 'demo', 'build', 'css')));
app.use('/js', Express.static(Path.join(__dirname, '..', 'demo', 'build', 'js')));


server(app).subscribe({
    next: (server) => {
        Log.info('server-listening', {port: server.port});
    }, 
    error: (error) => Log.error('server-start', {error}),
});

// setting wsEngine prevents crash when starting more than one websocket instance (e.g. in tests)
// https://github.com/socketio/engine.io/issues/521
// this.socketServer = SocketIO(this.httpServer, {wsEngine: 'ws'} as SocketIO.ServerOptions);


// Log.info('start', {config: );
