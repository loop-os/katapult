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
const configValidator = require('./config-validator/config-validator')
const configGenerator = require('./config-generator')
const configManifest = require('./config-manifest/config-manifest')
const { kubernetes, balena, compose } = require('./config-store-adapters')
const { ensureRepoInPath } = require('../utils')

module.exports = class DeploySpec {
	constructor({
		environmentName,
		environmentObj,
		configBasePath,
		keyframe,
		mode,
		buildComponents
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
	}

	generate() {
		let promises = []

		_.forEach(this.targets, (attrs, target) => {
			promises.push(this.generateTarget(attrs, target))
		})
		return Promise.all(promises)
	}

	generateTarget(attrs, target) {
		const templatePath = path.join(this.configBasePath, attrs.template)
		const configPath = path.join(this.configBasePath, attrs['config-store'])
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
		if (target === 'docker-compose') {
			cs = new compose(configPath)
		} else if (target === 'balena') {
			cs = new balena(configPath)
		} else if (target === 'kubernetes') {
			cs = new kubernetes(configPath)
		}
		let cm = new configManifest(configManifestPath)
		return Promise.all([cs.getConfig(), cm.getConfigManifest()])
			.tap(([config, cManifest]) => {
				let input_config = _.cloneDeep(config)
				return new configGenerator(config, cManifest, this.mode)
					.generate()
					.then(config => {
						if (this.mode) {
							return cs.update(
								_.differenceWith(
									_.toPairs(config),
									_.toPairs(input_config),
									_.isEqual
								)
							)
						}
					})
			})
			.then(([config, cManifest]) => {
				return new configValidator(config, cManifest)
					.validate(true)
					.then(this.extendConfig(config, buildComponents))
					.then(config => {
						return readdirAsync(templatePath).then(filenames => {
							let promises = []

							_.forEach(filenames, templateFileName => {
								promises.push(
									readFileAsync(
										path.join(templatePath, templateFileName),
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
		if (this.keyframe && _.get(this.keyframe, 'components')) {
			_.forEach(this.keyframe['components'], (value, name) => {
				config[name + '-image'] = _.get(value, 'image')
			})
		}
		let promises = []
		_.forEach(buildComponents, (buildPath, name) => {
			buildPath = buildPath || path.join(process.cwd(), name)
			config['build-' + name] = true
			config[name + '-build-path'] = buildPath
			if (!_.get(this.keyframe['components'], name)) {
				throw new Error('Build component: ' + name + ' not defined in keyframe')
			}
			if (!_.get(this.keyframe['components'], [name, 'repo'], '')) {
				throw new Error(
					'Build component: ' + name + ' repo not defined in keyframe'
				)
			}
			promises.push(
				ensureRepoInPath(
					_.get(this.keyframe['components'][name], 'repo', ''),
					buildPath
				)
			)
		})
		return Promise.all(promises)
	}
}
