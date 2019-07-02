/*
Copyright 2019 Balena Ltd.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as fs from 'mz/fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import * as tunnel from 'tunnel-ssh';
import {
	FileLoadError,
	NotImplementedError,
	UnsupportedError,
	URILoadError,
} from './error-types';

import { TimeoutError } from 'bluebird';
import * as yamljs from 'yamljs';
import { ConfigMap } from './controllers/config-store/config-store';

export const tunnelAsync = Bluebird.promisify(tunnel);

/**
 * Returns an absolute path for a path, when in basePath
 * @param {string} path: The file path, (or an absolute path)
 * @param {string} basePath: The base path
 * @returns {string} An absolute path
 */
export function getAbsolutePath(path: string, basePath: string): string {
	return isAbsolute(path) ? path : join(basePath, path);
}

/**
 * Gets absolute URI
 * @param {string} uri
 * @param {string} basePath
 * @returns {string}
 */
export function getAbsoluteUri(uri: string, basePath: string): string {
	if (isValidGitUri(uri)) {
		throw new NotImplementedError('Git URI support not implemented yet');
	} else if (localPathUri(uri)) {
		return getAbsolutePath(uri, basePath);
	} else {
		throw new UnsupportedError('URI type not supported yet');
	}
}

/**
 * Loads a yaml file as object
 * @param {string} filePath
 * @param {string} errorMessage
 * @returns {Promise<string>}
 */
export async function loadFromFile(
	filePath: string,
	errorMessage: string = '',
): Promise<object> {
	try {
		return yamljs.parse(await fs.readFile(filePath, 'utf8'));
	} catch (e) {
		throw new FileLoadError(errorMessage + e.message);
	}
}

/**
 * Checks uri is a valid git URI
 * @param {string} uri
 * @returns {boolean}
 */
export function isValidGitUri(uri: string): boolean {
	return /((git|ssh|http|https)|(git@[\w\.]+))(:(\/\/)?)([\w\.@\:/\-]+)/.test(
		uri,
	);
}

/**
 * Checks if uri is a valid local path URI
 * @param {string} uri
 * @returns {boolean}
 */
export function localPathUri(uri: string): boolean {
	return /^([a-zA-Z0-9_/\-.])+$/.test(uri);
}

/**
 * Loads a file in path of URI
 * @param {string} uri
 * @param {string} path
 * @param {string} errorMessage
 * @returns {Promise<string>}
 */
export async function loadFromUri({
	uri,
	path,
	errorMessage,
}: {
	uri: string;
	path: string;
	errorMessage?: string;
}): Promise<object> {
	// TODO: support git URI
	if (isValidGitUri(uri)) {
		throw new UnsupportedError('Git URI support not implemented yet');
	}
	if (localPathUri(uri)) {
		return await loadFromFile(join(uri, path), errorMessage);
	}
	throw new URILoadError(`Error loading ${path} from ${uri}`);
}

/**
 * Gets base path of a path
 * @param {string} path
 * @returns {string}
 */
export function getBasePath(path: string): string {
	return dirname(resolve(path));
}

/**
 * Converts relative paths of any object to absolute paths
 * @param {object} conf
 * @param {string} basePath
 * @returns {object}
 */
export function convertRelativePaths({
	conf,
	basePath,
}: {
	conf: any;
	basePath: string;
}): any {
	// Convert relative to absolute URIs
	const keys = [
		'productRepo',
		'archiveStore',
		'encryptionKeyPath',
		'envFile.path',
		'yamlFile.path',
		'kubernetes.kubeConfigPath',
		'kubernetes.bastion.key',
		'compose.socket',
	];

	for (const key of keys) {
		const value = _.get(conf, key);
		if (value) {
			_.set(conf, key, getAbsoluteUri(value, basePath));
		}
	}
	return conf;
}

/**
 * Reads a file from URI
 * @param {string} URI
 * @param {string} path
 * @param {string} cachePath
 * @returns {Promise<string>}
 */
export async function readFromUri({
	uri,
	path,
	cachePath,
}: {
	uri: string;
	path: string;
	cachePath?: string;
}): Promise<string> {
	// TODO: support git URI
	if (isValidGitUri(uri)) {
		throw new UnsupportedError('Git URI support not implemented yet');
	} else if (localPathUri(uri)) {
		return (await fs.readFile(join(uri, path))).toString('utf8');
	} else {
		throw new UnsupportedError('URI type not supported yet');
	}
}

/**
 * Lists a path in a URI
 * @param {string} URI
 * @param {string} path
 * @param {string} cachePath
 * @returns {Promise<string[]>}
 */
export async function listUri({
	uri,
	path,
	cachePath,
}: {
	uri: string;
	path: string;
	cachePath?: string;
}): Promise<string[]> {
	// TODO: support git URI
	if (isValidGitUri(uri)) {
		throw new UnsupportedError('Git URI support not implemented yet');
	} else if (localPathUri(uri)) {
		return await fs.readdir(join(uri, path));
	} else {
		throw new UnsupportedError('URI type not supported yet');
	}
}

/**
 * Keyframe unwrapper to a standard format
 * @param productRepoURI: URI of the product repo
 * @param keyFramePath: path of keyframe
 *
 * returns: Keyframe object
 */
export async function unwrapKeyframe(
	productRepoURI: string,
	keyFramePath: string = './keyframe.yml',
): Promise<object> {
	// TODO: keyframe layering
	let keyFrame = await loadFromUri({ uri: productRepoURI, path: keyFramePath });

	if (keyFrame) {
		keyFrame = _.filter(
			_.get(keyFrame, ['children', 'sw', 'containerized-application'], []),
			component => component.type === 'sw.containerized-application',
		);
		keyFrame = _.mapValues(_.keyBy(keyFrame, 'slug'), o =>
			_.merge(_.get(o, 'assets', {}), { version: _.get(o, 'version') }),
		);
		return keyFrame;
	} else {
		return {};
	}
}

/**
 * Creates an ssh tunnel for executing a promise
 * @param tnlConfig: ssh2 tunnel configuration object
 * @param prom: promise
 * @param timeout: tunnel timeout.
 * @returns {Promise<any>}
 */
export async function runInTunnel(
	tnlConfig: tunnel.Config,
	prom: Promise<any>,
	timeout: number,
): Promise<any> {
	const tnl = await tunnelAsync(tnlConfig);
	const wait = setTimeout(function() {
		tnl.close();
		throw new TimeoutError('Timeout exceeded');
	}, timeout);
	return prom.then((ret: any) => {
		clearTimeout(wait);
		if (tnl) {
			tnl.close();
		}
		return ret;
	});
}

/**
 * Convert a nested configMap object to a flat Key-Value pair configMap
 * @param {ConfigMap} configMap
 * @returns {ConfigMap}
 */
export function configMapToPairs(configMap: ConfigMap): ConfigMap {
	const keyPaths: string[] = [];
	const ret: ConfigMap = {};
	function traverse(configMap: any, path: string = '') {
		if (configMap && _.isObject(configMap)) {
			_.forIn(configMap, function(value: any, key: string) {
				traverse(value, `${path}.${key}`);
			});
		} else {
			keyPaths.push(_.trimStart(path, '.'));
		}
	}
	traverse(configMap);
	for (const keyPath of keyPaths) {
		ret[_.replace(keyPath, new RegExp('\\.', 'g'), '___')] = _.get(
			configMap,
			keyPath,
		);
	}
	return ret;
}

/**
 * Transforms a key-value pair configMap to a nested configMap object.
 * @param {ConfigMap} configPairs
 * @returns {ConfigMap}
 */
export function kvPairsToConfigMap(configPairs: ConfigMap): ConfigMap {
	for (const key of _.keys(configPairs).sort()) {
		const keyPath = _.split(key, '___');
		_.set(configPairs, keyPath, configPairs[key]);
		// filter out '___' delimited flat keys
		if (keyPath.length > 1) {
			_.unset(configPairs, key);
		}
	}
	return configPairs;
}
