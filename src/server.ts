import { AddressInfo } from 'net';
import * as Express from 'express';
import * as Http from 'http';
import * as Https from 'https';
import * as Path from 'path';
import { promises as fs } from 'fs';

import { from, fromEvent, merge, Observable, of, race, throwError, zip } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';

import { Log } from 'freshlog';

export interface Server {
    /** server hosting the app */
    server: Http.Server | Https.Server;
    /** app port */
    port: number;

    /** if ssl enabled, this is a server that listens on options.port and redirects all traffic to the server at options.securePort  */
    redirectServer?: Http.Server;
    /** port of the http->https redirect server if tls enabled */
    redirectPort?: number;
}

export namespace Server {
    /** Server constructor options */
    export interface Options {
        /** Insecure HTTP port, if 0, let OS pick */
        port: number;
        /** HTTPS port, if 0, let OS pick */
        securePort?: number;
        /** path to a directory containing key.pem and cert.pem cert files */
        certPath?: string;
    }
    export namespace Options {
        export const Default: Options  = {
            port: 8080,
        };
    }

}

export interface Certificate {
    cert: Buffer;
    key: Buffer;
}

/**
 * Set up HTTP/HTTPS server and listen
 */
export function server(app: Express.Express, opts?: Partial<Server.Options>): Observable<Server> {
    const options: Server.Options = Object.assign({}, Server.Options.Default, opts);

    if(options.certPath) {
        return loadCerts(options.certPath).pipe(
            mergeMap((cert) => {
                const server = Https.createServer(cert, app);
                const redirectServer = makeSecureRedirectServer(options.securePort || 0);
                const events = merge(
                    zip(
                        fromEvent(server, 'listening'),
                        fromEvent(redirectServer, 'listening'),
                    ),
                    fromEvent(server, 'error').pipe(map((err) => throwError(err))),
                    fromEvent(redirectServer, 'error').pipe(map((err) => throwError(err))),
                );

                server.listen(options.securePort || 0);
                redirectServer.listen(options.port);

                return events.pipe(
                    map(() => ({
                        port: (server.address() as AddressInfo).port,
                        server,
                        redirectPort: (redirectServer.address() as AddressInfo).port,
                        redirectServer,
                    }))
                );
            })
        );
    }
    else {
        const server = Http.createServer(app);
        const events = merge(
            fromEvent(server, 'listening'),
            fromEvent(server, 'error').pipe(map((err) => throwError(err))),
        );

        server.listen(options.port || 0);

        return events.pipe(
            map(() => ({
                port: (server.address() as AddressInfo).port,
                server,
            }))
        );
    }
}

/** path to directory containing cert.pem and 'key.pem */
function loadCerts(path: string): Observable<Certificate> {
    return zip(
        from(fs.readFile(Path.join(path, 'cert.pem'))),
        from(fs.readFile(Path.join(path, 'key.pem'))),
        (cert, key) => ({cert, key})
    );
}

function makeSecureRedirectServer(redirectPort: number): Http.Server {
    let redirectPortStr = '';
    if(redirectPort !== 443) {
        redirectPortStr = ':' + redirectPort;
    }
    return new Http.Server((req: Http.IncomingMessage, res: Http.ServerResponse) => {
        try {
            let host = req.headers.host;
            if(host) {
                host = host.split(':')[0];
                res.writeHead(307, {Location: 'https://' + host + redirectPortStr + req.url});
            }
            res.end();
        } catch (err) {
            res.writeHead(500);
            res.end();
            Log.error(`secure redirect error`, err);
        }
    });
}
