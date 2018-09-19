import * as Path from 'path';
import * as Express from 'express';
import { mergeMap } from 'rxjs/operators';

import { Log } from 'freshlog';

import { server } from './server';
import { Hypermedia } from './hypermedia';

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
    ]
};


const hypermedia = new Hypermedia(hypermediaOptions);

const sitePath = Path.join(__dirname, '..', 'demo', 'src');
hypermedia.processDirectory(sitePath).then(() => {
    console.log('resources');
    console.log(JSON.stringify(hypermedia.resources));
    console.log('state');
    console.log(JSON.stringify(hypermedia.state));
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
