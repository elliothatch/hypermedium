import * as Path from 'path';

import * as Express from 'express';
import * as Websocket from 'socket.io';
import {concat, EMPTY} from 'rxjs';
import {map, mergeMap, tap} from 'rxjs/operators';

import {Log} from 'freshlog';
import {File, Freshr, Hypermedia, loadFiles, server} from 'freshr';

import {buildSteps} from './build';

Log.handlers.get('trace')!.enabled = true;

const app = Express();
const websocketServer = Websocket();

// interface Config {
    // sitePath: string;
// }

// const defaultConfig = {
// };

// const config = {
// };


const demoPath = Path.join(__dirname, '..', '..', 'client');
const sitePath = Path.join(demoPath, 'src', 'site');
const freshr = new Freshr(demoPath, {
    websocketServer,
    renderer: {
        // defaultTemplate: '/freshr.hbs',
        profileLayouts: {
            '/schema/welcome-page': 'layouts/welcome-page.hbs',
            '/schema/post': 'layouts/post.hbs',
        },
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
    }
});

const pluginsPath = Path.join(__dirname, '..', '..', '..', 'plugins');

const verbose = false;

/*
Plugin.watch('core', pluginsPath).events.subscribe({
    next: (watchEvent) => {
        if(watchEvent.eType === 'error') {
            Log.error('plugin watch', watchEvent);
        }
        else {
            Log.trace('plugin watch', watchEvent);
        }
    },
    error: (error: Error) => Log.error('plugin watch', error),
});
*/

freshr.watchEvent$.subscribe({
    next: (e) => {
        Log.trace(`resource changed: ${e.uri}`, e);
    }
});

freshr.hypermedia.event$.subscribe({
    next: (e) => {
        if(verbose) {
            Log.trace(`hypermedia: ${e.eType}`, e);
        }
        else {
            const event: Partial<Hypermedia.Event> = Object.assign({}, e);
            if(event.eType === 'ProcessResource') {
                delete event.edges;
                delete event.resource;
            }
            Log.trace(`hypermedia: ${e.eType}`, e);
        }
    },
    error: (e) => Log.error(`hypermedia: ${e.eType}`, e),
});

// freshr.loadAndRegisterPlugins(['core', 'filesystem'], pluginsPath).subscribe({
concat(
    freshr.loadAndRegisterPlugins(['core', 'material-design-icons', 'filesystem', 'dashboard'], pluginsPath).pipe(
        mergeMap(({plugin, module}) => {
            Log.info('plugin registered', {
                plugin,
                processorGenerators: module.processorGenerators && Object.keys(module.processorGenerators)
            });
            // TODO: Add this step to freshr
            // TODO: plugin dependency management
            // TODO: plugins should register in topological order
            if(module.buildSteps) {
                return freshr.build.build(module.buildSteps, plugin.path).pipe(map((event) => ({event, plugin: plugin})));
            }
            return EMPTY;

        }), tap(({event, plugin}) => {
            if(event.eType === 'error') {
                Log.error('build plugin', {plugin: plugin.name, event});
            }
            else {
                Log.info('build plugin', {plugin: plugin.name, event});
            }
        })
    ),
    loadFiles([Path.join(demoPath, 'src', 'templates')]).pipe(
        tap((template) => {
            if((template as File).contents) {
                freshr.renderer.registerTemplate(template as File, '')
            }
        })
    ),
    loadFiles([Path.join(demoPath, 'src', 'partials')]).pipe(
        tap((partial) => {
            if((partial as File).contents) {
                freshr.renderer.registerPartial(partial as File, '')
            }
        })
    )
).subscribe({
    complete: () => {
        freshr.renderer.defaultTemplate = 'freshr.hbs';
        Log.info('processor generators', {processors: Array.from(freshr.processorGenerators.keys())});

        // TODO: add support for processors that only are applied to certain uris (expressjs path pattern matching?)
        freshr.addProcessor('core/resourceGraph');
        freshr.addProcessor('core/self');
        freshr.addProcessor('core/tags');
        // freshr.addProcessor('core/breadcrumb');
        freshr.addProcessor('core/makeIndex', '/schema/post');
        freshr.addProcessor('core/makeIndex', '/schema/index/tags');
        freshr.addProcessor('core/curies');
        freshr.addProcessor('core/embed');
        // freshr.addProcessor('core/schema');

        // reprocess plugin resources after adding processors
        freshr.hypermedia.processAllResources();

        // freshr.hypermedia.loadDirectory(sitePath).catch((e) => console.error(e)).then(() => {
            // freshr.hypermedia.processLoadedResources();
        // }).catch(console.error);

        const watcher = freshr.watchResources(sitePath);
        watcher.events.subscribe();
        // freshr.watcher.add(sitePath);

        freshr.build.buildSteps['demo'] = buildSteps;

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

app.use(freshr.renderer.router);
app.use(freshr.hypermedia.router);

app.use(Express.static(Path.join(demoPath, 'build', 'site')));
app.use('/css', Express.static(Path.join(demoPath, 'build', 'css')));
app.use('/js', Express.static(Path.join(demoPath, 'build', 'js')));
app.use('/material-icons', Express.static(Path.join(demoPath, 'build', 'material-icons')));


server(app).subscribe({
    next: (server) => {
        Log.info('server-listening', {port: server.port});
        websocketServer.attach(server.server);
    }, 
    error: (error) => Log.error('server-start', {error}),
});

// setting wsEngine prevents crash when starting more than one websocket instance (e.g. in tests)
// https://github.com/socketio/engine.io/issues/521
// this.socketServer = SocketIO(this.httpServer, {wsEngine: 'ws'} as SocketIO.ServerOptions);
