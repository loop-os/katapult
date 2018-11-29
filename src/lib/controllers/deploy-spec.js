'use strict'

const path = require('path')
const _ = require('lodash')
const Promise = require('bluebird')
const mustache = require('mustache')
const {
	readFileAsync,
	writeFileAsync,
	readdirAsync,
	ensureDirAsync
} = Promise.promisifyAll(require('fs-extra'))
const ConfigValidator = require('./config-validator')
const ConfigGenerator = require('./config-generator')
const ConfigManifest = require('./config-manifest/config-manifest')
const { kubernetes, balena, compose } = require('./config-store-adapters')
const { ensureRepoInPath } = require('../utils')

module.exports = class DeploySpec {
	constructor({
		environmentName,
		environmentObj,
		configBasePath,
		keyframe,
		mode,
		buildComponents,
		verbose
	}) {
		this.mode = mode
		this.targets = _.omit(environmentObj, [
			'version',
			'archive-store',
			'pubkey',
			'test-target',
			'test-image'
		])
		this.version = environmentObj.version
		this.environmentName = environmentName
		this.configBasePath = configBasePath
		this.keyframe = keyframe
		this.buildComponents = buildComponents
		this.archiveStore = environmentObj['archive-store']
		this.verbose = verbose
	}

	generate() {
		let promises = []

		_.forEach(this.targets, (attrs, target) => {
			promises.push(this.generateTarget(attrs, target))
		})
		return Promise.all(promises)
	}

	generateTarget(attrs, target) {
		const buildComponents =
			this.buildComponents || _.get(attrs, 'build-components', [])
		const configManifestPath = path.join(
			this.configBasePath,
			this.environmentName,
			this.version,
			target,
			'config-manifest.yml'
		)
		let cs
		switch (target) {
			case 'docker-compose':
				cs = new compose(attrs)
				break
			case 'balena':
				cs = new balena(attrs)
				break
			case 'kubernetes':
				cs = new kubernetes(attrs)
				break
		}

		let cm = new ConfigManifest(configManifestPath)
		return Promise.all([cs.getConfig(), cm.getConfigManifest()])
			.tap(([config, cManifest]) => {
				let input_config = _.cloneDeep(config)
				return new ConfigGenerator({
					config,
					configManifest: cManifest,
					mode: this.mode
				})
					.generate()
					.then(config => {
						let configDiffPairs = _.differenceWith(
							_.map(_.toPairs(config), o => {
								return _.map(o, String)
							}),
							_.toPairs(input_config),
							_.isEqual
						)
						if (this.mode !== 'defensive') {
							if (this.verbose) {
								console.info('updating: ', configDiffPairs)
							}
							return cs.update(configDiffPairs)
						}
					})
			})
			.then(([config, cManifest]) => {
				return new ConfigValidator(config, cManifest)
					.validate(true)
					.then(() => {
						return this.extendConfig(config, buildComponents)
					})
					.then(() => {
						return readdirAsync(attrs.template).then(filenames => {
							let promises = []

							_.forEach(filenames, templateFileName => {
								promises.push(
									readFileAsync(
										path.join(attrs.template, templateFileName),
										'utf8'
									).then(template => {
										let output = mustache.render(template, config)
										let outputPath = path.join(
											this.archiveStore,
											this.environmentName,
											this.version,
											target,
											path.basename(templateFileName).replace('.tpl.', '.')
										)
										return ensureDirAsync(path.dirname(outputPath)).then(() => {
											return writeFileAsync(outputPath, output)
										})
									})
								)
							})
							return Promise.all(promises)
						})
					})
			})
	}

	extendConfig(config, buildComponents) {
		if (this.keyframe) {
			_.forEach(this.keyframe, (value, name) => {
				config[`${name}-image`] = _.get(value, ['image', 'url'])
				config[`${name}-version`] = _.get(value, 'version')
			})
		}
		let promises = []
		_.forEach(buildComponents, (buildPath, name) => {
			buildPath = buildPath || path.join(process.cwd(), name)
			config[`build-${name}`] = true
			config[`${name}-build-path`] = buildPath
			if (!_.get(this.keyframe, name)) {
				throw new Error(`Build component: ${name} not defined in keyframe`)
			}
			if (!_.get(this.keyframe, [name, 'repo'], '')) {
				throw new Error(`Build component: ${name} repo not defined in keyframe`)
			}
			promises.push(
				ensureRepoInPath(_.get(this.keyframe[name], 'repo', ''), buildPath)
			)
		})
		return Promise.all(promises)
	}
}
