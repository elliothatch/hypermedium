import { Edge, json as graphJson } from 'graphlib';
import * as HAL from '../../hal';
import { filterCuries, getProfiles, resourceMatchesProfile } from '../../hal-util';
import { createSchema, objectDifference } from '../../util';
import { Hypermedia, Embed } from '../';

import * as makeIndex from './make-index';
import * as tags from './tags';
export { makeIndex, tags };

type ResourceState = Hypermedia.ResourceState;
type ExtendedResource = Hypermedia.ExtendedResource;
type CalculateFromResourceParams = Hypermedia.CalculateFromResourceParams;

export interface Processor {
    name: string;
    fn: ProcessorFn;
}

/** takes in a HAL object and some external state, and returns transformed versions
 * of each. */
export type ProcessorFn = (rs: ResourceState) => ResourceState;

/* higher-order processor that only runs the provided processor if the resource matches the designated profile */
export const matchProfile = (profile: HAL.Uri, processor: Processor): Processor => {
    return {
        name: 'matchProfile',
        fn: (rs) => resourceMatchesProfile(rs.resource, profile, rs.state.baseUri)?
            processor.fn(rs):
            rs
    };
};
