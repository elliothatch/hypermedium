import { Observable } from 'rxjs';

import { Logger } from 'freshlog';

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

export interface BuildStepLog {
    level: string;
    message: string;
    timestamp: string;
    /** loggers can add arbitrary properties */
    [property: string]: any;
}

export type BuildEvent = BuildEvent.BuildError | BuildEvent.Success | BuildEvent.Start | BuildEvent.Log | BuildEvent.Done;

/** a build event without the base properties. Unfortunately, this doesn't work. buildTask/buildMultiTask would have returned this type if it worked, instead we return BuildEvents directly in each sub-build function */
// export type BuildEventSpecific = Exclude<BuildEvent, {buildStepPath: number[]}>;

export namespace BuildEvent {
    export interface Base {
        buildStepPath: number[];
    }
    export interface Start extends Base {
        eType: 'start';
    }

    export interface Log extends Base {
        eType: 'log';
        log: BuildStepLog;
    }

    export interface Done extends Base {
        eType: 'done';
    }

    export interface BuildError extends Base {
        eType: 'error';
        error: Error;
    }

    export interface Success extends Base {
        eType: 'success';
        result?: any;
    }
}
