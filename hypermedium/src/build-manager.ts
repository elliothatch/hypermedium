import { defer, Observable, from, of, forkJoin, concat, Subject, merge, Subscription } from 'rxjs';
import { debounceTime, map, mergeMap, catchError, filter, finalize, retry, skip } from 'rxjs/operators';
import { Router, RequestHandler } from 'express';

import { Logger, Target, Serializer } from 'freshlog';

import * as Build from './build';
import { watchFiles } from './util';

/**
 * Static asset build system, e.g. for compiling SASS into CSS, etc.
 */
export class BuildManager {
    public taskDefinitions: Map<string, Build.TaskDefinition>;
    /** all task file paths will be relative to this directory */
    public basePath: string;
    public router: Router;
    public buildSteps: Build.StepMap;
    public watchDebounceMs: number = 100;

    public watchEvents: Observable<Build.Event>;
    protected watchSubject: Subject<Build.Event>;

    /** file path -> task definition -> watch entry */
    protected watchedFiles: Map<string, Map<string, {task: Build.Task, eventSubscription: Subscription}>>;

    constructor(basePath: string) {
        this.taskDefinitions = new Map();

        this.buildSteps = {};
        this.watchedFiles = new Map();

        this.watchSubject = new Subject();
        this.watchEvents = this.watchSubject.asObservable();

        this.basePath = basePath;
        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    public addTaskDefinition(name: string, taskDefinition: Build.TaskDefinition): Build.TaskDefinition {
        if(this.taskDefinitions.has(name)) {
            throw new Error(`BuildManager: Cannot register task definition '${name}': A task definition with that name already exists`);
        }

        this.taskDefinitions.set(name, taskDefinition);
        return taskDefinition;
    }

    public unwatchFile(path: string, taskDefinition: string): boolean {
        const watchFile = this.watchedFiles.get(path);
        if(!watchFile) {
            return false;
        }

        const watchEntry = watchFile.get(taskDefinition);
        if(!watchEntry) {
            return false;
        }

        watchEntry.eventSubscription.unsubscribe();
        watchFile.delete(taskDefinition);

        if(watchFile.size === 0) {
            this.watchedFiles.delete(path);
        }

        return true;
    }

    protected middleware: RequestHandler = (req, res, next) => {
        this.build(req.body).pipe(
            filter((event) => event.eType === 'done')
        ).subscribe({
            next: (event: Build.Event) => {
                res.status(200).json(event);
            },
            error: (error) => {
                next(error);
            }
        });
    }

    protected buildTask(task: Build.Task, basePath: string, buildStepPath: number[]): Observable<Build.Event> {
        const taskDefinition = this.taskDefinitions.get(task.definition);
        if(!taskDefinition) {
            return of({
                eType: 'error' as const,
                error: new Error(`There is no task definition registered with the name '${task.definition}'`),
                buildStep: task,
                buildStepPath
            });
        }

        const taskLogSubject = new Subject<Build.StepLog>();
        const taskLogTarget = Target.Observable<Build.StepLog>('buildlog', taskLogSubject);
        const taskLogger = new Logger({
            target: taskLogTarget.target,
            serializer: Serializer.identity
        });

        const taskObservable = forkJoin(task.files.map(({inputs, outputs, options}) =>
            defer(() => {
                const fileOptions = {
                    inputs: Build.prefixPaths(inputs, basePath),
                    outputs: Build.prefixPaths(outputs, basePath),
                    options: Object.assign({}, task.options, options)
                };

                taskLogger.info(`Build ${taskDefinition.name}: ${Object.values(fileOptions.inputs).flat().join(',')} -> ${Object.values(fileOptions.outputs).flat().join(',')}`, fileOptions);
                return from(taskDefinition.func(
                    fileOptions.inputs,
                    fileOptions.outputs,
                    fileOptions.options,
                    taskLogger
                )).pipe(
                    finalize(() => {
                        if(task.watch) {
                            Object.keys(fileOptions.inputs).forEach((inputName) => {
                                fileOptions.inputs[inputName].forEach((inputPath) => {
                                    let watchFile = this.watchedFiles.get(inputPath);
                                    if(!watchFile) {
                                        watchFile = new Map();
                                        this.watchedFiles.set(inputPath, watchFile);
                                    }

                                    let watchEntry = watchFile.get(task.definition);
                                    if(!watchEntry) {
                                        watchEntry = {
                                            task,
                                            eventSubscription: watchFiles(inputPath).pipe(
                                                skip(Object.keys(fileOptions.inputs).length), // skip the first event for each file when they're first detected
                                                debounceTime(this.watchDebounceMs),
                                                mergeMap((watchEvent) => {
                                                    return this.buildTask(task, basePath, buildStepPath)
                                                }),
                                                catchError((error) => {
                                                    this.watchSubject.next({
                                                        buildStep: task,
                                                        buildStepPath,
                                                        eType: 'error' as const,
                                                        error
                                                    });

                                                    throw error;
                                                }),
                                                retry(),
                                            ).subscribe((buildEvent) => {
                                                    this.watchSubject.next(buildEvent);
                                            }),
                                        };

                                        watchFile.set(task.definition, watchEntry);
                                    }
                                });
                            })
                        }
                    })
                );
            })
        )).pipe(
            map((result) => ({
                eType: 'success' as const,
                result
            }))
        );

        return merge(
            taskLogSubject.pipe(
                map((log) => ({
                    eType: 'log' as const,
                    log
                })
            )),
            taskObservable.pipe(finalize(() => taskLogSubject.complete()))
        ).pipe(
            map((event) => Object.assign(event, {buildStep: task, buildStepPath}))
        );
    }

    protected buildMultiTask(multitask: Build.MultiTask, basePath: string, buildStepPath: number[]): Observable<Build.Event> {
        if(multitask.sync) {
            return concat(...multitask.steps.map((s, i) => this.build(s, basePath, buildStepPath.concat([i]))),
                of({
                    eType: 'success' as const,
                    result: [],
                    buildStepPath
                })
            );
        }
        else {
            return concat(
                merge(...multitask.steps.map((s, i) => this.build(s, basePath, buildStepPath.concat([i])))),
                of({
                    eType: 'success' as const,
                    result: [],
                    buildStep: multitask,
                    buildStepPath
                })
            );
        }
    }

    /**
     * Builds the project
     */
    // TODO: include contextual information about the task (moduleInstance)
    public build(step: Build.Step, basePath?: string, buildStepPath?: number[]): Observable<Build.Event> {
        basePath = basePath || this.basePath;
        buildStepPath = buildStepPath || [];

        // buildObservable events don't have the Build.Event.Base attributes, since they're added universally at the end of this function
        let buildObservable: Observable<Build.Event> = (() => {
            switch(step.sType) {
                case 'task':
                    return this.buildTask(step, basePath!, buildStepPath);
                case 'multitask':
                    return this.buildMultiTask(step, basePath!, buildStepPath);
            }
        })();

        // typescript gets confused if we pipe directly off previous statement
        buildObservable = buildObservable.pipe(
            catchError((error) => of({
                eType: 'error' as const,
                error: error as Error,
                buildStep: step,
                buildStepPath: buildStepPath!
            }))
        );

        return concat(
            of({
                eType: 'start' as const,
                buildStep: step,
                buildStepPath: buildStepPath!,
            }),
            buildObservable,
            of({
                eType: 'done' as const,
                buildStep: step,
                buildStepPath: buildStepPath!
            })
        );
    }
}
