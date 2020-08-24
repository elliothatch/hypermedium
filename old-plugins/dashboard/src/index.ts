import { Plugin } from 'freshr';

// import Processors from './processors';
// import TaskDefinitions from './task-definitions';

const dashboardModuleFactory: Plugin.Module.Factory = (options, freshr) => {
    const websocketMiddleware: Plugin.WebsocketMiddleware | undefined = 
        !options.hypermedia? undefined:
        (socket, next) => {
            const buildUrl = options.hypermedia!.baseUrl + '/build';
            socket.on(buildUrl, (data) => {
                if(data && data.method === "POST") {
                    // trigger a build
                    freshr.build.build(freshr.build.buildSteps['demo']).subscribe({
                        next: (event) => {
                            socket.emit(buildUrl, event);
                        },
                        error: (error) => {
                            socket.emit(buildUrl, error);
                        }
                    });
                }
                else {
                    // subscribe 
                }
            });
            next();
    };
    return {
        // processorGenerators: Processors,
        // taskDefinitions: TaskDefinitions,
        websocketMiddleware,

        buildSteps: {
            sType: 'task',
            definition: 'react-rollup',
            options: {
                // bundle: {
                    // format: 'esm'
                // }
            },
            files: [{
                inputs: {target: ['jsx/dashboard.jsx']},
                // inputs: {target: ['jsx/dashboard.jsx', 'jsx/FileExplorer.jsx', 'jsx/QRComponent.jsx', 'jsx/TaskDefinitionDisplay.jsx', 'jsx/TaskDisplay.jsx']},
                outputs: {
                    js: ['build/components/dashboard.js']
                }
            }]
        }
    };
};

export default dashboardModuleFactory;
