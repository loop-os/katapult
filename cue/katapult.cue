package katapult

import (
	"list"

	"github.com/balena-io/katapult/cue/contract"
	"github.com/balena-io/katapult/cue/adapter/k8s"
	"github.com/balena-io/katapult/cue/adapter/k8s/aws"
	"github.com/balena-io/katapult/cue/keyframe"
)

contracts: contract.Data
keyframes: keyframe.Data

k8sData: k8s.Data & aws.Data

k8sData: d: [Namespace=string]: {
	for componentRef in keyframes[Namespace].children {
		component = contracts[componentRef.slug]
		componentType = component.type

		versionMetadata = {
			metadata: labels: "app.kubernetes.io/version": componentRef.version
		}

		// Services for corresponding component types.
		if (list.Contains(contract.ServiceTypes, componentType)) {
		    serviceAccount: "\(componentRef.as)": versionMetadata

			service: {
				httpExposedTypes = [
					"sw.containerized-web-service",
				]

				"\(componentRef.as)": versionMetadata

				"\(componentRef.as)": spec: {
					httpsPorts = [
						{
							name:       "https"
							port:       443
							targetPort: capability.as
							protocol:   capability.data.protocol | *"TCP"
						}
						for capability in component.provides if capability.type == "endpoint" && capability.as == "main"
					]
					httpPorts = [
						{
							name:       "http"
							port:       80
							targetPort: "main" // TODO: Derive from the capability.
							protocol:   "TCP"
						} if list.Contains(httpExposedTypes, componentType)
					]
					ports: list.FlattenN([httpsPorts, httpPorts], 2)
				}
			}
		}

		// Deployment per service component.
		if (list.Contains(contract.ServiceTypes, componentType)) {
			deployment: {
				"\(componentRef.as)": versionMetadata & {
					spec: template: spec: containers: [{
						image: "balena/\(component.slug):\(componentRef.version)"
						ports: [
							{
								containerPort: capability.data.port
								name:          capability.as
								protocol:      capability.data.protocol | *"TCP"
							} for capability in component.provides if capability.type == "endpoint"
						]
					}]
				}
			}
		}
	}
}

configData: [Namespace=string]: {
	for componentRef in keyframes[Namespace].children {
        "\(componentRef.as)": {
            behaviour: {}
            integration: {}
        }
	}
}

// Namespaces per product keyframe.
for name, k in keyframes {
	k8sData: namespace: "\(name)": {}
	k8sData: d: "\(name)": {}
	configData: "\(name)": {}
}