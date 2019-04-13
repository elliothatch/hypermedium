import { Observable, from, of, forkJoin, concat, Subject } from 'rxjs';
import { map, catchError, toArray, filter } from 'rxjs/operators';
import * as fs from 'fs-extra';
import * as Path from 'path';
import { Router, RequestHandler } from 'express';

import { Logger, Target } from 'freshlog';

export type FileMap = {[name: string]: string[]};

// TODO: add conditional step
export type BuildStep = Task | MultiTask;

/**
 * An instance of a TaskDefinition
 */
export interface Task {
    /** step type */
    sType: 'task';
    /** name of the TaskDefinition this is an instance of */
    definition: string;
    /** Options specific to this task which will be passed to the TaskDefinitionFn */
    options?: object;
    /** file/directory paths used for each invocation of the TaskDefinition
     * the shape of the string arrays must conform to the count restraints from the FileSpecs for the TaskDefinition.
     * the options object overrides the Task options for a single invocation, using Object.assign */
    files: Array<{
        inputs: FileMap,
        outputs: FileMap,
        options?: object
    }>;
}

/**
 * Build step that executes multiple BuildSteps in parallel or series
 */
export interface MultiTask {
    /** step type */
    sType: 'multitask';
    /** if true, wait for each step to complete before starting the next one */
    sync?: boolean;
    steps: BuildStep[];
}

/**
 * Specifies what kinds of files/directories can be used as input/output of a TaskDefinition
 */
export namespace FileSpec {
    export interface Input {
        /** The type of file. If omitted, can be either a file or directory */
        fType?: 'file' | 'dir';
        /* number of files/dirs. if a number, specifies exact count, if array it is an inclusive range [min, max], if max is omitted there is no upper limit */
        count: number | [number] | [number, number];
        /* Expected name format, used for filtering file selections. if array, all hints are applied with OR logic.
         * Supports '*' wildcard for matching any string.
         * e.g. '*.js' matches all files with .js extension. */
        hint?: string | string[];
    }

    export interface Output {
        /** The type of file. If omitted, can be either a file or directory */
        fType?: 'file' | 'dir';
        /* number of files/dirs. if a number, specifies exact count, if array it is an inclusive range [min, max], if max is omitted there is no upper limit */
        count: number | number[];
        /* Autogenerate suggested output file name based on input file name.
         * anything in '{}' is interpolated, parts of the name can be specified after a pipe (|)
         * {0}, {1}, ..., {n} : input at array index n
         * {0 | basename}: input at index 0 without extension
         * {}: user provided, allows hints for just an extension, prefix, etc (e.g. {}.html)
         */
        hint?: string;
    }
}

export type BuildStatus =  BuildStep & {
    status: 'pending' | 'running' | 'success' | 'warn' | 'error';
}

/** function that performs a build task (e.g. compiles sass into css)
 * @returns data describing the result. This will be included in the build log.
 */
export type TaskDefinitionFn = (inputs: FileMap, outputs: FileMap, options: any, logger: Logger) => Observable<any>;

/**
 * blueprint for a type of task (copy, compile sass)
 *  input/output params should define the minimum files necessary for one execution of the task (e.g. copy only needs one input file and one output file)
 *  The Task engine handles calling the TaskDefinition func mutliple times if multiple files are specified, so that logic doesn't need to be implemented in the TaskDefinition
 */
export interface TaskDefinition<T = undefined> {
    name: string;
    description: string;
    func: TaskDefinitionFn;
    /* maps the name of each input group to a file spec */
    inputs: {[name: string]: FileSpec.Input};
    /* maps the name of each output group to a file spec */
    outputs: {[name: string]: FileSpec.Output};
}

export namespace TaskDefinition {
    export const Clean: TaskDefinition = {
        name: 'clean',
        description: 'Delete a file or directory',
        func: (inputs, outputs, options, logger) => {
            logger.info("Removing '" + inputs.target[0] + "'");
            return from(fs.remove(inputs.target[0]));
        },
        inputs: {
            target:  {
                count: [1],
            }
        },
        outputs: {}
    };

    export const Copy: TaskDefinition = {
        name: 'copy',
        description: 'Copy a file or directory',
        func: (inputs, outputs, options, logger) => {
            logger.info("Copying '" + inputs.target[0] + "' to '" + outputs.destination[0] + "'");
            return from(fs.copy(inputs.target[0], outputs.destination[0]));
        },
        inputs: {
            target: {
                count: 1,
            }
        },
        outputs: {
            destination: {
                count: 1,
                hint: '{0}'
            }
        }
    };
}

interface BuildStepLog {
    level: string;
    message: string;
    timestamp: string;
    /** identifies which task created this log. each value in the array is an index into the BuildStep array structure */
    buildStepPath: number[];
    /** loggers can add arbitrary properties */
    [property: string]: any;
}

/**
 * Static asset build system, e.g. for compiling SASS into CSS, etc.
 */
export class BuildManager {
    public logger: Logger;
    public loggerSubject: Subject<BuildStepLog>;
    public taskDefinitions: Map<string, TaskDefinition>;
    /** all task file paths will be relative to this directory */
    public basePath: string;
    public router: Router;

    constructor(basePath: string) {
        this.loggerSubject = new Subject();
        this.logger = this.makeBuildLog(this.loggerSubject, []);

        this.taskDefinitions = new Map([
            [TaskDefinition.Clean.name, TaskDefinition.Clean],
            [TaskDefinition.Copy.name, TaskDefinition.Copy],
        ]);

        this.basePath = basePath;
        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    protected middleware: RequestHandler = (req, res, next) => {
        this.build(req.body).pipe(
            filter((event) => event.eType === 'done')
        ).subscribe({
            next: (event: BuildEvent) => {
                res.status(200).json(event);
            },
            error: (error) => {
                next(error);
            }
        });
    }

    /**
     * Builds the project
     * @returns observable
     *      - 'start'{SerializedTask}
     *      - 'success'{}
     *      - 'fail'{}
     *      - 'task/start'{{path}}
     *      - 'task/log'{{path, status, log}}
     *      - 'task/done'{{path}}
     */
    public build(step: BuildStep, logger?: Logger): Observable<BuildEvent> {
        // TODO: figure out a good api for passing loggers down to subtasks. pass the BuildStepPath, and no logger?
        // what if you start two builds at the same time?
        const stepLogger = logger || this.logger;
        const buildObservable = (() => {
            switch(step.sType) {
                case 'task':
                    const taskDefinition = this.taskDefinitions.get(step.definition);
                    if(!taskDefinition) {
                        return of({
                            eType: 'error' as const,
                            error: new Error(`There is no task definition registered with the name '{step.definition}'`)
                        });
                    }

                    return forkJoin(step.files.map(({inputs, outputs, options}) =>
                        taskDefinition.func(
                            prefixPaths(inputs, this.basePath),
                            prefixPaths(outputs, this.basePath),
                            Object.assign({}, step.options, options),
                            stepLogger))
                    ).pipe(
                        map((results) => ({
                            eType: 'success' as const,
                            result: results
                        }))
                    );

                    break;
                case 'multitask':
                    if(step.sync) {
                        return concat(step.steps.map((s) => this.build(s, this.makeBuildLog(stepLogger, [])))
                        ).pipe(
                            toArray(),
                            map((results) => ({
                                eType: 'success' as const,
                                result: results
                            }))
                        );
                    }
                    else {
                        return forkJoin(step.steps.map((s) => this.build(s, this.makeBuildLog(stepLogger, [])))
                        ).pipe(
                            map((results) => ({
                                eType: 'success' as const,
                                result: results
                            }))
                        );
                    }
                    break;
            }
        })().pipe(
            catchError((error) => of({
                eType: 'error' as const,
                error: error as Error
            }))
        );


        if(!logger) {
            return concat(
                of({
                    eType: 'start' as const
                }),
                buildObservable,
                of({
                    eType: 'done' as const,
                })
            );
        }

        return buildObservable;

    }

    /**
     * @param subject - The subject that log events will be emitted to
     * @param taskPath - Logs created with this sublogger are identified by their location relative to the root BuildStep.
     *                   The root task is represented by the empty array
     */
    private makeBuildLog(subject: Subject<BuildStepLog>, buildStepPath: number[]): Logger {
        return new Logger({
            middleware: [{
                mw: (data) => Object.assign(data, {buildStepPath}),
                levels: true
            }],
            target: Target.Observable('buildlog', subject).target,
        });
    }
}

/** creates a copy of a FileMap with each file path prefixed with the specified path, using Path.join */
function prefixPaths(files: FileMap, prefix: string): FileMap {
    return Object.keys(files).reduce((o, k) => {
        o[k] = files[k].map((f) => Path.join(prefix, f));
        return o;
    }, {} as FileMap);
}

export type BuildEvent = BuildEvent.BuildError | BuildEvent.Success | BuildEvent.Start | BuildEvent.Done;

export namespace BuildEvent {
    export interface Start {
        eType: 'start';
    }

    export interface Done {
        eType: 'done';
    }

    export interface BuildError {
        eType: 'error';
        error: Error;
    }

    export interface Success {
        eType: 'success';
        result?: any;
    }
}
