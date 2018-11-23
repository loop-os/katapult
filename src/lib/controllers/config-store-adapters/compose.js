'use strict'
const Promise = require('bluebird')
const { readFileAsync, writeFileAsync } = Promise.promisifyAll(
	require('fs-extra')
)
const dotenv = require('dotenv')
const _ = require('lodash')

module.exports = class ConfigStore {
	constructor(configPath) {
		this.configPath = configPath
	}

	getConfig() {
		return readFileAsync(this.configPath, 'utf8').then(configString => {
			return dotenv.parse(Buffer.from(configString.split('\\r').join('\r')))
		})
	}

	update(envvars) {
		return readFileAsync(this.configPath, 'utf8')
			.then(configString => {
				_.forEach(envvars, pair => {
					let [name, value] = pair
					value = value
						.split('\r')
						.join('')
						.split('\n')
						.join('\\n')
					let re = new RegExp(`^.*${name}.*$`, 'm')
					let dotenvEntry = `${name}="${value}"`
					let replaced_string = configString.replace(re, dotenvEntry)
					if (configString === replaced_string) {
						configString += `\n${dotenvEntry}`
					} else {
						configString = configString.replace(re, dotenvEntry)
					}
				})
				return configString
			})
			.then(configString => {
				return writeFileAsync(this.configPath, configString)
			})
	}
}
