import * as Path from 'path';
import * as Express from 'express';
import { mergeMap } from 'rxjs/operators';

import { Log } from 'freshlog';

import { server } from './server';
import { Hypermedia } from './hypermedia';

Log.handlers.get('trace')!.enabled = true;

    // clientPath: path.join(__dirname, '..', 'demo'),
    // env: 'dev',
const app = Express();

const hypermediaOptions = {
    baseUri: 'https://freshr.io',
    curies: [{
        href: '/rels/{rel}',
        name: 'fs',
        templated: true,
    }],
    processors: [
        Hypermedia.Processor.self,
        Hypermedia.Processor.tags,
        Hypermedia.Processor.breadcrumb,
        Hypermedia.Processor.curies,
    ]
};

const verbose = true;

const hypermedia = new Hypermedia(hypermediaOptions);
hypermedia.event$.subscribe({
    next: (e) =>
        verbose? 
            Log.trace('hypermedia', {
                ...e,
                dependencies: Array.from(e.dependencies.values()),
                dependents: Array.from(e.dependents.values()),
            }):
            Log.trace('hypermedia', {
                type: e.type,
                relativeUri: e.relativeUri,
            }),
    error: (e) => Log.error('hypermedia', e),
});

const sitePath = Path.join(__dirname, '..', 'demo', 'src');

hypermedia.processDirectory(sitePath).then(() => {
    hypermedia.reprocessResources(['/index.json']);
}).catch(console.error);

app.use(hypermedia.router);


server(app).subscribe({
    next: (server) => {
        Log.info('server-start', server);
    }, 
    error: (error) => console.error(error),
});

// setting wsEngine prevents crash when starting more than one websocket instance (e.g. in tests)
// https://github.com/socketio/engine.io/issues/521
// this.socketServer = SocketIO(this.httpServer, {wsEngine: 'ws'} as SocketIO.ServerOptions);


// Log.info('start', {config: );
