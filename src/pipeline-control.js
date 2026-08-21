const pipelineRegistrations = new WeakMap()

const registerPipeline = (pipeline, instantiate, isIdentity) => {
  pipelineRegistrations.set(pipeline, { instantiate, isIdentity })
  return pipeline
}

const instantiatePipeline = (pipeline) => pipelineRegistrations.get(pipeline).instantiate()
const isIdentityPipeline = (pipeline) => pipelineRegistrations.get(pipeline).isIdentity()

module.exports = { instantiatePipeline, isIdentityPipeline, registerPipeline }