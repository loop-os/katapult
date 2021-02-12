package katapult

import (
	"encoding/yaml"
	"tool/cli"
	"list"
	"github.com/product-os/katapult/cue/adapter/compose"
)

command: printCompose: {
	task: print: cli.Print & {
		text: yaml.MarshalStream([configs[input.product.slug].data])
	}
}

// generate compose service
#func_service: {

	#contract: #SwContainerizedService
	#links: [string]: string
	#id: string

	let requiresByType = {for _, ref in #contract.requires {"\(ref.type)": ref}}

	let _cap_add = list.FlattenN([ for ref in #contract.requires if (#CapabilitiesRef & ref) != _|_ {ref.data.add}], 1)
	if len(_cap_add) > 0 {
		cap_add: _cap_add
	}

	let _cap_drop = list.FlattenN([ for ref in #contract.requires if (#CapabilitiesRef & ref) != _|_ {ref.data.drop}], 1)
	if len(_cap_drop) > 0 {
		cap_drop: _cap_drop
	}

	if #contract.data.command != _|_ {
		command: #contract.data.command
	}

	if #links != _|_ {
		depends_on: [ for _, target in #links {target}]
	}

	environment: {
		for config_name, config in #contract.config {"\(config_name)": config.value}
	}
	// expose: [ for ref in #contract.provides if ref.type == "net.expose" { "\(ref.data.port)" }]
	// healthcheck: TODO: how to select only one health check
	image: "\(#contract.data.assets.image.url):\(#contract.version)"

	let _labels = list.FlattenN([ for ref in #contract.requires if (#LabelRef & ref) != _|_ {ref.data.labels}], 1)
	if len(_labels) > 0 {
		labels: _labels
	}

	let _aliases = list.FlattenN([ for ref in #contract.requires if (#AliasesRef & ref) != _|_ {ref.data.aliases}], 1)
	if len(_aliases) > 0 {
		network: internal: aliases: _aliases
	}

	if requiresByType["network_mode"] != _|_ {
		network_mode: requiresByType["network_mode"].data.value
	}

	let _ports = list.FlattenN([ for ref in #contract.requires if (#PortsRef & ref) != _|_ {ref.data.ports}], 1)
	if len(_ports) > 0 {
		ports: _ports
	}

	let _tmpfs = list.FlattenN([ for ref in #contract.requires if (#TmpfsRef & ref) != _|_ {ref.data.paths}], 1)
	if len(_tmpfs) > 0 {
		tmpfs: _tmpfs
	}

	restart: #contract.data.restart

	let _security_opt = list.FlattenN([ for ref in #contract.requires if (#SecurityOptRef & ref) != _|_ {ref.data.labels}], 1)

	if len(_security_opt) > 0
	// volumes: [ for ref in #contract.requires if ref.type == "hw.disk" 
	//     {                             
	//         type: "volume"
	//         source: ref.data.name
	//         target: ref.data.target
	//         read_only: ref.data.readonly
	//     }
	// ]    
	{
		security_opt: _security_opt
	}
}

let productKeyframe = keyframes[input.product.slug]
let productServices = {for id, child in productKeyframe.data.children if (#SwContainerizedService & child) != _|_ {"\(id)": child}}

let environmentKeyframe = keyframes[input.environment.slug]
let environmentServices = {for id, child in environmentKeyframe.data.children if (#SwContainerizedService & child) != _|_ {"\(id)": child}}

// generate one compose containing both product and environment services
configs: "\(input.product.slug)": {
	slug:    "\(input.product.slug)-compose"
	type:    "compose"
	version: "1.0.0"
	data:    compose.#Compose & {
		version: "2.1"
		// gen product services
		for id, service in productServices {
			for index in list.Range(1, service.data.replicas+1, 1) {
				services: "\(id)_\(index)": #func_service & {#contract: service, #links: productKeyframe.data.links[id], #id: id}
			}
		}

		// gen environment services
		for id, service in environmentServices {
			for index in list.Range(1, service.data.replicas+1, 1) {
				services: "\(id)_\(index)": #func_service & {#contract: service, #id: id}
			}
		}

		volumes: {}
	}
}
